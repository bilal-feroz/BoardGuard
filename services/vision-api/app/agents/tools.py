"""Callable vision tools used by the inspection agent.

Each tool has an explicit contract (TOOL_CONTRACTS, served at
GET /api/agent/tools). Implementations take a ToolContext that resolves
observation images from storage, run real OpenCV processing, persist any
derived artifacts and return JSON-serialisable outputs. The orchestrator
records every call, its inputs, a summary of its outputs and its wall time.
"""

from __future__ import annotations

import time
from typing import Any

import cv2
import numpy as np

from ..vision import candidates as cand_mod
from ..vision import differences, multiview, quality, registration
from ..vision.imageio import decode_image, encode_jpeg, encode_png, mask_to_rgba

TOOL_CONTRACTS: list[dict[str, Any]] = [
    {"name": "assess_image_quality", "kind": "vision",
     "inputs": {"observation_id": "str", "roi": "[x,y,w,h] | null"},
     "outputs": {"verdict": "ACCEPT|MARGINAL|REJECT", "reasons": "list[{code,severity,detail}]",
                 "metrics": "blur_metric, laplacian_variance, tenengrad, glare_fraction, clipped_*, rms_contrast",
                 "tiles": "unusable tile rects", "glare_overlay": "artifact url"}},
    {"name": "extract_region_of_interest", "kind": "vision",
     "inputs": {"observation_id": "str", "bbox": "[x,y,w,h]", "margin": "float"},
     "outputs": {"rect": "[x,y,w,h]", "crop": "artifact url", "evidence_quality": "region quality record"}},
    {"name": "detect_visual_candidates", "kind": "vision",
     "inputs": {"observation_id": "str", "roi": "[x,y,w,h] | null"},
     "outputs": {"candidates": "list[{id,type,bbox,polygon,evidence_score,features,evidence_quality}]",
                 "lead_rows": "detected IC lead rows", "layers": "corrosion/metal mask artifact urls"}},
    {"name": "analyze_candidate_region", "kind": "vision",
     "inputs": {"observation_id": "str", "candidate_id": "str"},
     "outputs": {"sufficient": "bool", "issues": "list", "glare_fraction": "float", "blur_metric": "float|null"}},
    {"name": "register_image_pair", "kind": "vision",
     "inputs": {"reference_observation_id": "str", "moving_observation_id": "str"},
     "outputs": {"status": "REGISTERED|WEAK|FAILED", "inliers": "int", "inlier_ratio": "float",
                 "rms_reprojection_px": "float", "inlier_coverage": "float", "homography": "3x3 | null"}},
    {"name": "compare_observations", "kind": "vision",
     "inputs": {"previous_observation_id": "str", "new_observation_id": "str"},
     "outputs": {"comparable": "bool", "per_candidate": "list[{candidate_id,outcome,glare_before,glare_after,...}]"}},
    {"name": "compute_change_map", "kind": "vision",
     "inputs": {"before_observation_id": "str", "after_observation_id": "str"},
     "outputs": {"changed_fraction": "float", "regions": "list[{id,bbox,mean_change}]", "heatmap": "artifact url",
                 "aligned_after": "artifact url"}},
    {"name": "request_recapture", "kind": "action",
     "inputs": {"target": "region label / candidate ids", "issues": "list", "instruction": "str"},
     "outputs": {"pending_action": "RECAPTURE"}},
    {"name": "request_technician_review", "kind": "human-in-the-loop",
     "inputs": {"candidate_ids": "list", "recommended_checks": "dict"},
     "outputs": {"pending_action": "TECHNICIAN_REVIEW"}},
    {"name": "record_verification", "kind": "human-in-the-loop",
     "inputs": {"candidate_id": "str", "decision": "confirm|dismiss|electrical_result", "note": "str"},
     "outputs": {"recorded": "bool"}},
    {"name": "generate_inspection_report", "kind": "output",
     "inputs": {"inspection_id": "str", "format": "html|json"},
     "outputs": {"report": "document"}},
]


class ToolContext:
    def __init__(self, storage, session: dict):
        self.storage = storage
        self.session = session
        self._images: dict[str, np.ndarray] = {}
        self._glare: dict[str, np.ndarray] = {}

    def obs(self, obs_id: str) -> dict:
        for o in self.session["observations"]:
            if o["obs_id"] == obs_id:
                return o
        raise KeyError(obs_id)

    def image(self, obs_id: str) -> np.ndarray:
        if obs_id not in self._images:
            data = self.storage.get(self.obs(obs_id)["capture_key"])
            if data is None:
                raise FileNotFoundError(f"capture for {obs_id} missing from storage")
            self._images[obs_id] = decode_image(data).image
        return self._images[obs_id]

    def glare(self, obs_id: str) -> np.ndarray:
        if obs_id not in self._glare:
            self._glare[obs_id] = quality.specular_mask(self.image(obs_id))
        return self._glare[obs_id]

    def put_artifact(self, name: str, data: bytes, mime: str) -> str:
        key = f"artifacts/{self.session['inspection_id']}/{name}"
        self.storage.put(key, data, mime)
        return key


def _timed(fn):
    def wrap(*a, **kw):
        t0 = time.perf_counter()
        out = fn(*a, **kw)
        out["duration_ms"] = round((time.perf_counter() - t0) * 1000, 1)
        return out
    wrap.__name__ = fn.__name__
    return wrap


@_timed
def assess_image_quality(ctx: ToolContext, observation_id: str, roi=None) -> dict:
    img = ctx.image(observation_id)
    q = quality.assess_image_quality(img, roi=tuple(roi) if roi else None)
    ctx._glare[observation_id] = q["_glare_mask"]
    overlay = mask_to_rgba(q["_glare_mask"], (104, 170, 216), 190)  # amber: evidence compromised by glare
    key = ctx.put_artifact(f"{observation_id}_glare.png", encode_png(overlay), "image/png")
    out = quality.public(q)
    out["glare_overlay_key"] = key
    return out


@_timed
def extract_region_of_interest(ctx: ToolContext, observation_id: str, bbox, margin: float = 0.35) -> dict:
    img = ctx.image(observation_id)
    H, W = img.shape[:2]
    x, y, w, h = bbox
    mx, my = int(w * margin) + 6, int(h * margin) + 6
    x0, y0, x1, y1 = max(0, x - mx), max(0, y - my), min(W, x + w + mx), min(H, y + h + my)
    crop = img[y0:y1, x0:x1]
    key = ctx.put_artifact(f"{observation_id}_roi_{x}_{y}.jpg", encode_jpeg(crop), "image/jpeg")
    eq = quality.assess_region(img, (x, y, w, h), glare_mask=ctx.glare(observation_id))
    return {"rect": [x0, y0, x1 - x0, y1 - y0], "crop_key": key, "evidence_quality": eq}


@_timed
def detect_visual_candidates(ctx: ToolContext, observation_id: str, roi=None) -> dict:
    img = ctx.image(observation_id)
    det = cand_mod.detect_visual_candidates(img, roi=tuple(roi) if roi else None, glare=ctx.glare(observation_id))
    ox, oy = det["_offset"]
    full_corr = np.zeros(img.shape[:2], np.uint8)
    full_metal = np.zeros(img.shape[:2], np.uint8)
    ch, cw = det["_corrosion_mask"].shape
    full_corr[oy:oy + ch, ox:ox + cw] = det["_corrosion_mask"]
    full_metal[oy:oy + ch, ox:ox + cw] = det["_metal_mask"]
    corr_key = ctx.put_artifact(f"{observation_id}_corrosion_mask.png", encode_png(mask_to_rgba(full_corr, (115, 124, 214), 150)), "image/png")
    metal_key = ctx.put_artifact(f"{observation_id}_metal_mask.png", encode_png(mask_to_rgba(full_metal, (160, 173, 121), 120)), "image/png")
    for c in det["candidates"]:
        c["obs_id"] = observation_id
    return {
        "candidates": det["candidates"],
        "lead_rows": det["lead_rows"],
        "params": det["params"],
        "roi": det["roi"],
        "layer_keys": {"corrosion_mask": corr_key, "metal_mask": metal_key},
    }


@_timed
def analyze_candidate_region(ctx: ToolContext, observation_id: str, candidate: dict) -> dict:
    eq = quality.assess_region(ctx.image(observation_id), tuple(candidate["bbox"]), glare_mask=ctx.glare(observation_id))
    return {"candidate_id": candidate["id"], **eq}


@_timed
def register_image_pair(ctx: ToolContext, reference_observation_id: str, moving_observation_id: str) -> dict:
    return registration.register_image_pair(ctx.image(reference_observation_id), ctx.image(moving_observation_id))


@_timed
def compare_observations(ctx: ToolContext, previous_observation_id: str, new_observation_id: str,
                         prev_candidates: list[dict], new_detection: dict, reg: dict) -> dict:
    return multiview.compare_observations(
        ctx.image(previous_observation_id), prev_candidates, ctx.image(new_observation_id),
        new_detection, reg, ctx.glare(new_observation_id))


@_timed
def compute_change_map(ctx: ToolContext, before_observation_id: str, after_observation_id: str, reg: dict,
                       candidates: list[dict]) -> dict:
    ref = ctx.image(before_observation_id)
    mov = ctx.image(after_observation_id)
    H = reg["_H"]
    warped, valid = registration.warp_to_reference(mov, H, ref.shape)
    ch = differences.compute_change_map(ref, warped, valid)
    aligned_key = ctx.put_artifact(f"{after_observation_id}_aligned_to_{before_observation_id}.jpg", encode_jpeg(warped), "image/jpeg")
    heat_key = ctx.put_artifact(f"{after_observation_id}_change_heatmap.png", encode_png(differences.render_heatmap(ch["_change"], valid)), "image/png")
    mask_key = ctx.put_artifact(f"{after_observation_id}_change_mask.png", encode_png(mask_to_rgba(ch["_mask"], (104, 170, 216), 170)), "image/png")
    valid_key = ctx.put_artifact(f"{after_observation_id}_valid_overlap.png",
                                 encode_png(mask_to_rgba(cv2.bitwise_not(valid), (40, 30, 25), 170)), "image/png")
    glare_after = quality.specular_mask(warped)
    links = []
    for c in candidates:
        overlap = differences.candidate_change_overlap(ch["_mask"], c["bbox"])
        x, y, w, h = c["bbox"]
        pad = max(w, h) // 2
        roi = (max(0, x - pad), max(0, y - pad), w + 2 * pad, h + 2 * pad)
        redet = cand_mod.detect_visual_candidates(warped, roi=roi, glare=glare_after)
        still = [n for n in redet["candidates"] if n["type"] == c["type"] and cand_mod.iou(n["bbox"], c["bbox"]) > 0.1]
        links.append({
            "candidate_id": c["id"], "type": c["type"], "bbox": c["bbox"],
            "changed_fraction_in_bbox": round(overlap, 4),
            "changed_px_in_bbox": int(round(overlap * w * h)),
            "visible_change": overlap * w * h >= max(40.0, 0.04 * w * h),
            "redetected_after": bool(still),
            "after_evidence_quality": quality.assess_region(warped, tuple(c["bbox"]), glare_mask=glare_after),
        })
    out = {k: v for k, v in ch.items() if not k.startswith("_")}
    out.update({"aligned_after_key": aligned_key, "heatmap_key": heat_key, "change_mask_key": mask_key,
                "invalid_overlap_key": valid_key, "candidate_links": links})
    return out


TOOLS = {
    "assess_image_quality": assess_image_quality,
    "extract_region_of_interest": extract_region_of_interest,
    "detect_visual_candidates": detect_visual_candidates,
    "analyze_candidate_region": analyze_candidate_region,
    "register_image_pair": register_image_pair,
    "compare_observations": compare_observations,
    "compute_change_map": compute_change_map,
}

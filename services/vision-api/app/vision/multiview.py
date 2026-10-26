"""Pipeline E - multi-view comparison of two observations of one suspected defect.

Registers the new observation to the earlier one, maps every earlier
candidate into the new frame, re-measures local evidence quality there and
re-runs candidate detection on the new observation. The output states, per
candidate, whether it persisted, was not reproduced, or could not be judged,
and how the local evidence quality changed. These facts drive the agent's
next decision.
"""

from __future__ import annotations

import numpy as np

from .candidates import iou
from .quality import assess_region
from .registration import map_rect


def compare_observations(prev_bgr: np.ndarray, prev_candidates: list[dict], new_bgr: np.ndarray,
                         new_detection: dict, registration: dict, new_glare: np.ndarray) -> dict:
    H_new_to_prev = registration.get("_H")
    usable = registration["status"] in ("REGISTERED", "WEAK") and H_new_to_prev is not None
    if not usable:
        return {
            "registration_status": registration["status"],
            "comparable": False,
            "reason": "Observations could not be registered reliably; region-level comparison withheld.",
            "per_candidate": [],
        }
    H_prev_to_new = np.linalg.inv(H_new_to_prev)
    nh, nw = new_bgr.shape[:2]
    out = []
    new_cands = new_detection["candidates"]
    for c in prev_candidates:
        mapped = map_rect(H_prev_to_new, c["bbox"])
        x, y, w, h = mapped
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(nw, x + w), min(nh, y + h)
        if x1 - x0 < 4 or y1 - y0 < 4:
            out.append({"candidate_id": c["id"], "type": c["type"], "outcome": "OUT_OF_VIEW",
                        "mapped_bbox": mapped, "detail": "Region is outside the new observation."})
            continue
        rect = [x0, y0, x1 - x0, y1 - y0]
        eq_new = assess_region(new_bgr, tuple(rect), glare_mask=new_glare)
        eq_prev = c.get("evidence_quality", {})
        matches = [(iou(rect, n["bbox"]), n) for n in new_cands if n["type"] == c["type"]]
        matches = [m for m in matches if m[0] > 0.1]
        best = max(matches, key=lambda m: m[0]) if matches else None
        if not eq_new["sufficient"]:
            outcome = "STILL_INCONCLUSIVE"
            detail = "Local evidence quality is still insufficient in the new observation."
        elif best is not None:
            outcome = "PERSISTED"
            detail = f"Re-detected as {best[1]['id']} (IoU {best[0]:.2f}) with sufficient local quality."
        else:
            outcome = "NOT_REPRODUCED"
            detail = "Not re-detected in the new observation despite sufficient local quality."
        out.append({
            "candidate_id": c["id"],
            "type": c["type"],
            "outcome": outcome,
            "detail": detail,
            "mapped_bbox": rect,
            "matched_new_candidate": None if best is None else best[1]["id"],
            "match_iou": None if best is None else round(best[0], 3),
            "glare_before": eq_prev.get("glare_fraction"),
            "glare_after": eq_new["glare_fraction"],
            "blur_before": eq_prev.get("blur_metric"),
            "blur_after": eq_new["blur_metric"],
            "evidence_score_before": c.get("evidence_score"),
            "evidence_score_after": None if best is None else best[1]["evidence_score"],
            "evidence_quality_after": eq_new,
        })
    return {
        "registration_status": registration["status"],
        "comparable": True,
        "per_candidate": out,
        "new_candidates_unmatched": [n["id"] for n in new_cands
                                     if all(o.get("matched_new_candidate") != n["id"] for o in out)],
    }

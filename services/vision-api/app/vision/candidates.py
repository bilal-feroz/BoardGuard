"""Pipeline B - suspicious visual candidate localisation.

Two candidate classes are localised. Both are *suspected visual anomalies*;
neither proves a fault.

suspected_corrosion
    Per-pixel colour cues for the three common appearances of corrosion on
    PCBs (blue-green copper salts, whitish crust, brown staining) gated by a
    texture cue: corrosion deposits are granular and isotropic, while traces,
    pads and component edges are smooth or strongly oriented. Texture is a
    band-pass (difference of Gaussians) energy combined with structure-tensor
    coherence. Components of the gated map become candidates.

suspected_solder_bridge
    Bright low-chroma (metallic) blobs are segmented, elongated blobs are
    grouped into lead rows by orientation and position, the row pitch and lead
    width are estimated, and two anomalies are flagged inside a row: a
    metallic blob spanning more than one lead position (merged leads), and an
    inter-lead gap that is anomalously bright compared with the row's other
    gaps (robust z-score).

Each candidate carries the measurements that produced it, a heuristic
`evidence_score` (NOT a calibrated probability) and the local evidence quality
used by the agent to decide whether the observation is good enough.
"""

from __future__ import annotations

import math

import cv2
import numpy as np

from .quality import assess_region, specular_mask

PARAMS = {
    "dog_sigma_fine": 1.0,
    "dog_sigma_coarse": 3.0,
    "texture_window": 15,
    "texture_lo": 3.0,  # DoG local RMS where texture cue starts
    "texture_hi": 9.0,  # ... and saturates
    "coherence_max": 0.55,  # above: oriented structure (edge/trace), not crust
    "corrosion_threshold": 0.42,
    "corrosion_min_area_frac": 0.0012,
    "corrosion_max_candidates": 8,
    "metal_chroma_max": 30.0,
    "metal_l_local_delta": 18.0,
    "metal_l_abs": 175.0,
    "lead_min_elongation": 1.7,
    "row_min_leads": 4,
    "merge_width_ratio": 1.65,
    "gap_z_threshold": 3.5,
}


def _smoothstep(x: np.ndarray, lo: float, hi: float) -> np.ndarray:
    t = np.clip((x - lo) / (hi - lo), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _texture_maps(gray: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    g = gray.astype(np.float32)
    dog = cv2.GaussianBlur(g, (0, 0), PARAMS["dog_sigma_fine"]) - cv2.GaussianBlur(g, (0, 0), PARAMS["dog_sigma_coarse"])
    k = PARAMS["texture_window"]
    energy = np.sqrt(cv2.blur(dog * dog, (k, k)))
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    jxx = cv2.blur(gx * gx, (k, k))
    jyy = cv2.blur(gy * gy, (k, k))
    jxy = cv2.blur(gx * gy, (k, k))
    tr = jxx + jyy
    det_term = np.sqrt((jxx - jyy) ** 2 + 4 * jxy * jxy)
    coherence = det_term / (tr + 1e-3)
    return energy, coherence


def _corrosion_color_cues(bgr: np.ndarray) -> dict[str, np.ndarray]:
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    L, a, b = lab[:, :, 0], lab[:, :, 1] - 128.0, lab[:, :, 2] - 128.0
    # Blue-green copper salts (verdigris / copper chloride): cyan-teal hue,
    # cooler than typical green solder mask (b* low or negative).
    hue_teal = np.exp(-((h - 90.0) ** 2) / (2 * 11.0 ** 2))
    verdigris = hue_teal * _smoothstep(s, 35, 90) * _smoothstep(v, 70, 130) * _smoothstep(-b, -6, 8)
    # Whitish / pale crust: low chroma, mid-high lightness (not specular).
    chroma = np.sqrt(a * a + b * b)
    crust = _smoothstep(L, 140, 185) * (1.0 - _smoothstep(chroma, 10, 24)) * (1.0 - _smoothstep(v, 238, 252))
    # Brown/rust staining: warm, moderately saturated, mid-dark.
    hue_brown = np.exp(-((h - 14.0) ** 2) / (2 * 6.0 ** 2))
    stain = hue_brown * _smoothstep(s, 70, 130) * _smoothstep(v, 45, 80) * (1.0 - _smoothstep(v, 150, 200))
    return {"verdigris": verdigris, "crust": crust, "stain": stain}


def detect_corrosion(bgr: np.ndarray, glare: np.ndarray, gray: np.ndarray) -> tuple[list[dict], np.ndarray]:
    H, W = gray.shape
    energy, coherence = _texture_maps(gray)
    texture = _smoothstep(energy, PARAMS["texture_lo"], PARAMS["texture_hi"]) * (1.0 - _smoothstep(coherence, 0.35, PARAMS["coherence_max"] + 0.2))
    cues = _corrosion_color_cues(bgr)
    color = np.maximum(np.maximum(cues["verdigris"], cues["crust"]), cues["stain"])
    score = color * (0.15 + 0.85 * texture)
    score[glare > 0] = 0.0
    score = cv2.GaussianBlur(score, (0, 0), 2.0)
    mask = (score >= PARAMS["corrosion_threshold"]).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))

    min_area = max(120, int(PARAMS["corrosion_min_area_frac"] * H * W))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    out = []
    for i in range(1, n):
        x, y, w, h, area = (int(v) for v in stats[i])
        if area < min_area:
            continue
        comp = (labels[y:y + h, x:x + w] == i).astype(np.uint8)
        contours, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cnt = max(contours, key=cv2.contourArea) + np.array([[x, y]])
        hull_area = max(1.0, cv2.contourArea(cv2.convexHull(cnt)))
        perim = cv2.arcLength(cnt, True)
        sel = labels == i
        cue_means = {k: float(c[sel].mean()) for k, c in cues.items()}
        dominant = max(cue_means, key=cue_means.get)
        tex = float(texture[sel].mean())
        col = float(color[sel].mean())
        coh = float(coherence[sel].mean())
        solidity = float(area / hull_area)
        irregularity = float(perim * perim / (4 * math.pi * area))
        evidence = float(np.clip(0.45 * col + 0.4 * tex + 0.15 * min(1.0, (irregularity - 1) / 4), 0, 1))
        eps = 0.01 * perim
        poly = cv2.approxPolyDP(cnt, eps, True).reshape(-1, 2).tolist()
        out.append({
            "type": "suspected_corrosion",
            "bbox": [x, y, w, h],
            "polygon": poly,
            "area_px": area,
            "area_fraction": round(area / (H * W), 5),
            "evidence_score": round(evidence, 3),
            "features": {
                "dominant_appearance": {"verdigris": "blue-green deposit", "crust": "pale crust", "stain": "brown staining"}[dominant],
                "colour_cue": round(col, 3),
                "texture_cue": round(tex, 3),
                "mean_dog_energy": round(float(energy[sel].mean()), 2),
                "structure_coherence": round(coh, 3),
                "solidity": round(solidity, 3),
                "boundary_irregularity": round(irregularity, 2),
                **{f"cue_{k}": round(v, 3) for k, v in cue_means.items()},
            },
        })
    out.sort(key=lambda c: c["evidence_score"] * math.sqrt(c["area_px"]), reverse=True)
    return out[: PARAMS["corrosion_max_candidates"]], mask


def metallic_mask(bgr: np.ndarray, glare: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    L = lab[:, :, 0]
    chroma = np.sqrt((lab[:, :, 1] - 128) ** 2 + (lab[:, :, 2] - 128) ** 2)
    k = max(31, (min(bgr.shape[:2]) // 12) | 1)
    local = cv2.blur(L, (k, k))
    metal = (chroma <= PARAMS["metal_chroma_max"]) & (((L - local) >= PARAMS["metal_l_local_delta"]) | (L >= PARAMS["metal_l_abs"]))
    m = (metal | (glare > 0)).astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    return m


def _component_geometry(cnt: np.ndarray) -> dict:
    (cx, cy), (rw, rh), ang = cv2.minAreaRect(cnt)
    if rw < rh:
        length, width, long_angle = rh, rw, ang + 90.0
    else:
        length, width, long_angle = rw, rh, ang
    return {"cx": cx, "cy": cy, "length": length, "width": width, "angle": long_angle % 180.0}


def _poly_mask(shape, cnt: np.ndarray) -> np.ndarray:
    m = np.zeros(shape[:2], np.uint8)
    cv2.fillPoly(m, [cnt.astype(np.int32)], 255)
    return m


def _extent(pts: np.ndarray, axis: np.ndarray) -> tuple[float, float]:
    p = pts @ axis
    return float(p.min()), float(p.max())


def detect_solder_bridges(bgr: np.ndarray, glare: np.ndarray, gray: np.ndarray) -> tuple[list[dict], np.ndarray, list[dict]]:
    H, W = gray.shape
    metal = metallic_mask(bgr, glare)
    contours, _ = cv2.findContours(metal, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    comps = []
    max_area = 0.03 * H * W
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < 12 or area > max_area:
            continue
        g = _component_geometry(cnt)
        g.update({"area": float(area), "cnt": cnt.reshape(-1, 2).astype(np.float32)})
        comps.append(g)

    leads = [c for c in comps if c["width"] >= 2 and c["length"] / max(c["width"], 1e-3) >= PARAMS["lead_min_elongation"]]
    rows: list[dict] = []
    used = set()
    # Group leads by orientation (15 degree bins with overlap handled by sorting).
    leads.sort(key=lambda c: c["angle"])
    for i, seed in enumerate(leads):
        if i in used:
            continue
        theta = math.radians(seed["angle"])
        u = np.array([math.cos(theta), math.sin(theta)])  # along lead length
        v = np.array([-u[1], u[0]])  # along the row
        members = [
            j for j, c in enumerate(leads)
            if j not in used
            and min(abs(c["angle"] - seed["angle"]), 180 - abs(c["angle"] - seed["angle"])) <= 12
            and 0.45 <= c["area"] / seed["area"] <= 2.2
            and abs((c["cx"] - seed["cx"]) * u[0] + (c["cy"] - seed["cy"]) * u[1]) <= 0.45 * seed["length"]
        ]
        if len(members) < PARAMS["row_min_leads"]:
            continue
        pos = sorted(((leads[j]["cx"] * v[0] + leads[j]["cy"] * v[1]), j) for j in members)
        # Split where spacing jumps (separate rows sharing an axis).
        diffs = np.diff([p for p, _ in pos])
        if len(diffs) == 0:
            continue
        med = float(np.median(diffs))
        segments, cur = [], [pos[0]]
        for d, item in zip(diffs, pos[1:]):
            if d > 4.5 * med:
                segments.append(cur)
                cur = []
            cur.append(item)
        segments.append(cur)
        for seg in segments:
            if len(seg) < PARAMS["row_min_leads"]:
                continue
            idx = [j for _, j in seg]
            used.update(idx)
            widths = [(_extent(leads[j]["cnt"], v)[1] - _extent(leads[j]["cnt"], v)[0]) for j in idx]
            ps = [p for p, _ in seg]
            steps = np.diff(ps)
            pitch = float(np.median(steps))
            regular = steps[steps <= 1.3 * pitch]
            # Real IC lead rows have a regular pitch; reject irregular groupings (e.g. passive end caps).
            if len(regular) < PARAMS["row_min_leads"] - 1 or float(np.std(regular)) > 0.12 * pitch:
                continue
            rows.append({
                "u": u, "v": v,
                "u_center": float(np.median([leads[j]["cx"] * u[0] + leads[j]["cy"] * u[1] for j in idx])),
                "v_min": ps[0] - pitch, "v_max": ps[-1] + pitch,
                "lead_length": float(np.median([leads[j]["length"] for j in idx])),
                "lead_width": float(np.median(widths)),
                "pitch": pitch,
                "positions": ps,
                "lead_grey": float(np.median([cv2.mean(gray, mask=_poly_mask(gray.shape, leads[j]["cnt"]))[0] for j in idx])),
                "angle": float(np.median([leads[j]["angle"] for j in idx])),
                "count": len(idx),
            })

    candidates = []
    row_summaries = []
    for r_i, row in enumerate(rows):
        u, v = row["u"], row["v"]
        row_summaries.append({
            "row": r_i, "lead_count": row["count"], "pitch_px": round(row["pitch"], 2),
            "lead_width_px": round(row["lead_width"], 2), "lead_length_px": round(row["lead_length"], 2),
            "angle_deg": round(row["angle"], 1),
        })
        # (a) merged leads: a metallic blob inside the row band that spans > 1 lead position.
        for c in comps:
            cu = c["cx"] * u[0] + c["cy"] * u[1]
            cvv = c["cx"] * v[0] + c["cy"] * v[1]
            if abs(cu - row["u_center"]) > 0.5 * row["lead_length"] or not (row["v_min"] <= cvv <= row["v_max"]):
                continue
            lo, hi = _extent(c["cnt"], v)
            span = hi - lo
            ratio = span / max(row["lead_width"], 1e-3)
            ulo, uhi = _extent(c["cnt"], u)
            if ratio >= PARAMS["merge_width_ratio"] and span >= row["pitch"] * 0.95 and (uhi - ulo) >= 0.35 * row["lead_length"]:
                x, y, w, h = cv2.boundingRect(c["cnt"].astype(np.int32))
                candidates.append(_bridge_candidate(x, y, w, h, r_i, row, {
                    "mechanism": "merged_leads",
                    "span_along_row_px": round(span, 2),
                    "span_to_lead_width_ratio": round(ratio, 2),
                    "spanned_lead_positions": round(span / row["pitch"] + 0.0, 2),
                }, evidence=min(1.0, 0.45 + 0.18 * (ratio - PARAMS["merge_width_ratio"]))))
        # (b) anomalously bright inter-lead gap (thin bridge below the mask threshold).
        ps = row["positions"]
        gaps = []
        half_len = 0.3 * row["lead_length"]
        for k in range(len(ps) - 1):
            if ps[k + 1] - ps[k] > 1.6 * row["pitch"]:
                continue
            mid_v = 0.5 * (ps[k] + ps[k + 1])
            gap_w = max(1.0, (ps[k + 1] - ps[k]) - row["lead_width"])
            center = row["u_center"] * u + mid_v * v
            box = cv2.boxPoints(((float(center[0]), float(center[1])), (float(2 * half_len), float(max(1.0, 0.7 * gap_w))), float(row["angle"])))
            poly = box.astype(np.int32)
            m = np.zeros(gray.shape, np.uint8)
            cv2.fillConvexPoly(m, poly, 255)
            if np.count_nonzero(m) < 4:
                continue
            gaps.append((k, float(cv2.mean(gray, mask=m)[0]), poly))
        if len(gaps) >= 4:
            vals = np.array([g[1] for g in gaps])
            med = float(np.median(vals))
            mad = float(np.median(np.abs(vals - med))) * 1.4826 + 2.0
            lead_grey = row["lead_grey"]
            for k, val, poly in gaps:
                z = (val - med) / mad
                # A bridge is solder: the gap must approach lead brightness, not merely be brighter than other gaps.
                metal_like = (val - med) / max(1.0, lead_grey - med)
                if z >= PARAMS["gap_z_threshold"] and metal_like >= 0.4:
                    x, y, w, h = cv2.boundingRect(poly)
                    candidates.append(_bridge_candidate(x, y, w, h, r_i, row, {
                        "mechanism": "bright_gap",
                        "gap_index": k,
                        "gap_mean_grey": round(val, 1),
                        "row_median_gap_grey": round(med, 1),
                        "robust_z": round(float(z), 2),
                        "brightness_vs_leads": round(float(metal_like), 2),
                    }, evidence=min(1.0, 0.35 + 0.05 * (z - PARAMS["gap_z_threshold"]))))
    # De-duplicate overlapping bridge candidates (keep the stronger).
    candidates.sort(key=lambda c: c["evidence_score"], reverse=True)
    kept: list[dict] = []
    for c in candidates:
        if all(_iou(c["bbox"], k["bbox"]) < 0.3 for k in kept):
            kept.append(c)
    return kept, metal, row_summaries


def _bridge_candidate(x, y, w, h, r_i, row, feats, evidence) -> dict:
    pad = int(round(row["lead_width"]))
    return {
        "type": "suspected_solder_bridge",
        "bbox": [int(x - pad), int(y - pad), int(w + 2 * pad), int(h + 2 * pad)],
        "polygon": [[int(x), int(y)], [int(x + w), int(y)], [int(x + w), int(y + h)], [int(x), int(y + h)]],
        "area_px": int(w * h),
        "evidence_score": round(float(evidence), 3),
        "features": {"row": r_i, "row_pitch_px": round(row["pitch"], 2), "row_lead_width_px": round(row["lead_width"], 2), **feats},
    }


def _iou(a, b) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ix = max(0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0, min(ay + ah, by + bh) - max(ay, by))
    inter = ix * iy
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def iou(a, b) -> float:
    return _iou(a, b)


def detect_visual_candidates(bgr: np.ndarray, roi: tuple[int, int, int, int] | None = None, glare: np.ndarray | None = None) -> dict:
    """Run both detectors. If `roi` is given only that region is analysed (coordinates stay global)."""
    H, W = bgr.shape[:2]
    if glare is None:
        glare = specular_mask(bgr)
    ox, oy = 0, 0
    view, gview = bgr, glare
    if roi is not None:
        x, y, w, h = roi
        ox, oy = max(0, x), max(0, y)
        view = bgr[oy:min(H, y + h), ox:min(W, x + w)]
        gview = glare[oy:min(H, y + h), ox:min(W, x + w)]
    gray = cv2.cvtColor(view, cv2.COLOR_BGR2GRAY)
    corrosion, corr_mask = detect_corrosion(view, gview, gray)
    bridges, metal_mask, rows = detect_solder_bridges(view, gview, gray)
    cands = corrosion + bridges
    for c in cands:
        c["bbox"][0] += ox
        c["bbox"][1] += oy
        c["polygon"] = [[px + ox, py + oy] for px, py in c["polygon"]]
        bx, by, bw, bh = c["bbox"]
        bx, by = max(0, bx), max(0, by)
        bw, bh = min(W - bx, bw), min(H - by, bh)
        c["bbox"] = [bx, by, bw, bh]
        c["evidence_quality"] = assess_region(bgr, (bx, by, bw, bh), glare_mask=glare)
    cands.sort(key=lambda c: (c["type"] != "suspected_solder_bridge", -c["evidence_score"]))
    for i, c in enumerate(cands):
        c["id"] = f"C{i + 1:02d}"
    return {
        "candidates": cands,
        "lead_rows": rows,
        "params": {k: v for k, v in PARAMS.items()},
        "roi": list(roi) if roi is not None else None,
        "_corrosion_mask": corr_mask,
        "_metal_mask": metal_mask,
        "_offset": (ox, oy),
    }

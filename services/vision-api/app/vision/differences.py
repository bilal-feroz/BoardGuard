"""Pipeline D - change detection between registered observations.

Given a reference image and a moving image already warped into the reference
frame, compute a change map that is robust to residual misalignment and
global illumination differences:

1. photometric normalisation of the moving image to the reference (per-channel
   mean/std matching in Lab, computed on the valid overlap only);
2. a shift-tolerant colour difference: the per-pixel minimum Lab distance over
   +/-2 px translations, so 1-2 px registration jitter along edges does not
   register as change;
3. a structural term, 1 - SSIM, computed with Gaussian windows;
4. the two terms are combined, thresholded (Otsu, with an absolute floor) and
   cleaned morphologically; connected components become change regions.

Changed pixels are *visual* differences. They do not establish that a repair
succeeded electrically.
"""

from __future__ import annotations

import cv2
import numpy as np

PARAMS = {
    "shift_tolerance_px": 2,
    "colour_scale": 40.0,  # Lab distance mapped to 1.0
    "ssim_sigma": 1.5,
    "abs_floor": 0.28,
    "min_region_frac": 0.00015,
    "max_regions": 12,
}


def _normalise(mov_lab: np.ndarray, ref_lab: np.ndarray, valid: np.ndarray) -> np.ndarray:
    out = mov_lab.copy()
    m = valid > 0
    if np.count_nonzero(m) < 100:
        return out
    for c in range(3):
        r = ref_lab[:, :, c][m]
        v = mov_lab[:, :, c][m]
        rs, vs = float(r.std()), float(v.std())
        gain = rs / vs if vs > 1e-3 else 1.0
        gain = float(np.clip(gain, 0.5, 2.0))
        out[:, :, c] = (mov_lab[:, :, c] - float(v.mean())) * gain + float(r.mean())
    return out


def _ssim_map(a: np.ndarray, b: np.ndarray, sigma: float) -> np.ndarray:
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    mu_a = cv2.GaussianBlur(a, (0, 0), sigma)
    mu_b = cv2.GaussianBlur(b, (0, 0), sigma)
    s_aa = cv2.GaussianBlur(a * a, (0, 0), sigma) - mu_a * mu_a
    s_bb = cv2.GaussianBlur(b * b, (0, 0), sigma) - mu_b * mu_b
    s_ab = cv2.GaussianBlur(a * b, (0, 0), sigma) - mu_a * mu_b
    num = (2 * mu_a * mu_b + c1) * (2 * s_ab + c2)
    den = (mu_a * mu_a + mu_b * mu_b + c1) * (s_aa + s_bb + c2)
    return num / den


def compute_change_map(ref_bgr: np.ndarray, warped_bgr: np.ndarray, valid: np.ndarray) -> dict:
    H, W = ref_bgr.shape[:2]
    ref_lab = cv2.cvtColor(ref_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    mov_lab = cv2.cvtColor(warped_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    mov_lab = _normalise(mov_lab, ref_lab, valid)

    t = PARAMS["shift_tolerance_px"]
    ref_s = cv2.GaussianBlur(ref_lab, (0, 0), 1.0)
    mov_s = cv2.GaussianBlur(mov_lab, (0, 0), 1.0)
    best = np.full((H, W), np.inf, np.float32)
    padded = cv2.copyMakeBorder(mov_s, t, t, t, t, cv2.BORDER_REPLICATE)
    for dy in range(-t, t + 1):
        for dx in range(-t, t + 1):
            shifted = padded[t + dy:t + dy + H, t + dx:t + dx + W]
            d = np.sqrt(np.sum((ref_s - shifted) ** 2, axis=2))
            np.minimum(best, d, out=best)
    colour = np.clip(best / PARAMS["colour_scale"], 0, 1)

    ssim = _ssim_map(ref_lab[:, :, 0], mov_lab[:, :, 0], PARAMS["ssim_sigma"])
    structural = np.clip(1.0 - ssim, 0, 1)
    structural = cv2.erode(structural, np.ones((2 * t + 1, 2 * t + 1), np.uint8))  # same tolerance idea

    change = np.maximum(colour, 0.85 * structural)
    change = cv2.GaussianBlur(change, (0, 0), 2.0)
    change[valid == 0] = 0

    vals = (change[valid > 0] * 255).astype(np.uint8)
    otsu = float(cv2.threshold(vals, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[0]) / 255 if vals.size else 1.0
    thr = max(PARAMS["abs_floor"], otsu)
    mask = ((change >= thr) & (valid > 0)).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))

    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    min_area = max(40, int(PARAMS["min_region_frac"] * H * W))
    regions = []
    for i in range(1, n):
        x, y, w, h, area = (int(v) for v in stats[i])
        if area < min_area:
            continue
        sel = labels == i
        regions.append({
            "bbox": [x, y, w, h],
            "area_px": area,
            "mean_change": round(float(change[sel].mean()), 3),
            "mean_colour_delta_lab": round(float(best[sel].mean()), 2),
            "mean_structural_change": round(float(structural[sel].mean()), 3),
        })
    regions.sort(key=lambda r: r["area_px"] * r["mean_change"], reverse=True)
    regions = regions[: PARAMS["max_regions"]]
    for i, r in enumerate(regions):
        r["id"] = f"D{i + 1:02d}"
    valid_px = int(np.count_nonzero(valid))
    return {
        "threshold": round(thr, 3),
        "otsu_threshold": round(otsu, 3),
        "valid_overlap_fraction": round(valid_px / float(H * W), 4),
        "changed_fraction": round(float(np.count_nonzero(mask)) / max(1, valid_px), 4),
        "regions": regions,
        "params": PARAMS,
        "_change": change,
        "_mask": mask,
    }


def candidate_change_overlap(change_mask: np.ndarray, bbox: list[int]) -> float:
    x, y, w, h = bbox
    sub = change_mask[max(0, y):y + h, max(0, x):x + w]
    return float(np.count_nonzero(sub)) / max(1, sub.size)


def render_heatmap(change: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Restrained single-hue (amber) BGRA heatmap; transparent where unchanged or invalid."""
    a = np.clip(change, 0, 1)
    alpha = (np.clip((a - 0.12) / 0.6, 0, 1) * 220).astype(np.uint8)
    alpha[valid == 0] = 0
    out = np.zeros((*change.shape, 4), np.uint8)
    out[:, :, 0] = (60 + 44 * a).astype(np.uint8)
    out[:, :, 1] = (150 + 20 * a).astype(np.uint8)
    out[:, :, 2] = 216
    out[:, :, 3] = alpha
    return out

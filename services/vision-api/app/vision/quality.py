"""Pipeline A - capture quality assessment.

Measures focus, exposure, specular glare and contrast with OpenCV and turns
them into an ACCEPT / MARGINAL / REJECT verdict with explicit reason codes.

Focus is measured three ways because no single measure is reliable on PCB
imagery:
  * variance of the Laplacian (classic, but scales with scene content),
  * Tenengrad (mean squared Sobel gradient magnitude),
  * the Crete-Roffet no-reference blur metric (Crete et al., SPIE 2007),
    which compares the image with a re-blurred copy and is far less
    content-dependent. The verdict uses the Crete metric; the other two are
    reported for transparency.

All thresholds live in THRESHOLDS so they can be documented and evaluated.
They were calibrated on the BoardGuard fixture set and controlled
degradations of it (see docs/evaluation); they are not universal.
"""

from __future__ import annotations

import cv2
import numpy as np

THRESHOLDS = {
    "min_short_side_px": 320,
    "blur_reject": 0.52,  # Crete metric, 0 = sharp, 1 = fully blurred
    "blur_marginal": 0.44,
    "median_dark_reject": 30,  # median grey level
    "clipped_dark_reject": 0.40,
    "clipped_bright_reject": 0.18,
    "clipped_bright_marginal": 0.07,
    "glare_marginal": 0.035,  # fraction of frame that is specular highlight
    "glare_reject": 0.12,
    "glare_hotspot_marginal": 0.010,  # largest connected highlight (ring-light hotspot)
    "rms_contrast_marginal": 0.07,
    "tile_px": 128,
    "tile_flat_std": 7.0,  # tiles flatter than this are not judged for focus
    "tile_glare_unusable": 0.22,
    "tile_blur_unusable": 0.55,
    "roi_glare_insufficient": 0.10,  # region-level glare that blocks a decision
    "roi_blur_insufficient": 0.50,
}


def crete_blur(gray: np.ndarray) -> float:
    """Crete-Roffet perceptual blur estimate in [0, 1]."""
    f = gray.astype(np.float32)
    if f.shape[0] < 12 or f.shape[1] < 12:
        return 1.0
    b_ver = cv2.blur(f, (1, 9))
    b_hor = cv2.blur(f, (9, 1))
    d_f_ver = np.abs(np.diff(f, axis=0))
    d_f_hor = np.abs(np.diff(f, axis=1))
    d_b_ver = np.abs(np.diff(b_ver, axis=0))
    d_b_hor = np.abs(np.diff(b_hor, axis=1))
    v_ver = np.maximum(0.0, d_f_ver - d_b_ver)
    v_hor = np.maximum(0.0, d_f_hor - d_b_hor)
    s_d_ver = float(d_f_ver[1:-1, 1:-1].sum())
    s_d_hor = float(d_f_hor[1:-1, 1:-1].sum())
    if s_d_ver < 1e-6 or s_d_hor < 1e-6:
        return 1.0
    s_v_ver = float(v_ver[1:-1, 1:-1].sum())
    s_v_hor = float(v_hor[1:-1, 1:-1].sum())
    return max((s_d_ver - s_v_ver) / s_d_ver, (s_d_hor - s_v_hor) / s_d_hor)


def specular_mask(bgr: np.ndarray) -> np.ndarray:
    """Specular highlight mask: near-white, desaturated and brighter than surroundings."""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    s = hsv[:, :, 1].astype(np.int16)
    v = hsv[:, :, 2].astype(np.int16)
    k = max(15, (min(bgr.shape[:2]) // 24) | 1)
    local = cv2.blur(v.astype(np.float32), (k, k)).astype(np.int16)
    hard = (v >= 245) & (s <= 70)
    soft = (v >= 222) & (s <= 45) & ((v - local) >= 32)
    mask = (hard | soft).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    return mask


def _measure(bgr: np.ndarray) -> dict:
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    lap = cv2.Laplacian(gray, cv2.CV_64F, ksize=3)
    gx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
    hist = cv2.calcHist([gray], [0], None, [256], [0, 256]).ravel()
    total = float(hist.sum())
    cdf = np.cumsum(hist) / total
    glare = specular_mask(bgr)
    n, _, stats, cents = cv2.connectedComponentsWithStats(glare, connectivity=8)
    if n > 1:
        k = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        largest, centre = float(stats[k, cv2.CC_STAT_AREA]) / glare.size, (float(cents[k][0]), float(cents[k][1]))
    else:
        largest, centre = 0.0, None
    return {
        "largest_glare_blob_fraction": largest,
        "_glare_centre": centre,
        "gray": gray,
        "glare_mask": glare,
        "laplacian_variance": float(lap.var()),
        "tenengrad": float(np.mean(gx * gx + gy * gy)),
        "blur_metric": float(crete_blur(gray)),
        "mean_luminance": float(gray.mean()),
        "median_luminance": float(np.searchsorted(cdf, 0.5)),
        "p01": float(np.searchsorted(cdf, 0.01)),
        "p99": float(np.searchsorted(cdf, 0.99)),
        "clipped_dark_fraction": float(hist[:6].sum() / total),
        "clipped_bright_fraction": float(hist[250:].sum() / total),
        "glare_fraction": float(np.count_nonzero(glare) / glare.size),
        "rms_contrast": float(gray.std() / 255.0),
    }


def _tiles(bgr: np.ndarray, gray: np.ndarray, glare: np.ndarray) -> list[dict]:
    t = THRESHOLDS["tile_px"]
    h, w = gray.shape
    rows, cols = max(1, round(h / t)), max(1, round(w / t))
    ys = np.linspace(0, h, rows + 1).astype(int)
    xs = np.linspace(0, w, cols + 1).astype(int)
    tiles = []
    for r in range(rows):
        for c in range(cols):
            y0, y1, x0, x1 = ys[r], ys[r + 1], xs[c], xs[c + 1]
            g = gray[y0:y1, x0:x1]
            std = float(g.std())
            glare_frac = float(np.count_nonzero(glare[y0:y1, x0:x1]) / g.size)
            flat = std < THRESHOLDS["tile_flat_std"]
            blur = None if flat else float(crete_blur(g))
            reasons = []
            if glare_frac >= THRESHOLDS["tile_glare_unusable"]:
                reasons.append("GLARE")
            if blur is not None and blur >= THRESHOLDS["tile_blur_unusable"]:
                reasons.append("BLUR")
            m = float(g.mean())
            if m < 18:
                reasons.append("UNDEREXPOSED")
            elif m > 242:
                reasons.append("OVEREXPOSED")
            tiles.append({
                "x": int(x0), "y": int(y0), "w": int(x1 - x0), "h": int(y1 - y0),
                "std": round(std, 2), "blur_metric": None if blur is None else round(blur, 3),
                "glare_fraction": round(glare_frac, 4), "flat": flat,
                "usable": not reasons, "reasons": reasons,
            })
    return tiles


def assess_image_quality(bgr: np.ndarray, roi: tuple[int, int, int, int] | None = None) -> dict:
    """Assess a capture. `roi` = (x, y, w, h) adds a region-level evidence check."""
    h, w = bgr.shape[:2]
    m = _measure(bgr)
    th = THRESHOLDS
    reasons: list[dict] = []

    def add(code: str, severity: str, detail: str):
        reasons.append({"code": code, "severity": severity, "detail": detail})

    if min(h, w) < th["min_short_side_px"]:
        add("TOO_SMALL", "reject", f"Short side {min(h, w)}px < {th['min_short_side_px']}px.")
    if m["blur_metric"] >= th["blur_reject"]:
        add("BLUR", "reject", f"Blur metric {m['blur_metric']:.2f} >= {th['blur_reject']} (image out of focus).")
    elif m["blur_metric"] >= th["blur_marginal"]:
        add("BLUR", "marginal", f"Blur metric {m['blur_metric']:.2f} >= {th['blur_marginal']} (soft focus).")
    if m["median_luminance"] < th["median_dark_reject"] or m["clipped_dark_fraction"] > th["clipped_dark_reject"]:
        add("UNDEREXPOSED", "reject", f"Median grey {m['median_luminance']:.0f}, {m['clipped_dark_fraction']:.0%} of pixels clipped dark.")
    if m["clipped_bright_fraction"] > th["clipped_bright_reject"]:
        add("OVEREXPOSED", "reject", f"{m['clipped_bright_fraction']:.0%} of pixels clipped bright.")
    elif m["clipped_bright_fraction"] > th["clipped_bright_marginal"]:
        add("OVEREXPOSED", "marginal", f"{m['clipped_bright_fraction']:.0%} of pixels clipped bright.")
    if m["glare_fraction"] > th["glare_reject"]:
        add("GLARE", "reject", f"Specular glare covers {m['glare_fraction']:.1%} of the frame.")
    elif m["glare_fraction"] > th["glare_marginal"]:
        add("GLARE", "marginal", f"Specular glare covers {m['glare_fraction']:.1%} of the frame.")
    elif m["largest_glare_blob_fraction"] > th["glare_hotspot_marginal"]:
        cx, cy = m["_glare_centre"]
        add("GLARE", "marginal", f"Localised specular hotspot ({m['largest_glare_blob_fraction']:.1%} of frame) near x={cx:.0f}, y={cy:.0f}.")
    if m["rms_contrast"] < th["rms_contrast_marginal"]:
        add("LOW_CONTRAST", "marginal", f"RMS contrast {m['rms_contrast']:.3f} < {th['rms_contrast_marginal']}.")

    tiles = _tiles(bgr, m["gray"], m["glare_mask"])
    judged = [t for t in tiles if not t["flat"]]
    unusable = [t for t in tiles if not t["usable"]]

    if any(r["severity"] == "reject" for r in reasons):
        verdict = "REJECT"
    elif reasons:
        verdict = "MARGINAL"
    else:
        verdict = "ACCEPT"

    result = {
        "width": int(w),
        "height": int(h),
        "verdict": verdict,
        "reasons": reasons,
        "metrics": {k: round(v, 4) for k, v in m.items() if isinstance(v, float)},
        "tiles": {
            "grid_px": th["tile_px"],
            "count": len(tiles),
            "judged_for_focus": len(judged),
            "unusable_count": len(unusable),
            "unusable_fraction": round(len(unusable) / max(1, len(tiles)), 4),
            "unusable": [{k: t[k] for k in ("x", "y", "w", "h", "reasons")} for t in unusable],
        },
        "thresholds": th,
    }
    if roi is not None:
        result["roi"] = assess_region(bgr, roi, glare_mask=m["glare_mask"])
    result["_glare_mask"] = m["glare_mask"]  # stripped before serialisation
    return result


def assess_region(bgr: np.ndarray, roi: tuple[int, int, int, int], glare_mask: np.ndarray | None = None) -> dict:
    """Region-level evidence quality: is this crop good enough to support a visual decision?"""
    x, y, w, h = roi
    H, W = bgr.shape[:2]
    # Expand small regions so the blur metric has enough context.
    pad = max(8, int(0.25 * max(w, h)))
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1, y1 = min(W, x + w + pad), min(H, y + h + pad)
    crop = bgr[y0:y1, x0:x1]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    if glare_mask is None:
        glare_mask = specular_mask(bgr)
    core = glare_mask[y:y + h, x:x + w]
    glare_frac = float(np.count_nonzero(core) / max(1, core.size))
    ctx = glare_mask[y0:y1, x0:x1]
    glare_ctx = float(np.count_nonzero(ctx) / max(1, ctx.size))
    blur = float(crete_blur(gray)) if gray.std() >= THRESHOLDS["tile_flat_std"] else None
    issues = []
    if glare_frac >= THRESHOLDS["roi_glare_insufficient"]:
        issues.append({"code": "GLARE", "detail": f"{glare_frac:.0%} of the region is specular highlight."})
    if blur is not None and blur >= THRESHOLDS["roi_blur_insufficient"]:
        issues.append({"code": "BLUR", "detail": f"Region blur metric {blur:.2f}."})
    if gray.mean() < 25:
        issues.append({"code": "UNDEREXPOSED", "detail": f"Region mean grey {gray.mean():.0f}."})
    return {
        "rect": [int(x), int(y), int(w), int(h)],
        "glare_fraction": round(glare_frac, 4),
        "glare_fraction_context": round(glare_ctx, 4),
        "blur_metric": None if blur is None else round(blur, 4),
        "laplacian_variance": round(float(cv2.Laplacian(gray, cv2.CV_64F).var()), 2),
        "mean_luminance": round(float(gray.mean()), 2),
        "sufficient": not issues,
        "issues": issues,
    }


def public(result: dict) -> dict:
    """Drop private numpy payloads (keys starting with '_') for JSON output."""
    return {k: (public(v) if isinstance(v, dict) else v) for k, v in result.items() if not k.startswith("_")}

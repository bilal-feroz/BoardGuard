"""Pipeline C - geometric registration of two observations of the same region.

SIFT features (OpenCV 5 main module) with Lowe ratio test, ORB as a fallback
detector, and homography estimation with USAC MAGSAC++ (cv2.USAC_MAGSAC).
The result is graded REGISTERED / WEAK / FAILED from measured quantities only:
inlier count, inlier ratio, RMS reprojection error, spatial coverage of the
inliers and the plausibility of the recovered transform. A FAILED result
carries no transform the UI is allowed to use for overlays.
"""

from __future__ import annotations

import time

import cv2
import numpy as np

CRITERIA = {
    "work_side_px": 1100,
    "ratio_test": 0.75,
    "ransac_reproj_px": 4.0,
    "min_inliers": 25,
    "min_inlier_ratio": 0.25,
    "max_rms_px": 3.0,
    "min_coverage": 0.12,  # convex hull of inliers / image area
    "scale_range": (0.4, 2.5),
    "max_perspective": 0.0025,
    "weak_inliers": 60,
    "weak_inlier_ratio": 0.40,
    "weak_coverage": 0.25,
}


def _prep(bgr: np.ndarray) -> tuple[np.ndarray, float]:
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY) if bgr.ndim == 3 else bgr
    s = min(1.0, CRITERIA["work_side_px"] / max(gray.shape))
    if s < 1.0:
        gray = cv2.resize(gray, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    return gray, s


def _detect(gray: np.ndarray, method: str):
    if method == "SIFT":
        det = cv2.SIFT_create(nfeatures=4000, contrastThreshold=0.02)
    else:
        det = cv2.ORB_create(nfeatures=5000, scaleFactor=1.2, nlevels=8, fastThreshold=10)
    return det.detectAndCompute(gray, None)


def _match(d1, d2, method: str):
    if d1 is None or d2 is None or len(d1) < 2 or len(d2) < 2:
        return []
    if method == "SIFT":
        matcher = cv2.FlannBasedMatcher({"algorithm": 1, "trees": 5}, {"checks": 64})
    else:
        matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    pairs = matcher.knnMatch(d1, d2, k=2)
    good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < CRITERIA["ratio_test"] * n.distance]
    return good


def _plausibility(Hm: np.ndarray, w: int, h: int) -> list[str]:
    issues = []
    A = Hm[:2, :2] / Hm[2, 2]
    det = float(np.linalg.det(A))
    if det <= 0:
        issues.append("Transform flips the image (negative determinant).")
        return issues
    scale = float(np.sqrt(det))
    lo, hi = CRITERIA["scale_range"]
    if not lo <= scale <= hi:
        issues.append(f"Implied scale change {scale:.2f}x is outside {lo}-{hi}x.")
    persp = float(np.abs(Hm[2, :2] / Hm[2, 2]).max())
    if persp > CRITERIA["max_perspective"]:
        issues.append(f"Excessive perspective term {persp:.4f}.")
    corners = np.float32([[0, 0], [w, 0], [w, h], [0, h]]).reshape(-1, 1, 2)
    warped = cv2.perspectiveTransform(corners, Hm).reshape(-1, 2)
    if not cv2.isContourConvex(warped.astype(np.float32)):
        issues.append("Warped frame is not convex (degenerate homography).")
    return issues


def register_image_pair(ref_bgr: np.ndarray, mov_bgr: np.ndarray) -> dict:
    """Estimate H mapping `mov` pixel coordinates into `ref` pixel coordinates."""
    t0 = time.perf_counter()
    g_ref, s_ref = _prep(ref_bgr)
    g_mov, s_mov = _prep(mov_bgr)
    attempts = []
    best = None
    for method in ("SIFT", "ORB"):
        k1, d1 = _detect(g_ref, method)
        k2, d2 = _detect(g_mov, method)
        good = _match(d2, d1, method)  # query = moving, train = reference
        attempt = {"method": method, "keypoints_ref": len(k1), "keypoints_mov": len(k2), "ratio_matches": len(good)}
        attempts.append(attempt)
        if len(good) < 8:
            attempt["outcome"] = "too few matches"
            continue
        src = np.float32([k2[m.queryIdx].pt for m in good]).reshape(-1, 1, 2) / s_mov
        dst = np.float32([k1[m.trainIdx].pt for m in good]).reshape(-1, 1, 2) / s_ref
        Hm, inl = cv2.findHomography(src, dst, cv2.USAC_MAGSAC, CRITERIA["ransac_reproj_px"], maxIters=5000, confidence=0.999)
        if Hm is None or inl is None:
            attempt["outcome"] = "homography estimation failed"
            continue
        inl = inl.ravel().astype(bool)
        n_in = int(inl.sum())
        proj = cv2.perspectiveTransform(src[inl], Hm)
        err = np.linalg.norm(proj - dst[inl], axis=2).ravel()
        rms = float(np.sqrt(np.mean(err ** 2))) if n_in else float("inf")
        hull_area = float(cv2.contourArea(cv2.convexHull(dst[inl].astype(np.float32)))) if n_in >= 3 else 0.0
        coverage = hull_area / float(ref_bgr.shape[0] * ref_bgr.shape[1])
        attempt.update({
            "inliers": n_in, "inlier_ratio": round(n_in / len(good), 4),
            "rms_reprojection_px": round(rms, 3), "inlier_coverage": round(coverage, 4), "outcome": "estimated",
        })
        cand = {"H": Hm, "inliers": n_in, "ratio": n_in / len(good), "rms": rms, "coverage": coverage,
                "method": method, "matches": len(good), "inlier_pts": dst[inl].reshape(-1, 2)}
        if best is None or n_in > best["inliers"]:
            best = cand
        if n_in >= CRITERIA["weak_inliers"] and cand["ratio"] >= CRITERIA["weak_inlier_ratio"]:
            break  # SIFT was good enough; skip the ORB fallback

    h_ref, w_ref = ref_bgr.shape[:2]
    result = {
        "attempts": attempts,
        "criteria": {k: (list(v) if isinstance(v, tuple) else v) for k, v in CRITERIA.items()},
        "ref_size": [int(w_ref), int(h_ref)],
        "mov_size": [int(mov_bgr.shape[1]), int(mov_bgr.shape[0])],
    }
    reasons: list[str] = []
    if best is None:
        result.update({"status": "FAILED", "reasons": ["No geometric model could be estimated from feature matches."], "homography": None})
    else:
        if best["inliers"] < CRITERIA["min_inliers"]:
            reasons.append(f"Only {best['inliers']} inlier correspondences (< {CRITERIA['min_inliers']}).")
        if best["ratio"] < CRITERIA["min_inlier_ratio"]:
            reasons.append(f"Inlier ratio {best['ratio']:.0%} (< {CRITERIA['min_inlier_ratio']:.0%}).")
        if best["rms"] > CRITERIA["max_rms_px"]:
            reasons.append(f"RMS reprojection error {best['rms']:.2f}px (> {CRITERIA['max_rms_px']}px).")
        if best["coverage"] < CRITERIA["min_coverage"]:
            reasons.append(f"Inliers cover {best['coverage']:.0%} of the frame (< {CRITERIA['min_coverage']:.0%}); alignment is unconstrained elsewhere.")
        reasons += _plausibility(best["H"], mov_bgr.shape[1], mov_bgr.shape[0])
        if reasons:
            status = "FAILED"
        elif best["inliers"] < CRITERIA["weak_inliers"] or best["ratio"] < CRITERIA["weak_inlier_ratio"] or best["coverage"] < CRITERIA["weak_coverage"]:
            status = "WEAK"
            reasons.append("Registration usable with caution: inlier support is moderate.")
        else:
            status = "REGISTERED"
        result.update({
            "status": status,
            "reasons": reasons,
            "method": best["method"],
            "ratio_matches": best["matches"],
            "inliers": best["inliers"],
            "inlier_ratio": round(best["ratio"], 4),
            "rms_reprojection_px": round(best["rms"], 3),
            "inlier_coverage": round(best["coverage"], 4),
            "homography": None if status == "FAILED" else [[round(float(v), 8) for v in row] for row in best["H"]],
            "inlier_points_sample": best["inlier_pts"][:: max(1, len(best["inlier_pts"]) // 150)].round(1).tolist(),
        })
        result["_H"] = best["H"]
    result["duration_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    return result


def warp_to_reference(mov_bgr: np.ndarray, H: np.ndarray, ref_shape: tuple[int, int]) -> tuple[np.ndarray, np.ndarray]:
    h, w = ref_shape[:2]
    warped = cv2.warpPerspective(mov_bgr, H, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    valid = cv2.warpPerspective(np.full(mov_bgr.shape[:2], 255, np.uint8), H, (w, h), flags=cv2.INTER_NEAREST)
    valid = cv2.erode(valid, np.ones((5, 5), np.uint8))
    return warped, valid


def map_rect(H: np.ndarray, rect: list[int] | tuple[int, int, int, int]) -> list[int]:
    """Map an axis-aligned rect through H and return the bounding rect of the result."""
    x, y, w, h = rect
    pts = np.float32([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]).reshape(-1, 1, 2)
    out = cv2.perspectiveTransform(pts, H).reshape(-1, 2)
    x0, y0 = out.min(axis=0)
    x1, y1 = out.max(axis=0)
    return [int(round(x0)), int(round(y0)), int(round(x1 - x0)), int(round(y1 - y0))]

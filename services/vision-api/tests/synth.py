"""Deterministic synthetic PCB renderings with exact ground truth.

Used ONLY for unit tests and the synthetic part of the evaluation suite. Every
image produced here is labelled synthetic wherever it is used.
"""

from __future__ import annotations

import cv2
import numpy as np


def render_board(seed: int = 0, size=(900, 1200), bridge: bool = False, corrosion: bool = False,
                 glare_at: tuple[int, int] | None = None, glare_radius: int = 70, blur_sigma: float = 0.0,
                 leads_per_row: int = 16) -> tuple[np.ndarray, dict]:
    rng = np.random.default_rng(seed)
    h, w = size
    img = np.zeros((h, w, 3), np.uint8)
    img[:] = (58, 96, 34)  # BGR solder-mask green
    noise = rng.normal(0, 4, (h, w, 1)).astype(np.float32)
    img = np.clip(img.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    # Traces under the mask.
    for k in range(10):
        y = 60 + k * 80
        cv2.line(img, (0, y), (w, y + int(rng.integers(-40, 40))), (64, 118, 44), 6, cv2.LINE_AA)
    # SMD passives.
    for k in range(6):
        x, y = 80 + k * 170, 760
        cv2.rectangle(img, (x, y), (x + 60, y + 30), (30, 30, 32), -1)
        cv2.rectangle(img, (x - 14, y), (x, y + 30), (200, 200, 205), -1)
        cv2.rectangle(img, (x + 60, y), (x + 74, y + 30), (200, 200, 205), -1)
    # IC body with two lead rows (top and bottom).
    x0, y0, bw, bh = 330, 260, 520, 260
    cv2.rectangle(img, (x0, y0), (x0 + bw, y0 + bh), (34, 34, 36), -1)
    cv2.putText(img, "BG74HC", (x0 + 150, y0 + 140), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (150, 150, 150), 2, cv2.LINE_AA)
    pitch, lw, ll = 30, 13, 46
    gt: dict = {"bridges": [], "corrosion": [], "lead_pitch": pitch, "lead_width": lw}
    leads = []
    for row, ly in (("top", y0 - ll), ("bottom", y0 + bh)):
        for i in range(leads_per_row):
            lx = x0 + 20 + i * pitch
            cv2.rectangle(img, (lx, ly), (lx + lw, ly + ll), (196, 198, 200), -1)
            cv2.rectangle(img, (lx + 2, ly + 4), (lx + lw - 3, ly + ll - 6), (214, 216, 218), -1)
            leads.append((row, i, lx, ly))
    if bridge:
        _, i, lx, ly = [l for l in leads if l[0] == "bottom"][7]
        bx0, by0, bx1, by1 = lx + lw - 1, ly + 12, lx + pitch + 1, ly + 34
        cv2.rectangle(img, (bx0, by0), (bx1, by1), (200, 202, 204), -1)
        gt["bridges"].append([lx, ly, pitch + lw, ll])
    if corrosion:
        cx, cy, r = 190, 470, 70
        blob = np.zeros((h, w), np.uint8)
        pts = []
        for a in np.linspace(0, 2 * np.pi, 18, endpoint=False):
            rr = r * (0.65 + 0.5 * rng.random())
            pts.append([cx + rr * np.cos(a), cy + rr * np.sin(a)])
        cv2.fillPoly(blob, [np.int32(pts)], 255)
        grain = rng.random((h, w))
        tex = np.zeros_like(img)
        tex[:] = (176, 170, 96)  # teal / verdigris BGR
        pale = np.full_like(img, 205)
        mix = np.where((grain > 0.55)[..., None], pale, tex)
        mix = cv2.GaussianBlur(mix, (3, 3), 0)
        sel = blob > 0
        img[sel] = mix[sel]
        x, y, bw2, bh2 = cv2.boundingRect(blob)
        gt["corrosion"].append([x, y, bw2, bh2])
    if blur_sigma > 0:
        img = cv2.GaussianBlur(img, (0, 0), blur_sigma)
    if glare_at is not None:
        img = add_glare(img, glare_at, glare_radius)
        gt["glare_center"] = list(glare_at)
    return img, gt


def add_glare(img: np.ndarray, center: tuple[int, int], radius: int, strength: float = 1.0) -> np.ndarray:
    h, w = img.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d2 = ((xx - center[0]) ** 2 + (yy - center[1]) ** 2) / (radius ** 2)
    g = np.exp(-d2 * 1.4) * strength
    core = (d2 < 0.55).astype(np.float32) * strength
    a = np.clip(np.maximum(g, core), 0, 1)[..., None]
    out = img.astype(np.float32) * (1 - a) + 255.0 * a
    return np.clip(out, 0, 255).astype(np.uint8)


def warp(img: np.ndarray, seed: int = 1, max_shift: float = 30, max_rot_deg: float = 6, scale_jitter: float = 0.05,
         persp: float = 0.00008) -> tuple[np.ndarray, np.ndarray]:
    """Apply a random but plausible homography; returns (warped, H_src_to_dst)."""
    rng = np.random.default_rng(seed)
    h, w = img.shape[:2]
    ang = np.deg2rad(rng.uniform(-max_rot_deg, max_rot_deg))
    s = 1 + rng.uniform(-scale_jitter, scale_jitter)
    tx, ty = rng.uniform(-max_shift, max_shift, 2)
    cx, cy = w / 2, h / 2
    A = np.array([[s * np.cos(ang), -s * np.sin(ang), 0], [s * np.sin(ang), s * np.cos(ang), 0], [0, 0, 1]])
    T1 = np.array([[1, 0, -cx], [0, 1, -cy], [0, 0, 1]])
    T2 = np.array([[1, 0, cx + tx], [0, 1, cy + ty], [0, 0, 1]])
    P = np.array([[1, 0, 0], [0, 1, 0], [rng.uniform(-persp, persp), rng.uniform(-persp, persp), 1]])
    H = T2 @ P @ A @ T1
    out = cv2.warpPerspective(img, H, (w, h), borderMode=cv2.BORDER_REFLECT)
    return out, H


def jpeg(img: np.ndarray, q: int = 92) -> bytes:
    return cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, q])[1].tobytes()

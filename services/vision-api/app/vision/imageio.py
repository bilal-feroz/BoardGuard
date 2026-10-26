"""Safe image decoding, normalisation and encoding.

Every image entering BoardGuard passes through `decode_image`, which validates
the container format by magic bytes, enforces size limits and converts the
result to an 8-bit BGR array at a bounded working resolution. All downstream
coordinates (candidates, change regions, homographies) are expressed in the
pixel space of that working image.
"""

from __future__ import annotations

import base64
import os
from dataclasses import dataclass

# Guard against decompression bombs before cv2 is imported anywhere else.
os.environ.setdefault("OPENCV_IO_MAX_IMAGE_PIXELS", str(64 * 1024 * 1024))

import cv2
import numpy as np

# Vercel caps request bodies at 4.5 MB; report that limit instead of letting the platform reject the request.
MAX_UPLOAD_BYTES = int(os.environ.get("BOARDGUARD_MAX_UPLOAD_BYTES", 4_400_000 if os.environ.get("VERCEL") else 8 * 1024 * 1024))
MAX_WORK_SIDE = int(os.environ.get("BOARDGUARD_MAX_WORK_SIDE", 1600))
MIN_SIDE = 160

_MAGIC = (
    (b"\xff\xd8\xff", "jpeg"),
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"BM", "bmp"),
    (b"II*\x00", "tiff"),
    (b"MM\x00*", "tiff"),
)


class ImageError(ValueError):
    """Raised for unsupported, corrupt or oversized images. `code` is machine-readable."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class DecodedImage:
    image: np.ndarray  # BGR uint8 at working resolution
    original_width: int
    original_height: int
    scale: float  # working / original
    format: str
    byte_size: int

    @property
    def width(self) -> int:
        return int(self.image.shape[1])

    @property
    def height(self) -> int:
        return int(self.image.shape[0])


def sniff_format(data: bytes) -> str | None:
    for magic, name in _MAGIC:
        if data.startswith(magic):
            return name
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def decode_image(data: bytes, max_side: int = MAX_WORK_SIDE) -> DecodedImage:
    if not data:
        raise ImageError("EMPTY_FILE", "The uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise ImageError(
            "FILE_TOO_LARGE",
            f"Image is {len(data) / 1e6:.1f} MB; the limit is {MAX_UPLOAD_BYTES / 1e6:.0f} MB.",
        )
    fmt = sniff_format(data)
    if fmt is None:
        raise ImageError(
            "UNSUPPORTED_FORMAT",
            "Unsupported file type. Use JPEG, PNG, WebP, BMP or TIFF.",
        )
    buf = np.frombuffer(data, dtype=np.uint8)
    try:
        img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    except cv2.error:
        img = None
    if img is None or img.size == 0:
        raise ImageError("CORRUPT_IMAGE", f"The {fmt.upper()} file could not be decoded; it may be truncated or corrupt.")
    oh, ow = img.shape[:2]
    if min(oh, ow) < MIN_SIDE:
        raise ImageError("IMAGE_TOO_SMALL", f"Image is {ow}x{oh}px; at least {MIN_SIDE}px on the short side is required.")
    scale = 1.0
    if max(oh, ow) > max_side:
        scale = max_side / float(max(oh, ow))
        img = cv2.resize(img, (round(ow * scale), round(oh * scale)), interpolation=cv2.INTER_AREA)
    return DecodedImage(img, ow, oh, scale, fmt, len(data))


# Binary overlays are long runs of identical pixels: run-length deflate without row filters is ~5x faster
# than the default and still lossless (a full-frame RGBA mask encodes in ~30 ms instead of ~170 ms).
_PNG_FAST = [cv2.IMWRITE_PNG_COMPRESSION, 6, cv2.IMWRITE_PNG_STRATEGY, cv2.IMWRITE_PNG_STRATEGY_RLE,
             cv2.IMWRITE_PNG_FILTER, cv2.IMWRITE_PNG_FILTER_NONE]


def encode_png(img: np.ndarray, mask: bool = False) -> bytes:
    ok, out = cv2.imencode(".png", img, _PNG_FAST if mask else [cv2.IMWRITE_PNG_COMPRESSION, 6])
    if not ok:
        raise RuntimeError("PNG encoding failed")
    return out.tobytes()


def encode_jpeg(img: np.ndarray, quality: int = 90) -> bytes:
    ok, out = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("JPEG encoding failed")
    return out.tobytes()


def to_data_url(data: bytes, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"


def mask_to_rgba(mask: np.ndarray, color_bgr: tuple[int, int, int], alpha: int = 150) -> np.ndarray:
    """Render a boolean/uint8 mask as a transparent BGRA overlay."""
    m = mask > 0
    out = np.zeros((*mask.shape[:2], 4), np.uint8)
    out[m, 0], out[m, 1], out[m, 2] = color_bgr
    out[m, 3] = alpha
    return out


def clamp_rect(x: int, y: int, w: int, h: int, width: int, height: int) -> tuple[int, int, int, int]:
    x0 = max(0, min(int(x), width - 1))
    y0 = max(0, min(int(y), height - 1))
    x1 = max(x0 + 1, min(int(x + w), width))
    y1 = max(y0 + 1, min(int(y + h), height))
    return x0, y0, x1 - x0, y1 - y0

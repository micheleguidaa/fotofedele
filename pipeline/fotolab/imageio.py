"""Image loading helpers shared by workflows and metrics (BGR uint8, EXIF-corrected)."""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps


def load_bgr(path: str | Path, max_side: int | None = None) -> np.ndarray:
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    if max_side and max(im.size) > max_side:
        im.thumbnail((max_side, max_side), Image.LANCZOS)
    return cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2BGR)


def save_bgr(img: np.ndarray, path: str | Path, quality: int = 95) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    ext = path.suffix.lower()
    params = [cv2.IMWRITE_JPEG_QUALITY, quality] if ext in (".jpg", ".jpeg") else []
    if ext == ".webp":
        params = [cv2.IMWRITE_WEBP_QUALITY, quality]
    if not cv2.imwrite(str(path), img, params):
        raise IOError(f"cannot write {path}")
    return path


def resize_to_width(img: np.ndarray, width: int) -> np.ndarray:
    h, w = img.shape[:2]
    if w == width:
        return img
    interp = cv2.INTER_AREA if width < w else cv2.INTER_CUBIC
    return cv2.resize(img, (width, round(h * width / w)), interpolation=interp)


def match_size(img: np.ndarray, ref: np.ndarray) -> np.ndarray:
    """Resize `img` to the exact pixel size of `ref` (used before full-reference metrics)."""
    h, w = ref.shape[:2]
    if img.shape[:2] == (h, w):
        return img
    interp = cv2.INTER_AREA if img.shape[1] > w else cv2.INTER_CUBIC
    return cv2.resize(img, (w, h), interpolation=interp)

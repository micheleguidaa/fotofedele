"""No-reference technical metrics that make photo defects measurable.

Each metric maps to one defect the product promises to fix, with an explicit
target range (see TARGETS). A workflow "fixes" a defect when the metric moves
from outside to inside its target range.
"""

from __future__ import annotations

import cv2
import numpy as np
from skimage.restoration import estimate_sigma

from fotolab.imageio import resize_to_width

ANALYSIS_WIDTH = 1024

# Target ranges for a listing-grade interior photo (tuned on the curated set, documented in /metodo).
TARGETS = {
    "exposure_L": (52.0, 72.0),       # mean L* (0-100)
    "clip_high_pct": (0.0, 6.0),      # % pixels L* > 98
    "clip_low_pct": (0.0, 3.0),       # % pixels L* < 4
    "cast": (0.0, 4.0),               # chroma of near-neutral pixels (Lab units)
    "tilt_deg": (0.0, 0.75),          # |median deviation of vertical lines|
    "sharpness": (120.0, float("inf")),  # variance of Laplacian at 1024px width
    "noise_sigma": (0.0, 2.5),
    "megapixels": (1.0, float("inf")),
}

DEFECTS = {
    "buia": "exposure_L",
    "sovraesposta": "clip_high_pct",
    "dominante": "cast",
    "storta": "tilt_deg",
    "sfocata": "sharpness",
    "rumorosa": "noise_sigma",
    "bassa_risoluzione": "megapixels",
}


def _lab(img_bgr: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(img_bgr.astype(np.float32) / 255.0, cv2.COLOR_BGR2LAB)
    return lab  # L in [0,100], a/b roughly [-128,127]


def exposure(lab: np.ndarray) -> dict:
    L = lab[..., 0]
    return {
        "exposure_L": float(L.mean()),
        "contrast_L": float(L.std()),
        "clip_high_pct": float((L > 98).mean() * 100),
        "clip_low_pct": float((L < 4).mean() * 100),
    }


def color_cast(lab: np.ndarray) -> dict:
    """Mean a*/b* of pixels that should be neutral (low chroma, mid luminance)."""
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    chroma = np.hypot(a, b)
    mask = (L > 25) & (L < 95) & (chroma < 18)
    if mask.sum() < 500:  # very colourful scene: fall back to gray-world
        mask = (L > 10) & (L < 97)
    ma, mb = float(a[mask].mean()), float(b[mask].mean())
    return {"cast": float(np.hypot(ma, mb)), "cast_a": ma, "cast_b": mb,
            "colorfulness": float(chroma.mean())}


def tilt(gray: np.ndarray) -> dict:
    """Median deviation from vertical of near-vertical line segments (length weighted).

    Also returns a keystone indicator: correlation between segment x-position and
    angle (converging verticals when the camera is pitched up/down).
    """
    lsd = cv2.createLineSegmentDetector()
    lines = lsd.detect(gray)[0]
    h, w = gray.shape
    if lines is None:
        return {"tilt_deg": 0.0, "tilt_signed_deg": 0.0, "n_vertical_lines": 0, "keystone": 0.0}
    segs = lines.reshape(-1, 4)
    dx, dy = segs[:, 2] - segs[:, 0], segs[:, 3] - segs[:, 1]
    length = np.hypot(dx, dy)
    # angle from vertical, in degrees, sign: positive = leaning right going up
    ang = np.degrees(np.arctan2(dx, dy))
    ang = (ang + 90) % 180 - 90
    keep = (np.abs(ang) < 12) & (length > 0.06 * h)
    if keep.sum() < 3:
        return {"tilt_deg": 0.0, "tilt_signed_deg": 0.0, "n_vertical_lines": int(keep.sum()), "keystone": 0.0}
    a, L = ang[keep], length[keep]
    xm = (segs[keep, 0] + segs[keep, 2]) / 2 / w - 0.5
    order = np.argsort(a)
    cw = np.cumsum(L[order])
    median = float(a[order][np.searchsorted(cw, cw[-1] / 2)])
    if len(a) < 6:
        return {"tilt_deg": abs(median), "tilt_signed_deg": median,
                "n_vertical_lines": int(keep.sum()), "keystone": 0.0}
    # angle(x) = tilt + keystone * x : rotation shifts all angles equally, a pitched camera
    # makes them vary linearly with horizontal position. Robust weighted fit (2 reweighting rounds).
    wts = L.copy()
    for _ in range(3):
        k, t0 = np.polyfit(xm, a, 1, w=np.sqrt(wts))
        res = a - (t0 + k * xm)
        wts = L * (np.abs(res) < max(1.5, 2.5 * np.median(np.abs(res))))
        if wts.sum() == 0:
            break
    return {"tilt_deg": abs(float(t0)), "tilt_signed_deg": float(t0),
            "n_vertical_lines": int(keep.sum()), "keystone": float(k)}


def sharpness_noise(gray: np.ndarray) -> dict:
    lap = cv2.Laplacian(gray, cv2.CV_64F)
    sigma = float(estimate_sigma(gray.astype(np.float64), channel_axis=None))
    return {"sharpness": float(lap.var()), "noise_sigma": sigma}


def graphic_score(lab: np.ndarray) -> float:
    """High for floor plans / graphics (mostly white, colourless). Used to exclude them."""
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    white = (L > 93) & (np.hypot(a, b) < 5)
    return float(white.mean())


def analyze(img_bgr: np.ndarray) -> dict:
    h, w = img_bgr.shape[:2]
    small = resize_to_width(img_bgr, ANALYSIS_WIDTH)
    lab = _lab(small)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    out = {"width": w, "height": h, "megapixels": w * h / 1e6}
    out.update(exposure(lab))
    out.update(color_cast(lab))
    out.update(tilt(gray))
    out.update(sharpness_noise(gray))
    out["graphic_score"] = graphic_score(lab)
    return out


def in_target(metric: str, value: float) -> bool:
    lo, hi = TARGETS[metric]
    return lo <= value <= hi


def defects(m: dict) -> list[str]:
    """Defects present in an image, by comparing metrics with TARGETS."""
    found = []
    if m["exposure_L"] < TARGETS["exposure_L"][0]:
        found.append("buia")
    if m["clip_high_pct"] > TARGETS["clip_high_pct"][1]:
        found.append("sovraesposta")
    for name in ("dominante", "storta", "sfocata", "rumorosa", "bassa_risoluzione"):
        if not in_target(DEFECTS[name], m[DEFECTS[name]]):
            found.append(name)
    return found

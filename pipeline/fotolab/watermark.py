"""Detect the Immobiliare.it platform watermark burned into served photos.

The platform adds a semi-transparent logo at the image centre, scaled with the
image width. We learn a template by averaging the high-pass centre band of
known-watermarked photos (scene content averages out, the logo reinforces) and
score new photos by normalised cross-correlation. We exclude watermarked photos
from the dataset because the product's real input is the agent's original upload.
"""

from __future__ import annotations

import cv2
import numpy as np

from fotolab.imageio import load_bgr

W = 800          # normalised width
BAND = (0.36, 0.64)  # vertical band (fraction of height) around the centre
TPL_X = (0.18, 0.82)  # horizontal span of the logo region in the template


def _highpass_band(path) -> np.ndarray:
    img = load_bgr(path)
    h, w = img.shape[:2]
    img = cv2.resize(img, (W, round(h * W / w)), interpolation=cv2.INTER_AREA)
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    hp = g - cv2.GaussianBlur(g, (0, 0), 6)
    H = g.shape[0]
    cy = H // 2
    half = int(W * 0.09)  # logo height ~ 18% of width
    band = hp[max(cy - half - 12, 0): cy + half + 12]
    return band


def build_template(paths) -> np.ndarray:
    bands = [_highpass_band(p) for p in paths]
    hmin = min(b.shape[0] for b in bands)
    stack = np.stack([b[(b.shape[0] - hmin) // 2:(b.shape[0] - hmin) // 2 + hmin] for b in bands])
    tpl = np.median(stack, axis=0)
    x0, x1 = int(W * TPL_X[0]), int(W * TPL_X[1])
    return tpl[12:-12, x0:x1].astype(np.float32)


def score(path, tpl: np.ndarray) -> float:
    band = _highpass_band(path)
    best = -1.0
    for s in (0.92, 1.0, 1.08):
        t = cv2.resize(tpl, None, fx=s, fy=s, interpolation=cv2.INTER_LINEAR)
        if t.shape[0] >= band.shape[0] or t.shape[1] >= band.shape[1]:
            continue
        r = cv2.matchTemplate(band, t, cv2.TM_CCOEFF_NORMED)
        best = max(best, float(r.max()))
    return best

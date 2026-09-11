"""F5 — "gpt-image as art director": transfer only colour and light, never pixels.

Given the original photo O and a generative reference R (the F3 output):
  1. register R onto O (ECC homography at low resolution);
  2. keep only pixels where O and R have the SAME local structure (gradient correlation):
     regions the model redrew (e.g. an invented window view) must not teach the mapping;
  3. fit an interpretable global transform on those pixels:
       - a monotonic tone curve on luminance (256-entry LUT),
       - a 3x3 colour matrix on luminance-normalised RGB (white balance + saturation);
  4. fit a low-frequency luminance gain map (the model's dodge & burn), again only on
     structurally-agreeing pixels, heavily blurred and clipped;
  5. apply everything to the FULL-RESOLUTION original, then straighten as in F1.
A monotonic curve, a 3x3 matrix and a blurred gain map cannot draw new structure, so the
output shows exactly the original objects, textures and window views.
"""

from __future__ import annotations

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter

from fotolab.align import align
from fotolab.imageio import resize_to_width
from fotolab.workflows.classical import straighten

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)  # RGB order


def _to_rgb01(bgr: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0


def structural_agreement(a_bgr: np.ndarray, b_bgr: np.ndarray, win: int = 15) -> np.ndarray:
    """Local normalised cross-correlation of gradient magnitudes (-1..1)."""
    def grad(img):
        g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
        g = (g - g.mean()) / (g.std() + 1e-6)
        return cv2.magnitude(cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3))
    ga, gb = grad(a_bgr), grad(b_bgr)
    k = (win, win)
    ma, mb = cv2.blur(ga, k), cv2.blur(gb, k)
    va = cv2.blur(ga * ga, k) - ma * ma
    vb = cv2.blur(gb * gb, k) - mb * mb
    cov = cv2.blur(ga * gb, k) - ma * mb
    ncc = cov / np.sqrt(np.maximum(va * vb, 1e-8))
    flat = (va < 0.02) & (vb < 0.02)       # both flat (walls, ceilings): agree by definition
    return np.where(flat, 1.0, ncc)


def fit_tone_curve(src_y: np.ndarray, dst_y: np.ndarray, bins: int = 64, min_slope: float = 0.4) -> np.ndarray:
    """Monotonic 256-entry curve mapping source luminance to destination luminance."""
    edges = np.linspace(0, 1, bins + 1)
    centers, meds = [0.0], [0.0]
    idx = np.clip(np.digitize(src_y, edges) - 1, 0, bins - 1)
    for i in range(bins):
        sel = idx == i
        if sel.sum() >= 30:
            centers.append((edges[i] + edges[i + 1]) / 2)
            meds.append(float(np.median(dst_y[sel])))
    centers.append(1.0)
    meds.append(max(meds[-1], float(np.percentile(dst_y, 99.5))))
    curve = np.interp(np.linspace(0, 1, 256), centers, meds)
    curve = np.maximum.accumulate(gaussian_filter(curve, 3, mode="nearest"))  # smooth + monotonic
    # v2: minimum slope, so highlights keep their contrast instead of flattening into haze
    min_step = min_slope / 255
    steps = np.maximum(np.diff(curve), min_step)
    top = 1.0 - curve[0]
    if steps.sum() > top:  # squeeze back into range, but never below the minimum slope
        extra = steps - min_step
        steps = min_step + extra * max(top - min_step * len(steps), 0) / max(extra.sum(), 1e-9)
    curve = np.concatenate([[curve[0]], curve[0] + np.cumsum(steps)])
    return np.clip(curve, 0, 1).astype(np.float32)


def fit_color_matrix(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """3x3 matrix on chromaticity (RGB / luminance), robust to outliers."""
    ys, yd = src @ LUMA, dst @ LUMA
    ok = (ys > 0.05) & (yd > 0.05) & (src.max(1) < 0.98) & (dst.max(1) < 0.98)
    cs, cd = src[ok] / ys[ok, None], dst[ok] / yd[ok, None]
    M, *_ = np.linalg.lstsq(cs, cd, rcond=None)
    res = np.linalg.norm(cs @ M - cd, axis=1)
    w = (res < np.percentile(res, 80)).astype(np.float32)
    M, *_ = np.linalg.lstsq(cs * w[:, None], cd * w[:, None], rcond=None)
    # keep it a gentle correction: blend towards identity
    return (0.85 * M + 0.15 * np.eye(3)).astype(np.float32)


def apply_global(rgb: np.ndarray, curve: np.ndarray, M: np.ndarray) -> np.ndarray:
    y = rgb @ LUMA
    chroma = rgb / np.maximum(y[..., None], 1e-4)
    chroma = chroma @ M
    # re-normalise so the colour matrix does not change luminance
    chroma /= np.maximum(chroma @ LUMA, 1e-4)[..., None]
    y2 = np.interp(y, np.linspace(0, 1, 256), curve)
    return np.clip(chroma * y2[..., None], 0, 1)


def transfer(original_bgr: np.ndarray, reference_bgr: np.ndarray, work_width: int = 640,
             gain_sigma_frac: float = 0.08, agree_thr: float = 0.5, gain_range: tuple = (0.9, 1.12),
             local_contrast: float = 0.4, do_straighten: bool = True) -> tuple[np.ndarray, dict]:
    log: dict = {}
    small = resize_to_width(original_bgr, work_width)
    ref_aligned, mask, info = align(reference_bgr, small, work_width=work_width)
    agree = structural_agreement(small, ref_aligned)
    use = (mask > 0) & (agree > agree_thr)
    log["alignment"] = {"ecc": round(info["ecc"], 3) if info["ecc"] == info["ecc"] else None,
                        "valid_fraction": round(info["valid_fraction"], 3)}
    log["agreeing_pixels"] = round(float(use.mean()), 3)
    if use.mean() < 0.15:  # reference too different: do not trust it
        use = mask > 0
        log["warning"] = "low structural agreement, fitted on all aligned pixels"

    src, dst = _to_rgb01(small)[use], _to_rgb01(ref_aligned)[use]
    curve = fit_tone_curve(src @ LUMA, dst @ LUMA)
    M = fit_color_matrix(src, dst)
    log["tone_curve"] = {"in_0.25": round(float(curve[64]), 3), "in_0.5": round(float(curve[128]), 3),
                         "in_0.75": round(float(curve[192]), 3)}
    log["color_matrix"] = np.round(M, 3).tolist()

    # dodge & burn: ratio of blurred luminances, measured only where structure agrees
    mapped_small = apply_global(_to_rgb01(small), curve, M)
    sigma = gain_sigma_frac * work_width
    m = use.astype(np.float32)
    num = gaussian_filter((_to_rgb01(ref_aligned) @ LUMA) * m, sigma)
    den = gaussian_filter((mapped_small @ LUMA) * m, sigma)
    wsum = gaussian_filter(m, sigma)
    gain = np.where(wsum > 0.15, (num + 1e-3) / (den + 1e-3), 1.0)
    gain = np.clip(gaussian_filter(gain, sigma / 2), *gain_range).astype(np.float32)
    log["gain_map"] = {"min": round(float(gain.min()), 3), "max": round(float(gain.max()), 3)}

    H, W = original_bgr.shape[:2]
    out = apply_global(_to_rgb01(original_bgr), curve, M)
    out = np.clip(out * cv2.resize(gain, (W, H), interpolation=cv2.INTER_CUBIC)[..., None], 0, 1)
    out_bgr = cv2.cvtColor((out * 255).round().astype(np.uint8), cv2.COLOR_RGB2BGR)
    if local_contrast > 0:  # v2: a global curve cannot reproduce the model's local contrast -> mild CLAHE
        lab = cv2.cvtColor(out_bgr, cv2.COLOR_BGR2LAB)
        L = lab[..., 0]
        lab[..., 0] = cv2.addWeighted(cv2.createCLAHE(clipLimit=1.6, tileGridSize=(8, 8)).apply(L), local_contrast,
                                      L, 1 - local_contrast, 0)
        out_bgr = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
        log["local_contrast"] = local_contrast
    if do_straighten:
        out_bgr, log["straighten"] = straighten(out_bgr)
    return out_bgr, log

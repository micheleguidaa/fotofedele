"""F1 — deterministic enhancement (no generative model, zero hallucination by construction).

Steps, each logged so the UI can say exactly what changed:
  1. straighten: rotate by the measured tilt of vertical lines, partial keystone correction
  2. white balance: shades-of-grey estimate on near-neutral pixels
  3. exposure: gamma on luminance towards a target median + mild CLAHE for local contrast
  4. denoise (only if noise is measurable)
  5. super-resolution with Real-ESRGAN on the VM (only below 0.6 MP), then mild unsharp mask
"""

from __future__ import annotations

import cv2
import numpy as np

from fotolab.metrics.technical import tilt as measure_tilt
from fotolab.imageio import resize_to_width


def _largest_inner_rect(w: int, h: int, angle_deg: float) -> tuple[int, int]:
    """Size of the largest axis-aligned rectangle inside a w×h image rotated by angle."""
    a = abs(np.radians(angle_deg))
    if a < 1e-6:
        return w, h
    sin_a, cos_a = np.sin(a), np.cos(a)
    side_long, side_short = (w, h) if w >= h else (h, w)
    if side_short <= 2.0 * sin_a * cos_a * side_long or abs(sin_a - cos_a) < 1e-10:
        x = 0.5 * side_short
        wr, hr = (x / sin_a, x / cos_a) if w >= h else (x / cos_a, x / sin_a)
    else:
        cos_2a = cos_a * cos_a - sin_a * sin_a
        wr, hr = (w * cos_a - h * sin_a) / cos_2a, (h * cos_a - w * sin_a) / cos_2a
    return int(wr), int(hr)


MAX_CROP = 0.14  # v2: a first run showed larger crops cutting logos/objects at the frame edges


def _crop_fraction(w: int, h: int, angle: float) -> float:
    cw, ch = _largest_inner_rect(w, h, angle)
    return 1 - (cw * ch) / (w * h)


def straighten(img: np.ndarray, min_deg: float = 0.3, max_deg: float = 6.0,
               keystone_strength: float = 0.4) -> tuple[np.ndarray, dict]:
    small = resize_to_width(img, 1024)
    t = measure_tilt(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY))
    angle = t["tilt_signed_deg"]
    log = {"measured_tilt_deg": round(angle, 2), "rotated_deg": 0.0, "keystone_corrected": 0.0}
    h, w = img.shape[:2]
    out = img
    if min_deg <= abs(angle) <= max_deg and t["n_vertical_lines"] >= 4:
        # second pass: perspective lines bias a single estimate, so re-measure after rotating
        # the small copy and apply the combined angle once to the full-res image
        sh, sw = small.shape[:2]
        Ms = cv2.getRotationMatrix2D((sw / 2, sh / 2), -angle, 1.0)
        t2 = measure_tilt(cv2.cvtColor(cv2.warpAffine(small, Ms, (sw, sh), borderMode=cv2.BORDER_REFLECT),
                                       cv2.COLOR_BGR2GRAY))
        if abs(t2["tilt_signed_deg"]) > 0.2:
            angle = float(np.clip(angle + t2["tilt_signed_deg"], -max_deg, max_deg))
            t["keystone"] = t2["keystone"]
        # cap the crop: straighten only partially rather than cutting away too much of the room
        full_angle = angle
        while _crop_fraction(w, h, angle) > MAX_CROP and abs(angle) > 0.3:
            angle *= 0.85
        if angle != full_angle:
            log["partial_of_deg"] = round(-full_angle, 2)
        # positive angle = lines lean right going up -> rotate clockwise (negative in OpenCV)
        M = cv2.getRotationMatrix2D((w / 2, h / 2), -angle, 1.0)
        rot = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
        cw, ch = _largest_inner_rect(w, h, angle)
        x0, y0 = (w - cw) // 2, (h - ch) // 2
        out = rot[y0:y0 + ch, x0:x0 + cw]
        log["rotated_deg"] = round(-angle, 2)
        log["crop_fraction"] = round(1 - (cw * ch) / (w * h), 3)
    # partial vertical keystone: angle(x) ~ k * x  -> vertical vanishing point
    k = t["keystone"]
    if keystone_strength > 0 and abs(k) > 1.0 and t["n_vertical_lines"] >= 8:
        H_, W_ = out.shape[:2]
        # a line at normalised x has angle k*x degrees; VP distance d satisfies tan(angle) = x*W/d
        d = (0.25 * W_) / np.tan(np.radians(abs(k) * 0.25))
        b = keystone_strength * np.sign(k) / d
        # shift origin to image centre, apply projective term on y, shift back, then rescale
        T = np.array([[1, 0, -W_ / 2], [0, 1, -H_ / 2], [0, 0, 1]], np.float64)
        P = np.array([[1, 0, 0], [0, 1, 0], [0, b, 1]], np.float64)
        Hm = np.linalg.inv(T) @ P @ T
        corners = np.array([[0, 0, 1], [W_, 0, 1], [W_, H_, 1], [0, H_, 1]], np.float64).T
        pc = Hm @ corners
        pc = pc[:2] / pc[2]
        # keep the inner rectangle so no borders appear
        left, right = max(pc[0][0], pc[0][3]), min(pc[0][1], pc[0][2])
        top, bottom = max(pc[1][0], pc[1][1]), min(pc[1][2], pc[1][3])
        if right - left > 0.92 * W_ and bottom - top > 0.92 * H_:
            S = np.array([[W_ / (right - left), 0, -left * W_ / (right - left)],
                          [0, H_ / (bottom - top), -top * H_ / (bottom - top)], [0, 0, 1]])
            out = cv2.warpPerspective(out, S @ Hm, (W_, H_), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
            log["keystone_corrected"] = round(float(k * keystone_strength), 2)
    return out, log


def white_balance(img: np.ndarray, strength: float = 0.85, p: int = 6) -> tuple[np.ndarray, dict]:
    x = img.astype(np.float32) / 255.0
    lab = cv2.cvtColor(x, cv2.COLOR_BGR2LAB)
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    mask = (L > 20) & (L < 95) & (np.hypot(a, b) < 20)
    if mask.sum() < 1000:
        mask = (L > 10) & (L < 97)
    px = x[mask]
    est = np.power(np.mean(np.power(px, p), axis=0), 1 / p)  # shades of grey (BGR)
    gains = est.mean() / np.maximum(est, 1e-4)
    gains = 1 + strength * (gains - 1)
    gains = np.clip(gains, 0.7, 1.4)
    out = np.clip(x * gains, 0, 1)
    return (out * 255).round().astype(np.uint8), {"wb_gains_bgr": [round(float(g), 3) for g in gains]}


def exposure(img: np.ndarray, target_median_L: float = 60.0, clahe_clip: float = 1.6) -> tuple[np.ndarray, dict]:
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)  # uint8: L in 0..255
    L = lab[..., 0].astype(np.float32) / 255.0
    med = float(np.median(L))
    target = target_median_L / 100.0
    gamma = np.log(target) / np.log(max(min(med, 0.99), 0.02))
    gamma = float(np.clip(gamma, 0.45, 1.6))
    L2 = np.power(L, gamma)
    # soft highlight roll-off to avoid clipping windows further
    L2 = np.where(L2 > 0.85, 0.85 + (L2 - 0.85) * 0.6, L2)
    L8 = np.clip(L2 * 255, 0, 255).astype(np.uint8)
    if clahe_clip > 0:
        clahe = cv2.createCLAHE(clipLimit=clahe_clip, tileGridSize=(8, 8))
        L8 = cv2.addWeighted(clahe.apply(L8), 0.5, L8, 0.5, 0)
    lab[..., 0] = L8
    # compensate saturation loss when brightening
    out = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
    return out, {"median_L_before": round(med * 100, 1), "gamma": round(gamma, 3), "clahe_clip": clahe_clip}


def denoise(img: np.ndarray, sigma: float) -> tuple[np.ndarray, dict]:
    if sigma < 1.2:
        return img, {"denoise_h": 0}
    h = float(np.clip(sigma * 1.6, 3, 10))
    return cv2.fastNlMeansDenoisingColored(img, None, h, h, 7, 21), {"denoise_h": round(h, 1)}


def unsharp(img: np.ndarray, amount: float = 0.45, sigma: float = 1.1) -> np.ndarray:
    blur = cv2.GaussianBlur(img, (0, 0), sigma)
    return cv2.addWeighted(img, 1 + amount, blur, -amount, 0)


def enhance(img: np.ndarray, sr_below_mp: float = 0.6, sr_fn=None, target_long_side: int = 1680,
            do_straighten: bool = True) -> tuple[np.ndarray, dict]:
    """Full F1 pipeline. `sr_fn(img) -> img` runs Real-ESRGAN (injected so this module stays offline-testable)."""
    from skimage.restoration import estimate_sigma

    ops: dict = {}
    out = img
    if do_straighten:
        out, ops["straighten"] = straighten(out)
    out, ops["white_balance"] = white_balance(out)
    out, ops["exposure"] = exposure(out)
    sigma = float(estimate_sigma(cv2.cvtColor(resize_to_width(out, 1024), cv2.COLOR_BGR2GRAY).astype(float), channel_axis=None))
    out, ops["denoise"] = denoise(out, sigma)
    mp = out.shape[0] * out.shape[1] / 1e6
    if sr_fn is not None and mp < sr_below_mp:
        out = sr_fn(out)
        ops["super_resolution"] = {"model": "RealESRGAN_x4plus", "from_mp": round(mp, 2)}
        long_side = max(out.shape[:2])
        if long_side > target_long_side:
            s = target_long_side / long_side
            out = cv2.resize(out, (round(out.shape[1] * s), round(out.shape[0] * s)), interpolation=cv2.INTER_AREA)
    else:
        out = unsharp(out)
        ops["sharpen"] = {"amount": 0.45}
    return out, ops

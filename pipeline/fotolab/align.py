"""Geometric alignment between an input photo and a workflow output.

Generative models may re-frame, straighten or resize. Before comparing pixels
(fidelity, full-reference metrics) we register the candidate onto
the reference with ECC (invariant to brightness/contrast changes), coarse-to-fine.
"""

from __future__ import annotations

import cv2
import numpy as np

from fotolab.imageio import match_size


def _gray(img: np.ndarray, width: int) -> np.ndarray:
    h, w = img.shape[:2]
    g = cv2.cvtColor(cv2.resize(img, (width, round(h * width / w)), interpolation=cv2.INTER_AREA),
                     cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    return cv2.GaussianBlur(g, (0, 0), 1.0)


def align(candidate: np.ndarray, reference: np.ndarray, motion: int = cv2.MOTION_HOMOGRAPHY,
          work_width: int = 640) -> tuple[np.ndarray, np.ndarray, dict]:
    """Warp `candidate` onto `reference` geometry.

    Returns (aligned_candidate at reference size, valid_mask uint8, info).
    info["ecc"] is the final correlation (1.0 = perfect); low values mean the
    candidate is structurally different or could not be registered.
    """
    cand = match_size(candidate, reference)
    H, W = reference.shape[:2]
    warp = np.eye(3, 3, dtype=np.float32) if motion == cv2.MOTION_HOMOGRAPHY else np.eye(2, 3, dtype=np.float32)
    ecc = float("nan")
    ok = True
    for width in (work_width // 4, work_width // 2, work_width):
        r, c = _gray(reference, width), _gray(cand, width)
        s = width / W
        S = np.diag([s, s, 1]).astype(np.float32)
        w_scaled = (S @ (warp if warp.shape[0] == 3 else np.vstack([warp, [0, 0, 1]])) @ np.linalg.inv(S)).astype(np.float32)
        if motion != cv2.MOTION_HOMOGRAPHY:
            w_scaled = w_scaled[:2]
        try:
            ecc, w_scaled = cv2.findTransformECC(r, c, w_scaled, motion,
                                                 (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6),
                                                 None, 5)
        except cv2.error:
            ok = False
            break
        full = w_scaled if w_scaled.shape[0] == 3 else np.vstack([w_scaled, [0, 0, 1]])
        full = np.linalg.inv(S) @ full @ S
        warp = full.astype(np.float32) if motion == cv2.MOTION_HOMOGRAPHY else full[:2].astype(np.float32)
    flags = cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP
    if motion == cv2.MOTION_HOMOGRAPHY:
        aligned = cv2.warpPerspective(cand, warp, (W, H), flags=flags, borderMode=cv2.BORDER_CONSTANT)
        mask = cv2.warpPerspective(np.full((H, W), 255, np.uint8), warp, (W, H), flags=flags)
    else:
        aligned = cv2.warpAffine(cand, warp, (W, H), flags=flags, borderMode=cv2.BORDER_CONSTANT)
        mask = cv2.warpAffine(np.full((H, W), 255, np.uint8), warp, (W, H), flags=flags)
    mask = cv2.erode(mask, np.ones((5, 5), np.uint8))
    return aligned, mask, {"ecc": float(ecc) if ok else float("nan"), "aligned": ok,
                           "valid_fraction": float((mask > 0).mean()), "warp": np.asarray(warp).tolist()}

"""Alteration-risk metrics: did the workflow change WHAT is in the photo (not just how it looks)?

- structural: local correlation of exposure-invariant gradients (log-luminance) after
  registering output onto input; 1.0 = same structure everywhere.
- changed_area_pct: share of the frame whose local structure disagrees (connected blobs
  only, tiny specks ignored) -> also rendered as a red heatmap for the UI.
- framing_kept_pct: share of the input frame still covered by the output (crop/reframe).
- semantic: cosine similarity of DINOv2 image embeddings (content-level sameness).
Thresholds used to raise a flag are calibrated on the trap set (see validate.py).
"""

from __future__ import annotations

from functools import lru_cache

import cv2
import numpy as np

from fotolab.align import align
from fotolab.imageio import resize_to_width

WORK_W = 768


def _loggrad(img_bgr: np.ndarray) -> np.ndarray:
    y = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    y = cv2.GaussianBlur(y, (0, 0), 1.2)
    ly = np.log(y + 0.03)  # relative gradients: invariant to exposure gain, damped in deep shadows
    return cv2.magnitude(cv2.Sobel(ly, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(ly, cv2.CV_32F, 0, 1, ksize=3))


def local_agreement(a_bgr: np.ndarray, b_bgr: np.ndarray, win: int = 21, flat_thr: float = 0.02) -> np.ndarray:
    ga, gb = _loggrad(a_bgr), _loggrad(b_bgr)
    k = (win, win)
    ma, mb = cv2.blur(ga, k), cv2.blur(gb, k)
    va = np.maximum(cv2.blur(ga * ga, k) - ma * ma, 0)
    vb = np.maximum(cv2.blur(gb * gb, k) - mb * mb, 0)
    cov = cv2.blur(ga * gb, k) - ma * mb
    ncc = cov / np.sqrt(np.maximum(va * vb, 1e-10))
    both_flat = (va < flat_thr) & (vb < flat_thr)
    return np.where(both_flat, 1.0, np.clip(ncc, -1, 1)).astype(np.float32)


def structural(input_bgr: np.ndarray, output_bgr: np.ndarray, change_thr: float = 0.35,
               min_blob_frac: float = 0.002) -> dict:
    ref = resize_to_width(input_bgr, WORK_W)
    aligned, mask, info = align(output_bgr, ref, work_width=640)
    # erode the warped-frame mask and drop a thin outer band: resampling at frame edges is not "change"
    valid = cv2.erode(mask, np.ones((21, 21), np.uint8)) > 0
    b = max(4, int(0.02 * WORK_W))
    valid[:b], valid[-b:], valid[:, :b], valid[:, -b:] = False, False, False, False
    agree = local_agreement(ref, aligned)
    changed = ((agree < change_thr) & valid).astype(np.uint8)
    changed = cv2.morphologyEx(changed, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(changed, 8)
    keep = np.zeros_like(changed)
    min_area = min_blob_frac * changed.size
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            keep[lab == i] = 1
    ecc = info["ecc"]
    # share of the OUTPUT frame that has no counterpart in the input (outpainting = invented content)
    W = np.asarray(info["warp"], np.float64)
    if W.shape == (2, 3):
        W = np.vstack([W, [0, 0, 1]])
    H_, W_ = ref.shape[:2]
    covered = cv2.warpPerspective(np.full((H_, W_), 255, np.uint8), W, (W_, H_), flags=cv2.INTER_NEAREST)
    return {
        "structural": float(np.clip(agree[valid], 0, 1).mean()) if valid.any() else 0.0,
        "changed_area_pct": float(keep.sum() / max(valid.sum(), 1) * 100),
        "framing_kept_pct": float(info["valid_fraction"] * 100),
        "invented_area_pct": float((covered == 0).mean() * 100),
        "alignment_ok": bool(info["aligned"] and ecc == ecc and ecc > 0.5),
        "ecc": float(ecc) if ecc == ecc else None,
        "_agree": agree, "_changed": keep, "_aligned": aligned, "_valid": valid, "_ref": ref, "_warp": W,
    }


def overlay_rgba(s: dict, out_w: int, out_h: int) -> np.ndarray:
    """RGBA overlay in the OUTPUT frame: red where structure changed, blue where the output shows
    content that is not in the input at all (outpainting). Transparent elsewhere."""
    H_, W_ = s["_ref"].shape[:2]
    strength = (np.clip((0.35 - s["_agree"]) / 0.6, 0.35, 1) * s["_changed"]).astype(np.float32)
    ov = np.zeros((H_, W_, 4), np.float32)
    ov[..., 0], ov[..., 1], ov[..., 2] = 40, 40, 255          # BGR red
    ov[..., 3] = strength * 220
    edges = cv2.Canny((s["_changed"] * 255).astype(np.uint8), 50, 150) > 0
    ov[edges] = (0, 0, 255, 255)
    # reference frame -> stretched-candidate frame (x_cand = W x_ref), then to the real output size
    warped = cv2.warpPerspective(ov, s["_warp"], (W_, H_), flags=cv2.INTER_LINEAR,
                                 borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    covered = cv2.warpPerspective(np.full((H_, W_), 255, np.uint8), s["_warp"], (W_, H_), flags=cv2.INTER_NEAREST)
    invented = covered == 0
    warped[invented] = (255, 120, 40, 150)                     # BGR blue, semi-transparent
    return cv2.resize(warped, (out_w, out_h), interpolation=cv2.INTER_LINEAR).clip(0, 255).astype(np.uint8)


def heatmap(ref_bgr: np.ndarray, changed: np.ndarray, agree: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Input image desaturated + red where structure changed (+ grey hatch outside the kept frame)."""
    base = cv2.cvtColor(cv2.cvtColor(ref_bgr, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR).astype(np.float32)
    base = base * 0.55 + 90
    strength = np.clip((0.35 - agree) / 0.6, 0, 1) * changed
    red = np.zeros_like(base)
    red[..., 2] = 255
    a = (0.75 * strength)[..., None]
    out = base * (1 - a) + red * a
    outside = ~valid
    out[outside] = out[outside] * 0.4 + np.array([60, 60, 60]) * 0.6
    edges = cv2.Canny(changed * 255, 50, 150) > 0
    out[edges] = (0, 0, 255)
    return np.clip(out, 0, 255).astype(np.uint8)


@lru_cache(maxsize=1)
def _dino():
    import torch
    from transformers import AutoImageProcessor, AutoModel

    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    proc = AutoImageProcessor.from_pretrained("facebook/dinov2-small")
    model = AutoModel.from_pretrained("facebook/dinov2-small").to(dev).eval()
    return proc, model, dev


def semantic(input_bgr: np.ndarray, output_bgr: np.ndarray) -> float:
    import torch

    proc, model, dev = _dino()
    ims = [cv2.cvtColor(resize_to_width(x, 512), cv2.COLOR_BGR2RGB) for x in (input_bgr, output_bgr)]
    with torch.no_grad():
        batch = proc(images=ims, return_tensors="pt").to(dev)
        out = model(**batch)
        # mean of patch tokens + CLS: sensitive to local content, robust to colour/tone edits
        emb = torch.cat([out.last_hidden_state[:, 0], out.last_hidden_state[:, 1:].mean(1)], dim=1)
        emb = torch.nn.functional.normalize(emb, dim=1)
    return float((emb[0] * emb[1]).sum().cpu())

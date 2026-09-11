"""Full-reference quality on the synthetic-degradation subset (D01..D06 have a clean ground truth).

The output is registered onto the ground truth first (workflows may straighten/crop), then
PSNR / SSIM / LPIPS are computed on the overlapping region only.
"""

from __future__ import annotations

from functools import lru_cache

import cv2
import numpy as np
from skimage.metrics import peak_signal_noise_ratio, structural_similarity

from fotolab.align import align
from fotolab.imageio import resize_to_width

WORK_W = 768


@lru_cache(maxsize=1)
def _lpips():
    import lpips
    import torch

    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    return lpips.LPIPS(net="alex", verbose=False).to(dev).eval(), dev


def full_reference(output_bgr: np.ndarray, gt_bgr: np.ndarray) -> dict:
    import torch

    gt = resize_to_width(gt_bgr, WORK_W)
    out, mask, info = align(output_bgr, gt, work_width=640)
    valid = cv2.erode(mask, np.ones((9, 9), np.uint8)) > 0
    ys, xs = np.where(valid)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    g, o = gt[y0:y1, x0:x1], out[y0:y1, x0:x1]
    m = valid[y0:y1, x0:x1]
    psnr = peak_signal_noise_ratio(g[m], o[m], data_range=255)
    ssim_map = structural_similarity(cv2.cvtColor(g, cv2.COLOR_BGR2GRAY), cv2.cvtColor(o, cv2.COLOR_BGR2GRAY),
                                     data_range=255, full=True)[1]
    ssim = float(ssim_map[m].mean())
    net, dev = _lpips()
    t = lambda x: torch.from_numpy(cv2.cvtColor(x, cv2.COLOR_BGR2RGB)).permute(2, 0, 1)[None].float().div(127.5).sub(1).to(dev)
    o2 = np.where(m[..., None], o, g)  # outside the overlap: copy GT so it does not count
    with torch.no_grad():
        lp = float(net(t(g), t(o2)).item())
    return {"psnr": float(psnr), "ssim": ssim, "lpips": lp, "overlap_pct": float(valid.mean() * 100),
            "ecc": info["ecc"]}

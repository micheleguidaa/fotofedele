"""No-reference perceptual quality (learned IQA models via pyiqa): MUSIQ and TOPIQ-NR.

Used as an automatic, judge-independent quality signal and to check whether judges and
metrics agree (Spearman correlation in validate.py). Higher = better for both.
"""

from __future__ import annotations

from functools import lru_cache

import cv2
import numpy as np

from fotolab.imageio import resize_to_width


@lru_cache(maxsize=2)
def _metric(name: str):
    import pyiqa

    # CPU on purpose: MUSIQ's adaptive pooling is not implemented for arbitrary sizes on MPS
    return pyiqa.create_metric(name, device="cpu"), "cpu"


def score(img_bgr: np.ndarray) -> dict:
    import torch

    x = cv2.cvtColor(resize_to_width(img_bgr, 1024), cv2.COLOR_BGR2RGB)
    out = {}
    for name in ("musiq", "topiq_nr"):
        m, dev = _metric(name)
        t = torch.from_numpy(x).permute(2, 0, 1)[None].float().div(255).to(dev)
        with torch.no_grad():
            out[name.replace("_nr", "")] = float(m(t).item())
    return out

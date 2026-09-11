"""Trap set: known alterations and known-benign edits, to measure how well each fidelity
detector catches real content changes (precision / recall) without human labels.

- 6 ALTERED: an image model is explicitly asked to change content (the ground truth is "altered").
- 6 BENIGN: deterministic photometric/geometric edits only (the ground truth is "not altered").
"""

from __future__ import annotations

import json

import cv2
import numpy as np

from fotolab import DATA
from fotolab.imageio import load_bgr, resize_to_width, save_bgr

TRAPS = DATA / "traps"

ALTERED = [
    ("T01", "gt/G01.jpg", "oggetti_aggiunti_rimossi", "Oggetto aggiunto (pianta)",
     "Add a large green potted plant standing on the floor in front of the sofa. Keep everything else identical."),
    ("T02", "gt/G03.jpg", "oggetti_aggiunti_rimossi", "Oggetto rimosso (quadri)",
     "Remove the three framed pictures from the green wall, leaving the wall empty. Keep everything else identical."),
    ("T03", "real/R08.jpg", "finestre_vista_cambiata", "Vista dalla finestra sostituita",
     "Replace the view through the open window with a sunny sea view with blue sky. Keep everything else identical."),
    ("T04", "gt/G02.jpg", "materiali_colori_cambiati", "Pavimento cambiato",
     "Change the floor to warm light oak wooden parquet. Keep everything else identical."),
    ("T05", "real/R16.jpg", "difetti_nascosti", "Degrado nascosto",
     "Repair the room: remove the debris from the floor and the damage and stains from the walls, make it look clean and renovated. Keep the furniture and framing identical."),
    ("T06", "real/R12.jpg", "testi_loghi_alterati", "Watermark rimosso",
     "Remove the red and grey 'professionecasa' watermark text overlay from the photo. Keep everything else identical."),
]

BENIGN = [
    ("T07", "gt/G04.jpg", "Esposizione +0,7 EV"),
    ("T08", "gt/G05.jpg", "Bilanciamento del bianco più caldo"),
    ("T09", "gt/G06.jpg", "Contrasto e saturazione +15%"),
    ("T10", "real/R02.jpg", "Raddrizzata di 2° con ritaglio"),
    ("T11", "real/R07.jpg", "Riduzione rumore + nitidezza"),
    ("T12", "real/R17.jpg", "Ricompressione JPEG + ritaglio 3%"),
]


def _benign(img: np.ndarray, tid: str) -> np.ndarray:
    x = img.astype(np.float32) / 255.0
    if tid == "T07":
        x = np.power(np.clip(np.power(x, 2.2) * 2 ** 0.7, 0, 1), 1 / 2.2)
    elif tid == "T08":
        x = np.clip(x * np.array([0.90, 1.0, 1.10], np.float32), 0, 1)  # BGR: warmer
    elif tid == "T09":
        m = x.mean()
        x = np.clip((x - m) * 1.15 + m, 0, 1)
        hsv = cv2.cvtColor(x, cv2.COLOR_BGR2HSV)
        hsv[..., 1] = np.clip(hsv[..., 1] * 1.15, 0, 1)
        x = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
    out = (x * 255).round().astype(np.uint8)
    h, w = out.shape[:2]
    if tid == "T10":
        M = cv2.getRotationMatrix2D((w / 2, h / 2), 2.0, 1.0)
        out = cv2.warpAffine(out, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
        c = int(0.05 * w)
        out = out[c:h - c, c:w - c]
    elif tid == "T11":
        out = cv2.fastNlMeansDenoisingColored(out, None, 5, 5, 7, 21)
        out = cv2.addWeighted(out, 1.5, cv2.GaussianBlur(out, (0, 0), 1.2), -0.5, 0)
    elif tid == "T12":
        c = int(0.03 * w)
        out = out[c:h - c, c:w - c]
        ok, buf = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 55])
        out = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    return out


def build(seed: int = 7, log=print) -> list[dict]:
    from fotolab.workflows import comfyui

    TRAPS.mkdir(parents=True, exist_ok=True)
    items = []
    for tid, src, check, desc, instruction in ALTERED:
        orig = load_bgr(DATA / "inputs" / src)
        save_bgr(orig, TRAPS / f"{tid}_orig.jpg", quality=95)
        dst = TRAPS / f"{tid}_alt.png"
        if not dst.exists():
            name = comfyui.upload(TRAPS / f"{tid}_orig.jpg")
            comfyui.run(comfyui.load_graph("qwen_image_edit_2511", image=name, prompt=instruction,
                                           seed=seed, megapixels=1.0), dst)
            log(f"  {tid} generated")
        items.append({"id": tid, "type": check, "description": desc, "source": src, "instruction": instruction,
                      "original": f"{tid}_orig.jpg", "altered": dst.name, "is_alteration": True})
    for tid, src, desc in BENIGN:
        orig = load_bgr(DATA / "inputs" / src)
        save_bgr(orig, TRAPS / f"{tid}_orig.jpg", quality=95)
        save_bgr(_benign(orig, tid), TRAPS / f"{tid}_alt.jpg", quality=95)
        items.append({"id": tid, "type": "benigno", "description": desc, "source": src, "instruction": None,
                      "original": f"{tid}_orig.jpg", "altered": f"{tid}_alt.jpg", "is_alteration": False})
    (TRAPS / "traps.json").write_text(json.dumps(items, indent=1, ensure_ascii=False))
    return items

"""Dataset tooling: screen harvested Immobiliare.it candidates, build the curated set and manifest."""

from __future__ import annotations

import json
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image

from fotolab import DATA
from fotolab.imageio import load_bgr
from fotolab.metrics.technical import analyze, defects

RAW = DATA / "raw"
CANDIDATES = RAW / "candidates"


def _analyze_file(path: str) -> dict:
    try:
        m = analyze(load_bgr(path))
    except Exception as e:  # corrupt download etc.
        return {"file": Path(path).name, "error": str(e)}
    m["file"] = Path(path).name
    m["defects"] = ",".join(defects(m))
    return m


def screen(workers: int = 6) -> pd.DataFrame:
    files = sorted(str(p) for p in CANDIDATES.glob("*.jpg"))
    with ProcessPoolExecutor(workers) as ex:
        rows = list(ex.map(_analyze_file, files, chunksize=8))
    df = pd.DataFrame(rows)
    df["listing_id"] = df["file"].str.split("_").str[0]
    df["photo_id"] = df["file"].str.split("_").str[1].str.replace(".jpg", "", regex=False)
    # "badness": how far each metric is outside its target, normalised; graphics excluded
    df["badness"] = (
        np.clip(52 - df["exposure_L"], 0, None) / 10
        + np.clip(df["clip_high_pct"] - 6, 0, None) / 10
        + np.clip(df["cast"] - 4, 0, None) / 4
        + np.clip(df["tilt_deg"] - 0.75, 0, None) / 1.5
        + np.clip(120 - df["sharpness"], 0, None) / 60
        + np.clip(df["noise_sigma"] - 2.5, 0, None) / 1.5
    )
    df.loc[df["graphic_score"] > 0.45, "badness"] = -1
    df.to_csv(RAW / "screening.csv", index=False)
    return df


def _wm_score(name: str) -> float:
    from fotolab import watermark

    return watermark.score(CANDIDATES / name, np.load(RAW / "wm_template.npy"))


def add_watermark_scores(workers: int = 6) -> pd.DataFrame:
    df = pd.read_csv(RAW / "screening.csv", dtype={"listing_id": str, "photo_id": str})
    with ProcessPoolExecutor(workers) as ex:
        df["wm_score"] = list(ex.map(_wm_score, df["file"], chunksize=16))
    df.to_csv(RAW / "screening.csv", index=False)
    return df


def contact_sheet(files: list[str], out: Path, cols: int = 6, cell: int = 300, label: bool = True) -> Path:
    from PIL import ImageDraw

    rows = (len(files) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * (cell * 3 // 4 + 18)), "white")
    draw = ImageDraw.Draw(sheet)
    for k, f in enumerate(files):
        im = Image.open(CANDIDATES / f).convert("RGB")
        im.thumbnail((cell - 4, cell * 3 // 4 - 4))
        x, y = (k % cols) * cell, (k // cols) * (cell * 3 // 4 + 18)
        sheet.paste(im, (x + 2, y + 2))
        if label:
            draw.text((x + 4, y + cell * 3 // 4), f"{k}", fill="black")
    sheet.save(out, quality=82)
    return out


INPUTS = DATA / "inputs"
MANIFEST = INPUTS / "manifest.json"


def degrade(img_bgr: np.ndarray, rng: np.random.Generator) -> tuple[np.ndarray, dict]:
    """Composite, reproducible degradation that mimics a poor smartphone shot.

    Order: exposure drop -> colour cast -> tilt (+crop to hide borders) -> noise -> downscale -> JPEG.
    """
    import cv2

    p = {
        "ev": float(rng.uniform(-1.3, -0.8)),
        "cast": str(rng.choice(["warm", "cool", "green"])),
        "cast_strength": float(rng.uniform(0.08, 0.16)),
        "tilt_deg": float(rng.choice([-1, 1]) * rng.uniform(2.0, 4.0)),
        "noise_sigma": float(rng.uniform(3.0, 6.0)),
        "target_mp": float(rng.uniform(0.35, 0.5)),
        "jpeg_q": int(rng.integers(62, 75)),
    }
    x = img_bgr.astype(np.float32) / 255.0
    lin = np.power(x, 2.2) * (2.0 ** p["ev"])          # exposure in linear light
    x = np.power(np.clip(lin, 0, 1), 1 / 2.2)
    gains = {"warm": (0.85, 0.98, 1.12), "cool": (1.12, 1.0, 0.86), "green": (0.92, 1.1, 0.92)}[p["cast"]]
    s = p["cast_strength"] / 0.12
    x = np.clip(x * np.array([1 + (g - 1) * s for g in gains], np.float32), 0, 1)  # BGR gains
    h, w = x.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), p["tilt_deg"], 1.0)
    x = cv2.warpAffine(x, M, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REFLECT)
    t = np.radians(abs(p["tilt_deg"]))
    # largest axis-aligned crop inside the rotated frame (small-angle approximation)
    cw, ch = int(w - h * np.tan(t) * 1.05), int(h - w * np.tan(t) * 1.05)
    x0, y0 = (w - cw) // 2, (h - ch) // 2
    x = x[y0:y0 + ch, x0:x0 + cw]
    x = np.clip(x + rng.normal(0, p["noise_sigma"] / 255.0, x.shape).astype(np.float32), 0, 1)
    scale = np.sqrt(p["target_mp"] * 1e6 / (x.shape[0] * x.shape[1]))
    x = cv2.resize(x, (int(x.shape[1] * scale), int(x.shape[0] * scale)), interpolation=cv2.INTER_AREA)
    out = (x * 255).round().astype(np.uint8)
    ok, buf = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, p["jpeg_q"]])
    p["crop_box_in_original"] = [x0, y0, cw, ch]
    return cv2.imdecode(buf, cv2.IMREAD_COLOR), p


def build_inputs(real: list[dict], clean: list[dict], seed: int = 7) -> list[dict]:
    """Copy curated photos into data/inputs and write the manifest.

    real:  [{"file", "note"}] poor listing photos used as-is (ids R01..)
    clean: [{"file", "room"}] good listing photos; each gets a degraded twin (G.. clean, D.. degraded)
    """
    import shutil

    from fotolab.imageio import save_bgr

    rng = np.random.default_rng(seed)
    screening = pd.read_csv(RAW / "screening.csv", dtype={"listing_id": str, "photo_id": str}).set_index("file")
    (INPUTS / "real").mkdir(parents=True, exist_ok=True)
    (INPUTS / "gt").mkdir(parents=True, exist_ok=True)
    items = []

    def source(fname: str) -> dict:
        lid, pid = fname.replace(".jpg", "").split("_")
        return {"listing_url": f"https://www.immobiliare.it/annunci/{lid}/",
                "photo_url": f"https://pwm.im-cdn.it/image/{pid}/xxl.jpg",
                "listing_id": lid, "photo_id": pid}

    for i, r in enumerate(real, 1):
        iid = f"R{i:02d}"
        shutil.copy(CANDIDATES / r["file"], INPUTS / "real" / f"{iid}.jpg")
        m = screening.loc[r["file"]]
        items.append({"id": iid, "kind": "real", "path": f"real/{iid}.jpg", "note": r["note"],
                      "auto_defects": [d for d in str(m["defects"]).split(",") if d and d != "nan"],
                      **source(r["file"])})
    for i, c in enumerate(clean, 1):
        gid, did = f"G{i:02d}", f"D{i:02d}"
        img = load_bgr(CANDIDATES / c["file"])
        save_bgr(img, INPUTS / "gt" / f"{gid}.jpg", quality=97)
        bad, params = degrade(img, rng)
        save_bgr(bad, INPUTS / "gt" / f"{did}.jpg", quality=97)
        src = source(c["file"])
        items.append({"id": gid, "kind": "clean", "path": f"gt/{gid}.jpg", "note": c["room"], **src})
        items.append({"id": did, "kind": "degraded", "path": f"gt/{did}.jpg", "note": c["room"],
                      "ground_truth": gid, "degradation": params, **src})
    MANIFEST.write_text(json.dumps(items, indent=1, ensure_ascii=False))
    return items

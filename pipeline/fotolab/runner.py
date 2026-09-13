"""Run workflows over the dataset and log one record per run (the raw material for all metrics).

Outputs:  data/runs/<WF>/<INPUT>[_r<rep>].png
Records:  data/runs/records.jsonl  (append-only; the latest record per key wins)
"""

from __future__ import annotations

import json
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import yaml
from PIL import Image

from fotolab import CONFIG, DATA
from fotolab.imageio import load_bgr, save_bgr

RUNS = DATA / "runs"
RECORDS = RUNS / "records.jsonl"
INPUTS = DATA / "inputs"
_lock = threading.Lock()


def load_config() -> dict:
    return yaml.safe_load((CONFIG / "workflows.yaml").read_text())


def workflows() -> dict[str, dict]:
    return {w["id"]: w for w in load_config()["workflows"]}


def manifest() -> list[dict]:
    return json.loads((INPUTS / "manifest.json").read_text())


def test_inputs() -> list[dict]:
    """Inputs the workflows run on: real poor photos + synthetically degraded twins."""
    return [m for m in manifest() if m["kind"] in ("real", "degraded")]


def out_path(wf: str, input_id: str, rep: int = 0) -> Path:
    return RUNS / wf / (f"{input_id}.png" if rep == 0 else f"{input_id}_r{rep}.png")


def records() -> dict[tuple, dict]:
    """Latest record per (wf, input, rep)."""
    latest: dict[tuple, dict] = {}
    if RECORDS.exists():
        for line in RECORDS.read_text().splitlines():
            if line.strip():
                r = json.loads(line)
                latest[(r["wf"], r["input"], r.get("rep", 0))] = r
    return latest


def _append(rec: dict) -> None:
    RUNS.mkdir(parents=True, exist_ok=True)
    with _lock, open(RECORDS, "a") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def _prompt(wf: dict) -> str | None:
    return (CONFIG / "prompts" / f"{wf['prompt']}.md").read_text() if wf.get("prompt") else None


def _esrgan(img):
    """Real-ESRGAN x4 on the VM through ComfyUI (used by F1 below 0.6 MP)."""
    import tempfile

    from fotolab.workflows import comfyui

    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "sr_in.png"
        save_bgr(img, src)
        name = comfyui.upload(src)
        dst = Path(tmp) / "sr_out.png"
        info = comfyui.run(comfyui.load_graph("realesrgan_x4", image=name), dst)
        _esrgan.last_gpu_s = info.get("gpu_seconds") or 0.0
        return load_bgr(dst)


def run_one(wf: dict, item: dict, rep: int = 0) -> dict:
    src = INPUTS / item["path"]
    dst = out_path(wf["id"], item["id"], rep)
    rec = {"wf": wf["id"], "input": item["id"], "rep": rep, "engine": wf["engine"],
           "started_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    t0 = time.time()
    try:
        engine = wf["engine"]
        meta: dict = {}
        if engine == "classical":
            from fotolab.workflows import classical

            _esrgan.last_gpu_s = 0.0
            out, ops = classical.enhance(load_bgr(src), sr_fn=_esrgan)
            save_bgr(out, dst)
            meta = {"ops": ops}
            gpu_s = _esrgan.last_gpu_s
        elif engine == "codex_image":
            from fotolab.workflows import codex_image

            meta = codex_image.run(src, _prompt(wf), dst)
            gpu_s = None
        elif engine == "comfy_qwen":
            from fotolab.workflows import comfyui

            p = wf.get("params", {})
            name = comfyui.upload(src)
            graph = comfyui.load_graph("qwen_image_edit_2511", image=name, prompt=_prompt(wf),
                                       seed=int(p.get("seed", 42)) + rep, megapixels=float(p.get("megapixels", 1.0)))
            meta = comfyui.run(graph, dst)
            gpu_s = meta.get("gpu_seconds")
        elif engine == "gemini_image":
            from fotolab.workflows import gemini_image

            meta = gemini_image.run(src, _prompt(wf), dst)
            gpu_s = None
        else:
            raise ValueError(f"unknown engine {engine}")
        with Image.open(dst) as im:
            w, h = im.size
        rec.update(status="ok", out=str(dst.relative_to(DATA)), out_w=w, out_h=h, gpu_seconds=gpu_s, meta=meta)
    except Exception as e:  # failures are data (reliability metric), never crash the batch
        rec.update(status="error", error=f"{type(e).__name__}: {e}"[:600], trace=traceback.format_exc()[-1500:])
    rec["wall_seconds"] = round(time.time() - t0, 2)
    _append(rec)
    return rec


def run(wf_ids: list[str], limit: int | None = None, only: list[str] | None = None, force: bool = False,
        reps: int = 1, concurrency: int = 1, log=print) -> list[dict]:
    wfs = workflows()
    items = test_inputs()
    if only:
        items = [i for i in items if i["id"] in only]
    if limit:
        items = items[:limit]
    done = records()
    jobs = []
    for wid in wf_ids:
        for item in items:
            for rep in range(reps):
                r = done.get((wid, item["id"], rep))
                if not force and r and r["status"] == "ok" and out_path(wid, item["id"], rep).exists():
                    continue
                jobs.append((wfs[wid], item, rep))
    log(f"{len(jobs)} runs to do")
    results = []

    def _do(job):
        rec = run_one(*job)
        log(f"  {rec['wf']} {rec['input']} r{rec['rep']}: {rec['status']} {rec['wall_seconds']}s"
            + (f"  ! {rec.get('error', '')[:120]}" if rec["status"] != "ok" else ""))
        return rec

    if concurrency <= 1:
        results = [_do(j) for j in jobs]
    else:
        with ThreadPoolExecutor(concurrency) as ex:
            results = list(ex.map(_do, jobs))
    return results

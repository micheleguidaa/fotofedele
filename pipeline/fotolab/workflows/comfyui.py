"""Minimal ComfyUI HTTP client: upload an image, queue an API-format graph, fetch the output."""

from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path

import requests

from fotolab import CONFIG

COMFY_URL = os.environ.get("COMFY_URL", "http://10.183.16.2:8188")


def load_graph(name: str, **params) -> dict:
    """Load config/comfy/<name>.json and substitute {{placeholders}} (numbers stay numbers)."""
    graph = json.loads((CONFIG / "comfy" / f"{name}.json").read_text())

    def fill(v):
        if isinstance(v, str) and v.startswith("{{") and v.endswith("}}"):
            return params[v[2:-2]]
        if isinstance(v, list):
            return [fill(x) for x in v]
        if isinstance(v, dict):
            return {k: fill(x) for k, x in v.items()}
        return v

    return fill(graph)


def upload(path: Path) -> str:
    with open(path, "rb") as f:
        r = requests.post(f"{COMFY_URL}/upload/image",
                          files={"image": (Path(path).name, f, "image/jpeg")},
                          data={"subfolder": "fotofedele", "overwrite": "true"}, timeout=60)
    r.raise_for_status()
    j = r.json()
    return f"{j['subfolder']}/{j['name']}" if j.get("subfolder") else j["name"]


def run(graph: dict, out_path: Path, timeout_s: int = 900) -> dict:
    """Queue `graph`, wait for completion, save the first output image to out_path."""
    client_id = uuid.uuid4().hex
    r = requests.post(f"{COMFY_URL}/prompt", json={"prompt": graph, "client_id": client_id}, timeout=60)
    if r.status_code != 200:
        raise RuntimeError(f"ComfyUI rejected graph: {r.text[:500]}")
    pid = r.json()["prompt_id"]
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        h = requests.get(f"{COMFY_URL}/history/{pid}", timeout=30).json()
        if pid in h:
            entry = h[pid]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(f"ComfyUI error: {json.dumps(status.get('messages', []))[:800]}")
            for node_out in entry.get("outputs", {}).values():
                for img in node_out.get("images", []):
                    v = requests.get(f"{COMFY_URL}/view", params=img, timeout=120)
                    v.raise_for_status()
                    out_path.parent.mkdir(parents=True, exist_ok=True)
                    out_path.write_bytes(v.content)
                    # execution time as reported by ComfyUI (excludes queue wait)
                    msgs = {m[0]: m[1] for m in status.get("messages", []) if isinstance(m, list)}
                    start = msgs.get("execution_start", {}).get("timestamp")
                    end = msgs.get("execution_success", {}).get("timestamp")
                    gpu_s = (end - start) / 1000 if start and end else None
                    return {"prompt_id": pid, "gpu_seconds": gpu_s, "wall_seconds": time.time() - t0}
        time.sleep(1.0)
    raise TimeoutError(f"ComfyUI job {pid} timed out")

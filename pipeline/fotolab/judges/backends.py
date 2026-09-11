"""Judge backends: Ollama (open-weights VLMs on the H200 VM) and Codex (GPT on the ChatGPT subscription)."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import requests

from fotolab.judges.base import SCHEMA, b64, encode_jpeg, parse_json, prompt

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://10.183.16.2:11434")


def ask_ollama(model: str, img_a: str, img_b: str, timeout: int = 600) -> tuple[dict, dict]:
    body = {"model": model, "stream": False, "format": SCHEMA, "think": False,
            "options": {"temperature": 0, "num_ctx": 8192},
            "messages": [{"role": "user", "content": prompt(), "images": [b64(img_a), b64(img_b)]}]}
    t0 = time.time()
    r = requests.post(f"{OLLAMA_URL}/api/chat", json=body, timeout=timeout)
    r.raise_for_status()
    d = r.json()
    return parse_json(d["message"]["content"]), {"latency_s": round(time.time() - t0, 2),
                                                 "eval_count": d.get("eval_count")}


def ask_codex(img_a: str, img_b: str, timeout: int = 600) -> tuple[dict, dict]:
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        a, b = tmp / "foto_A.jpg", tmp / "foto_B.jpg"
        a.write_bytes(encode_jpeg(img_a))
        b.write_bytes(encode_jpeg(img_b))
        (tmp / "schema.json").write_text(json.dumps(SCHEMA))
        last = tmp / "last.txt"
        text = ("Do not use any tool, do not run commands, do not generate images: just look at the two "
                "attached images and answer.\n\n" + prompt())
        cmd = ["codex", "exec", "--skip-git-repo-check", "-s", "read-only", "-C", str(tmp),
               "--output-schema", str(tmp / "schema.json"), "-o", str(last), text, "-i", str(a), str(b)]
        t0 = time.time()
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
        if not last.exists() or not last.read_text().strip():
            raise RuntimeError(f"codex judge failed (exit {proc.returncode}): {proc.stderr[-300:]}")
        return parse_json(last.read_text()), {"latency_s": round(time.time() - t0, 2)}

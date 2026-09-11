"""gpt-image through the Codex CLI (ChatGPT subscription, built-in `image_gen` tool).

`codex exec` runs an agent turn; the agent calls image_gen with the attached photo as
edit target and the generated PNG lands in ~/.codex/generated_images/<thread_id>/.
Caveat (documented in the README): the agent may reformat the prompt; we instruct
it to pass ours verbatim, and latency includes agent overhead.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

CODEX_IMAGES = Path.home() / ".codex" / "generated_images"

WRAPPER = (
    "Use the built-in image_gen tool to EDIT the attached photo (it is the edit target, a real-estate "
    "listing photo). Pass the instructions below to image_gen VERBATIM, without rewriting, adding or "
    "removing anything. Generate exactly one image. Do not run shell commands and do not create files. "
    "When done, reply only with: DONE\n\n--- INSTRUCTIONS ---\n{prompt}"
)


def run(input_path: Path, prompt: str, out_path: Path, timeout_s: int = 600) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / f"input{input_path.suffix}"
        shutil.copy(input_path, src)
        cmd = ["codex", "exec", "--skip-git-repo-check", "--json", "-s", "read-only", "-C", tmp,
               WRAPPER.format(prompt=prompt.strip()), "-i", str(src)]
        t0 = time.time()
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_s, stdin=subprocess.DEVNULL)
        wall = time.time() - t0
    thread_id, usage, messages = None, None, []
    for line in proc.stdout.splitlines():
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        if e.get("type") == "thread.started":
            thread_id = e.get("thread_id")
        elif e.get("type") == "turn.completed":
            usage = e.get("usage")
        elif e.get("type") == "item.completed" and (e.get("item") or {}).get("type") == "agent_message":
            messages.append(e["item"].get("text", ""))
    if not thread_id:
        raise RuntimeError(f"codex produced no thread (exit {proc.returncode}): {proc.stderr[-400:]}")
    imgs = sorted((CODEX_IMAGES / thread_id).glob("*.png"), key=lambda p: p.stat().st_mtime)
    if not imgs:
        raise RuntimeError(f"codex returned no image (thread {thread_id}); agent said: {' | '.join(messages)[:300]}")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(imgs[-1], out_path)
    return {"wall_seconds": wall, "thread_id": thread_id, "n_images": len(imgs), "usage": usage,
            "agent_messages": messages[-2:]}

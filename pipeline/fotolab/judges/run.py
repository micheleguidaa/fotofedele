"""Run judges over (input, output) pairs, ground-truth sanity pairs and trap pairs.

Records: data/judges/<judge>.jsonl, one line per (pair, order). Both orders are asked for
the free judges; for GPT (quota-limited subscription) both orders only on a subset.
"""

from __future__ import annotations

import json
import random
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fotolab import DATA
from fotolab.judges import backends
from fotolab.judges.base import JUDGES, Pair, to_roles

JUDGE_DIR = DATA / "judges"
_lock = threading.Lock()


def output_pairs(wf_ids: list[str]) -> list[Pair]:
    from fotolab.runner import INPUTS, out_path, records, test_inputs

    recs = records()
    pairs = []
    for item in test_inputs():
        for wf in wf_ids:
            r = recs.get((wf, item["id"], 0))
            if r and r["status"] == "ok" and out_path(wf, item["id"]).exists():
                pairs.append(Pair(f"{item['id']}:{wf}", str(INPUTS / item["path"]), str(out_path(wf, item["id"])), "output"))
    return pairs


def gt_pairs() -> list[Pair]:
    """Degraded (as 'input') vs clean ground truth (as 'output'): judges should prefer the output."""
    from fotolab.runner import INPUTS, manifest

    return [Pair(f"GT:{m['id']}", str(INPUTS / m["path"]), str(INPUTS / "gt" / f"{m['ground_truth']}.jpg"), "gt")
            for m in manifest() if m["kind"] == "degraded"]


def trap_pairs() -> list[Pair]:
    tdir = DATA / "traps"
    man = tdir / "traps.json"
    if not man.exists():
        return []
    return [Pair(f"TRAP:{t['id']}", str(tdir / t["original"]), str(tdir / t["altered"]), "trap")
            for t in json.loads(man.read_text())]


def done_keys(judge: str) -> set[tuple[str, bool]]:
    f = JUDGE_DIR / f"{judge}.jsonl"
    keys = set()
    if f.exists():
        for line in f.read_text().splitlines():
            r = json.loads(line)
            if r.get("status") == "ok":
                keys.add((r["pair_id"], r["input_first"]))
    return keys


def ask(judge: str, pair: Pair, input_first: bool) -> dict:
    spec = JUDGES[judge]
    a, b = (pair.input_path, pair.output_path) if input_first else (pair.output_path, pair.input_path)
    rec = {"judge": judge, "pair_id": pair.pair_id, "kind": pair.kind, "input_first": input_first}
    try:
        if spec["backend"] == "ollama":
            ans, meta = backends.ask_ollama(spec["model"], a, b)
        else:
            ans, meta = backends.ask_codex(a, b)
        rec.update(status="ok", raw=ans, **to_roles(ans, input_first), **meta)
    except Exception as e:
        rec.update(status="error", error=f"{type(e).__name__}: {e}"[:400])
    JUDGE_DIR.mkdir(parents=True, exist_ok=True)
    with _lock, open(JUDGE_DIR / f"{judge}.jsonl", "a") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return rec


def run(judge: str, pairs: list[Pair], both_orders: bool = True, swap_fraction: float = 1.0,
        concurrency: int = 1, seed: int = 0, log=print) -> None:
    rng = random.Random(f"{seed}:{judge}")
    done = done_keys(judge)
    jobs = []
    for p in pairs:
        first = rng.random() < 0.5            # random order for the first ask
        orders = [first]
        if both_orders and (swap_fraction >= 1 or rng.random() < swap_fraction):
            orders.append(not first)
        jobs += [(p, o) for o in orders if (p.pair_id, o) not in done]
    log(f"[{judge}] {len(jobs)} calls to do")

    def _do(job):
        r = ask(judge, *job)
        log(f"  [{judge}] {r['pair_id']} input_first={r['input_first']}: {r['status']}"
            + (f" pref={r.get('preferred')} {r.get('latency_s')}s" if r["status"] == "ok" else f" ! {r.get('error', '')[:100]}"))
        return r

    if concurrency <= 1:
        for j in jobs:
            _do(j)
    else:
        with ThreadPoolExecutor(concurrency) as ex:
            list(ex.map(_do, jobs))

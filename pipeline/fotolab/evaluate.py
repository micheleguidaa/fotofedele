"""Compute every automatic metric for inputs, workflow outputs and trap pairs (cached).

data/metrics/inputs.json         technical metrics + IQA of each input (and ground truth)
data/metrics/outputs.jsonl       one line per (wf, input): technical, defects fixed/new,
                                 fidelity (structural, changed area, framing, invented area,
                                 semantic), full-reference vs ground truth, IQA
data/metrics/heatmaps/<WF>/<ID>.png   RGBA overlay in the output frame
data/metrics/traps.json          detector signals on the trap pairs
"""

from __future__ import annotations

import json
import os

import cv2

from fotolab import DATA
from fotolab.imageio import load_bgr
from fotolab.metrics import fidelity, iqa, reference, technical

MET = DATA / "metrics"


def _clean(d: dict) -> dict:
    return {k: v for k, v in d.items() if not k.startswith("_")}


def input_metrics(force: bool = False, log=print) -> dict:
    from fotolab.runner import INPUTS, manifest

    f = MET / "inputs.json"
    cache = json.loads(f.read_text()) if f.exists() and not force else {}
    for m in manifest():
        if m["id"] in cache:
            continue
        img = load_bgr(INPUTS / m["path"])
        t = technical.analyze(img)
        cache[m["id"]] = {"technical": t, "defects": technical.defects(t), "iqa": iqa.score(img)}
        log(f"  input {m['id']}")
    MET.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(cache, indent=1))
    return cache


def output_metrics(force: bool = False, log=print) -> dict:
    from fotolab.runner import INPUTS, manifest, out_path, records

    MET.mkdir(parents=True, exist_ok=True)
    f = MET / "outputs.jsonl"
    cache: dict = {}
    if f.exists() and not force:
        for line in f.read_text().splitlines():
            r = json.loads(line)
            cache[(r["wf"], r["input"])] = r
    inputs = input_metrics(log=log)
    man = {m["id"]: m for m in manifest()}
    new = []
    for (wf, iid, rep), rec in sorted(records().items()):
        if rep != 0 or rec["status"] != "ok":
            continue
        p = out_path(wf, iid)
        if not p.exists():
            continue
        mtime = os.path.getmtime(p)
        c = cache.get((wf, iid))
        if c and c.get("mtime") == mtime:
            continue
        item = man[iid]
        I, O = load_bgr(INPUTS / item["path"]), load_bgr(p)
        t = technical.analyze(O)
        d_in = set(inputs[iid]["defects"])
        d_out = set(technical.defects(t))
        s = fidelity.structural(I, O)
        hm = MET / "heatmaps" / wf / f"{iid}.png"
        hm.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(hm), fidelity.overlay_rgba(s, O.shape[1], O.shape[0]))
        row = {"wf": wf, "input": iid, "mtime": mtime, "technical": t,
               "defects_after": sorted(d_out), "fixed": sorted(d_in - d_out),
               "remaining": sorted(d_in & d_out), "new": sorted(d_out - d_in),
               "fidelity": {**_clean(s), "semantic": fidelity.semantic(I, O)},
               "heatmap": str(hm.relative_to(DATA)), "iqa": iqa.score(O)}
        if item["kind"] == "degraded":
            row["full_ref"] = reference.full_reference(O, load_bgr(INPUTS / "gt" / f"{item['ground_truth']}.jpg"))
            row["full_ref_input"] = reference.full_reference(I, load_bgr(INPUTS / "gt" / f"{item['ground_truth']}.jpg"))
        cache[(wf, iid)] = row
        new.append(row)
        log(f"  {wf} {iid}: struct={s['structural']:.3f} changed={s['changed_area_pct']:.1f}% "
            f"invented={s['invented_area_pct']:.1f}% sem={row['fidelity']['semantic']:.3f}")
    with open(f, "w") as fh:
        for row in cache.values():
            fh.write(json.dumps(row) + "\n")
    log(f"{len(new)} outputs evaluated, {len(cache)} total")
    return cache


def trap_metrics(log=print) -> list[dict]:
    from fotolab.traps import TRAPS

    items = json.loads((TRAPS / "traps.json").read_text())
    out = []
    for t in items:
        I, O = load_bgr(TRAPS / t["original"]), load_bgr(TRAPS / t["altered"])
        s = fidelity.structural(I, O)
        hm = MET / "heatmaps" / "traps" / f"{t['id']}.png"
        hm.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(hm), fidelity.overlay_rgba(s, O.shape[1], O.shape[0]))
        out.append({**t, "fidelity": {**_clean(s), "semantic": fidelity.semantic(I, O)},
                    "heatmap": str(hm.relative_to(DATA))})
        log(f"  {t['id']} alt={t['is_alteration']}: struct={s['structural']:.3f} "
            f"changed={s['changed_area_pct']:.1f}% sem={out[-1]['fidelity']['semantic']:.3f}")
    (MET / "traps.json").write_text(json.dumps(out, indent=1))
    return out

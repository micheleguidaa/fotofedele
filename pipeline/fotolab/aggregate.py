"""Aggregate runs + metrics + judges into web/public/data/results.json (contract: web/lib/types.ts).

Also exports web-ready images (WebP): inputs, ground truths, outputs, thumbnails, RGBA heatmaps
and trap pairs under web/public/data/images/.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import yaml
from PIL import Image

from fotolab import CONFIG, DATA, ROOT
from fotolab.judges.base import CHECKS, CRITERIA, JUDGES

WEB_DATA = ROOT.parent / "web" / "public" / "data"
IMG_MAX, THUMB_MAX = 1400, 480
JUDGE_FAMILY = {k: v["family"] for k, v in JUDGES.items()}
JUDGE_NAME = {"gpt": "GPT", "gemma": "Gemma 4", "qwen": "Qwen 3.8"}
JUDGE_MODEL = {"gpt": "GPT via Codex CLI (abbonamento ChatGPT)", "gemma": "gemma4:31b open weights, Ollama su H200",
               "qwen": "qwen3.8:27b open weights, Ollama su H200"}
CHECK_LABEL = {
    "oggetti_aggiunti_rimossi": "oggetti aggiunti o rimossi",
    "finestre_vista_cambiata": "vista da finestre/porte cambiata",
    "materiali_colori_cambiati": "materiali o colori delle superfici cambiati",
    "geometria_stanza_alterata": "geometria della stanza alterata",
    "difetti_nascosti": "difetti o degrado nascosti",
    "testi_loghi_alterati": "testi, loghi o watermark alterati",
}
DEFECT_LABEL = {"buia": "foto buia", "sovraesposta": "sovraesposta", "dominante": "dominante di colore",
                "storta": "verticali storte", "sfocata": "poco nitida", "rumorosa": "rumore",
                "bassa_risoluzione": "bassa risoluzione"}


# ----------------------------------------------------------------------------- loading

def _cfg():
    wf = yaml.safe_load((CONFIG / "workflows.yaml").read_text())
    dec = yaml.safe_load((CONFIG / "decision.yaml").read_text())
    return wf, dec


def _jsonl(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()] if path.exists() else []


def load_judge_records() -> dict[str, dict[str, list[dict]]]:
    """judge -> pair_id -> [latest ok record per order]"""
    out: dict = {}
    for j in JUDGES:
        latest: dict = {}
        for r in _jsonl(DATA / "judges" / f"{j}.jsonl"):
            if r["status"] == "ok":
                latest[(r["pair_id"], r["input_first"])] = r
        per_pair = defaultdict(list)
        for (pid, _), r in latest.items():
            per_pair[pid].append(r)
        if per_pair:
            out[j] = dict(per_pair)
    return out


def reconcile(recs: list[dict], orders_rule: str = "any") -> dict:
    prefs = [r["preferred"] for r in recs]
    if len(recs) >= 2:
        consistent = prefs[0] == prefs[1]
        preferred = prefs[0] if consistent else "tie"
    else:
        consistent, preferred = None, prefs[0]
    comb = any if orders_rule == "any" else all
    return {
        "preferred": preferred,
        "position_consistent": consistent,
        "rubric_output": {c: float(np.mean([r["rubric_output"][c] for r in recs])) for c in CRITERIA},
        "rubric_input": {c: float(np.mean([r["rubric_input"][c] for r in recs])) for c in CRITERIA},
        "checklist": {c: bool(comb(r["checklist"][c] for r in recs)) for c in CHECKS},
        "notes": recs[0]["notes"],
        "n_orders": len(recs),
    }


# ----------------------------------------------------------------------------- fidelity decision

def fidelity_decision(fm: dict, verdicts: dict[str, dict], family: str, fcfg: dict) -> dict:
    """Final 'combined' detector: structural signals OR a quorum of unconflicted judges."""
    reasons, breakdown = [], set()
    if fm["changed_area_pct"] > fcfg["changed_area_pct_max"]:
        reasons.append(f"struttura cambiata sul {fm['changed_area_pct']:.0f}% dell'immagine")
        breakdown.add("strutturale")
    if fm.get("invented_area_pct", 0) > fcfg["invented_area_pct_max"]:
        reasons.append(f"{fm['invented_area_pct']:.0f}% dell'immagine non esiste nell'originale (contenuto inventato ai bordi)")
        breakdown.add("strutturale")
    if fm["framing_kept_pct"] < fcfg["framing_kept_pct_min"]:
        reasons.append(f"inquadratura ridotta: resta visibile solo il {fm['framing_kept_pct']:.0f}% dell'originale")
        breakdown.add("geometria_stanza_alterata")
    if not fm["alignment_ok"]:
        reasons.append("l'immagine non è sovrapponibile all'originale (geometria diversa)")
        breakdown.add("geometria_stanza_alterata")
    used = {j: v for j, v in verdicts.items() if JUDGE_FAMILY[j] != family}
    majority = {c: False for c in CHECKS}
    if used:
        need = max(1, math.ceil(fcfg["judge_quorum"] * len(used) - 1e-9))
        for c in CHECKS:
            n = sum(v["checklist"][c] for v in used.values())
            if n >= need:
                majority[c] = True
                reasons.append(f"{CHECK_LABEL[c]} (segnalato da {n} giudici su {len(used)})")
                breakdown.add(c)
    return {"flag": bool(reasons), "flag_reasons": reasons, "checklist_majority": majority,
            "breakdown": sorted(breakdown)}


# ----------------------------------------------------------------------------- image export

def _export(src: Path, dst_rel: str, max_side: int, quality: int = 80, rgba: bool = False) -> dict:
    dst = WEB_DATA / dst_rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    im = Image.open(src)
    im = im.convert("RGBA" if rgba else "RGB")
    if max(im.size) > max_side:
        im.thumbnail((max_side, max_side), Image.LANCZOS)
    im.save(dst, "WEBP", quality=quality, method=5)
    return {"src": dst_rel, "w": im.size[0], "h": im.size[1]}


def _export_pair(src: Path, base: str, rgba: bool = False) -> dict:
    full = _export(src, f"{base}.webp", IMG_MAX, rgba=rgba)
    full["thumb"] = _export(src, f"{base}_t.webp", THUMB_MAX, quality=72, rgba=rgba)["src"]
    return full


# ----------------------------------------------------------------------------- stats helpers

def bootstrap_ci(values: list[float], n: int = 2000, seed: int = 0) -> tuple[float, float]:
    if not values:
        return (0.0, 0.0)
    rng = np.random.default_rng(seed)
    v = np.asarray(values, float)
    means = v[rng.integers(0, len(v), (n, len(v)))].mean(1)
    return float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


def krippendorff_nominal(units: list[dict[str, str]]) -> float:
    """units: one {judge: label} dict per rated item (missing judges = missing values)."""
    try:
        import krippendorff

        judges = sorted({j for u in units for j in u})
        labels = sorted({l for u in units for l in u.values()})
        idx = {l: i for i, l in enumerate(labels)}
        mat = np.full((len(judges), len(units)), np.nan)
        for k, u in enumerate(units):
            for r, j in enumerate(judges):
                if j in u:
                    mat[r, k] = idx[u[j]]
        return float(krippendorff.alpha(reliability_data=mat, level_of_measurement="nominal"))
    except Exception:
        return float("nan")


def compute_scores(items: list[dict], weights: dict) -> dict:
    """Python twin of web/lib/score.ts computeScores (keep in sync)."""
    s = sum(max(v, 0) for v in weights.values()) or 1
    w = {k: max(v, 0) / s for k, v in weights.items()}
    passing = [i for i in items if i["passes"]]
    MIN = 1e-5
    costs = [max(i["cost"], MIN) for i in passing] or [MIN]
    lat = [i["latency"] for i in passing] or [0]
    mnc, mxc, mnl, mxl = min(costs), max(costs), min(lat), max(lat)
    out = {}
    for i in items:
        if not i["passes"]:
            out[i["id"]] = None
            continue
        cs = 1.0 if not mxc > mnc else 1 - math.log10(max(i["cost"], MIN) / mnc) / math.log10(mxc / mnc)
        ss = 1.0 if not mxl > mnl else 1 - (i["latency"] - mnl) / (mxl - mnl)
        out[i["id"]] = (w["quality"] * i["winrate"] + w["naturalness"] * (i["naturalezza"] - 1) / 4
                        + w["cost"] * cs + w["speed"] * ss)
    ranked = sorted([k for k, v in out.items() if v is not None], key=lambda k: (-round(out[k], 4), k))
    ranks, prev, prev_rank = {}, None, 0
    for idx, k in enumerate(ranked):
        r = prev_rank if prev is not None and round(out[k], 4) == prev else idx + 1
        ranks[k], prev, prev_rank = r, round(out[k], 4), r
    return {k: (out[k], ranks.get(k)) for k in out}


def _tech(t: dict) -> dict:
    keys = ["exposure_L", "clip_high_pct", "cast", "tilt_deg", "sharpness", "noise_sigma", "megapixels", "width", "height"]
    return {k: (round(float(t[k]), 3) if k not in ("width", "height") else int(t[k])) for k in keys}


# ----------------------------------------------------------------------------- main

def build(export_images: bool = True, log=print) -> dict:
    from fotolab.runner import INPUTS, manifest, out_path, records

    wf_cfg, dec = _cfg()
    fcfg = dec["fidelity"]
    workflows = [w for w in wf_cfg["workflows"] if w.get("enabled", True)]
    wf_by_id = {w["id"]: w for w in workflows}
    man = manifest()
    tests = [m for m in man if m["kind"] in ("real", "degraded")]
    recs = records()
    in_met = json.loads((DATA / "metrics" / "inputs.json").read_text())
    out_met = {(r["wf"], r["input"]): r for r in _jsonl(DATA / "metrics" / "outputs.jsonl")}
    judges = load_judge_records()
    rules = fcfg["judge_orders_rule"]
    h200 = float(wf_cfg.get("h200_usd_per_hour", 4.4))

    def scope(wid: str) -> list[str]:
        sub = wf_by_id[wid].get("subset")
        return sub if sub else [m["id"] for m in tests]

    # ---- per image / per output
    images, per_wf_rows = [], defaultdict(list)
    for m in tests:
        iid = m["id"]
        base = f"images/{iid}"
        inp = {"src": f"{base}/input.webp", "w": 0, "h": 0}
        if export_images:
            inp = _export_pair(INPUTS / m["path"], f"{base}/input")
        im_in = in_met[iid]
        item = {
            "id": iid, "kind": m["kind"], "note": m["note"], "source_url": m["listing_url"],
            "input": {**inp, "metrics": _tech(im_in["technical"]), "defects": im_in["defects"]},
            "ground_truth": None, "degradation": None, "outputs": {},
        }
        if m["kind"] == "degraded":
            gt_path = INPUTS / "gt" / f"{m['ground_truth']}.jpg"
            item["ground_truth"] = _export_pair(gt_path, f"{base}/gt") if export_images else {"src": f"{base}/gt.webp", "w": 0, "h": 0}
            item["degradation"] = {k: (round(v, 2) if isinstance(v, float) else v)
                                   for k, v in m["degradation"].items() if k != "crop_box_in_original"}
        for w in workflows:
            wid = w["id"]
            if iid not in scope(wid):
                continue
            r = recs.get((wid, iid, 0))
            if not r:
                continue
            if r["status"] != "ok" or (wid, iid) not in out_met:
                item["outputs"][wid] = {"status": "error", "error": r.get("error", "metriche mancanti")}
                per_wf_rows[wid].append({"ok": False, "input": iid})
                continue
            om = out_met[(wid, iid)]
            verdicts = {j: reconcile(judges[j][f"{iid}:{wid}"], rules) for j in judges if f"{iid}:{wid}" in judges[j]}
            fam = w["family"]
            fd = fidelity_decision(om["fidelity"], verdicts, fam, fcfg)
            used = [j for j in verdicts if JUDGE_FAMILY[j] != fam]
            wins = [1.0 if verdicts[j]["preferred"] == "output" else 0.5 if verdicts[j]["preferred"] == "tie" else 0.0 for j in used]
            win_score = float(np.mean(wins)) if wins else None
            win = None if win_score is None else (1.0 if win_score > 0.5 else 0.0 if win_score < 0.5 else 0.5)
            rub = {c: float(np.mean([verdicts[j]["rubric_output"][c] for j in used])) for c in CRITERIA} if used else None
            # latency/cost: F5 inherits the generation it depends on
            lat = float(r["wall_seconds"])
            gpu = r.get("gpu_seconds")
            if w["engine"] == "hybrid":
                ref = recs.get((w["reference"], iid, 0))
                lat += float(ref["wall_seconds"]) if ref else 0.0
            cost_cfg = w["cost"]
            if cost_cfg["type"] == "gpu_time":
                cost = (gpu or lat) * h200 / 3600
            elif cost_cfg["type"] == "inherit":
                cost = float(wf_by_id[cost_cfg["from"]]["cost"]["usd_per_image"]) + float(cost_cfg.get("extra_usd", 0))
            else:
                cost = float(cost_cfg["usd_per_image"]) + ((gpu or 0) * h200 / 3600)
            exp = {"src": f"{base}/{wid}.webp", "w": r["out_w"], "h": r["out_h"]}
            heat = None
            if export_images:
                exp = _export_pair(out_path(wid, iid), f"{base}/{wid}")
                heat = _export(DATA / om["heatmap"], f"{base}/{wid}_heat.webp", IMG_MAX, quality=80, rgba=True)["src"]
            fid = om["fidelity"]
            out = {
                "status": "ok", **exp, "heatmap": heat,
                "latency_s": round(lat, 2), "gpu_s": round(gpu, 2) if gpu else None, "cost_usd": round(cost, 5),
                "metrics": _tech(om["technical"]),
                "fixed_defects": om["fixed"], "remaining_defects": om["remaining"], "new_defects": om["new"],
                "fidelity": {"flag": fd["flag"], "flag_reasons": fd["flag_reasons"],
                             "structural": round(fid["structural"], 3), "changed_area_pct": round(fid["changed_area_pct"], 2),
                             "semantic": round(fid["semantic"], 3), "alignment_ok": fid["alignment_ok"],
                             "framing_kept_pct": round(fid["framing_kept_pct"], 1),
                             "invented_area_pct": round(fid.get("invented_area_pct", 0.0), 1),
                             "checklist_majority": fd["checklist_majority"]},
                "judges": [{"judge": j, "preferred": v["preferred"], "position_consistent": v["position_consistent"],
                            "rubric_output": {c: round(x, 2) for c, x in v["rubric_output"].items()},
                            "rubric_input": {c: round(x, 2) for c, x in v["rubric_input"].items()},
                            "checklist": v["checklist"], "notes": v["notes"],
                            "excluded_conflict": JUDGE_FAMILY[j] == fam} for j, v in verdicts.items()],
                "ensemble": {"win": win, "judges_used": used,
                             "rubric_mean": {c: round(x, 2) for c, x in rub.items()} if rub else None},
                "ops": (r.get("meta") or {}).get("ops") if w["engine"] == "classical" else
                       ({k: v for k, v in (r.get("meta") or {}).items() if k != "color_matrix"} if w["engine"] == "hybrid" else None),
                "full_ref": ({k: round(float(om["full_ref"][k]), 4) for k in ("psnr", "ssim", "lpips")} if "full_ref" in om else None),
                "iqa": {k: round(float(v), 3) for k, v in om["iqa"].items()},
            }
            item["outputs"][wid] = out
            per_wf_rows[wid].append({"ok": True, "input": iid, "win": win, "win_score": win_score, "rub": rub, "lat": lat,
                                     "gpu": gpu, "cost": cost, "fixed": len(om["fixed"]), "n_def": len(im_in["defects"]),
                                     "new": len(om["new"]) > 0, "flag": fd["flag"], "breakdown": fd["breakdown"],
                                     "struct": fid["structural"], "full_ref": out["full_ref"],
                                     "musiq": om["iqa"].get("musiq"), "defects": im_in["defects"]})
        if m["kind"] == "degraded" and export_images:
            fr = next((o for (wf_, i_), o in out_met.items() if i_ == iid and "full_ref_input" in o), None)
            if fr:
                item["input_full_ref"] = {k: round(float(fr["full_ref_input"][k]), 4) for k in ("psnr", "ssim", "lpips")}
        images.append(item)

    # ---- per workflow summary
    wf_out = []
    for w in workflows:
        rows = per_wf_rows[w["id"]]
        ok = [r for r in rows if r["ok"]]
        n_total = len(rows)
        succ = len(ok) / n_total if n_total else 0.0
        wins = [r["win"] for r in ok if r["win"] is not None]
        rubs = [r["rub"] for r in ok if r["rub"]]
        flags = [r["flag"] for r in ok]
        brk = defaultdict(int)
        for r in ok:
            for b in r["breakdown"]:
                brk[b] += 1
        frs = [r["full_ref"] for r in ok if r["full_ref"]]
        gpus = [r["gpu"] for r in ok if r["gpu"]]
        cc = w["cost"]
        cost_med = float(np.median([r["cost"] for r in ok])) if ok else 0.0
        summary = {
            "success_rate": round(succ, 3), "n_ok": len(ok), "n_total": n_total,
            "latency_p50_s": round(float(np.median([r["lat"] for r in ok])), 2) if ok else 0.0,
            "latency_p90_s": round(float(np.percentile([r["lat"] for r in ok], 90)), 2) if ok else 0.0,
            "gpu_s_p50": round(float(np.median(gpus)), 2) if gpus else None,
            "cost_usd_per_image": round(cost_med, 5), "cost_range": cc.get("range"),
            "cost_note": ("stimato: " + (cc.get("note") or ("tempo GPU × %.2f $/h (H200 on-demand)" % h200))),
            "quality_winrate": round(float(np.mean(wins)), 3) if wins else 0.0,
            "quality_winrate_ci": [round(x, 3) for x in bootstrap_ci(wins)],
            "rubric": {c: round(float(np.mean([r[c] for r in rubs])), 2) for c in CRITERIA} if rubs else {c: 0 for c in CRITERIA},
            "defect_fix_rate": round(sum(r["fixed"] for r in ok) / max(sum(r["n_def"] for r in ok), 1), 3),
            "new_defect_rate": round(float(np.mean([r["new"] for r in ok])), 3) if ok else 0.0,
            "fidelity_flag_rate": round(float(np.mean(flags)), 3) if flags else 0.0,
            "fidelity_flag_breakdown": {k: round(v / len(ok), 3) for k, v in brk.items()} if ok else {},
            "structural_mean": round(float(np.mean([r["struct"] for r in ok])), 3) if ok else 0.0,
            "full_ref": ({k: round(float(np.mean([f[k] for f in frs])), 3) for k in ("psnr", "ssim", "lpips")} if frs else None),
            "iqa_musiq": round(float(np.mean([r["musiq"] for r in ok if r["musiq"] is not None])), 2) if ok else None,
        }
        summary["gates"] = {"reliability": summary["success_rate"] >= dec["gates"]["reliability_min"],
                            "fidelity": summary["fidelity_flag_rate"] <= dec["gates"]["fidelity_flag_max"]}
        prompt = (CONFIG / "prompts" / f"{w['prompt']}.md").read_text().strip() if w.get("prompt") else None
        if w["engine"] == "hybrid":
            prompt = "Nessun prompt proprio: usa come riferimento l'output di F3 (prompt vincolato)."
        wf_out.append({"id": w["id"], "name": w["name"], "short": w["short"], "engine": w["engine"],
                       "family": w["family"], "generative": bool(w["generative"]),
                       "description": " ".join(w["description"].split()), "question": w["question"],
                       "prompt": prompt, "summary": summary, "_rows": rows})

    scores = compute_scores([{"id": w["id"], "passes": w["summary"]["gates"]["reliability"] and w["summary"]["gates"]["fidelity"],
                              "winrate": w["summary"]["quality_winrate"], "naturalezza": w["summary"]["rubric"]["naturalezza"],
                              "cost": w["summary"]["cost_usd_per_image"], "latency": w["summary"]["latency_p50_s"]}
                             for w in wf_out], dec["weights"])
    for w in wf_out:
        sc, rank = scores[w["id"]]
        w["summary"]["score"] = round(sc, 4) if sc is not None else None
        w["summary"]["rank"] = rank
    passing = [w for w in wf_out if w["summary"]["score"] is not None]
    winner = min(passing, key=lambda w: w["summary"]["rank"])["id"] if passing else None

    # ---- "better AND faithful": the product KPI (an output counts only if judges prefer it and it is not flagged)
    def safe_win(r):
        return 0.0 if (not r["ok"] or r["flag"] or r["win"] is None) else r["win"]

    for w in wf_out:
        rows = [r for r in w["_rows"] if r["ok"]]
        w["summary"]["safe_winrate"] = round(float(np.mean([safe_win(r) for r in rows])), 3) if rows else 0.0

    # ---- per-defect winners by safe win (min 3 images with the defect)
    per_defect = {}
    for d in DEFECT_LABEL:
        best, best_v = None, -1.0
        for w in wf_out:
            rows = [r for r in w["_rows"] if r["ok"] and d in r["defects"]]
            if len(rows) >= 3:
                v = float(np.mean([safe_win(r) for r in rows]))
                if v > best_v + 1e-9:
                    best, best_v = w["id"], v
        if best:
            per_defect[d] = best

    # ---- router: production cascade = the 2 workflows with the highest safe win-rate.
    # Try the first; if the fidelity check flags it or it does not improve the photo, try the second;
    # otherwise advise to reshoot. Cost/latency include the attempts that were rejected.
    # Ranking for the router = the declared weighted score, with the risk-adjusted quality (safe win-rate)
    # in place of the raw win-rate and every workflow admitted (gates are enforced per photo instead).
    ra = compute_scores([{"id": w["id"], "passes": True, "winrate": w["summary"]["safe_winrate"],
                          "naturalezza": w["summary"]["rubric"]["naturalezza"], "cost": w["summary"]["cost_usd_per_image"],
                          "latency": w["summary"]["latency_p50_s"]} for w in wf_out], dec["weights"])
    for w in wf_out:
        w["summary"]["risk_adjusted_score"] = round(ra[w["id"]][0], 4)
    order = [w["id"] for w in sorted(wf_out, key=lambda w: -w["summary"]["risk_adjusted_score"])]

    def simulate(casc: list[str]) -> dict:
        costs, lats, ok = [], [], 0
        for item in images:
            c = l = 0.0
            for wid in casc:
                o = item["outputs"].get(wid)
                if not o:
                    continue
                c += o.get("cost_usd") or 0.0
                l += o.get("latency_s") or 0.0
                if o["status"] == "ok" and not o["fidelity"]["flag"] and (o["ensemble"]["win"] or 0) >= 1.0:
                    ok += 1
                    break
            costs.append(c)
            lats.append(l)
        return {"cascade": casc, "delivered_rate": round(ok / max(len(images), 1), 3),
                "mean_cost_usd": round(float(np.mean(costs)), 5), "p50_latency_s": round(float(np.median(lats)), 2)}

    alternatives = [simulate(c) for c in ([order[0]], order[:2], order[:3], ["F3"], ["F3", "F1"]) if all(x in wf_by_id for x in c)]
    cascade = order[:2]
    casc_cost, casc_lat, delivered = [], [], 0
    for item in images:
        outs = item["outputs"]
        cost = lat = 0.0
        chosen = None
        tried = []
        for wid in cascade:
            o = outs.get(wid)
            if not o:
                continue
            tried.append(wid)
            cost += o.get("cost_usd") or 0.0
            lat += o.get("latency_s") or 0.0
            if o["status"] == "ok" and not o["fidelity"]["flag"] and (o["ensemble"]["win"] or 0) >= 1.0:
                chosen = wid
                break
        casc_cost.append(cost)
        casc_lat.append(lat)
        if chosen:
            delivered += 1
            rejected = [t for t in tried if t != chosen]
            reason = (f"{chosen} è {'il flusso predefinito' if chosen == cascade[0] else 'il fallback'} del router "
                      f"(ordine: {' → '.join(cascade)}, per quota di foto migliorate e fedeli). "
                      + (f"{', '.join(rejected)} è stato scartato: " + ("segnalato dalla verifica di fedeltà." if any(outs[t]['status'] == 'ok' and outs[t]['fidelity']['flag'] for t in rejected) else "non migliorava la foto.") if rejected else "Qui migliora la foto e supera la verifica di fedeltà."))
            alt = next((wid for wid in order if wid != chosen and outs.get(wid, {}).get("status") == "ok"
                        and not outs[wid]["fidelity"]["flag"] and (outs[wid]["ensemble"]["win"] or 0) >= 1.0), None)
            item["router"] = {"chosen": chosen, "reason": reason, "fallback": alt}
        else:
            fb = next((wid for wid in order if outs.get(wid, {}).get("status") == "ok" and not outs[wid]["fidelity"]["flag"]), None)
            item["router"] = {"chosen": "reshoot", "fallback": fb,
                              "reason": (f"Né {' né '.join(cascade)} migliorano la foto superando la verifica di fedeltà: "
                                         "meglio rifare lo scatto o pubblicare l'originale. "
                                         + (f"Come alternativa sicura resta {fb}." if fb else ""))}
    recommendation = {
        "cascade": cascade,
        "delivered_rate": round(delivered / max(len(images), 1), 3),
        "mean_cost_usd": round(float(np.mean(casc_cost)), 5) if casc_cost else 0.0,
        "p50_latency_s": round(float(np.median(casc_lat)), 2) if casc_lat else 0.0,
        "order": order,
        "alternatives": alternatives,
    }

    # ---- judges meta-validation
    gt_acc, pos_cons, pair_labels = {}, {}, defaultdict(dict)
    for j, pairs in judges.items():
        gts = [reconcile(v, rules) for pid, v in pairs.items() if pid.startswith("GT:")]
        if gts:
            gt_acc[j] = round(float(np.mean([g["preferred"] == "output" for g in gts])), 3)
        both = [v for v in pairs.values() if len(v) >= 2]
        if both:
            pos_cons[j] = round(float(np.mean([v[0]["preferred"] == v[1]["preferred"] for v in both])), 3)
        for pid, v in pairs.items():
            if not (pid.startswith("GT:") or pid.startswith("TRAP:")):
                pair_labels[pid][j] = reconcile(v, rules)["preferred"]
    units = [d for d in pair_labels.values() if len(d) >= 2]
    jl = sorted(judges)
    pairwise = {}
    for a in range(len(jl)):
        for b in range(a + 1, len(jl)):
            common = [d for d in pair_labels.values() if jl[a] in d and jl[b] in d]
            if common:
                pairwise[f"{jl[a]}-{jl[b]}"] = round(float(np.mean([d[jl[a]] == d[jl[b]] for d in common])), 3)
    self_pref = []
    fam_of_wf = {w["id"]: w["family"] for w in workflows}
    for j in jl:
        own, other = [], []
        for pid, lab in pair_labels.items():
            if j in lab:
                wid = pid.split(":")[1]
                s = 1.0 if lab[j] == "output" else 0.5 if lab[j] == "tie" else 0.0
                (own if fam_of_wf.get(wid) == JUDGE_FAMILY[j] else other).append(s)
        if own:
            self_pref.append({"judge": j, "own_family_winrate": round(float(np.mean(own)), 3),
                              "others_winrate": round(float(np.mean(other)), 3) if other else 0.0})

    # ---- traps: detector precision / recall
    traps = json.loads((DATA / "metrics" / "traps.json").read_text()) if (DATA / "metrics" / "traps.json").exists() else []
    det_hits = defaultdict(dict)
    for t in traps:
        fm = t["fidelity"]
        verd = {j: reconcile(judges[j][f"TRAP:{t['id']}"], rules) for j in judges if f"TRAP:{t['id']}" in judges[j]}
        gen_family = "alibaba" if t["is_alteration"] else "none"   # altered traps were produced with Qwen-Image-Edit
        det_hits[t["id"]]["strutturale"] = (fm["changed_area_pct"] > fcfg["changed_area_pct_max"]
                                            or fm.get("invented_area_pct", 0) > fcfg["invented_area_pct_max"])
        det_hits[t["id"]]["semantico"] = fm["semantic"] < 0.95
        for j, v in verd.items():
            det_hits[t["id"]][f"giudice_{j}"] = any(v["checklist"].values())
        det_hits[t["id"]]["combined"] = fidelity_decision(fm, verd, gen_family, fcfg)["flag"]
    det_names = {"strutturale": "Strutturale (area cambiata)", "semantico": "Semantico (DINOv2 < 0,95)",
                 "giudice_gpt": "Giudice GPT", "giudice_gemma": "Giudice Gemma", "giudice_qwen": "Giudice Qwen",
                 "combined": "Regola finale (strutturale OR quorum giudici)"}
    detectors = []
    for d in det_names:
        ev = [(det_hits[t["id"]][d], t["is_alteration"]) for t in traps if d in det_hits[t["id"]]]
        if not ev:
            continue
        tp = sum(p and a for p, a in ev)
        fp = sum(p and not a for p, a in ev)
        fn = sum((not p) and a for p, a in ev)
        prec = tp / (tp + fp) if tp + fp else 1.0
        rec = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
        detectors.append({"id": d, "name": det_names[d], "precision": round(prec, 3), "recall": round(rec, 3), "f1": round(f1, 3)})
    trap_items = []
    for t in traps:
        o = _export(DATA / "traps" / t["original"], f"traps/{t['id']}_orig.webp", IMG_MAX)["src"] if export_images else ""
        a = _export(DATA / "traps" / t["altered"], f"traps/{t['id']}_alt.webp", IMG_MAX)["src"] if export_images else ""
        trap_items.append({"id": t["id"], "type": t["type"], "description": t["description"], "original": o, "altered": a,
                           "is_alteration": t["is_alteration"],
                           "detected_by": [d for d, hit in det_hits[t["id"]].items() if hit]})

    for w in wf_out:
        w.pop("_rows")
    results = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "is_mock": False,
        "dataset": {"n_real": sum(m["kind"] == "real" for m in tests), "n_degraded": sum(m["kind"] == "degraded" for m in tests),
                    "source": "Immobiliare.it (annunci pubblici, settembre 2026)",
                    "notes": ("18 foto reali con difetti evidenti, senza watermark della piattaforma (filtro automatico), "
                              "+ 6 foto buone degradate artificialmente (buio, dominante, inclinazione, rumore, bassa risoluzione) "
                              "per avere una verità di riferimento.")},
        "workflows": wf_out,
        "decision": {"weights": dec["weights"], "gates": dec["gates"], "declared_at": dec["declared_at"],
                     "winner": winner, "rationale": "", "per_defect_winner": per_defect, "pairwise_questions": [],
                     "recommendation": recommendation},
        "images": images,
        "judges": {"list": [{"id": j, "name": JUDGE_NAME[j], "family": JUDGES[j]["family"], "model": JUDGE_MODEL[j]} for j in jl],
                   "agreement": {"krippendorff_alpha": round(krippendorff_nominal(units), 3) if units else None,
                                 "pairwise_agreement": pairwise},
                   "position_consistency": pos_cons, "gt_accuracy": gt_acc, "self_preference": self_pref},
        "traps": {"n": len(traps), "detectors": detectors, "items": trap_items},
        "rubric_definition": RUBRIC_DEFINITION,
        "real_vs_simulated": REAL_VS_SIMULATED,
        "limits": LIMITS,
    }
    from fotolab.narrative import decorate

    decorate(results)
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    (WEB_DATA / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1))
    log(f"results.json written: {len(images)} images, winner={winner}")
    return results


RUBRIC_DEFINITION = {
    "esposizione": {"label": "Esposizione", "anchors": {1: "Molto buia o bruciata, dettagli persi", 3: "Accettabile, con zone troppo scure o chiare", 5: "Luminosa e bilanciata, dettagli leggibili in ombre e luci"}},
    "colore": {"label": "Colore", "anchors": {1: "Dominante evidente (giallo, verde, blu…)", 3: "Leggera dominante", 5: "Bianchi neutri, colori naturali"}},
    "geometria": {"label": "Geometria", "anchors": {1: "Foto storta, verticali molto inclinate", 3: "Leggera inclinazione o convergenza", 5: "Verticali dritte, inquadratura in bolla"}},
    "nitidezza": {"label": "Nitidezza", "anchors": {1: "Mossa, sfocata, rumorosa o pixelata", 3: "Discreta", 5: "Nitida e pulita"}},
    "naturalezza": {"label": "Naturalezza", "anchors": {1: "Aspetto artificiale, effetto 'AI' o HDR eccessivo", 3: "Qualche artefatto", 5: "Sembra una vera fotografia"}},
    "attrattivita": {"label": "Attrattività", "anchors": {1: "Scoraggia la visita", 3: "Neutra", 5: "Invoglia a visitare la casa"}},
}

REAL_VS_SIMULATED = [
    {"item": "Foto di input (18 reali + 6 degradate)", "status": "reale", "note": "Annunci pubblici Immobiliare.it; le 6 degradate sono foto buone peggiorate in modo controllato."},
    {"item": "Output gpt-image (F2, F3)", "status": "reale", "note": "Generati con Codex CLI sull'abbonamento ChatGPT (strumento image_gen integrato)."},
    {"item": "Output Qwen-Image-Edit 2511 (F4) e Real-ESRGAN", "status": "reale", "note": "Modelli open-weights su ComfyUI, GPU H200 dedicata."},
    {"item": "Flussi classico (F1) e ibrido (F5)", "status": "reale", "note": "Codice Python/OpenCV scritto per il prototipo."},
    {"item": "Metriche tecniche, strutturali, semantiche e IQA", "status": "reale", "note": "Calcolate su ogni output."},
    {"item": "Giudici AI (Gemma, Qwen, GPT)", "status": "reale", "note": "Stesso prompt e rubrica per tutti; ordine A/B randomizzato."},
    {"item": "Costo per immagine", "status": "stimato", "note": "Listini API (gpt-image-2) e costo orario H200 on-demand: l'abbonamento non espone costi unitari."},
    {"item": "Latenza gpt-image", "status": "stimato", "note": "Misurata via Codex: include l'overhead dell'agente, è un limite superiore della latenza API."},
    {"item": "Degradazioni artificiali", "status": "simulato", "note": "Servono a misurare il ripristino rispetto a una verità nota."},
    {"item": "Caricamento foto nella versione pubblica", "status": "simulato", "note": "La demo online mostra risultati precalcolati; il caricamento live funziona solo in locale."},
    {"item": "Integrazione nel back-office agenzie", "status": "simulato", "note": "Lo Studio simula il flusso agente; nessuna integrazione reale."},
    {"item": "Arena di valutazione umana", "status": "progettato", "note": "Interfaccia pronta, non eseguita con utenti reali."},
    {"item": "A/B test su annunci reali (CTR, contatti)", "status": "progettato", "note": "Descritto come prossimo passo."},
    {"item": "F6 Gemini (Nano Banana)", "status": "progettato", "note": "Non eseguito: nessun accesso automatizzabile con l'abbonamento; per scelta niente servizi Google a consumo."},
]

LIMITS = [
    "Campione piccolo (24 immagini, 12 per F2): gli intervalli di confidenza sono ampi; i numeri indicano tendenze, non verità statistiche.",
    "Qualità misurata con giudici AI, senza valutatori umani: la calibrazione umana è il primo prossimo passo.",
    "Le trappole sono 12 e generate con un solo modello: precision e recall dei detector sono stime grezze.",
    "L'abbonamento ChatGPT limita le generazioni (~20 per finestra): F2 è stato eseguito su metà del dataset e alcune richieste sono fallite per quota.",
    "Costi di gpt-image stimati da listino; latenza gpt-image gonfiata dall'agente Codex.",
    "Il rilevatore strutturale non vede cambiamenti a basso contrasto (es. watermark semi-trasparenti): per questo è combinato con i giudici.",
    "Le foto servite da Immobiliare.it sono già ricompresse (max ~1,6 MP): non sono gli originali caricati dagli agenti.",
]

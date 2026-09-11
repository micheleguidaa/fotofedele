"""Italian narrative derived from the numbers: decision rationale and answers to the pairwise questions.

Kept separate from aggregate.py so the wording can be reviewed without touching the maths.
Every sentence is generated from results — nothing here is hard-coded as a conclusion.
"""

from __future__ import annotations

import numpy as np


def _pct(x: float) -> str:
    return f"{x * 100:.0f}%".replace(".", ",")


def _usd(x: float) -> str:
    return (f"{x:.3f} $" if x >= 0.01 else f"{x:.4f} $").replace(".", ",")


def _common(results: dict, a: str, b: str) -> list[dict]:
    out = []
    for im in results["images"]:
        oa, ob = im["outputs"].get(a), im["outputs"].get(b)
        if oa and ob and oa["status"] == "ok" and ob["status"] == "ok":
            out.append({"id": im["id"], a: oa, b: ob})
    return out


def _cmp(results: dict, a: str, b: str) -> dict:
    rows = _common(results, a, b)
    def m(wid, f):
        vals = [f(r[wid]) for r in rows if f(r[wid]) is not None]
        return float(np.mean(vals)) if vals else float("nan")
    win = lambda o: o["ensemble"]["win"]
    flag = lambda o: 1.0 if o["fidelity"]["flag"] else 0.0
    nat = lambda o: (o["ensemble"]["rubric_mean"] or {}).get("naturalezza")
    area = lambda o: o["fidelity"]["changed_area_pct"]
    return {"n": len(rows), "win": (m(a, win), m(b, win)), "flag": (m(a, flag), m(b, flag)),
            "nat": (m(a, nat), m(b, nat)), "area": (m(a, area), m(b, area))}


def decorate(results: dict) -> None:
    wf = {w["id"]: w for w in results["workflows"]}
    dec = results["decision"]
    s = {k: w["summary"] for k, w in wf.items()}

    # ---- rationale
    passing = [k for k in wf if s[k]["score"] is not None]
    failing_fid = [k for k in wf if not s[k]["gates"]["fidelity"]]
    parts = []
    if dec["winner"]:
        w = dec["winner"]
        parts.append(f"Vince {w} ({wf[w]['name']}): supera entrambi i gate e ha il punteggio pesato più alto "
                     f"(win-rate {_pct(s[w]['quality_winrate'])} contro l'originale, "
                     f"segnalazioni di fedeltà {_pct(s[w]['fidelity_flag_rate'])}, costo stimato {_usd(s[w]['cost_usd_per_image'])}/foto).")
        if failing_fid:
            parts.append("Esclusi dal gate di fedeltà (soglia " + _pct(dec["gates"]["fidelity_flag_max"]) + "): "
                         + ", ".join(f"{k} ({_pct(s[k]['fidelity_flag_rate'])} segnalati)" for k in failing_fid) + ".")
        if len(passing) > 1:
            others = [k for k in sorted(passing, key=lambda k: s[k]["rank"]) if k != dec["winner"]]
            parts.append("Tra i flussi sicuri seguono " + ", ".join(f"{k} (punteggio {s[k]['score']:.2f})".replace(".", ",") for k in others) + ".")
    else:
        by_flag = sorted(wf, key=lambda k: s[k]["fidelity_flag_rate"])
        parts.append(f"Nessun flusso supera il gate di fedeltà (al massimo {_pct(dec['gates']['fidelity_flag_max'])} di foto segnalate): "
                     + ", ".join(f"{k} {_pct(s[k]['fidelity_flag_rate'])}" for k in by_flag) + ". "
                     "Quindi nessun flusso va pubblicato in automatico: la verifica di fedeltà deve girare su ogni foto "
                     "e l'agente resta l'ultimo controllo.")
        rec = dec.get("recommendation")
        if rec:
            c = rec["cascade"]
            parts.append("Per il router uso lo stesso punteggio dichiarato, ma con la quota di foto migliorate E fedeli al posto "
                         "del win-rate (" + ", ".join(f"{k} {_pct(s[k]['safe_winrate'])}" for k in sorted(wf, key=lambda k: -s[k]['safe_winrate']))
                         + f"): il router prova {c[0]} e, se la verifica lo scarta o non migliora la foto, {c[1]}. "
                         f"Così il {_pct(rec['delivered_rate'])} delle foto esce migliorato e fedele, a {_usd(rec['mean_cost_usd'])} "
                         f"per foto in media e {rec['p50_latency_s']:.0f} s di latenza mediana; per le altre si consiglia "
                         "l'originale o un nuovo scatto.")
            f3 = next((a for a in rec.get("alternatives", []) if a["cascade"] == ["F3"]), None)
            if f3:
                parts.append(f"gpt-image da solo (F3) arriverebbe al {_pct(f3['delivered_rate'])} a {_usd(f3['mean_cost_usd'])} per foto: "
                             "produce le foto più belle ma ridisegna l'immagine, quindi resta un'alternativa da proporre all'agente, non il default.")
    dec["rationale"] = " ".join(parts)

    # ---- pairwise questions
    qs = []
    def add(a, b, question, fmt):
        if a in wf and b in wf:
            c = _cmp(results, a, b)
            if c["n"]:
                qs.append({"pair": [a, b], "question": question, "answer": fmt(c)})

    add("F2", "F3", "Quanto conta il prompt? (stesso modello gpt-image, prompt semplice vs vincolato)",
        lambda c: (f"Su {c['n']} foto in comune: win-rate {_pct(c['win'][0])} (semplice) vs {_pct(c['win'][1])} (vincolato); "
                   f"output segnalati {_pct(c['flag'][0])} vs {_pct(c['flag'][1])}; area con struttura cambiata "
                   f"{c['area'][0]:.0f}% vs {c['area'][1]:.0f}%. "
                   + ("Il prompt vincolato riduce le alterazioni ma non le elimina: gpt-image ridisegna comunque l'immagine."
                      if c['flag'][1] < c['flag'][0] else
                      "Il prompt vincolato non basta a ridurre le alterazioni: il limite è nel modo in cui il modello rigenera l'immagine.")))
    add("F3", "F4", "Modello chiuso o open-weights? (gpt-image vs Qwen-Image-Edit, stesso prompt)",
        lambda c: (f"Su {c['n']} foto: win-rate {_pct(c['win'][0])} (gpt-image) vs {_pct(c['win'][1])} (Qwen); "
                   f"segnalati {_pct(c['flag'][0])} vs {_pct(c['flag'][1])}; costo stimato {_usd(s['F3']['cost_usd_per_image'])} vs "
                   f"{_usd(s['F4']['cost_usd_per_image'])} per foto, latenza mediana {s['F3']['latency_p50_s']:.0f} s vs {s['F4']['latency_p50_s']:.0f} s."))
    add("F3", "F5", "Generare i pixel o trasferire solo il 'look'? (gpt-image vs ibrido)",
        lambda c: (f"Su {c['n']} foto: win-rate {_pct(c['win'][0])} (gpt-image) vs {_pct(c['win'][1])} (ibrido); "
                   f"segnalati {_pct(c['flag'][0])} vs {_pct(c['flag'][1])}; area cambiata {c['area'][0]:.0f}% vs {c['area'][1]:.0f}%. "
                   "L'ibrido usa gpt-image solo come 'direttore della fotografia': luce e colore arrivano dal modello, "
                   "i pixel restano quelli dell'originale."))
    add("F1", "F5", "Serve davvero l'AI? (classico deterministico vs ibrido)",
        lambda c: (f"Su {c['n']} foto: win-rate {_pct(c['win'][0])} (classico) vs {_pct(c['win'][1])} (ibrido), "
                   f"entrambi con segnalazioni {_pct(c['flag'][0])} / {_pct(c['flag'][1])}; il classico costa ~0 e impiega "
                   f"{s['F1']['latency_p50_s']:.1f} s.".replace(".", ",", 1)))
    dec["pairwise_questions"] = qs

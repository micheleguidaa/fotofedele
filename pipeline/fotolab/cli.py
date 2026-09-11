"""fotolab CLI — `python -m fotolab <command>`."""

from __future__ import annotations

from typing import List, Optional

import typer

app = typer.Typer(add_completion=False, help="FotoFedele lab: run and evaluate photo-enhancement workflows.")


@app.command()
def run(wf: List[str] = typer.Option(..., "--wf", help="workflow id(s), e.g. --wf F1 --wf F4"),
        limit: Optional[int] = None, only: List[str] = typer.Option(None, "--only"),
        force: bool = False, reps: int = 1, concurrency: int = 1):
    """Run workflows on the test inputs (skips runs already done unless --force)."""
    from fotolab import runner

    runner.run(wf, limit=limit, only=only or None, force=force, reps=reps, concurrency=concurrency)


@app.command()
def judge(judge: List[str] = typer.Option(..., "--judge", help="gpt | gemma | qwen"),
          wf: List[str] = typer.Option(None, "--wf"), gt: bool = False, traps: bool = False,
          only: List[str] = typer.Option(None, "--only", help="restrict to input ids"),
          one_order: bool = False, swap_fraction: float = 1.0, concurrency: int = 1):
    """Ask judges about (input, output) pairs [--wf], ground-truth pairs [--gt], trap pairs [--traps]."""
    from fotolab.judges import run as jr

    pairs = jr.output_pairs(wf) if wf else []
    if gt:
        pairs += jr.gt_pairs()
    if traps:
        pairs += jr.trap_pairs()
    if only:
        pairs = [p for p in pairs if p.pair_id.split(":")[0] in only or p.pair_id.split(":")[1] in only]
    for j in judge:
        jr.run(j, pairs, both_orders=not one_order, swap_fraction=swap_fraction, concurrency=concurrency)


@app.command()
def evaluate(force: bool = False, traps: bool = True):
    """Compute automatic metrics for inputs, outputs (cached by file mtime) and traps."""
    from fotolab import evaluate as ev

    ev.output_metrics(force=force)
    if traps:
        ev.trap_metrics()


@app.command()
def aggregate(no_images: bool = False):
    """Build web/public/data/results.json (+ WebP images) from runs, metrics and judges."""
    from fotolab.aggregate import build

    build(export_images=not no_images)


@app.command()
def enhance(input: str = typer.Option(..., "--input"), outdir: str = typer.Option(..., "--outdir"),
            wf: List[str] = typer.Option(["F1", "F4"], "--wf")):
    """Live mode for the web app: diagnose one photo, run fast workflows, print one JSON object on stdout."""
    import json
    import sys
    import time
    from pathlib import Path

    import cv2

    from fotolab.imageio import load_bgr, save_bgr
    from fotolab.metrics import fidelity, technical

    def tech(t):
        keys = ["exposure_L", "clip_high_pct", "cast", "tilt_deg", "sharpness", "noise_sigma", "megapixels", "width", "height"]
        return {k: (round(float(t[k]), 3) if k not in ("width", "height") else int(t[k])) for k in keys}

    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    img = load_bgr(input)
    t_in = technical.analyze(img)
    d_in = technical.defects(t_in)
    result = {"input": {"metrics": tech(t_in), "defects": d_in}, "outputs": {}}
    for w in wf:
        t0 = time.time()
        try:
            if w == "F1":
                from fotolab.runner import _esrgan
                from fotolab.workflows import classical

                res, ops = classical.enhance(img, sr_fn=_esrgan)
            elif w == "F4":
                from fotolab import CONFIG
                from fotolab.workflows import comfyui

                src = out / "input.jpg"
                save_bgr(img, src)
                prompt = (CONFIG / "prompts" / "enhance_strict.md").read_text()
                dst = out / "F4_raw.png"
                comfyui.run(comfyui.load_graph("qwen_image_edit_2511", image=comfyui.upload(src), prompt=prompt,
                                               seed=42, megapixels=1.0), dst)
                res, ops = load_bgr(dst), None
            else:
                raise ValueError(f"{w} not available in live mode")
            p = save_bgr(res, out / f"{w}.jpg", quality=92)
            t_out = technical.analyze(res)
            d_out = technical.defects(t_out)
            s = fidelity.structural(img, res)
            hm = out / f"{w}_heat.png"
            cv2.imwrite(str(hm), fidelity.overlay_rgba(s, res.shape[1], res.shape[0]))
            flag_reasons = []
            if s["changed_area_pct"] > 3.0:
                flag_reasons.append(f"struttura cambiata sul {s['changed_area_pct']:.0f}% dell'immagine")
            if s["invented_area_pct"] > 8.0:
                flag_reasons.append(f"{s['invented_area_pct']:.0f}% dell'immagine non esiste nell'originale")
            result["outputs"][w] = {
                "path": str(p), "heatmap": str(hm), "ops": ops, "metrics": tech(t_out),
                "fixed_defects": sorted(set(d_in) - set(d_out)), "remaining_defects": sorted(set(d_in) & set(d_out)),
                "new_defects": sorted(set(d_out) - set(d_in)), "latency_s": round(time.time() - t0, 2),
                "fidelity": {"flag": bool(flag_reasons), "flag_reasons": flag_reasons,
                             "structural": round(s["structural"], 3), "changed_area_pct": round(s["changed_area_pct"], 2),
                             "semantic": None, "alignment_ok": s["alignment_ok"],
                             "framing_kept_pct": round(s["framing_kept_pct"], 1),
                             "checklist_majority": None},
            }
        except Exception as e:  # report per-workflow failures inside the JSON
            print(f"{w} failed: {e}", file=sys.stderr)
            result["outputs"][w] = {"error": f"{type(e).__name__}: {e}"[:300]}
    print(json.dumps(result, ensure_ascii=False))


@app.command()
def status():
    """Summary of runs per workflow."""
    from collections import Counter

    from fotolab import runner

    recs = runner.records().values()
    c = Counter((r["wf"], r["status"]) for r in recs)
    for wid in runner.workflows():
        print(f"{wid}: ok={c[(wid, 'ok')]} error={c[(wid, 'error')]}")


if __name__ == "__main__":
    app()

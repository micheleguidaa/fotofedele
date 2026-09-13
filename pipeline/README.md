# fotolab — pipeline

Python package that runs the FotoFedele experiment end to end and writes the data the web app shows.

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m fotolab run --wf F1 --wf F4           # run workflows on the 24 test inputs (skips done runs)
.venv/bin/python -m fotolab run --wf F3 --concurrency 2   # gpt-image via Codex CLI (ChatGPT subscription)
.venv/bin/python -m fotolab evaluate                      # technical, fidelity, full-reference, IQA metrics (cached)
.venv/bin/python -m fotolab judge --judge qwen --wf F1 --gt --traps   # AI judges (gemma | qwen | gpt)
.venv/bin/python -m fotolab aggregate                     # -> ../web/public/data/results.json + WebP images
.venv/bin/python -m fotolab enhance --input foto.jpg --outdir /tmp/x   # live mode used by the web app (local only)
```

| Path | What |
|---|---|
| `config/workflows.yaml` | the workflows under test (adding a variant = one entry) and cost assumptions |
| `config/decision.yaml` | gates, weights and fidelity thresholds, fixed before aggregation |
| `config/prompts/` | enhancement prompts and the judge prompt (anchored rubric + checklist) |
| `config/comfy/` | ComfyUI API graphs (Qwen-Image-Edit 2511 + Lightning, Real-ESRGAN) |
| `fotolab/workflows/` | classical (OpenCV), codex_image (gpt-image), comfyui (Qwen) |
| `fotolab/metrics/` | technical (defects vs targets), fidelity (structure, heatmap, DINOv2), reference, IQA |
| `fotolab/judges/` | judge protocol and backends (Ollama on the VM, Codex) |
| `fotolab/traps.py` | trap set: 6 deliberate alterations + 6 benign edits, to measure the detectors |
| `data/inputs/manifest.json` | dataset: source listing URLs, notes, degradation parameters |
| `data/runs/records.jsonl` | one record per run (status, latency, GPU time, what the steps did) |
| `data/metrics/`, `data/judges/` | every metric and every judge answer, for audit |

Environment: `COMFY_URL` (default `http://10.183.16.2:8188`), `OLLAMA_URL` (default `http://10.183.16.2:11434`).
Codex CLI must be logged in (`codex login`) for F2/F3 and the GPT judge.

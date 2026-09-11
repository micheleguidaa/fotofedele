# Contract notes (web side)

Notes on `lib/types.ts` for whoever writes `pipeline/fotolab/aggregate.py`.
No field was renamed or removed.

## Optional fields added by the web app

All optional: the UI works without them.

| Field | Type | Why |
| --- | --- | --- |
| `Output.thumb` | `string` (relative to `/data/`) | Small preview (~480 px long side) for the 24×7 lab matrix, the studio picker and similar grids. Falls back to `src`. |
| `ImageItem.input.thumb` | `string` | Same, for inputs. |
| `ImageItem.ground_truth.thumb` | `string` | Same, for clean references. |
| `Results.is_mock` | `boolean` | `true` only when written by `scripts/make-mock.mjs`; shows a "Dati di esempio" banner. The real exporter should omit it or write `false`. |
| `Results.decision.declared_at` | ISO date string | When the gates and weights were fixed. Shown next to "Dichiarata prima di vedere i risultati" on `/metodo`. |

## How the UI reads existing fields

- **Image paths** (`src`, `heatmap`, `thumb`, `traps.items[].original/altered`) are relative to `/data/`.
  Extensions don't matter.
- **`Output.heatmap`** is drawn over the output image with normal blending at 80% opacity, scaled to the
  same frame as the output (`object-fit: contain`). It works best as an RGBA PNG/WebP with the same aspect
  ratio as the output, **transparent where nothing changed** (alpha ∝ change). An opaque colormap would
  hide the photo.
- **`Workflow.prompt`** is shown verbatim in a collapsible block, so it should hold the full prompt text,
  not the prompt file name (`enhance_strict`).
- **`summary.score` / `summary.rank`**: `/lab` recomputes the score client-side with `lib/score.ts` so
  the weight sliders work. To make the default slider position match the pipeline exactly, the Python
  side should use the same definition:
  - weights normalised to sum 1;
  - `score = wq·winrate + wn·(naturalezza−1)/4 + wc·costScore + ws·speedScore`;
  - `costScore = 1 − log10(cost/minCost)/log10(maxCost/minCost)`, with costs floored at `1e-5`;
  - `speedScore = 1 − (p50 − min)/(max − min)`;
  - min/max over the workflows passing **both** `gates`; a score of 1 when min = max;
  - competition ranking (1, 2, 2, 4) on scores rounded to 4 decimals.

  Gate pass/fail is taken from `summary.gates` (the UI does not recompute it from thresholds).
- **`router.chosen = "reshoot"`**: the studio shows the reshoot advice plus a preview of `router.fallback`
  if that output is ok.
- **`judges.agreement.pairwise_agreement`** keys like `"gpt-gemini"` (separators `- _ | :` or `vs`) are
  rendered as a judge × judge matrix; other key formats fall back to a plain list.
- **`traps.detectors`**: a detector whose `id` contains `combined`/`final` is treated as the production
  rule for the "Rilevata / Sfuggita / Falso allarme" labels in the trap gallery; without one, any
  detection counts.
- **`fidelity_flag_breakdown`** keys are `FidelityChecklist` keys or `"strutturale"`, values are shares 0..1
  (shown in the leaderboard tooltip on the flag rate).
- **`new_defect_rate`** is displayed as a share (the mock uses: share of ok outputs with ≥ 1 new defect).
- **Metric targets** are hard-coded in `lib/metrics.ts`, mirroring `pipeline/fotolab/metrics/technical.py`
  `TARGETS` — including `megapixels ≥ 1.0` (defect `bassa_risoluzione`), which isn't in the `TechMetrics`
  comments. Keep them in sync if the pipeline changes.

## Live mode (`/api/enhance` ↔ `python -m fotolab enhance`)

Types in `lib/live.ts`. The route expects the CLI to print one JSON object on stdout (log lines
before it are tolerated; logs should go to stderr):

```json
{
  "input":   { "metrics": TechMetrics, "defects": Defect[] },
  "outputs": {
    "F1": { "path": "…", "heatmap": "…?", "ops": {…}, "metrics": TechMetrics, "fidelity": Fidelity,
            "fixed_defects": [], "remaining_defects": [], "new_defects": [], "latency_s": 1.2, "error": "…?" },
    "F4": { … }
  }
}
```

- `path` / `heatmap`: absolute, or relative to `--outdir`. For safety, only files inside the request's
  temp dir are read; they are returned to the browser as data URLs (`src`, `heatmap`).
- Exit code ≠ 0 or unparsable stdout → HTTP 502 with the last stderr lines. Timeout (180 s) → 504.
- A per-workflow failure can be reported as `{ "error": "…" }` inside `outputs.<WF>`.

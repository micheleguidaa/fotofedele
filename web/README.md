# FotoFedele — web

Next.js (App Router) + TypeScript + Tailwind CSS front-end for the FotoFedele case study.
All pages are statically generated from `public/data/results.json`; the only server route is the
optional local-only `/api/enhance`.

## Run

```bash
npm install
npm run mock     # optional: generate example data (see below)
npm run dev      # http://localhost:3000
```

Other scripts: `npm run build`, `npm start`, `npm run lint`, `npm test` (unit tests for `lib/score.ts`,
Node's built-in test runner).

Node ≥ 22.18 is needed for `npm run mock` and `npm test` (they run TypeScript files through Node's
native type stripping). `build`/`dev` work with any Node version supported by Next.js 16.

## Data

- **Contract:** [`lib/types.ts`](lib/types.ts) (shape of `public/data/results.json`). Web-side additions
  and interpretation notes: [`CONTRACT_NOTES.md`](CONTRACT_NOTES.md).
- **Location:** `public/data/results.json`; every image path inside it is relative to `/data/`
  (`images/R01/F3.webp` → `/data/images/R01/F3.webp`). The UI does not care about file extensions.
- **Real data** is written by the pipeline exporter (`pipeline/fotolab/aggregate.py`) and is meant to be committed:
  pages are prerendered from it at build time, so `npm run build` stops with a clear error if the file is missing.
- **Mock data:** `npm run mock` (`scripts/make-mock.mjs`) **overwrites** `public/data/results.json` and
  **deletes and rewrites** `public/data/images/`. It copies the real inputs and whatever workflow outputs
  already exist in `../pipeline/data/runs/<WF>/` (missing ones reuse the input as a placeholder), reads
  latencies/GPU time/F1 ops from `records.jsonl`, and simulates everything else with a fixed seed.
  Mock files are large PNGs (~135 MB): don't commit them — run the real exporter first.
  The generated file has `is_mock: true`, which shows a "Dati di esempio" banner on every page.
  Options: `PIPELINE_DIR=/path/to/pipeline npm run mock`, `npm run mock -- --no-thumbs`
  (thumbnails use macOS `sips`; without them the UI falls back to full-size images).

## Environment variables

| Variable | Where | Effect |
| --- | --- | --- |
| `NEXT_PUBLIC_LIVE_MODE=1` | build time (client) | Shows the "Carica una tua foto" panel under the Foto view (`/`, `/foto/[id]`). Otherwise the panel is hidden. |
| `LIVE_MODE=1` | runtime (server) | Enables `POST /api/enhance`. Otherwise it answers `501 {"error":"Disponibile solo in locale"}`. |
| `PIPELINE_DIR` | runtime (server), mock script | Path of the Python pipeline (default `../pipeline`). |

Live mode (local only):

```bash
LIVE_MODE=1 NEXT_PUBLIC_LIVE_MODE=1 npm run dev
```

`/api/enhance` accepts `multipart/form-data` with a `file` field (JPEG/PNG/WebP, ≤ 20 MB), saves it to a
temp dir and runs
`../pipeline/.venv/bin/python -m fotolab enhance --input <file> --outdir <tmp>/out --wf F1 --wf F4`
(cwd `../pipeline`, 180 s timeout). It parses the JSON printed on stdout, inlines the output images as
data URLs and returns them (see `lib/live.ts` for the exact shapes).

## Structure

```
app/                 pages: / (Foto) · /foto/[id] · /numeri · /metodo · /arena · api/enhance (old /studio and /lab URLs redirect)
components/          UI (CompareSlider, charts, tables, per-page client components)
lib/types.ts         data contract
lib/score.ts         decision score (same formula the pipeline uses), unit-tested in score.test.ts
lib/bt.ts            Bradley–Terry fit for the arena
scripts/make-mock.mjs
```

Deploys on Vercel as a standard Next.js app (no env vars needed; live mode stays off).

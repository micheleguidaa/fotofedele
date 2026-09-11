// Decision score, recomputed client-side in /lab when the user moves the weight sliders.
//
//   score = wq·winrate + wn·(naturalezza − 1)/4 + wc·costScore + ws·speedScore
//   costScore  = 1 − log10(cost / minCost) / log10(maxCost / minCost)
//   speedScore = 1 − (p50 − minP50) / (maxP50 − minP50)
//
// min/max are taken over the workflows that pass BOTH gates (reliability and fidelity);
// workflows failing a gate get no score and no rank. Weights are normalised to sum 1, so the
// score stays in 0..1 whatever the slider positions.
//
// This file only uses erasable TypeScript syntax so that Node can run it directly
// (scripts/make-mock.mjs and lib/score.test.ts import it without a build step).

import type { Workflow } from "./types";

export interface Weights {
  quality: number;
  naturalness: number;
  cost: number;
  speed: number;
}

export interface ScoreInput {
  id: string;
  passes: boolean; // passes both gates
  winrate: number; // 0..1
  naturalezza: number; // rubric 1..5
  cost: number; // USD per image
  latencyP50: number; // seconds
}

export interface ScoreRow {
  id: string;
  passes: boolean;
  score: number | null;
  rank: number | null;
  costScore: number | null;
  speedScore: number | null;
  /** Weighted contribution of each criterion (already multiplied by the normalised weight). */
  parts: Weights | null;
}

/** Floor for costs, so a free workflow does not make log10 explode. */
export const MIN_COST_USD = 1e-5;

export function normalizeWeights(w: Weights): Weights {
  const clean = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  const q = clean(w.quality);
  const n = clean(w.naturalness);
  const c = clean(w.cost);
  const s = clean(w.speed);
  const sum = q + n + c + s;
  if (sum <= 0) return { quality: 0, naturalness: 0, cost: 0, speed: 0 };
  return { quality: q / sum, naturalness: n / sum, cost: c / sum, speed: s / sum };
}

export function computeScores(items: ScoreInput[], weights: Weights): ScoreRow[] {
  const w = normalizeWeights(weights);
  const passing = items.filter((i) => i.passes);

  const costs = passing.map((i) => Math.max(i.cost, MIN_COST_USD));
  const minCost = costs.length ? Math.min(...costs) : MIN_COST_USD;
  const maxCost = costs.length ? Math.max(...costs) : MIN_COST_USD;
  const lat = passing.map((i) => i.latencyP50);
  const minLat = lat.length ? Math.min(...lat) : 0;
  const maxLat = lat.length ? Math.max(...lat) : 0;

  const costScore = (cost: number) => {
    if (!(maxCost > minCost)) return 1;
    const c = Math.max(cost, MIN_COST_USD);
    return 1 - Math.log10(c / minCost) / Math.log10(maxCost / minCost);
  };
  const speedScore = (p50: number) => (maxLat > minLat ? 1 - (p50 - minLat) / (maxLat - minLat) : 1);

  const rows: ScoreRow[] = items.map((i) => {
    if (!i.passes) {
      return { id: i.id, passes: false, score: null, rank: null, costScore: null, speedScore: null, parts: null };
    }
    const cs = costScore(i.cost);
    const ss = speedScore(i.latencyP50);
    const parts: Weights = {
      quality: w.quality * i.winrate,
      naturalness: (w.naturalness * (i.naturalezza - 1)) / 4,
      cost: w.cost * cs,
      speed: w.speed * ss,
    };
    const score = parts.quality + parts.naturalness + parts.cost + parts.speed;
    return { id: i.id, passes: true, score, rank: null, costScore: cs, speedScore: ss, parts };
  });

  // Competition ranking (1, 2, 2, 4) on scores rounded to 4 decimals.
  const scored = rows
    .filter((r) => r.score !== null)
    .sort((a, b) => (b.score as number) - (a.score as number) || a.id.localeCompare(b.id));
  let prev: number | null = null;
  let prevRank = 0;
  scored.forEach((r, idx) => {
    const s = Math.round((r.score as number) * 1e4);
    const rank = prev !== null && s === prev ? prevRank : idx + 1;
    r.rank = rank;
    prev = s;
    prevRank = rank;
  });
  return rows;
}

export function scoreInputsFromWorkflows(workflows: Workflow[]): ScoreInput[] {
  return workflows.map((wf) => ({
    id: wf.id,
    passes: wf.summary.gates.reliability && wf.summary.gates.fidelity,
    winrate: wf.summary.quality_winrate,
    naturalezza: wf.summary.rubric.naturalezza,
    cost: wf.summary.cost_usd_per_image,
    latencyP50: wf.summary.latency_p50_s,
  }));
}

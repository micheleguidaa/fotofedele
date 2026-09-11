// Run with `npm test` (Node >= 22.18 strips TypeScript types natively; no test framework needed).
import assert from "node:assert/strict";
import { test } from "node:test";

import { computeScores, normalizeWeights, type ScoreInput } from "./score.ts";

const items: ScoreInput[] = [
  { id: "A", passes: true, winrate: 0.8, naturalezza: 4.2, cost: 0.1, latencyP50: 60 },
  { id: "B", passes: true, winrate: 0.5, naturalezza: 3.4, cost: 0.001, latencyP50: 1 },
  { id: "C", passes: true, winrate: 0.6, naturalezza: 3.8, cost: 0.01, latencyP50: 10 },
  { id: "X", passes: false, winrate: 0.95, naturalezza: 4.8, cost: 0.2, latencyP50: 90 },
];

test("weights are normalised to sum 1", () => {
  const w = normalizeWeights({ quality: 2, naturalness: 1, cost: 1, speed: 0 });
  assert.equal(w.quality + w.naturalness + w.cost + w.speed, 1);
  assert.equal(w.quality, 0.5);
  assert.deepEqual(normalizeWeights({ quality: 0, naturalness: 0, cost: 0, speed: 0 }), {
    quality: 0,
    naturalness: 0,
    cost: 0,
    speed: 0,
  });
});

test("workflows failing a gate get no score and no rank", () => {
  const rows = computeScores(items, { quality: 1, naturalness: 0, cost: 0, speed: 0 });
  const x = rows.find((r) => r.id === "X")!;
  assert.equal(x.score, null);
  assert.equal(x.rank, null);
});

test("cost and speed scores are min-max over passing workflows only", () => {
  const rows = computeScores(items, { quality: 0, naturalness: 0, cost: 1, speed: 1 });
  const a = rows.find((r) => r.id === "A")!;
  const b = rows.find((r) => r.id === "B")!;
  const c = rows.find((r) => r.id === "C")!;
  assert.equal(b.costScore, 1); // cheapest passing
  assert.equal(a.costScore, 0); // most expensive passing (X is ignored)
  assert.ok(Math.abs((c.costScore as number) - 0.5) < 1e-9); // log scale: 0.01 is halfway between 0.001 and 0.1
  assert.equal(b.speedScore, 1);
  assert.equal(a.speedScore, 0);
});

test("pure quality weight ranks by win-rate", () => {
  const rows = computeScores(items, { quality: 1, naturalness: 0, cost: 0, speed: 0 });
  const rank = Object.fromEntries(rows.map((r) => [r.id, r.rank]));
  assert.deepEqual(rank, { A: 1, C: 2, B: 3, X: null });
  assert.equal(rows.find((r) => r.id === "A")!.score, 0.8);
});

test("formula matches the documented definition", () => {
  const rows = computeScores(items, { quality: 0.5, naturalness: 0.2, cost: 0.15, speed: 0.15 });
  const c = rows.find((r) => r.id === "C")!;
  const speed = 1 - (10 - 1) / (60 - 1);
  const expected = 0.5 * 0.6 + (0.2 * (3.8 - 1)) / 4 + 0.15 * 0.5 + 0.15 * speed;
  assert.ok(Math.abs((c.score as number) - expected) < 1e-9);
});

test("single passing workflow gets full cost and speed scores", () => {
  const rows = computeScores([items[0], items[3]], { quality: 0, naturalness: 0, cost: 1, speed: 1 });
  assert.equal(rows[0].score, 1);
  assert.equal(rows[0].rank, 1);
});

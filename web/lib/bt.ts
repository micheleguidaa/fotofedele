// Bradley–Terry strengths from pairwise votes (MM algorithm, Hunter 2004).
// Ties count as half a win for each side. A weak prior (virtual draws against a reference
// player of strength 1) keeps strengths finite when a contender has only wins or only losses.

export interface Match {
  a: string;
  b: string;
  /** Score of `a`: 1 = a wins, 0 = b wins, 0.5 = tie. */
  result: 0 | 0.5 | 1;
}

export function bradleyTerry(
  players: string[],
  matches: Match[],
  opts: { iterations?: number; prior?: number } = {},
): Record<string, number> {
  const iterations = opts.iterations ?? 200;
  const prior = opts.prior ?? 1;
  const idx = new Map(players.map((p, i) => [p, i]));
  const n = players.length;
  const wins = new Array<number>(n).fill(0);
  const games: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));

  for (const m of matches) {
    const i = idx.get(m.a);
    const j = idx.get(m.b);
    if (i === undefined || j === undefined || i === j) continue;
    wins[i] += m.result;
    wins[j] += 1 - m.result;
    games[i][j] += 1;
    games[j][i] += 1;
  }

  let p = new Array<number>(n).fill(1);
  for (let it = 0; it < iterations; it++) {
    const next = p.map((pi, i) => {
      let denom = prior / (pi + 1); // virtual games vs the reference (strength 1)
      for (let j = 0; j < n; j++) if (games[i][j] > 0) denom += games[i][j] / (pi + p[j]);
      return (wins[i] + prior / 2) / denom;
    });
    const delta = next.reduce((acc, v, i) => Math.max(acc, Math.abs(v - p[i])), 0);
    p = next;
    if (delta < 1e-9) break;
  }
  return Object.fromEntries(players.map((pl, i) => [pl, p[i]]));
}

/** Probability that `a` beats `b` under the fitted strengths. */
export function winProbability(strengths: Record<string, number>, a: string, b: string): number {
  const pa = strengths[a] ?? 1;
  const pb = strengths[b] ?? 1;
  return pa / (pa + pb);
}

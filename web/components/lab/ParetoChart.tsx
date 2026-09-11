"use client";

import { useState } from "react";

import { fmtPct, fmtUsd } from "@/lib/format";

export interface ParetoPoint {
  id: string;
  name: string;
  cost: number;
  winrate: number;
  ci: [number, number];
  flag: number; // fidelity flag rate 0..1
  passes: boolean; // both gates
  reliability: boolean;
  fidelity: boolean;
}

const W = 720;
const H = 400;
const M = { top: 34, right: 28, bottom: 52, left: 58 };
const IW = W - M.left - M.right;
const IH = H - M.top - M.bottom;
const FLAG_FULL = 0.4; // flag rate rendered at full "risk" colour
const R = 8;

/** Fill from neutral grey (0% flags) to the "bad" status colour (≥ 40% flags). */
function riskFill(flag: number) {
  const p = Math.round(Math.min(1, Math.max(0, flag / FLAG_FULL)) * 100);
  return `color-mix(in oklch, var(--bad) ${p}%, var(--chart-neutral))`;
}

function niceLogTicks(min: number, max: number): number[] {
  const ticks: number[] = [];
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
    for (const m of [1, 3]) {
      const v = m * 10 ** e;
      if (v >= min && v <= max) ticks.push(v);
    }
  }
  return ticks;
}

export function ParetoChart({ points, fidelityMax }: { points: ParetoPoint[]; fidelityMax: number }) {
  const [active, setActive] = useState<string | null>(null);
  if (!points.length) return null;

  const costs = points.map((p) => Math.max(p.cost, 1e-5));
  const lo = Math.log10(Math.min(...costs) / 2.5);
  const hi = Math.log10(Math.max(...costs) * 2.5);
  const x = (c: number) => M.left + ((Math.log10(Math.max(c, 1e-5)) - lo) / (hi - lo)) * IW;
  const y = (v: number) => M.top + (1 - v) * IH;

  // Dodge points that share (almost) the same cost so they stay readable.
  const sorted = [...points].sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
  const groups: ParetoPoint[][] = [];
  for (const p of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(x(p.cost) - x(g[0].cost)) < 14) g.push(p);
    else groups.push([p]);
  }
  const pos = new Map<string, { cx: number; cy: number; dodged: boolean }>();
  for (const g of groups) {
    g.forEach((p, i) => {
      const offset = (i - (g.length - 1) / 2) * 26;
      pos.set(p.id, { cx: x(p.cost) + offset, cy: y(p.winrate), dodged: g.length > 1 });
    });
  }

  // Pareto frontier: nobody else is at most as expensive AND at least as good (strictly better in one).
  const frontier = points
    .filter((p) => !points.some((q) => q !== p && q.cost <= p.cost && q.winrate >= p.winrate && (q.cost < p.cost || q.winrate > p.winrate)))
    .sort((a, b) => a.cost - b.cost);

  const xTicks = niceLogTicks(10 ** lo, 10 ** hi);
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const act = points.find((p) => p.id === active) ?? null;
  const actPos = act ? pos.get(act.id) : null;

  return (
    <figure>
      <div className="overflow-x-auto">
        <div className="relative min-w-[520px]">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="group"
          aria-label="Frontiera costo-qualità: costo per foto (asse orizzontale, scala logaritmica) contro win-rate di qualità (asse verticale). Colore del punto: tasso di flag di fedeltà."
        >
          {/* grid + axes */}
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
              <text x={M.left - 10} y={y(t)} textAnchor="end" dominantBaseline="middle" className="tabular" fontSize={12} fill="var(--muted)">
                {fmtPct(t)}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={M.top} y2={H - M.bottom} stroke="var(--grid)" strokeWidth={1} />
              <text x={x(t)} y={H - M.bottom + 18} textAnchor="middle" className="tabular" fontSize={12} fill="var(--muted)">
                {fmtUsd(t)}
              </text>
            </g>
          ))}
          <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} stroke="var(--axis)" strokeWidth={1} />
          <line x1={M.left} x2={W - M.right} y1={y(0.5)} y2={y(0.5)} stroke="var(--axis)" strokeWidth={1} strokeDasharray="4 4" />
          <text x={W - M.right} y={y(0.5) - 6} textAnchor="end" fontSize={11} fill="var(--muted)">
            pari con l&apos;originale
          </text>
          <text x={M.left + IW / 2} y={H - 10} textAnchor="middle" fontSize={12} fill="var(--muted)">
            Costo stimato per foto (scala logaritmica) →
          </text>
          <text transform={`translate(16 ${M.top + IH / 2}) rotate(-90)`} textAnchor="middle" fontSize={12} fill="var(--muted)">
            Win-rate qualità vs originale →
          </text>

          {/* frontier */}
          {frontier.length > 1 && (
            <polyline
              points={frontier.map((p) => `${pos.get(p.id)!.cx},${pos.get(p.id)!.cy}`).join(" ")}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.55}
            />
          )}

          {/* CI whiskers */}
          {points.map((p) => {
            const { cx } = pos.get(p.id)!;
            return <line key={`ci-${p.id}`} x1={cx} x2={cx} y1={y(p.ci[0])} y2={y(p.ci[1])} stroke="var(--muted)" strokeWidth={1.5} opacity={0.6} />;
          })}

          {/* points */}
          {points.map((p) => {
            const { cx, cy } = pos.get(p.id)!;
            const isActive = active === p.id;
            return (
              <g
                key={p.id}
                tabIndex={0}
                role="img"
                aria-label={`${p.id} ${p.name}: costo ${fmtUsd(p.cost)}, win-rate ${fmtPct(p.winrate)}, flag di fedeltà ${fmtPct(p.flag)}${p.passes ? ", supera i gate" : ", non supera i gate"}`}
                onMouseEnter={() => setActive(p.id)}
                onMouseLeave={() => setActive((a) => (a === p.id ? null : a))}
                onFocus={() => setActive(p.id)}
                onBlur={() => setActive((a) => (a === p.id ? null : a))}
                className="cursor-pointer outline-none"
              >
                <circle cx={cx} cy={cy} r={20} fill="transparent" />
                {!p.passes && <circle cx={cx} cy={cy} r={R + 5} fill="none" stroke="var(--bad)" strokeWidth={1.5} strokeDasharray="3 2.5" />}
                <circle cx={cx} cy={cy} r={isActive ? R + 1.5 : R} style={{ fill: riskFill(p.flag) }} stroke="var(--surface)" strokeWidth={2} />
                {isActive && <circle cx={cx} cy={cy} r={R + 9} fill="none" stroke="var(--accent)" strokeWidth={2} />}
                <text x={cx} y={cy - R - (p.passes ? 7 : 11)} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--ink)" className="font-mono">
                  {p.id}
                </text>
              </g>
            );
          })}
        </svg>

      {act && actPos && (
        <div
          className="pointer-events-none absolute z-20 w-60 -translate-x-1/2 rounded-lg border border-line bg-surface p-3 text-xs shadow-lg"
          style={{ left: `${(actPos.cx / W) * 100}%`, top: `${Math.min(((actPos.cy + 24) / H) * 100, 70)}%` }}
        >
          <p className="font-semibold text-ink">
            <span className="font-mono">{act.id}</span> · {act.name}
          </p>
          <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted">
            <dt>Costo/foto</dt>
            <dd className="tabular text-right text-ink">{fmtUsd(act.cost)}</dd>
            <dt>Win-rate</dt>
            <dd className="tabular text-right text-ink">
              {fmtPct(act.winrate)} ({fmtPct(act.ci[0])}–{fmtPct(act.ci[1])})
            </dd>
            <dt>Flag di fedeltà</dt>
            <dd className="tabular text-right text-ink">{fmtPct(act.flag)}</dd>
            <dt>Gate</dt>
            <dd className="text-right text-ink">
              {act.passes ? "superati" : [!act.reliability && "affidabilità", !act.fidelity && "fedeltà"].filter(Boolean).join(" e ") + " ✗"}
            </dd>
          </dl>
        </div>
      )}
        </div>
      </div>

      <figcaption className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-20 rounded-full" style={{ background: "linear-gradient(90deg, var(--chart-neutral), var(--bad))" }} aria-hidden="true" />
          Flag di fedeltà: 0% → {fmtPct(FLAG_FULL)} o più
        </span>
        <span className="flex items-center gap-2">
          <svg viewBox="0 0 20 20" className="size-4" aria-hidden="true">
            <circle cx="10" cy="10" r="7.5" fill="none" stroke="var(--bad)" strokeWidth="1.5" strokeDasharray="3 2.5" />
          </svg>
          Non supera un gate (fedeltà ≤ {fmtPct(fidelityMax)} o affidabilità)
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3.5 w-px bg-muted" aria-hidden="true" />
          Intervallo di confidenza 95%
        </span>
        <span className="flex items-center gap-2">
          <span className="h-0.5 w-5 rounded bg-accent opacity-60" aria-hidden="true" />
          Frontiera di Pareto
        </span>
        {groups.some((g) => g.length > 1) && <span>Punti con lo stesso costo affiancati per leggibilità.</span>}
      </figcaption>
    </figure>
  );
}

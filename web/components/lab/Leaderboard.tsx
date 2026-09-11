"use client";

import { useMemo, useState } from "react";

import { fmtNum, fmtPct, fmtRubric, fmtScore, fmtSeconds, fmtUsd } from "@/lib/format";
import { computeScores, normalizeWeights, scoreInputsFromWorkflows, type Weights } from "@/lib/score";
import type { Results, Workflow } from "@/lib/types";

import { CHECKLIST_LABEL } from "@/lib/labels";

import { GenerativeBadge, IconCheck, IconX, Pill, Tip, WorkflowTag, cx } from "../ui";

const CRITERIA: { key: keyof Weights; label: string; hint: string; color: string }[] = [
  { key: "quality", label: "Qualità", hint: "win-rate contro l'originale", color: "var(--c1)" },
  { key: "naturalness", label: "Naturalezza", hint: "rubrica 1–5 riportata a 0–1", color: "var(--c2)" },
  { key: "cost", label: "Costo", hint: "costo per foto, scala logaritmica", color: "var(--c3)" },
  { key: "speed", label: "Velocità", hint: "latenza mediana", color: "var(--c4)" },
];

const toSlider = (w: Weights): Weights => {
  const n = normalizeWeights(w);
  return { quality: Math.round(n.quality * 100), naturalness: Math.round(n.naturalness * 100), cost: Math.round(n.cost * 100), speed: Math.round(n.speed * 100) };
};

function GateCell({ pass, label }: { pass: boolean; label: string }) {
  return (
    <Tip label={label}>
      {pass ? (
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-ok-soft text-ok">
          <IconCheck />
          <span className="sr-only">superato</span>
        </span>
      ) : (
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-bad-soft text-bad">
          <IconX />
          <span className="sr-only">non superato</span>
        </span>
      )}
    </Tip>
  );
}

export function Leaderboard({ workflows, decision }: { workflows: Workflow[]; decision: Results["decision"] }) {
  const declared = useMemo(() => toSlider(decision.weights), [decision.weights]);
  const [w, setW] = useState<Weights>(declared);
  const norm = normalizeWeights(w);
  const rows = useMemo(() => computeScores(scoreInputsFromWorkflows(workflows), w), [workflows, w]);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const sorted = [...workflows].sort((a, b) => {
    const ra = byId[a.id]?.rank ?? null;
    const rb = byId[b.id]?.rank ?? null;
    if (ra !== null && rb !== null) return ra - rb;
    if (ra !== null) return -1;
    if (rb !== null) return 1;
    return a.id.localeCompare(b.id);
  });
  const leader = rows.find((r) => r.rank === 1)?.id ?? null;
  const isDeclared = CRITERIA.every((c) => Math.abs(norm[c.key] - normalizeWeights(declared)[c.key]) < 1e-9);
  const maxScore = Math.max(0.0001, ...rows.map((r) => r.score ?? 0));
  const gates = decision.gates;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <fieldset className="rounded-xl border border-line bg-surface p-5">
          <legend className="sr-only">Pesi del punteggio</legend>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">Pesi del punteggio</p>
            <button
              type="button"
              onClick={() => setW(declared)}
              disabled={isDeclared}
              className="rounded-md border border-line-strong px-2.5 py-1 text-xs font-semibold hover:bg-subtle disabled:cursor-default disabled:opacity-50"
            >
              Ripristina pesi dichiarati
            </button>
          </div>
          <div className="mt-4 space-y-4">
            {CRITERIA.map((c) => (
              <div key={c.key}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <label htmlFor={`w-${c.key}`} className="flex items-center gap-2 font-medium">
                    <span className="inline-block size-2.5 rounded-sm" style={{ background: c.color }} aria-hidden="true" />
                    {c.label}
                    <span className="font-normal text-muted">· {c.hint}</span>
                  </label>
                  <span className="tabular font-semibold">{fmtPct(norm[c.key])}</span>
                </div>
                <input
                  id={`w-${c.key}`}
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={w[c.key]}
                  onChange={(e) => setW((prev) => ({ ...prev, [c.key]: Number(e.target.value) }))}
                  aria-valuetext={`${fmtPct(norm[c.key])} del punteggio`}
                  className="mt-1 w-full"
                />
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm" aria-live="polite">
            {leader ? (
              leader === decision.winner ? (
                <span>
                  Con questi pesi vince <strong>{leader}</strong>
                  {isDeclared ? ", come nella decisione dichiarata." : ": la scelta dichiarata non cambia."}
                </span>
              ) : (
                <span>
                  Con questi pesi vincerebbe <strong>{leader}</strong> invece di <strong>{decision.winner ?? "—"}</strong> (pesi
                  dichiarati).
                </span>
              )
            ) : (
              "Nessun workflow supera entrambi i gate."
            )}
          </p>
        </fieldset>

        <div className="rounded-xl border border-line bg-surface p-5 text-sm">
          <p className="font-semibold">Come si calcola</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
            <li>
              <span className="text-ink">Gate:</span> affidabilità ≥ {fmtPct(gates.reliability_min)} e flag di fedeltà ≤{" "}
              {fmtPct(gates.fidelity_flag_max)}. Chi non li supera non ha punteggio, qualunque sia la sua qualità.
            </li>
            <li>
              <span className="text-ink">Punteggio</span> solo tra chi supera i gate, con i pesi a sinistra (normalizzati a somma 1).
            </li>
          </ol>
          <div className="mt-3 overflow-x-auto rounded-lg bg-subtle p-3 font-mono text-[12px] leading-relaxed">
            <p className="whitespace-nowrap">
              punteggio = <span style={{ color: "var(--c1)" }}>■</span> {fmtNum(norm.quality, 2)}·win-rate +{" "}
              <span style={{ color: "var(--c2)" }}>■</span> {fmtNum(norm.naturalness, 2)}·(naturalezza − 1)/4 +{" "}
              <span style={{ color: "var(--c3)" }}>■</span> {fmtNum(norm.cost, 2)}·costScore +{" "}
              <span style={{ color: "var(--c4)" }}>■</span> {fmtNum(norm.speed, 2)}·speedScore
            </p>
            <p className="mt-1 whitespace-nowrap text-muted">costScore = 1 − log10(costo / costo_min) / log10(costo_max / costo_min)</p>
            <p className="whitespace-nowrap text-muted">speedScore = 1 − (p50 − p50_min) / (p50_max − p50_min)</p>
          </div>
          <p className="mt-2 text-xs text-muted">Minimi e massimi sono calcolati solo sui workflow che superano entrambi i gate.</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="data-table min-w-[1060px]">
          <caption className="sr-only">Classifica dei workflow: gate, qualità, fedeltà, costo, velocità e punteggio</caption>
          <thead>
            <tr>
              <th scope="col" className="num">
                #
              </th>
              <th scope="col">Workflow</th>
              <th scope="col" className="text-center">
                Affidabilità
              </th>
              <th scope="col" className="text-center">
                Fedeltà
              </th>
              <th scope="col" className="num">
                Win-rate qualità
                <br />
                <span className="font-normal">IC 95%</span>
              </th>
              <th scope="col" className="num">
                Naturalezza
              </th>
              <th scope="col" className="num">
                Difetti
                <br />
                corretti
              </th>
              <th scope="col" className="num">
                Flag
                <br />
                fedeltà
              </th>
              <th scope="col" className="num">
                Migliore
                <br />
                e fedele
              </th>
              <th scope="col" className="num">
                Costo/foto
              </th>
              <th scope="col" className="num">
                Latenza p50
              </th>
              <th scope="col">Punteggio</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((wf) => {
              const s = wf.summary;
              const row = byId[wf.id];
              const parts = row?.parts ?? null;
              const passes = s.gates.reliability && s.gates.fidelity;
              return (
                <tr key={wf.id} className={cx(!passes && "text-muted", row?.rank === 1 && "bg-accent-soft/60")}>
                  <td className="num font-semibold text-ink">{row?.rank ?? "—"}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <WorkflowTag id={wf.id} />
                      <div className="min-w-0">
                        <p className={cx("font-medium", passes ? "text-ink" : "text-muted")}>{wf.name}</p>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          <GenerativeBadge generative={wf.generative} />
                          {wf.id === decision.winner && <Pill tone="accent">Scelta dichiarata</Pill>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="text-center">
                    <GateCell
                      pass={s.gates.reliability}
                      label={`Successo ${s.n_ok}/${s.n_total} (${fmtPct(s.success_rate)}) · soglia ≥ ${fmtPct(gates.reliability_min)}`}
                    />
                  </td>
                  <td className="text-center">
                    <GateCell
                      pass={s.gates.fidelity}
                      label={`Flag di fedeltà ${fmtPct(s.fidelity_flag_rate)} · soglia ≤ ${fmtPct(gates.fidelity_flag_max)}`}
                    />
                  </td>
                  <td className="num">
                    <span className="font-semibold text-ink">{fmtPct(s.quality_winrate)}</span>
                    <br />
                    <span className="text-xs text-muted">
                      {fmtPct(s.quality_winrate_ci[0])}–{fmtPct(s.quality_winrate_ci[1])}
                    </span>
                  </td>
                  <td className="num">{fmtRubric(s.rubric.naturalezza)}/5</td>
                  <td className="num">{fmtPct(s.defect_fix_rate)}</td>
                  <td className={cx("num", !s.gates.fidelity && "font-semibold text-bad")}>
                    {Object.keys(s.fidelity_flag_breakdown ?? {}).length > 0 ? (
                      <Tip
                        label={Object.entries(s.fidelity_flag_breakdown)
                          .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                          .map(([k, v]) => `${CHECKLIST_LABEL[k as keyof typeof CHECKLIST_LABEL] ?? k}: ${fmtPct(v)}`)
                          .join(" · ")}
                      >
                        <span className="border-b border-dotted border-current">{fmtPct(s.fidelity_flag_rate)}</span>
                      </Tip>
                    ) : (
                      fmtPct(s.fidelity_flag_rate)
                    )}
                  </td>
                  <td className="num" title="Quota di foto in cui i giudici preferiscono l'output e la verifica di fedeltà non segnala nulla">
                    {s.safe_winrate != null ? fmtPct(s.safe_winrate) : "—"}
                  </td>
                  <td className="num">
                    <Tip
                      label={`${s.cost_note}${s.cost_range ? ` · intervallo ${fmtUsd(s.cost_range[0])}–${fmtUsd(s.cost_range[1])}` : ""}`}
                    >
                      <span>{fmtUsd(s.cost_usd_per_image)}</span>
                    </Tip>
                    <br />
                    <span className="text-xs text-muted">stimato</span>
                  </td>
                  <td className="num">
                    {fmtSeconds(s.latency_p50_s)}
                    <br />
                    <span className="text-xs text-muted">p90 {fmtSeconds(s.latency_p90_s)}</span>
                  </td>
                  <td>
                    {row && row.score !== null && parts ? (
                      <div className="flex items-center gap-2">
                        <span className="tabular w-10 text-right font-semibold text-ink">{fmtScore(row.score)}</span>
                        <span
                          className="flex h-2.5 w-28 gap-[2px]"
                          role="img"
                          aria-label={`Composizione: qualità ${fmtScore(parts.quality)}, naturalezza ${fmtScore(parts.naturalness)}, costo ${fmtScore(parts.cost)}, velocità ${fmtScore(parts.speed)}`}
                          title={`qualità ${fmtScore(parts.quality)} · naturalezza ${fmtScore(parts.naturalness)} · costo ${fmtScore(parts.cost)} · velocità ${fmtScore(parts.speed)}`}
                        >
                          {CRITERIA.map((c) => {
                            const v = parts[c.key];
                            if (v <= 0) return null;
                            return <span key={c.key} className="h-full first:rounded-l-sm last:rounded-r-sm" style={{ width: `${(v / maxScore) * 100}%`, background: c.color }} />;
                          })}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs">escluso dai gate</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">
        Win-rate: quota di confronti a coppie in cui i giudici AI preferiscono l&apos;output all&apos;originale (pari = ½), con
        intervallo di confidenza bootstrap al 95%. Costi stimati da listini e tempo GPU. Passa sopra i simboli dei gate per le soglie.
      </p>
    </div>
  );
}

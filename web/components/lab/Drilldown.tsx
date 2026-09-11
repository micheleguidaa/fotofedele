"use client";

import { useId, useState } from "react";

import { dataSrc, fmtRubric, fmtSeconds, fmtUsd } from "@/lib/format";
import { CHECKLIST_KEYS, CHECKLIST_LABEL, PREFERRED_LABEL, RUBRIC_KEYS, RUBRIC_LABEL, RUBRIC_SHORT, WORKFLOW_IDS, familyLabel } from "@/lib/labels";
import { METRICS, formatMetric, inTarget, metricValue, targetLabel } from "@/lib/metrics";
import type { ImageItem, JudgeId, Output, Results, TechMetrics, WorkflowId } from "@/lib/types";
import { useQueryParam } from "@/lib/use-query-param";

import { CompareSlider } from "../CompareSlider";
import { ChangesList, ChecklistGrid, FidelityBadge, FidelityFacts } from "../photo-panels";
import { IconAlert, IconCheck, IconX, Pill, Tip, WorkflowTag, cx } from "../ui";

type SourceKey = "input" | "gt" | WorkflowId;
interface Source {
  key: SourceKey;
  label: string;
  src?: string;
  w: number;
  h: number;
  metrics?: TechMetrics;
  output?: Output;
  disabled?: boolean;
}

export interface DrillWorkflow {
  id: WorkflowId;
  name: string;
  family: string;
  generative: boolean;
}

function buildSources(img: ImageItem, workflows: DrillWorkflow[]): Source[] {
  const list: Source[] = [{ key: "input", label: "Originale", src: img.input.src, w: img.input.w, h: img.input.h, metrics: img.input.metrics }];
  if (img.ground_truth) list.push({ key: "gt", label: "Originale pulito (riferimento)", src: img.ground_truth.src, w: img.ground_truth.w, h: img.ground_truth.h });
  for (const id of WORKFLOW_IDS) {
    const o = img.outputs[id];
    if (!o) continue;
    const name = workflows.find((w) => w.id === id)?.name ?? id;
    const ok = o.status === "ok" && !!o.src;
    list.push({
      key: id,
      label: `${id} · ${name}${ok ? "" : " (errore)"}`,
      src: o.src,
      w: o.w ?? img.input.w,
      h: o.h ?? img.input.h,
      metrics: o.metrics,
      output: o,
      disabled: !ok,
    });
  }
  return list;
}

function SourceSelect({ id, label, value, onChange, sources }: { id: string; label: string; value: SourceKey; onChange: (k: SourceKey) => void; sources: Source[] }) {
  return (
    <div className="min-w-0 flex-1">
      <label htmlFor={id} className="block text-xs font-semibold text-muted">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as SourceKey)}
        className="mt-1 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm"
      >
        {sources.map((s) => (
          <option key={s.key} value={s.key} disabled={s.disabled}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function MetricCell({ metricKey, m }: { metricKey: (typeof METRICS)[number]["key"]; m?: TechMetrics }) {
  const v = metricValue(m, metricKey);
  const ok = inTarget(metricKey, v);
  if (ok === null) return <td className="num text-muted">—</td>;
  return (
    <td className={cx("num font-medium", ok ? "text-ok" : "text-bad")}>
      <span className="inline-flex items-center gap-1">
        {ok ? <IconCheck className="size-3.5" /> : <IconX className="size-3.5" />}
        {formatMetric(metricKey, v)}
      </span>
      <span className="sr-only">{ok ? " (nell'obiettivo)" : " (fuori obiettivo)"}</span>
    </td>
  );
}

const winLabel = (w: number) => (w === 1 ? "Vince la migliorata" : w === 0 ? "Vince l'originale" : "Pareggio");

export function Drilldown({ image, workflows, judges }: { image: ImageItem; workflows: DrillWorkflow[]; judges: Results["judges"]["list"] }) {
  const uid = useId();
  const sources = buildSources(image, workflows);
  const valid = (k: string | null): k is SourceKey => !!k && sources.some((s) => s.key === k && !s.disabled);
  const routerDefault = [image.router.chosen, image.router.fallback, ...WORKFLOW_IDS].find((k) => valid(k ?? null)) as SourceKey | undefined;
  const qa = useQueryParam("a");
  const qb = useQueryParam("b");
  const [aChoice, setA] = useState<SourceKey | null>(null);
  const [bChoice, setB] = useState<SourceKey | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(false);

  const aKey: SourceKey = aChoice ?? (valid(qa) ? qa : "input");
  const bKey: SourceKey = bChoice ?? (valid(qb) ? qb : (routerDefault ?? (image.ground_truth ? "gt" : "input")));
  const A = sources.find((s) => s.key === aKey) ?? sources[0];
  const B = sources.find((s) => s.key === bKey) ?? sources[0];
  const inspectedKey = B.output ? B.key : A.output ? A.key : null;
  const inspected = inspectedKey ? sources.find((s) => s.key === inspectedKey)?.output : undefined;
  const inspectedWf = workflows.find((w) => w.id === inspectedKey);
  const ensemble = inspected?.ensemble;
  const judgeName = (id: JudgeId) => judges.find((j) => j.id === id);

  return (
    <div className="space-y-10">
      {/* ---------------------------------------------------------- compare */}
      <section aria-labelledby={`${uid}-cmp`} className="space-y-4">
        <h2 id={`${uid}-cmp`} className="text-xl font-semibold">
          Confronto
        </h2>
        <div className="flex flex-col gap-3 sm:flex-row">
          <SourceSelect id={`${uid}-a`} label="Immagine A (sinistra)" value={A.key} onChange={setA} sources={sources} />
          <SourceSelect id={`${uid}-b`} label="Immagine B (destra)" value={B.key} onChange={setB} sources={sources} />
        </div>
        <CompareSlider
          before={{ src: dataSrc(A.src) ?? "", alt: `A: ${A.label}`, label: A.key === "input" ? "Originale" : A.key === "gt" ? "Riferimento" : A.key }}
          after={{ src: dataSrc(B.src) ?? "", alt: `B: ${B.label}`, label: B.key === "input" ? "Originale" : B.key === "gt" ? "Riferimento" : B.key }}
          aspect={image.input.w / image.input.h}
          overlay={dataSrc(B.output?.heatmap)}
          showOverlay={showHeatmap}
          eager
        />
        <label className={cx("inline-flex items-center gap-2 text-sm", !B.output?.heatmap && "opacity-50")}>
          <input
            type="checkbox"
            checked={showHeatmap}
            disabled={!B.output?.heatmap}
            onChange={(e) => setShowHeatmap(e.target.checked)}
            className="size-4 accent-[var(--accent)]"
          />
          Sovrapponi a B la mappa delle modifiche strutturali
        </label>

        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="data-table min-w-[720px]">
            <caption className="sr-only">Tutti gli output per questa foto</caption>
            <thead>
              <tr>
                <th scope="col">Output</th>
                <th scope="col">Esito giudici</th>
                <th scope="col">Fedeltà</th>
                <th scope="col" className="num">
                  Difetti corretti
                </th>
                <th scope="col" className="num">
                  Latenza
                </th>
                <th scope="col" className="num">
                  Costo
                </th>
                <th scope="col">
                  <span className="sr-only">Azioni</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {WORKFLOW_IDS.filter((id) => image.outputs[id]).map((id) => {
                const o = image.outputs[id] as Output;
                const ok = o.status === "ok" && !!o.src;
                const nIn = image.input.defects.length;
                return (
                  <tr key={id} className={cx(B.key === id && "bg-accent-soft/60")}>
                    <td>
                      <span className="flex items-center gap-2">
                        <WorkflowTag id={id} />
                        <span className="text-sm">{workflows.find((w) => w.id === id)?.name}</span>
                        {image.router.chosen === id && <Pill tone="accent">router</Pill>}
                      </span>
                    </td>
                    {ok ? (
                      <>
                        <td className="text-sm">{o.ensemble ? winLabel(o.ensemble.win) : "—"}</td>
                        <td>{o.fidelity ? <FidelityBadge fidelity={o.fidelity} size="sm" /> : "—"}</td>
                        <td className="num">{nIn ? `${o.fixed_defects?.length ?? 0}/${nIn}` : "—"}</td>
                        <td className="num">{fmtSeconds(o.latency_s)}</td>
                        <td className="num">{fmtUsd(o.cost_usd)}</td>
                        <td>
                          <button
                            type="button"
                            onClick={() => setB(id)}
                            disabled={B.key === id}
                            className="rounded-md border border-line-strong px-2 py-1 text-xs font-semibold hover:bg-subtle disabled:opacity-50"
                          >
                            {B.key === id ? "In B" : "Metti in B"}
                          </button>
                        </td>
                      </>
                    ) : (
                      <td colSpan={6} className="text-sm text-bad">
                        Errore: {o.error ?? "nessun output"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------------------------------------------------------- metrics */}
      <section aria-labelledby={`${uid}-met`} className="space-y-3">
        <h2 id={`${uid}-met`} className="text-xl font-semibold">
          Metriche tecniche
        </h2>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="data-table min-w-[560px]">
            <thead>
              <tr>
                <th scope="col">Metrica</th>
                <th scope="col" className="num">
                  Obiettivo
                </th>
                <th scope="col" className="num">
                  A · {A.key === "input" ? "Originale" : A.key === "gt" ? "Riferimento" : A.key}
                </th>
                <th scope="col" className="num">
                  B · {B.key === "input" ? "Originale" : B.key === "gt" ? "Riferimento" : B.key}
                </th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => (
                <tr key={m.key}>
                  <th scope="row">
                    <Tip label={m.how}>
                      <span className="border-b border-dotted border-muted">{m.label}</span>
                    </Tip>
                  </th>
                  <td className="num text-muted">{targetLabel(m.key)}</td>
                  <MetricCell metricKey={m.key} m={A.metrics} />
                  <MetricCell metricKey={m.key} m={B.metrics} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(A.key === "gt" || B.key === "gt") && <p className="text-xs text-muted">Il riferimento pulito non ha metriche calcolate: serve per le metriche con riferimento più sotto.</p>}
      </section>

      {/* ---------------------------------------------------------- fidelity + judges */}
      {inspected && inspectedKey && inspected.status === "ok" && (
        <>
          <section aria-labelledby={`${uid}-fid`} className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id={`${uid}-fid`} className="flex items-center gap-2 text-xl font-semibold">
                Verifica di fedeltà · <WorkflowTag id={inspectedKey} />
              </h2>
              <FidelityBadge fidelity={inspected.fidelity} />
            </div>
            {inspected.fidelity ? (
              <div className="grid gap-5 lg:grid-cols-2">
                <div className="space-y-4 rounded-xl border border-line bg-surface p-5">
                  {inspected.fidelity.flag_reasons.length > 0 ? (
                    <ul className="space-y-1.5 text-sm">
                      {inspected.fidelity.flag_reasons.map((reason, i) => (
                        <li key={i} className="flex gap-2">
                          <IconAlert className="mt-0.5 size-4 shrink-0 text-warn" />
                          {reason}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted">Nessun motivo di segnalazione.</p>
                  )}
                  <FidelityFacts fidelity={inspected.fidelity} />
                  <ChecklistGrid checklist={inspected.fidelity.checklist_majority} title="Checklist · maggioranza dei giudici senza conflitto" />
                </div>
                <div className="space-y-3 rounded-xl border border-line bg-surface p-5">
                  <p className="text-xs font-semibold tracking-wide text-muted uppercase">Cosa è cambiato</p>
                  <ChangesList
                    inputMetrics={image.input.metrics}
                    outputMetrics={inspected.metrics}
                    fixed={inspected.fixed_defects}
                    remaining={inspected.remaining_defects}
                    added={inspected.new_defects}
                    ops={inspected.ops}
                    generative={inspectedWf?.generative}
                  />
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">Verifica non disponibile per questo output.</p>
            )}
          </section>

          {inspected.judges && inspected.judges.length > 0 && (
            <section aria-labelledby={`${uid}-jud`} className="space-y-3">
              <h2 id={`${uid}-jud`} className="flex items-center gap-2 text-xl font-semibold">
                Giudici · <WorkflowTag id={inspectedKey} /> contro l&apos;originale
              </h2>
              {ensemble && (
                <p className="text-sm">
                  <span className="font-semibold">{winLabel(ensemble.win)}</span>
                  <span className="text-muted">
                    {" "}
                    · giudici usati: {ensemble.judges_used.map((j) => judgeName(j)?.name ?? j).join(", ")} · rubrica media{" "}
                    {RUBRIC_KEYS.map((k) => `${RUBRIC_SHORT[k]} ${fmtRubric(ensemble.rubric_mean[k])}`).join(" · ")}
                  </span>
                </p>
              )}
              <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="data-table min-w-[900px]">
                  <thead>
                    <tr>
                      <th scope="col">Giudice</th>
                      <th scope="col">Preferisce</th>
                      <th scope="col" className="text-center">
                        Coerente A/B
                      </th>
                      <th scope="col">
                        Rubrica 1–5
                        <br />
                        <span className="font-normal">migliorata / originale</span>
                      </th>
                      <th scope="col">Checklist</th>
                      <th scope="col">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inspected.judges.map((v) => {
                      const j = judgeName(v.judge);
                      const flags = CHECKLIST_KEYS.filter((k) => v.checklist[k]);
                      return (
                        <tr key={v.judge} className={cx(v.excluded_conflict && "bg-subtle/60 text-muted")}>
                          <td>
                            <p className="font-medium text-ink">{j?.name ?? v.judge}</p>
                            <p className="text-xs text-muted">
                              {j?.model} · {familyLabel(j?.family ?? "")}
                            </p>
                            {v.excluded_conflict && (
                              <Pill tone="warn" className="mt-1" title="Stessa famiglia del modello che ha generato l'immagine: il verdetto non entra nell'ensemble">
                                Escluso per conflitto
                              </Pill>
                            )}
                          </td>
                          <td className="font-medium">{PREFERRED_LABEL[v.preferred]}</td>
                          <td className="text-center">
                            <Tip label={v.position_consistent ? "Stessa risposta invertendo l'ordine delle immagini" : "Risposta diversa invertendo l'ordine: registrato come pari"}>
                              {v.position_consistent ? <IconCheck className="size-4 text-ok" /> : <IconX className="size-4 text-bad" />}
                              <span className="sr-only">{v.position_consistent ? "Sì" : "No"}</span>
                            </Tip>
                          </td>
                          <td>
                            <div className="grid grid-cols-3 gap-x-3 gap-y-0.5 text-xs">
                              {RUBRIC_KEYS.map((k) => {
                                const o = v.rubric_output[k];
                                const i = v.rubric_input[k];
                                return (
                                  <span key={k} className="tabular whitespace-nowrap" title={RUBRIC_LABEL[k]}>
                                    <span className="text-muted">{RUBRIC_SHORT[k]}</span>{" "}
                                    <span className={cx("font-semibold", o > i ? "text-ok" : o < i ? "text-bad" : "text-ink")}>{o}</span>
                                    <span className="text-muted">/{i}</span>
                                  </span>
                                );
                              })}
                            </div>
                          </td>
                          <td className="text-xs">
                            {flags.length ? (
                              <ul className="space-y-0.5 text-warn">
                                {flags.map((k) => (
                                  <li key={k}>{CHECKLIST_LABEL[k]}</li>
                                ))}
                              </ul>
                            ) : (
                              <span className="text-muted">Nessun problema</span>
                            )}
                          </td>
                          <td className="max-w-72 text-sm">{v.notes}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted">
                Rubrica: verde se la migliorata supera l&apos;originale su quella dimensione, rosso se peggiora. Win-rate e checklist usano
                solo i giudici senza conflitto di interessi.
              </p>
            </section>
          )}
        </>
      )}
      {!inspected && <p className="text-sm text-muted">Seleziona un output in A o B per vedere verifica di fedeltà e giudici.</p>}
      {inspected && inspected.status === "ok" && !inspected.judges?.length && <p className="text-sm text-muted">Nessun verdetto dei giudici per questo output.</p>}
    </div>
  );
}

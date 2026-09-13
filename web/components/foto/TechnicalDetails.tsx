// "Dettagli tecnici" of the Foto view: every number behind the captions, closed by default.
// No hooks: the heatmap toggle state lives in PhotoViewer.
import { fmtNum, fmtRubric, fmtSeconds, fmtUsd } from "@/lib/format";
import { CHECKLIST_KEYS, CHECKLIST_LABEL, PREFERRED_LABEL, RUBRIC_KEYS, RUBRIC_LABEL, RUBRIC_SHORT, WORKFLOW_IDS, familyLabel } from "@/lib/labels";
import { METRICS, formatMetric, inTarget, metricValue, targetLabel } from "@/lib/metrics";
import type { ImageItem, JudgeId, Output, Results, TechMetrics, WorkflowId } from "@/lib/types";

import { ChangesList, ChecklistGrid, DiagnosisList, FidelityBadge, FidelityFacts } from "../photo-panels";
import { IconAlert, IconCheck, IconX, Pill, Tip, WorkflowTag, cx } from "../ui";
import { Toggle } from "./Toggle";

export interface DetailWorkflow {
  id: WorkflowId;
  name: string;
  family: string;
  generative: boolean;
}

const DEGRADATION_LABEL: Record<string, string> = {
  ev: "Esposizione (EV)",
  cast: "Dominante",
  cast_strength: "Intensità dominante",
  tilt_deg: "Inclinazione (°)",
  noise_sigma: "Rumore (σ)",
  target_mp: "Risoluzione (MP)",
  jpeg_q: "Qualità JPEG",
};
const CAST_LABEL: Record<string, string> = { green: "verde", warm: "calda", cool: "fredda", magenta: "magenta" };

const winLabel = (w: number) => (w === 1 ? "Vince la migliorata" : w === 0 ? "Vince l'originale" : "Pareggio");

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

export function TechnicalDetails({
  image,
  shownId,
  workflows,
  judges,
  showHeatmap,
  onShowHeatmap,
}: {
  image: ImageItem;
  shownId: WorkflowId | null;
  workflows: DetailWorkflow[];
  judges: Results["judges"]["list"];
  showHeatmap: boolean;
  onShowHeatmap: (v: boolean) => void;
}) {
  const out = shownId ? image.outputs[shownId] : undefined;
  const shown = out?.status === "ok" ? out : undefined;
  const wf = workflows.find((w) => w.id === shownId);
  const judgeInfo = (id: JudgeId) => judges.find((j) => j.id === id);
  const inputLabel = image.kind === "degraded" ? "Degradata" : "Originale";
  const fullRefRows = WORKFLOW_IDS.flatMap((wid) => {
    const o = image.outputs[wid];
    return o?.status === "ok" && o.full_ref ? [{ wid, fr: o.full_ref }] : [];
  });

  return (
    <details className="group rounded-xl border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-xl px-5 py-3.5 hover:bg-subtle [&::-webkit-details-marker]:hidden">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 text-muted transition-transform group-open:rotate-90" aria-hidden="true">
          <path d="M8 5l5 5-5 5" />
        </svg>
        <span className="font-semibold">Dettagli tecnici</span>
        <span className="ml-auto hidden text-sm text-muted sm:inline">metriche, verifica di fedeltà, voti dei giudici, costi</span>
      </summary>

      <div className="space-y-10 border-t border-line px-4 py-6 sm:px-6">
        {/* ---------------------------------------------------------- all versions */}
        <section aria-labelledby="det-all" className="space-y-3">
          <h3 id="det-all" className="text-base font-semibold">
            Tutte le versioni
          </h3>
          <p className="max-w-3xl text-sm leading-relaxed text-muted">
            <span className="font-medium text-ink">Router: </span>
            {image.router.reason}
          </p>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="data-table min-w-[640px]">
              <thead>
                <tr>
                  <th scope="col">Versione</th>
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
                </tr>
              </thead>
              <tbody>
                {WORKFLOW_IDS.filter((id) => image.outputs[id]).map((id) => {
                  const o = image.outputs[id] as Output;
                  const ok = o.status === "ok" && !!o.src;
                  const nIn = image.input.defects.length;
                  return (
                    <tr key={id} className={cx(shownId === id && "bg-accent-soft/60")}>
                      <td>
                        <span className="flex items-center gap-2">
                          <WorkflowTag id={id} />
                          <span className="text-sm">{workflows.find((w) => w.id === id)?.name}</span>
                        </span>
                      </td>
                      {ok ? (
                        <>
                          <td className="text-sm">{o.ensemble ? winLabel(o.ensemble.win) : "—"}</td>
                          <td>{o.fidelity ? <FidelityBadge fidelity={o.fidelity} size="sm" /> : "—"}</td>
                          <td className="num">{nIn ? `${o.fixed_defects?.length ?? 0}/${nIn}` : "—"}</td>
                          <td className="num">{fmtSeconds(o.latency_s)}</td>
                          <td className="num">{fmtUsd(o.cost_usd)}</td>
                        </>
                      ) : (
                        <td colSpan={5} className="text-sm text-bad">
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

        {/* ---------------------------------------------------------- diagnosis + measured changes */}
        <div className="grid gap-8 lg:grid-cols-2">
          <section aria-labelledby="det-diag" className="space-y-3">
            <h3 id="det-diag" className="text-base font-semibold">
              Diagnosi della foto di partenza
            </h3>
            <DiagnosisList metrics={image.input.metrics} defects={image.input.defects} />
          </section>
          {shown && shownId && (
            <section aria-labelledby="det-changes" className="space-y-3">
              <h3 id="det-changes" className="flex items-center gap-2 text-base font-semibold">
                Cosa è cambiato, misurato · <WorkflowTag id={shownId} />
              </h3>
              <ChangesList
                inputMetrics={image.input.metrics}
                outputMetrics={shown.metrics}
                fixed={shown.fixed_defects}
                remaining={shown.remaining_defects}
                added={shown.new_defects}
                ops={shown.ops}
                generative={wf?.generative}
              />
            </section>
          )}
        </div>

        {/* ---------------------------------------------------------- fidelity */}
        {shown?.fidelity && shownId && (
          <section aria-labelledby="det-fid" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 id="det-fid" className="flex items-center gap-2 text-base font-semibold">
                Verifica di fedeltà · <WorkflowTag id={shownId} />
              </h3>
              <FidelityBadge fidelity={shown.fidelity} />
            </div>
            {shown.fidelity.flag_reasons.length > 0 ? (
              <ul className="space-y-1.5 text-sm">
                {shown.fidelity.flag_reasons.map((reason, i) => (
                  <li key={i} className="flex gap-2">
                    <IconAlert className="mt-0.5 size-4 shrink-0 text-warn" />
                    {reason}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Struttura, contenuto e inquadratura coerenti con l&apos;originale; nessun giudice ha segnalato modifiche alla casa.</p>
            )}
            <FidelityFacts fidelity={shown.fidelity} />
            <ChecklistGrid checklist={shown.fidelity.checklist_majority} title="Checklist · maggioranza dei giudici senza conflitto" />
            <Toggle
              checked={showHeatmap}
              onChange={onShowHeatmap}
              disabled={!shown.heatmap}
              label="Mostra sullo slider la mappa delle modifiche strutturali"
            />
          </section>
        )}

        {/* ---------------------------------------------------------- technical metrics */}
        <section aria-labelledby="det-met" className="space-y-3">
          <h3 id="det-met" className="text-base font-semibold">
            Metriche tecniche
          </h3>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="data-table min-w-[520px]">
              <thead>
                <tr>
                  <th scope="col">Metrica</th>
                  <th scope="col" className="num">
                    Obiettivo
                  </th>
                  <th scope="col" className="num">
                    {inputLabel}
                  </th>
                  <th scope="col" className="num">
                    {shownId ?? "—"}
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
                    <MetricCell metricKey={m.key} m={image.input.metrics} />
                    <MetricCell metricKey={m.key} m={shown?.metrics} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ---------------------------------------------------------- judges */}
        {shown?.judges && shown.judges.length > 0 && shownId && (
          <section aria-labelledby="det-jud" className="space-y-3">
            <h3 id="det-jud" className="flex items-center gap-2 text-base font-semibold">
              Giudici · <WorkflowTag id={shownId} /> contro l&apos;originale
            </h3>
            {shown.ensemble && (
              <p className="text-sm">
                <span className="font-semibold">{winLabel(shown.ensemble.win)}</span>
                <span className="text-muted">
                  {" "}
                  · giudici usati: {shown.ensemble.judges_used.map((j) => judgeInfo(j)?.name ?? j).join(", ")}
                  {shown.ensemble.rubric_mean && ` · rubrica media ${RUBRIC_KEYS.map((k) => `${RUBRIC_SHORT[k]} ${fmtRubric(shown.ensemble!.rubric_mean[k])}`).join(" · ")}`}
                </span>
              </p>
            )}
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="data-table min-w-[900px]">
                <thead>
                  <tr>
                    <th scope="col">Giudice</th>
                    <th scope="col">Preferisce</th>
                    <th scope="col" className="text-center">
                      Coerente
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
                  {shown.judges.map((v) => {
                    const j = judgeInfo(v.judge);
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
                          {v.position_consistent === null ? (
                            <Tip label="Chiesto in un solo ordine">
                              <span className="text-muted">—</span>
                            </Tip>
                          ) : (
                            <Tip label={v.position_consistent ? "Stessa risposta invertendo l'ordine delle immagini" : "Risposta diversa invertendo l'ordine: registrato come pari"}>
                              {v.position_consistent ? <IconCheck className="size-4 text-ok" /> : <IconX className="size-4 text-bad" />}
                              <span className="sr-only">{v.position_consistent ? "Sì" : "No"}</span>
                            </Tip>
                          )}
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
              Rubrica: verde se la migliorata supera l&apos;originale su quella dimensione, rosso se peggiora. Win-rate e checklist usano solo i
              giudici senza conflitto di interessi.
            </p>
          </section>
        )}

        {/* ---------------------------------------------------------- degraded photos: full-reference metrics */}
        {image.kind === "degraded" && (
          <section aria-labelledby="det-fullref" className="space-y-3">
            <h3 id="det-fullref" className="text-base font-semibold">
              Metriche con riferimento
            </h3>
            <p className="max-w-3xl text-sm text-muted">
              Questa foto è stata degradata ad arte partendo da un originale pulito: si può misurare quanto ogni workflow ci si riavvicina.
              PSNR e SSIM più alti sono meglio; LPIPS (distanza percettiva) più basso è meglio.
            </p>
            {image.degradation && (
              <dl className="flex flex-wrap gap-2 text-sm">
                {Object.entries(image.degradation).map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-line px-3 py-1.5">
                    <dt className="inline text-muted">{DEGRADATION_LABEL[k] ?? k}: </dt>
                    <dd className="tabular inline font-medium">{typeof v === "number" ? fmtNum(v, Math.abs(v) >= 10 ? 0 : 2) : (CAST_LABEL[v] ?? v)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {fullRefRows.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="data-table min-w-[520px]">
                  <thead>
                    <tr>
                      <th scope="col">Workflow</th>
                      <th scope="col" className="num">
                        PSNR (dB) ↑
                      </th>
                      <th scope="col" className="num">
                        SSIM ↑
                      </th>
                      <th scope="col" className="num">
                        LPIPS ↓
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {fullRefRows.map(({ wid, fr }) => {
                      const best = (key: "psnr" | "ssim" | "lpips") => {
                        const vals = fullRefRows.map((x) => x.fr[key]);
                        return key === "lpips" ? Math.min(...vals) === fr[key] : Math.max(...vals) === fr[key];
                      };
                      return (
                        <tr key={wid}>
                          <th scope="row">
                            <span className="flex items-center gap-2">
                              <WorkflowTag id={wid} /> {workflows.find((w) => w.id === wid)?.name}
                            </span>
                          </th>
                          <td className={cx("num", best("psnr") && "font-semibold text-ok")}>{fmtNum(fr.psnr, 1)}</td>
                          <td className={cx("num", best("ssim") && "font-semibold text-ok")}>{fmtNum(fr.ssim, 3)}</td>
                          <td className={cx("num", best("lpips") && "font-semibold text-ok")}>{fmtNum(fr.lpips, 3)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted">Metriche con riferimento non disponibili.</p>
            )}
          </section>
        )}
      </div>
    </details>
  );
}

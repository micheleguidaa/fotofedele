// Panels shared by Studio, live upload and drill-down (no hooks: usable from server and client).
import { fmtNum, fmtPctRaw } from "@/lib/format";
import { CHECKLIST_KEYS, CHECKLIST_LABEL, DEFECT_LABEL } from "@/lib/labels";
import { DEFECT_METRIC, DEFECT_ORDER, METRIC_BY_KEY, formatMetric, targetLabel } from "@/lib/metrics";
import { describeOps } from "@/lib/ops";
import type { Defect, Fidelity, FidelityChecklist, TechMetrics } from "@/lib/types";

import { IconAlert, IconCheck, Pill, cx } from "./ui";

export function DiagnosisList({ metrics, defects }: { metrics: TechMetrics; defects: Defect[] }) {
  const sorted = DEFECT_ORDER.filter((d) => defects.includes(d));
  const okNames = DEFECT_ORDER.filter((d) => !defects.includes(d)).map((d) => METRIC_BY_KEY[DEFECT_METRIC[d]].short);
  return (
    <div>
      {sorted.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-ok">
          <IconCheck /> Nessun difetto fuori obiettivo.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {sorted.map((d) => {
            const key = DEFECT_METRIC[d];
            return (
              <li key={d} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
                <span className="flex items-center gap-2 font-medium">
                  <span className="size-2 shrink-0 rounded-full bg-warn" aria-hidden="true" />
                  {DEFECT_LABEL[d]}
                </span>
                <span className="tabular text-muted">
                  <span className="font-semibold text-warn">{formatMetric(key, metrics[key])}</span>
                  <span className="px-1">·</span>obiettivo {targetLabel(key)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {okNames.length > 0 && <p className="mt-2 text-xs text-muted">Nella norma: {okNames.join(", ").toLowerCase()}.</p>}
    </div>
  );
}

export function ChangesList({
  inputMetrics,
  outputMetrics,
  fixed = [],
  remaining = [],
  added = [],
  ops,
  generative,
}: {
  inputMetrics: TechMetrics;
  outputMetrics?: TechMetrics;
  fixed?: Defect[];
  remaining?: Defect[];
  added?: Defect[];
  ops?: Record<string, unknown> | null;
  generative?: boolean;
}) {
  const val = (m: TechMetrics | undefined, d: Defect) => (m ? formatMetric(DEFECT_METRIC[d], m[DEFECT_METRIC[d]]) : "—");
  const opLines = describeOps(ops);
  const rows: { d: Defect; kind: "fixed" | "remaining" | "added" }[] = [
    ...fixed.map((d) => ({ d, kind: "fixed" as const })),
    ...remaining.map((d) => ({ d, kind: "remaining" as const })),
    ...added.map((d) => ({ d, kind: "added" as const })),
  ];
  return (
    <div className="space-y-4">
      {rows.length > 0 ? (
        <ul className="space-y-1.5 text-sm">
          {rows.map(({ d, kind }) => (
            <li key={`${kind}-${d}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              {kind === "fixed" && (
                <Pill tone="ok">
                  <IconCheck className="size-3.5" /> Corretto
                </Pill>
              )}
              {kind === "remaining" && <Pill tone="warn">Ancora fuori obiettivo</Pill>}
              {kind === "added" && (
                <Pill tone="bad">
                  <IconAlert className="size-3.5" /> Introdotto
                </Pill>
              )}
              <span className="font-medium">{DEFECT_LABEL[d]}</span>
              <span className="tabular text-muted">
                {val(inputMetrics, d)} → {val(outputMetrics, d)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nessun difetto da correggere e nessun difetto introdotto.</p>
      )}
      {opLines.length > 0 ? (
        <div>
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Passaggi eseguiti</p>
          <ol className="mt-1.5 space-y-1 text-sm">
            {opLines.map((l, i) => (
              <li key={i} className={cx("flex gap-2", l.skipped && "text-muted")}>
                <span className="tabular w-4 shrink-0 text-right text-muted">{i + 1}.</span>
                <span>
                  {l.title}
                  {l.detail && <span className="text-muted"> — {l.detail}</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : generative ? (
        <p className="text-sm text-muted">
          Modifica generata da un modello: non esiste un elenco dei singoli passaggi, per questo il risultato passa dalla
          verifica di fedeltà.
        </p>
      ) : null}
    </div>
  );
}

export function FidelityBadge({ fidelity, size = "md" }: { fidelity?: Fidelity | null; size?: "sm" | "md" }) {
  const base = cx("inline-flex items-center gap-1.5 rounded-full font-semibold", size === "md" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs");
  if (!fidelity) return <span className={cx(base, "border border-line text-muted")}>Verifica non disponibile</span>;
  return fidelity.flag ? (
    <span className={cx(base, "bg-warn-soft text-warn")}>
      <IconAlert /> Da controllare
    </span>
  ) : (
    <span className={cx(base, "bg-ok-soft text-ok")}>
      <IconCheck /> Nessuna alterazione rilevata
    </span>
  );
}

export function FidelityFacts({ fidelity, compact = false }: { fidelity: Fidelity; compact?: boolean }) {
  const facts: { label: string; value: string; hint: string }[] = [
    { label: "Struttura", value: fmtNum(fidelity.structural, 2), hint: "gradient-SSIM dopo allineamento, 1 = identica" },
    { label: "Area modificata", value: fmtPctRaw(fidelity.changed_area_pct, 1), hint: "quota dell'immagine con cambi strutturali" },
    { label: "Semantica", value: fmtNum(fidelity.semantic, 2), hint: "similarità DINOv2, 1 = stesso contenuto" },
    { label: "Inquadratura", value: fmtPctRaw(fidelity.framing_kept_pct, 0), hint: "quota del fotogramma originale ancora visibile" },
  ];
  return (
    <dl className={cx("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4")}>
      {facts.map((f) => (
        <div key={f.label} className="rounded-lg bg-subtle px-3 py-2" title={f.hint}>
          <dt className="text-xs text-muted">{f.label}</dt>
          <dd className="tabular text-base font-semibold">{f.value}</dd>
        </div>
      ))}
      {!fidelity.alignment_ok && (
        <div className="col-span-full flex items-center gap-2 text-xs text-warn">
          <IconAlert className="size-3.5" /> Allineamento non riuscito: le misure strutturali sono meno affidabili.
        </div>
      )}
    </dl>
  );
}

export function ChecklistGrid({ checklist, title }: { checklist: FidelityChecklist; title?: string }) {
  return (
    <div>
      {title && <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">{title}</p>}
      <ul className="grid gap-1 text-sm sm:grid-cols-2">
        {CHECKLIST_KEYS.map((k) => (
          <li key={k} className={cx("flex items-start gap-2", checklist[k] ? "font-medium text-warn" : "text-muted")}>
            {checklist[k] ? <IconAlert className="mt-0.5 size-4 shrink-0" /> : <IconCheck className="mt-0.5 size-4 shrink-0 text-ok" />}
            <span>
              {CHECKLIST_LABEL[k]}
              <span className="sr-only">{checklist[k] ? ": problema rilevato" : ": nessun problema"}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

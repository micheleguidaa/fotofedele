"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

import { dataSrc } from "@/lib/format";
import { KIND_LABEL, WORKFLOW_IDS } from "@/lib/labels";
import type { ImageItem, Output, WorkflowId } from "@/lib/types";
import { useQueryParam } from "@/lib/use-query-param";

import { CompareSlider } from "../CompareSlider";
import { ChangesList, DiagnosisList, FidelityBadge, FidelityFacts } from "../photo-panels";
import { GenerativeBadge, IconAlert, IconArrowRight, IconCheck, Pill, WorkflowTag, cx } from "../ui";

export interface StudioWorkflow {
  id: WorkflowId;
  name: string;
  short: string;
  generative: boolean;
}

type Decision = "accepted" | "original";
interface ImageState {
  shown?: WorkflowId;
  decision?: Decision;
  decidedWf?: WorkflowId;
}

const okOutput = (img: ImageItem, id: WorkflowId | null | undefined): Output | undefined => {
  if (!id) return undefined;
  const o = img.outputs[id];
  return o && o.status === "ok" && o.src ? o : undefined;
};

/** Router choice first, then its fallback, then the other ok outputs (no fidelity flag first, then best win). */
/** Disclosure shown on the published photo: generative edits say so explicitly. */
function disclosureLabel(generative?: boolean): string {
  return generative ? "Foto migliorata con AI" : "Foto migliorata digitalmente";
}

function alternativesFor(img: ImageItem): WorkflowId[] {
  const first: WorkflowId[] = [];
  const chosen = img.router.chosen;
  if (chosen !== "reshoot" && okOutput(img, chosen)) first.push(chosen);
  const fb = img.router.fallback;
  if (fb && okOutput(img, fb) && !first.includes(fb)) first.push(fb);
  const flag = (id: WorkflowId) => (okOutput(img, id)?.fidelity?.flag ? 1 : 0);
  const win = (id: WorkflowId) => okOutput(img, id)?.ensemble?.win ?? 0;
  const rest = WORKFLOW_IDS.filter((id) => okOutput(img, id) && !first.includes(id)).sort(
    (a, b) => flag(a) - flag(b) || win(b) - win(a),
  );
  return [...first, ...rest];
}

function Step({ n, title, children, aside }: { n: number; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <li className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2.5 font-semibold">
          <span className="flex size-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-on-accent" aria-hidden="true">
            {n}
          </span>
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </li>
  );
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={cx("inline-flex cursor-pointer items-center gap-2 text-sm", disabled && "cursor-not-allowed opacity-50")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors",
          checked ? "border-accent bg-accent" : "border-line-strong bg-subtle",
        )}
      >
        <span className={cx("inline-block size-4 rounded-full bg-surface shadow transition-transform", checked ? "translate-x-5" : "translate-x-1")} />
      </button>
      <span>{label}</span>
    </label>
  );
}

export function StudioApp({ images, workflows }: { images: ImageItem[]; workflows: StudioWorkflow[] }) {
  const wf = useMemo(() => Object.fromEntries(workflows.map((w) => [w.id, w])) as Record<WorkflowId, StudioWorkflow>, [workflows]);
  const okWf = (id?: WorkflowId | null) => (id ? wf[id] : undefined);
  const fromUrl = useQueryParam("foto");
  const [picked, setPicked] = useState<string | null>(null);
  const selectedId = picked ?? (fromUrl && images.some((i) => i.id === fromUrl) ? fromUrl : images[0]?.id);
  const [byImage, setByImage] = useState<Record<string, ImageState>>({});
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [aiLabel, setAiLabel] = useState(true);

  const img = images.find((i) => i.id === selectedId) ?? images[0];
  const alternatives = useMemo(() => (img ? alternativesFor(img) : []), [img]);
  if (!img) return <p className="text-muted">Nessuna foto disponibile.</p>;

  const st = byImage[img.id] ?? {};
  const shownId = st.shown && alternatives.includes(st.shown) ? st.shown : (alternatives[0] ?? null);
  const shown = okOutput(img, shownId);
  const shownWf = shownId ? wf[shownId] : undefined;
  const altIndex = shownId ? alternatives.indexOf(shownId) : -1;
  const reshoot = img.router.chosen === "reshoot";
  const isRouterChoice = !reshoot && shownId === img.router.chosen;

  const update = (patch: ImageState) => setByImage((prev) => ({ ...prev, [img.id]: { ...prev[img.id], ...patch } }));
  const nextAlternative = () => {
    if (alternatives.length < 2) return;
    const next = alternatives[(altIndex + 1) % alternatives.length];
    update({ shown: next });
  };

  const decided = Object.values(byImage).filter((s) => s.decision);
  const nAccepted = decided.filter((s) => s.decision === "accepted").length;
  const nOriginal = decided.length - nAccepted;

  const inputSrc = dataSrc(img.input.src)!;
  const afterSrc = shown ? dataSrc(shown.src)! : inputSrc;

  return (
    <div className="space-y-8">
      {/* ------------------------------------------------ picker */}
      <section aria-labelledby="picker-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <h2 id="picker-title" className="text-lg font-semibold">
            Scegli una foto caricata dall&apos;agente
          </h2>
          <p className="text-sm text-muted" aria-live="polite">
            {decided.length === 0
              ? `${images.length} foto in attesa di revisione`
              : `Decise ${decided.length} su ${images.length} · ${nAccepted} migliorate · ${nOriginal} originali`}
          </p>
        </div>
        <ul className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-8 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-12">
          {images.map((it) => {
            const s = byImage[it.id];
            const active = it.id === img.id;
            return (
              <li key={it.id} className="w-20 shrink-0 snap-start sm:w-auto">
                <button
                  type="button"
                  onClick={() => setPicked(it.id)}
                  aria-pressed={active}
                  aria-label={`${it.id}, ${it.note}${s?.decision === "accepted" ? ", accettata" : s?.decision === "original" ? ", originale" : ""}`}
                  className={cx(
                    "group relative block aspect-[4/3] w-full overflow-hidden rounded-lg border-2 bg-subtle transition",
                    active ? "border-accent" : "border-transparent hover:border-line-strong",
                  )}
                >
                  <img
                    src={dataSrc(it.input.thumb ?? it.input.src)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute bottom-0.5 left-0.5 rounded bg-black/65 px-1 font-mono text-[10px] font-semibold text-white">{it.id}</span>
                  {s?.decision && (
                    <span
                      className={cx(
                        "absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full text-canvas",
                        s.decision === "accepted" ? "bg-ok" : "bg-ink",
                      )}
                      aria-hidden="true"
                    >
                      {s.decision === "accepted" ? <IconCheck className="size-3" /> : <span className="text-[9px] font-bold">O</span>}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ------------------------------------------------ selected photo */}
      <section aria-labelledby="photo-title" className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="photo-title" className="flex flex-wrap items-center gap-2 text-lg font-semibold">
              <span className="font-mono">{img.id}</span>
              <span className="font-normal text-muted">· {img.note}</span>
              <Pill tone="muted">{KIND_LABEL[img.kind]}</Pill>
            </h2>
            <Link href={`/lab/${img.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
              Analisi completa <IconArrowRight className="size-3.5" />
            </Link>
          </div>
          <CompareSlider
            key={img.id}
            before={{ src: inputSrc, alt: `Foto originale ${img.id}: ${img.note}`, label: "Originale" }}
            after={{
              src: afterSrc,
              alt: shown ? `Versione migliorata con ${shownId}` : "Nessuna versione migliorata disponibile",
              label: shown ? `Proposta ${shownId}` : "Originale",
            }}
            aspect={img.input.w / img.input.h}
            overlay={dataSrc(shown?.heatmap)}
            showOverlay={showHeatmap}
            eager
            afterBadge={
              shown && aiLabel ? (
                <span className="rounded-md bg-black/70 px-2 py-1 text-xs font-medium text-white">{disclosureLabel(shownWf?.generative)}</span>
              ) : undefined
            }
          />
          <p className="text-xs text-muted">Trascina il cursore, oppure selezionalo e usa le frecce ← →.</p>
        </div>

        <ol className="space-y-4" aria-label="Flusso dell'agente">
          <Step n={1} title="Diagnosi">
            <DiagnosisList metrics={img.input.metrics} defects={img.input.defects} />
          </Step>

          <Step
            n={2}
            title="Proposta"
            aside={alternatives.length > 1 ? <span className="text-xs text-muted">Alternativa {altIndex + 1} di {alternatives.length}</span> : undefined}
          >
            {reshoot && (
              <div className="mb-3 rounded-lg border border-warn/40 bg-warn-soft p-3 text-sm text-warn">
                <p className="flex items-center gap-2 font-semibold">
                  <IconAlert /> Consigliato: rifare la foto
                </p>
                <p className="mt-1 text-ink">{img.router.reason}</p>
              </div>
            )}
            {shown && shownWf ? (
              <div className="space-y-2">
                <p className="flex flex-wrap items-center gap-2">
                  <WorkflowTag id={shownWf.id} />
                  <span className="font-medium">{shownWf.name}</span>
                  <GenerativeBadge generative={shownWf.generative} />
                </p>
                {isRouterChoice ? (
                  <p className="text-sm leading-relaxed text-muted">
                    <span className="font-medium text-ink">Perché: </span>
                    {img.router.reason}
                  </p>
                ) : (
                  <p className="text-sm text-muted">
                    {reshoot ? "Anteprima con una correzione sicura, in attesa del nuovo scatto." : `Alternativa alla scelta del router (${img.router.chosen}).`}
                  </p>
                )}
              </div>
            ) : (
              !reshoot && <p className="text-sm text-muted">Nessun workflow ha prodotto un risultato per questa foto.</p>
            )}
          </Step>

          <Step n={3} title="Cosa è cambiato">
            {shown ? (
              <ChangesList
                inputMetrics={img.input.metrics}
                outputMetrics={shown.metrics}
                fixed={shown.fixed_defects}
                remaining={shown.remaining_defects}
                added={shown.new_defects}
                ops={shown.ops}
                generative={shownWf?.generative}
              />
            ) : (
              <p className="text-sm text-muted">Nessuna modifica.</p>
            )}
          </Step>

          <Step n={4} title="Verifica di fedeltà" aside={shown ? <FidelityBadge fidelity={shown.fidelity} /> : undefined}>
            {shown?.fidelity ? (
              <div className="space-y-3">
                {shown.fidelity.flag_reasons.length > 0 ? (
                  <ul className="space-y-1 text-sm">
                    {shown.fidelity.flag_reasons.map((r, i) => (
                      <li key={i} className="flex gap-2">
                        <IconAlert className="mt-0.5 size-4 shrink-0 text-warn" />
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">Struttura, contenuto e inquadratura coerenti con l&apos;originale; nessun giudice ha segnalato modifiche alla casa.</p>
                )}
                <FidelityFacts fidelity={shown.fidelity} compact />
                <Toggle
                  checked={showHeatmap}
                  onChange={setShowHeatmap}
                  disabled={!shown.heatmap}
                  label="Mostra la mappa delle modifiche strutturali"
                />
              </div>
            ) : (
              <p className="text-sm text-muted">Nessun output da verificare.</p>
            )}
          </Step>

          <Step n={5} title="Approvazione dell'agente">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!shown}
                onClick={() => update({ decision: "accepted", decidedWf: shownId ?? undefined })}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
              >
                <IconCheck /> {shownId ? `Accetta ${shownId}` : "Accetta"}
              </button>
              <button
                type="button"
                disabled={alternatives.length < 2}
                onClick={nextAlternative}
                className="rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-sm font-semibold transition-colors hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
              >
                Vedi alternativa
              </button>
              <button
                type="button"
                onClick={() => update({ decision: "original", decidedWf: undefined })}
                className="rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-sm font-semibold transition-colors hover:bg-subtle"
              >
                Usa l&apos;originale
              </button>
            </div>
            <div className="mt-3">
              <Toggle checked={aiLabel} onChange={setAiLabel} label={`Etichetta: ${disclosureLabel(shownWf?.generative)}`} disabled={!shown} />
            </div>
            <div aria-live="polite" className="mt-3 text-sm">
              {st.decision === "accepted" && st.decidedWf && (
                <div className={cx("rounded-lg p-3", okOutput(img, st.decidedWf)?.fidelity?.flag ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok")}>
                  <p className="font-semibold">
                    Accettata: nell&apos;annuncio andrà la versione {st.decidedWf}
                    {aiLabel ? ` con l'etichetta «${disclosureLabel(okWf(st.decidedWf)?.generative)}».` : " senza etichetta."}
                  </p>
                  {okOutput(img, st.decidedWf)?.fidelity?.flag && (
                    <p className="mt-1 text-ink">Questa versione ha segnalazioni di fedeltà: controlla i punti indicati prima di pubblicare.</p>
                  )}
                </div>
              )}
              {st.decision === "original" && <p className="rounded-lg bg-subtle p-3 font-medium">Nell&apos;annuncio andrà la foto originale.</p>}
              {!st.decision && <p className="text-muted">Nessuna foto viene pubblicata senza la conferma dell&apos;agente.</p>}
            </div>
          </Step>
        </ol>
      </section>
    </div>
  );
}

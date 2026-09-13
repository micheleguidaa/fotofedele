"use client";

import { useId, useRef, useState, type FormEvent } from "react";

import { LIVE_WORKFLOWS, type LiveResult } from "@/lib/live";

import { CompareSlider } from "../CompareSlider";
import { ChangesList, DiagnosisList, FidelityBadge, FidelityFacts } from "../photo-panels";
import { IconAlert, IconInfo, WorkflowTag, cx } from "../ui";

const LIVE = process.env.NEXT_PUBLIC_LIVE_MODE === "1";
const MAX_MB = 20;

type Status = { kind: "idle" } | { kind: "loading"; started: number } | { kind: "error"; message: string } | { kind: "done"; result: LiveResult };

export function LiveUpload({ workflows }: { workflows: { id: string; name: string; generative: boolean }[] }) {
  const workflowNames = Object.fromEntries(workflows.map((w) => [w.id, w.name]));
  const isGenerative = (id: string) => workflows.find((w) => w.id === id)?.generative ?? true;
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ url: string; w: number; h: number } | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [showHeatmap, setShowHeatmap] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const onPick = (f: File | null) => {
    setStatus({ kind: "idle" });
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
    setFile(f);
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) {
      setStatus({ kind: "error", message: `Il file supera ${MAX_MB} MB.` });
      setFile(null);
      return;
    }
    const url = URL.createObjectURL(f);
    const probe = new Image();
    probe.onload = () => setPreview({ url, w: probe.naturalWidth, h: probe.naturalHeight });
    probe.onerror = () => setStatus({ kind: "error", message: "Formato immagine non leggibile." });
    probe.src = url;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !LIVE) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus({ kind: "loading", started: Date.now() });
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/enhance", { method: "POST", body, signal: ctrl.signal });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) {
        setStatus({ kind: "error", message: (json && typeof json.error === "string" && json.error) || `Errore ${res.status}` });
        return;
      }
      setStatus({ kind: "done", result: json as LiveResult });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setStatus({ kind: "error", message: "Connessione interrotta o elaborazione non riuscita." });
    }
  };

  return (
    <section aria-labelledby="live-title" className={cx("rounded-xl border bg-surface p-5 sm:p-6", LIVE ? "border-line" : "border-dashed border-line-strong")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 id="live-title" className="text-lg font-semibold">
            Carica una tua foto
          </h2>
          <p className="mt-1 text-sm text-muted">
            Diagnosi e miglioramento con {LIVE_WORKFLOWS.join(" e ")} ({LIVE_WORKFLOWS.map((id) => workflowNames[id] ?? id).join(", ")}), con verifica di
            fedeltà. L&apos;elaborazione può richiedere fino a 3 minuti.
          </p>
        </div>
      </div>

      {!LIVE && (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-subtle p-3 text-sm text-muted">
          <IconInfo className="mt-0.5 size-4 shrink-0" />
          Disponibile solo nella versione locale (richiede GPU e abbonamenti).
        </p>
      )}

      <form onSubmit={onSubmit} className="mt-4 flex flex-wrap items-center gap-3">
        <label htmlFor={inputId} className="sr-only">
          Foto da migliorare
        </label>
        <input
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={!LIVE || status.kind === "loading"}
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          className="max-w-full text-sm file:mr-3 file:rounded-lg file:border file:border-line-strong file:bg-surface file:px-3 file:py-2 file:text-sm file:font-semibold file:text-ink hover:file:bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!LIVE || !file || !preview || status.kind === "loading"}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status.kind === "loading" ? "Elaborazione…" : "Analizza e migliora"}
        </button>
        {status.kind === "loading" && (
          <button type="button" onClick={() => abortRef.current?.abort()} className="text-sm text-muted underline hover:text-ink">
            Annulla
          </button>
        )}
      </form>

      <div aria-live="polite" className="mt-4">
        {status.kind === "loading" && <p className="text-sm text-muted">Diagnosi, miglioramento e verifica in corso…</p>}
        {status.kind === "error" && (
          <p className="flex items-center gap-2 rounded-lg bg-bad-soft p-3 text-sm text-bad">
            <IconAlert /> {status.message}
          </p>
        )}
      </div>

      {status.kind === "done" && preview && (
        <div className="mt-2 space-y-6">
          <div>
            <h3 className="mb-2 font-semibold">Diagnosi</h3>
            <DiagnosisList metrics={status.result.input.metrics} defects={status.result.input.defects} />
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {LIVE_WORKFLOWS.map((id) => {
              const o = status.result.outputs[id];
              if (!o) return null;
              return (
                <article key={id} className="space-y-3">
                  <h3 className="flex flex-wrap items-center gap-2 font-semibold">
                    <WorkflowTag id={id} /> {workflowNames[id] ?? id}
                  </h3>
                  {o.error || !o.src ? (
                    <p className="rounded-lg bg-bad-soft p-3 text-sm text-bad">{o.error ?? "Nessun risultato."}</p>
                  ) : (
                    <>
                      <CompareSlider
                        before={{ src: preview.url, alt: "La tua foto originale", label: "Originale" }}
                        after={{ src: o.src, alt: `La tua foto migliorata con ${id}`, label: id }}
                        aspect={preview.w / preview.h}
                        overlay={o.heatmap ?? undefined}
                        showOverlay={showHeatmap}
                        maxHeight="60vh"
                      />
                      {o.heatmap && (
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={showHeatmap} onChange={(e) => setShowHeatmap(e.target.checked)} className="size-4 accent-[var(--accent)]" />
                          Mostra la mappa delle modifiche strutturali
                        </label>
                      )}
                      <FidelityBadge fidelity={o.fidelity} />
                      {o.fidelity?.flag_reasons?.length ? (
                        <ul className="list-disc space-y-0.5 pl-5 text-sm">
                          {o.fidelity.flag_reasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      ) : null}
                      {o.fidelity && <FidelityFacts fidelity={o.fidelity} compact />}
                      <ChangesList
                        inputMetrics={status.result.input.metrics}
                        outputMetrics={o.metrics}
                        fixed={o.fixed_defects}
                        remaining={o.remaining_defects}
                        added={o.new_defects}
                        ops={o.ops}
                        generative={isGenerative(id)}
                      />
                    </>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

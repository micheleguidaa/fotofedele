"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { Caption, Verdict } from "@/lib/captions";
import { dataSrc } from "@/lib/format";
import type { ImageItem, Results, WorkflowId } from "@/lib/types";
import { useQueryParam } from "@/lib/use-query-param";

import { CompareSlider } from "../CompareSlider";
import { IconAlert, IconArrowRight, IconCheck, IconExternal, Pill, cx } from "../ui";
import { TechnicalDetails, type DetailWorkflow } from "./TechnicalDetails";
import { Toggle } from "./Toggle";

export interface StripItem {
  id: string;
  thumb: string;
  label: string;
}

export interface VersionView {
  id: WorkflowId;
  name: string;
  generative: boolean;
  src: string;
  thumb: string;
  heatmap: string | null;
  verdict: Verdict;
  captions: Caption[];
  summary: string;
  quote: { judge: string; text: string } | null;
}

export interface PhotoViewerProps {
  image: ImageItem;
  title: string;
  strip: StripItem[];
  prevId: string;
  nextId: string;
  versions: VersionView[];
  recommended: WorkflowId | null;
  defaultVersion: WorkflowId | null;
  workflows: DetailWorkflow[];
  judges: Results["judges"]["list"];
}

type Decision = { kind: "accepted"; wf: WorkflowId } | { kind: "original" } | null;

const disclosure = (generative: boolean) => (generative ? "Foto migliorata con AI" : "Foto migliorata digitalmente");
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function CaptionChip({ caption }: { caption: Caption }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-medium",
        caption.tone === "ok" && "bg-ok-soft text-ok",
        caption.tone === "warn" && "bg-warn-soft text-warn",
        caption.tone === "muted" && "border border-line text-muted",
      )}
    >
      {caption.tone === "ok" && <IconCheck className="size-3.5" />}
      {caption.tone === "warn" && <IconAlert className="size-3.5" />}
      {caption.text}
    </span>
  );
}

function VerdictPill({ verdict }: { verdict: Verdict }) {
  return (
    <Pill tone={verdict.tone}>
      {verdict.tone === "accent" && <IconCheck className="size-3" />}
      {(verdict.tone === "warn" || verdict.tone === "bad") && <IconAlert className="size-3" />}
      {verdict.label}
    </Pill>
  );
}

export function PhotoViewer({ image, title, strip, prevId, nextId, versions, recommended, defaultVersion, workflows, judges }: PhotoViewerProps) {
  const qv = useQueryParam("v");
  const qb = useQueryParam("b"); // links from the old lab page
  const [picked, setPicked] = useState<WorkflowId | null>(null);
  const [compareWith, setCompareWith] = useState<"input" | "gt">("input");
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [aiLabel, setAiLabel] = useState(true);
  const [decision, setDecision] = useState<Decision>(null);
  const stripRef = useRef<HTMLUListElement>(null);

  // Keep the current photo visible in the horizontally scrolling strip (mobile), without moving the page.
  useEffect(() => {
    const list = stripRef.current;
    const item = list?.querySelector<HTMLElement>('[aria-current="page"]')?.parentElement;
    if (list && item && list.scrollWidth > list.clientWidth) list.scrollLeft = item.offsetLeft - (list.clientWidth - item.clientWidth) / 2;
  }, []);

  const find = (id: string | null | undefined) => versions.find((v) => v.id === id);
  const shown = find(picked) ?? find(qv) ?? find(qb) ?? find(defaultVersion) ?? versions[0];
  const rec = find(recommended);
  const accepted = decision?.kind === "accepted" ? find(decision.wf) : undefined;

  const select = (id: WorkflowId) => {
    setPicked(id);
    const url = new URL(window.location.href);
    url.searchParams.set("v", id);
    url.searchParams.delete("b");
    window.history.replaceState(window.history.state, "", url);
  };

  const useGt = compareWith === "gt" && !!image.ground_truth;
  const beforeLabel = useGt ? "Originale pulito" : image.kind === "degraded" ? "Degradata" : "Originale";

  return (
    <div className="space-y-6">
      <nav aria-label="Scegli una foto">
        <ul
          ref={stripRef}
          className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-8 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-12"
        >
          {strip.map((s) => {
            const active = s.id === image.id;
            return (
              <li key={s.id} className="w-20 shrink-0 snap-start sm:w-auto">
                <Link
                  href={`/foto/${s.id}`}
                  scroll={false}
                  aria-current={active ? "page" : undefined}
                  aria-label={`${s.id}: ${s.label}`}
                  className={cx(
                    "relative block aspect-[4/3] overflow-hidden rounded-lg border-2 bg-subtle transition",
                    active ? "border-accent" : "border-transparent opacity-75 hover:border-line-strong hover:opacity-100",
                  )}
                >
                  <img src={s.thumb} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  <span className="absolute bottom-0.5 left-0.5 rounded bg-black/65 px-1 font-mono text-[10px] font-semibold text-white">{s.id}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-xl font-semibold tracking-tight text-balance">
          <span className="font-mono">{image.id}</span>
          <span>{title}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {image.kind === "degraded" && <Pill tone="muted">Degradata ad arte</Pill>}
          {image.source_url && (
            <a href={image.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted hover:text-ink hover:underline">
              Annuncio <IconExternal />
            </a>
          )}
          <Link href={`/foto/${prevId}`} scroll={false} className="rounded-md border border-line-strong px-2.5 py-1 hover:bg-subtle" aria-label={`Foto precedente: ${prevId}`}>
            ←
          </Link>
          <Link href={`/foto/${nextId}`} scroll={false} className="rounded-md border border-line-strong px-2.5 py-1 hover:bg-subtle" aria-label={`Foto successiva: ${nextId}`}>
            →
          </Link>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div className="contents lg:block lg:space-y-4">
          <div className="order-1">
            <CompareSlider
              before={{
                src: dataSrc(useGt ? image.ground_truth?.src : image.input.src)!,
                alt: `${beforeLabel}: ${image.id}, ${title.toLowerCase()}`,
                label: beforeLabel,
              }}
              after={{
                src: shown?.src ?? dataSrc(image.input.src)!,
                alt: shown ? `Versione ${shown.id} (${shown.name})` : "Nessuna versione migliorata disponibile",
                label: shown ? `${shown.id} · ${shown.name}` : "Originale",
              }}
              aspect={image.input.w / image.input.h}
              overlay={shown?.heatmap}
              showOverlay={showHeatmap && !useGt}
              maxHeight="70vh"
              eager
              afterBadge={
                shown && aiLabel ? <span className="rounded-md bg-black/70 px-2 py-1 text-xs font-medium text-white">{disclosure(shown.generative)}</span> : undefined
              }
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted">Trascina il cursore, oppure selezionalo e usa le frecce ← →.</p>
              {image.ground_truth && (
                <div role="group" aria-label="Confronta con" className="inline-flex rounded-lg border border-line-strong p-0.5 text-xs font-medium">
                  {(["input", "gt"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={compareWith === k}
                      onClick={() => setCompareWith(k)}
                      className={cx("rounded-md px-2.5 py-1", compareWith === k ? "bg-accent-soft text-accent" : "text-muted hover:text-ink")}
                    >
                      {k === "input" ? "Foto degradata" : "Originale pulito"}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <section aria-labelledby="changes-title" className="order-3 rounded-xl border border-line bg-surface p-5">
            {shown ? (
              <>
                <h3 id="changes-title" className="flex flex-wrap items-baseline gap-x-2 font-semibold">
                  Cosa è cambiato
                  <span className="text-sm font-normal text-muted">
                    {shown.id} · {shown.name}
                  </span>
                </h3>
                {shown.captions.length > 0 ? (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {shown.captions.map((c) => (
                      <li key={c.text}>
                        <CaptionChip caption={c} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-muted">Nessuna differenza misurata rispetto all&apos;originale.</p>
                )}
                {shown.quote && (
                  <figure className="mt-4 border-t border-line pt-4">
                    <blockquote className="text-[15px] leading-relaxed text-pretty">«{shown.quote.text}»</blockquote>
                    <figcaption className="mt-1 text-sm text-muted">Giudice {shown.quote.judge}</figcaption>
                  </figure>
                )}
              </>
            ) : (
              <h3 id="changes-title" className="font-semibold">
                Nessuna versione disponibile per questa foto
              </h3>
            )}
          </section>
        </div>

        <div className="contents lg:block lg:space-y-4">
          <section aria-labelledby="versions-title" className="order-2 rounded-xl border border-line bg-surface p-2">
            <h3 id="versions-title" className="px-2 pt-1.5 pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
              Le versioni
            </h3>
            <div className="flex gap-3 p-2">
              <img
                src={dataSrc(image.input.thumb ?? image.input.src)}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-[66px] w-[88px] shrink-0 rounded-md object-cover"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{image.kind === "degraded" ? "Foto degradata" : "Originale"}</p>
                <p className="mt-1 text-[13px] leading-snug text-muted">{title}</p>
              </div>
            </div>
            <ul className="space-y-0.5">
              {versions.map((v) => {
                const active = v.id === shown?.id;
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => select(v.id)}
                      className={cx(
                        "flex w-full gap-3 rounded-lg p-2 text-left transition-colors",
                        active ? "bg-accent-soft ring-1 ring-accent ring-inset" : "hover:bg-subtle",
                      )}
                    >
                      <img src={v.thumb} alt="" loading="lazy" decoding="async" className="h-[66px] w-[88px] shrink-0 rounded-md object-cover" />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-sm font-semibold">
                            {v.id} · {v.name}
                          </span>
                          <VerdictPill verdict={v.verdict} />
                        </span>
                        <span className="mt-1 block text-[13px] leading-snug text-muted">{v.summary}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="decision-title" className="order-4 rounded-xl border border-line bg-surface p-4">
            <h3 id="decision-title" className="font-semibold">
              Cosa pubblicare
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              {rec ? (
                <>
                  L&apos;agente consiglia{" "}
                  <strong className="font-semibold text-ink">
                    {rec.id} · {rec.name}
                  </strong>
                  : {lowerFirst(rec.summary)}.
                </>
              ) : image.router.chosen === "reshoot" ? (
                "Nessuna versione migliora la foto senza alterare la casa: meglio rifare lo scatto o pubblicare l'originale."
              ) : (
                "Nessuna versione disponibile: resta l'originale."
              )}
            </p>
            {shown && shown.verdict.tone === "warn" && (
              <p className="mt-2 flex gap-2 text-sm text-warn">
                <IconAlert className="mt-0.5 size-4 shrink-0" />
                <span>{shown.id} altera la foto: guarda cosa è cambiato prima di pubblicarla.</span>
              </p>
            )}
            <div className="mt-4 grid gap-2">
              <button
                type="button"
                disabled={!shown}
                onClick={() => shown && setDecision({ kind: "accepted", wf: shown.id })}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
              >
                <IconCheck /> {shown ? `Usa ${shown.id}${shown.id === recommended ? " (consigliata)" : ""}` : "Usa la versione"}
              </button>
              <button
                type="button"
                onClick={() => setDecision({ kind: "original" })}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-line-strong bg-surface px-4 text-sm font-semibold transition-colors hover:bg-subtle"
              >
                Tieni l&apos;originale
              </button>
              {rec && shown && shown.id !== rec.id && (
                <button type="button" onClick={() => select(rec.id)} className="inline-flex items-center justify-center gap-1 py-1 text-sm font-medium text-accent hover:underline">
                  Vedi la consigliata ({rec.id}) <IconArrowRight className="size-3.5" />
                </button>
              )}
            </div>
            <div className="mt-3">
              <Toggle checked={aiLabel} onChange={setAiLabel} disabled={!shown} label={`Etichetta «${disclosure(shown?.generative ?? true)}»`} />
            </div>
            <div aria-live="polite" className="mt-3 text-sm">
              {accepted && (
                <p className={cx("rounded-lg p-3 font-medium", accepted.verdict.tone === "warn" ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok")}>
                  Nell&apos;annuncio andrà {accepted.id}
                  {aiLabel ? ` con l'etichetta «${disclosure(accepted.generative)}».` : " senza etichetta."}
                </p>
              )}
              {decision?.kind === "original" && <p className="rounded-lg bg-subtle p-3 font-medium">Nell&apos;annuncio andrà la foto originale.</p>}
            </div>
          </section>
        </div>
      </div>

      <TechnicalDetails
        image={image}
        shownId={shown?.id ?? null}
        workflows={workflows}
        judges={judges}
        showHeatmap={showHeatmap}
        onShowHeatmap={setShowHeatmap}
      />
    </div>
  );
}

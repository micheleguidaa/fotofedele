"use client";

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { addVote, clearVotes, getServerVotes, getVotes, subscribeVotes, type Contender, type Vote } from "@/lib/arena-store";
import { bradleyTerry, winProbability, type Match } from "@/lib/bt";
import { dataSrc, fmtPct } from "@/lib/format";
import type { WorkflowId } from "@/lib/types";

import { IconAlert, IconCheck, IconInfo, WorkflowTag, cx } from "../ui";

export interface ArenaImage {
  id: string;
  note: string;
  w: number;
  h: number;
  input: string; // src
  outputs: Partial<Record<WorkflowId, { src: string; win: number | null }>>;
}

export interface ArenaWorkflow {
  id: WorkflowId;
  name: string;
  winrate: number; // lab ensemble win-rate vs input
}

interface Pair {
  image: ArenaImage;
  left: Contender;
  right: Contender;
  asked: "left" | "right";
}

type Phase = "intro" | "pref" | "fidelity" | "reveal";

const srcOf = (img: ArenaImage, c: Contender) => (c === "input" ? img.input : img.outputs[c]?.src ?? img.input);

function randomPair(images: ArenaImage[], previous?: Pair | null): Pair | null {
  const usable = images.filter((im) => Object.keys(im.outputs).length > 0);
  if (!usable.length) return null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const image = usable[Math.floor(Math.random() * usable.length)];
    const pool: Contender[] = ["input", ...(Object.keys(image.outputs) as WorkflowId[])];
    const i = Math.floor(Math.random() * pool.length);
    let j = Math.floor(Math.random() * (pool.length - 1));
    if (j >= i) j += 1;
    const [a, b] = Math.random() < 0.5 ? [pool[i], pool[j]] : [pool[j], pool[i]];
    if (previous && previous.image.id === image.id && attempt < 5) continue; // avoid repeating the same photo
    const asked: "left" | "right" = a === "input" ? "right" : b === "input" ? "left" : Math.random() < 0.5 ? "left" : "right";
    return { image, left: a, right: b, asked };
  }
  return null;
}

function contenderName(c: Contender, workflows: ArenaWorkflow[]) {
  return c === "input" ? "Foto originale" : `${c} · ${workflows.find((w) => w.id === c)?.name ?? c}`;
}

function Choice({ onClick, children, variant = "secondary" }: { onClick: () => void; children: ReactNode; variant?: "primary" | "secondary" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors",
        variant === "primary" ? "bg-accent text-on-accent hover:bg-accent-strong" : "border border-line-strong bg-surface hover:bg-subtle",
      )}
    >
      {children}
    </button>
  );
}

export function Arena({ images, workflows }: { images: ArenaImage[]; workflows: ArenaWorkflow[] }) {
  const votes = useSyncExternalStore(subscribeVotes, getVotes, getServerVotes);
  const [phase, setPhase] = useState<Phase>("intro");
  const [pair, setPair] = useState<Pair | null>(null);
  const [pref, setPref] = useState<Vote["pref"] | null>(null);
  const [faithful, setFaithful] = useState<boolean | null>(null);

  const start = () => {
    const p = randomPair(images, pair);
    setPair(p);
    setPref(null);
    setFaithful(null);
    setPhase(p ? "pref" : "intro");
  };

  const answerPref = (p: Vote["pref"]) => {
    setPref(p);
    setPhase("fidelity");
  };

  const answerFidelity = (f: boolean | null) => {
    if (!pair || !pref) return;
    setFaithful(f);
    addVote({ t: Date.now(), image: pair.image.id, left: pair.left, right: pair.right, pref, asked: pair.asked, faithful: f });
    setPhase("reveal");
  };

  const tally = useMemo(() => {
    const players: Contender[] = ["input", ...workflows.map((w) => w.id)];
    const stats = new Map<Contender, { n: number; wins: number; ties: number; fidAsked: number; fidNo: number }>();
    players.forEach((p) => stats.set(p, { n: 0, wins: 0, ties: 0, fidAsked: 0, fidNo: 0 }));
    const matches: Match[] = [];
    for (const v of votes) {
      const l = stats.get(v.left);
      const r = stats.get(v.right);
      if (!l || !r) continue;
      l.n++;
      r.n++;
      if (v.pref === "left") l.wins++;
      else if (v.pref === "right") r.wins++;
      else {
        l.ties++;
        r.ties++;
      }
      matches.push({ a: v.left, b: v.right, result: v.pref === "left" ? 1 : v.pref === "right" ? 0 : 0.5 });
      const asked = stats.get(v.asked === "left" ? v.left : v.right);
      if (asked && v.faithful !== null) {
        asked.fidAsked++;
        if (v.faithful === false) asked.fidNo++;
      }
    }
    const bt = bradleyTerry(players, matches);
    return players
      .map((p) => {
        const s = stats.get(p)!;
        return {
          id: p,
          ...s,
          winrate: s.n ? (s.wins + s.ties / 2) / s.n : null,
          vsInput: p === "input" || s.n === 0 ? null : winProbability(bt, p, "input"),
          strength: bt[p],
        };
      })
      .sort((a, b) => b.strength - a.strength);
  }, [votes, workflows]);

  const askedContender = pair ? (pair.asked === "left" ? pair.left : pair.right) : null;
  const askedSideLabel = pair?.asked === "left" ? "sinistra" : "destra";
  const aspect = pair ? pair.image.w / pair.image.h : 4 / 3;
  const labDelta = (() => {
    if (!pair || phase !== "reveal") return null;
    const out = pair.left === "input" ? pair.right : pair.right === "input" ? pair.left : null;
    if (!out || out === "input") return null;
    const win = pair.image.outputs[out]?.win;
    if (win === null || win === undefined) return null;
    return { out, win };
  })();

  return (
    <div className="space-y-10">
      <div className="flex gap-3 rounded-xl border border-warn/50 bg-warn-soft p-4 text-warn" role="note">
        <IconInfo className="mt-0.5 size-5 shrink-0" />
        <p className="text-sm leading-relaxed">
          <strong className="font-semibold">Progettata ma non eseguita con utenti reali in questo prototipo: i voti restano nel tuo browser.</strong>{" "}
          <span className="text-ink">Serve a mostrare come si raccoglierebbero preferenze umane alla cieca per calibrare i giudici AI.</span>
        </p>
      </div>

      <section aria-labelledby="duel-title" className="rounded-xl border border-line bg-surface p-4 sm:p-6">
        <h2 id="duel-title" className="sr-only">
          Confronto alla cieca
        </h2>

        {phase === "intro" || !pair ? (
          <div className="mx-auto max-w-xl py-6 text-center">
            <p className="text-lg font-semibold">Due versioni della stessa stanza, senza nomi.</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Possono essere l&apos;originale e una versione migliorata, oppure due versioni prodotte da workflow diversi. La posizione
              è casuale; i nomi compaiono solo dopo il voto.
            </p>
            <div className="mt-5">
              <Choice onClick={start} variant="primary">
                Inizia a votare
              </Choice>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
              <span>
                Foto <span className="font-mono text-ink">{pair.image.id}</span> · {pair.image.note}
              </span>
              <span>{votes.length} voti in questo browser</span>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:gap-4">
              {(["left", "right"] as const).map((side) => {
                const c = side === "left" ? pair.left : pair.right;
                const highlight = phase === "fidelity" && pair.asked === side;
                const chosen = pref === side;
                return (
                  <figure key={side} className="min-w-0">
                    <div
                      className={cx(
                        "relative mx-auto w-full overflow-hidden rounded-lg bg-subtle",
                        highlight && "ring-4 ring-accent",
                        phase === "reveal" && chosen && "ring-4 ring-ok",
                      )}
                      style={{ aspectRatio: String(aspect), maxHeight: "62vh", maxWidth: `calc(62vh * ${aspect})` }}
                    >
                      <img
                        src={dataSrc(srcOf(pair.image, c))}
                        alt={`Foto ${side === "left" ? "a sinistra" : "a destra"}`}
                        className="absolute inset-0 h-full w-full object-contain"
                      />
                    </div>
                    <figcaption className="mt-2 text-center text-sm">
                      <span className="font-semibold">{side === "left" ? "Sinistra" : "Destra"}</span>
                      {phase === "reveal" && (
                        <span className="mt-1 flex items-center justify-center gap-1.5 text-muted">
                          {c !== "input" && <WorkflowTag id={c} />}
                          <span className="truncate">{c === "input" ? "Foto originale" : workflows.find((w) => w.id === c)?.name}</span>
                        </span>
                      )}
                    </figcaption>
                  </figure>
                );
              })}
            </div>

            {phase === "pref" && (
              <fieldset className="text-center">
                <legend className="mx-auto font-semibold">Quale foto ti invoglia di più a visitare la casa?</legend>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <Choice onClick={() => answerPref("left")}>← Sinistra</Choice>
                  <Choice onClick={() => answerPref("tie")}>Sono equivalenti</Choice>
                  <Choice onClick={() => answerPref("right")}>Destra →</Choice>
                </div>
              </fieldset>
            )}

            {phase === "fidelity" && (
              <div className="grid items-center gap-4 rounded-lg bg-subtle p-4 sm:grid-cols-[10rem_1fr]">
                <figure>
                  <div className="relative overflow-hidden rounded-md bg-canvas" style={{ aspectRatio: String(aspect) }}>
                    <img src={dataSrc(pair.image.input)} alt="Foto originale di riferimento" className="absolute inset-0 h-full w-full object-contain" />
                  </div>
                  <figcaption className="mt-1 text-center text-xs text-muted">Originale di riferimento</figcaption>
                </figure>
                <fieldset>
                  <legend className="font-semibold">
                    La foto a {askedSideLabel} rappresenta fedelmente la stessa stanza?
                  </legend>
                  <p className="mt-1 text-sm text-muted">Guarda oggetti, finestre, materiali, macchie o crepe: sono gli stessi dell&apos;originale?</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Choice onClick={() => answerFidelity(true)}>Sì</Choice>
                    <Choice onClick={() => answerFidelity(false)}>No, qualcosa è cambiato</Choice>
                    <Choice onClick={() => answerFidelity(null)}>Non so</Choice>
                  </div>
                </fieldset>
              </div>
            )}

            {phase === "reveal" && (
              <div className="space-y-3 text-center" aria-live="polite">
                <p className="text-sm">
                  <IconCheck className="mr-1 inline size-4 text-ok" />
                  Voto salvato: hai preferito{" "}
                  <strong>{pref === "tie" ? "nessuna delle due" : contenderName(pref === "left" ? pair.left : pair.right, workflows)}</strong>
                  {askedContender && faithful !== null && (
                    <>
                      {" "}
                      e hai giudicato {askedContender === "input" ? "l'originale" : askedContender} {faithful ? "fedele" : "non fedele"}
                    </>
                  )}
                  .
                </p>
                {labDelta && (
                  <p className="text-sm text-muted">
                    Su questa coppia i giudici AI avevano {labDelta.win === 1 ? "preferito" : labDelta.win === 0 ? "scartato" : "valutato alla pari"}{" "}
                    {labDelta.out} rispetto all&apos;originale.
                  </p>
                )}
                <Choice onClick={start} variant="primary">
                  Coppia successiva
                </Choice>
              </div>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="tally-title" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="tally-title" className="text-xl font-semibold">
              I tuoi risultati
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Modello di Bradley–Terry sui tuoi voti: la probabilità stimata che ogni workflow batta l&apos;originale, accanto al
              win-rate dei giudici AI. Con pochi voti le stime sono molto incerte.
            </p>
          </div>
          <button
            type="button"
            disabled={!votes.length}
            onClick={() => {
              if (window.confirm("Cancellare tutti i voti salvati in questo browser?")) clearVotes();
            }}
            className="rounded-md border border-line-strong px-3 py-1.5 text-sm font-semibold hover:bg-subtle disabled:opacity-50"
          >
            Azzera i miei voti
          </button>
        </div>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="data-table min-w-[720px]">
            <thead>
              <tr>
                <th scope="col">Versione</th>
                <th scope="col" className="num">
                  Confronti
                </th>
                <th scope="col" className="num">
                  Win-rate
                  <br />
                  <span className="font-normal">(pari = ½)</span>
                </th>
                <th scope="col" className="num">
                  Batte l&apos;originale
                  <br />
                  <span className="font-normal">tu · Bradley–Terry</span>
                </th>
                <th scope="col" className="num">
                  Batte l&apos;originale
                  <br />
                  <span className="font-normal">giudici AI</span>
                </th>
                <th scope="col" className="num">
                  «Non fedele»
                </th>
              </tr>
            </thead>
            <tbody>
              {tally.map((t) => (
                <tr key={t.id} className={cx(t.n === 0 && "text-muted")}>
                  <th scope="row">
                    <span className="flex items-center gap-2">
                      {t.id === "input" ? <span className="font-medium">Foto originale</span> : <WorkflowTag id={t.id} />}
                      {t.id !== "input" && <span className="text-sm font-normal">{workflows.find((w) => w.id === t.id)?.name}</span>}
                    </span>
                  </th>
                  <td className="num">{t.n}</td>
                  <td className="num">{t.winrate === null ? "—" : fmtPct(t.winrate)}</td>
                  <td className="num font-semibold">{t.vsInput === null ? "—" : fmtPct(t.vsInput)}</td>
                  <td className="num">{t.id === "input" ? "—" : fmtPct(workflows.find((w) => w.id === t.id)?.winrate)}</td>
                  <td className={cx("num", t.fidNo > 0 && "font-semibold text-warn")}>
                    {t.fidAsked ? (
                      <span className="inline-flex items-center gap-1">
                        {t.fidNo > 0 && <IconAlert className="size-3.5" />}
                        {t.fidNo}/{t.fidAsked}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

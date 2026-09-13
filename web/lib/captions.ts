// Plain-language captions for the Foto view: what a workflow changed, in words and without numbers.
// Only type imports, so `npm test` can load this file directly with Node.
import type { Defect, FidelityChecklist, ImageItem, JudgeId, JudgeVerdict, Output, WorkflowId } from "./types";

export type CaptionTone = "ok" | "warn" | "muted";
export interface Caption {
  text: string;
  tone: CaptionTone;
}

export type VerdictTone = "accent" | "ok" | "warn" | "bad" | "muted";
export interface Verdict {
  label: string;
  tone: VerdictTone;
}

const DEFECTS: Defect[] = ["buia", "sovraesposta", "dominante", "storta", "sfocata", "rumorosa", "bassa_risoluzione"];

const FIXED: Record<Defect, string> = {
  buia: "Più luminosa",
  sovraesposta: "Alte luci recuperate",
  dominante: "Colori più neutri",
  storta: "Verticali raddrizzate",
  sfocata: "Più nitida",
  rumorosa: "Meno rumore",
  bassa_risoluzione: "Risoluzione aumentata",
};

const ADDED: Record<Defect, string> = {
  buia: "Diventata più buia",
  sovraesposta: "Alte luci bruciate",
  dominante: "Nuova dominante di colore",
  storta: "Verticali storte",
  sfocata: "Meno nitida",
  rumorosa: "Più rumore",
  bassa_risoluzione: "Risoluzione ridotta",
};

const REMAINING: Record<Defect, string> = {
  buia: "Resta buia",
  sovraesposta: "Restano alte luci bruciate",
  dominante: "Resta una dominante di colore",
  storta: "Verticali ancora storte",
  sfocata: "Resta poco nitida",
  rumorosa: "Resta rumorosa",
  bassa_risoluzione: "Resta a bassa risoluzione",
};

const ADJECTIVE: Record<Exclude<Defect, "dominante">, string> = {
  buia: "buia",
  sovraesposta: "sovraesposta",
  storta: "storta",
  sfocata: "poco nitida",
  rumorosa: "rumorosa",
  bassa_risoluzione: "a bassa risoluzione",
};

// Structural reasons are templated in pipeline/fotolab/aggregate.py (fidelity_decision).
const STRUCTURAL: [RegExp, string][] = [
  [/^struttura cambiata/, "Parti dell'immagine ridisegnate"],
  [/non esiste nell'originale/, "Bordi inventati dall'AI"],
  [/^inquadratura ridotta/, "Inquadratura tagliata"],
  [/non è sovrapponibile/, "Geometria diversa dall'originale"],
];

const CHECKS: [keyof FidelityChecklist, string][] = [
  ["oggetti_aggiunti_rimossi", "Oggetti aggiunti o rimossi"],
  ["finestre_vista_cambiata", "Vista dalle finestre cambiata"],
  ["materiali_colori_cambiati", "Materiali o colori cambiati"],
  ["geometria_stanza_alterata", "Proporzioni della stanza alterate"],
  ["difetti_nascosti", "Difetti della casa nascosti"],
  ["testi_loghi_alterati", "Testi o scritte alterati"],
];

const GENERIC_NOTE = /identic|nessuna differenza|irrilevant|impercettibil/i;
const JUDGE_RANK: Partial<Record<JudgeId, number>> = { gpt: 1, gemma: 0.5, qwen: 0 };

const ordered = (list: Defect[] | undefined) => DEFECTS.filter((d) => list?.includes(d));
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

/**
 * Ok first (defects fixed), then warnings from the most concrete (what the judges saw changing in the house, then
 * measured structural changes, then new photographic defects), then what is still off.
 */
export function changeCaptions(o: Output | undefined): Caption[] {
  if (!o || o.status !== "ok") return [];
  const out: Caption[] = ordered(o.fixed_defects).map((d) => ({ text: FIXED[d], tone: "ok" }));
  const f = o.fidelity;
  if (f) {
    for (const [key, text] of CHECKS) if (f.checklist_majority?.[key]) out.push({ text, tone: "warn" });
    for (const [re, text] of STRUCTURAL) if (f.flag_reasons.some((r) => re.test(r))) out.push({ text, tone: "warn" });
  }
  for (const d of ordered(o.new_defects)) out.push({ text: ADDED[d], tone: "warn" });
  for (const d of ordered(o.remaining_defects)) out.push({ text: REMAINING[d], tone: "muted" });
  return out;
}

/** One line per version: "Più luminosa e più nitida, ma parti dell'immagine ridisegnate". */
export function summaryLine(captions: Caption[], win?: number | null): string {
  const ok = captions.filter((c) => c.tone === "ok").slice(0, 2).map((c) => c.text);
  const warn = captions.find((c) => c.tone === "warn")?.text;
  let line = ok.length ? joinAnd([ok[0], ...ok.slice(1).map(lowerFirst)]) : "";
  if (warn) line = line ? `${line}, ma ${lowerFirst(warn)}` : warn;
  else if (line && win === 0) line = `${line}, ma i giudici preferiscono l'originale`;
  if (line) return line;
  return win === 0 ? "I giudici preferiscono l'originale" : "Quasi uguale all'originale";
}

/** "Buia, storta e poco nitida, con dominante di colore". */
export function describeDefects(defects: Defect[]): string {
  const adjectives = ordered(defects)
    .filter((d): d is Exclude<Defect, "dominante"> => d !== "dominante")
    .map((d) => ADJECTIVE[d]);
  let line = joinAnd(adjectives);
  if (defects.includes("dominante")) line = line ? `${line}, con dominante di colore` : "con dominante di colore";
  return line ? upperFirst(line) : "Nessun difetto evidente";
}

export function versionVerdict(router: ImageItem["router"], id: WorkflowId, o: Output | undefined): Verdict {
  if (!o || o.status !== "ok") return { label: "Non disponibile", tone: "muted" };
  if (router.chosen === id) return { label: "Consigliata", tone: "accent" };
  if (o.fidelity?.flag) return { label: "Da controllare", tone: "warn" };
  if (o.ensemble?.win === 0) return { label: "Peggiora la foto", tone: "bad" };
  if (o.ensemble?.win === 1) return { label: "Fedele", tone: "ok" };
  return { label: "Quasi uguale", tone: "muted" };
}

/**
 * The most telling judge note: a judge that spotted the alteration behind a fidelity flag, then an unconflicted judge
 * that agrees with the ensemble, consistent across both orders. Generic "the two photos are identical" notes are skipped.
 */
export function judgeQuote(o: Output | undefined): { judge: JudgeId; text: string } | null {
  const candidates = (o?.judges ?? []).filter((j) => j.notes?.trim() && !GENERIC_NOTE.test(j.notes));
  if (!o || !candidates.length) return null;
  const majority = o.fidelity?.flag ? o.fidelity.checklist_majority : undefined;
  const win = o.ensemble?.win;
  const outcome: JudgeVerdict["preferred"] | null = win == null ? null : win > 0.5 ? "output" : win < 0.5 ? "input" : "tie";
  const score = (j: JudgeVerdict) =>
    (majority && CHECKS.some(([k]) => majority[k] && j.checklist[k]) ? 16 : 0) +
    (j.excluded_conflict ? 0 : 8) +
    (outcome && j.preferred === outcome ? 4 : 0) +
    (j.position_consistent !== false ? 2 : 0) + // null: asked in one order only, not an inconsistency

    (JUDGE_RANK[j.judge] ?? 0);
  const best = candidates.reduce((a, b) => (score(b) > score(a) ? b : a));
  return { judge: best.judge, text: best.notes.trim() };
}

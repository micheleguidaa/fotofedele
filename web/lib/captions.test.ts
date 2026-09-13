import assert from "node:assert/strict";
import { test } from "node:test";

import { changeCaptions, describeDefects, judgeQuote, summaryLine, versionVerdict } from "./captions.ts";
import type { FidelityChecklist, JudgeVerdict, Output } from "./types.ts";

const noChecks: FidelityChecklist = {
  oggetti_aggiunti_rimossi: false,
  finestre_vista_cambiata: false,
  materiali_colori_cambiati: false,
  geometria_stanza_alterata: false,
  difetti_nascosti: false,
  testi_loghi_alterati: false,
};
const rubric = { esposizione: 3, colore: 3, geometria: 3, nitidezza: 3, naturalezza: 3, attrattivita: 3 };

function judge(p: Partial<JudgeVerdict>): JudgeVerdict {
  return {
    judge: "gemma",
    preferred: "output",
    position_consistent: true,
    rubric_output: rubric,
    rubric_input: rubric,
    checklist: noChecks,
    notes: "",
    excluded_conflict: false,
    ...p,
  };
}

function output(p: Partial<Output>): Output {
  return {
    status: "ok",
    fixed_defects: [],
    remaining_defects: [],
    new_defects: [],
    fidelity: {
      flag: false,
      flag_reasons: [],
      structural: 1,
      changed_area_pct: 0,
      semantic: 1,
      alignment_ok: true,
      framing_kept_pct: 100,
      checklist_majority: noChecks,
    },
    ensemble: { win: 1, judges_used: ["gemma"], rubric_mean: rubric },
    ...p,
  };
}

const flagged = output({
  fixed_defects: ["sfocata", "buia"],
  remaining_defects: ["dominante"],
  fidelity: {
    flag: true,
    flag_reasons: ["struttura cambiata sul 23% dell'immagine", "difetti o degrado nascosti (segnalato da 1 giudici su 2)"],
    structural: 0.7,
    changed_area_pct: 23,
    semantic: 0.8,
    alignment_ok: true,
    framing_kept_pct: 87,
    checklist_majority: { ...noChecks, difetti_nascosti: true },
  },
});

test("captions: fixed defects first, then alterations, then what is still off", () => {
  assert.deepEqual(changeCaptions(flagged), [
    { text: "Più luminosa", tone: "ok" },
    { text: "Più nitida", tone: "ok" },
    { text: "Difetti della casa nascosti", tone: "warn" },
    { text: "Parti dell'immagine ridisegnate", tone: "warn" },
    { text: "Resta una dominante di colore", tone: "muted" },
  ]);
  assert.deepEqual(changeCaptions(output({ status: "error" })), []);
  assert.deepEqual(
    changeCaptions(output({ fidelity: { ...flagged.fidelity!, flag_reasons: ["9% dell'immagine non esiste nell'originale (contenuto inventato ai bordi)"], checklist_majority: noChecks } })),
    [{ text: "Bordi inventati dall'AI", tone: "warn" }],
  );
});

test("summary line joins the gains and the first warning", () => {
  assert.equal(summaryLine(changeCaptions(flagged)), "Più luminosa e più nitida, ma difetti della casa nascosti");
  assert.equal(summaryLine([{ text: "Verticali raddrizzate", tone: "ok" }]), "Verticali raddrizzate");
  assert.equal(summaryLine([], 0), "I giudici preferiscono l'originale");
  assert.equal(summaryLine([{ text: "Più luminosa", tone: "ok" }], 0), "Più luminosa, ma i giudici preferiscono l'originale");
  assert.equal(summaryLine([{ text: "Resta buia", tone: "muted" }], 0.5), "Quasi uguale all'originale");
});

test("defects become one Italian sentence", () => {
  assert.equal(describeDefects(["dominante", "buia", "storta", "sfocata"]), "Buia, storta e poco nitida, con dominante di colore");
  assert.equal(describeDefects(["dominante"]), "Con dominante di colore");
  assert.equal(describeDefects([]), "Nessun difetto evidente");
});

test("verdict: router choice, then fidelity flag, then the judges", () => {
  const router = { chosen: "F4" as const, reason: "", fallback: null };
  assert.equal(versionVerdict(router, "F4", output({})).label, "Consigliata");
  assert.equal(versionVerdict(router, "F2", flagged).label, "Da controllare");
  assert.equal(versionVerdict(router, "F1", output({ ensemble: { win: 0, judges_used: [], rubric_mean: rubric } })).label, "Peggiora la foto");
  assert.equal(versionVerdict(router, "F1", output({ ensemble: { win: 0.5, judges_used: [], rubric_mean: rubric } })).label, "Quasi uguale");
  assert.equal(versionVerdict(router, "F3", output({})).label, "Fedele");
  assert.equal(versionVerdict(router, "F5", undefined).label, "Non disponibile");
});

test("quote: the judge who spotted the alteration wins; generic notes are skipped", () => {
  const o = {
    ...flagged,
    judges: [
      judge({ judge: "gpt", notes: "La foto migliorata è più luminosa." }),
      judge({ judge: "qwen", preferred: "tie", notes: "Le due immagini sono praticamente identiche." }),
      judge({ judge: "gemma", checklist: { ...noChecks, difetti_nascosti: true }, notes: " Sono state rimosse le macchie. " }),
    ],
  };
  assert.deepEqual(judgeQuote(o), { judge: "gemma", text: "Sono state rimosse le macchie." });
  assert.equal(judgeQuote(output({ judges: [judge({ notes: "Immagini identiche in ogni dettaglio." })] })), null);
  const unflagged = output({ judges: [judge({ judge: "qwen", notes: "Più chiara." }), judge({ judge: "gpt", notes: "Ombre più leggibili." })] });
  assert.equal(judgeQuote(unflagged)?.judge, "gpt");
  const singleOrder = output({
    judges: [judge({ judge: "gemma", notes: "Più luminosa." }), judge({ judge: "gpt", position_consistent: null, notes: "Ombre più leggibili, macchie ancora visibili." })],
  });
  assert.equal(judgeQuote(singleOrder)?.judge, "gpt");
});

// Italian UI labels for contract enums and keys.
import type { Defect, FidelityChecklist, JudgeVerdict, Rubric, WorkflowId } from "./types";

export const WORKFLOW_IDS: WorkflowId[] = ["F1", "F2", "F3", "F4", "F5", "F6"];

const WORKFLOW_SHORT_NAME: Partial<Record<WorkflowId, string>> = {
  F1: "Classico",
  F2: "gpt-image semplice",
  F3: "gpt-image vincolato",
  F4: "Qwen Image Edit",
  F5: "Ibrido",
};

/** Short name for tight spots (version list, slider label); falls back to the pipeline name. */
export function workflowShortName(w: { id: WorkflowId; name: string }): string {
  return WORKFLOW_SHORT_NAME[w.id] ?? w.name;
}

export const DEFECT_LABEL: Record<Defect, string> = {
  buia: "Buia",
  sovraesposta: "Sovraesposta",
  dominante: "Dominante di colore",
  storta: "Verticali storte",
  sfocata: "Poco nitida",
  rumorosa: "Rumore",
  bassa_risoluzione: "Bassa risoluzione",
};

export const CHECKLIST_KEYS: (keyof FidelityChecklist)[] = [
  "oggetti_aggiunti_rimossi",
  "finestre_vista_cambiata",
  "materiali_colori_cambiati",
  "geometria_stanza_alterata",
  "difetti_nascosti",
  "testi_loghi_alterati",
];

export const CHECKLIST_LABEL: Record<keyof FidelityChecklist | "strutturale", string> = {
  oggetti_aggiunti_rimossi: "Oggetti aggiunti o rimossi",
  finestre_vista_cambiata: "Vista dalle finestre cambiata",
  materiali_colori_cambiati: "Materiali o colori cambiati",
  geometria_stanza_alterata: "Geometria della stanza alterata",
  difetti_nascosti: "Difetti nascosti (macchie, crepe, danni)",
  testi_loghi_alterati: "Testi o loghi alterati",
  strutturale: "Cambiamento strutturale misurato",
};

export const CHECKLIST_QUESTION: Record<keyof FidelityChecklist, string> = {
  oggetti_aggiunti_rimossi: "Sono stati aggiunti, rimossi o spostati oggetti o arredi?",
  finestre_vista_cambiata: "È cambiato ciò che si vede da finestre o porte?",
  materiali_colori_cambiati: "Sono cambiati materiali, pavimenti o colori delle pareti?",
  geometria_stanza_alterata: "Sono cambiate dimensioni o proporzioni della stanza?",
  difetti_nascosti: "Sono stati nascosti o riparati macchie, crepe o danni?",
  testi_loghi_alterati: "Sono stati alterati testi, loghi o filigrane?",
};

export const RUBRIC_KEYS: (keyof Rubric)[] = [
  "esposizione",
  "colore",
  "geometria",
  "nitidezza",
  "naturalezza",
  "attrattivita",
];

export const RUBRIC_LABEL: Record<keyof Rubric, string> = {
  esposizione: "Esposizione",
  colore: "Colore",
  geometria: "Geometria",
  nitidezza: "Nitidezza",
  naturalezza: "Naturalezza",
  attrattivita: "Attrattività",
};

export const RUBRIC_SHORT: Record<keyof Rubric, string> = {
  esposizione: "Esp.",
  colore: "Col.",
  geometria: "Geo.",
  nitidezza: "Nit.",
  naturalezza: "Nat.",
  attrattivita: "Attr.",
};

export const PREFERRED_LABEL: Record<JudgeVerdict["preferred"], string> = {
  output: "Migliorata",
  input: "Originale",
  tie: "Pari",
};

export const KIND_LABEL = { real: "Foto reale", degraded: "Degradata (con originale pulito)" } as const;

export const STATUS_LABEL = {
  reale: "Reale",
  stimato: "Stimato",
  simulato: "Simulato",
  progettato: "Progettato",
} as const;

export const FAMILY_LABEL: Record<string, string> = {
  openai: "OpenAI",
  google: "Google",
  alibaba: "Alibaba",
  none: "—",
};

export function familyLabel(f: string): string {
  return FAMILY_LABEL[f] ?? f;
}

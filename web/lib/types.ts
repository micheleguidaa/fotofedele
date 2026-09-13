// Data contract between the Python pipeline (pipeline/fotolab/aggregate.py) and the web app.
// The pipeline writes web/public/data/results.json with this exact shape.

export type WorkflowId = "F1" | "F2" | "F3" | "F4" | "F5" | "F6";
export type JudgeId = "gpt" | "gemini" | "gemma" | "qwen";
export type Defect =
  | "buia" | "sovraesposta" | "dominante" | "storta" | "sfocata" | "rumorosa" | "bassa_risoluzione";

export interface TechMetrics {
  exposure_L: number;        // mean L* 0-100 (target 52-72)
  clip_high_pct: number;     // % blown highlights (target <= 6)
  cast: number;              // colour cast magnitude, Lab units (target <= 4)
  tilt_deg: number;          // |tilt| of vertical lines (target <= 0.75)
  sharpness: number;         // variance of Laplacian @1024px (target >= 120)
  noise_sigma: number;       // estimated noise (target <= 2.5)
  megapixels: number;
  width: number;
  height: number;
}

export interface Rubric {        // 1..5, anchored (see rubric_definition)
  esposizione: number;
  colore: number;
  geometria: number;
  nitidezza: number;
  naturalezza: number;
  attrattivita: number;
}

export interface FidelityChecklist { // true = problem detected
  oggetti_aggiunti_rimossi: boolean;
  finestre_vista_cambiata: boolean;
  materiali_colori_cambiati: boolean;
  geometria_stanza_alterata: boolean;
  difetti_nascosti: boolean;     // stains/cracks/damage cleaned or hidden
  testi_loghi_alterati: boolean;
}

export interface JudgeVerdict {
  judge: JudgeId;
  preferred: "output" | "input" | "tie";   // after position-swap reconciliation
  position_consistent: boolean | null;    // same answer in both A/B orders; null when asked in one order only
  rubric_output: Rubric;
  rubric_input: Rubric;
  checklist: FidelityChecklist;
  notes: string;                           // short Italian explanation from the judge
  excluded_conflict: boolean;              // judge from the same family as the generator
}

export interface Fidelity {
  flag: boolean;                  // final decision: output alters the property
  flag_reasons: string[];         // human-readable Italian reasons
  structural: number;             // gradient-SSIM after alignment, 0..1 (1 = identical structure)
  changed_area_pct: number;       // % of area with structural change
  semantic: number;               // DINOv2 cosine similarity 0..1
  alignment_ok: boolean;
  framing_kept_pct: number;       // % of the original frame still visible
  invented_area_pct?: number;     // % of the output with no counterpart in the original (outpainted borders)
  checklist_majority: FidelityChecklist; // majority of unconflicted judges
}

export interface Output {
  status: "ok" | "error";
  error?: string;
  src?: string;              // relative to /data/, e.g. "images/R01/F3.webp"
  heatmap?: string;          // structural-change heatmap overlay
  thumb?: string;            // [web addition, optional] small preview for grids, relative to /data/; UI falls back to src
  w?: number;
  h?: number;
  latency_s?: number;        // wall-clock
  gpu_s?: number | null;
  cost_usd?: number;         // estimated
  metrics?: TechMetrics;
  fixed_defects?: Defect[];      // defects of the input now within target
  remaining_defects?: Defect[];
  new_defects?: Defect[];        // defects introduced by the workflow
  fidelity?: Fidelity;
  judges?: JudgeVerdict[];
  ensemble?: { win: number; judges_used: JudgeId[]; rubric_mean: Rubric }; // win: 1 / 0.5 / 0 vs input
  ops?: Record<string, unknown>; // what the deterministic steps did (F1/F5)
  full_ref?: { psnr: number; ssim: number; lpips: number } | null; // only for degraded inputs, vs ground truth
  iqa?: { musiq: number; topiq: number } | null;
}

export interface ImageItem {
  id: string;                      // R01..R18 (real), D01..D06 (degraded)
  kind: "real" | "degraded";
  note: string;                    // Italian tag, e.g. "dominante+buia"
  source_url: string;              // Immobiliare.it listing
  input: { src: string; w: number; h: number; metrics: TechMetrics; defects: Defect[];
           thumb?: string };         // [web addition, optional] small preview, relative to /data/
  ground_truth?: { src: string; w: number; h: number; thumb?: string } | null; // clean original for D items
  degradation?: Record<string, number | string> | null;
  outputs: Partial<Record<WorkflowId, Output>>;
  router: { chosen: WorkflowId | "reshoot"; reason: string; fallback?: WorkflowId | null };
}

export interface WorkflowSummary {
  success_rate: number; n_ok: number; n_total: number;
  latency_p50_s: number; latency_p90_s: number; gpu_s_p50: number | null;
  cost_usd_per_image: number; cost_range?: [number, number]; cost_note: string;
  quality_winrate: number;                 // ensemble win-rate vs input (ties = 0.5), 0..1
  quality_winrate_ci: [number, number];    // 95% bootstrap CI
  rubric: Rubric;
  defect_fix_rate: number;                 // share of input defects brought within target
  new_defect_rate: number;
  fidelity_flag_rate: number;
  fidelity_flag_breakdown: Partial<Record<keyof FidelityChecklist | "strutturale", number>>;
  structural_mean: number;
  full_ref?: { psnr: number; ssim: number; lpips: number } | null;
  iqa_musiq?: number | null;
  gates: { reliability: boolean; fidelity: boolean };
  score: number | null;                    // null if a gate fails
  rank: number | null;
  safe_winrate?: number;                   // [pipeline addition] share of photos improved AND not flagged (ties = 0.5)
  risk_adjusted_score?: number;            // [pipeline addition] declared score with safe_winrate as quality, all workflows admitted
}

export interface Workflow {
  id: WorkflowId;
  name: string; short: string; engine: string; family: string; generative: boolean;
  description: string; question: string; prompt?: string | null;
  summary: WorkflowSummary;
}

export interface Results {
  generated_at: string;
  is_mock?: boolean;                       // [web addition, optional] true when written by web/scripts/make-mock.mjs
  dataset: { n_real: number; n_degraded: number; source: string; notes: string };
  workflows: Workflow[];
  decision: {
    declared_at?: string;                  // [web addition, optional] ISO date the rule/weights were fixed (pre-registration)
    weights: { quality: number; naturalness: number; cost: number; speed: number };
    gates: { reliability_min: number; fidelity_flag_max: number };
    winner: WorkflowId | null;
    rationale: string;                     // Italian
    per_defect_winner: Partial<Record<Defect, WorkflowId>>;
    pairwise_questions: { pair: [WorkflowId, WorkflowId]; question: string; answer: string }[];
    /** [pipeline addition] production router: try cascade[0], fall back to cascade[1] when the fidelity check rejects it. */
    recommendation?: {
      cascade: WorkflowId[];
      delivered_rate: number;              // share of photos that end improved AND faithful
      mean_cost_usd: number;               // includes rejected attempts
      p50_latency_s: number;
      order: WorkflowId[];
      alternatives: { cascade: WorkflowId[]; delivered_rate: number; mean_cost_usd: number; p50_latency_s: number }[];
    };
  };
  images: ImageItem[];
  judges: {
    list: { id: JudgeId; name: string; family: string; model: string }[];
    agreement: { krippendorff_alpha: number; pairwise_agreement: Record<string, number> };
    position_consistency: Partial<Record<JudgeId, number>>;
    gt_accuracy: Partial<Record<JudgeId, number>>;          // prefers clean original over degraded
    self_preference: { judge: JudgeId; own_family_winrate: number; others_winrate: number }[];
  };
  traps: {
    n: number;
    detectors: { id: string; name: string; precision: number; recall: number; f1: number }[];
    items: { id: string; type: string; description: string; original: string; altered: string;
             is_alteration: boolean; detected_by: string[] }[];
  };
  rubric_definition: Record<keyof Rubric, { label: string; anchors: { 1: string; 3: string; 5: string } }>;
  real_vs_simulated: { item: string; status: "reale" | "stimato" | "simulato" | "progettato"; note: string }[];
  limits: string[];
}

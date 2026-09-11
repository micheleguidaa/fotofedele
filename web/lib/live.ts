// Contract between /api/enhance and `python -m fotolab enhance` (local "live" mode only).
import type { Defect, Fidelity, TechMetrics, WorkflowId } from "./types";

/** Workflows run in live mode (fast and cheap enough to run on demand). */
export const LIVE_WORKFLOWS: WorkflowId[] = ["F1", "F4"];

/** One workflow result as printed by the Python CLI (`path` is a file written in --outdir). */
export interface CliOutput {
  path?: string;
  heatmap?: string | null;
  ops?: Record<string, unknown>;
  metrics?: TechMetrics;
  fidelity?: Fidelity;
  fixed_defects?: Defect[];
  remaining_defects?: Defect[];
  new_defects?: Defect[];
  latency_s?: number;
  error?: string;
}

export interface CliResult {
  input: { metrics: TechMetrics; defects: Defect[] };
  outputs: Partial<Record<WorkflowId, CliOutput>>;
}

/** What /api/enhance returns to the browser: file paths replaced by data URLs. */
export interface LiveOutput extends Omit<CliOutput, "path" | "heatmap"> {
  src?: string; // data: URL
  heatmap?: string | null; // data: URL
}

export interface LiveResult {
  input: { metrics: TechMetrics; defects: Defect[] };
  outputs: Partial<Record<WorkflowId, LiveOutput>>;
  elapsed_s?: number;
}

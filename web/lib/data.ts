// Server-side loader for public/data/results.json (read at build time: all pages are static).
import fs from "node:fs";
import path from "node:path";

import type { ImageItem, Output, Results, Workflow, WorkflowId } from "./types";

let cached: Results | null = null;
let cachedMtime = 0;

export function getResults(): Results {
  const file = path.join(process.cwd(), "public", "data", "results.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      `Missing ${file}. Export it from the pipeline, or run \`npm run mock\` to generate example data.`,
    );
  }
  // In dev, pick up a re-exported results.json without restarting the server.
  const mtime = process.env.NODE_ENV === "production" ? cachedMtime : fs.statSync(file).mtimeMs;
  if (cached && mtime === cachedMtime) return cached;
  cached = JSON.parse(fs.readFileSync(file, "utf8")) as Results;
  cachedMtime = mtime;
  return cached;
}

export function getWorkflow(r: Results, id: WorkflowId | string | null | undefined): Workflow | undefined {
  return r.workflows.find((w) => w.id === id);
}

export function getImage(r: Results, id: string): ImageItem | undefined {
  return r.images.find((i) => i.id === id);
}

/** Output stripped of the heavy per-judge verdicts (for client components that don't need them). */
export function slimOutput(o: Output): Output {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { judges, ...rest } = o;
  return rest;
}

export function slimImage(img: ImageItem): ImageItem {
  const outputs: ImageItem["outputs"] = {};
  for (const [k, o] of Object.entries(img.outputs)) if (o) outputs[k as WorkflowId] = slimOutput(o);
  return { ...img, outputs };
}

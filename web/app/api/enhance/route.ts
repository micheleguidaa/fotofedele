// Live enhancement (local only): runs the Python pipeline on an uploaded photo.
// Disabled unless LIVE_MODE=1 — on Vercel it always answers 501.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { LIVE_WORKFLOWS, type CliResult, type LiveOutput, type LiveResult } from "@/lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// No maxDuration export on purpose: on Vercel the route answers 501 immediately; locally there is no limit.

const TIMEOUT_MS = 180_000;
const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function runCli(args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const python = path.join(/*turbopackIgnore: true*/ cwd, ".venv", "bin", "python");
    const child = spawn(python, args, { cwd, env: { ...process.env, PYTHONUNBUFFERED: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => {
      stderr += d;
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out).toString("utf8"), stderr, timedOut });
    });
  });
}

/** The CLI prints one JSON object; tolerate log lines before it. */
function parseCliJson(stdout: string): CliResult | null {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed) as CliResult;
  } catch {
    const start = trimmed.lastIndexOf("\n{");
    const candidate = start >= 0 ? trimmed.slice(start + 1) : trimmed.slice(trimmed.indexOf("{"));
    try {
      return JSON.parse(candidate) as CliResult;
    } catch {
      return null;
    }
  }
}

/** Inline a file written by the CLI as a data URL. Only files inside our temp dir are read. */
async function toDataUrl(file: string | null | undefined, tmpReal: string, bases: string[]): Promise<string | undefined> {
  if (!file) return undefined;
  const candidates = path.isAbsolute(file) ? [file] : bases.map((b) => path.resolve(/*turbopackIgnore: true*/ b, file));
  for (const candidate of candidates) {
    const real = await fs.realpath(candidate).catch(() => null);
    if (!real || !real.startsWith(tmpReal + path.sep)) continue;
    const buf = await fs.readFile(real);
    const mime = MIME_BY_EXT[path.extname(real).toLowerCase()] ?? "application/octet-stream";
    return `data:${mime};base64,${buf.toString("base64")}`;
  }
  return undefined;
}

export async function POST(request: Request) {
  if (process.env.LIVE_MODE !== "1") {
    return json({ error: "Disponibile solo in locale" }, 501);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Richiesta non valida: atteso multipart/form-data con il campo 'file'." }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "Manca il file." }, 400);
  const ext = ALLOWED[file.type];
  if (!ext) return json({ error: "Formato non supportato: usa JPEG, PNG o WebP." }, 415);
  if (file.size > MAX_BYTES) return json({ error: "File troppo grande (max 20 MB)." }, 413);

  const pipelineDir = path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.PIPELINE_DIR ?? "../pipeline");
  const tmp = await fs.mkdtemp(path.join(/*turbopackIgnore: true*/ os.tmpdir(), "fotofedele-"));
  const started = Date.now();
  try {
    const tmpReal = await fs.realpath(tmp);
    const inputPath = path.join(/*turbopackIgnore: true*/ tmp, `${randomUUID()}${ext}`);
    const outDir = path.join(/*turbopackIgnore: true*/ tmp, "out");
    await fs.mkdir(outDir);
    await fs.writeFile(inputPath, Buffer.from(await file.arrayBuffer()));

    const args = ["-m", "fotolab", "enhance", "--input", inputPath, "--outdir", outDir];
    for (const wf of LIVE_WORKFLOWS) args.push("--wf", wf);

    let run;
    try {
      run = await runCli(args, pipelineDir);
    } catch (err) {
      return json({ error: `Impossibile avviare la pipeline Python: ${(err as Error).message}` }, 500);
    }
    if (run.timedOut) return json({ error: "Elaborazione oltre i 180 secondi: interrotta." }, 504);
    const parsed = parseCliJson(run.stdout);
    if (run.code !== 0 || !parsed) {
      const tail = run.stderr.trim().split("\n").slice(-3).join(" ");
      return json({ error: `La pipeline ha restituito un errore${tail ? `: ${tail}` : "."}` }, 502);
    }

    const outputs: LiveResult["outputs"] = {};
    for (const [wf, o] of Object.entries(parsed.outputs ?? {})) {
      if (!o) continue;
      const { path: p, heatmap, ...rest } = o;
      const out: LiveOutput = {
        ...rest,
        src: await toDataUrl(p, tmpReal, [outDir, pipelineDir]),
        heatmap: (await toDataUrl(heatmap, tmpReal, [outDir, pipelineDir])) ?? null,
      };
      outputs[wf as keyof LiveResult["outputs"]] = out;
    }
    const result: LiveResult = { input: parsed.input, outputs, elapsed_s: (Date.now() - started) / 1000 };
    return json(result);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

export function GET() {
  return json({ error: "Usa POST con multipart/form-data (campo 'file')." }, 405);
}

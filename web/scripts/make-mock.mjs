#!/usr/bin/env node
/**
 * make-mock.mjs — writes a realistic MOCK `public/data/results.json` + images for UI development.
 *
 *   npm run mock                 # overwrites public/data/results.json and public/data/images/
 *   npm run mock -- --no-thumbs  # skip thumbnail generation (thumbnails need macOS `sips`)
 *
 * Uses the REAL pipeline images (inputs + whatever workflow outputs already exist in
 * ../pipeline/data/runs/<WF>/) and REAL run records (latency, GPU time, F1 ops) when available.
 * Everything else (metrics, judges, fidelity, traps, meta-validation) is SIMULATED with a seeded
 * RNG, but every summary is computed from the simulated per-image data, so numbers are coherent.
 * Missing workflow outputs reuse the input image as a placeholder.
 *
 * The real exporter (pipeline/fotolab/aggregate.py) replaces all of this: it writes the same
 * file with the same shape and `.webp` images with the same basenames.
 * Requires Node >= 22.18 (imports ../lib/score.ts directly via native type stripping).
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { computeScores, scoreInputsFromWorkflows } from "../lib/score.ts";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PIPE = path.resolve(process.env.PIPELINE_DIR ?? path.join(WEB, "..", "pipeline"));
const INPUTS = path.join(PIPE, "data", "inputs");
const RUNS = path.join(PIPE, "data", "runs");
const PROMPTS = path.join(PIPE, "config", "prompts");
const OUT_DIR = path.join(WEB, "public", "data");
const IMG_DIR = path.join(OUT_DIR, "images");
const WANT_THUMBS = !process.argv.includes("--no-thumbs");

// ---------------------------------------------------------------- seeded random helpers
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260911);
const between = (a, b) => a + (b - a) * rand();
const chance = (p) => rand() < p;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const gauss = (mu = 0, sd = 1) => {
  const u = 1 - rand();
  const v = rand();
  return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rd = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const quantile = (xs, q) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const pctIt = (v, d = 0) => `${(v * 100).toFixed(d).replace(".", ",")}%`;
const numIt = (v, d = 1) => v.toFixed(d).replace(".", ",");
const usdIt = (v) => `${Number(v.toPrecision(3)).toString().replace(".", ",")} $`;

// ---------------------------------------------------------------- metric targets (mirror of pipeline TARGETS)
const DEFECT_METRIC = {
  buia: "exposure_L",
  sovraesposta: "clip_high_pct",
  dominante: "cast",
  storta: "tilt_deg",
  sfocata: "sharpness",
  rumorosa: "noise_sigma",
  bassa_risoluzione: "megapixels",
};
const DEFECT_LABEL = {
  buia: "buia",
  sovraesposta: "sovraesposta",
  dominante: "dominante di colore",
  storta: "verticali storte",
  sfocata: "poco nitida",
  rumorosa: "rumore",
  bassa_risoluzione: "bassa risoluzione",
};
function defectsOf(m) {
  const out = [];
  if (m.exposure_L < 52) out.push("buia");
  if (m.clip_high_pct > 6) out.push("sovraesposta");
  if (m.cast > 4) out.push("dominante");
  if (m.tilt_deg > 0.75) out.push("storta");
  if (m.sharpness < 120) out.push("sfocata");
  if (m.noise_sigma > 2.5) out.push("rumorosa");
  if (m.megapixels < 1) out.push("bassa_risoluzione");
  return out;
}
const GOOD = {
  exposure_L: () => between(55, 68),
  clip_high_pct: () => between(0.2, 4.5),
  cast: () => between(0.7, 3.4),
  tilt_deg: () => between(0.04, 0.6),
  sharpness: () => between(150, 480),
  noise_sigma: () => between(0.7, 2.2),
};
const BAD = {
  exposure_L: () => between(31, 49),
  clip_high_pct: () => between(7, 12.5),
  cast: () => between(4.6, 11),
  tilt_deg: () => between(0.9, 3.2),
  sharpness: () => between(40, 112),
  noise_sigma: () => between(2.7, 5.5),
};
/** Improved but still out of target. */
const PARTIAL = {
  exposure_L: (v) => Math.min(51.4, v + (52 - v) * between(0.3, 0.8)),
  clip_high_pct: (v) => Math.max(6.3, 6 + (v - 6) * between(0.3, 0.8)),
  cast: (v) => Math.max(4.2, 4 + (v - 4) * between(0.3, 0.8)),
  tilt_deg: (v) => Math.max(0.8, 0.75 + (v - 0.75) * between(0.2, 0.7)),
  sharpness: (v) => Math.min(118, v + (120 - v) * between(0.3, 0.8)),
  noise_sigma: (v) => Math.max(2.6, 2.5 + (v - 2.5) * between(0.3, 0.8)),
};
/** Stays in target, with small drift. */
const DRIFT = {
  exposure_L: (v) => clamp(v + gauss(0, 3), 53, 71),
  clip_high_pct: (v) => clamp(v * between(0.6, 1.2), 0.1, 5.8),
  cast: (v) => clamp(v * between(0.5, 1.1), 0.4, 3.9),
  tilt_deg: (v) => clamp(v * between(0.4, 1.1), 0.02, 0.74),
  sharpness: (v) => clamp(v * between(0.95, 1.5), 121, 900),
  noise_sigma: (v) => clamp(v * between(0.5, 1.05), 0.5, 2.45),
};
const ROUND = { exposure_L: 1, clip_high_pct: 2, cast: 2, tilt_deg: 2, sharpness: 0, noise_sigma: 2 };

// ---------------------------------------------------------------- workflows (mirror of pipeline/config/workflows.yaml)
const readPrompt = (name) => {
  try {
    return fs.readFileSync(path.join(PROMPTS, `${name}.md`), "utf8").trim();
  } catch {
    return null;
  }
};
const H200_USD_PER_HOUR = 4.4;
const WORKFLOWS = [
  {
    id: "F1",
    name: "Classico deterministico",
    short: "OpenCV + Real-ESRGAN",
    engine: "classical",
    family: "none",
    generative: false,
    description:
      "Raddrizza le verticali misurate, bilancia il bianco sui pixel neutri, corregge l'esposizione (gamma + CLAHE), riduce il rumore; sotto 0,6 MP applica super-risoluzione Real-ESRGAN (H200).",
    question: "Baseline: quanto si ottiene a costo ~0 e senza rischio di allucinazioni?",
    prompt: null,
    cost_note: "CPU; + ~1 s di H200 solo per la super-risoluzione",
  },
  {
    id: "F2",
    name: "gpt-image · prompt semplice",
    short: "gpt-image-2 (Codex)",
    engine: "codex_image",
    family: "openai",
    generative: true,
    description: "Una sola istruzione generica: rendi la foto professionale e attraente.",
    question: "Cosa succede se si chiede solo 'rendila bella'?",
    prompt: readPrompt("enhance_simple"),
    cost_range: [0.041, 0.165],
    cost_note: "listino gpt-image-2 1024x1536 medium-high",
  },
  {
    id: "F3",
    name: "gpt-image · prompt vincolato",
    short: "gpt-image-2 (Codex)",
    engine: "codex_image",
    family: "openai",
    generative: true,
    description: "Stesso modello di F2 con un prompt che elenca cosa migliorare e cosa NON toccare.",
    question: "F2 vs F3: quanto conta il prompt?",
    prompt: readPrompt("enhance_strict"),
    cost_range: [0.041, 0.165],
    cost_note: "listino gpt-image-2 1024x1536 medium-high",
  },
  {
    id: "F4",
    name: "Qwen-Image-Edit 2511 · open weights",
    short: "Qwen 2511 + Lightning (H200)",
    engine: "comfy_qwen",
    family: "alibaba",
    generative: true,
    description:
      "Modello open-weights (fp8, LoRA Lightning 8 step) su ComfyUI, stesso prompt vincolato di F3.",
    question: "F3 vs F4: modello chiuso vs open-weights self-hosted",
    prompt: readPrompt("enhance_strict"),
    cost_note: "tempo GPU misurato × 4,40 $/h (H200 on-demand)",
  },
  {
    id: "F6",
    name: "Gemini · Nano Banana",
    short: "Gemini image (abbonamento Plus)",
    engine: "gemini_image",
    family: "google",
    generative: true,
    description: "Modello immagini di Google con lo stesso prompt vincolato di F3.",
    question: "F3 vs F6: OpenAI vs Google a parità di prompt",
    prompt: readPrompt("enhance_strict"),
    cost_range: [0.039, 0.134],
    cost_note: "listino Nano Banana (Flash) / Pro",
  },
];
const WF = Object.fromEntries(WORKFLOWS.map((w) => [w.id, w]));

// Simulation knobs per workflow.
const SIM = {
  F1: { win: 0.2, tie: 0.28, nat: 3.6, attr: 3.2, newDef: 0.05, flags: 0, struct: [0.9, 0.975], sem: [0.95, 0.99], frame: [93, 98.5],
    fix: { buia: 0.8, sovraesposta: 0.3, dominante: 0.85, storta: 0.9, sfocata: 0.3, rumorosa: 0.7 } },
  F2: { win: 0.78, tie: 0.06, nat: 3.4, attr: 4.4, newDef: 0.14, flags: 9, struct: [0.55, 0.8], sem: [0.84, 0.94], frame: [82, 99],
    fix: { buia: 0.95, sovraesposta: 0.7, dominante: 0.9, storta: 0.55, sfocata: 0.9, rumorosa: 0.95 } },
  F3: { win: 0.72, tie: 0.08, nat: 4.0, attr: 4.1, newDef: 0.06, flags: 3, struct: [0.66, 0.88], sem: [0.87, 0.96], frame: [90, 99.5],
    fix: { buia: 0.9, sovraesposta: 0.6, dominante: 0.9, storta: 0.7, sfocata: 0.85, rumorosa: 0.9 } },
  F4: { win: 0.68, tie: 0.1, nat: 3.8, attr: 3.8, newDef: 0.07, flags: 2, struct: [0.72, 0.9], sem: [0.88, 0.97], frame: [92, 99.5],
    fix: { buia: 0.8, sovraesposta: 0.5, dominante: 0.8, storta: 0.6, sfocata: 0.85, rumorosa: 0.85 } },
  F6: { win: 0.7, tie: 0.08, nat: 3.9, attr: 4.1, newDef: 0.08, flags: 4, struct: [0.64, 0.86], sem: [0.86, 0.95], frame: [88, 99],
    fix: { buia: 0.9, sovraesposta: 0.6, dominante: 0.85, storta: 0.6, sfocata: 0.85, rumorosa: 0.9 } },
};
const ERRORS = {
  "F2/R05": "Nessuna immagine restituita: il modello ha risposto solo con testo",
  "F6/R13": "Limite di utilizzo dell'abbonamento raggiunto",
  "F6/R16": "Richiesta rifiutata dal filtro di sicurezza del provider",
  "F6/D04": "Timeout dopo 180 s",
};
const FLAG_KEYS = {
  F2: ["oggetti_aggiunti_rimossi", "finestre_vista_cambiata", "materiali_colori_cambiati", "difetti_nascosti"],
  F3: ["finestre_vista_cambiata", "difetti_nascosti", "materiali_colori_cambiati"],
  F4: ["geometria_stanza_alterata", "testi_loghi_alterati", "materiali_colori_cambiati"],
  F6: ["materiali_colori_cambiati", "oggetti_aggiunti_rimossi", "finestre_vista_cambiata"],
};
const FLAG_EXAMPLES = {
  oggetti_aggiunti_rimossi: ["Un quadro sulla parete è stato rimosso", "Compare una pianta che nell'originale non c'è", "Il tappeto è stato eliminato", "Rimossi gli oggetti dal piano della cucina"],
  finestre_vista_cambiata: ["La vista dalla finestra è stata reinventata", "Il cielo fuori dalla finestra è stato sostituito", "Le tende sono state aperte"],
  materiali_colori_cambiati: ["Il colore delle pareti è cambiato", "La venatura del parquet è diversa", "Le piastrelle hanno un disegno diverso"],
  geometria_stanza_alterata: ["La stanza appare più profonda dell'originale", "La porta ha proporzioni diverse", "Il soffitto sembra più alto"],
  difetti_nascosti: ["Una macchia di umidità sul soffitto è sparita", "Le crepe sull'intonaco sono state eliminate", "Il muro scrostato è stato ripulito"],
  testi_loghi_alterati: ["La filigrana dell'agenzia è stata alterata", "Il testo sul cartello è cambiato"],
};
const CHECKLIST_KEYS = [
  "oggetti_aggiunti_rimossi",
  "finestre_vista_cambiata",
  "materiali_colori_cambiati",
  "geometria_stanza_alterata",
  "difetti_nascosti",
  "testi_loghi_alterati",
];
const STRUCTURAL_AREA_MAX = 8; // % of area: above this the structural detector flags

const JUDGES = [
  { id: "gpt", name: "GPT", family: "openai", model: "gpt-5.1 (API, visione)" },
  { id: "gemini", name: "Gemini", family: "google", model: "gemini-2.5-pro" },
  { id: "gemma", name: "Gemma", family: "google", model: "gemma-3-27b-it (locale)" },
  { id: "qwen", name: "Qwen", family: "alibaba", model: "qwen2.5-vl-72b-instruct" },
];
const JUDGE_POS = { gpt: 0.91, gemini: 0.88, gemma: 0.74, qwen: 0.83 };
const JUDGE_AGREE = { gpt: 0.88, gemini: 0.86, gemma: 0.72, qwen: 0.8 };

// ---------------------------------------------------------------- file helpers
function imageSize(file) {
  const buf = fs.readFileSync(file);
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o < buf.length - 9) {
      if (buf[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = buf[o + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
        o += marker === 0xff ? 1 : 2;
        continue;
      }
      const len = buf.readUInt16BE(o + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
      }
      o += 2 + len;
    }
  }
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (chunk === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
  }
  throw new Error(`Unknown image format: ${file}`);
}

let sipsOk = WANT_THUMBS && process.platform === "darwin";
function makeThumb(srcAbs, relOut) {
  if (!sipsOk) return undefined;
  const outAbs = path.join(OUT_DIR, relOut);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  try {
    execFileSync("sips", ["-Z", "480", "-s", "format", "jpeg", "-s", "formatOptions", "72", srcAbs, "--out", outAbs], {
      stdio: "ignore",
    });
    return relOut;
  } catch {
    console.warn("sips failed: thumbnails disabled (UI falls back to full images)");
    sipsOk = false;
    return undefined;
  }
}

/** Copy an image into public/data/images/<id>/<name>.<ext>; returns {src, w, h, thumb}. */
function publish(id, name, srcAbs, thumbCache) {
  const ext = path.extname(srcAbs).toLowerCase();
  const rel = `images/${id}/${name}${ext}`;
  fs.mkdirSync(path.join(IMG_DIR, id), { recursive: true });
  fs.copyFileSync(srcAbs, path.join(OUT_DIR, rel));
  const { w, h } = imageSize(srcAbs);
  let thumb = thumbCache?.get(srcAbs);
  if (!thumb) {
    thumb = makeThumb(srcAbs, `images/${id}/thumbs/${name}.jpg`);
    if (thumb) thumbCache?.set(srcAbs, thumb);
  }
  return { src: rel, w, h, thumb };
}

function heatmapSvg(id, name, w, h, intensity) {
  const n = Math.max(1, Math.round(1 + intensity * 5));
  const blobs = [];
  for (let i = 0; i < n; i++) {
    const cx = rd(between(0.1, 0.9) * w, 0);
    const cy = rd(between(0.1, 0.9) * h, 0);
    const rx = rd(between(0.04, 0.08 + intensity * 0.18) * w, 0);
    const ry = rd(rx * between(0.6, 1.4), 0);
    const op = rd(clamp(0.35 + intensity * 0.6 * rand(), 0.25, 0.95), 2);
    blobs.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#g)" opacity="${op}"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none">
<defs><radialGradient id="g"><stop offset="0" stop-color="#ff1f0f" stop-opacity="0.95"/><stop offset="0.55" stop-color="#ff8a00" stop-opacity="0.45"/><stop offset="1" stop-color="#ffd000" stop-opacity="0"/></radialGradient></defs>
${blobs.join("\n")}
</svg>`;
  const rel = `images/${id}/${name}_heatmap.svg`;
  fs.writeFileSync(path.join(OUT_DIR, rel), svg);
  return rel;
}

// ---------------------------------------------------------------- load pipeline inputs
if (!fs.existsSync(path.join(INPUTS, "manifest.json"))) {
  console.error(`manifest not found in ${INPUTS}. Set PIPELINE_DIR=/path/to/pipeline`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(path.join(INPUTS, "manifest.json"), "utf8"));
const records = new Map();
try {
  for (const line of fs.readFileSync(path.join(RUNS, "records.jsonl"), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.status === "ok") records.set(`${r.wf}/${r.input}`, r); // last ok record wins
  }
} catch {
  console.warn("records.jsonl not found: latencies will be simulated");
}

fs.rmSync(IMG_DIR, { recursive: true, force: true });
fs.mkdirSync(IMG_DIR, { recursive: true });

const entries = manifest.filter((m) => m.kind === "real" || m.kind === "degraded");
const byId = Object.fromEntries(manifest.map((m) => [m.id, m]));
const thumbCache = new Map();

// ---------------------------------------------------------------- per-image simulation
function inputMetrics(m, dims) {
  const tags = new Set(m.auto_defects ?? []);
  const note = (m.note ?? "").toLowerCase();
  if (note.includes("buia")) tags.add("buia");
  if (note.includes("sovraesposta") || note.includes("controluce")) tags.add("sovraesposta");
  if (note.includes("storta") || note.includes("verticali")) tags.add("storta");
  if (note.includes("dominante")) tags.add("dominante");
  const deg = m.degradation;
  if (deg) ["buia", "dominante", "storta", "rumorosa"].forEach((d) => tags.add(d));
  const met = {};
  for (const [d, key] of Object.entries(DEFECT_METRIC)) {
    if (key === "megapixels") continue;
    met[key] = tags.has(d) ? BAD[key]() : GOOD[key]();
  }
  if (deg) {
    met.tilt_deg = Math.abs(deg.tilt_deg);
    met.noise_sigma = deg.noise_sigma * between(0.7, 0.85);
    met.cast = 4 + deg.cast_strength * between(28, 45);
    met.exposure_L = 60 + deg.ev * between(14, 20);
    if (chance(0.5)) met.sharpness = BAD.sharpness();
  }
  if (note.includes("controluce")) met.clip_high_pct = between(17, 21);
  for (const k of Object.keys(met)) met[k] = rd(met[k], ROUND[k]);
  met.width = dims.w;
  met.height = dims.h;
  met.megapixels = rd((dims.w * dims.h) / 1e6, 3);
  return met;
}

function outputMetrics(inMet, inDefects, sim, dims, generative) {
  const out = {};
  for (const [d, key] of Object.entries(DEFECT_METRIC)) {
    if (key === "megapixels") continue;
    const v = inMet[key];
    if (inDefects.includes(d)) out[key] = chance(sim.fix[d]) ? GOOD[key]() : PARTIAL[key](v);
    else if (chance(sim.newDef / 2)) out[key] = BAD[key]();
    else out[key] = key === "sharpness" && generative ? clamp(v * between(1.1, 1.7), 121, 900) : DRIFT[key](v);
  }
  for (const k of Object.keys(out)) out[k] = rd(out[k], ROUND[k]);
  out.width = dims.w;
  out.height = dims.h;
  out.megapixels = rd((dims.w * dims.h) / 1e6, 3);
  return out;
}

function inputRubric(defects) {
  const has = (d) => defects.includes(d);
  const v = (bad, mu) => clamp(Math.round(gauss(bad ? 2.1 : mu, 0.6)), 1, 5);
  return {
    esposizione: v(has("buia") || has("sovraesposta"), 3.8),
    colore: v(has("dominante"), 3.8),
    geometria: v(has("storta"), 3.9),
    nitidezza: v(has("sfocata") || has("rumorosa") || has("bassa_risoluzione"), 3.6),
    naturalezza: clamp(Math.round(gauss(4.4, 0.5)), 3, 5),
    attrattivita: clamp(Math.round(gauss(defects.length > 2 ? 2.3 : 3, 0.6)), 1, 5),
  };
}

function outputRubric(sim, preferred, flagged, fixed, remaining) {
  const base = preferred === "output" ? 4.1 : preferred === "tie" ? 3.5 : 3.1;
  const dim = (defect, extra = 0) => {
    const d = [].concat(defect);
    const isFixed = d.some((x) => fixed.includes(x));
    const isRemaining = d.some((x) => remaining.includes(x));
    return clamp(Math.round(gauss(base + extra + (isFixed ? 0.4 : 0) - (isRemaining ? 0.9 : 0), 0.55)), 1, 5);
  };
  return {
    esposizione: dim(["buia", "sovraesposta"]),
    colore: dim("dominante"),
    geometria: dim("storta"),
    nitidezza: dim(["sfocata", "rumorosa", "bassa_risoluzione"]),
    naturalezza: clamp(Math.round(gauss(sim.nat - (flagged ? 0.8 : 0), 0.6)), 1, 5),
    attrattivita: clamp(Math.round(gauss((sim.attr + base) / 2, 0.55)), 1, 5),
  };
}

const NOTES = {
  output: [
    "Più luminosa e con bianchi neutri; stanza leggibile.",
    "Verticali dritte ed esposizione corretta, aspetto naturale.",
    "Colori più puliti, ombre aperte senza effetto HDR.",
    "Nettamente più invitante; nessun elemento nuovo visibile.",
    "Migliora luce e nitidezza, dettagli dei materiali conservati.",
  ],
  input: [
    "La versione migliorata ha un aspetto artificiale sulle superfici.",
    "Differenze minime, l'originale resta più credibile.",
    "La migliorata è troppo contrastata e satura.",
    "Il miglioramento è lieve e introduce aloni sui bordi.",
  ],
  tie: [
    "Differenze quasi impercettibili.",
    "Più luminosa ma meno naturale: pareggio.",
    "Risposta diversa invertendo l'ordine A/B: registrato come pari.",
  ],
  flag: [
    "Attenzione: la scena non è più la stessa in alcuni dettagli.",
    "Più attraente, ma alcuni elementi della stanza sono cambiati.",
  ],
};

function simulateJudges(wf, sim, flagged, flagKeys, fixed, remaining, inDefects) {
  const u = rand();
  const boost = Math.min(0.12, inDefects.length * 0.03);
  const target = u < sim.win + boost ? "output" : u < sim.win + boost + sim.tie ? "tie" : "input";
  const verdicts = JUDGES.map((j) => {
    const excluded = j.family === wf.family;
    let preferred = chance(JUDGE_AGREE[j.id]) ? target : pick(["output", "input", "tie"].filter((p) => p !== target));
    if (excluded && preferred !== "output" && chance(0.35)) preferred = "output"; // self-preference
    const position_consistent = chance(JUDGE_POS[j.id]);
    if (!position_consistent) preferred = "tie";
    const checklist = Object.fromEntries(CHECKLIST_KEYS.map((k) => [k, false]));
    return { judge: j.id, preferred, position_consistent, excluded_conflict: excluded, checklist };
  });
  const used = verdicts.filter((v) => !v.excluded_conflict);
  // checklist: flagged keys true for a majority of unconflicted judges; rare spurious single flags otherwise
  for (const k of flagKeys) {
    const need = Math.floor(used.length / 2) + 1;
    shuffle(used)
      .slice(0, chance(0.5) ? used.length : need)
      .forEach((v) => (v.checklist[k] = true));
    verdicts.filter((v) => v.excluded_conflict).forEach((v) => (v.checklist[k] = chance(0.4)));
  }
  if (!flagKeys.length && chance(0.12)) {
    const v = pick(verdicts);
    v.checklist[pick(CHECKLIST_KEYS)] = true;
  }
  for (const v of verdicts) {
    v.rubric_output = outputRubric(sim, v.preferred, flagged, fixed, remaining);
    v.rubric_input = inputRubric(inDefects);
    const anyFlag = Object.values(v.checklist).some(Boolean);
    v.notes = anyFlag ? pick(NOTES.flag) : !v.position_consistent ? NOTES.tie[2] : pick(NOTES[v.preferred]);
  }
  const nOut = used.filter((v) => v.preferred === "output").length;
  const nIn = used.filter((v) => v.preferred === "input").length;
  const win = nOut > nIn ? 1 : nOut < nIn ? 0 : 0.5;
  const rubric_mean = {};
  for (const k of Object.keys(verdicts[0].rubric_output)) rubric_mean[k] = rd(mean(used.map((v) => v.rubric_output[k])), 2);
  const majority = Object.fromEntries(
    CHECKLIST_KEYS.map((k) => [k, used.filter((v) => v.checklist[k]).length > used.length / 2]),
  );
  // stable key order in the JSON
  const ordered = verdicts.map((v) => ({
    judge: v.judge,
    preferred: v.preferred,
    position_consistent: v.position_consistent,
    rubric_output: v.rubric_output,
    rubric_input: v.rubric_input,
    checklist: v.checklist,
    notes: v.notes,
    excluded_conflict: v.excluded_conflict,
  }));
  return { verdicts: ordered, ensemble: { win, judges_used: used.map((v) => v.judge), rubric_mean }, majority };
}

const FULL_REF = {
  F1: [24.1, 0.79, 0.21],
  F2: [18.9, 0.61, 0.36],
  F3: [21.2, 0.7, 0.28],
  F4: [22.3, 0.73, 0.25],
  F6: [20.4, 0.67, 0.31],
};
const MUSIQ = { F1: 57, F2: 71, F3: 69, F4: 65, F6: 68 };

// Pre-assign which outputs get a fidelity flag (fixed counts → stable gates).
const flagPlan = new Set();
for (const wf of WORKFLOWS) {
  const candidates = entries.map((e) => e.id).filter((id) => !ERRORS[`${wf.id}/${id}`]);
  shuffle(candidates)
    .slice(0, SIM[wf.id].flags)
    .forEach((id) => flagPlan.add(`${wf.id}/${id}`));
}

const images = [];
for (const m of entries) {
  const inAbs = path.join(INPUTS, m.path);
  const input = publish(m.id, "input", inAbs, thumbCache);
  const metrics = inputMetrics(m, input);
  const defects = defectsOf(metrics);
  let ground_truth = null;
  if (m.ground_truth && byId[m.ground_truth]) {
    ground_truth = publish(m.id, "gt", path.join(INPUTS, byId[m.ground_truth].path), thumbCache);
  }
  const outputs = {};
  for (const wf of WORKFLOWS) {
    const key = `${wf.id}/${m.id}`;
    const sim = SIM[wf.id];
    const rec = records.get(key);
    // latency / gpu / cost
    let latency;
    let gpu = null;
    if (wf.id === "F1") {
      latency = rec?.wall_seconds ?? between(0.2, 1.5);
      gpu = rec?.gpu_seconds ?? 0;
    } else if (wf.id === "F4") {
      latency = rec?.wall_seconds ?? clamp(gauss(9.5, 1.2), 7, 14);
      gpu = rec?.gpu_seconds ?? rd(between(4.6, 5.2), 3);
    } else if (wf.id === "F2" || wf.id === "F3") {
      latency = rec?.wall_seconds ?? clamp(gauss(wf.id === "F2" ? 92 : 104, 16), 55, 170);
    } else {
      latency = clamp(gauss(24, 7), 9, 60);
    }
    const cost =
      wf.id === "F1"
        ? 0.0002 + ((gpu ?? 0) * H200_USD_PER_HOUR) / 3600
        : wf.id === "F4"
          ? ((gpu ?? 5) * H200_USD_PER_HOUR) / 3600
          : wf.id === "F6"
            ? 0.039
            : 0.165;

    if (ERRORS[key]) {
      outputs[wf.id] = { status: "error", error: ERRORS[key], latency_s: rd(wf.id === "F6" && key.endsWith("D04") ? 180 : latency, 2), gpu_s: null, cost_usd: 0 };
      continue;
    }
    const runPng = ["png", "webp", "jpg"].map((e) => path.join(RUNS, wf.id, `${m.id}.${e}`)).find((p) => fs.existsSync(p));
    const out = publish(m.id, wf.id, runPng ?? inAbs, thumbCache);
    const om = outputMetrics(metrics, defects, sim, out, wf.generative);
    const outDefects = defectsOf(om);
    const fixed = defects.filter((d) => !outDefects.includes(d));
    const remaining = defects.filter((d) => outDefects.includes(d));
    const newDefects = outDefects.filter((d) => !defects.includes(d));

    const flagged = flagPlan.has(key);
    let flagKeys = [];
    let changed = flagged ? between(3, 22) : between(0.2, wf.generative ? 5.5 : 1.4);
    const structuralFlag = changed > STRUCTURAL_AREA_MAX;
    if (flagged && (!structuralFlag || chance(0.6))) {
      flagKeys = shuffle(FLAG_KEYS[wf.id]).slice(0, chance(0.3) ? 2 : 1);
    }
    if (flagged && !structuralFlag && !flagKeys.length) flagKeys = [FLAG_KEYS[wf.id][0]];
    const j = simulateJudges(wf, sim, flagged, flagKeys, fixed, remaining, defects);
    const structural = flagged ? between(sim.struct[0] - 0.14, sim.struct[0] + 0.06) : between(...sim.struct);
    const reasons = [];
    for (const k of CHECKLIST_KEYS) {
      if (!j.majority[k]) continue;
      const used = j.verdicts.filter((v) => !v.excluded_conflict);
      const n = used.filter((v) => v.checklist[k]).length;
      reasons.push(`${pick(FLAG_EXAMPLES[k])} (${n} giudici su ${used.length})`);
    }
    if (structuralFlag) reasons.push(`Cambiamento strutturale sul ${numIt(changed)}% dell'area (soglia ${STRUCTURAL_AREA_MAX}%)`);
    const flag = structuralFlag || Object.values(j.majority).some(Boolean);
    if (!flag) changed = Math.min(changed, STRUCTURAL_AREA_MAX - 0.5);

    const alignment_ok = !(flagged && chance(0.25));
    const o = {
      status: "ok",
      src: out.src,
      heatmap: heatmapSvg(m.id, wf.id, out.w, out.h, clamp(changed / 20, 0.05, 1)),
      thumb: out.thumb,
      w: out.w,
      h: out.h,
      latency_s: rd(latency, 2),
      gpu_s: gpu === null ? null : rd(gpu, 3),
      cost_usd: rd(cost, 5),
      metrics: om,
      fixed_defects: fixed,
      remaining_defects: remaining,
      new_defects: newDefects,
      fidelity: {
        flag,
        flag_reasons: reasons,
        structural: rd(structural, 3),
        changed_area_pct: rd(changed, 2),
        semantic: rd(flagged ? between(sim.sem[0] - 0.08, sim.sem[0] + 0.02) : between(...sim.sem), 3),
        alignment_ok,
        framing_kept_pct: rd(alignment_ok ? between(...sim.frame) : between(70, 85), 1),
        checklist_majority: j.majority,
      },
      judges: j.verdicts,
      ensemble: j.ensemble,
    };
    if (wf.id === "F1") o.ops = rec?.meta?.ops ?? { white_balance: { wb_gains_bgr: [1.02, 1, 0.97] } };
    if (m.kind === "degraded") {
      const [p, s, l] = FULL_REF[wf.id];
      o.full_ref = { psnr: rd(gauss(p, 1.2), 2), ssim: rd(clamp(gauss(s, 0.03), 0.3, 0.98), 3), lpips: rd(clamp(gauss(l, 0.03), 0.05, 0.6), 3) };
    } else o.full_ref = null;
    o.iqa = { musiq: rd(gauss(MUSIQ[wf.id], 3.5), 1), topiq: rd(clamp(gauss(MUSIQ[wf.id] / 100, 0.04), 0.2, 0.95), 3) };
    outputs[wf.id] = o;
  }
  images.push({
    id: m.id,
    kind: m.kind,
    note: m.note,
    source_url: m.listing_url,
    input: { src: input.src, thumb: input.thumb, w: input.w, h: input.h, metrics, defects },
    ground_truth: ground_truth ? { src: ground_truth.src, thumb: ground_truth.thumb, w: ground_truth.w, h: ground_truth.h } : null,
    degradation: m.degradation
      ? Object.fromEntries(
          Object.entries(m.degradation)
            .filter(([k]) => k !== "crop_box_in_original")
            .map(([k, v]) => [k, typeof v === "number" ? rd(v, 3) : v]),
        )
      : null,
    outputs,
    router: { chosen: "F1", reason: "", fallback: null }, // filled below
  });
}

// ---------------------------------------------------------------- workflow summaries
function bootstrapCI(values, iters = 2000) {
  if (!values.length) return [0, 0];
  const means = [];
  for (let i = 0; i < iters; i++) {
    let s = 0;
    for (let k = 0; k < values.length; k++) s += values[Math.floor(rand() * values.length)];
    means.push(s / values.length);
  }
  return [rd(quantile(means, 0.025), 3), rd(quantile(means, 0.975), 3)];
}

const GATES = { reliability_min: 0.9, fidelity_flag_max: 0.1 };
const WEIGHTS = { quality: 0.5, naturalness: 0.2, cost: 0.15, speed: 0.15 };

const workflows = WORKFLOWS.map((wf) => {
  const all = images.map((im) => im.outputs[wf.id]).filter(Boolean);
  const ok = all.filter((o) => o.status === "ok");
  const okImgs = images.filter((im) => im.outputs[wf.id]?.status === "ok");
  const lat = ok.map((o) => o.latency_s);
  const gpu = ok.map((o) => o.gpu_s).filter((g) => typeof g === "number" && g > 0);
  const costs = ok.map((o) => o.cost_usd);
  const wins = ok.map((o) => o.ensemble.win);
  const rubric = {};
  for (const k of Object.keys(ok[0].ensemble.rubric_mean)) rubric[k] = rd(mean(ok.map((o) => o.ensemble.rubric_mean[k])), 2);
  const nDef = okImgs.reduce((a, im) => a + im.input.defects.length, 0);
  const nFixed = ok.reduce((a, o) => a + o.fixed_defects.length, 0);
  const flags = ok.filter((o) => o.fidelity.flag);
  const breakdown = {};
  for (const k of CHECKLIST_KEYS) {
    const n = ok.filter((o) => o.fidelity.checklist_majority[k]).length;
    if (n) breakdown[k] = rd(n / ok.length, 3);
  }
  const nStruct = ok.filter((o) => o.fidelity.changed_area_pct > STRUCTURAL_AREA_MAX).length;
  if (nStruct) breakdown.strutturale = rd(nStruct / ok.length, 3);
  const fr = ok.filter((o) => o.full_ref);
  const success_rate = rd(ok.length / all.length, 3);
  const fidelity_flag_rate = rd(flags.length / ok.length, 3);
  return {
    id: wf.id,
    name: wf.name,
    short: wf.short,
    engine: wf.engine,
    family: wf.family,
    generative: wf.generative,
    description: wf.description,
    question: wf.question,
    prompt: wf.prompt,
    summary: {
      success_rate,
      n_ok: ok.length,
      n_total: all.length,
      latency_p50_s: rd(quantile(lat, 0.5), 2),
      latency_p90_s: rd(quantile(lat, 0.9), 2),
      gpu_s_p50: gpu.length ? rd(quantile(gpu, 0.5), 2) : null,
      cost_usd_per_image: rd(mean(costs), 5),
      cost_range: wf.cost_range ?? [rd(Math.min(...costs), 5), rd(Math.max(...costs), 5)],
      cost_note: wf.cost_note,
      quality_winrate: rd(mean(wins), 3),
      quality_winrate_ci: bootstrapCI(wins),
      rubric,
      defect_fix_rate: rd(nDef ? nFixed / nDef : 0, 3),
      new_defect_rate: rd(ok.filter((o) => o.new_defects.length).length / ok.length, 3),
      fidelity_flag_rate,
      fidelity_flag_breakdown: breakdown,
      structural_mean: rd(mean(ok.map((o) => o.fidelity.structural)), 3),
      full_ref: fr.length
        ? {
            psnr: rd(mean(fr.map((o) => o.full_ref.psnr)), 2),
            ssim: rd(mean(fr.map((o) => o.full_ref.ssim)), 3),
            lpips: rd(mean(fr.map((o) => o.full_ref.lpips)), 3),
          }
        : null,
      iqa_musiq: rd(mean(ok.map((o) => o.iqa.musiq)), 1),
      gates: { reliability: success_rate >= GATES.reliability_min, fidelity: fidelity_flag_rate <= GATES.fidelity_flag_max },
      score: null,
      rank: null,
    },
  };
});

const scores = computeScores(scoreInputsFromWorkflows(workflows), WEIGHTS);
for (const s of scores) {
  const wf = workflows.find((w) => w.id === s.id);
  wf.summary.score = s.score === null ? null : rd(s.score, 4);
  wf.summary.rank = s.rank;
}
const ranked = workflows.filter((w) => w.summary.rank !== null).sort((a, b) => a.summary.rank - b.summary.rank);
const winner = ranked[0]?.id ?? null;
const passing = ranked.map((w) => w.id);
const W = Object.fromEntries(workflows.map((w) => [w.id, w]));

// ---------------------------------------------------------------- router (per image)
const okClean = (im, id) => im.outputs[id]?.status === "ok" && !im.outputs[id].fidelity.flag;
const list = (ds) => ds.map((d) => DEFECT_LABEL[d]).join(", ");
for (const im of images) {
  const d = im.input.defects;
  const detail = d.filter((x) => ["sfocata", "rumorosa", "bassa_risoluzione"].includes(x));
  let chosen;
  let reason;
  if (im.input.metrics.clip_high_pct > 15) {
    im.router = {
      chosen: "reshoot",
      reason: `Controluce: il ${numIt(im.input.metrics.clip_high_pct)}% dei pixel è bruciato (finestra). Recuperarlo significherebbe inventare la vista: meglio un nuovo scatto (HDR o luce diversa). Intanto è disponibile una correzione deterministica.`,
      fallback: okClean(im, "F1") ? "F1" : null,
    };
    continue;
  }
  if (!d.length) {
    chosen = "F1";
    reason = "Nessun difetto fuori obiettivo: basta una rifinitura leggera e deterministica.";
  } else if (!detail.length && passing.includes("F1")) {
    chosen = "F1";
    reason = `Solo difetti globali (${list(d)}): la correzione deterministica li porta in obiettivo senza generare pixel, con rischio di alterazione nullo.`;
  } else if (detail.length && passing.includes("F4")) {
    chosen = "F4";
    reason = `Serve ricostruire dettaglio (${list(detail)}): ${W.F4.name} supera entrambi i gate ed è il generativo più economico.`;
  } else {
    chosen = winner ?? "F1";
    reason = `Difetti misti (${list(d)}): si usa il workflow vincitore della valutazione.`;
  }
  if (!okClean(im, chosen)) {
    const alt = ["F1", "F4"].filter((id) => id !== chosen && passing.includes(id)).find((id) => okClean(im, id)) ?? "F1";
    reason += ` Su questa foto ${chosen} ha un flag di fedeltà: si passa a ${alt}.`;
    chosen = alt;
  }
  const fallback = chosen === "F1" ? (okClean(im, "F4") ? "F4" : null) : okClean(im, "F1") ? "F1" : null;
  im.router = { chosen, reason, fallback };
}

// ---------------------------------------------------------------- decision block
function fixRate(wfId, defect) {
  const rel = images.filter((im) => im.input.defects.includes(defect) && im.outputs[wfId]?.status === "ok");
  if (!rel.length) return null;
  return rel.filter((im) => im.outputs[wfId].fixed_defects.includes(defect)).length / rel.length;
}
const per_defect_winner = {};
for (const defect of Object.keys(DEFECT_METRIC)) {
  let best = null;
  for (const id of passing) {
    const r = fixRate(id, defect);
    if (r !== null && (best === null || r > best.r)) best = { id, r };
  }
  if (best) per_defect_winner[defect] = best.id;
}
const S = (id) => W[id].summary;
const excluded = workflows.filter((w) => w.summary.rank === null);
const exclText = excluded
  .map((w) => {
    const why = [];
    if (!w.summary.gates.fidelity) why.push(`flag di fedeltà ${pctIt(w.summary.fidelity_flag_rate)}`);
    if (!w.summary.gates.reliability) why.push(`successo ${pctIt(w.summary.success_rate)}`);
    return `${w.id} (${why.join(", ")})`;
  })
  .join(", ");
const rationale = winner
  ? `${W[winner].name} (${winner}) ha il punteggio più alto (${numIt(S(winner).score, 2)}) tra i workflow che superano entrambi i gate: preferito all'originale nel ${pctIt(S(winner).quality_winrate)} dei confronti, flag di fedeltà ${pctIt(S(winner).fidelity_flag_rate)}, costo stimato ${usdIt(S(winner).cost_usd_per_image)} per foto. Esclusi dai gate: ${exclText}. Il router usa comunque F1 quando i difetti sono solo globali.`
  : "Nessun workflow supera entrambi i gate.";
const pairwise_questions = [
  {
    pair: ["F2", "F3"],
    question: "Quanto conta il prompt?",
    answer: `Molto, sulla fedeltà: il prompt vincolato porta i flag dal ${pctIt(S("F2").fidelity_flag_rate)} al ${pctIt(S("F3").fidelity_flag_rate)} con una qualità percepita simile (win-rate ${pctIt(S("F2").quality_winrate)} contro ${pctIt(S("F3").quality_winrate)}). "Rendila bella" invita il modello a ristrutturare la casa.`,
  },
  {
    pair: ["F3", "F4"],
    question: "Modello chiuso o open-weights self-hosted?",
    answer: `F3 è preferito più spesso (${pctIt(S("F3").quality_winrate)} contro ${pctIt(S("F4").quality_winrate)}), ma F4 costa circa ${Math.round(S("F3").cost_usd_per_image / S("F4").cost_usd_per_image)} volte meno, risponde in ${Math.round(S("F4").latency_p50_s)} s invece di ${Math.round(S("F3").latency_p50_s)} s e ha meno flag (${pctIt(S("F4").fidelity_flag_rate)} contro ${pctIt(S("F3").fidelity_flag_rate)}).`,
  },
  {
    pair: ["F3", "F6"],
    question: "OpenAI o Google a parità di prompt?",
    answer: `Qualità simile (${pctIt(S("F3").quality_winrate)} contro ${pctIt(S("F6").quality_winrate)}); F6 costa meno (${usdIt(S("F6").cost_usd_per_image)}) ed è più rapido, ma altera di più (${pctIt(S("F6").fidelity_flag_rate)} di flag) e fallisce il ${pctIt(1 - S("F6").success_rate)} delle richieste (filtri, quote, timeout).`,
  },
  {
    pair: ["F1", "F4"],
    question: "Quando serve davvero un modello generativo?",
    answer: `Per esposizione, colore e verticali F1 basta (verticali corrette nel ${pctIt(fixRate("F1", "storta") ?? 0)} dei casi). Sulla nitidezza F4 porta in obiettivo il ${pctIt(fixRate("F4", "sfocata") ?? 0)} delle foto contro il ${pctIt(fixRate("F1", "sfocata") ?? 0)} di F1: qui il generativo si guadagna il suo costo.`,
  },
];

// ---------------------------------------------------------------- judges meta-validation (computed from verdicts)
const allOutputs = images.flatMap((im) => Object.entries(im.outputs).filter(([, o]) => o.status === "ok").map(([wfId, o]) => ({ wfId, o })));
function krippendorffNominal(units) {
  const cats = ["output", "input", "tie"];
  const o = Object.fromEntries(cats.map((c) => [c, Object.fromEntries(cats.map((k) => [k, 0]))]));
  for (const vals of units) {
    const m = vals.length;
    if (m < 2) continue;
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (i !== j) o[vals[i]][vals[j]] += 1 / (m - 1);
  }
  const nc = Object.fromEntries(cats.map((c) => [c, cats.reduce((a, k) => a + o[c][k], 0)]));
  const n = cats.reduce((a, c) => a + nc[c], 0);
  let Do = 0;
  let De = 0;
  for (const c of cats) for (const k of cats) if (c !== k) {
    Do += o[c][k];
    De += nc[c] * nc[k];
  }
  return De ? 1 - ((n - 1) * Do) / De : 1;
}
const alpha = krippendorffNominal(allOutputs.map(({ o }) => o.judges.map((v) => v.preferred)));
const pairwise_agreement = {};
for (let a = 0; a < JUDGES.length; a++)
  for (let b = a + 1; b < JUDGES.length; b++) {
    const ja = JUDGES[a].id;
    const jb = JUDGES[b].id;
    const same = allOutputs.filter(({ o }) => o.judges.find((v) => v.judge === ja).preferred === o.judges.find((v) => v.judge === jb).preferred).length;
    pairwise_agreement[`${ja}-${jb}`] = rd(same / allOutputs.length, 3);
  }
const position_consistency = Object.fromEntries(
  JUDGES.map((j) => [j.id, rd(mean(allOutputs.map(({ o }) => (o.judges.find((v) => v.judge === j.id).position_consistent ? 1 : 0))), 3)]),
);
const self_preference = [];
for (const j of JUDGES) {
  const own = allOutputs.filter(({ wfId }) => WF[wfId].family === j.family);
  if (!own.length) continue;
  const prefScore = (v) => (v.preferred === "output" ? 1 : v.preferred === "tie" ? 0.5 : 0);
  self_preference.push({
    judge: j.id,
    own_family_winrate: rd(mean(own.map(({ o }) => prefScore(o.judges.find((v) => v.judge === j.id)))), 3),
    others_winrate: rd(mean(own.flatMap(({ o }) => o.judges.filter((v) => v.judge !== j.id && JUDGES.find((x) => x.id === v.judge).family !== j.family).map(prefScore))), 3),
  });
}

// ---------------------------------------------------------------- traps (planted alterations + controls)
const TRAP_DEFS = [
  { type: "Oggetto rimosso", description: "Quadro rimosso dalla parete di fondo", alt: true, img: "R01" },
  { type: "Oggetto aggiunto", description: "Pianta aggiunta accanto al divano", alt: true, img: "R06" },
  { type: "Vista cambiata", description: "Panorama inventato dietro la finestra", alt: true, img: "R17" },
  { type: "Materiale cambiato", description: "Parquet sostituito da piastrelle chiare", alt: true, img: "R11" },
  { type: "Difetto nascosto", description: "Macchia di umidità cancellata dal soffitto", alt: true, img: "R16" },
  { type: "Difetto nascosto", description: "Crepa sull'intonaco eliminata", alt: true, img: "R12" },
  { type: "Geometria alterata", description: "Stanza allungata del 10% in profondità", alt: true, img: "R02" },
  { type: "Testo alterato", description: "Filigrana dell'agenzia modificata", alt: true, img: "R08" },
  { type: "Controllo: esposizione", description: "Solo +0,7 EV, nessuna modifica al contenuto", alt: false, img: "R05" },
  { type: "Controllo: colore", description: "Solo bilanciamento del bianco", alt: false, img: "R03" },
  { type: "Controllo: geometria", description: "Solo raddrizzamento di 2°", alt: false, img: "R09" },
  { type: "Controllo: rumore", description: "Solo riduzione del rumore", alt: false, img: "D02" },
];
const DETECTORS = [
  { id: "structural", name: "Differenza strutturale (gradient-SSIM allineato)" },
  { id: "semantic", name: "Similarità semantica (DINOv2)" },
  { id: "checklist", name: "Checklist dei giudici (maggioranza)" },
  { id: "combined", name: "Regola finale (strutturale OR checklist)" },
];
const DETECT_P = {
  "Oggetto rimosso": { structural: 0.9, semantic: 0.3, checklist: 0.9 },
  "Oggetto aggiunto": { structural: 0.9, semantic: 0.5, checklist: 0.95 },
  "Vista cambiata": { structural: 0.7, semantic: 0.4, checklist: 0.9 },
  "Materiale cambiato": { structural: 0.3, semantic: 0.5, checklist: 0.8 },
  "Difetto nascosto": { structural: 0.35, semantic: 0.1, checklist: 0.55 },
  "Geometria alterata": { structural: 0.95, semantic: 0.2, checklist: 0.4 },
  "Testo alterato": { structural: 0.6, semantic: 0.05, checklist: 0.7 },
  control: { structural: 0.12, semantic: 0.1, checklist: 0.08 },
};
const trapItems = TRAP_DEFS.map((t, i) => {
  const im = images.find((x) => x.id === t.img) ?? images[i];
  const p = DETECT_P[t.alt ? t.type : "control"];
  const detected = ["structural", "semantic", "checklist"].filter((d) => chance(p[d]));
  if (detected.includes("structural") || detected.includes("checklist")) detected.push("combined");
  const altOut = t.alt ? (im.outputs.F2?.src ?? im.outputs.F3?.src) : im.outputs.F1?.src;
  return {
    id: `T${String(i + 1).padStart(2, "0")}`,
    type: t.type,
    description: t.description,
    original: im.input.src,
    altered: altOut ?? im.input.src,
    is_alteration: t.alt,
    detected_by: detected,
  };
});
const detectors = DETECTORS.map((d) => {
  const tp = trapItems.filter((t) => t.is_alteration && t.detected_by.includes(d.id)).length;
  const fp = trapItems.filter((t) => !t.is_alteration && t.detected_by.includes(d.id)).length;
  const fn = trapItems.filter((t) => t.is_alteration && !t.detected_by.includes(d.id)).length;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { ...d, precision: rd(precision, 3), recall: rd(recall, 3), f1: rd(f1, 3) };
});

// ---------------------------------------------------------------- write results.json
const results = {
  generated_at: new Date().toISOString(),
  is_mock: true,
  dataset: {
    n_real: images.filter((i) => i.kind === "real").length,
    n_degraded: images.filter((i) => i.kind === "degraded").length,
    source: "Foto pubbliche di annunci Immobiliare.it (settembre 2026)",
    notes:
      "Foto reali scelte per difetti tipici da smartphone; foto buone degradate artificialmente (esposizione, dominante, inclinazione, rumore, risoluzione) per avere un originale pulito di riferimento.",
  },
  workflows,
  decision: {
    declared_at: "2026-09-10T18:00:00+02:00",
    weights: WEIGHTS,
    gates: GATES,
    winner,
    rationale,
    per_defect_winner,
    pairwise_questions,
  },
  images,
  judges: {
    list: JUDGES,
    agreement: { krippendorff_alpha: rd(alpha, 3), pairwise_agreement },
    position_consistency,
    gt_accuracy: { gpt: 1, gemini: 1, gemma: 0.833, qwen: 0.833 },
    self_preference,
  },
  traps: { n: trapItems.length, detectors, items: trapItems },
  rubric_definition: {
    esposizione: {
      label: "Esposizione",
      anchors: {
        1: "Molto buia o bruciata: dettagli persi in ombre o luci",
        3: "Leggermente scura o chiara, dettagli leggibili",
        5: "Luce equilibrata, ombre e alte luci con dettaglio",
      },
    },
    colore: {
      label: "Colore",
      anchors: {
        1: "Dominante forte (gialla, verde, blu) su pareti e soffitti",
        3: "Leggera dominante, bianchi quasi neutri",
        5: "Bianchi neutri, colori naturali e credibili",
      },
    },
    geometria: {
      label: "Geometria",
      anchors: {
        1: "Verticali visibilmente inclinate o convergenti",
        3: "Leggera inclinazione percepibile",
        5: "Verticali dritte, prospettiva corretta",
      },
    },
    nitidezza: {
      label: "Nitidezza",
      anchors: {
        1: "Sfocata o molto rumorosa, dettagli impastati",
        3: "Accettabile a schermo, rumore o morbidezza visibili",
        5: "Nitida e pulita, dettagli fini leggibili",
      },
    },
    naturalezza: {
      label: "Naturalezza",
      anchors: {
        1: "Aspetto artificiale: plastica, HDR eccessivo, artefatti",
        3: "Qualche segno di elaborazione",
        5: "Sembra una foto scattata bene, nessun artefatto",
      },
    },
    attrattivita: {
      label: "Attrattività",
      anchors: { 1: "Scoraggia la visita", 3: "Neutra", 5: "Invoglia a visitare la casa" },
    },
  },
  real_vs_simulated: [
    { item: "Foto di input", status: "reale", note: "Foto pubbliche di annunci, scelte per i difetti tipici" },
    { item: "Foto degradate con riferimento", status: "simulato", note: "Degradazione sintetica di foto buone: abilita metriche con riferimento (PSNR, SSIM, LPIPS)" },
    { item: "Esecuzione dei workflow F1–F6", status: "reale", note: "Output generati davvero: API/abbonamenti per i modelli chiusi, H200 noleggiata per F4" },
    { item: "Costo per immagine", status: "stimato", note: "Listini pubblici e tempo GPU misurato; nessuno sconto di volume" },
    { item: "Giudizi dei modelli AI", status: "reale", note: "4 giudici di 3 famiglie, entrambe le posizioni A/B" },
    { item: "Arena con persone", status: "progettato", note: "Interfaccia pronta; nessun test con utenti reali" },
    { item: "Effetto su contatti e visite", status: "progettato", note: "Richiede un A/B test sugli annunci" },
    { item: "Caricamento di una foto nello Studio", status: "simulato", note: "Online mostra risultati precalcolati; l'elaborazione live gira solo in locale" },
  ],
  limits: [
    "Campione piccolo (24 foto): gli intervalli di confidenza sono ampi e differenze sotto i 10 punti non vanno lette come significative.",
    "I giudici sono modelli AI, non persone: la preferenza umana va verificata con l'arena e con un A/B test.",
    "Una sola esecuzione per foto e workflow: la variabilità dei modelli generativi è stimata solo in parte.",
    "Costi stimati da listini pubblici; volumi, sconti e GPU riservate cambierebbero il confronto.",
    "Le soglie delle metriche tecniche sono tarate su interni; esterni e planimetrie sono fuori perimetro.",
    "Le degradazioni sintetiche coprono i difetti principali ma non tutti (mosso, obiettivo sporco, distorsione).",
    "Latenze misurate da un solo client, in orari diversi e con code variabili dei provider.",
  ],
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "results.json"), JSON.stringify(results, null, 1));

// ---------------------------------------------------------------- report
const bytes = fs.statSync(path.join(OUT_DIR, "results.json")).size;
console.log(`MOCK results.json written (${(bytes / 1024).toFixed(0)} KB) → ${path.relative(WEB, OUT_DIR)}/`);
console.log(`images: ${images.length} · real outputs found: ${WORKFLOWS.map((w) => `${w.id}=${images.filter((im) => ["png", "webp", "jpg"].some((e) => fs.existsSync(path.join(RUNS, w.id, `${im.id}.${e}`)))).length}`).join(" ")}`);
console.log(`thumbnails: ${sipsOk ? "yes" : "no"}`);
for (const w of workflows) {
  const s = w.summary;
  console.log(
    `${w.id}  win ${pctIt(s.quality_winrate).padStart(4)}  flag ${pctIt(s.fidelity_flag_rate).padStart(4)}  ok ${s.n_ok}/${s.n_total}  gates ${s.gates.reliability ? "R" : "-"}${s.gates.fidelity ? "F" : "-"}  score ${s.score ?? "—"}  rank ${s.rank ?? "—"}`,
  );
}
console.log(`winner: ${winner}`);

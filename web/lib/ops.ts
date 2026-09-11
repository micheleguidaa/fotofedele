// Human-readable Italian description of the `ops` log written by deterministic steps (F1, F5).
import { fmtNum, fmtPct } from "./format";

export interface OpLine {
  title: string;
  detail?: string;
  skipped?: boolean;
}

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function straighten(v: Dict): OpLine {
  const rot = num(v.rotated_deg);
  const key = num(v.keystone_corrected);
  const crop = num(v.crop_fraction);
  const parts: string[] = [];
  if (rot !== null) parts.push(Math.abs(rot) < 0.05 ? "nessuna rotazione necessaria" : `rotazione di ${fmtNum(Math.abs(rot), 2)}°`);
  if (key !== null && Math.abs(key) > 0.5) parts.push("verticali convergenti corrette");
  if (crop !== null && crop > 0) parts.push(`ritaglio dei bordi ${fmtPct(crop, 1)}`);
  return { title: "Raddrizzamento delle verticali", detail: parts.join(" · ") || undefined };
}

function whiteBalance(v: Dict): OpLine {
  const g = Array.isArray(v.wb_gains_bgr) ? (v.wb_gains_bgr as unknown[]).map(num) : [];
  if (g.length === 3 && g.every((x) => x !== null)) {
    const [b, gg, r] = g as number[];
    return {
      title: "Bilanciamento del bianco sui pixel neutri",
      detail: `guadagni R ×${fmtNum(r, 2)} · G ×${fmtNum(gg, 2)} · B ×${fmtNum(b, 2)}`,
    };
  }
  return { title: "Bilanciamento del bianco sui pixel neutri" };
}

function exposure(v: Dict): OpLine {
  const med = num(v.median_L_before);
  const gamma = num(v.gamma);
  const clahe = num(v.clahe_clip);
  const parts: string[] = [];
  if (med !== null) parts.push(`luminosità mediana di partenza ${fmtNum(med, 0)}`);
  if (gamma !== null) parts.push(`${gamma < 1 ? "schiarita" : gamma > 1 ? "scurita" : "curva neutra"} (gamma ${fmtNum(gamma, 2)})`);
  if (clahe !== null) parts.push(`contrasto locale CLAHE ${fmtNum(clahe, 1)}`);
  return { title: "Correzione dell'esposizione", detail: parts.join(" · ") || undefined };
}

function describe(key: string, value: unknown): OpLine | null {
  if (key === "straighten" && isDict(value)) return straighten(value);
  if (key === "white_balance" && isDict(value)) return whiteBalance(value);
  if (key === "exposure" && isDict(value)) return exposure(value);
  if (key === "denoise" && isDict(value)) {
    const h = num(value.denoise_h);
    return h ? { title: "Riduzione del rumore", detail: `intensità ${fmtNum(h, 1)}` } : { title: "Riduzione del rumore", detail: "non necessaria", skipped: true };
  }
  if (key === "super_resolution" && isDict(value)) {
    const mp = num(value.from_mp);
    return {
      title: "Super-risoluzione",
      detail: `${typeof value.model === "string" ? value.model : "modello di upscaling"}${mp !== null ? ` da ${fmtNum(mp, 2)} MP` : ""}`,
    };
  }
  if (key === "sharpen" && isDict(value)) {
    const a = num(value.amount);
    return { title: "Maschera di contrasto (nitidezza)", detail: a !== null ? `intensità ${fmtPct(a)}` : undefined };
  }
  if (key === "alignment" && isDict(value)) {
    const ecc = num(value.ecc);
    const valid = num(value.valid_fraction);
    return {
      title: "Allineamento con l'immagine di riferimento",
      detail: [ecc !== null ? `correlazione ECC ${fmtNum(ecc, 2)}` : null, valid !== null ? `${fmtPct(valid)} dei pixel sovrapposti` : null]
        .filter(Boolean)
        .join(" · ") || undefined,
    };
  }
  if (key === "agreeing_pixels") {
    const a = num(value);
    return { title: "Pixel con struttura concordante usati per la stima", detail: a !== null ? fmtPct(a) : undefined };
  }
  if (key === "warning" && typeof value === "string") {
    return { title: "Avviso", detail: value === "low structural agreement, fitted on all aligned pixels" ? "riferimento poco concordante: stima su tutti i pixel allineati" : value };
  }
  if (key === "tone_curve" && isDict(value)) {
    const pts = ["in_0.25", "in_0.5", "in_0.75"]
      .map((k) => [k.slice(3), num(value[k])] as const)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => `${fmtNum(Number(k), 2)}→${fmtNum(v as number, 2)}`);
    return { title: "Curva tonale copiata dal riferimento", detail: pts.join(" · ") || undefined };
  }
  if (key === "color_matrix" && Array.isArray(value)) {
    const flat = (value as unknown[]).flat().map(num).filter((x): x is number => x !== null);
    const dev = flat.length === 9 ? Math.max(...flat.map((x, i) => Math.abs(x - (i % 4 === 0 ? 1 : 0)))) : null;
    return { title: "Matrice colore 3×3 copiata dal riferimento", detail: dev !== null ? `scostamento massimo dall'identità ${fmtNum(dev, 2)}` : undefined };
  }
  if (key === "gain_map" && isDict(value)) {
    const lo = num(value.min);
    const hi = num(value.max);
    return {
      title: "Schiarita/scurita locale a bassa frequenza",
      detail: lo !== null && hi !== null ? `guadagno tra ×${fmtNum(lo, 2)} e ×${fmtNum(hi, 2)}` : undefined,
    };
  }
  return null;
}

export function describeOps(ops: Record<string, unknown> | undefined | null): OpLine[] {
  if (!ops) return [];
  const lines: OpLine[] = [];
  for (const [key, value] of Object.entries(ops)) {
    const d = describe(key, value);
    if (d) lines.push(d);
    else {
      const text = typeof value === "object" ? JSON.stringify(value) : String(value);
      lines.push({ title: key.replaceAll("_", " "), detail: text.length > 90 ? `${text.slice(0, 87)}…` : text });
    }
  }
  return lines;
}

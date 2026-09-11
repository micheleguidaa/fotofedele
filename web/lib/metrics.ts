// Target ranges for the technical metrics (mirror of pipeline/fotolab/metrics/technical.py TARGETS).
import type { Defect, TechMetrics } from "./types";

export type MetricKey = "exposure_L" | "clip_high_pct" | "cast" | "tilt_deg" | "sharpness" | "noise_sigma" | "megapixels";

export interface MetricSpec {
  key: MetricKey;
  label: string;
  short: string;
  unit: string;
  min?: number;
  max?: number;
  digits: number;
  how: string; // how it is measured (Italian)
}

export const METRICS: MetricSpec[] = [
  {
    key: "exposure_L",
    label: "Esposizione (L* medio)",
    short: "Esposizione",
    unit: "",
    min: 52,
    max: 72,
    digits: 0,
    how: "Luminosità media nello spazio Lab, 0–100",
  },
  {
    key: "clip_high_pct",
    label: "Alte luci bruciate",
    short: "Alte luci",
    unit: "%",
    max: 6,
    digits: 1,
    how: "Quota di pixel con L* > 98",
  },
  {
    key: "cast",
    label: "Dominante di colore",
    short: "Dominante",
    unit: "",
    max: 4,
    digits: 1,
    how: "Scostamento dal neutro dei pixel grigi/bianchi (unità Lab)",
  },
  {
    key: "tilt_deg",
    label: "Inclinazione delle verticali",
    short: "Inclinazione",
    unit: "°",
    max: 0.75,
    digits: 2,
    how: "Mediana dell'angolo delle linee quasi verticali",
  },
  {
    key: "sharpness",
    label: "Nitidezza",
    short: "Nitidezza",
    unit: "",
    min: 120,
    digits: 0,
    how: "Varianza del Laplaciano a 1024 px di larghezza",
  },
  {
    key: "noise_sigma",
    label: "Rumore (σ stimato)",
    short: "Rumore",
    unit: "",
    max: 2.5,
    digits: 1,
    how: "Deviazione standard del rumore stimata sui livelli di grigio",
  },
  {
    key: "megapixels",
    label: "Risoluzione",
    short: "Risoluzione",
    unit: " MP",
    min: 1,
    digits: 2,
    how: "Larghezza × altezza in milioni di pixel",
  },
];

export const METRIC_BY_KEY = Object.fromEntries(METRICS.map((m) => [m.key, m])) as Record<MetricKey, MetricSpec>;

export const DEFECT_METRIC: Record<Defect, MetricKey> = {
  buia: "exposure_L",
  sovraesposta: "clip_high_pct",
  dominante: "cast",
  storta: "tilt_deg",
  sfocata: "sharpness",
  rumorosa: "noise_sigma",
  bassa_risoluzione: "megapixels",
};

export const DEFECT_ORDER: Defect[] = [
  "buia",
  "sovraesposta",
  "dominante",
  "storta",
  "sfocata",
  "rumorosa",
  "bassa_risoluzione",
];

export function inTarget(key: MetricKey, value: number | null | undefined): boolean | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const spec = METRIC_BY_KEY[key];
  if (spec.min !== undefined && value < spec.min) return false;
  if (spec.max !== undefined && value > spec.max) return false;
  return true;
}

const it = (v: number, d: number) =>
  new Intl.NumberFormat("it-IT", { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);

export function formatMetric(key: MetricKey, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const spec = METRIC_BY_KEY[key];
  return `${it(value, spec.digits)}${spec.unit}`;
}

const itMax2 = (v: number) => new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(v);

export function targetLabel(key: MetricKey): string {
  const s = METRIC_BY_KEY[key];
  const f = (v: number) => `${itMax2(v)}${s.unit}`;
  if (s.min !== undefined && s.max !== undefined) return `${it(s.min, 0)}–${f(s.max)}`;
  if (s.min !== undefined) return `≥ ${f(s.min)}`;
  if (s.max !== undefined) return `≤ ${f(s.max)}`;
  return "—";
}

export function metricValue(m: TechMetrics | undefined | null, key: MetricKey): number | null {
  if (!m) return null;
  const v = m[key];
  return typeof v === "number" ? v : null;
}

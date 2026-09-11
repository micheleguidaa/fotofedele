// Italian number formatting helpers (safe on server and client: Node ships full ICU).

const cache = new Map<string, Intl.NumberFormat>();
function nf(min: number, max: number): Intl.NumberFormat {
  const k = `${min}:${max}`;
  let f = cache.get(k);
  if (!f) {
    f = new Intl.NumberFormat("it-IT", { minimumFractionDigits: min, maximumFractionDigits: max });
    cache.set(k, f);
  }
  return f;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function fmtNum(v: number | null | undefined, digits = 1): string {
  return isNum(v) ? nf(digits, digits).format(v) : "—";
}

/** Share 0..1 → "42%". */
export function fmtPct(v: number | null | undefined, digits = 0): string {
  return isNum(v) ? `${nf(digits, digits).format(v * 100)}%` : "—";
}

/** Value already in percent → "4,2%". */
export function fmtPctRaw(v: number | null | undefined, digits = 1): string {
  return isNum(v) ? `${nf(digits, digits).format(v)}%` : "—";
}

/** Estimated cost in USD, Italian style: "0,165 $", "0,0002 $". */
export function fmtUsd(v: number | null | undefined): string {
  if (!isNum(v)) return "—";
  if (v === 0) return "0 $";
  const digits = v >= 1 ? 2 : v >= 0.01 ? 3 : v >= 0.001 ? 4 : 5;
  const s = nf(0, digits).format(Number(v.toPrecision(3)));
  return `${s} $`;
}

export function fmtSeconds(v: number | null | undefined): string {
  if (!isNum(v)) return "—";
  if (v < 10) return `${nf(1, 1).format(v)} s`;
  if (v < 120) return `${Math.round(v)} s`;
  return `${nf(1, 1).format(v / 60)} min`;
}

export function fmtScore(v: number | null | undefined): string {
  return isNum(v) ? nf(2, 2).format(v) : "—";
}

export function fmtRubric(v: number | null | undefined): string {
  return isNum(v) ? nf(1, 1).format(v) : "—";
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Rome" }).format(d);
}

/** Date preceded by the Italian article: "il 10 settembre 2026", "l'11 settembre 2026", "il 1° settembre 2026". */
export function fmtDateWithArticle(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = Number(new Intl.DateTimeFormat("it-IT", { day: "numeric", timeZone: "Europe/Rome" }).format(d));
  const text = fmtDate(iso);
  if (day === 1) return `il ${text.replace(/^1 /, "1° ")}`;
  return day === 8 || day === 11 ? `l'${text}` : `il ${text}`;
}

/** Path from results.json ("images/R01/F3.webp") → public URL ("/data/images/R01/F3.webp"). */
export function dataSrc(src: string | null | undefined): string | undefined {
  if (!src) return undefined;
  if (/^(data:|blob:|https?:|\/)/.test(src)) return src;
  return `/data/${src}`;
}

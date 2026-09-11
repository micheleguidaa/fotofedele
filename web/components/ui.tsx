// Small presentational primitives shared by all pages (server-safe: no hooks).
import Link from "next/link";
import type { ReactNode } from "react";

import { DEFECT_LABEL } from "@/lib/labels";
import type { Defect } from "@/lib/types";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mx-auto w-full max-w-6xl px-4 sm:px-6", className)}>{children}</div>;
}

export function PageHeader({ eyebrow, title, lead, children }: { eyebrow?: string; title: ReactNode; lead?: ReactNode; children?: ReactNode }) {
  return (
    <div className="border-b border-line bg-surface">
      <Container className="py-10 sm:py-14">
        {eyebrow && <p className="text-sm font-semibold tracking-wide text-accent">{eyebrow}</p>}
        <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h1>
        {lead && <div className="mt-4 max-w-3xl text-base leading-relaxed text-muted sm:text-lg">{lead}</div>}
        {children}
      </Container>
    </div>
  );
}

export function Section({
  id,
  title,
  lead,
  children,
  className,
  aside,
}: {
  id?: string;
  title?: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
  className?: string;
  aside?: ReactNode;
}) {
  return (
    <section id={id} className={cx("scroll-mt-20 py-10 sm:py-12", className)} aria-labelledby={id && title ? `${id}-title` : undefined}>
      {(title || aside) && (
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div className="max-w-3xl">
            {title && (
              <h2 id={id ? `${id}-title` : undefined} className="text-2xl font-semibold tracking-tight text-balance">
                {title}
              </h2>
            )}
            {lead && <div className="mt-2 leading-relaxed text-muted">{lead}</div>}
          </div>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function Card({ children, className, as: Tag = "div" }: { children: ReactNode; className?: string; as?: "div" | "article" | "li" }) {
  return <Tag className={cx("rounded-xl border border-line bg-surface p-5", className)}>{children}</Tag>;
}

type Tone = "neutral" | "accent" | "ok" | "warn" | "bad" | "muted";
const TONE: Record<Tone, string> = {
  neutral: "bg-subtle text-ink border-line",
  accent: "bg-accent-soft text-accent border-transparent",
  ok: "bg-ok-soft text-ok border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  bad: "bg-bad-soft text-bad border-transparent",
  muted: "bg-transparent text-muted border-line",
};

export function Pill({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONE[tone], className)}
    >
      {children}
    </span>
  );
}

export function WorkflowTag({ id, className }: { id: string; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex h-6 min-w-8 items-center justify-center rounded-md border border-line-strong bg-surface px-1.5 font-mono text-xs font-semibold text-ink",
        className,
      )}
    >
      {id}
    </span>
  );
}

export function GenerativeBadge({ generative }: { generative: boolean }) {
  return generative ? (
    <Pill tone="warn" title="Genera nuovi pixel: rischio di alterazione da verificare">
      Generativo
    </Pill>
  ) : (
    <Pill tone="neutral" title="Trasforma i pixel esistenti: non può inventare contenuti">
      Non generativo
    </Pill>
  );
}

export function DefectChip({ defect, children, tone = "warn" }: { defect: Defect; children?: ReactNode; tone?: Tone }) {
  return (
    <Pill tone={tone} className="py-1 text-[13px]">
      {DEFECT_LABEL[defect]}
      {children}
    </Pill>
  );
}

/** Tooltip shown on hover and keyboard focus; the text is also exposed to screen readers. */
export function Tip({ label, children, side = "top", className }: { label: ReactNode; children: ReactNode; side?: "top" | "bottom"; className?: string }) {
  return (
    <span className={cx("group relative inline-flex cursor-help items-center", className)} tabIndex={0}>
      {children}
      <span className="sr-only"> ({label})</span>
      <span
        aria-hidden="true"
        className={cx(
          "pointer-events-none absolute left-1/2 z-30 w-max max-w-64 -translate-x-1/2 rounded-md bg-ink px-2.5 py-1.5 text-left text-xs leading-snug font-normal whitespace-normal text-canvas opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus:opacity-100",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
        )}
      >
        {label}
      </span>
    </span>
  );
}

// ------------------------------------------------------------------ icons (decorative; pair with text)
type IconProps = { className?: string };
export function IconCheck({ className = "size-4" }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
    </svg>
  );
}
export function IconX({ className = "size-4" }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className={className} aria-hidden="true">
      <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
    </svg>
  );
}
export function IconAlert({ className = "size-4" }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M10 3.2l7.6 13.1H2.4L10 3.2z" />
      <path d="M10 8.2v3.6M10 14.2v.1" />
    </svg>
  );
}
export function IconArrowRight({ className = "size-4" }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M4 10h11M11 5.5l4.5 4.5-4.5 4.5" />
    </svg>
  );
}
export function IconExternal({ className = "size-3.5" }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M11 4h5v5M16 4l-7 7M14 11.5V16H4V6h4.5" />
    </svg>
  );
}
export function IconInfo({ className = "size-4" }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 9v5M10 6.3v.1" />
    </svg>
  );
}

/** ✓ / ✗ with an accessible label. */
export function PassMark({ pass, label }: { pass: boolean | null; label?: string }) {
  if (pass === null) return <span className="text-muted">—</span>;
  return pass ? (
    <span className="inline-flex items-center gap-1 text-ok">
      <IconCheck />
      <span className="sr-only">{label ?? "Superato"}</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-bad">
      <IconX />
      <span className="sr-only">{label ?? "Non superato"}</span>
    </span>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p>
      {sub && <p className="mt-2 text-sm leading-snug text-muted">{sub}</p>}
    </div>
  );
}

export function LinkButton({ href, children, variant = "primary", className }: { href: string; children: ReactNode; variant?: "primary" | "secondary"; className?: string }) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors",
        variant === "primary" ? "bg-accent text-on-accent hover:bg-accent-strong" : "border border-line-strong bg-surface text-ink hover:bg-subtle",
        className,
      )}
    >
      {children}
    </Link>
  );
}

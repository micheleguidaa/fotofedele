"use client";

import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { cx } from "./ui";

export interface SliderImage {
  src: string;
  alt: string;
  label?: string;
}

export interface CompareSliderProps {
  before: SliderImage;
  after: SliderImage;
  /** width / height of the frame (use the "before" image size). */
  aspect: number;
  /** Structural-change heatmap drawn over the "after" image (RGBA, transparent where unchanged). */
  overlay?: string | null;
  showOverlay?: boolean;
  /** Element pinned to the bottom-right corner of the "after" side (e.g. the AI label). */
  afterBadge?: ReactNode;
  initial?: number;
  eager?: boolean;
  className?: string;
  /** Max frame height, CSS length (default 72vh). */
  maxHeight?: string;
}

/**
 * Before/after comparison: drag anywhere (mouse, touch, pen), or focus the handle and use
 * ←/→ (Shift = 10%), Home/End, PageUp/PageDown.
 */
export function CompareSlider({
  before,
  after,
  aspect,
  overlay,
  showOverlay = false,
  afterBadge,
  initial = 50,
  eager = false,
  className,
  maxHeight = "72vh",
}: CompareSliderProps) {
  const [pos, setPos] = useState(initial);
  const frame = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const moveTo = useCallback((clientX: number) => {
    const el = frame.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    setPos(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    moveTo(e.clientX);
    handle.current?.focus({ preventScroll: true });
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) moveTo(e.clientX);
  };
  const stop = () => {
    dragging.current = false;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 2;
    let next: number | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = pos - step;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") next = pos + step;
    else if (e.key === "PageDown") next = pos - 10;
    else if (e.key === "PageUp") next = pos + 10;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = 100;
    if (next !== null) {
      e.preventDefault();
      setPos(Math.min(100, Math.max(0, next)));
    }
  };

  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 4 / 3;
  const loading = eager ? "eager" : "lazy";
  const beforeLabel = before.label ?? "Prima";
  const afterLabel = after.label ?? "Dopo";

  return (
    <div
      ref={frame}
      className={cx(
        "relative mx-auto w-full touch-pan-y overflow-hidden rounded-xl bg-subtle select-none",
        "cursor-ew-resize",
        className,
      )}
      style={{ aspectRatio: String(safeAspect), maxHeight, maxWidth: `calc(${maxHeight} * ${safeAspect})` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
    >
      <img
        src={after.src}
        alt={after.alt}
        loading={loading}
        decoding="async"
        draggable={false}
        className="absolute inset-0 h-full w-full object-contain"
      />
      {overlay && showOverlay && (
        <img
          src={overlay}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-80"
        />
      )}
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <img
          src={before.src}
          alt={before.alt}
          loading={loading}
          decoding="async"
          draggable={false}
          className="absolute inset-0 h-full w-full object-contain"
        />
      </div>

      <span
        className="pointer-events-none absolute top-2 left-2 rounded-md bg-black/65 px-2 py-0.5 text-xs font-medium text-white transition-opacity"
        style={{ opacity: pos < 12 ? 0 : 1 }}
      >
        {beforeLabel}
      </span>
      <span
        className="pointer-events-none absolute top-2 right-2 rounded-md bg-black/65 px-2 py-0.5 text-xs font-medium text-white transition-opacity"
        style={{ opacity: pos > 88 ? 0 : 1 }}
      >
        {afterLabel}
      </span>
      {afterBadge && <div className="pointer-events-none absolute right-2 bottom-2">{afterBadge}</div>}

      <div className="pointer-events-none absolute inset-y-0" style={{ left: `${pos}%` }}>
        <div className="absolute inset-y-0 -ml-px w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)]" />
      </div>
      <div
        ref={handle}
        role="slider"
        tabIndex={0}
        aria-label={`Confronto: ${beforeLabel} a sinistra, ${afterLabel} a destra`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos)}
        aria-valuetext={`${Math.round(pos)}% ${beforeLabel.toLowerCase()}`}
        onKeyDown={onKeyDown}
        className="absolute top-1/2 -mt-5 -ml-5 flex size-10 items-center justify-center rounded-full border-2 border-white bg-black/60 text-white shadow-lg focus-visible:outline-offset-4"
        style={{ left: `${pos}%` }}
      >
        <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M7.5 5.5 3 10l4.5 4.5M12.5 5.5 17 10l-4.5 4.5" />
        </svg>
      </div>
    </div>
  );
}

// Arena votes, persisted in localStorage (per browser). Exposed as an external store for
// useSyncExternalStore; falls back to memory when storage is unavailable (private mode, blocked).
import type { WorkflowId } from "./types";

export type Contender = "input" | WorkflowId;

export interface Vote {
  t: number; // epoch ms
  image: string;
  left: Contender;
  right: Contender;
  pref: "left" | "right" | "tie";
  asked: "left" | "right"; // side the fidelity question was about
  faithful: boolean | null; // null = "non so"
}

const KEY = "fotofedele.arena.v1";
const EMPTY: Vote[] = [];
const listeners = new Set<() => void>();
let memory: Vote[] | null = null;
let cacheRaw: string | null | undefined;
let cacheVotes: Vote[] = EMPTY;

const isVote = (v: unknown): v is Vote =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as Vote).image === "string" &&
  typeof (v as Vote).left === "string" &&
  typeof (v as Vote).right === "string" &&
  ["left", "right", "tie"].includes((v as Vote).pref);

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function getVotes(): Vote[] {
  if (memory) return memory;
  const raw = readRaw();
  if (raw === cacheRaw) return cacheVotes;
  cacheRaw = raw;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cacheVotes = Array.isArray(parsed) ? parsed.filter(isVote) : EMPTY;
  } catch {
    cacheVotes = EMPTY;
  }
  return cacheVotes;
}

export function getServerVotes(): Vote[] {
  return EMPTY;
}

export function subscribeVotes(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function emit() {
  listeners.forEach((l) => l());
}

export function addVote(v: Vote): void {
  const next = [...getVotes(), v];
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
    memory = null;
  } catch {
    memory = next;
  }
  emit();
}

export function clearVotes(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
  memory = memory ? [] : null;
  emit();
}

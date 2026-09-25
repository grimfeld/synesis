// The Delivery view's timer and text size (PLAN §23.10-11).
//
// Kept free of React so it is tested once (`test:unit`) — the
// `src/lib/board.ts` precedent. Time is passed in, never read here, so a test
// can say what "now" is.

/**
 * A stopwatch that can be paused. `startedAt` is set while it runs; what ran
 * before the last pause is in `banked`. `for` is the Composition it was
 * started for, so re-opening that Composition's view keeps it and opening
 * another's starts afresh.
 */
export interface TimerState {
  for: string | null;
  startedAt: number | null;
  banked: number;
}

export function newTimer(forId: string | null): TimerState {
  return { for: forId, startedAt: null, banked: 0 };
}

export function isRunning(t: TimerState): boolean {
  return t.startedAt !== null;
}

/** Milliseconds on the clock at `now`. */
export function elapsed(t: TimerState, now: number): number {
  return t.banked + (t.startedAt === null ? 0 : Math.max(0, now - t.startedAt));
}

export function start(t: TimerState, now: number): TimerState {
  return t.startedAt === null ? { ...t, startedAt: now } : t;
}

export function pause(t: TimerState, now: number): TimerState {
  return t.startedAt === null
    ? t
    : { ...t, startedAt: null, banked: elapsed(t, now) };
}

export function reset(t: TimerState): TimerState {
  return newTimer(t.for);
}

/** The last stretch before a talk's time is up, shown amber (§23.10). */
export const WARNING_MS = 2 * 60_000;

export type TimerPhase = "idle" | "running" | "warning" | "over";

export interface TimerDisplay {
  text: string;
  phase: TimerPhase;
}

/**
 * A Composition's `duration` Property as minutes, or null when it has none
 * worth counting down from. A number is what the schema declares; a numeric
 * string is what a hand-edited file may hold (ADR 0003), and is read the same.
 */
export function durationMinutes(v: unknown): number | null {
  const n =
    typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** `m:ss`, or `h:mm:ss` from an hour up. */
export function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * What the timer shows at `now`: a countdown from `minutes` when the talk has
 * a duration, overtime as `+m:ss` once it is spent, and time elapsed when it
 * has none.
 */
export function display(
  t: TimerState,
  now: number,
  minutes: number | null,
): TimerDisplay {
  const e = elapsed(t, now);
  const idle = !isRunning(t) && e === 0;
  if (minutes === null) {
    return { text: clock(e), phase: idle ? "idle" : "running" };
  }
  const left = minutes * 60_000 - e;
  if (left <= 0) {
    return { text: `+${clock(-left)}`, phase: "over" };
  }
  // Counting down rounds up, so the clock reads 0:00 only once time is up.
  const text = clock(Math.ceil(left / 1000) * 1000);
  if (idle) return { text, phase: "idle" };
  return { text, phase: left <= WARNING_MS ? "warning" : "running" };
}

/** Text size in the Delivery view, in CSS pixels (§23.11). */
export const DEFAULT_SIZE = 28;
export const MIN_SIZE = 16;
export const MAX_SIZE = 64;
export const SIZE_STEP = 4;

export function clampSize(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_SIZE;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(px)));
}

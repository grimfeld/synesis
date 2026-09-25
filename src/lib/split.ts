// A Composition's talk and its Board side by side (PLAN §22).
//
// The geometry of the divider, kept free of React so it is tested once
// (`test:unit`) — the `src/lib/board.ts` precedent.

/** The narrowest either side may get, in CSS pixels (PLAN §22.4). */
export const MIN_PANE = 320;

/** Where the divider starts: half and half. */
export const DEFAULT_RATIO = 0.5;

/** How far one arrow-key press moves the divider, as a share of the width. */
export const RATIO_STEP = 0.05;

/**
 * Whether the talk and the Board both fit their minimum in `width`.
 *
 * Below this the Split tab is not offered and a split renders as the talk
 * (PLAN §22.5). Every phone is below it.
 */
export function splitFits(width: number, min = MIN_PANE): boolean {
  return width >= min * 2;
}

/**
 * The talk's share of `width`, kept where neither side drops below `min`.
 *
 * The stored ratio is left alone by a narrower window: it is clamped for
 * drawing, so widening the window again gives back the split the user chose.
 */
export function clampRatio(
  ratio: number,
  width: number,
  min = MIN_PANE,
): number {
  if (!Number.isFinite(ratio)) ratio = DEFAULT_RATIO;
  if (width <= 0 || !splitFits(width, min)) return DEFAULT_RATIO;
  const lo = min / width;
  return Math.min(1 - lo, Math.max(lo, ratio));
}

/** The ratio for a pointer at `x` in a container starting at `left`. */
export function ratioAt(
  x: number,
  left: number,
  width: number,
  min = MIN_PANE,
): number {
  if (width <= 0) return DEFAULT_RATIO;
  return clampRatio((x - left) / width, width, min);
}

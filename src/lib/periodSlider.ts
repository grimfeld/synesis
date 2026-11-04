// The Map's time slider (CONTEXT.md: Period): a track over the years the
// Vault's Dates cover, with the Period's two ends as handles and the stretch
// between them as a third. Pure, so the dragging rules are tested once.
import { ordered, type Period } from "./period";

/** The years the track covers, astronomical and whole. */
export interface Extent {
  min: number;
  max: number;
}

/** Which part of the slider is held: an end, or the middle to move both. */
export type Handle = "from" | "to" | "middle";

/**
 * The track: the earliest to the latest year given, whole. Null with no years;
 * a single year is widened by one each way so its handles can still move.
 */
export function sliderExtent(years: number[]): Extent | null {
  const finite = years.filter((y) => Number.isFinite(y));
  if (finite.length === 0) return null;
  const min = Math.floor(Math.min(...finite));
  const max = Math.ceil(Math.max(...finite));
  return min === max ? { min: min - 1, max: max + 1 } : { min, max };
}

const clamp = (y: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, y));

/**
 * Where the handles sit for a Period: its ends in order, kept on the track,
 * and an open end (or no Period at all) at the edge of the track.
 */
export function sliderStops(p: Period | null, ext: Extent): { from: number; to: number } {
  const o = ordered(p);
  return {
    from: clamp(o?.from ?? ext.min, ext.min, ext.max),
    to: clamp(o?.to ?? ext.max, ext.min, ext.max),
  };
}

/**
 * The Period after dragging one handle by `delta` years. An end stops at the
 * other end and at the edge of the track; the middle moves both ends and keeps
 * its width. Dragging one end leaves the other as it was, open or not.
 */
export function dragPeriod(
  p: Period | null,
  handle: Handle,
  delta: number,
  ext: Extent,
): Period {
  const s = sliderStops(p, ext);
  const o = ordered(p);
  const d = Math.round(delta);
  if (handle === "from")
    return { from: clamp(s.from + d, ext.min, s.to), to: o?.to ?? null };
  if (handle === "to")
    return { from: o?.from ?? null, to: clamp(s.to + d, s.from, ext.max) };
  const shift = clamp(d, ext.min - s.from, ext.max - s.to);
  return { from: s.from + shift, to: s.to + shift };
}

/** A year's place along the track, from 0 to 1. */
export function fractionOf(y: number, ext: Extent): number {
  return (y - ext.min) / (ext.max - ext.min);
}

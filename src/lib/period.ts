// The Period (CONTEXT.md): the stretch of years the Timeline and the Map both
// narrow to, with the Tags chosen alongside it. The rules live here, pure and
// tested once (`test:unit`), so the two views cannot drift apart:
//
// - whatever overlaps the Period is in; whatever lies wholly outside it is out;
// - a Character or Event with no Date is out, and counted, so the view can say
//   how many it left out;
// - a Place with no Span is in, whatever the Period;
// - a Span missing one end runs on without limit that way.
import type { DatedProperty, DocSummary, DocType } from "./api";
import { fold } from "./names";
import { SPAN_PAIRS, yearOf } from "./timeline";

/**
 * A stretch of years, astronomical (0 is 1 BCE) and inclusive at both ends.
 * A null end is unbounded, so "from 640 BCE" alone is a Period too.
 */
export interface Period {
  from: number | null;
  to: number | null;
}

/** The selection the Timeline and the Map share (PLAN §16.11: client-side). */
export interface PeriodFilter {
  /** Null when no Period is set: nothing is hidden for its Dates. */
  period: Period | null;
  /** Tags an item must carry one of; empty means no Tag restriction. */
  tags: string[];
}

export const NO_PERIOD_FILTER: PeriodFilter = { period: null, tags: [] };

/** The years a document covers; an open end is ±Infinity. */
export interface Span {
  from: number;
  to: number;
}

/** One thing the filter decides on: a document, its Span and its Tags. */
export interface PeriodItem {
  doc: DocSummary;
  /** Null when the document carries no Date at all. */
  span: Span | null;
  tags: string[];
}

/**
 * The Span of one document's Dates. Every Date counts, so a Character's
 * `anointed` stretches it like `born` does. A pair with one end (`start`
 * without `end`, `died` without `born`) runs on without limit the other way,
 * except on an Event: an Event's `start` alone is the moment it happened.
 */
export function spanOf(type: DocType, dates: DatedProperty[]): Span | null {
  const parsed = dates.filter((d) => d.date);
  if (parsed.length === 0) return null;
  const ys = parsed.map((d) => yearOf(d.date!));
  let from = Math.min(...ys);
  let to = Math.max(...ys);
  if (type !== "event") {
    const has = new Set(parsed.map((d) => d.name));
    for (const [a, b] of SPAN_PAIRS) {
      if (has.has(a) && !has.has(b)) to = Infinity;
      if (has.has(b) && !has.has(a)) from = -Infinity;
    }
  }
  return { from, to };
}

/**
 * One item per document: those with Date rows, then the `undated` ones the
 * view fetched separately (the Date query only returns dated documents).
 */
export function itemsOf(
  rows: DatedProperty[],
  undated: DocSummary[],
  tagsByDoc: Map<string, string[]>,
): PeriodItem[] {
  const byDoc = new Map<string, { doc: DocSummary; dates: DatedProperty[] }>();
  for (const r of rows) {
    const g = byDoc.get(r.doc.id) ?? { doc: r.doc, dates: [] };
    g.dates.push(r);
    byDoc.set(r.doc.id, g);
  }
  for (const d of undated)
    if (!byDoc.has(d.id)) byDoc.set(d.id, { doc: d, dates: [] });
  return [...byDoc.values()].map(({ doc, dates }) => ({
    doc,
    span: spanOf(doc.type, dates),
    tags: tagsByDoc.get(doc.id) ?? [],
  }));
}

/** The types a Period hides when they carry no Date (CONTEXT.md: Period). */
const UNDATED_OUT = new Set<DocType>(["character", "event"]);

/**
 * The Period with its ends in order, or null when neither end is set: the user
 * may type the later year first, and an empty pair of fields is no Period.
 */
export function ordered(p: Period | null): Period | null {
  if (!p || (p.from == null && p.to == null)) return null;
  if (p.from != null && p.to != null && p.from > p.to)
    return { from: p.to, to: p.from };
  return p;
}

/** Whether a Span shares at least one moment with the Period. */
function overlaps(span: Span, p: Period): boolean {
  const lo = p.from ?? -Infinity;
  // Inclusive of the whole final year: 580 BCE runs until 579 BCE begins.
  const hi = p.to == null ? Infinity : p.to + 1;
  return span.from < hi && span.to >= lo;
}

/** The items the filter keeps, and how many undated ones the Period hid. */
export function filterByPeriod<T extends PeriodItem>(
  items: T[],
  f: PeriodFilter,
): { visible: T[]; undated: number } {
  const p = ordered(f.period);
  const tags = new Set(f.tags.map(fold));
  let undated = 0;
  const visible = items.filter((it) => {
    // Tags first, so the count only names what the Period alone left out.
    if (tags.size > 0 && !it.tags.some((tg) => tags.has(fold(tg)))) return false;
    if (!p) return true;
    if (it.span) return overlaps(it.span, p);
    // A Character or Event with no Date lies outside every Period; anything
    // else undated (a Place with no Span) lies inside every one.
    if (UNDATED_OUT.has(it.doc.type)) {
      undated++;
      return false;
    }
    return true;
  });
  return { visible, undated };
}

/** A year as people say it, without its era: astronomical 0 is 1 BCE. */
function bare(y: number): string {
  return String(y <= 0 ? 1 - y : y);
}

/**
 * The Period as text, so a view always says it is on: "640–580 BCE", the era
 * named once when both ends share it; an open end is a bare dash.
 */
export function formatPeriod(
  period: Period,
  eras: { bce: string; ce: string },
): string {
  const p = ordered(period);
  if (!p) return "";
  const era = (y: number) => (y <= 0 ? eras.bce : eras.ce);
  const full = (y: number) => `${bare(y)} ${era(y)}`;
  if (p.from == null) return `– ${full(p.to!)}`;
  if (p.to == null) return `${full(p.from)} –`;
  if (p.from === p.to) return full(p.from);
  if (era(p.from) === era(p.to)) return `${bare(p.from)}–${bare(p.to)} ${era(p.to)}`;
  return `${full(p.from)} – ${full(p.to)}`;
}

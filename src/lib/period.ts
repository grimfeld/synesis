// The Period (CONTEXT.md): the stretch of years the Timeline and the Map both
// narrow to, with the Tags chosen alongside it. The rules live here, pure and
// tested once (`test:unit`), so the two views cannot drift apart:
//
// - whatever overlaps the Period is in; whatever lies wholly outside it is out;
// - a Character or Event with no Date is out, and counted, so the view can say
//   how many it left out;
// - a Place with no Span is in, whatever the Period;
// - a Place's Span missing one end runs on without limit that way; anything
//   else with a single Date counts at that Date alone;
// - chosen Places, any of them, keep themselves and the Characters and Events
//   tied to them (`Tie`) for as long as the tie holds within the Period.
import type { DatedProperty, DocSummary, DocType, EventLink, PlaceTie } from "./api";
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
  /**
   * Tags an item must carry one of; empty means no Tag restriction. A Place
   * also counts as carrying a Tag that something tied to it in the Period
   * carries.
   */
  tags: string[];
  /**
   * Place ids, any of them: only these Places, and the Characters and Events
   * tied to one of them in the Period. Empty means no Place restriction.
   */
  places: string[];
}

export const NO_PERIOD_FILTER: PeriodFilter = { period: null, tags: [], places: [] };

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
 * `anointed` stretches it like `born` does. Only a Place's pair with one end
 * (`start` without `end`) runs on without limit the other way: a city founded
 * in 1000 BCE still stands in 500 BCE. Anything else counts only at the Dates
 * it has, so a Character with only `died` is there in that year alone, and an
 * Event's `start` alone is the moment it happened.
 */
export function spanOf(type: DocType, dates: DatedProperty[]): Span | null {
  const parsed = dates.filter((d) => d.date);
  if (parsed.length === 0) return null;
  const ys = parsed.map((d) => yearOf(d.date!));
  let from = Math.min(...ys);
  let to = Math.max(...ys);
  if (type === "place") {
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

/**
 * A Character or Event in a Place (CONTEXT.md: Character, Period), as the
 * filter weighs it.
 */
export interface Tie {
  /** The Character or Event. */
  doc: string;
  place: string;
  /**
   * "own": holds whenever the document itself is in the Period, so a
   * Character's `places` follow its life and an Event its own Dates.
   * Otherwise the Span of the Event that ties them, or null when that Event
   * has no Date: then it holds only while no Period is set.
   */
  when: "own" | Span | null;
}

/**
 * The ties the filter weighs: the engine's Character↔Place ties, and each
 * Event at the Place it names. `eventLinks` also name an Event's Characters;
 * those are ties to no Place, and never match one.
 */
export function tiesOf(placeTies: PlaceTie[], eventLinks: EventLink[]): Tie[] {
  const out: Tie[] = [];
  for (const t of placeTies) {
    if (!t.event) {
      out.push({ doc: t.character.id, place: t.place.id, when: "own" });
      continue;
    }
    const a = t.start ?? t.end;
    const b = t.end ?? t.start;
    out.push({
      doc: t.character.id,
      place: t.place.id,
      when: a && b ? { from: yearOf(a), to: yearOf(b) } : null,
    });
  }
  for (const l of eventLinks) out.push({ doc: l.event, place: l.subject, when: "own" });
  return out;
}

/** Whether a tie holds in the Period, the document itself being in it. */
function holds(t: Tie, p: Period | null): boolean {
  if (t.when === "own") return true;
  if (!p) return true;
  return t.when != null && overlaps(t.when, p);
}

/** Where the Period alone puts an item: in, out, or out for having no Date. */
function inPeriod(it: PeriodItem, p: Period | null): boolean | "undated" {
  if (!p) return true;
  if (it.span) return overlaps(it.span, p);
  // A Character or Event with no Date lies outside every Period; anything
  // else undated (a Place with no Span) lies inside every one.
  return UNDATED_OUT.has(it.doc.type) ? "undated" : true;
}

/**
 * The parts of the filter, decided once over all the items:
 *
 * - Tags: an item carrying one is in; so is a Place where something carrying
 *   one, and in the Period, is tied in the Period ("prophet" keeps Jerusalem
 *   while Jeremiah is there);
 * - Places, any of them: a chosen Place is in, and so is a Character or Event
 *   tied to one in the Period; nothing else is;
 * - the Period, as `inPeriod` says.
 */
function decide<T extends PeriodItem>(items: T[], f: PeriodFilter, ties: Tie[]) {
  const p = ordered(f.period);
  const tags = new Set(f.tags.map(fold));
  const chosen = new Set(f.places);
  const ownTag = (it: PeriodItem) =>
    tags.size === 0 || it.tags.some((tg) => tags.has(fold(tg)));
  const byId = new Map(items.map((it) => [it.doc.id, it]));
  // What counts as being somewhere with a Tag: in the Period, carrying one.
  const present = (id: string) => {
    const it = byId.get(id);
    return !!it && it.doc.type !== "place" && ownTag(it) && inPeriod(it, p) === true;
  };
  const tiesByPlace = new Map<string, Tie[]>();
  const tiesByDoc = new Map<string, Tie[]>();
  const add = (m: Map<string, Tie[]>, k: string, t: Tie) => {
    const list = m.get(k);
    if (list) list.push(t);
    else m.set(k, [t]);
  };
  for (const t of ties) {
    if (!holds(t, p)) continue;
    add(tiesByPlace, t.place, t);
    add(tiesByDoc, t.doc, t);
  }
  const tagged = (it: PeriodItem) =>
    ownTag(it) ||
    (it.doc.type === "place" &&
      (tiesByPlace.get(it.doc.id) ?? []).some((t) => present(t.doc)));
  const placed = (it: PeriodItem) => {
    if (chosen.size === 0) return true;
    if (it.doc.type === "place") return chosen.has(it.doc.id);
    return (tiesByDoc.get(it.doc.id) ?? []).some((t) => chosen.has(t.place));
  };
  return { p, tiesByPlace, present, tagged, placed };
}

/** The items the filter keeps, and how many undated ones the Period hid. */
export function filterByPeriod<T extends PeriodItem>(
  items: T[],
  f: PeriodFilter,
  ties: Tie[] = [],
): { visible: T[]; undated: number; undatedItems: T[] } {
  const { p, tagged, placed } = decide(items, f, ties);
  const undatedItems: T[] = [];
  const visible = items.filter((it) => {
    // Tags and Places first, so the count only names what the Period alone
    // left out.
    if (!tagged(it) || !placed(it)) return false;
    const inside = inPeriod(it, p);
    if (inside === "undated") undatedItems.push(it);
    return inside === true;
  });
  return { visible, undated: undatedItems.length, undatedItems };
}

/**
 * The Characters in each Place during the Period (a Place's pin card on the
 * Map): tied to it in the Period, themselves in it, and carrying a chosen Tag
 * when there are any. In the items' order, each once.
 */
export function charactersAt(
  items: PeriodItem[],
  f: PeriodFilter,
  ties: Tie[],
): Map<string, DocSummary[]> {
  const { tiesByPlace, present } = decide(items, f, ties);
  const byId = new Map(items.map((it) => [it.doc.id, it.doc]));
  const out = new Map<string, DocSummary[]>();
  for (const [place, ts] of tiesByPlace) {
    const ids = new Set(
      ts.map((t) => t.doc).filter((id) => byId.get(id)?.type === "character" && present(id)),
    );
    const docs = items.filter((it) => ids.has(it.doc.id)).map((it) => it.doc);
    if (docs.length > 0) out.set(place, docs);
  }
  return out;
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

/**
 * A year field and its era as a Period end: "640" BCE is -639. Empty, or not
 * a positive whole year, is an open end (there is no year 0).
 */
export function fieldToYear(text: string, bce: boolean): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  if (n < 1) return null;
  return bce ? 1 - n : n;
}

/** A Period end as a year field and its era; an open end is an empty BCE field. */
export function yearToField(y: number | null): { text: string; bce: boolean } {
  if (y == null) return { text: "", bce: true };
  return { text: bare(y), bce: y <= 0 };
}

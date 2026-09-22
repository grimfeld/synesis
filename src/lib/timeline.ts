// Timeline geometry (PLAN §16): the pure maths behind the Timeline view and the
// Hub mini-timeline. Lanes, year projection, label collision and Clusters live
// here so both shells stay dumb SVG and the logic is tested once (`test:unit`).
import type { BibleDate, DatedProperty, DocSummary, DocType, EventLink } from "./api";
import { fold } from "./names";

/** One thing drawn on a Lane: a point Date, or a span when it has a `to`. */
export interface Mark {
  key: string;
  doc: DocSummary;
  /** Property name for a point, "span" for a bar, the Event title on a Subject Lane. */
  label: string;
  text: string;
  from: number;
  to: number | null;
  approx: boolean;
  type: DocType;
}

/** One row of the Timeline: the Events Lane, or a dated Subject. */
export interface Lane {
  id: string;
  title: string;
  type: DocType;
  doc: DocSummary | null;
  first: number;
  marks: Mark[];
}

export function yearOf(d: BibleDate): number {
  const m = d.month ? (d.month - 1) / 12 : 0;
  const day = d.day ? (d.day - 1) / 365 : 0;
  return d.year + m + day;
}

/** The year as people say it: astronomical 0 is 1 BCE. */
export function formatYear(y: number, t: { bce: string; ce: string }): string {
  const r = Math.round(y);
  return r <= 0 ? `${1 - r} ${t.bce}` : `${r} ${t.ce}`;
}

/**
 * The Property pairs that make a Span (CONTEXT.md): a Character's lifespan, an
 * Event's or a Journey's duration.
 *
 * Recognised on any document carrying such a pair, whatever its type — a
 * Character who also has `start`/`end` for a reign gets that Span drawn too.
 * Which pair a *new* page is offered is a separate, per-type matter and lives
 * with the rest of the UI's per-type table (`SPAN` in lib/docTypes.tsx); a
 * suggestion is not a constraint.
 */
const SPAN_PAIRS: [string, string][] = [
  ["start", "end"],
  ["born", "died"],
];

export function buildLanes(
  rows: DatedProperty[],
  links: EventLink[],
  eventsTitle: string,
  /**
   * What to call a Property on a Lane. Passed in rather than looked up here so
   * this stays pure and testable; the views hand it `propertyLabel`, so a
   * Character's bare `born` reads "Born" and not its front-matter key.
   */
  propertyLabel: (name: string) => string = (n) => n,
): Lane[] {
  const byDoc = new Map<string, { doc: DocSummary; dates: DatedProperty[] }>();
  for (const r of rows) {
    if (!r.date) continue;
    const g = byDoc.get(r.doc.id) ?? { doc: r.doc, dates: [] };
    g.dates.push(r);
    byDoc.set(r.doc.id, g);
  }
  const marksFor = (
    doc: DocSummary,
    dates: DatedProperty[],
    label: (name: string) => string,
  ): Mark[] => {
    const named = new Map(dates.map((d) => [d.name, d]));
    const out: Mark[] = [];
    const used = new Set<string>();
    for (const [a, b] of SPAN_PAIRS) {
      const da = named.get(a);
      const db = named.get(b);
      if (da?.date && db?.date) {
        out.push({
          key: `${doc.id}:${a}-${b}`,
          doc,
          label: label("span"),
          text: `${da.text} – ${db.text}`,
          from: yearOf(da.date),
          to: yearOf(db.date),
          approx: da.date.approx || db.date.approx,
          type: doc.type,
        });
        used.add(a);
        used.add(b);
      }
    }
    for (const d of dates) {
      if (used.has(d.name) || !d.date) continue;
      out.push({
        key: `${doc.id}:${d.name}`,
        doc,
        label: label(d.name),
        text: d.text,
        from: yearOf(d.date),
        to: null,
        approx: d.date.approx,
        type: doc.type,
      });
    }
    return out;
  };
  const events: Lane = {
    id: "events",
    title: eventsTitle,
    type: "event",
    doc: null,
    first: Infinity,
    marks: [],
  };
  const subjects: Lane[] = [];
  const eventMarks = new Map<string, Mark>();
  for (const { doc, dates } of byDoc.values()) {
    if (doc.type === "event") {
      // An Event is one mark: its span, or its start alone.
      const ms = marksFor(doc, dates, () => doc.title);
      const m =
        ms.find((x) => x.to != null) ??
        ms.find((x) => x.key.endsWith(":start")) ??
        ms[0];
      if (!m) continue;
      const mark = { ...m, label: doc.title };
      events.marks.push(mark);
      events.first = Math.min(events.first, mark.from);
      eventMarks.set(doc.id, mark);
    } else {
      const marks = marksFor(doc, dates, (name) =>
        name === "span" ? doc.title : propertyLabel(name),
      );
      if (marks.length === 0) continue;
      subjects.push({
        id: doc.id,
        title: doc.title,
        type: doc.type,
        doc,
        first: Math.min(...marks.map((m) => m.from)),
        marks,
      });
    }
  }
  // Events also sit on the lanes of the Subjects they name.
  for (const l of links) {
    const lane = subjects.find((x) => x.id === l.subject);
    const mark = eventMarks.get(l.event);
    if (lane && mark)
      lane.marks.push({ ...mark, key: `${lane.id}:${mark.key}` });
  }
  subjects.sort((a, b) => a.first - b.first || a.title.localeCompare(b.title));
  return [...(events.marks.length ? [events] : []), ...subjects];
}

export function niceStep(span: number): number {
  const steps = [10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
  for (const s of steps) if (span / s >= 5) return s;
  return 1;
}

/** The extent a set of Lanes covers, padded, with a floor so a lone point still has width. */
export function extentOf(lanes: Lane[], fallback: [number, number] = [-2000, 100]): [number, number] {
  const ys = lanes.flatMap((l) => l.marks.flatMap((m) => [m.from, m.to ?? m.from]));
  if (ys.length === 0) return fallback;
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  if (hi - lo < 10) {
    lo -= 5;
    hi += 5;
  }
  const pad = (hi - lo) * 0.06;
  return [lo - pad, hi + pad];
}

/** A point mark, or several that fell too close to draw apart (PLAN §16). */
export interface Placed {
  key: string;
  /** The marks this stands for: one, unless it is a Cluster. */
  marks: Mark[];
  /** Plot x of the mark, or of a Cluster's centre. */
  x: number;
  /** Plot x of a span's end; null for a point or a Cluster. */
  x2: number | null;
  /** Label to draw, once collisions are resolved; null when it would overlap. */
  label: string | null;
  /** True when a point sits over a span on its own Lane, and must ride above it. */
  overSpan?: boolean;
}

/** Points closer than this merge into one Cluster: a mark's diameter plus a gap. */
export const CLUSTER_PX = 14;

/**
 * Lay one Lane's marks out in plot space. Spans keep their width and never
 * Cluster, since the bar is the thing they show; points within CLUSTER_PX of
 * each other merge into one mark carrying a count.
 */
export function placeMarks(marks: Mark[], x: (year: number) => number): Placed[] {
  const spans = marks.filter((m) => m.to != null);
  const points = marks.filter((m) => m.to == null).sort((a, b) => a.from - b.from);
  const out: Placed[] = spans.map((m) => ({
    key: m.key,
    marks: [m],
    x: x(m.from),
    // A span thinner than a point reads as a mark that lost its width.
    x2: Math.max(x(m.to as number), x(m.from) + 3),
    label: m.label,
  }));
  let group: Mark[] = [];
  const flush = () => {
    if (group.length === 0) return;
    const xs = group.map((m) => x(m.from));
    out.push({
      key: group.length === 1 ? group[0].key : `cluster:${group[0].key}`,
      marks: group,
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      x2: null,
      label: group.length === 1 ? group[0].label : String(group.length),
    });
    group = [];
  };
  for (const m of points) {
    if (group.length > 0 && x(m.from) - x(group[group.length - 1].from) > CLUSTER_PX) flush();
    group.push(m);
  }
  flush();
  const bars = out.filter((p) => p.x2 != null);
  return out.map((p) =>
    p.x2 == null && bars.some((b) => p.x >= b.x - 2 && p.x <= (b.x2 as number) + 2)
      ? { ...p, overSpan: true }
      : p,
  );
}

/** How much horizontal room a mark's own shape takes, label aside. */
function footprint(p: Placed): [number, number] {
  if (p.x2 != null) return [p.x, p.x2];
  const r = p.marks.length > 1 ? 9 : 6;
  return [p.x - r, p.x + r];
}

/**
 * Blank the labels that would overlap something already drawn: another label,
 * or any mark's own shape, so a Cluster's badge never lands on a neighbour's
 * text. Spans win over points and earlier wins over later, so which label
 * survives never depends on the order Properties sit in the frontmatter.
 */
export function resolveLabels(
  placed: Placed[],
  widthOf: (label: string) => number,
  /** Plot right edge; a label that would run past it is dropped rather than clipped. */
  right = Infinity,
  /** Where a span's label starts: after the bar by default, inside it for the mini. */
  spanLabelAt: (p: Placed) => number = (p) => (p.x2 as number) + 8,
): Placed[] {
  const order = [...placed]
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const span = (z: Placed) => (z.x2 != null ? 0 : 1);
      return span(a.p) - span(b.p) || a.p.x - b.p.x || a.i - b.i;
    });
  // Every mark holds its own ground before any label is placed.
  const taken: [number, number][] = placed.map(footprint);
  const kept = new Set<string>();
  for (const { p } of order) {
    if (p.label == null) continue;
    // A Cluster's count is drawn inside its circle, which it already owns.
    if (p.marks.length > 1) {
      kept.add(p.key);
      continue;
    }
    const start = p.x2 != null ? spanLabelAt(p) : p.x + 14;
    const box: [number, number] = [start, start + widthOf(p.label)];
    if (box[1] > right) continue;
    const own = footprint(p);
    // A mark never blocks its own label; a span may even carry it inside its bar.
    const clash = taken.some(
      ([a, b]) =>
        box[0] < b && a < box[1] && !(a === own[0] && b === own[1]),
    );
    if (clash) continue;
    taken.push(box);
    kept.add(p.key);
  }
  return placed.map((p) => (kept.has(p.key) ? p : { ...p, label: null }));
}

/** What the Timeline's five filters currently restrict to (PLAN §16.2). */
export interface Filters {
  hiddenTypes: DocType[];
  tags: string[];
  props: string[];
  search: string;
  inView: boolean;
}

export const NO_FILTERS: Filters = {
  hiddenTypes: [],
  tags: [],
  props: [],
  search: "",
  inView: true,
};

/** How many restrictions the user added; the viewport cull is a mode, not a restriction. */
export function activeCount(f: Filters): number {
  return (
    f.hiddenTypes.length +
    f.tags.length +
    f.props.length +
    (f.search.trim() ? 1 : 0)
  );
}


/**
 * Narrow the rows a Lane is built from. Property names filter *before* spans are
 * paired, so asking for `born` alone leaves a point rather than a `born`/`died`
 * bar (PLAN §16.2).
 */
export function filterRows(
  rows: DatedProperty[],
  f: Filters,
  tagsByDoc: Map<string, string[]>,
): DatedProperty[] {
  const hidden = new Set(f.hiddenTypes);
  const wanted = new Set(f.props.map(fold));
  const tags = new Set(f.tags.map(fold));
  const needle = fold(f.search.trim());
  return rows.filter((r) => {
    if (hidden.has(r.doc.type)) return false;
    if (wanted.size > 0 && !wanted.has(fold(r.name))) return false;
    if (needle && !fold(r.doc.title).includes(needle)) return false;
    if (tags.size > 0) {
      const own = tagsByDoc.get(r.doc.id) ?? [];
      if (!own.some((tg) => tags.has(fold(tg)))) return false;
    }
    return true;
  });
}

/**
 * Drop the Lanes the current view does not reach. Order is left alone, so a Lane
 * that survives never jumps past another while the view is panned.
 */
export function cullToView(lanes: Lane[], from: number, to: number): Lane[] {
  return lanes.filter((l) =>
    l.marks.some((m) => m.from <= to && (m.to ?? m.from) >= from),
  );
}

/** Every Date Property name in play, for the filter's chips. */
export function propertyNames(rows: DatedProperty[]): string[] {
  const seen = new Map<string, string>();
  for (const r of rows) if (r.date) seen.set(fold(r.name), r.name);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

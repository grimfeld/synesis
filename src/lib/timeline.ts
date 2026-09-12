// Timeline geometry (PLAN §16): the pure maths behind the Timeline view and the
// Hub mini-timeline. Lanes, year projection, label collision and Clusters live
// here so both shells stay dumb SVG and the logic is tested once (`test:unit`).
import type { BibleDate, DatedProperty, DocSummary, DocType, EventLink } from "./api";

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

const SPAN_PAIRS: [string, string][] = [
  ["start", "end"],
  ["born", "died"],
];

export function buildLanes(
  rows: DatedProperty[],
  links: EventLink[],
  eventsTitle: string,
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
        name === "span" ? doc.title : name,
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

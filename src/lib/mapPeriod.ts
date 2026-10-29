// The Map in a Period (CONTEXT.md: Period, Map). The rules of what a Period
// keeps live in lib/period; this only says what the Map asks of them:
//
// - Places, through the Period module (a Place with no Span always stays);
// - Journeys whose Span overlaps the Period (an undated one stays, like a
//   Place: only Characters and Events are hidden for having no Date);
// - Events in the Period, as marks at their Place, and how many undated
//   Events the Period left out.
//
// The Map applies the shared Period only. The Tags chosen with it on the
// Timeline are for Characters and Events, and the Map keeps its own Tag chips
// for Places, so they are not applied here.
import type { DatedProperty, DocSummary, EventLink, Journey } from "./api";
import { filterByPeriod, itemsOf, ordered, type Period } from "./period";

/** An Event in the Period, and the Place its mark sits at. */
export interface EventMark {
  event: DocSummary;
  place: string;
}

export interface MapInPeriod {
  places: DocSummary[];
  journeys: Journey[];
  /** Empty when no Period is set: the Map marks Events only in a Period. */
  events: EventMark[];
  /** Undated Events the Period left out. */
  undated: number;
}

export function mapInPeriod(o: {
  places: DocSummary[];
  journeys: Journey[];
  /** Every Event, dated or not, so the undated can be counted. */
  events: DocSummary[];
  /** The Timeline's Date rows; rows of other documents are ignored. */
  rows: DatedProperty[];
  eventLinks: EventLink[];
  period: Period | null;
}): MapInPeriod {
  const period = ordered(o.period);
  if (!period)
    return { places: o.places, journeys: o.journeys, events: [], undated: 0 };
  const docs = [...o.places, ...o.journeys.map((j) => j.doc), ...o.events];
  const wanted = new Set(docs.map((d) => d.id));
  const items = itemsOf(
    o.rows.filter((r) => wanted.has(r.doc.id)),
    docs,
    new Map(),
  );
  const { visible, undated } = filterByPeriod(items, { period, tags: [] });
  const kept = new Set(visible.map((it) => it.doc.id));
  const places = o.places.filter((p) => kept.has(p.id));
  const shownPlaces = new Set(places.map((p) => p.id));
  const eventById = new Map(o.events.map((e) => [e.id, e]));
  const events: EventMark[] = [];
  for (const l of o.eventLinks) {
    const event = eventById.get(l.event);
    if (event && kept.has(event.id) && shownPlaces.has(l.subject))
      events.push({ event, place: l.subject });
  }
  return {
    places,
    journeys: o.journeys.filter((j) => kept.has(j.doc.id)),
    events,
    undated,
  };
}

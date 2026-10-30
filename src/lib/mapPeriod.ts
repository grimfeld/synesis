// The Map in a Period (CONTEXT.md: Period, Map). The rules of what the shared
// filter keeps live in lib/period; this only says what the Map asks of them:
//
// - Places, through the Period module: a Place with no Span always stays in a
//   Period; the shared Tags keep a Place that carries one, or where a
//   Character or Event carrying one is tied in the Period; the shared Places
//   keep only themselves, a chosen region every Place inside its Border too
//   while the region itself is in the Period;
// - Journeys whose Span overlaps the Period (an undated one stays, like a
//   Place: only Characters and Events are hidden for having no Date). They
//   are routes, not Places, so the shared Tags and Places leave them be;
// - Events in the Period, as marks at their Place, and how many undated
//   Events the Period left out;
// - the Characters at each Place in the Period, for its pin card; a
//   region's card lists those at the Places inside it as well.
//
// The Map's own Tag chips (MapFilters) narrow its Places further, after this.
import type {
  DatedProperty,
  DocSummary,
  EventLink,
  Journey,
  PlaceTie,
  RegionMember,
} from "./api";
import {
  charactersAt,
  filterByPeriod,
  itemsOf,
  ordered,
  tiesOf,
  type Period,
  type PeriodFilter,
} from "./period";

/** An Event in the Period, and the Place its mark sits at. */
export interface EventMark {
  event: DocSummary;
  place: string;
}

export interface MapInPeriod {
  places: DocSummary[];
  /** The `regions` given that the filter keeps. */
  regions: DocSummary[];
  journeys: Journey[];
  /** Empty when no Period is set: the Map marks Events only in a Period. */
  events: EventMark[];
  /** Undated Events the Period left out. */
  undated: number;
  /** The Characters at each Place in the Period, by Place id; a region's include those inside it. */
  charactersAt: Map<string, DocSummary[]>;
}

export function mapInPeriod(o: {
  places: DocSummary[];
  journeys: Journey[];
  /** Every Event, dated or not, so the undated can be counted. */
  events: DocSummary[];
  /** The Timeline's Date rows; rows of other documents are ignored. */
  rows: DatedProperty[];
  eventLinks: EventLink[];
  /**
   * Regions with a Border but no coordinates: no pin decides whether their
   * Border is drawn, so the filter alone does.
   */
  regions?: DocSummary[];
  period: Period | null;
  /** The shared Tags; empty or absent is no Tag restriction. */
  tags?: string[];
  /** The shared Places' ids, any of them; empty or absent is no restriction. */
  chosenPlaces?: string[];
  /** Every Character, dated or not: who is where, and who carries a Tag. */
  characters?: DocSummary[];
  placeTies?: PlaceTie[];
  /** The Places inside each region's Border (engine-computed, ADR 0023). */
  regionMembers?: RegionMember[];
  /** The Tags each document carries, as far as the chosen Tags go. */
  tagsByDoc?: Map<string, string[]>;
}): MapInPeriod {
  const regions = o.regions ?? [];
  const period = ordered(o.period);
  const filter: PeriodFilter = {
    period,
    tags: o.tags ?? [],
    places: o.chosenPlaces ?? [],
  };
  const docs = [
    ...o.places,
    ...regions,
    ...o.journeys.map((j) => j.doc),
    ...o.events,
    ...(o.characters ?? []),
  ];
  const wanted = new Set(docs.map((d) => d.id));
  const items = itemsOf(
    o.rows.filter((r) => wanted.has(r.doc.id)),
    docs,
    o.tagsByDoc ?? new Map(),
  );
  const ties = tiesOf(o.placeTies ?? [], o.eventLinks);
  const { visible, undatedItems } = filterByPeriod(
    items.filter((it) => it.doc.type !== "journey"),
    filter,
    ties,
    o.regionMembers ?? [],
  );
  const kept = new Set(visible.map((it) => it.doc.id));
  // Journeys answer to the Period alone.
  const journeysKept = new Set(
    filterByPeriod(
      items.filter((it) => it.doc.type === "journey"),
      { period, tags: [], places: [] },
    ).visible.map((it) => it.doc.id),
  );
  const places = o.places.filter((p) => kept.has(p.id));
  const shownPlaces = new Set(places.map((p) => p.id));
  const eventById = new Map(o.events.map((e) => [e.id, e]));
  const events: EventMark[] = [];
  if (period)
    for (const l of o.eventLinks) {
      const event = eventById.get(l.event);
      if (event && kept.has(event.id) && shownPlaces.has(l.subject))
        events.push({ event, place: l.subject });
    }
  return {
    places,
    regions: regions.filter((r) => kept.has(r.id)),
    journeys: o.journeys.filter((j) => journeysKept.has(j.doc.id)),
    events,
    undated: undatedItems.filter((it) => it.doc.type === "event").length,
    charactersAt: charactersAt(items, filter, ties, o.regionMembers ?? []),
  };
}

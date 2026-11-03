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
  type PeriodItem,
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

/** What the Map knows, for `mapInPeriod`. */
export interface MapInPeriodInput {
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
}

export function mapInPeriod(input: MapInPeriodInput): MapInPeriod {
  const o = withDefaults(input);
  const filter: PeriodFilter = { period: o.period, tags: o.tags, places: o.chosenPlaces };
  const items = mapItems(o);
  const ties = tiesOf(o.placeTies, o.eventLinks);
  const { visible, undatedItems } = filterByPeriod(
    items.filter((it) => it.doc.type !== "journey"),
    filter,
    ties,
    o.regionMembers,
  );
  const kept = new Set(visible.map((it) => it.doc.id));
  const places = o.places.filter((p) => kept.has(p.id));
  return {
    places,
    regions: o.regions.filter((r) => kept.has(r.id)),
    journeys: journeysIn(o.journeys, items, o.period),
    events: o.period ? eventMarks(o.events, o.eventLinks, kept, places) : [],
    undated: undatedItems.filter((it) => it.doc.type === "event").length,
    charactersAt: charactersAt(items, filter, ties, o.regionMembers),
  };
}

/** The input with every optional part filled, and the Period in order. */
function withDefaults(o: MapInPeriodInput): Required<MapInPeriodInput> {
  return {
    ...o,
    regions: o.regions ?? [],
    period: ordered(o.period),
    tags: o.tags ?? [],
    chosenPlaces: o.chosenPlaces ?? [],
    characters: o.characters ?? [],
    placeTies: o.placeTies ?? [],
    regionMembers: o.regionMembers ?? [],
    tagsByDoc: o.tagsByDoc ?? new Map(),
  };
}

/** One item per document the Map weighs, from its own Date rows. */
function mapItems(o: Required<MapInPeriodInput>): PeriodItem[] {
  const docs = [
    ...o.places,
    ...o.regions,
    ...o.journeys.map((j) => j.doc),
    ...o.events,
    ...o.characters,
  ];
  const wanted = new Set(docs.map((d) => d.id));
  return itemsOf(
    o.rows.filter((r) => wanted.has(r.doc.id)),
    docs,
    o.tagsByDoc,
  );
}

/** The Journeys in the Period: they answer to the Period alone. */
function journeysIn(journeys: Journey[], items: PeriodItem[], period: Period | null): Journey[] {
  const kept = new Set(
    filterByPeriod(
      items.filter((it) => it.doc.type === "journey"),
      { period, tags: [], places: [] },
    ).visible.map((it) => it.doc.id),
  );
  return journeys.filter((j) => kept.has(j.doc.id));
}

/** A mark for each kept Event, at each shown Place it names. */
function eventMarks(
  events: DocSummary[],
  links: EventLink[],
  kept: Set<string>,
  places: DocSummary[],
): EventMark[] {
  const shown = new Set(places.map((p) => p.id));
  const byId = new Map(events.map((e) => [e.id, e]));
  const out: EventMark[] = [];
  for (const l of links) {
    const event = byId.get(l.event);
    if (event && kept.has(event.id) && shown.has(l.subject)) out.push({ event, place: l.subject });
  }
  return out;
}

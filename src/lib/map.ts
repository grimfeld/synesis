// Map filtering (PLAN §19): the pure predicate behind the Map view's four
// filter axes, kept here so it is tested once (`test:unit`) and the view stays
// a dumb Leaflet shell — the `src/lib/timeline.ts` (§16.13) precedent.
//
// The axes are AND across, OR within (§19.5). The Timeline's type axis is dead
// here (everything is a Place) and its viewport cull is meaningless (the map is
// a viewport; panning already culls), so the four are Tags, title search, the
// Book a Place is mentioned in, and whether anything mentions it at all.
import type { DocSummary } from "./api";
import { fold } from "./names";

/** What the Map's four filters currently restrict to (PLAN §19.5). */
export interface MapFilters {
  /** Tags a Place must carry one of; empty means no Tag restriction. */
  tags: string[];
  /** Substring of the title, folded; empty means no search restriction. */
  search: string;
  /** Book numbers a Place must be mentioned in one of; empty means no restriction. */
  books: number[];
  /** When true, hide Places nothing mentions (§19.5: the gazetteer rescue). */
  mentionedOnly: boolean;
  /**
   * Journeys drawn as routes, by document id. Off by default (§19.3); a chip
   * that is on draws the whole route and shows every Stop, whatever the other
   * four filters say (§19.7).
   */
  journeys: string[];
}

export const NO_MAP_FILTERS: MapFilters = {
  tags: [],
  search: "",
  books: [],
  mentionedOnly: false,
  journeys: [],
};

/**
 * How many restrictions the user added. `mentionedOnly` counts: unlike the
 * Timeline's viewport cull (§16, a mode), it hides Places outright.
 *
 * Journey chips deliberately do not count. They add Places to the map rather
 * than removing any, so counting them would read as "4 filters narrowing this"
 * while the map got busier.
 */
export function activeCount(f: MapFilters): number {
  return (
    f.tags.length +
    f.books.length +
    (f.search.trim() ? 1 : 0) +
    (f.mentionedOnly ? 1 : 0)
  );
}


/** What the four axes need to know about each Place beyond its summary. */
export interface PlaceFacts {
  /** Tags on the Place itself. */
  tags: Map<string, string[]>;
  /** Book numbers the Place is mentioned in, from documents that link to it. */
  books: Map<string, number[]>;
  /** How many documents mention the Place. */
  mentions: Map<string, number>;
}

export const NO_FACTS: PlaceFacts = {
  tags: new Map(),
  books: new Map(),
  mentions: new Map(),
};

/**
 * The Places left after the four filters. Facts are injected rather than
 * fetched so this stays pure; the view supplies them from the engine.
 */
export function filterPlaces(
  places: DocSummary[],
  f: MapFilters,
  facts: PlaceFacts = NO_FACTS,
): DocSummary[] {
  const tags = new Set(f.tags.map(fold));
  const books = new Set(f.books);
  const needle = fold(f.search.trim());
  return places.filter((p) => {
    if (needle && !fold(p.title).includes(needle)) return false;
    if (tags.size > 0) {
      const own = facts.tags.get(p.id) ?? [];
      if (!own.some((tg) => tags.has(fold(tg)))) return false;
    }
    if (books.size > 0) {
      const own = facts.books.get(p.id) ?? [];
      if (!own.some((b) => books.has(b))) return false;
    }
    if (f.mentionedOnly && (facts.mentions.get(p.id) ?? 0) === 0) return false;
    return true;
  });
}

/**
 * The Tags offered as chips: only those present on Places, so a chip can never
 * match nothing (the §16.12 rule).
 */
export function placeTags(places: DocSummary[], facts: PlaceFacts): string[] {
  const seen = new Map<string, string>();
  for (const p of places)
    for (const tg of facts.tags.get(p.id) ?? []) seen.set(fold(tg), tg);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** The Book numbers offered as chips, ascending in canon order. */
export function placeBooks(places: DocSummary[], facts: PlaceFacts): number[] {
  const seen = new Set<number>();
  for (const p of places)
    for (const b of facts.books.get(p.id) ?? []) seen.add(b);
  return [...seen].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Routes (PLAN §19.10)
// ---------------------------------------------------------------------------

/**
 * Route colours, cycled by index rather than chosen per Journey (§19.10): a
 * palette means nothing has to be picked before anything is visible. These are
 * CSS custom properties so dark mode swaps them like every other type colour.
 */
export const ROUTE_TOKENS = [
  "--c-route-1",
  "--c-route-2",
  "--c-route-3",
  "--c-route-4",
  "--c-route-5",
] as const;

/** The CSS variable naming the colour of the nth drawn Journey. */
export function routeToken(i: number): string {
  return ROUTE_TOKENS[((i % ROUTE_TOKENS.length) + ROUTE_TOKENS.length) % ROUTE_TOKENS.length];
}

/** A point on the map, in [lat, lon] as Leaflet takes them. */
export type LatLon = [number, number];

/**
 * How far a leg bows away from the straight line, as a fraction of its length.
 * Small enough to read as "A then B", large enough to separate an outbound leg
 * from the return between the same two Places.
 */
export const BULGE = 0.15;

/**
 * The control point of the quadratic Bézier drawn for one leg.
 *
 * The bulge is always to the same side *relative to travel* (the left-hand
 * normal of a→b), which is what keeps a return leg clear of its outbound twin:
 * b→a has the opposite travel direction, so its bulge lands on the other side
 * of the line. A fixed compass direction would put both bulges together and
 * defeat the point.
 */
export function controlPoint(a: LatLon, b: LatLon): LatLon {
  const [alat, alon] = a;
  const [blat, blon] = b;
  const mid: LatLon = [(alat + blat) / 2, (alon + blon) / 2];
  const dlat = blat - alat;
  const dlon = blon - alon;
  // Left-hand normal of the direction of travel.
  return [mid[0] - dlon * BULGE, mid[1] + dlat * BULGE];
}

/** Sample a quadratic Bézier, so Leaflet can draw the curve as a polyline. */
export function bezierLeg(a: LatLon, b: LatLon, steps = 24): LatLon[] {
  const c = controlPoint(a, b);
  const out: LatLon[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push([
      u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
      u * u * a[1] + 2 * u * t * c[1] + t * t * b[1],
    ]);
  }
  return out;
}

/**
 * The drawable Stops of a Journey, in travel order, each carrying the position
 * it occupies in the *full* route. Numbering counts every Stop the user wrote,
 * so a Stop that cannot be drawn leaves a gap in the numbers rather than
 * renumbering the ones after it (§19.8: skipped, never silently dropped).
 */
export interface RoutePoint {
  id: string;
  title: string;
  at: LatLon;
  /** 1-based position in the whole route, undrawable Stops included. */
  n: number;
}

interface StopLike {
  status: string;
  doc: { id: string; title: string; lat: number | null; lon: number | null } | null;
}

export function routePoints(stops: StopLike[]): RoutePoint[] {
  const out: RoutePoint[] = [];
  stops.forEach((s, i) => {
    const d = s.doc;
    if (s.status !== "ok" || !d || d.lat == null || d.lon == null) return;
    out.push({ id: d.id, title: d.title, at: [d.lat, d.lon], n: i + 1 });
  });
  return out;
}

/** How many Stops of a Journey cannot be drawn, for the Hub's warning. */
export function undrawable(stops: StopLike[]): number {
  return stops.filter((s) => s.status !== "ok").length;
}

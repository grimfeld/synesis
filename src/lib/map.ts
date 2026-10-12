// Map filtering (PLAN §19): the pure predicate behind the Map view's four
// filter axes, kept here so it is tested once (`test:unit`) and the view stays
// a dumb Leaflet shell — the `src/lib/timeline.ts` (§16.13) precedent.
//
// The axes are AND across, OR within (§19.5). The Timeline's type axis is dead
// here (everything is a Place) and its viewport cull is meaningless (the map is
// a viewport; panning already culls), so the four are Tags, title search, the
// Book a Place is mentioned in, and whether anything mentions it at all.
import type { DocSummary, GazetteerHit } from "./api";
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
  /**
   * What a pin's colour answers (PLAN §27.5). Not a filter: it hides nothing,
   * so it lives here only to share the store and the round trip to a Hub.
   */
  colorBy: ColorBy;
  /**
   * The Tags (by name) or Books (as numbers in text) the Tag or Book rule
   * colours, in chip order, at most `MAX_COLORED` (PLAN §27.6). Emptied when
   * the rule changes: a Tag is not a Book.
   */
  colored: string[];
}

export const NO_MAP_FILTERS: MapFilters = {
  tags: [],
  search: "",
  books: [],
  mentionedOnly: false,
  journeys: [],
  colorBy: "kind",
  colored: [],
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

// ---- the Stop picker on a Journey's Hub (PLAN §19.11)

/** Disambiguated gazetteer names ("Bethlehem 1") become plain titles. */
export function gazetteerTitle(name: string): string {
  return name.replace(/ \d+$/, "");
}

/** A choice in the Stop picker: a Place the Vault holds, or one to create from the gazetteer. */
export type StopChoice = { kind: "place"; doc: DocSummary } | { kind: "gazetteer"; hit: GazetteerHit; title: string };

/**
 * What the Stop picker offers for a query: the Vault's Places first, best
 * match first, then gazetteer entries the Vault does not already hold under
 * that name. A twelve-Stop Journey must not mean twelve trips to the New
 * Place dialog, and picking a gazetteer entry makes the Place (§19.11).
 */
export function stopChoices(query: string, places: DocSummary[], hits: GazetteerHit[], limit = 8): StopChoice[] {
  const q = fold(query.trim());
  if (!q) return [];
  const score = (title: string) => {
    const n = fold(title);
    return n.startsWith(q) ? 3 : n.includes(" " + q) ? 2 : n.includes(q) ? 1 : 0;
  };
  const own = places
    .map((doc) => ({ doc, s: score(doc.title) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.doc.title.length - b.doc.title.length || a.doc.title.localeCompare(b.doc.title))
    .map((x): StopChoice => ({ kind: "place", doc: x.doc }));
  const held = new Set(places.map((p) => fold(p.title)));
  const seen = new Set<string>();
  const found: StopChoice[] = [];
  for (const hit of hits) {
    const title = gazetteerTitle(hit.name);
    const key = fold(title);
    if (held.has(key) || seen.has(`${key}|${hit.lat}|${hit.lon}`)) continue;
    seen.add(`${key}|${hit.lat}|${hit.lon}`);
    found.push({ kind: "gazetteer", hit, title });
  }
  return [...own, ...found].slice(0, limit);
}

// ---------------------------------------------------------------------------
// Place kinds (PLAN §27.2–4)
// ---------------------------------------------------------------------------

/** The kinds that come with the app, in legend order (PLAN §27.3). */
export const BUILTIN_KINDS = ["settlement", "mountain", "water", "region", "site"] as const;
export type BuiltinKind = (typeof BUILTIN_KINDS)[number];

/**
 * A kind the user added (PLAN §27.4): the `kind:` text it answers to, the
 * label the legend shows, and one icon from the curated set. Stored in the
 * Vault, so every Paired Device draws the same pins.
 */
export interface CustomKind {
  name: string;
  label: string;
  icon: string;
}

/** A kind as the Map draws it, built-in or custom. */
export interface KindDef {
  name: string;
  /** The user's label for a custom kind; null for a built-in, which the UI translates. */
  label: string | null;
  /** A name from `PIN_ICONS`. */
  icon: string;
  /** CSS custom property of the kind's colour. */
  token: string;
  builtin: boolean;
}

/** Icons of the built-in kinds. A region has one for the legend, never a pin (§27.11). */
export const BUILTIN_ICONS: Record<BuiltinKind, string> = {
  settlement: "castle",
  mountain: "mountain",
  water: "waves",
  region: "map",
  site: "landmark",
};

/**
 * Colours for custom kinds, taken in turn (PLAN §27.4): no colour picker, so
 * nothing has to be chosen before the pin looks right.
 */
export const CUSTOM_KIND_TOKENS = [
  "--c-kind-custom-1",
  "--c-kind-custom-2",
  "--c-kind-custom-3",
  "--c-kind-custom-4",
] as const;

/**
 * The kinds this Vault knows: the five built-ins, then its custom kinds in
 * the order they were made. A custom kind that reuses a built-in's name, or an
 * earlier custom kind's, is shadowed: one name, one pin.
 */
export function kindCatalogue(custom: CustomKind[]): KindDef[] {
  const out: KindDef[] = BUILTIN_KINDS.map((k) => ({
    name: k,
    label: null,
    icon: BUILTIN_ICONS[k],
    token: `--c-kind-${k}`,
    builtin: true,
  }));
  const taken = new Set<string>(BUILTIN_KINDS);
  let n = 0;
  for (const c of custom) {
    const key = fold(c.name.trim());
    if (!key || taken.has(key)) continue;
    taken.add(key);
    out.push({
      name: c.name.trim(),
      label: c.label.trim() || c.name.trim(),
      icon: c.icon,
      token: CUSTOM_KIND_TOKENS[n++ % CUSTOM_KIND_TOKENS.length],
      builtin: false,
    });
  }
  return out;
}

/**
 * The kind a Place's `kind:` text names, matched ignoring case and accents so
 * a hand-typed `Mountain` is still a mountain. Null for no kind or one nobody
 * defined: the plain pin (PLAN §27.2).
 */
export function kindOf(raw: string | null | undefined, catalogue: KindDef[]): KindDef | null {
  const key = fold((raw ?? "").trim());
  if (!key) return null;
  return catalogue.find((k) => fold(k.name) === key) ?? null;
}

// ---------------------------------------------------------------------------
// Colour (PLAN §27.5–7)
// ---------------------------------------------------------------------------

/** What a pin's colour answers (PLAN §27.5). */
export type ColorBy = "kind" | "tag" | "book" | "none";
export const COLOR_BY: ColorBy[] = ["kind", "tag", "book", "none"];

/** How many values a Tag or Book rule may colour at once (PLAN §27.6). */
export const MAX_COLORED = 5;

/** How many colours one split pin shows before it says "+" (PLAN §27.6). */
export const MAX_SEGMENTS = 3;

/**
 * Add or remove a value from the coloured set. Adding past `MAX_COLORED` does
 * nothing: five colours is what a reader can hold apart, and silently dropping
 * the oldest would change a colour under the reader's eye.
 */
export function toggleColored(colored: string[], v: string): string[] {
  if (colored.includes(v)) return colored.filter((x) => x !== v);
  if (colored.length >= MAX_COLORED) return colored;
  return [...colored, v];
}

/** The colour of the nth coloured value: the route palette, in chip order. */
export function colorToken(i: number): string {
  return routeToken(i);
}

/** What one pin wears. */
export interface PinPaint {
  /** Colours, as CSS custom properties: one for a plain pin, several for a split one. */
  tokens: string[];
  /** Matched more coloured values than a split pin shows. */
  more: boolean;
  /** Outside the chosen values: grey, and quieter (PLAN §27.6). */
  muted: boolean;
}

/**
 * The paint of one Place's pin under the current rule. Colour highlights and
 * never hides: a Place the rule does not pick out is muted, not removed —
 * removing is the filters' job (PLAN §27.6).
 *
 * Under Tag or Book with nothing chosen yet, nothing is muted: an empty
 * choice is "not comparing anything", not "everything is Other".
 */
export function pinPaint(
  id: string,
  kind: KindDef | null,
  colorBy: ColorBy,
  colored: string[],
  facts: PlaceFacts,
): PinPaint {
  const plain = (token: string): PinPaint => ({ tokens: [token], more: false, muted: false });
  if (colorBy === "kind") return plain(kind?.token ?? "--c-place");
  if (colorBy === "none" || colored.length === 0) return plain("--c-place");
  const own =
    colorBy === "tag"
      ? new Set((facts.tags.get(id) ?? []).map(fold))
      : new Set((facts.books.get(id) ?? []).map(String));
  const hits: string[] = [];
  colored.forEach((v, i) => {
    if (own.has(colorBy === "tag" ? fold(v) : v)) hits.push(colorToken(i));
  });
  if (hits.length === 0) return { tokens: ["--c-place-muted"], more: false, muted: true };
  return { tokens: hits.slice(0, MAX_SEGMENTS), more: hits.length > MAX_SEGMENTS, muted: false };
}

/**
 * SVG paths dividing a disc of radius `r` centred on (r, r) into `n` equal
 * wedges, the first starting at twelve o'clock and running clockwise. One
 * wedge is the whole disc, drawn as a circle path so it has no seam.
 */
export function splitWedges(n: number, r: number): string[] {
  if (n <= 1) return [`M ${r} 0 A ${r} ${r} 0 1 1 ${r} ${2 * r} A ${r} ${r} 0 1 1 ${r} 0 Z`];
  const at = (i: number) => {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2;
    const x = r + r * Math.cos(a);
    const y = r + r * Math.sin(a);
    return `${round(x)} ${round(y)}`;
  };
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const large = 1 / n > 0.5 ? 1 : 0;
    out.push(`M ${r} ${r} L ${at(i)} A ${r} ${r} 0 ${large} 1 ${at(i + 1)} Z`);
  }
  return out;
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Labels (PLAN §27.10–11)
// ---------------------------------------------------------------------------

/** How a Place's name is set, by its kind, as printed atlases do (PLAN §27.10). */
export type LabelStyle = "place" | "water" | "mountain" | "region";

export function labelStyle(kind: KindDef | null): LabelStyle {
  switch (kind?.name) {
    case "water":
      return "water";
    case "mountain":
      return "mountain";
    case "region":
      return "region";
    default:
      return "place";
  }
}

/** A region is an area, shown by its name alone (PLAN §27.11). */
export function hasPin(kind: KindDef | null): boolean {
  return kind?.name !== "region";
}

/** A rectangle on screen, in pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A Place's name on screen, and how much it matters. */
export interface LabelBox extends Box {
  id: string;
  /**
   * A Journey's Stop: its name wins every collision with an ordinary Place's.
   * It can still hide — its number is in the badge on the pin, which never
   * does (§27.7) — so a route never covers someone else's pin with a name.
   */
  pinned?: boolean;
  /** Higher wins a collision: how many documents mention the Place. */
  weight: number;
  title: string;
}

/** A Place's pin on screen. Pins are never hidden; they are what names avoid. */
export interface PinBox extends Box {
  /** The Place it belongs to, matching its label's `id`. */
  id: string;
  weight: number;
  title: string;
  pinned?: boolean;
}

type Ranked = { id: string; weight: number; title: string; pinned?: boolean };

/** Importance order: Stops, then the most-mentioned, then by title and id so the answer is stable. */
function byRank(a: Ranked, b: Ranked): number {
  return (
    Number(!!b.pinned) - Number(!!a.pinned) ||
    b.weight - a.weight ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  );
}

function overlaps(a: Box, b: Box, gap: number): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * The names to hide so that none overlaps another name or someone else's pin,
 * and none labels a pin that cannot be seen (PLAN §27.10).
 *
 * A pin mostly buried under a more important one (Gethsemane under
 * Jerusalem, at a zoom that puts them 2px apart) loses its name first: a name
 * beside the visible pin would label the wrong Place. Then, greedy in order
 * of importance — Stops first — a name that would cover a pin or a name
 * already kept hides. Pins never hide, so a Stop never loses its number.
 */
export function hiddenLabels(labels: LabelBox[], pins: PinBox[] = [], gap = 2): Set<string> {
  const hidden = new Set<string>();
  const pinOf = new Map(pins.map((p) => [p.id, p]));
  for (const label of labels) {
    const own = pinOf.get(label.id);
    if (!own) continue;
    const buried = pins.some(
      (p) => p.id !== own.id && byRank(p, own) < 0 && overlapArea(p, own) > 0.4 * own.w * own.h,
    );
    if (buried) hidden.add(label.id);
  }
  const kept: Box[] = [];
  for (const label of [...labels].sort(byRank)) {
    if (hidden.has(label.id)) continue;
    const blocked =
      pins.some((p) => p.id !== label.id && overlaps(label, p, 0)) || kept.some((k) => overlaps(label, k, gap));
    if (blocked) hidden.add(label.id);
    else kept.push(label);
  }
  return hidden;
}

// ---------------------------------------------------------------------------
// Legend (PLAN §27.14)
// ---------------------------------------------------------------------------

/**
 * The kinds the legend lists: those with at least one Place on screen, in
 * catalogue order, and whether any Place on screen draws the plain pin.
 * Never the whole catalogue — it grows with custom kinds and would list
 * shapes that are nowhere on the map.
 */
export function legendKinds(
  kindsOnScreen: (KindDef | null)[],
  catalogue: KindDef[],
): { kinds: KindDef[]; plain: boolean } {
  const names = new Set(kindsOnScreen.filter(Boolean).map((k) => k!.name));
  return {
    kinds: catalogue.filter((k) => names.has(k.name)),
    plain: kindsOnScreen.some((k) => k === null),
  };
}

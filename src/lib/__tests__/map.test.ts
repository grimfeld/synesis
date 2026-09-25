// Map filtering (PLAN §19.5): four axes, AND across them, OR within each.
import { describe, expect, it } from "vitest";
import type { DocSummary, GazetteerHit } from "../api";
import {
  activeCount,
  gazetteerTitle,
  stopChoices,
  bezierLeg,
  controlPoint,
  filterPlaces,
  NO_FACTS,
  NO_MAP_FILTERS,
  placeBooks,
  placeTags,
  ROUTE_TOKENS,
  routePoints,
  routeToken,
  undrawable,
  type LatLon,
  type PlaceFacts,
} from "../map";

function place(id: string, title: string): DocSummary {
  return {
    id,
    path: `Places/${title}.md`,
    title,
    label: title,
    type: "place",
    mtime: 0,
    book: null,
    chapter: null,
    verse: null,
    lat: 31.7,
    lon: 35.2,
    first_verse: null,
    start: null,
    end: null,
  };
}

const EPHESUS = place("e", "Ephesus");
const CORINTH = place("c", "Corinth");
const BABYLON = place("b", "Babylon");
const PLACES = [EPHESUS, CORINTH, BABYLON];

// Acts is book 44, Revelation 66, Jeremiah 24 in the 66-book canon.
const FACTS: PlaceFacts = {
  tags: new Map([
    ["e", ["endurance", "paul"]],
    ["c", ["paul"]],
  ]),
  books: new Map([
    ["e", [44, 66]],
    ["c", [44]],
    ["b", [24]],
  ]),
  mentions: new Map([
    ["e", 3],
    ["c", 1],
    ["b", 0],
  ]),
};

const titles = (rows: DocSummary[]) => rows.map((r) => r.title);

describe("filterPlaces", () => {
  it("returns every Place when nothing is filtered", () => {
    expect(filterPlaces(PLACES, NO_MAP_FILTERS, FACTS)).toHaveLength(3);
  });

  it("matches titles case- and accent-insensitively", () => {
    const f = { ...NO_MAP_FILTERS, search: "ÉPHES" };
    // "Éphes" folds to "ephes", which is a prefix of "ephesus".
    expect(titles(filterPlaces(PLACES, f, FACTS))).toEqual(["Ephesus"]);
  });

  it("ORs within the Tag axis", () => {
    const f = { ...NO_MAP_FILTERS, tags: ["endurance", "nothing"] };
    expect(titles(filterPlaces(PLACES, f, FACTS))).toEqual(["Ephesus"]);
  });

  it("ORs within the Book axis", () => {
    const f = { ...NO_MAP_FILTERS, books: [24, 66] };
    expect(titles(filterPlaces(PLACES, f, FACTS))).toEqual([
      "Ephesus",
      "Babylon",
    ]);
  });

  it("ANDs across axes", () => {
    // Paul-tagged (Ephesus, Corinth) AND mentioned in Revelation (Ephesus).
    const f = { ...NO_MAP_FILTERS, tags: ["paul"], books: [66] };
    expect(titles(filterPlaces(PLACES, f, FACTS))).toEqual(["Ephesus"]);
  });

  it("hides unmentioned Places when mentionedOnly is on", () => {
    const f = { ...NO_MAP_FILTERS, mentionedOnly: true };
    expect(titles(filterPlaces(PLACES, f, FACTS))).toEqual([
      "Ephesus",
      "Corinth",
    ]);
  });

  it("treats a Place with no facts as matching nothing but a bare filter", () => {
    const f = { ...NO_MAP_FILTERS, tags: ["paul"] };
    expect(filterPlaces(PLACES, f, NO_FACTS)).toHaveLength(0);
    expect(filterPlaces(PLACES, NO_MAP_FILTERS, NO_FACTS)).toHaveLength(3);
  });

  it("ignores a search that is only whitespace", () => {
    const f = { ...NO_MAP_FILTERS, search: "   " };
    expect(filterPlaces(PLACES, f, FACTS)).toHaveLength(3);
  });
});

describe("activeCount", () => {
  it("counts nothing when no filter is set", () => {
    expect(activeCount(NO_MAP_FILTERS)).toBe(0);
  });

  it("does not count Journey chips, which add Places rather than hide them", () => {
    expect(
      activeCount({ ...NO_MAP_FILTERS, journeys: ["j1", "j2"] }),
    ).toBe(0);
  });

  it("counts each chip, a non-empty search, and mentionedOnly", () => {
    expect(
      activeCount({
        tags: ["paul", "endurance"],
        books: [44],
        search: "eph",
        mentionedOnly: true,
        journeys: [],
      }),
    ).toBe(5);
  });

  it("does not count a whitespace-only search", () => {
    expect(activeCount({ ...NO_MAP_FILTERS, search: "  " })).toBe(0);
  });
});

describe("route geometry", () => {
  const A: LatLon = [0, 0];
  const B: LatLon = [0, 10];

  it("bows a leg to one side of the straight line", () => {
    const mid = bezierLeg(A, B)[12];
    expect(mid[1]).toBeCloseTo(5, 5);
    // The midpoint of the curve leaves the straight line (which has lat 0).
    expect(Math.abs(mid[0])).toBeGreaterThan(0.1);
  });

  it("separates a return leg from its outbound twin", () => {
    // The bulge is relative to travel, so a→b and b→a bow to opposite sides.
    // Two Places visited twice must not draw one line on top of another.
    const out = controlPoint(A, B);
    const back = controlPoint(B, A);
    expect(Math.sign(out[0])).toBe(-Math.sign(back[0]));
    expect(out[0]).not.toBeCloseTo(back[0], 5);
  });

  it("starts and ends exactly on the Stops", () => {
    const leg = bezierLeg(A, B);
    expect(leg[0]).toEqual(A);
    expect(leg[leg.length - 1]).toEqual(B);
  });

  it("cycles the palette by index, wrapping and never going negative", () => {
    expect(routeToken(0)).toBe(ROUTE_TOKENS[0]);
    expect(routeToken(ROUTE_TOKENS.length)).toBe(ROUTE_TOKENS[0]);
    expect(routeToken(-1)).toBe(ROUTE_TOKENS[ROUTE_TOKENS.length - 1]);
  });
});

describe("routePoints", () => {
  const stop = (
    status: string,
    doc: { id: string; title: string; lat: number | null; lon: number | null } | null,
  ) => ({ status, doc });

  const ROUTE = [
    stop("ok", { id: "a", title: "Antioch", lat: 36.2, lon: 36.16 }),
    stop("no_coords", { id: "d", title: "Derbe", lat: null, lon: null }),
    stop("ok", { id: "e", title: "Ephesus", lat: 37.9, lon: 27.3 }),
    stop("unresolved", null),
    stop("ok", { id: "a", title: "Antioch", lat: 36.2, lon: 36.16 }),
  ];

  it("keeps only drawable Stops, in travel order", () => {
    expect(routePoints(ROUTE).map((p) => p.title)).toEqual([
      "Antioch",
      "Ephesus",
      "Antioch",
    ]);
  });

  it("numbers by position in the whole route, leaving gaps for skipped Stops", () => {
    // Derbe is 2 and cannot be drawn, so Ephesus stays 3 — renumbering would
    // misdescribe the route the user wrote.
    expect(routePoints(ROUTE).map((p) => p.n)).toEqual([1, 3, 5]);
  });

  it("counts what it could not draw", () => {
    expect(undrawable(ROUTE)).toBe(2);
    expect(undrawable([])).toBe(0);
  });

  it("draws a Place visited twice at both positions", () => {
    const pts = routePoints(ROUTE);
    expect(pts[0].id).toBe(pts[2].id);
    expect(pts[0].n).not.toBe(pts[2].n);
  });
});

describe("chip lists", () => {
  it("offers only Tags present on Places, deduplicated and sorted", () => {
    expect(placeTags(PLACES, FACTS)).toEqual(["endurance", "paul"]);
  });

  it("offers only Books present on Places, in canon order", () => {
    expect(placeBooks(PLACES, FACTS)).toEqual([24, 44, 66]);
  });

  it("offers nothing when no Place carries facts", () => {
    expect(placeTags(PLACES, NO_FACTS)).toEqual([]);
    expect(placeBooks(PLACES, NO_FACTS)).toEqual([]);
  });
});

describe("stopChoices", () => {
  const places = [place("a", "Antioch"), place("p", "Pisidian Antioch"), place("c", "Corinth")];
  const hit = (name: string, lat = 1, lon = 2): GazetteerHit => ({ name, lat, lon, modern_name: "", verses: 1 });

  it("offers nothing until something is typed", () => {
    expect(stopChoices("  ", places, [hit("Antioch 1")])).toEqual([]);
  });

  it("puts the Vault's Places first, best match first", () => {
    const got = stopChoices("antioch", places, [hit("Antioch 2", 36, 36)]);
    expect(got.map((c) => (c.kind === "place" ? c.doc.title : `+${c.title}`))).toEqual(["Antioch", "Pisidian Antioch"]);
  });

  it("offers gazetteer entries the Vault does not hold, as a plain title", () => {
    const got = stopChoices("phil", places, [hit("Philippi", 41, 24)]);
    expect(got).toEqual([{ kind: "gazetteer", hit: hit("Philippi", 41, 24), title: "Philippi" }]);
  });

  it("does not offer to create a Place the Vault already holds", () => {
    const got = stopChoices("cor", places, [hit("Corinth", 37.9, 22.9)]);
    expect(got.map((c) => c.kind)).toEqual(["place"]);
  });

  it("keeps two gazetteer places that share a name but not a location", () => {
    const got = stopChoices("beth", [], [hit("Bethlehem 1", 31.7, 35.2), hit("Bethlehem 2", 32.7, 35.2)]);
    expect(got).toHaveLength(2);
  });

  it("folds accents and case", () => {
    expect(stopChoices("CORÏNTH", places, []).map((c) => c.kind)).toEqual(["place"]);
  });

  it("gives disambiguated gazetteer names a plain title", () => {
    expect(gazetteerTitle("Bethlehem 1")).toBe("Bethlehem");
    expect(gazetteerTitle("Mount Sinai")).toBe("Mount Sinai");
  });
});

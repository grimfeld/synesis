// Map filtering (PLAN §19.5): four axes, AND across them, OR within each.
import { describe, expect, it } from "vitest";
import type { DocSummary, GazetteerHit } from "../api";
import {
  activeCount,
  hasPin,
  hiddenLabels,
  kindCatalogue,
  kindOf,
  labelStyle,
  legendKinds,
  MAX_COLORED,
  pinPaint,
  splitWedges,
  toggleColored,
  type LabelBox,
  type PinBox,
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
        ...NO_MAP_FILTERS,
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
  const hit = (name: string, lat = 1, lon = 2): GazetteerHit => ({ name, lat, lon, modern_name: "", verses: 1, kind: null });

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

describe("colour does not count as a filter", () => {
  it("leaves the active count alone, since it hides nothing (§27.6)", () => {
    expect(activeCount({ ...NO_MAP_FILTERS, colorBy: "tag", colored: ["paul"] })).toBe(0);
  });
});

// ---- Place kinds (PLAN §27.2–4)

describe("kindCatalogue and kindOf", () => {
  const cat = kindCatalogue([
    { name: "oasis", label: "Oasis", icon: "palmtree" },
    // Shadowed: a built-in owns this name.
    { name: "Mountain", label: "Peak", icon: "triangle" },
    // Shadowed: an earlier custom kind owns it.
    { name: "OASIS", label: "Again", icon: "tent" },
    { name: "  ", label: "blank", icon: "tent" },
  ]);

  it("lists the five built-ins first, then custom kinds in order", () => {
    expect(cat.map((k) => k.name)).toEqual(["settlement", "mountain", "water", "region", "site", "oasis"]);
    expect(cat[5]).toMatchObject({ label: "Oasis", icon: "palmtree", builtin: false, token: "--c-kind-custom-1" });
    expect(cat[0]).toMatchObject({ label: null, builtin: true, token: "--c-kind-settlement" });
  });

  it("matches kind text ignoring case and accents", () => {
    expect(kindOf("Mountain", cat)?.name).toBe("mountain");
    expect(kindOf(" OASIS ", cat)?.name).toBe("oasis");
  });

  it("answers null for no kind or one nobody defined: the plain pin", () => {
    expect(kindOf(null, cat)).toBeNull();
    expect(kindOf("", cat)).toBeNull();
    expect(kindOf("valley", cat)).toBeNull();
  });

  it("cycles custom colours past the palette rather than running out", () => {
    const many = kindCatalogue(["a", "b", "c", "d", "e"].map((n) => ({ name: n, label: n, icon: "tent" })));
    expect(many.slice(5).map((k) => k.token)).toEqual([
      "--c-kind-custom-1",
      "--c-kind-custom-2",
      "--c-kind-custom-3",
      "--c-kind-custom-4",
      "--c-kind-custom-1",
    ]);
  });

  it("gives a region no pin and sets names by kind", () => {
    expect(hasPin(kindOf("region", cat))).toBe(false);
    expect(hasPin(kindOf("site", cat))).toBe(true);
    expect(hasPin(null)).toBe(true);
    expect(labelStyle(kindOf("water", cat))).toBe("water");
    expect(labelStyle(kindOf("mountain", cat))).toBe("mountain");
    expect(labelStyle(kindOf("region", cat))).toBe("region");
    expect(labelStyle(kindOf("oasis", cat))).toBe("place");
    expect(labelStyle(null)).toBe("place");
  });
});

// ---- Colour (PLAN §27.5–7)

describe("pinPaint", () => {
  const cat = kindCatalogue([]);
  const mountain = kindOf("mountain", cat);

  it("colours by kind by default, and a kindless Place in the Place colour", () => {
    expect(pinPaint("e", mountain, "kind", [], FACTS).tokens).toEqual(["--c-kind-mountain"]);
    expect(pinPaint("e", null, "kind", [], FACTS).tokens).toEqual(["--c-place"]);
  });

  it("colours everything alike under None, and under Tag or Book with nothing chosen", () => {
    expect(pinPaint("e", mountain, "none", [], FACTS)).toEqual({ tokens: ["--c-place"], more: false, muted: false });
    expect(pinPaint("e", mountain, "tag", [], FACTS).muted).toBe(false);
  });

  it("gives each chosen Book its colour in chip order and mutes the rest", () => {
    // Revelation (66) chosen first, Acts (44) second.
    expect(pinPaint("c", null, "book", ["66", "44"], FACTS).tokens).toEqual(["--c-route-2"]);
    expect(pinPaint("b", null, "book", ["66", "44"], FACTS)).toEqual({ tokens: ["--c-place-muted"], more: false, muted: true });
  });

  it("splits the pin of a Place matching several values, keeping chip order", () => {
    expect(pinPaint("e", null, "book", ["66", "44"], FACTS).tokens).toEqual(["--c-route-1", "--c-route-2"]);
  });

  it("matches Tags ignoring case", () => {
    expect(pinPaint("c", null, "tag", ["PAUL"], FACTS).tokens).toEqual(["--c-route-1"]);
  });

  it("shows at most three wedges and says there are more", () => {
    const facts: PlaceFacts = { ...FACTS, tags: new Map([["x", ["a", "b", "c", "d"]]]) };
    const p = pinPaint("x", null, "tag", ["a", "b", "c", "d"], facts);
    expect(p.tokens).toHaveLength(3);
    expect(p.more).toBe(true);
  });
});

describe("toggleColored", () => {
  it("adds and removes, keeping order", () => {
    expect(toggleColored(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleColored(["a", "b"], "a")).toEqual(["b"]);
  });

  it("refuses a sixth value rather than dropping one", () => {
    const five = ["a", "b", "c", "d", "e"];
    expect(five).toHaveLength(MAX_COLORED);
    expect(toggleColored(five, "f")).toBe(five);
  });
});

describe("splitWedges", () => {
  it("draws one seamless disc for one colour", () => {
    expect(splitWedges(1, 10)).toHaveLength(1);
    expect(splitWedges(1, 10)[0]).not.toContain("L");
  });

  it("starts at twelve o'clock and runs clockwise", () => {
    const [a, b] = splitWedges(2, 10);
    expect(a).toBe("M 10 10 L 10 0 A 10 10 0 0 1 10 20 Z");
    expect(b).toBe("M 10 10 L 10 20 A 10 10 0 0 1 10 0 Z");
    expect(splitWedges(3, 10)).toHaveLength(3);
  });
});

// ---- Labels (PLAN §27.10)

describe("hiddenLabels", () => {
  const box = (id: string, x: number, weight: number, pinned = false): LabelBox => ({
    id,
    x,
    y: 0,
    w: 40,
    h: 12,
    weight,
    pinned,
    title: id,
  });
  const pin = (id: string, x: number, weight: number, pinned = false): PinBox => ({
    id,
    x,
    y: 0,
    w: 22,
    h: 22,
    weight,
    pinned,
    title: id,
  });

  it("keeps apart labels that do not collide", () => {
    expect(hiddenLabels([box("a", 0, 1), box("b", 100, 1)]).size).toBe(0);
  });

  it("hides the less-mentioned of two colliding labels", () => {
    expect([...hiddenLabels([box("quiet", 0, 1), box("busy", 20, 9)])]).toEqual(["quiet"]);
  });

  it("puts a Stop's name before a busier Place's", () => {
    expect([...hiddenLabels([box("stop", 0, 0, true), box("busy", 20, 99)])]).toEqual(["busy"]);
  });

  it("still hides a Stop's name that would cover someone else's pin; its number is on the pin", () => {
    const hidden = hiddenLabels([box("corinth", 12, 1, true)], [pin("corinth", -10, 1, true), pin("ephesus", 40, 9)]);
    expect([...hidden]).toEqual(["corinth"]);
    // Two Stops' names that collide: the busier keeps its name.
    expect([...hiddenLabels([box("s1", 0, 0, true), box("s2", 10, 5, true)])]).toEqual(["s1"]);
  });

  it("breaks ties by title, whatever order the Places came in", () => {
    const ab = hiddenLabels([box("a", 0, 1), box("b", 20, 1)]);
    const ba = hiddenLabels([box("b", 20, 1), box("a", 0, 1)]);
    expect([...ab]).toEqual(["b"]);
    expect([...ba]).toEqual(["b"]);
  });

  it("hides a name that would run under someone else's pin, not under its own", () => {
    // Corinth's name reaches Ephesus's pin; Ephesus is busier but pins never hide.
    const hidden = hiddenLabels([box("corinth", 12, 9), box("ephesus", 200, 1)], [pin("corinth", -10, 9), pin("ephesus", 40, 1)]);
    expect([...hidden]).toEqual(["corinth"]);
    expect(hiddenLabels([box("a", 12, 1)], [pin("a", 0, 1)]).size).toBe(0);
  });

  it("hides the name of a pin buried under a busier one, so it cannot label the wrong Place", () => {
    const labels = [box("gethsemane", 300, 2), box("jerusalem", 100, 50)];
    const pins = [pin("gethsemane", 2, 2), pin("jerusalem", 0, 50)];
    expect([...hiddenLabels(labels, pins)]).toEqual(["gethsemane"]);
    // Far enough apart, both keep their names.
    expect(hiddenLabels(labels, [pin("gethsemane", 30, 2), pin("jerusalem", 0, 50)]).size).toBe(0);
  });
});

// ---- Legend (PLAN §27.14)

describe("legendKinds", () => {
  it("lists only the kinds on screen, in catalogue order, and the plain pin if any", () => {
    const cat = kindCatalogue([{ name: "oasis", label: "Oasis", icon: "tent" }]);
    const on = [kindOf("site", cat), kindOf("settlement", cat), kindOf("site", cat), null];
    const l = legendKinds(on, cat);
    expect(l.kinds.map((k) => k.name)).toEqual(["settlement", "site"]);
    expect(l.plain).toBe(true);
    expect(legendKinds([kindOf("oasis", cat)], cat)).toEqual({ kinds: [cat[5]], plain: false });
  });
});

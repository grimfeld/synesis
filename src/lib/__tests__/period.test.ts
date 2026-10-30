// The Period (CONTEXT.md): one filter the Timeline and the Map share. The
// fixture asks the question the feature exists for, "prophets, 640–580 BCE".
import { describe, expect, it } from "vitest";
import type {
  BibleDate,
  DatedProperty,
  DocSummary,
  DocType,
  EventLink,
  PlaceTie,
  RegionMember,
} from "../api";
import {
  charactersAt,
  fieldToYear,
  filterByPeriod,
  formatPeriod,
  itemsOf,
  NO_PERIOD_FILTER,
  tiesOf,
  yearToField,
  type Period,
  type PeriodFilter,
} from "../period";

function doc(id: string, type: DocType): DocSummary {
  return {
    id,
    path: `${id}.md`,
    title: id,
    label: id,
    type,
    mtime: 0,
    book: null,
    chapter: null,
    verse: null,
    lat: null,
    lon: null,
    first_verse: null,
    start: null,
    end: null,
  };
}

/** A Date Property; `year` is astronomical, so 640 BCE is -639. */
function dated(d: DocSummary, name: string, year: number | null): DatedProperty {
  return {
    doc: d,
    name,
    text: String(year),
    date: year == null ? null : { year, month: null, day: null, approx: false },
    precision: year == null ? null : "year",
  };
}

const bce = (n: number) => 1 - n;

const jeremiah = doc("jeremiah", "character");
const isaiah = doc("isaiah", "character");
const paul = doc("paul", "character");
const habakkuk = doc("habakkuk", "character"); // undated
const fall = doc("fall-of-jerusalem", "event");
const exodus = doc("exodus", "event");
const josiahReform = doc("josiah-reform", "event"); // undated
const jerusalem = doc("jerusalem", "place"); // no Span
const babylon = doc("neo-babylonian-empire", "place");
const nineveh = doc("nineveh", "place"); // founded only
const rome = doc("rome", "place"); // ended only... in the far future, here
const timothy = doc("timothy", "character"); // died only
const lydia = doc("lydia", "character"); // born only

const rows: DatedProperty[] = [
  dated(jeremiah, "born", bce(650)),
  dated(jeremiah, "died", bce(570)),
  dated(isaiah, "born", bce(760)),
  dated(isaiah, "died", bce(680)),
  dated(paul, "born", 5),
  dated(paul, "died", 67),
  dated(fall, "start", bce(587)),
  dated(exodus, "start", bce(1446)),
  dated(babylon, "start", bce(626)),
  dated(babylon, "end", bce(539)),
  dated(nineveh, "start", bce(1800)),
  dated(rome, "end", 476),
  dated(timothy, "died", 97),
  dated(lydia, "born", 20),
];
const undatedDocs = [habakkuk, josiahReform, jerusalem];
const tags = new Map<string, string[]>([
  ["jeremiah", ["prophet"]],
  ["isaiah", ["prophet"]],
  ["habakkuk", ["Prophet"]],
  ["paul", ["apostle"]],
]);
const items = itemsOf(rows, undatedDocs, tags);

const period = (from: number | null, to: number | null): Period => ({ from, to });
const run = (f: Partial<PeriodFilter>) => {
  const r = filterByPeriod(items, { ...NO_PERIOD_FILTER, ...f });
  return { ids: r.visible.map((i) => i.doc.id).sort(), undated: r.undated };
};

describe("filterByPeriod", () => {
  it("shows what overlaps the Period and hides what lies wholly outside it", () => {
    const { ids } = run({ period: period(bce(640), bce(580)) });
    expect(ids).toContain("jeremiah"); // born before, alive within
    expect(ids).toContain("fall-of-jerusalem"); // a point within
    expect(ids).toContain("neo-babylonian-empire"); // begins within, ends after
    expect(ids).not.toContain("isaiah"); // died before it began
    expect(ids).not.toContain("paul"); // born long after
    expect(ids).not.toContain("exodus");
  });

  it("hides undated Characters and Events while a Period is set, and counts them", () => {
    const { ids, undated } = run({ period: period(bce(640), bce(580)) });
    expect(ids).not.toContain("habakkuk");
    expect(ids).not.toContain("josiah-reform");
    expect(undated).toBe(2);
  });

  it("hides nothing and counts nothing without a Period", () => {
    const { ids, undated } = run({});
    expect(ids).toHaveLength(items.length);
    expect(undated).toBe(0);
  });

  it("keeps a Place with no Span in every Period", () => {
    expect(run({ period: period(bce(640), bce(580)) }).ids).toContain("jerusalem");
    expect(run({ period: period(30, 60) }).ids).toContain("jerusalem");
  });

  it("runs a Place's Span missing one end on without limit that way", () => {
    // Nineveh has a `start` only: founded 1800 BCE, it still counts in 500 CE.
    expect(run({ period: period(500, 600) }).ids).toContain("nineveh");
    // Rome has an `end` only: it counts in any Period before 476 CE…
    expect(run({ period: period(bce(640), bce(580)) }).ids).toContain("rome");
    // …and in none after it.
    expect(run({ period: period(500, 600) }).ids).not.toContain("rome");
  });

  it("keeps a Character with a single Date at that Date alone", () => {
    // Timothy has only `died: 97 CE`: in a Period only if it contains 97 CE.
    expect(run({ period: period(bce(640), bce(580)) }).ids).not.toContain("timothy");
    expect(run({ period: period(90, 100) }).ids).toContain("timothy");
    // Lydia has only `born: 20 CE`: not still counted in 500 CE.
    expect(run({ period: period(500, 600) }).ids).not.toContain("lydia");
    expect(run({ period: period(20, 20) }).ids).toContain("lydia");
  });

  it("keeps an Event with only a `start` a single point, not an open Span", () => {
    // The Exodus happened once; it is not still happening in 640 BCE.
    expect(run({ period: period(bce(640), bce(580)) }).ids).not.toContain("exodus");
    expect(run({ period: period(bce(1450), bce(1440)) }).ids).toContain("exodus");
  });

  it("combines Tags with the Period: prophets, 640–580 BCE", () => {
    const { ids, undated } = run({
      period: period(bce(640), bce(580)),
      tags: ["PROPHET"],
    });
    expect(ids).toEqual(["jeremiah"]);
    // Habakkuk is a prophet with no Date: left out, and counted.
    expect(undated).toBe(1);
  });

  it("narrows by Tags alone, any of them, without a Period", () => {
    const { ids, undated } = run({ tags: ["prophet", "apostle"] });
    expect(ids).toEqual(["habakkuk", "isaiah", "jeremiah", "paul"]);
    expect(undated).toBe(0);
  });
});

// Places in the filter (CONTEXT.md: Period, Character): a Character is in a
// Place for life through its own `places`, or for an Event's time through an
// Event naming both; an Event is at its own `place`.
describe("filterByPeriod with Places", () => {
  const anathoth = doc("anathoth", "place"); // no Span
  const ephesus = doc("ephesus", "place"); // no Span
  const year = (y: number): BibleDate => ({ year: y, month: null, day: null, approx: false });
  const tie = (
    character: DocSummary,
    place: DocSummary,
    event: DocSummary | null = null,
    start: number | null = null,
    end: number | null = null,
  ): PlaceTie => ({
    character,
    place,
    event,
    start: start == null ? null : year(start),
    end: end == null ? null : year(end),
  });
  const ephesusStay = doc("paul-in-ephesus", "event");
  const placeTies = [
    tie(jeremiah, anathoth),
    tie(jeremiah, jerusalem),
    tie(isaiah, jerusalem),
    tie(habakkuk, jerusalem), // an undated prophet
    tie(paul, ephesus, ephesusStay, 52, 55),
  ];
  const eventLinks: EventLink[] = [
    { event: fall.id, subject: jerusalem.id },
    { event: ephesusStay.id, subject: ephesus.id },
  ];
  const ties = tiesOf(placeTies, eventLinks);
  const all = itemsOf(
    [...rows, dated(ephesusStay, "start", 52), dated(ephesusStay, "end", 55)],
    [...undatedDocs, anathoth, ephesus],
    tags,
  );
  const runP = (f: Partial<PeriodFilter>) => {
    const r = filterByPeriod(all, { ...NO_PERIOD_FILTER, ...f }, ties);
    return { ids: r.visible.map((i) => i.doc.id).sort(), undated: r.undated };
  };
  const placesOnly = (f: Partial<PeriodFilter>) =>
    runP(f).ids.filter((id) => all.find((i) => i.doc.id === id)!.doc.type === "place");

  it("keeps the chosen Places and what is tied to them, and nothing else", () => {
    expect(runP({ places: [jerusalem.id] }).ids).toEqual([
      "fall-of-jerusalem",
      "habakkuk",
      "isaiah",
      "jeremiah",
      "jerusalem",
    ]);
  });

  it("reads several Places as any of them", () => {
    expect(runP({ places: [anathoth.id, ephesus.id] }).ids).toEqual([
      "anathoth",
      "ephesus",
      "jeremiah",
      "paul",
      "paul-in-ephesus",
    ]);
  });

  it("holds a tie through an Event only for that Event's time", () => {
    // Paul is alive in 30–40 CE, but in Ephesus only in 52–55 CE.
    expect(runP({ places: [ephesus.id], period: period(30, 40) }).ids).toEqual(["ephesus"]);
    expect(runP({ places: [ephesus.id], period: period(50, 60) }).ids).toEqual([
      "ephesus",
      "paul",
      "paul-in-ephesus",
    ]);
  });

  it("combines Places with Tags and the Period: prophets in Jerusalem, 640–580 BCE", () => {
    const { ids, undated } = runP({
      places: [jerusalem.id],
      tags: ["prophet"],
      period: period(bce(640), bce(580)),
    });
    // Isaiah is a prophet of Jerusalem, but died before the Period began.
    // Jerusalem stays: a prophet is there in those years.
    expect(ids).toEqual(["jeremiah", "jerusalem"]);
    // Habakkuk is a prophet of Jerusalem with no Date: left out, and counted.
    expect(undated).toBe(1);
  });

  it("keeps a Place for a Tag carried by what is tied to it in the Period", () => {
    // Jeremiah, a prophet, is in Anathoth and Jerusalem in 640–580 BCE.
    expect(placesOnly({ tags: ["prophet"], period: period(bce(640), bce(580)) })).toEqual([
      "anathoth",
      "jerusalem",
    ]);
    // In 30–60 CE no prophet is anywhere, and no Place carries the Tag itself.
    expect(placesOnly({ tags: ["prophet"], period: period(30, 60) })).toEqual([]);
    // Paul, an apostle, is in Ephesus only while he stays there.
    expect(placesOnly({ tags: ["apostle"], period: period(30, 40) })).toEqual([]);
    expect(placesOnly({ tags: ["apostle"], period: period(50, 60) })).toEqual(["ephesus"]);
  });

  it("keeps a Place that carries a chosen Tag itself", () => {
    const tagged = itemsOf([], [ephesus], new Map([["ephesus", ["Apostle"]]]));
    const r = filterByPeriod(tagged, { ...NO_PERIOD_FILTER, tags: ["apostle"] }, []);
    expect(r.visible.map((i) => i.doc.id)).toEqual(["ephesus"]);
  });

  it("lists the Characters at a Place in the Period", () => {
    const at = (place: string, f: Partial<PeriodFilter>) =>
      (charactersAt(all, { ...NO_PERIOD_FILTER, ...f }, ties).get(place) ?? [])
        .map((d) => d.id)
        .sort();
    expect(at(jerusalem.id, {})).toEqual(["habakkuk", "isaiah", "jeremiah"]);
    expect(at(jerusalem.id, { period: period(bce(640), bce(580)) })).toEqual(["jeremiah"]);
    expect(at(ephesus.id, { period: period(30, 40) })).toEqual([]);
    expect(at(ephesus.id, { period: period(50, 60) })).toEqual(["paul"]);
    // The shared Tags narrow the list too.
    expect(at(jerusalem.id, { tags: ["apostle"] })).toEqual([]);
  });
});

describe("filterByPeriod with regions", () => {
  // Judah's Border takes in Jerusalem and Anathoth; Samaria has no Border.
  const judah = doc("judah", "place");
  const samaria = doc("samaria", "place");
  const anathoth = doc("anathoth", "place");
  const regions: RegionMember[] = [
    { place: jerusalem.id, region: judah.id },
    { place: anathoth.id, region: judah.id },
  ];
  const placeTies: PlaceTie[] = [jeremiah, isaiah, habakkuk].map((character) => ({
    character,
    place: jerusalem,
    event: null,
    start: null,
    end: null,
  }));
  const ties = tiesOf(placeTies, [{ event: fall.id, subject: jerusalem.id }]);
  const all = itemsOf(
    [...rows, dated(judah, "start", bce(930)), dated(judah, "end", bce(587))],
    [...undatedDocs, anathoth, samaria],
    tags,
  );
  const runR = (f: Partial<PeriodFilter>, members = regions) => {
    const r = filterByPeriod(all, { ...NO_PERIOD_FILTER, ...f }, ties, members);
    return { ids: r.visible.map((i) => i.doc.id).sort(), undated: r.undated };
  };

  it("takes in every Place inside a chosen region's Border, and what is tied to them", () => {
    expect(runR({ places: [judah.id] }).ids).toEqual([
      "anathoth",
      "fall-of-jerusalem",
      "habakkuk",
      "isaiah",
      "jeremiah",
      "jerusalem",
      "judah",
    ]);
  });

  it("answers prophets in Judah, 640–580 BCE", () => {
    const { ids, undated } = runR({
      places: [judah.id],
      tags: ["prophet"],
      period: period(bce(640), bce(580)),
    });
    // Jeremiah is in Jerusalem, inside Judah, in those years; Isaiah died
    // before them. Judah stays, a prophet being inside it; Anathoth, where
    // no prophet is tied, does not.
    expect(ids).toEqual(["jeremiah", "jerusalem", "judah"]);
    expect(undated).toBe(1);
  });

  it("lets a region contain only while it is in the Period", () => {
    // Judah (930–587 BCE) is gone by Paul's day: choosing it takes in nothing.
    expect(runR({ places: [judah.id], period: period(30, 60) }).ids).toEqual([]);
    // In its own years it takes in Jerusalem and Anathoth.
    expect(runR({ places: [judah.id], period: period(bce(700), bce(600)) }).ids).toContain(
      "anathoth",
    );
    // A region with no Span contains in every Period.
    const timeless = filterByPeriod(
      itemsOf(rows, [...undatedDocs, anathoth, samaria], tags),
      { ...NO_PERIOD_FILTER, places: [samaria.id], period: period(30, 60) },
      ties,
      [{ place: anathoth.id, region: samaria.id }],
    );
    expect(timeless.visible.map((i) => i.doc.id).sort()).toEqual(["anathoth", "samaria"]);
  });

  it("lists on a region the Characters at the Places inside it", () => {
    const at = (f: Partial<PeriodFilter>) =>
      (charactersAt(all, { ...NO_PERIOD_FILTER, ...f }, ties, regions).get(judah.id) ?? [])
        .map((d) => d.id)
        .sort();
    expect(at({ period: period(bce(640), bce(580)) })).toEqual(["jeremiah"]);
    // Outside Judah's own years it lists no one.
    expect(at({ period: period(30, 60) })).toEqual([]);
  });

  it("reads a region with no Border as containing nothing", () => {
    expect(runR({ places: [samaria.id] }).ids).toEqual(["samaria"]);
    // Nor does a region whose Border holds no Place.
    expect(runR({ places: [judah.id] }, []).ids).toEqual(["judah"]);
  });

  it("combines a region with another Place as any of them", () => {
    expect(runR({ places: [samaria.id, judah.id], tags: ["prophet"] }).ids).toEqual([
      "habakkuk",
      "isaiah",
      "jeremiah",
      "jerusalem",
      "judah",
    ]);
  });
});

describe("formatPeriod", () => {
  const eras = { bce: "BCE", ce: "CE" };
  it("names the era once when both ends share it", () => {
    expect(formatPeriod(period(bce(640), bce(580)), eras)).toBe("640–580 BCE");
    expect(formatPeriod(period(30, 60), eras)).toBe("30–60 CE");
  });
  it("names both eras when the Period crosses them", () => {
    expect(formatPeriod(period(bce(4), 30), eras)).toBe("4 BCE – 30 CE");
  });
  it("reads a lone year as itself, and an open end as a dash", () => {
    expect(formatPeriod(period(bce(587), bce(587)), eras)).toBe("587 BCE");
    expect(formatPeriod(period(bce(640), null), eras)).toBe("640 BCE –");
    expect(formatPeriod(period(null, 70), eras)).toBe("– 70 CE");
  });
  it("puts the ends in order whichever was typed first", () => {
    expect(formatPeriod(period(bce(580), bce(640)), eras)).toBe("640–580 BCE");
  });
});

describe("year fields", () => {
  it("turns a typed year and era into a Period end, and back", () => {
    expect(fieldToYear("640", true)).toBe(-639);
    expect(fieldToYear("30", false)).toBe(30);
    expect(fieldToYear("1", true)).toBe(0);
    expect(yearToField(-639)).toEqual({ text: "640", bce: true });
    expect(yearToField(30)).toEqual({ text: "30", bce: false });
    expect(yearToField(null)).toEqual({ text: "", bce: true });
  });
  it("reads an empty or nonsense field as an open end", () => {
    expect(fieldToYear("", true)).toBeNull();
    expect(fieldToYear("  ", false)).toBeNull();
    expect(fieldToYear("abc", true)).toBeNull();
    expect(fieldToYear("0", true)).toBeNull(); // there is no year 0
  });
});

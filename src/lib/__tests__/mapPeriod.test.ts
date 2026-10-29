// The Map in a Period (CONTEXT.md: Period, Map): Places through the Period
// module, Journeys that overlap it, and Events in it as marks at their Place.
import { describe, expect, it } from "vitest";
import type { DatedProperty, DocSummary, DocType, EventLink, Journey, PlaceTie } from "../api";
import { mapInPeriod } from "../mapPeriod";

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
    lat: type === "place" ? 31 : null,
    lon: type === "place" ? 35 : null,
    first_verse: null,
    start: null,
    end: null,
  };
}

function dated(d: DocSummary, name: string, year: number): DatedProperty {
  return {
    doc: d,
    name,
    text: String(year),
    date: { year, month: null, day: null, approx: false },
    precision: "year",
  };
}

const bce = (n: number) => 1 - n;

const jerusalem = doc("jerusalem", "place"); // no Span
const babylon = doc("babylon-empire", "place"); // 626–539 BCE
const ephesus = doc("ephesus", "place");
const fall = doc("fall-of-jerusalem", "event"); // 587 BCE, at Jerusalem
const pentecost = doc("pentecost", "event"); // 33 CE, at Jerusalem
const riot = doc("riot-at-ephesus", "event"); // undated, at Ephesus
const exile = doc("exile-road", "journey"); // 597–586 BCE
const paulTrip = doc("paul-trip", "journey"); // 49–52 CE
const wander = doc("wander", "journey"); // undated
const david = doc("david", "character");

const journey = (d: DocSummary): Journey => ({ doc: d, stops: [] });

const input = {
  places: [jerusalem, babylon, ephesus],
  journeys: [journey(exile), journey(paulTrip), journey(wander)],
  events: [fall, pentecost, riot],
  rows: [
    dated(babylon, "start", bce(626)),
    dated(babylon, "end", bce(539)),
    dated(fall, "start", bce(587)),
    dated(pentecost, "start", 33),
    dated(exile, "start", bce(597)),
    dated(exile, "end", bce(586)),
    dated(paulTrip, "start", 49),
    dated(paulTrip, "end", 52),
    dated(david, "born", bce(1107)),
  ],
  eventLinks: [
    { event: fall.id, subject: jerusalem.id },
    { event: pentecost.id, subject: jerusalem.id },
    { event: riot.id, subject: ephesus.id },
    // A Character named by an Event is not where the mark goes.
    { event: fall.id, subject: david.id },
  ] as EventLink[],
};

const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

describe("mapInPeriod", () => {
  it("draws every Place and Journey, and no Event marks, without a Period", () => {
    const r = mapInPeriod({ ...input, period: null });
    expect(ids(r.places)).toEqual(["babylon-empire", "ephesus", "jerusalem"]);
    expect(r.journeys.map((j) => j.doc.id)).toEqual(["exile-road", "paul-trip", "wander"]);
    expect(r.events).toEqual([]);
    expect(r.undated).toBe(0);
  });

  it("keeps the Places the Period module keeps", () => {
    const r = mapInPeriod({ ...input, period: { from: 30, to: 60 } });
    // Babylon fell in 539 BCE; Places with no Span stay.
    expect(ids(r.places)).toEqual(["ephesus", "jerusalem"]);
  });

  it("keeps only the Journeys whose Span overlaps the Period, and undated ones", () => {
    const r = mapInPeriod({ ...input, period: { from: bce(600), to: bce(580) } });
    expect(r.journeys.map((j) => j.doc.id)).toEqual(["exile-road", "wander"]);
  });

  it("marks the Events in the Period at their Place, and counts the undated", () => {
    const r = mapInPeriod({ ...input, period: { from: bce(600), to: bce(580) } });
    expect(r.events).toEqual([{ event: fall, place: jerusalem.id }]);
    // The riot at Ephesus has no Date: left out, and counted.
    expect(r.undated).toBe(1);
    const nt = mapInPeriod({ ...input, period: { from: 30, to: 60 } });
    expect(nt.events).toEqual([{ event: pentecost, place: jerusalem.id }]);
  });

  it("keeps a region with no coordinates only in the Periods its Span overlaps", () => {
    // Its Border is drawn without a pin, so the Period alone decides.
    const judah = { ...doc("judah", "place"), lat: null, lon: null };
    const edom = { ...doc("edom", "place"), lat: null, lon: null }; // no Span
    const rows = [...input.rows, dated(judah, "start", bce(930)), dated(judah, "end", bce(607))];
    const kept = (period: { from: number; to: number } | null) =>
      ids(mapInPeriod({ ...input, rows, regions: [judah, edom], period }).regions);
    expect(kept(null)).toEqual(["edom", "judah"]);
    expect(kept({ from: bce(640), to: bce(580) })).toEqual(["edom", "judah"]);
    expect(kept({ from: 30, to: 60 })).toEqual(["edom"]);
  });

  it("marks no Event at a Place the Period hides", () => {
    const r = mapInPeriod({
      ...input,
      eventLinks: [{ event: fall.id, subject: babylon.id }],
      period: { from: 30, to: 60 },
      rows: [...input.rows, dated(fall, "start", 40)].filter(
        (row) => !(row.doc.id === fall.id && row.date!.year < 0),
      ),
    });
    expect(r.events).toEqual([]);
  });
});

// The shared Tags and Places on the Map: the same rules as the Timeline's,
// through the ties (CONTEXT.md: Period, Character).
describe("mapInPeriod with the shared Tags and Places", () => {
  const peter = doc("peter", "character");
  const year = (y: number) => ({ year: y, month: null, day: null, approx: false });
  const shared = {
    ...input,
    rows: [...input.rows, dated(david, "died", bce(1037)), dated(peter, "born", 1), dated(peter, "died", 64)],
    characters: [david, peter],
    placeTies: [
      { character: david, place: jerusalem, event: null, start: null, end: null },
      { character: peter, place: jerusalem, event: pentecost, start: year(33), end: null },
    ] as PlaceTie[],
    tagsByDoc: new Map([
      ["david", ["king"]],
      ["peter", ["apostle"]],
      ["ephesus", ["apostle"]],
    ]),
  };

  it("keeps a Place carrying a shared Tag, or where someone carrying it is tied", () => {
    const kept = (tags: string[], period: { from: number; to: number } | null) =>
      ids(mapInPeriod({ ...shared, tags, period }).places);
    expect(kept(["king"], null)).toEqual(["jerusalem"]);
    expect(kept(["king"], { from: bce(1050), to: bce(1040) })).toEqual(["jerusalem"]);
    // David is dead by 30 CE: Jerusalem has no king then.
    expect(kept(["king"], { from: 30, to: 60 })).toEqual([]);
    // Ephesus carries "apostle" itself; Peter is in Jerusalem at Pentecost.
    expect(kept(["apostle"], { from: 30, to: 60 })).toEqual(["ephesus", "jerusalem"]);
    expect(kept(["apostle"], { from: 40, to: 60 })).toEqual(["ephesus"]);
  });

  it("draws only the chosen Places, any of them, and their Event marks", () => {
    const r = mapInPeriod({ ...shared, chosenPlaces: [ephesus.id, babylon.id], period: { from: 30, to: 60 } });
    // Babylon is chosen but lies outside the Period.
    expect(ids(r.places)).toEqual(["ephesus"]);
    expect(r.events).toEqual([]);
    // Journeys are routes, not Places: only the Period decides them.
    expect(r.journeys.map((j) => j.doc.id)).toEqual(["paul-trip", "wander"]);
  });

  it("draws a chosen region, the Places inside its Border, and their Event marks", () => {
    // Judah's Border takes in Jerusalem; it is drawn without a pin.
    const judah = { ...doc("judah", "place"), lat: null, lon: null };
    const rows = [...shared.rows, dated(judah, "start", bce(930)), dated(judah, "end", bce(587))];
    const r = mapInPeriod({
      ...shared,
      rows,
      regions: [judah],
      regionMembers: [{ place: jerusalem.id, region: judah.id }],
      chosenPlaces: [judah.id],
      period: { from: bce(640), to: bce(580) },
    });
    expect(ids(r.places)).toEqual(["jerusalem"]);
    expect(ids(r.regions)).toEqual(["judah"]);
    expect(r.events).toEqual([{ event: fall, place: jerusalem.id }]);
    // In Paul's day Judah's Border is hidden; Jerusalem, with no Span, still
    // lies where the Border was drawn, so choosing Judah still takes it in.
    const later = mapInPeriod({
      ...shared,
      rows,
      regions: [judah],
      regionMembers: [{ place: jerusalem.id, region: judah.id }],
      chosenPlaces: [judah.id],
      period: { from: 30, to: 60 },
    });
    expect(ids(later.regions)).toEqual([]);
    expect(ids(later.places)).toEqual(["jerusalem"]);
  });

  it("lists the Characters at each Place in the Period", () => {
    const at = (period: { from: number; to: number } | null) =>
      ids(mapInPeriod({ ...shared, period }).charactersAt.get(jerusalem.id) ?? []);
    expect(at(null)).toEqual(["david", "peter"]);
    expect(at({ from: bce(1050), to: bce(1040) })).toEqual(["david"]);
    expect(at({ from: 30, to: 40 })).toEqual(["peter"]);
    expect(at({ from: 40, to: 60 })).toEqual([]);
  });
});

// A Hub's view of Character↔Place ties: one row per Character (on a Place's
// Hub) or per Place (on a Character's Hub), with when each tie holds.
import { describe, expect, it } from "vitest";
import type { DocSummary, DocType, PlaceTie } from "../api";
import { hubTies } from "../ties";

function doc(id: string, title: string, type: DocType): DocSummary {
  return {
    id,
    path: `${title}.md`,
    title,
    label: title,
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

const david = doc("david", "David", "character");
const paul = doc("paul", "Paul", "character");
const bethlehem = doc("beth", "Bethlehem", "place");
const jerusalem = doc("jeru", "Jerusalem", "place");
const anointed = { ...doc("anoint", "David anointed king", "event"), start: "c. 1077 BCE" };
const visit = { ...doc("visit", "Paul in Jerusalem", "event"), start: "49 CE" };

function tie(character: DocSummary, place: DocSummary, event: DocSummary | null = null): PlaceTie {
  return { character, place, event, start: null, end: null };
}

describe("hubTies", () => {
  const ties = [
    tie(david, bethlehem),
    tie(david, jerusalem),
    tie(david, bethlehem, anointed),
    tie(paul, jerusalem, visit),
  ];

  it("on a Place's Hub, lists each Character once with every way they are there", () => {
    const rows = hubTies(ties, "jeru");
    expect(rows.map((r) => r.other.title)).toEqual(["David", "Paul"]);
    expect(rows[0]).toMatchObject({ lifelong: true, events: [] });
    expect(rows[1].lifelong).toBe(false);
    expect(rows[1].events.map((e) => e.id)).toEqual(["visit"]);
  });

  it("on a Character's Hub, merges a Place named in `places` with an Event there", () => {
    const rows = hubTies(ties, "david");
    expect(rows.map((r) => r.other.title)).toEqual(["Bethlehem", "Jerusalem"]);
    expect(rows[0].lifelong).toBe(true);
    expect(rows[0].events.map((e) => e.id)).toEqual(["anoint"]);
    expect(rows[1]).toMatchObject({ lifelong: true, events: [] });
  });

  it("ignores ties that do not touch the page", () => {
    expect(hubTies(ties, "nobody")).toEqual([]);
  });
});

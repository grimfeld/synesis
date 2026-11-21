// Kinship read the other way (ADR 0024): children, siblings and spouses on
// both sides, from edges stored once.
import { describe, expect, it } from "vitest";
import type { DocSummary, Kinship, KinRelation, KinshipWarning } from "../api";
import {
  checkAddChild,
  familyOf,
  hasKin,
  kinGraph,
  parentRoleOf,
  relationsOf,
  withSpouse,
  withoutSpouse,
  writtenLinks,
} from "../kinship";

function doc(id: string, title: string): DocSummary {
  return {
    id,
    path: `Characters/${title}.md`,
    title,
    label: title,
    type: "character",
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

const [abraham, sarah, hagar, isaac, ishmael, rebekah, esau, jacob] = [
  "Abraham",
  "Sarah",
  "Hagar",
  "Isaac",
  "Ishmael",
  "Rebekah",
  "Esau",
  "Jacob",
].map((t) => doc(t.toLowerCase(), t));
const [leah, rachel, reuben, judah, joseph, benjamin, dinah] = [
  "Leah",
  "Rachel",
  "Reuben",
  "Judah",
  "Joseph",
  "Benjamin",
  "Dinah",
].map((t) => doc(t.toLowerCase(), t));
const lot = doc("lot", "Lot");

function edge(character: DocSummary, relation: KinRelation, kin: DocSummary) {
  return { character, relation, kin };
}

/** As the engine answers: each tie once, on the side that names it. */
const kinship: Kinship = {
  edges: [
    edge(abraham, "spouse", sarah),
    edge(abraham, "spouse", hagar),
    edge(isaac, "father", abraham),
    edge(isaac, "mother", sarah),
    edge(isaac, "spouse", rebekah),
    edge(ishmael, "father", abraham),
    edge(ishmael, "mother", hagar),
    edge(esau, "father", isaac),
    edge(esau, "mother", rebekah),
    edge(jacob, "father", isaac),
    edge(jacob, "mother", rebekah),
    edge(jacob, "spouse", leah),
    edge(jacob, "spouse", rachel),
    // Named by both sides: one tie.
    edge(rachel, "spouse", jacob),
    edge(reuben, "father", jacob),
    edge(reuben, "mother", leah),
    edge(judah, "father", jacob),
    edge(judah, "mother", leah),
    edge(dinah, "father", jacob),
    edge(dinah, "mother", leah),
    edge(joseph, "father", jacob),
    edge(joseph, "mother", rachel),
    edge(benjamin, "father", jacob),
    edge(benjamin, "mother", rachel),
    // No mother named: stands under the father alone.
    edge(lot, "father", jacob),
  ],
  warnings: [],
  relations: [],
};

const titles = (ds: DocSummary[]) => ds.map((d) => d.title);

describe("familyOf", () => {
  const g = kinGraph(kinship);

  it("reads a Character's own father, mother and spouses", () => {
    const f = familyOf(g, "jacob");
    expect(f.father?.title).toBe("Isaac");
    expect(f.mother?.title).toBe("Rebekah");
    expect(titles(f.spouses)).toEqual(["Leah", "Rachel"]);
  });

  it("derives a parent's children, grouped under the mother each names", () => {
    const f = familyOf(g, "jacob");
    expect(
      f.children.map((c) => [c.other?.title ?? null, titles(c.children)]),
    ).toEqual([
      // In the order of the spouses, children by title.
      ["Leah", ["Dinah", "Judah", "Reuben"]],
      ["Rachel", ["Benjamin", "Joseph"]],
      // No mother named, last.
      [null, ["Lot"]],
    ]);
  });

  it("derives children for a father whose file names none", () => {
    const f = familyOf(g, "isaac");
    expect(f.children).toHaveLength(1);
    expect(f.children[0].other?.title).toBe("Rebekah");
    expect(titles(f.children[0].children)).toEqual(["Esau", "Jacob"]);
  });

  it("groups a mother's children under the father each names", () => {
    const f = familyOf(g, "rachel");
    expect(f.children.map((c) => [c.other?.title, titles(c.children)])).toEqual([
      ["Jacob", ["Benjamin", "Joseph"]],
    ]);
  });

  it("shows a spouse on both sides, even when only one names the other", () => {
    expect(titles(familyOf(g, "leah").spouses)).toEqual(["Jacob"]);
    expect(titles(familyOf(g, "hagar").spouses)).toEqual(["Abraham"]);
    expect(titles(familyOf(g, "rebekah").spouses)).toEqual(["Isaac"]);
    // Named on both sides: once, not twice.
    expect(titles(familyOf(g, "rachel").spouses)).toEqual(["Jacob"]);
    expect(titles(familyOf(g, "jacob").spouses)).toEqual(["Leah", "Rachel"]);
  });

  it("derives siblings with the parents they share, half-siblings included", () => {
    const isaacs = familyOf(g, "isaac").siblings;
    expect(isaacs.map((s) => [titles(s.parents), titles(s.siblings)])).toEqual([
      [["Abraham"], ["Ishmael"]],
    ]);
    const josephs = familyOf(g, "joseph").siblings;
    expect(josephs.map((s) => [titles(s.parents), titles(s.siblings)])).toEqual([
      // Both parents first, then the father's side.
      [["Jacob", "Rachel"], ["Benjamin"]],
      [["Jacob"], ["Dinah", "Judah", "Lot", "Reuben"]],
    ]);
    expect(titles(familyOf(g, "jacob").siblings[0].siblings)).toEqual(["Esau"]);
  });

  it("leaves what is not named empty", () => {
    const f = familyOf(g, "abraham");
    expect(f.father).toBeNull();
    expect(f.mother).toBeNull();
    expect(f.siblings).toEqual([]);
    expect(familyOf(g, "nobody")).toMatchObject({
      father: null,
      mother: null,
      spouses: [],
      children: [],
      siblings: [],
    });
  });

  it("gives each Character the warnings about their own Kinship", () => {
    const w: KinshipWarning = {
      kind: "two_values",
      character: lot,
      property: "father",
      targets: ["Abraham", "Haran"],
    };
    const g2 = kinGraph({ ...kinship, warnings: [w] });
    expect(familyOf(g2, "lot").warnings).toEqual([w]);
    expect(familyOf(g2, "jacob").warnings).toEqual([]);
  });
});

// Editing Kinship from the Family section (#152).
describe("Add child", () => {
  const g = kinGraph(kinship);

  it("asks a Character who is nobody's parent yet", () => {
    expect(parentRoleOf(g, "joseph")).toBeNull();
    expect(parentRoleOf(g, "nobody")).toBeNull();
  });

  it("defaults to the role the Character already plays", () => {
    expect(parentRoleOf(g, "isaac")).toBe("father");
    expect(parentRoleOf(g, "rebekah")).toBe("mother");
  });

  it("asks every time a Character who is both someone's father and someone's mother", () => {
    const both = kinGraph({
      edges: [edge(esau, "father", isaac), edge(dinah, "mother", isaac)],
      warnings: [],
      relations: [],
    });
    expect(parentRoleOf(both, "isaac")).toBeNull();
  });

  const link = (text: string, d: DocSummary | null) => ({ text, doc: d && { id: d.id, title: d.title } });

  it("writes a child's parent only when unset", () => {
    expect(checkAddChild([], "isaac")).toEqual({ kind: "write" });
    expect(checkAddChild([link("[[Isaac]]", isaac)], "isaac")).toEqual({ kind: "already" });
  });

  it("refuses a child who already has another parent, naming them", () => {
    expect(checkAddChild([link("[[Abraham]]", abraham)], "isaac")).toEqual({ kind: "refused", existing: "Abraham" });
    // A link to no Character is still a parent written: named as written.
    expect(checkAddChild([link("[[Terah|the father]]", null)], "isaac")).toEqual({
      kind: "refused",
      existing: "Terah",
    });
    // Two written, one of them this parent: the other is named.
    expect(checkAddChild([link("[[Isaac]]", isaac), link("[[Abraham]]", abraham)], "isaac")).toEqual({
      kind: "refused",
      existing: "Abraham",
    });
  });

  it("reads a Kinship Property as written, one value or a list", () => {
    expect(writtenLinks("[[Isaac]]")).toEqual(["[[Isaac]]"]);
    expect(writtenLinks(["[[Leah]]", " [[Rachel]] ", ""])).toEqual(["[[Leah]]", "[[Rachel]]"]);
    expect(writtenLinks(null)).toEqual([]);
    expect(writtenLinks(undefined)).toEqual([]);
  });
});

describe("Spouses", () => {
  const link = (text: string, d: DocSummary | null) => ({ text, doc: d && { id: d.id, title: d.title } });

  it("adds a spouse at the end, keeping the others as written", () => {
    expect(withSpouse([link("[[leah|Leah]]", leah)], "[[Rachel]]", "rachel")).toEqual(["[[leah|Leah]]", "[[Rachel]]"]);
    expect(withSpouse([], "[[Leah]]", "leah")).toEqual(["[[Leah]]"]);
    // Already named: nothing to write.
    expect(withSpouse([link("[[Leah]]", leah)], "[[Leah]]", "leah")).toBeNull();
  });

  it("removes only the entries naming that spouse, and the Property with the last", () => {
    expect(withoutSpouse([link("[[Leah]]", leah), link("[[Rachel]]", rachel)], "leah")).toEqual(["[[Rachel]]"]);
    expect(withoutSpouse([link("[[Leah]]", leah)], "leah")).toBeNull();
  });
});

describe("relationsOf", () => {
  const [elijah, elisha, gehazi] = ["Elijah", "Elisha", "Gehazi"].map((t) => doc(t.toLowerCase(), t));
  const k: Kinship = {
    edges: [],
    warnings: [],
    relations: [
      { character: elisha, property: "mentor", other: elijah },
      { character: gehazi, property: "master", other: elisha },
      { character: elisha, property: "servants", other: gehazi },
    ],
  };
  const rows = (id: string) =>
    relationsOf(k, id).map((r) => [r.property, r.inverse, r.other.title]);

  it("lists the Relations a Character names, then those naming them", () => {
    expect(rows("elisha")).toEqual([
      ["mentor", false, "Elijah"],
      ["servants", false, "Gehazi"],
      ["master", true, "Gehazi"],
    ]);
  });

  it("shows a Relation on the other end as its inverse", () => {
    expect(rows("elijah")).toEqual([["mentor", true, "Elisha"]]);
  });

  it("is empty for a Character with none", () => {
    expect(relationsOf(k, "abraham")).toEqual([]);
  });
});

describe("hasKin", () => {
  it("holds for a Character naming kin, and for one only named", () => {
    expect(hasKin(kinship, "lot")).toBe(true);
    // Sarah names no one; Abraham and Isaac name her.
    expect(hasKin(kinship, "sarah")).toBe(true);
  });

  it("fails for a Character in no tie", () => {
    expect(hasKin(kinship, "paul")).toBe(false);
    expect(hasKin({ edges: [], warnings: [], relations: [] }, "jacob")).toBe(false);
  });
});

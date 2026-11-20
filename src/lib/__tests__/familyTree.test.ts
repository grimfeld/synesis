// The Family tree's layout (PLAN §32): rows by generation, each Character
// drawn once, unrelated families side by side, children under their mother,
// and a cycle broken rather than followed forever.
import { describe, expect, it } from "vitest";
import type { DocSummary, Kinship, KinRelation } from "../api";
import { kinGraph } from "../kinship";
import { BOX_HEIGHT, COUPLE_GAP, familyLayout, packRow, type FamilyLayout } from "../familyTree";

function doc(title: string): DocSummary {
  return {
    id: title.toLowerCase(),
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

/** Edges as the engine answers them: `[child-or-spouse, relation, kin]` by title. */
function layout(edges: [string, KinRelation, string][]): FamilyLayout {
  const k: Kinship = {
    edges: edges.map(([c, relation, kin]) => ({ character: doc(c), relation, kin: doc(kin) })),
    warnings: [],
    relations: [],
  };
  return familyLayout(kinGraph(k));
}

const patriarchs: [string, KinRelation, string][] = [
  ["Abraham", "father", "Terah"],
  ["Sarah", "father", "Terah"],
  ["Abraham", "spouse", "Sarah"],
  ["Abraham", "spouse", "Hagar"],
  ["Isaac", "father", "Abraham"],
  ["Isaac", "mother", "Sarah"],
  ["Ishmael", "father", "Abraham"],
  ["Ishmael", "mother", "Hagar"],
  ["Isaac", "spouse", "Rebekah"],
  ["Jacob", "father", "Isaac"],
  ["Jacob", "mother", "Rebekah"],
  ["Esau", "father", "Isaac"],
  ["Esau", "mother", "Rebekah"],
  ["Jacob", "spouse", "Leah"],
  ["Jacob", "spouse", "Rachel"],
  ["Reuben", "father", "Jacob"],
  ["Reuben", "mother", "Leah"],
  ["Judah", "father", "Jacob"],
  ["Judah", "mother", "Leah"],
  ["Joseph", "father", "Jacob"],
  ["Joseph", "mother", "Rachel"],
  ["Benjamin", "father", "Jacob"],
  ["Benjamin", "mother", "Rachel"],
  // No mother named: hangs from the father alone.
  ["Dinah", "father", "Jacob"],
];

const box = (l: FamilyLayout, id: string) => {
  const found = l.people.filter((p) => p.id === id);
  expect(found, id).toHaveLength(1);
  return found[0];
};
const center = (l: FamilyLayout, id: string) => box(l, id).x + box(l, id).width / 2;
const lineTo = (l: FamilyLayout, id: string) => l.lines.find((x) => x.child === id)!;

describe("familyLayout", () => {
  const l = layout(patriarchs);

  it("puts each generation in its own row, from parent links", () => {
    const gen = (id: string) => box(l, id).generation;
    expect(gen("terah")).toBe(0);
    expect([gen("abraham"), gen("sarah")]).toEqual([1, 1]);
    expect([gen("isaac"), gen("ishmael")]).toEqual([2, 2]);
    expect(gen("jacob")).toBe(3);
    expect(gen("joseph")).toBe(4);
    // Spouses with no parents drawn sit beside their partner.
    expect(gen("hagar")).toBe(gen("abraham"));
    expect(gen("rebekah")).toBe(gen("isaac"));
    expect(gen("leah")).toBe(gen("jacob"));
    // One row is one height.
    expect(box(l, "jacob").y).toBe(box(l, "leah").y);
    expect(box(l, "joseph").y).toBeGreaterThan(box(l, "jacob").y + BOX_HEIGHT);
  });

  it("draws each Character once, with a line from each parent path", () => {
    const ids = l.people.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(16);
    // Abraham and Sarah, half-siblings through Terah and spouses: one box each,
    // a line from Terah to each, and the bar between them.
    expect(lineTo(l, "abraham").parents).toEqual(["terah"]);
    expect(lineTo(l, "sarah").parents).toEqual(["terah"]);
    expect(l.couples.some((c) => [c.a, c.b].sort().join() === "abraham,sarah" && c.named)).toBe(true);
    // Every line ends on the top of its child's box.
    for (const line of l.lines) {
      const [x, y] = line.points.at(-1)!;
      expect(x).toBeCloseTo(center(l, line.child));
      expect(y).toBe(box(l, line.child).y);
    }
  });

  it("hangs children under the mother each names, and the rest under the father", () => {
    const dropOf = (a: string, b: string) =>
      l.couples.find((c) => [c.a, c.b].sort().join() === [a, b].sort().join())!.dropX;
    expect(lineTo(l, "reuben").points[0][0]).toBe(dropOf("jacob", "leah"));
    expect(lineTo(l, "judah").points[0][0]).toBe(dropOf("jacob", "leah"));
    expect(lineTo(l, "joseph").points[0][0]).toBe(dropOf("jacob", "rachel"));
    expect(dropOf("jacob", "leah")).not.toBe(dropOf("jacob", "rachel"));
    // Dinah, no mother named: from the bottom of Jacob's own box.
    const [x, y] = lineTo(l, "dinah").points[0];
    expect(x).toBeCloseTo(center(l, "jacob"));
    expect(y).toBe(box(l, "jacob").y + BOX_HEIGHT);
    // Each wife's drop sits between Jacob and her, on the bar.
    const between = (d: number, a: string, b: string) => {
      const [lo, hi] = [center(l, a), center(l, b)].sort((p, q) => p - q);
      return d > lo && d < hi;
    };
    expect(between(dropOf("jacob", "leah"), "jacob", "leah")).toBe(true);
    expect(between(dropOf("jacob", "rachel"), "jacob", "rachel")).toBe(true);
  });

  it("never lets two boxes in a row overlap", () => {
    const rows = new Map<number, typeof l.people>();
    for (const p of l.people) rows.set(p.y, [...(rows.get(p.y) ?? []), p]);
    for (const row of rows.values()) {
      const sorted = [...row].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i++)
        expect(sorted[i].x).toBeGreaterThanOrEqual(sorted[i - 1].x + sorted[i - 1].width);
    }
  });

  it("lays unrelated families side by side, each from the top row", () => {
    const two = layout([
      ...patriarchs,
      ["Samuel", "father", "Elkanah"],
      ["Samuel", "mother", "Hannah"],
      ["Elkanah", "spouse", "Hannah"],
    ]);
    expect(two.families).toBe(2);
    // The larger family first, then the other to its right.
    const first = two.people.filter((p) => p.family === 0);
    const second = two.people.filter((p) => p.family === 1);
    expect(second.map((p) => p.id).sort()).toEqual(["elkanah", "hannah", "samuel"]);
    const right = Math.max(...first.map((p) => p.x + p.width));
    expect(Math.min(...second.map((p) => p.x))).toBeGreaterThan(right);
    expect(box(two, "elkanah").y).toBe(box(two, "terah").y);
    expect(box(two, "samuel").generation).toBe(1);
  });

  it("leaves out Characters with no kin", () => {
    expect(l.people.some((p) => p.id === "paul")).toBe(false);
    expect(layout([])).toMatchObject({ people: [], families: 0, width: 0, height: 0 });
  });

  it("breaks a cycle and draws the rest", () => {
    const c = layout([
      ["Cain", "father", "Enoch"],
      ["Enoch", "father", "Irad"],
      ["Irad", "father", "Cain"],
      ["Seth", "father", "Adam"],
    ]);
    expect(c.skipped).toBe(1);
    expect(c.people.map((p) => p.id).sort()).toEqual(["adam", "cain", "enoch", "irad", "seth"]);
    expect(c.lines).toHaveLength(3);
    for (const p of c.people) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });

  it("stands a spouse with no parents in their partner's row, even when they bore another's child", () => {
    // Tamar married Er, then bore Judah's son Perez: she stands beside Er, the
    // marriage bar level, and the bar to Judah slopes.
    const t = layout([
      ["Er", "father", "Judah"],
      ["Er", "spouse", "Tamar"],
      ["Perez", "father", "Judah"],
      ["Perez", "mother", "Tamar"],
    ]);
    expect(new Set(t.people.map((p) => p.id)).size).toBe(t.people.length);
    const gen = (id: string) => box(t, id).generation;
    expect(gen("judah")).toBe(0);
    expect(gen("er")).toBe(1);
    expect(gen("tamar")).toBe(1);
    expect(gen("perez")).toBe(2);
    const bars = t.couples.filter((c) => c.a === "tamar" || c.b === "tamar");
    expect(bars).toHaveLength(2);
    const marriage = bars.find((c) => c.named)!;
    expect(marriage.y1).toBe(marriage.y2);
    const perez = lineTo(t, "perez");
    expect(perez.parents.sort()).toEqual(["judah", "tamar"]);
    expect(perez.points.at(-1)![1]).toBe(box(t, "perez").y);
  });

  it("stands a chain of spouses with no parents in the row of the one who has them", () => {
    // A marries B, B marries C, C marries Isaac: all three in Isaac's row.
    const t = layout([
      ["Isaac", "father", "Abraham"],
      ["Cee", "spouse", "Isaac"],
      ["Bee", "spouse", "Cee"],
      ["Ay", "spouse", "Bee"],
    ]);
    const gen = (id: string) => box(t, id).generation;
    expect([gen("ay"), gen("bee"), gen("cee")]).toEqual([1, 1, 1]);
    expect(gen("isaac")).toBe(1);
  });

  it("draws a child whose father and mother name the same Character, from that one parent", () => {
    const t = layout([
      ["Obed", "father", "Boaz"],
      ["Obed", "mother", "Boaz"],
      ["Jesse", "father", "Obed"],
    ]);
    expect(t.people.map((p) => p.id).sort()).toEqual(["boaz", "jesse", "obed"]);
    expect(lineTo(t, "obed").parents).toEqual(["boaz"]);
    const [x] = lineTo(t, "obed").points[0];
    expect(x).toBeCloseTo(center(t, "boaz"));
    for (const p of t.people) expect(Number.isFinite(p.x)).toBe(true);
  });

  it("joins a wife with two husbands to each by a bar spanning only the two of them", () => {
    // Ruth married Mahlon, then Boaz; a child of each marriage (the first made up).
    const r = layout([
      ["Ruth", "spouse", "Mahlon"],
      ["Ruth", "spouse", "Boaz"],
      ["Obed", "father", "Boaz"],
      ["Obed", "mother", "Ruth"],
      ["Mara", "father", "Mahlon"],
      ["Mara", "mother", "Ruth"],
    ]);
    const rowOf = (id: string) => r.people.filter((p) => p.y === box(r, id).y);
    for (const [husband, child] of [
      ["boaz", "obed"],
      ["mahlon", "mara"],
    ]) {
      const [lo, hi] = [box(r, "ruth"), box(r, husband)].sort((a, b) => a.x - b.x);
      // No box stands between Ruth and this husband.
      expect(rowOf("ruth").filter((p) => p.x > lo.x && p.x < hi.x), husband).toEqual([]);
      // The child drops in the gap between them.
      const [x] = lineTo(r, child).points[0];
      expect(x, child).toBeGreaterThan(lo.x + lo.width);
      expect(x, child).toBeLessThan(hi.x);
    }
  });

  it("puts every wife's children in the gap on her husband's side when he has many wives", () => {
    const j = layout([
      ["Jacob", "spouse", "Leah"],
      ["Jacob", "spouse", "Rachel"],
      ["Jacob", "spouse", "Bilhah"],
      ["Jacob", "spouse", "Zilpah"],
      ["Reuben", "father", "Jacob"],
      ["Reuben", "mother", "Leah"],
      ["Joseph", "father", "Jacob"],
      ["Joseph", "mother", "Rachel"],
      ["Dan", "father", "Jacob"],
      ["Dan", "mother", "Bilhah"],
      ["Gad", "father", "Jacob"],
      ["Gad", "mother", "Zilpah"],
    ]);
    const jacob = center(j, "jacob");
    const drops = new Set<number>();
    for (const [wife, child] of [
      ["leah", "reuben"],
      ["rachel", "joseph"],
      ["bilhah", "dan"],
      ["zilpah", "gad"],
    ]) {
      const w = box(j, wife);
      const [x] = lineTo(j, child).points[0];
      drops.add(x);
      // Between Jacob and her, right next to her box.
      if (w.x > jacob) {
        expect(x, wife).toBeGreaterThan(jacob);
        expect(x, wife).toBeLessThan(w.x);
        expect(w.x - x, wife).toBeLessThanOrEqual(COUPLE_GAP);
      } else {
        expect(x, wife).toBeLessThan(jacob);
        expect(x, wife).toBeGreaterThan(w.x + w.width);
        expect(x - (w.x + w.width), wife).toBeLessThanOrEqual(COUPLE_GAP);
      }
    }
    expect(drops.size).toBe(4);
  });

  it("never throws on bad edges", () => {
    expect(() =>
      layout([
        ["Abel", "father", "Abel"],
        ["Abel", "mother", "Abel"],
        ["Abel", "spouse", "Abel"],
        ["Seth", "father", "Adam"],
        ["Seth", "mother", "Adam"],
        ["Adam", "spouse", "Seth"],
        ["Adam", "father", "Seth"],
      ]),
    ).not.toThrow();
  });

  it("is quick for hundreds of Characters", () => {
    const edges: [string, KinRelation, string][] = [];
    for (let i = 1; i < 600; i++) edges.push([`P${i}`, "father", `P${Math.floor((i - 1) / 3)}`]);
    const started = performance.now();
    const big = layout(edges);
    expect(big.people).toHaveLength(600);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("packRow", () => {
  it("keeps the desired places when they fit, and spreads them evenly when not", () => {
    expect(packRow([0, 100, 200], [50, 50, 50], 10)).toEqual([0, 100, 200]);
    // Both want 0: they share the overlap.
    expect(packRow([0, 0], [40, 40], 10)).toEqual([-25, 25]);
  });
});

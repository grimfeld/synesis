// The Family tree's layout (PLAN §32): rows by generation, each Character
// drawn once, unrelated families side by side, children under their mother,
// and a cycle broken rather than followed forever.
import { describe, expect, it } from "vitest";
import type { DocSummary, Kinship, KinRelation } from "../api";
import { kinGraph } from "../kinship";
import { BOX_HEIGHT, familyLayout, packRow, type FamilyLayout } from "../familyTree";

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

  it("keeps a spouse in another row joined to their partner", () => {
    // Tamar married Er, then bore Judah's sons: two rows, both bars drawn.
    const t = layout([
      ["Er", "father", "Judah"],
      ["Er", "spouse", "Tamar"],
      ["Perez", "father", "Judah"],
      ["Perez", "mother", "Tamar"],
    ]);
    expect(new Set(t.people.map((p) => p.id)).size).toBe(t.people.length);
    expect(t.couples.filter((c) => c.a === "tamar" || c.b === "tamar")).toHaveLength(2);
    const perez = lineTo(t, "perez");
    expect(perez.parents.sort()).toEqual(["judah", "tamar"]);
    expect(perez.points.at(-1)![1]).toBe(box(t, "perez").y);
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

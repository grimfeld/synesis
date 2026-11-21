// The Family tree's layout (PLAN §32): rows by generation, each Character
// drawn once, unrelated families side by side, children under their mother,
// and a cycle broken rather than followed forever.
import { describe, expect, it } from "vitest";
import type { DocSummary, Kinship, KinRelation } from "../api";
import { kinGraph } from "../kinship";
import {
  BOX_HEIGHT,
  COUPLE_GAP,
  familyLayout,
  laneLevels,
  packRow,
  type FamilyLayout,
  type GapRun,
} from "../familyTree";

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
    edges: edges.map(([c, relation, kin]) => ({
      character: doc(c),
      relation,
      kin: doc(kin),
    })),
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
    expect(layout([])).toMatchObject({
      people: [],
      families: 0,
      width: 0,
      height: 0,
    });
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

  /** Two parents per child, by title: `[child, father, mother]`. */
  const born = (...kids: [string, string, string][]): [string, KinRelation, string][] =>
    kids.flatMap(([c, f, m]): [string, KinRelation, string][] => [
      [c, "father", f],
      [c, "mother", m],
    ]);
  /** The boxes a line's straight segments pass through, its own child's aside. */
  const boxesHit = (t: FamilyLayout, child: string) => {
    const pts = lineTo(t, child).points;
    const hit = new Set<string>();
    for (let i = 1; i < pts.length; i++) {
      const [[xa, ya], [xb, yb]] = [pts[i - 1], pts[i]];
      for (const p of t.people) {
        if (p.id === child) continue;
        const inX = Math.max(xa, xb) > p.x && Math.min(xa, xb) < p.x + p.width;
        const inY = Math.max(ya, yb) > p.y && Math.min(ya, yb) < p.y + p.height;
        if (inX && inY) hit.add(p.id);
      }
    }
    return [...hit];
  };
  /** Where a line goes down through the row of `rowOf`'s box. */
  const xThroughRow = (t: FamilyLayout, child: string, rowOf: string) => {
    const { y } = box(t, rowOf);
    const pts = lineTo(t, child).points;
    for (let i = 1; i < pts.length; i++)
      if (pts[i][0] === pts[i - 1][0] && Math.min(pts[i][1], pts[i - 1][1]) <= y && Math.max(pts[i][1], pts[i - 1][1]) >= y + BOX_HEIGHT)
        return pts[i][0];
    throw new Error(`${child}'s line does not go down through ${rowOf}'s row`);
  };
  /** The drops of the couples standing in `id`'s row. */
  const rowDrops = (t: FamilyLayout, id: string) =>
    t.couples.filter((c) => box(t, c.a).y === box(t, id).y && box(t, c.b).y === box(t, id).y).map((c) => c.dropX);

  describe("a child of two parents in different rows", () => {
    const cases: [string, [string, KinRelation, string][], string[]][] = [
      [
        "Judah and Tamar",
        [["Er", "father", "Judah"], ["Er", "spouse", "Tamar"], ...born(["Perez", "Judah", "Tamar"])],
        ["perez"],
      ],
      [
        "Judah and Tamar, with a child of Er and Tamar",
        [["Er", "father", "Judah"], ["Er", "spouse", "Tamar"], ...born(["Perez", "Judah", "Tamar"], ["Fake", "Er", "Tamar"])],
        ["perez"],
      ],
      [
        "the whole family of Judah",
        [
          ["Judah", "father", "Jacob"],
          ["Judah", "spouse", "Shua"],
          ["Er", "spouse", "Tamar"],
          ["Onan", "spouse", "Tamar"],
          ...born(["Er", "Judah", "Shua"], ["Onan", "Judah", "Shua"], ["Shelah", "Judah", "Shua"]),
          ...born(["Perez", "Judah", "Tamar"], ["Zerah", "Judah", "Tamar"]),
        ],
        ["perez", "zerah"],
      ],
    ];
    for (const [name, edges, children] of cases)
      it(`goes down past the lower parent's row, through no box and no couple's drop: ${name}`, () => {
        const t = layout(edges);
        for (const child of children) {
          const x = xThroughRow(t, child, "tamar");
          // Never where a couple of Tamar's row hangs its children: it would read as theirs.
          for (const d of rowDrops(t, "tamar")) expect(Math.abs(x - d), child).toBeGreaterThan(4);
          // Under no box of Tamar's row, nor through any box at all.
          for (const p of t.people.filter((q) => q.y === box(t, "tamar").y))
            expect(x < p.x || x > p.x + p.width, `${child} under ${p.id}`).toBe(true);
          expect(boxesHit(t, child), child).toEqual([]);
          // It leaves from the bar of Judah and Tamar.
          const bar = t.couples.find((c) => [c.a, c.b].sort().join() === "judah,tamar")!;
          const [sx, sy] = lineTo(t, child).points[0];
          expect(sx).toBeCloseTo(bar.dropX);
          expect(sy).toBeCloseTo(bar.dropY);
          const along = (sx - bar.x1) * (bar.y2 - bar.y1) - (sy - bar.y1) * (bar.x2 - bar.x1);
          expect(Math.abs(along), "on the bar").toBeLessThan(1e-6);
          expect(box(t, child).y).toBeGreaterThan(box(t, "tamar").y);
        }
      });
  });

  it("puts a husband's wives on the side with fewer boxes, and gives every pair its own drop", () => {
    // W1 also married X: W1 and X on one side, W2 and W3 on the other, so no
    // bar of the Hub runs behind W1 and X or through their gap.
    const t = layout([
      ["Hub", "spouse", "W1"],
      ["Hub", "spouse", "W2"],
      ["Hub", "spouse", "W3"],
      ["W1", "spouse", "X"],
      ...born(["C1", "Hub", "W1"], ["C2", "Hub", "W2"], ["C3", "Hub", "W3"], ["C4", "X", "W1"]),
    ]);
    const row = t.people.filter((p) => p.y === box(t, "hub").y).sort((a, b) => a.x - b.x).map((p) => p.id);
    const side = (id: string) => Math.sign(row.indexOf(id) - row.indexOf("hub"));
    expect(side("w1")).toBe(side("x"));
    expect(side("w2")).toBe(-side("w1"));
    expect(side("w3")).toBe(-side("w1"));
    const drops = ["c1", "c2", "c3", "c4"].map((c) => lineTo(t, c).points[0][0]);
    expect(new Set(drops).size).toBe(4);
    expect(new Set(t.couples.map((c) => c.dropX)).size).toBe(t.couples.length);
  });

  it("gives each of three spouses married to one another a drop of their own", () => {
    const t = layout([
      ["Ay", "spouse", "Bee"],
      ["Bee", "spouse", "Cee"],
      ["Cee", "spouse", "Ay"],
      ...born(["K1", "Ay", "Bee"], ["K2", "Bee", "Cee"], ["K3", "Cee", "Ay"]),
    ]);
    const drops = ["k1", "k2", "k3"].map((c) => lineTo(t, c).points[0][0]);
    expect(new Set(drops).size).toBe(3);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(Math.abs(drops[i] - drops[j])).toBeGreaterThan(4);
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

  it("never lets the upper of two parents in different rows drift after their child", () => {
    // P3's child by G goes down beside G's unit wherever P3 stands: P3
    // following it moved P3 further right on every pass, without end.
    const t = layout([
      ["P4", "spouse", "P0"],
      ["K6", "mother", "P3"],
      ["P0", "father", "G"],
      ["X", "father", "G"],
      ["X", "mother", "P3"],
      ["G", "father", "GG"],
    ]);
    const boxes = t.people.reduce((sum, p) => sum + p.width, 0);
    expect(t.width).toBeLessThan(boxes);
    expect(box(t, "p3").x - (box(t, "g").x + box(t, "g").width)).toBeLessThan(200);
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

  it("keeps a unit at or right of its lower bound, and at or left of its upper one", () => {
    expect(packRow([0], [50], 10, [20])).toEqual([20]);
    expect(packRow([0, 100], [50, 50], 10, [30])).toEqual([30, 100]);
    expect(packRow([100], [50], 10, [], [40])).toEqual([40]);
    // Not bounded: as before.
    expect(packRow([0, 100], [50, 50], 10, [-Infinity, -Infinity], [Infinity, Infinity])).toEqual([0, 100]);
  });

  it("lets a lower bound win over an upper one it contradicts", () => {
    expect(packRow([0], [50], 10, [60], [40])).toEqual([60]);
  });

  it("carries a bound along the row, so the order and the gaps still hold", () => {
    // The first must stand at 100 or right: the second, wanting 60, goes after it.
    expect(packRow([0, 60], [50, 50], 10, [100])).toEqual([100, 160]);
    // The second must stand at 20 or left: the first goes before it.
    expect(packRow([0, 100], [50, 50], 10, [], [Infinity, 20])).toEqual([-40, 20]);
    // Both, and they cannot both hold: the lower bound wins, carried on.
    expect(packRow([0, 0], [50, 50], 10, [100, -Infinity], [Infinity, 120])).toEqual([100, 160]);
  });
});

describe("laneLevels", () => {
  const run = (a: number, b: number, tops: number[], downs: number[], kind: "" | "cross" | "head" = ""): GapRun => ({
    a,
    b,
    tops,
    downs,
    cross: kind !== "",
    head: kind === "head",
  });

  it("puts a run below where another's line comes down into the gap, and above where its lines go on down", () => {
    // The second comes down at 150, inside the first: the first goes below it.
    const [p, q] = laneLevels([run(0, 300, [0], [0]), run(100, 400, [150], [400])]);
    expect(p).toBeGreaterThan(q);
    // The second goes on down at 150, inside the first: the first goes above it.
    const [r, s] = laneLevels([run(0, 300, [0], [0]), run(100, 400, [400], [150])]);
    expect(r).toBeLessThan(s);
  });

  it("lets a run from parents in two rows go below when two runs each ask to be above the other", () => {
    // The couple's run comes down at 50 and goes on down at 100, both inside the other.
    const [couple, cross] = laneLevels([run(0, 100, [50], [0, 100]), run(20, 200, [200], [20], "cross")]);
    expect(cross).toBeGreaterThan(couple);
    // The same two runs, neither from two rows: each crosses the other wherever, and both get a lane.
    const both = laneLevels([run(0, 100, [50], [0, 100]), run(20, 200, [200], [20])]);
    expect(both.every((l) => l >= 0)).toBe(true);
  });

  it("keeps a run from parents in two rows below another's line coming down, when two such runs ask both ways", () => {
    // The second comes down at 150 inside the first (the first goes below it)
    // and goes on down at 200 inside it (the first would go above): below wins.
    const [p, q] = laneLevels([run(0, 300, [0], [0], "cross"), run(100, 400, [150], [200], "cross")]);
    expect(p).toBeGreaterThan(q);
  });

  it("breaks a circle of three asks without putting the run from two rows above a line coming down into it", () => {
    // A must be above C (A comes down inside C), B above A, C above B.
    const levels = laneLevels([run(0, 100, [50], []), run(60, 400, [80], []), run(40, 300, [250], [], "cross")]);
    const [a, b, c] = levels;
    expect(c).toBeGreaterThan(a);
    expect(b).toBeLessThan(a);
    expect(new Set(levels).size).toBe(3);
  });

  it("puts a run from a sloping bar below every other run in the gap, even one it does not overlap", () => {
    const [other, head] = laneLevels([run(0, 10, [0], [10]), run(500, 600, [], [600], "head")]);
    expect(head).toBeGreaterThan(other);
  });

  it("gives every run a lane when the asks go round in circles", () => {
    const levels = laneLevels([run(0, 100, [50], [90]), run(40, 140, [90], [130]), run(80, 200, [130], [50])]);
    expect(levels.every((l) => l >= 0)).toBe(true);
  });
});

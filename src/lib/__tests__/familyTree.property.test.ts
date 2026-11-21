// The Family tree's layout against random families: whatever the kin, every
// box once, every child below its parents, no row left empty, and every line
// readable: through no box, never on another couple's drop or bar, never
// sharing a run with the line of another pair of parents (a line that does
// reads as their child), and a child of parents in two rows never running
// under the line coming down from another couple or lone parent.
import { describe, expect, it } from "vitest";
import type { DocSummary, Kinship, KinRelation } from "../api";
import { kinGraph, type KinGraph } from "../kinship";
import { BOX_HEIGHT, familyLayout, NEAR, type FamilyLayout, type Generations } from "../familyTree";

type Edge = [string, KinRelation, string];

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

function graph(edges: Edge[]): KinGraph {
  const k: Kinship = {
    edges: edges.map(([c, relation, kin]) => ({
      character: doc(c),
      relation,
      kin: doc(kin),
    })),
    warnings: [],
    relations: [],
  };
  return kinGraph(k);
}

const born = (...kids: [string, string, string][]): Edge[] =>
  kids.flatMap(([c, f, m]): Edge[] => [
    [c, "father", f],
    [c, "mother", m],
  ]);

const key = (ps: string[]) => [...ps].sort().join("+");

/** Everything wrong with a layout, as readable lines; empty when it is sound. */
function problems(l: FamilyLayout): string[] {
  const out: string[] = [];
  const P = new Map(l.people.map((p) => [p.id, p]));
  if (P.size !== l.people.length) out.push("a Character drawn twice");
  const finite = (...xs: number[]) => xs.every(Number.isFinite);
  for (const p of l.people) if (!finite(p.x, p.y, p.width)) out.push(`NaN box ${p.id}`);
  for (const c of l.couples)
    if (!finite(c.x1, c.y1, c.x2, c.y2, c.dropX, c.dropY)) out.push(`NaN bar ${key([c.a, c.b])}`);
  for (const ln of l.lines) for (const [x, y] of ln.points) if (!finite(x, y)) out.push(`NaN line ${ln.child}`);
  if (out.length) return out;

  // Boxes: none overlapping.
  for (const a of l.people)
    for (const b of l.people)
      if (a.id < b.id && a.y < b.y + b.height && b.y < a.y + a.height && a.x < b.x + b.width && b.x < a.x + a.width)
        out.push(`boxes ${a.id} and ${b.id} overlap`);

  // Rows: none empty in a family.
  for (let f = 0; f < l.families; f++) {
    const rows = new Set(l.people.filter((p) => p.family === f).map((p) => p.generation));
    if (Math.max(...rows) + 1 !== rows.size) out.push(`family ${f} has an empty row`);
  }

  const twoRows = (ps: string[]) => ps.length === 2 && P.get(ps[0])!.y !== P.get(ps[1])!.y;
  const hasChildren = new Set(l.lines.map((ln) => key(ln.parents)));
  // Same-row couples: their drop, their bar.
  const flat = l.couples.filter((c) => P.get(c.a)!.y === P.get(c.b)!.y);
  for (let i = 0; i < l.couples.length; i++)
    for (let j = i + 1; j < l.couples.length; j++) {
      const [a, b] = [l.couples[i], l.couples[j]];
      // A drop is drawn only where children hang from it.
      if (!hasChildren.has(key([a.a, a.b])) || !hasChildren.has(key([b.a, b.b]))) continue;
      if (Math.abs(a.dropX - b.dropX) < NEAR && Math.abs(a.dropY - b.dropY) < NEAR)
        out.push(`${key([a.a, a.b])} and ${key([b.a, b.b])} share a drop at ${Math.round(a.dropX)}`);
    }

  type Run = { k: string; child: string; y: number; a: number; b: number };
  const runs: Run[] = [];
  const downs: {
    k: string;
    child: string;
    x: number;
    a: number;
    b: number;
    beside: boolean;
  }[] = [];
  for (const ln of l.lines) {
    const k = key(ln.parents);
    const c = P.get(ln.child)!;
    for (const pid of ln.parents) if (P.get(pid)!.y >= c.y) out.push(`${ln.child} not below ${pid}`);
    const end = ln.points.at(-1)!;
    if (Math.abs(end[0] - (c.x + c.width / 2)) > 0.5 || Math.abs(end[1] - c.y) > 0.5)
      out.push(`${ln.child}'s line misses its box`);
    const pts = ln.points;
    for (let i = 1; i < pts.length; i++) {
      const [[xa, ya], [xb, yb]] = [pts[i - 1], pts[i]];
      // Through no box but the child's (a lone parent's line leaves from the bottom of their box).
      for (const p of l.people) {
        if (p.id === ln.child) continue;
        const inX = Math.max(xa, xb) > p.x && Math.min(xa, xb) < p.x + p.width;
        const inY = Math.max(ya, yb) > p.y && Math.min(ya, yb) < p.y + p.height;
        if (inX && inY) out.push(`${ln.child}'s line through ${p.id}`);
      }
      if (ya === yb && xa !== xb)
        runs.push({
          k,
          child: ln.child,
          y: ya,
          a: Math.min(xa, xb),
          b: Math.max(xa, xb),
        });
      if (xa === xb && ya !== yb)
        downs.push({
          k,
          child: ln.child,
          x: xa,
          a: Math.min(ya, yb),
          b: Math.max(ya, yb),
          beside: twoRows(ln.parents),
        });
      for (const bar of flat) {
        if (key([bar.a, bar.b]) === k) continue;
        const [bl, br] = [Math.min(bar.x1, bar.x2), Math.max(bar.x1, bar.x2)];
        // Along another couple's bar.
        if (
          ya === yb &&
          Math.abs(ya - bar.y1) < NEAR &&
          Math.min(br, Math.max(xa, xb)) - Math.max(bl, Math.min(xa, xb)) > 0
        )
          out.push(`${ln.child}'s line along the bar of ${key([bar.a, bar.b])}`);
        // Down through another couple's bar, or within reach of their drop.
        if (xa === xb && Math.min(ya, yb) < bar.y1 && Math.max(ya, yb) > bar.y1) {
          if (xa > bl && xa < br) out.push(`${ln.child}'s line through the bar of ${key([bar.a, bar.b])}`);
          if (Math.abs(xa - bar.dropX) < NEAR)
            out.push(`${ln.child}'s line down on the drop of ${key([bar.a, bar.b])}`);
        }
      }
    }
  }
  // A child of parents in two rows: no stretch of its line along a gap (from
  // the bar to its way down, or on to the child) crosses the line coming down
  // from another couple or lone parent, from their bar or box to their run
  // (or on to their child, for a line that goes straight down).
  const stems = l.lines.flatMap((ln) => {
    const pts = ln.points;
    if (twoRows(ln.parents) || pts[0][0] !== pts[1][0]) return [];
    let end = 1;
    while (end + 2 < pts.length && Math.abs(pts[end + 1][0] - pts[end][0]) < 0.5 && pts[end + 2][0] === pts[end + 1][0])
      end += 2;
    const ys = pts.slice(0, end + 1).map((p) => p[1]);
    return [
      {
        k: key(ln.parents),
        child: ln.child,
        x: pts[0][0],
        a: Math.min(...ys),
        b: Math.max(...ys),
      },
    ];
  });
  // The one crossing that cannot be helped: the bar lands on the lower
  // parent's box beside where the line coming down to them ends, so the line
  // leaving the bar passes over a box with a line of its own whichever way it
  // leaves the unit when both ways have one (the lower parent's own, and a
  // spouse's beside them).
  const unitOf = new Map<string, string>();
  const unit = (id: string): string => {
    const up = unitOf.get(id) ?? id;
    return up === id ? id : unit(up);
  };
  for (const bar of flat) if (unit(bar.a) !== unit(bar.b)) unitOf.set(unit(bar.a), unit(bar.b));
  const fed = new Set(l.lines.map((ln) => ln.child));
  const boxedIn = (low: { id: string; y: number }, leave: number) => {
    const members = l.people.filter((p) => p.y === low.y && unit(p.id) === unit(low.id));
    const over = (end: number) =>
      members.some(
        (p) => fed.has(p.id) && p.x + p.width / 2 > Math.min(leave, end) && p.x + p.width / 2 < Math.max(leave, end),
      );
    return over(Math.min(...members.map((p) => p.x))) && over(Math.max(...members.map((p) => p.x + p.width)));
  };
  for (const ln of l.lines) {
    if (ln.parents.length !== 2 || P.get(ln.parents[0])!.y === P.get(ln.parents[1])!.y) continue;
    const k = key(ln.parents);
    const low = ln.parents.map((p) => P.get(p)!).sort((a, b) => b.y - a.y)[0];
    const boxed = boxedIn(low, ln.points[0][0]);
    for (let i = 1; i < ln.points.length; i++) {
      const [[xa, ya], [xb, yb]] = [ln.points[i - 1], ln.points[i]];
      if (ya !== yb) continue;
      for (const s of stems) {
        if (
          s.k === k ||
          s.x <= Math.min(xa, xb) + 0.5 ||
          s.x >= Math.max(xa, xb) - 0.5 ||
          ya <= s.a + 0.5 ||
          ya >= s.b - 0.5
        )
          continue;
        if (i === 1 && boxed && P.get(s.child)!.y === low.y && unit(s.child) === unit(low.id)) continue;
        out.push(`${ln.child}'s line under ${s.k}`);
      }
    }
  }
  // A bar between two rows: through no box but its two parents', and its
  // runs along a gap under no other's line coming down.
  for (const bar of l.couples) {
    if (P.get(bar.a)!.y === P.get(bar.b)!.y) continue;
    const k = key([bar.a, bar.b]);
    for (let i = 1; i < bar.points.length; i++) {
      const [[xa, ya], [xb, yb]] = [bar.points[i - 1], bar.points[i]];
      for (const p of l.people)
        if (
          p.id !== bar.a &&
          p.id !== bar.b &&
          Math.max(xa, xb) > p.x + 0.5 &&
          Math.min(xa, xb) < p.x + p.width - 0.5 &&
          Math.max(ya, yb) > p.y + 0.5 &&
          Math.min(ya, yb) < p.y + p.height - 0.5
        )
          out.push(`the bar of ${k} through ${p.id}`);
      if (ya !== yb) continue;
      for (const s of stems)
        if (
          s.k !== k &&
          s.x > Math.min(xa, xb) + 0.5 &&
          s.x < Math.max(xa, xb) - 0.5 &&
          ya > s.a + 0.5 &&
          ya < s.b - 0.5
        )
          out.push(`the bar of ${k} under ${s.k}`);
    }
  }
  // No run shared by the lines of two pairs of parents.
  for (let i = 0; i < runs.length; i++)
    for (let j = i + 1; j < runs.length; j++) {
      const [A, B] = [runs[i], runs[j]];
      if (A.k !== B.k && Math.abs(A.y - B.y) < 2 && Math.min(A.b, B.b) - Math.max(A.a, B.a) > 2)
        out.push(`${A.child} (${A.k}) and ${B.child} (${B.k}) share a run at y=${A.y}`);
    }
  // Nor a stretch down shared by the lines of two pairs of parents (a few
  // pixels apart, the way down of a child of parents in two rows).
  for (let i = 0; i < downs.length; i++)
    for (let j = i + 1; j < downs.length; j++) {
      const [A, B] = [downs[i], downs[j]];
      const near = A.beside || B.beside ? NEAR : 2;
      if (A.k !== B.k && Math.abs(A.x - B.x) < near && Math.min(A.b, B.b) - Math.max(A.a, B.a) > 2)
        out.push(`${A.child} (${A.k}) and ${B.child} (${B.k}) go down together at x=${Math.round(A.x)}`);
    }
  return [...new Set(out)];
}

/**
 * A child of parents in two rows whose line, below the lower row, runs under
 * a couple of that row with children of their own (between the couple's
 * middles). Not part of `problems`: a row too crowded to hold every such child
 * beside its parent's unit leaves a few, rarely.
 */
function underLowerCouples(l: FamilyLayout): string[] {
  const out: string[] = [];
  const P = new Map(l.people.map((p) => [p.id, p]));
  const twoRows = (ps: string[]) => ps.length === 2 && P.get(ps[0])!.y !== P.get(ps[1])!.y;
  const hasChildren = new Set(l.lines.map((ln) => key(ln.parents)));
  const flat = l.couples.filter((c) => P.get(c.a)!.y === P.get(c.b)!.y);
  for (const ln of l.lines) {
    if (!twoRows(ln.parents)) continue;
    const c = P.get(ln.child)!;
    const lowY = Math.max(...ln.parents.map((p) => P.get(p)!.y));
    for (let i = 1; i < ln.points.length; i++) {
      const [[xa, ya], [xb, yb]] = [ln.points[i - 1], ln.points[i]];
      if (ya !== yb || ya <= lowY + BOX_HEIGHT || ya >= c.y) continue;
      for (const bar of flat) {
        if (
          P.get(bar.a)!.y !== lowY ||
          !hasChildren.has(key([bar.a, bar.b])) ||
          key([bar.a, bar.b]) === key(ln.parents)
        )
          continue;
        const [ca, cb] = [bar.a, bar.b].map((id) => P.get(id)!.x + P.get(id)!.width / 2);
        if (Math.min(xa, xb) < Math.max(ca, cb) - 1 && Math.max(xa, xb) > Math.min(ca, cb) + 1)
          out.push(`${ln.child}'s line under the couple ${key([bar.a, bar.b])}`);
      }
    }
  }
  return out;
}

/** A small seeded generator (mulberry32): the same families on every run. */
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One random family: a few parentless Characters married in a tree, plus
 * extra marriages (second husbands, cycles of marriages), children of each,
 * a grandparent with a child by someone a row below, and a great-grandparent
 * with one by someone two rows below, children of the top rows by their
 * children's generation, children of one parent alone beside them, a next generation that marries in, and now and then a bad edge (one
 * parent named twice, a parent cycle) or a Character whose document is
 * missing. Titles run from short to long, so boxes differ in width.
 */
function randomFamily(rnd: () => number, t: number): KinGraph {
  const int = (n: number) => Math.floor(rnd() * n);
  const titled = new Map<string, string>();
  /** `id` with a title of its own length (the same each time it is named). */
  const name = (id: string) => {
    if (!titled.has(id)) titled.set(id, id + "abcdefghijklmnopqrstuvwxyz".slice(0, int(3) ? int(6) : int(26)));
    return titled.get(id)!;
  };
  const n = 3 + int(6);
  const P = Array.from({ length: n }, (_, i) => name(`P${i}`));
  const e: Edge[] = [];
  const pairs: [string, string][] = [];
  for (let i = 1; i < n; i++) pairs.push([P[i], P[int(i)]]);
  for (let q = int(4); q > 0; q--) {
    const [i, j] = [int(n), int(n)];
    if (i !== j) pairs.push([P[i], P[j]]);
  }
  const kids: string[] = [];
  pairs.forEach(([a, b], k) => {
    if (rnd() < 0.85) e.push([a, "spouse", b]);
    for (let c = Math.max(k === 0 ? 1 : 0, int(3)); c > 0; c--) {
      const kid = name(`K${k}x${c}t${t}`);
      e.push(...born([kid, a, b]));
      kids.push(kid);
    }
  });
  const G = name("G");
  const H = name("H");
  const GG = name("GG");
  // Parents in two rows: G above P0, and a child of G by someone in P0's row.
  if (rnd() < 0.6) {
    e.push([P[0], "father", G]);
    const withG = new Set<number>();
    for (const [kid, odds] of [
      [`X${t}`, 0.8],
      [`Y${t}`, 0.4],
    ] as const)
      if (rnd() < odds) {
        const i = 1 + int(n - 1);
        withG.add(i);
        e.push(...born([name(kid), G, P[i]]));
      }
    // H, the mother of someone G has no child with (see "the limit" below).
    let j = int(n);
    if (rnd() < 0.3 && !withG.has(j)) {
      e.push([P[j], "mother", H]);
      if (rnd() < 0.5) e.push([G, "spouse", H]);
      e.push(...born([name(`Z${t}`), P[int(n)], H]));
    } else j = -1;
    // Two rows apart: G's father, with a child by someone in P0's row.
    const i = 1 + int(n - 1);
    if (rnd() < 0.3 && i !== j) {
      e.push([G, "father", GG]);
      e.push(...born([name(`W${t}`), GG, P[i]]));
    }
  }
  // Children of someone in the top rows by someone a row or two below.
  for (let q = int(4); q > 0 && kids.length; q--) {
    const up = [G, ...P][int(n + 1)];
    e.push(...born([name(`R${q}t${t}`), up, kids[int(kids.length)]]));
  }
  // Children of one parent alone, in any row.
  for (let q = int(3); q > 0; q--) {
    const all = [...P, ...kids];
    e.push([name(`L${q}t${t}`), rnd() < 0.5 ? "father" : "mother", all[int(all.length)]]);
  }
  // The next generation: a child marries in, or two cousins marry.
  if (kids.length && rnd() < 0.5) {
    const k = kids[int(kids.length)];
    const other = rnd() < 0.5 ? kids[int(kids.length)] : name(`Q${t}`);
    if (other !== k) {
      e.push([k, "spouse", other]);
      e.push(...born([name(`N${t}`), k, other]));
      if (rnd() < 0.5) e.push(...born([name(`M${t}`), P[int(n)], k]));
    }
  }
  if (rnd() < 0.1) e.push(...born([name(`S${t}`), P[int(n)], P[int(n)]])); // father == mother, now and then
  if (rnd() < 0.08 && kids.length) e.push([P[int(n)], "father", kids[int(kids.length)]]); // a parent cycle
  const g = graph(e);
  if (rnd() < 0.1) g.docs.delete(P[int(n)].toLowerCase()); // a document gone
  return g;
}

describe("familyLayout on random families", () => {
  it("draws 500 of them soundly", () => {
    const rnd = prng(154);
    const failures: string[] = [];
    for (let t = 0; t < 500; t++) {
      const g = randomFamily(rnd, t);
      let found: string[];
      try {
        found = problems(familyLayout(g));
      } catch (err) {
        found = [`throws: ${err}`];
      }
      if (found.length) failures.push(`case ${t}: ${found.join("; ")}`);
    }
    expect(failures.slice(0, 5), `${failures.length} of 500 families`).toEqual([]);
  });
});

describe("familyLayout on random families, focused (#155)", () => {
  it("draws three focused trees from each of 250 of them soundly", () => {
    // The same families as above; a second generator picks who to focus on
    // and how far, so the unfocused cases stay as they are.
    const rnd = prng(154);
    const pick = prng(155);
    const reach = (): Generations => (pick() < 0.2 ? "all" : 1 + Math.floor(pick() * 4));
    const failures: string[] = [];
    let drawn = 0;
    for (let t = 0; t < 500; t++) {
      const g = randomFamily(rnd, t);
      if (t % 2) continue;
      const ids = [...g.docs.keys()].sort();
      for (let q = 0; q < 3; q++) {
        const focus = { id: ids[Math.floor(pick() * ids.length)], up: reach(), down: reach() };
        let found: string[];
        try {
          const l = familyLayout(g, { focus });
          found = problems(l);
          if (!l.people.some((p) => p.id === focus.id)) found.push("the focus is not drawn");
          drawn++;
        } catch (err) {
          found = [`throws: ${err}`];
        }
        if (found.length) failures.push(`case ${t}, focus ${JSON.stringify(focus)}: ${found.join("; ")}`);
      }
    }
    expect(failures.slice(0, 5), `${failures.length} of ${drawn} focused trees`).toEqual([]);
  });
});

describe("familyLayout, a child of parents in two rows", () => {
  const sound = (edges: Edge[]) => expect(problems(familyLayout(graph(edges)))).toEqual([]);

  it("keeps Judah and Tamar's children clear of a child of Er and Tamar", () => {
    sound([
      ["Judah", "father", "Jacob"],
      ["Judah", "spouse", "Shua"],
      ["Er", "spouse", "Tamar"],
      ["Onan", "spouse", "Tamar"],
      ...born(["Er", "Judah", "Shua"], ["Onan", "Judah", "Shua"], ["Shelah", "Judah", "Shua"]),
      ...born(["Perez", "Judah", "Tamar"], ["Zerah", "Judah", "Tamar"], ["Ghost", "Er", "Tamar"]),
    ]);
  });

  it("keeps a child of G and W clear of W's own child, when W's husband stands among G's sons", () => {
    sound([
      ["A", "father", "G"],
      ["M", "father", "G"],
      ["Z", "father", "G"],
      ["M", "spouse", "W"],
      ...born(["K", "G", "W"], ["J", "M", "W"], ["Q", "A", "Aw"], ["R", "Z", "Zw"]),
    ]);
  });

  it("keeps a child of G and P1 clear of P1's two marriages", () => {
    sound([
      ["P1", "spouse", "P0"],
      ["P2", "spouse", "P1"],
      ["P0", "father", "G"],
      ...born(["K0", "P1", "P0"], ["K1", "P2", "P1"], ["X", "G", "P1"]),
    ]);
  });
});

it("gives each of four spouses all married to one another a drop of their own", () => {
  const l = familyLayout(
    graph([
      ["A", "spouse", "B"],
      ["A", "spouse", "C"],
      ["A", "spouse", "D"],
      ["B", "spouse", "C"],
      ["B", "spouse", "D"],
      ["C", "spouse", "D"],
      ...born(
        ["k1", "A", "B"],
        ["k2", "A", "C"],
        ["k3", "A", "D"],
        ["k4", "B", "C"],
        ["k5", "B", "D"],
        ["k6", "C", "D"],
      ),
    ]),
  );
  expect(problems(l)).toEqual([]);
  const drops = l.couples.map((c) => c.dropX);
  for (let i = 0; i < drops.length; i++)
    for (let j = i + 1; j < drops.length; j++) expect(Math.abs(drops[i] - drops[j])).toBeGreaterThanOrEqual(NEAR);
});

/** Generated families, cut down to the edges that showed a fault; titles keep their lengths (box widths matter). */
type Case = [string, Edge[]];

describe("familyLayout, families the random checks once caught", () => {
  const sound = (edges: Edge[]) => expect(problems(familyLayout(graph(edges)))).toEqual([]);
  const cases: Case[] = [
    // Asks for lanes going round in circles of three: the child of parents in
    // two rows ran under a lone parent's line in the row below.
    [
      "a circle of three runs, wide titles",
      [
        ["N2ab", "spouse", "N3abcdefg"],
        ["N6abcdef", "father", "N3abcdefg"],
        ["N9abcdefghijklmno", "father", "N3abcdefg"],
        ...born(
          ["N13abcdefghijklmnopqrst", "N2ab", "N6abcdef"],
          ["N17abcdefghijklmnop", "N16abc", "N9abcdefghijklmno"],
        ),
        ["N16abc", "mother", "N6abcdef"],
        ["N18abcdefghijklmnopqrst", "mother", "N9abcdefghijklmno"],
        ...born(["N37abcdefg", "N18abcdefghijklmnopqrst", "N13abcdefghijklmnopqrst"]),
      ],
    ],
    [
      "a circle of three runs, a wife of father and son",
      [
        ["N2", "father", "N1"],
        ["N1", "spouse", "N0"],
        ["N4", "father", "N2"],
        ["N1", "spouse", "N2"],
        ["N6", "mother", "N0"],
        ["N8", "father", "N6"],
        ...born(["N10", "N8", "N9"], ["N11", "N8", "N9"], ["N23", "N11", "N4"], ["N28", "N13", "N10"]),
        ["N13", "mother", "N4"],
      ],
    ],
    [
      "a circle of three runs, a widow's second marriage",
      [
        ["N6abcdefghijklmnopq", "father", "N0abcdefghijklmn"],
        ["N7abcdef", "mother", "N2abcde"],
        ...born(["N8abcdefghijklmnopqrs", "N0abcdefghijklmn", "N2abcde"]),
        ["N2abcde", "spouse", "N6abcdefghijklmnopq"],
        ["N8abcdefghijklmnopqrs", "spouse", "N12abcdefghi"],
        ["N17abcdefg", "father", "N11abcdefghijklmnopq"],
        ...born(["N18abcdefghijklm", "N7abcdef", "N17abcdefg"]),
        ["N19abcdefg", "mother", "N17abcdefg"],
      ],
    ],
    // The run from the bar to the way down crossed the line coming down from a couple above.
    [
      "a run from the bar, across a lone parent's line",
      [
        ["N14", "father", "N3"],
        ["N16", "mother", "N14"],
        ...born(["N17", "N9", "N14"], ["N22", "N18", "N16"]),
        ["N19", "mother", "N18"],
      ],
    ],
    [
      "a run from the bar, a wife of father and son",
      [
        ["N0", "spouse", "N1"],
        ["N5", "father", "N1"],
        ["N0", "spouse", "N5"],
        ["N8", "mother", "N5"],
        ["N10", "father", "N5"],
        ["N12", "father", "N5"],
        ["N13", "father", "N12"],
        ...born(["N17", "N12", "N10"], ["N19", "N12", "N10"], ["N25", "N19", "N24"]),
        ["N20", "mother", "N10"],
      ],
    ],
  ];
  for (const [name, edges] of cases) it(`draws ${name} soundly`, () => sound(edges));

  it("keeps a child of parents in two rows beside the lower parent's unit, though a half-brother crowds it", () => {
    // Unbounded, the least-squares fit put K3x1 the far side of P0's way down,
    // and its line ran under P0's box.
    const l = familyLayout(
      graph([
        ...born(
          ["K3x2t35abcdefghijklmnopqrstuv", "P0abc", "P2abcdefghijklmnopqrstuvwx"],
          ["K3x1t35abcdefgh", "P0abc", "P2abcdefghijklmnopqrstuvwx"],
        ),
        ["K4x1t35abcdefghijklmnopqrstu", "mother", "P2abcdefghijklmnopqrstuvwx"],
        ["P0abc", "father", "Gabcd"],
      ]),
    );
    expect(problems(l)).toEqual([]);
    const p0 = l.people.find((p) => p.id === "p0abc")!;
    for (const child of ["k3x1t35abcdefgh", "k3x2t35abcdefghijklmnopqrstuv"]) {
      const [[xa], [xb]] = l.lines.find((ln) => ln.child === child)!.points.slice(2, 4);
      const [lo, hi] = [Math.min(xa, xb), Math.max(xa, xb)];
      expect(hi <= p0.x + 0.5 || lo >= p0.x + p0.width - 0.5, `${child} runs under P0`).toBe(true);
    }
  });

  it("leaves no row empty when a father marries his own daughter", () => {
    const l = familyLayout(
      graph([
        ["N4", "father", "N0"],
        ["N5", "father", "N0"],
        ["N0", "spouse", "N4"],
        ["N15", "mother", "N14"],
        ...born(["N17", "N5", "N14"]),
      ]),
    );
    expect(problems(l)).toEqual([]);
    const gen = (id: string) => l.people.find((p) => p.id === id)!.generation;
    // The marriage sets no row: N0 stays above his children, at the top.
    expect([gen("n0"), gen("n4"), gen("n5"), gen("n17")]).toEqual([0, 1, 1, 2]);
    expect(new Set(l.people.map((p) => p.generation))).toEqual(new Set([0, 1, 2]));
  });
});

describe("familyLayout, a child of parents in two rows, each way it is kept clear", () => {
  /** Every child of parents in two rows whose run to them passes under a box of the lower parent's unit. */
  const underTheirUnit = (l: FamilyLayout) => {
    const P = new Map(l.people.map((p) => [p.id, p]));
    const unitOf = new Map<string, string>();
    const unit = (id: string): string => {
      const up = unitOf.get(id) ?? id;
      return up === id ? id : unit(up);
    };
    for (const c of l.couples)
      if (P.get(c.a)!.y === P.get(c.b)!.y && unit(c.a) !== unit(c.b)) unitOf.set(unit(c.a), unit(c.b));
    return l.lines.flatMap((ln) => {
      const ps = ln.parents.map((id) => P.get(id)!);
      if (ps.length !== 2 || ps[0].y === ps[1].y) return [];
      const low = ps[0].y > ps[1].y ? ps[0] : ps[1];
      const [[xa], [xb]] = ln.points.slice(2, 4);
      const under = l.people.some(
        (p) =>
          p.y === low.y &&
          unit(p.id) === unit(low.id) &&
          Math.min(xa, xb) < p.x + p.width - 0.5 &&
          Math.max(xa, xb) > p.x + 0.5,
      );
      return under ? [ln.child] : [];
    });
  };
  const cases: [string, Edge[], boolean][] = [
    // Down on the side nearer the child, unless that side passes over more boxes with a line of their own.
    [
      "the other side, when the nearer one passes over a box with a line of its own",
      [
        ["K0x1t1091abcd", "father", "P1abcd"],
        ["K0x1t1091abcd", "mother", "P0abcdefghijklmnopqrstuvw"],
        ["P2abc", "spouse", "P0abcdefghijklmnopqrstuvw"],
        ["P0abcdefghijklmnopqrstuvw", "father", "Gabcdefghijklmnopqrstuv"],
        ["P1abcd", "mother", "H"],
        ["Z1091abcde", "father", "P0abcdefghijklmnopqrstuvw"],
        ["Z1091abcde", "mother", "H"],
        ["R2t1091", "father", "P0abcdefghijklmnopqrstuvw"],
        ["R2t1091", "mother", "K0x1t1091abcd"],
      ],
      false,
    ],
    // Room beside a unit for two pairs going down on one side.
    [
      "two pairs going down on one side of a unit, a few pixels apart",
      [
        ["P1abcdefghijklmnopqrstuvw", "spouse", "P0"],
        ["K0x2t356a", "mother", "P0"],
        ["K0x1t356", "mother", "P0"],
        ["P2a", "spouse", "P0"],
        ["R3t356a", "father", "P0"],
        ["R3t356a", "mother", "K0x1t356"],
        ["R2t356abcde", "father", "P1abcdefghijklmnopqrstuvw"],
        ["R2t356abcde", "mother", "K0x2t356a"],
        ["R1t356abcd", "father", "P2a"],
        ["R1t356abcd", "mother", "K0x1t356"],
      ],
      false,
    ],
    // A unit that cannot hold on its side trades places with its neighbour.
    [
      "a unit that cannot hold on its side, traded with its neighbour",
      [
        ["K2x1t11abcdefghijklmnopq", "mother", "P2abcde"],
        ["P4abcd", "spouse", "P2abcde"],
        ["P4abcd", "spouse", "P0abcde"],
        ["K6x1t11abcde", "father", "P5"],
        ["K7x1t11abcdefghijklmnop", "father", "P4abcd"],
        ["R3t11abcd", "father", "P5"],
        ["R3t11abcd", "mother", "K7x1t11abcdefghijklmnop"],
        ["R2t11abcd", "father", "P4abcd"],
        ["R2t11abcd", "mother", "K2x1t11abcdefghijklmnopq"],
      ],
      true,
    ],
    // A unit turned round when that frees the way.
    [
      "a unit turned round to free the way",
      [
        ["K0x1t421abcd", "mother", "P0abcd"],
        ["P0abcd", "spouse", "P2ab"],
        ["K2x2t421abc", "mother", "P2ab"],
        ["K2x1t421abcdefghijklmnopqrs", "mother", "P2ab"],
        ["K3x1t421abcde", "mother", "P2ab"],
        ["P0abcd", "father", "Gabcdefghijklmnopqrstuv"],
        ["R3t421abcde", "father", "P0abcd"],
        ["R3t421abcde", "mother", "K2x2t421abc"],
        ["R2t421ab", "father", "Gabcdefghijklmnopqrstuv"],
        ["R2t421ab", "mother", "K2x2t421abc"],
        ["R1t421abcde", "father", "P2ab"],
        ["R1t421abcde", "mother", "K2x1t421abcdefghijklmnopqrs"],
        ["N421ab", "father", "K3x1t421abcde"],
        ["N421ab", "mother", "K2x1t421abcdefghijklmnopqrs"],
      ],
      true,
    ],
    // Each row ordered again by where its parents stand within the sides.
    [
      "a row ordered again within the sides",
      [
        ["P1", "spouse", "P0ab"],
        ["K2x1t960ab", "mother", "P2abcde"],
        ["P4", "spouse", "P1"],
        ["K4x2t960a", "mother", "P0ab"],
        ["P6ab", "spouse", "P0ab"],
        ["K6x1t960abcdefghijklm", "mother", "P5abcdefghijklm"],
        ["P0ab", "spouse", "P5abcdefghijklm"],
        ["K7x1t960ab", "mother", "P5abcdefghijklm"],
        ["P0ab", "father", "Gabc"],
        ["Gabc", "father", "GGabcdefghijklmnopqrs"],
        ["W960abc", "father", "GGabcdefghijklmnopqrs"],
        ["W960abc", "mother", "P6ab"],
        ["R2t960abcdefghijklmnopqrstuvwx", "father", "P6ab"],
        ["L1t960", "father", "P0ab"],
        ["N960abcd", "father", "K2x1t960ab"],
        ["N960abcd", "mother", "K4x2t960a"],
        ["M960abc", "father", "P5abcdefghijklm"],
        ["M960abc", "mother", "K2x1t960ab"],
      ],
      true,
    ],
  ];
  for (const [name, edges, beside] of cases)
    it(`draws ${name}`, () => {
      const l = familyLayout(graph(edges));
      expect(problems(l)).toEqual([]);
      if (beside) expect(underTheirUnit(l)).toEqual([]);
    });
});

describe("familyLayout, families a second random check caught", () => {
  const sound = (edges: Edge[]) => expect(problems(familyLayout(graph(edges)))).toEqual([]);
  it("keeps Zipporah's line clear of Chilion's, a lone parent in the lower row beside it", () =>
    sound([
      ["Eber", "mother", "Manasseh"],
      ["Chilion", "mother", "Manasseh"],
      ["Eliezer", "father", "Nahshon"],
      ["Eliezer", "mother", "Amaziah"],
      ["Caleb", "father", "Nahshon"],
      ["Caleb", "mother", "Amaziah"],
      ["Matthan", "father", "Nahshon"],
      ["Shua", "father", "Eber"],
      ["Zipporah", "father", "Eber"],
      ["Zipporah", "mother", "Manasseh"],
      ["Rebekah", "mother", "Chilion"],
      ["Eleazar", "father", "Joseph 2"],
      ["Eleazar", "mother", "Matthan"],
      ["Eleazar", "spouse", "Zipporah"],
    ]));
  it("takes a bar between parents two rows apart round every box between them", () => {
    const l = familyLayout(
      graph([
        ["Eglah", "father", "Ruth"],
        ["Phinehas", "father", "Uzziah"],
        ["Hezron", "father", "Eglah"],
        ["Moses of the house of Levi", "father", "Eglah"],
        ["Jacob 2", "father", "Uzziah"],
        ["Jacob 2", "mother", "Hezron"],
      ]),
    );
    expect(problems(l)).toEqual([]);
    const bar = l.couples.find((c) => key([c.a, c.b]) === "hezron+uzziah")!;
    expect(bar.points.length).toBeGreaterThan(2);
  });
  it("never runs two lines of different parents down one x", () =>
    sound([
      ["Naphtali", "mother", "Kenan son of Hezron the Judahite"],
      ["Uriah the Younger", "mother", "Eliud"],
      ["Shelah daughter of the priest of On", "father", "Elimelech"],
      ["Gad", "mother", "Eliud"],
      ["Ahaz 2", "father", "Elimelech"],
      ["Ahaz 2", "mother", "Solomon"],
      ["Arphaxad", "father", "Naphtali"],
      ["Arphaxad", "mother", "Solomon"],
      ["Naamah", "mother", "Uriah the Younger"],
      ["Jehoram of the house of Levi", "father", "David"],
      ["Jehoram of the house of Levi", "mother", "Shelah daughter of the priest of On"],
      ["Joseph", "father", "David"],
      ["Joseph", "mother", "Shelah daughter of the priest of On"],
      ["Hagar 2", "mother", "Gad"],
      ["Manasseh 2", "father", "Manasseh"],
      ["Arphaxad", "spouse", "Naamah"],
      ["Naamah", "spouse", "Dinah"],
      ["Nahshon 2", "father", "Manasseh 2"],
      ["Nahshon 2", "mother", "Hagar 2"],
      ["Solomon 2", "father", "Manasseh 2"],
      ["Solomon 2", "mother", "Hagar 2"],
      ["Eliakim", "mother", "Hagar 2"],
      ["Caleb", "father", "Dinah"],
      ["Caleb", "mother", "Naamah"],
      ["Hannah", "father", "Uzziah"],
      ["Hannah", "mother", "Joseph"],
      ["Uzziah the Younger", "mother", "Naamah"],
      ["Solomon 2", "spouse", "Ahaziah"],
      ["Hannah", "spouse", "Eliakim"],
      ["Boaz 2", "spouse", "Uzziah the Younger"],
    ]));
  it("keeps Judah's line beside Joash 2's unit, not under Jochebed and Leah: stopped before the next unit with children", () => {
    const l = familyLayout(
      graph([
        ["Mahlon", "mother", "Uriah king of Judah"],
        ["Jochebed", "father", "Joash"],
        ["Joash 2", "father", "Joash"],
        ["Joash 2", "mother", "Uriah king of Judah"],
        ["Jochebed", "spouse", "Leah king of Judah"],
        ["Noah", "father", "Joash 2"],
        ["Noah", "mother", "Matthan"],
        ["Ephraim the Gileadite", "spouse", "Noah"],
        ["Judah", "father", "Joash"],
        ["Judah", "mother", "Leah king of Judah"],
      ]),
    );
    expect(problems(l)).toEqual([]);
    expect(underLowerCouples(l)).toEqual([]);
  });
});

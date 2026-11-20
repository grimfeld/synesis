// The Family tree's layout against random families: whatever the kin, every
// box once, every child below its parents, and every line readable: through
// no box, never on another couple's drop or bar, and never sharing a run with
// the line of another pair of parents (a line that does reads as their child).
import { describe, expect, it } from "vitest";
import type { DocSummary, Kinship, KinRelation } from "../api";
import { kinGraph, type KinGraph } from "../kinship";
import { BOX_HEIGHT, familyLayout, type FamilyLayout } from "../familyTree";

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
    edges: edges.map(([c, relation, kin]) => ({ character: doc(c), relation, kin: doc(kin) })),
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

/** Closer than this reads as the same point or the same run. */
const NEAR = 4;
const key = (ps: string[]) => [...ps].sort().join("+");

/** Everything wrong with a layout, as readable lines; empty when it is sound. */
function problems(l: FamilyLayout): string[] {
  const out: string[] = [];
  const P = new Map(l.people.map((p) => [p.id, p]));
  if (P.size !== l.people.length) out.push("a Character drawn twice");
  const finite = (...xs: number[]) => xs.every(Number.isFinite);
  for (const p of l.people) if (!finite(p.x, p.y, p.width)) out.push(`NaN box ${p.id}`);
  for (const c of l.couples) if (!finite(c.x1, c.y1, c.x2, c.y2, c.dropX, c.dropY)) out.push(`NaN bar ${key([c.a, c.b])}`);
  for (const ln of l.lines) for (const [x, y] of ln.points) if (!finite(x, y)) out.push(`NaN line ${ln.child}`);
  if (out.length) return out;

  // Boxes: none overlapping.
  for (const a of l.people)
    for (const b of l.people)
      if (a.id < b.id && a.y < b.y + b.height && b.y < a.y + a.height && a.x < b.x + b.width && b.x < a.x + a.width)
        out.push(`boxes ${a.id} and ${b.id} overlap`);

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
  const downs: { k: string; child: string; x: number; a: number; b: number; beside: boolean }[] = [];
  for (const ln of l.lines) {
    const k = key(ln.parents);
    const c = P.get(ln.child)!;
    for (const pid of ln.parents) if (P.get(pid)!.y >= c.y) out.push(`${ln.child} not below ${pid}`);
    const end = ln.points.at(-1)!;
    if (Math.abs(end[0] - (c.x + c.width / 2)) > 0.5 || Math.abs(end[1] - c.y) > 0.5) out.push(`${ln.child}'s line misses its box`);
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
      if (ya === yb && xa !== xb) runs.push({ k, child: ln.child, y: ya, a: Math.min(xa, xb), b: Math.max(xa, xb) });
      if (xa === xb && ya !== yb)
        downs.push({ k, child: ln.child, x: xa, a: Math.min(ya, yb), b: Math.max(ya, yb), beside: pts.length === 5 && i === 2 });
      for (const bar of flat) {
        if (key([bar.a, bar.b]) === k) continue;
        const [bl, br] = [Math.min(bar.x1, bar.x2), Math.max(bar.x1, bar.x2)];
        // Along another couple's bar.
        if (ya === yb && Math.abs(ya - bar.y1) < NEAR && Math.min(br, Math.max(xa, xb)) - Math.max(bl, Math.min(xa, xb)) > 0)
          out.push(`${ln.child}'s line along the bar of ${key([bar.a, bar.b])}`);
        // Down through another couple's bar, or within reach of their drop.
        if (xa === xb && Math.min(ya, yb) < bar.y1 && Math.max(ya, yb) > bar.y1) {
          if (xa > bl && xa < br) out.push(`${ln.child}'s line through the bar of ${key([bar.a, bar.b])}`);
          if (Math.abs(xa - bar.dropX) < NEAR) out.push(`${ln.child}'s line down on the drop of ${key([bar.a, bar.b])}`);
        }
      }
    }
    // A child of parents in two rows: its run beside the lower row never runs
    // under a couple of that row (or a lone parent there), across the line
    // coming down from them.
    if (ln.parents.length === 2 && P.get(ln.parents[0])!.y !== P.get(ln.parents[1])!.y) {
      const lowY = Math.max(...ln.parents.map((p) => P.get(p)!.y));
      for (let i = 1; i < pts.length; i++) {
        const [[xa, ya], [xb, yb]] = [pts[i - 1], pts[i]];
        if (ya !== yb || ya < lowY + BOX_HEIGHT || ya > c.y) continue;
        for (const other of l.lines) {
          if (key(other.parents) === k || !other.parents.every((p) => P.get(p)!.y === lowY)) continue;
          const [[qx, qy], [rx, ry]] = other.points; // Down from their bar or box.
          if (qx === rx && qx > Math.min(xa, xb) - 1 && qx < Math.max(xa, xb) + 1 && ya > Math.min(qy, ry) - 1 && ya < Math.max(qy, ry) + 1)
            out.push(`${ln.child}'s line under ${key(other.parents)}`);
        }
      }
    }
  }
  // No run shared by the lines of two pairs of parents.
  for (let i = 0; i < runs.length; i++)
    for (let j = i + 1; j < runs.length; j++) {
      const [A, B] = [runs[i], runs[j]];
      if (A.k !== B.k && Math.abs(A.y - B.y) < 2 && Math.min(A.b, B.b) - Math.max(A.a, B.a) > 2)
        out.push(`${A.child} (${A.k}) and ${B.child} (${B.k}) share a run at y=${A.y}`);
    }
  // Nor the way down beside a unit of a child of parents in two rows (the
  // line from the bar, then down past the lower row) with any other line.
  for (let i = 0; i < downs.length; i++)
    for (let j = i + 1; j < downs.length; j++) {
      const [A, B] = [downs[i], downs[j]];
      if ((A.beside || B.beside) && A.k !== B.k && Math.abs(A.x - B.x) < NEAR && Math.min(A.b, B.b) - Math.max(A.a, B.a) > 2)
        out.push(`${A.child} (${A.k}) and ${B.child} (${B.k}) go down together at x=${Math.round(A.x)}`);
    }
  return [...new Set(out)];
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
 * a grandparent with a child by someone a row below, a next generation that
 * marries in, and now and then a bad edge (one parent named twice, a parent
 * cycle) or a Character whose document is missing.
 */
function randomFamily(rnd: () => number, t: number): KinGraph {
  const int = (n: number) => Math.floor(rnd() * n);
  const n = 3 + int(6);
  const P = Array.from({ length: n }, (_, i) => `P${i}`);
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
      const name = `K${k}x${c}t${t}`;
      e.push(...born([name, a, b]));
      kids.push(name);
    }
  });
  // Parents in two rows: G above P0, and a child of G by someone in P0's row.
  if (rnd() < 0.6) {
    e.push([P[0], "father", "G"]);
    if (rnd() < 0.8) e.push(...born([`X${t}`, "G", P[1 + int(n - 1)]]));
    if (rnd() < 0.4) e.push(...born([`Y${t}`, "G", P[1 + int(n - 1)]]));
    if (rnd() < 0.3) {
      const j = int(n);
      e.push([P[j], "mother", "H"]);
      if (rnd() < 0.5) e.push(["G", "spouse", "H"]);
      e.push(...born([`Z${t}`, P[int(n)], "H"]));
    }
  }
  // The next generation: a child marries in, or two cousins marry.
  if (kids.length && rnd() < 0.5) {
    const k = kids[int(kids.length)];
    const other = rnd() < 0.5 ? kids[int(kids.length)] : `Q${t}`;
    if (other !== k) {
      e.push([k, "spouse", other]);
      e.push(...born([`N${t}`, k, other]));
      if (rnd() < 0.5) e.push(...born([`M${t}`, P[int(n)], k]));
    }
  }
  if (rnd() < 0.1) e.push(...born([`S${t}`, P[int(n)], P[int(n)]])); // father == mother, now and then
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
      ...born(["k1", "A", "B"], ["k2", "A", "C"], ["k3", "A", "D"], ["k4", "B", "C"], ["k5", "B", "D"], ["k6", "C", "D"]),
    ]),
  );
  expect(problems(l)).toEqual([]);
  const drops = l.couples.map((c) => c.dropX);
  for (let i = 0; i < drops.length; i++)
    for (let j = i + 1; j < drops.length; j++) expect(Math.abs(drops[i] - drops[j])).toBeGreaterThanOrEqual(NEAR);
});

// The Family tree's layout (CONTEXT.md, Family tree; PLAN §32): every
// Character with kin, in rows by generation, each unrelated family as its own
// tree side by side. Built on the Kinship graph (`src/lib/kinship.ts`), a
// hand-written layered (Sugiyama-style) layout: rows from parent links, an
// order that keeps lines from crossing, then positions that put children
// under the parents they name. Pure: no engine, no React, no DOM.
import type { DocSummary } from "./api";
import type { KinGraph } from "./kinship";

/** Box height, the room between rows, and the gaps in a row. */
export const BOX_HEIGHT = 36;
export const ROW_GAP = 64;
/** Between two spouses: room for the bar their children hang from. */
export const COUPLE_GAP = 28;
export const UNIT_GAP = 32;
export const FAMILY_GAP = 96;

export interface LayoutOptions {
  /** A Character's box width; by default, from the length of the title. */
  width?: (doc: DocSummary) => number;
  /** Draw only this Character's line (#155): see `focusSubset`. */
  focus?: Focus;
}

/** How many generations a focused tree reaches one way: 1 to 10, or all. */
export type Generations = number | "all";
export const DEFAULT_GENERATIONS = 3;
export const MAX_GENERATIONS = 10;

/** A focused Family tree: one Character, so many generations up and down. */
export interface Focus {
  id: string;
  up: Generations;
  down: Generations;
}

/** A saved or chosen count, as a count the view can use: 1 to 10, "all", or the default. */
export function generations(raw: unknown): Generations {
  if (raw === "all") return "all";
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= MAX_GENERATIONS) return raw;
  return DEFAULT_GENERATIONS;
}

/**
 * Who a focused tree draws (#155), each with their distance from the focus
 * in generations (negative above): the focus, their ancestors `up`
 * generations up through `father` and `mother`, their descendants `down`
 * generations down, and the spouses of everyone so reached, beside them, at
 * the distance of the partner nearest the focus. Siblings and cousins are not
 * in it: they are another Character's line. Empty when the focus has no kin.
 */
export function focusSubset(g: KinGraph, f: Focus): Map<string, number> {
  const out = new Map<string, number>();
  if (!g.docs.has(f.id)) return out;
  out.set(f.id, 0);
  const reach = (n: Generations) => (n === "all" ? Infinity : n);
  const walk = (next: (id: string) => string[], limit: number, sign: 1 | -1) => {
    let ring = [f.id];
    for (let d = 1; d <= limit && ring.length; d++) {
      const nextRing: string[] = [];
      for (const id of ring)
        for (const n of next(id))
          if (g.docs.has(n) && !out.has(n)) {
            out.set(n, sign * d);
            nextRing.push(n);
          }
      ring = nextRing;
    }
  };
  walk((id) => [g.father.get(id), g.mother.get(id)].filter((p): p is string => !!p), reach(f.up), -1);
  walk((id) => g.children.get(id) ?? [], reach(f.down), 1);
  // Spouses beside the line, nearest the focus first, so each takes the
  // distance of the partner nearest the focus.
  const line = [...out.entries()].sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]));
  for (const [id, d] of line)
    for (const s of g.spouses.get(id) ?? []) if (g.docs.has(s) && !out.has(s)) out.set(s, d);
  return out;
}

/** `g` with only the Characters in `keep`, and only the ties between them. */
export function subGraph(g: KinGraph, keep: { has: (id: string) => boolean }): KinGraph {
  const docs = new Map([...g.docs].filter(([id]) => keep.has(id)));
  const ties = (m: Map<string, string>) => new Map([...m].filter(([c, p]) => docs.has(c) && docs.has(p)));
  const lists = (m: Map<string, string[]>) =>
    new Map(
      [...m]
        .filter(([id]) => docs.has(id))
        .map(([id, xs]) => [id, xs.filter((x) => docs.has(x))] as [string, string[]])
        .filter(([, xs]) => xs.length > 0),
    );
  return {
    docs,
    father: ties(g.father),
    mother: ties(g.mother),
    children: lists(g.children),
    spouses: lists(g.spouses),
    warnings: [],
  };
}

/** One Character, drawn once. `x`, `y`: the box's top-left corner. */
export interface PersonBox {
  id: string;
  doc: DocSummary;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Row in their family, 0 at the top. */
  generation: number;
  /** Index of their family, left to right. */
  family: number;
}

/**
 * Two Characters joined by a bar: spouses (`named`), or two parents a child
 * names who name no marriage. Children of the pair hang from (`dropX`, `dropY`).
 */
export interface CoupleBar {
  a: string;
  b: string;
  named: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dropX: number;
  dropY: number;
}

/** The line from the parents a child names (or the one parent) down to the child. */
export interface ParentLine {
  child: string;
  parents: string[];
  /** A polyline: from the bar or the parent's box, down to the top of the child's box. */
  points: [number, number][];
}

export interface FamilyLayout {
  people: PersonBox[];
  couples: CoupleBar[];
  lines: ParentLine[];
  /** How many unrelated families, side by side. */
  families: number;
  width: number;
  height: number;
  /** Parent ties left out to break a cycle (the engine drops them first; this never hangs). */
  skipped: number;
}

/** A width that holds the title at the view's font size, within reason. */
export function defaultWidth(doc: DocSummary): number {
  return Math.max(84, Math.min(220, Math.round(doc.title.length * 7.2 + 28)));
}

const pairKey = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`);

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x) ?? x;
    if (p === x) return x;
    p = this.find(p);
    this.parent.set(x, p);
    return p;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

/**
 * Positions that stay as close as they can to `desired` (each unit's left
 * edge), in the given order, never nearer than `widths[i] + gap` apart: the
 * pool-adjacent-violators solution of the least-squares fit, exact and linear.
 */
export function packRow(desired: number[], widths: number[], gap: number): number[] {
  const n = desired.length;
  const offset: number[] = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    offset.push(acc);
    acc += widths[i] + gap;
  }
  // Blocks of [sum of targets, count], merged while out of order.
  const sums: number[] = [];
  const counts: number[] = [];
  for (let i = 0; i < n; i++) {
    sums.push(desired[i] - offset[i]);
    counts.push(1);
    while (sums.length > 1) {
      const k = sums.length - 1;
      if (sums[k - 1] / counts[k - 1] <= sums[k] / counts[k]) break;
      sums[k - 1] += sums[k];
      counts[k - 1] += counts[k];
      sums.pop();
      counts.pop();
    }
  }
  const out: number[] = [];
  for (let b = 0, i = 0; b < sums.length; b++) {
    const y = sums[b] / counts[b];
    for (let c = 0; c < counts[b]; c++, i++) out.push(y + offset[i]);
  }
  return out;
}

/** A row's cluster of spouses, laid out side by side. */
interface Unit {
  members: string[];
  /** Each member's left edge within the unit. */
  at: number[];
  width: number;
  /** Left edge of the unit. */
  x: number;
}

/** Lay out every family in `g`, or, with `opts.focus`, that Character's line. */
export function familyLayout(full: KinGraph, opts: LayoutOptions = {}): FamilyLayout {
  const widthOf = opts.width ?? defaultWidth;
  const near = opts.focus ? focusSubset(full, opts.focus) : null;
  const g = near ? subGraph(full, near) : full;
  /** How far from the focus, for a spouse choosing a partner's row; 0 everywhere unfocused. */
  const distance = (id: string) => Math.abs(near?.get(id) ?? 0);
  const byTitle = (a: string, b: string) => {
    const da = g.docs.get(a)!;
    const db = g.docs.get(b)!;
    return da.title.localeCompare(db.title) || a.localeCompare(b);
  };
  const ids = [...g.docs.keys()].sort(byTitle);

  // ---- parent ties, with any cycle broken (a back edge of a depth-first walk).
  const named = (c: string) =>
    [g.father.get(c), g.mother.get(c)].filter((p): p is string => !!p && p !== c && g.docs.has(p));
  const kids = new Map<string, string[]>();
  for (const c of ids) for (const p of named(c)) kids.set(p, [...(kids.get(p) ?? []), c]);
  for (const list of kids.values()) list.sort(byTitle);
  const skippedTies = new Set<string>(); // `${parent}\0${child}`
  const state = new Map<string, 1 | 2>(); // 1: on the path, 2: done
  const finished: string[] = [];
  for (const root of ids) {
    if (state.has(root)) continue;
    const stack: [string, number][] = [[root, 0]];
    state.set(root, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const list = kids.get(top[0]) ?? [];
      if (top[1] >= list.length) {
        state.set(top[0], 2);
        finished.push(top[0]);
        stack.pop();
        continue;
      }
      const c = list[top[1]++];
      const s = state.get(c);
      if (s === 1) skippedTies.add(`${top[0]}\0${c}`);
      else if (s === undefined) {
        state.set(c, 1);
        stack.push([c, 0]);
      }
    }
  }
  const parentsOf = new Map<string, string[]>();
  const childrenOf = new Map<string, string[]>();
  for (const c of ids) {
    const ps = named(c).filter((p) => !skippedTies.has(`${p}\0${c}`));
    parentsOf.set(c, ps);
    for (const p of ps) childrenOf.set(p, [...(childrenOf.get(p) ?? []), c]);
  }
  const topo = finished.reverse(); // parents before children

  // ---- pairs joined by a bar: spouses, and two parents a child names.
  const partners = new Map<string, string[]>();
  const pairs = new Map<string, { a: string; b: string; named: boolean }>();
  const addPair = (a: string, b: string, isSpouse: boolean) => {
    if (a === b || !g.docs.has(a) || !g.docs.has(b)) return;
    const key = pairKey(a, b);
    const had = pairs.get(key);
    if (had) {
      had.named ||= isSpouse;
      return;
    }
    pairs.set(key, { a, b, named: isSpouse });
    partners.set(a, [...(partners.get(a) ?? []), b]);
    partners.set(b, [...(partners.get(b) ?? []), a]);
  };
  for (const id of ids) for (const s of g.spouses.get(id) ?? []) addPair(id, s, true);
  for (const c of ids) {
    const ps = parentsOf.get(c)!;
    if (ps.length === 2) addPair(ps[0], ps[1], false);
  }

  // ---- families: joined by a parent tie or a bar.
  const uf = new UnionFind();
  for (const c of ids) for (const p of parentsOf.get(c)!) uf.union(p, c);
  for (const { a, b } of pairs.values()) uf.union(a, b);

  // ---- generations: from parent links only, never from Dates.
  const gen = new Map<string, number>();
  for (const id of topo) {
    const ps = parentsOf.get(id)!;
    gen.set(id, ps.length ? Math.max(...ps.map((p) => gen.get(p)! + 1)) : 0);
  }
  // A Character with no parents drawn sits just above their nearest child,
  // or, with no child, in the row of a partner: Rebekah beside Isaac.
  const roots = ids.filter((id) => parentsOf.get(id)!.length === 0);
  for (const id of roots) {
    const cs = childrenOf.get(id) ?? [];
    if (cs.length) gen.set(id, Math.min(...cs.map((c) => gen.get(c)!)) - 1);
  }
  for (let pass = 0; pass < 2; pass++)
    for (const id of roots) {
      if ((childrenOf.get(id) ?? []).length) continue;
      const ps = partners.get(id) ?? [];
      // Focused: the row of the partner nearest the focus (#155).
      const nearest = near && [...ps].sort((a, b) => distance(a) - distance(b))[0];
      const p = ps.find((x) => parentsOf.get(x)!.length || (childrenOf.get(x) ?? []).length);
      const q = nearest || (p ?? ps[0]);
      if (q !== undefined) gen.set(id, gen.get(q)!);
    }

  // ---- each family on its own.
  const families = new Map<string, string[]>();
  for (const id of ids) {
    const r = uf.find(id);
    families.set(r, [...(families.get(r) ?? []), id]);
  }
  const order = [...families.values()].sort((a, b) => b.length - a.length || byTitle(a[0], b[0]));

  const people: PersonBox[] = [];
  const couples: CoupleBar[] = [];
  const lines: ParentLine[] = [];
  const rowY = (n: number) => n * (BOX_HEIGHT + ROW_GAP);
  let left = 0;
  let maxGen = 0;

  order.forEach((members, fi) => {
    const top = Math.min(...members.map((m) => gen.get(m)!));
    const rowOf = new Map(members.map((m) => [m, gen.get(m)! - top]));
    const rows: string[][] = [];
    for (const m of members) (rows[rowOf.get(m)!] ??= []).push(m);
    for (let r = 0; r < rows.length; r++) rows[r] ??= [];
    maxGen = Math.max(maxGen, rows.length - 1);

    // Units: spouses (and co-parents) in the same row, side by side. The one
    // with the most partners first, then theirs in the order written.
    const unitOf = new Map<string, Unit>();
    const rowUnits: Unit[][] = rows.map((row) => {
      const units: Unit[] = [];
      const seen = new Set<string>();
      // A Character's own spouses in the order written, then the rest.
      const sameRow = (id: string) =>
        [...new Set([...(g.spouses.get(id) ?? []), ...(partners.get(id) ?? [])])].filter(
          (p) => pairs.has(pairKey(id, p)) && rowOf.get(p) === rowOf.get(id),
        );
      const ranked = [...row].sort((a, b) => sameRow(b).length - sameRow(a).length || byTitle(a, b));
      for (const start of ranked) {
        if (seen.has(start)) continue;
        const list: string[] = [];
        const queue = [start];
        seen.add(start);
        while (queue.length) {
          const x = queue.shift()!;
          list.push(x);
          for (const p of sameRow(x))
            if (!seen.has(p)) {
              seen.add(p);
              queue.push(p);
            }
        }
        const at: number[] = [];
        let w = 0;
        for (const m of list) {
          at.push(w);
          w += widthOf(g.docs.get(m)!) + COUPLE_GAP;
        }
        const unit: Unit = { members: list, at, width: w - COUPLE_GAP, x: 0 };
        for (const m of list) unitOf.set(m, unit);
        units.push(unit);
      }
      return units;
    });

    const leftOf = (id: string) => {
      const u = unitOf.get(id)!;
      return u.x + u.at[u.members.indexOf(id)];
    };
    const centerOf = (id: string) => leftOf(id) + widthOf(g.docs.get(id)!) / 2;
    /** Where a child of these parents hangs from: the bar between them, or the one parent's box. */
    const drop = (ps: string[]): number => {
      if (ps.length === 1) return centerOf(ps[0]);
      const [a, b] = ps;
      const u = unitOf.get(a)!;
      if (u === unitOf.get(b)) {
        // The gap just before the later of the two: each wife's own spot on the bar.
        const j = Math.max(u.members.indexOf(a), u.members.indexOf(b));
        const prev = u.members[j - 1];
        return u.x + (u.at[j - 1] + widthOf(g.docs.get(prev)!) + u.at[j]) / 2;
      }
      return (centerOf(a) + centerOf(b)) / 2;
    };

    const pack = (units: Unit[], desired: number[]) => {
      const xs = packRow(
        desired,
        units.map((u) => u.width),
        UNIT_GAP,
      );
      units.forEach((u, i) => (u.x = xs[i]));
    };
    const packed = (units: Unit[]) => {
      let x = 0;
      for (const u of units) {
        u.x = x;
        x += u.width + UNIT_GAP;
      }
    };
    /** Under its parents: the mean of what each member's parents ask for. */
    const wantUp = (u: Unit): number | null => {
      const asks: number[] = [];
      u.members.forEach((m, i) => {
        const ps = parentsOf.get(m)!;
        if (ps.length) asks.push(drop(ps) - u.at[i] - widthOf(g.docs.get(m)!) / 2);
      });
      return asks.length ? asks.reduce((s, x) => s + x, 0) / asks.length : null;
    };
    /** Over its children: each drop point over the middle of the children hanging from it. */
    const wantDown = (u: Unit): number | null => {
      const groups = new Map<string, { ps: string[]; xs: number[] }>();
      for (const m of u.members)
        for (const c of childrenOf.get(m) ?? []) {
          const ps = parentsOf.get(c)!;
          // Two parents in this unit: counted once, from the first of them.
          if (ps.find((p) => unitOf.get(p) === u) !== m) continue;
          const key = ps.join("\0");
          let grp = groups.get(key);
          if (!grp) groups.set(key, (grp = { ps, xs: [] }));
          grp.xs.push(centerOf(c));
        }
      const asks = [...groups.values()].map(
        ({ ps, xs }) => (Math.min(...xs) + Math.max(...xs)) / 2 - (drop(ps) - u.x),
      );
      return asks.length ? asks.reduce((s, x) => s + x, 0) / asks.length : null;
    };

    // Order: the top row by title, then each row by where its parents stand,
    // a few sweeps down and up (the barycentre heuristic).
    rowUnits.forEach(packed);
    const sortBy = (units: Unit[], want: (u: Unit) => number | null) => {
      const keyed = units.map((u, i) => ({ u, i, k: want(u) ?? u.x }));
      keyed.sort((a, b) => a.k - b.k || a.i - b.i);
      units.splice(0, units.length, ...keyed.map((x) => x.u));
      packed(units);
    };
    for (let sweep = 0; sweep < 4; sweep++) {
      for (let r = 1; r < rowUnits.length; r++) sortBy(rowUnits[r], wantUp);
      for (let r = rowUnits.length - 2; r >= 0; r--) sortBy(rowUnits[r], wantDown);
    }
    for (let r = 1; r < rowUnits.length; r++) sortBy(rowUnits[r], wantUp);

    // Positions: parents over their children, children under their parents.
    for (let it = 0; it < 8; it++) {
      for (let r = rowUnits.length - 2; r >= 0; r--)
        pack(
          rowUnits[r],
          rowUnits[r].map((u) => wantDown(u) ?? u.x),
        );
      for (let r = 1; r < rowUnits.length; r++)
        pack(
          rowUnits[r],
          rowUnits[r].map((u) => wantUp(u) ?? u.x),
        );
    }

    // This family from `left`, its rows from the top.
    const all = rowUnits.flat();
    const x0 = Math.min(...all.map((u) => u.x));
    const x1 = Math.max(...all.map((u) => u.x + u.width));
    for (const u of all) u.x += left - x0;

    for (const m of members) {
      const w = widthOf(g.docs.get(m)!);
      people.push({
        id: m,
        doc: g.docs.get(m)!,
        x: leftOf(m),
        y: rowY(rowOf.get(m)!),
        width: w,
        height: BOX_HEIGHT,
        generation: rowOf.get(m)!,
        family: fi,
      });
    }
    for (const { a, b, named: isSpouse } of pairs.values()) {
      if (!rowOf.has(a)) continue;
      const ya = rowY(rowOf.get(a)!) + BOX_HEIGHT / 2;
      const yb = rowY(rowOf.get(b)!) + BOX_HEIGHT / 2;
      const [l, r] = leftOf(a) <= leftOf(b) ? [a, b] : [b, a];
      const same = ya === yb;
      const x1b = same ? leftOf(l) + widthOf(g.docs.get(l)!) : centerOf(l);
      const x2b = same ? leftOf(r) : centerOf(r);
      couples.push({
        a,
        b,
        named: isSpouse,
        x1: x1b,
        y1: l === a ? ya : yb,
        x2: x2b,
        y2: l === a ? yb : ya,
        dropX: drop([a, b]),
        dropY: (ya + yb) / 2,
      });
    }
    for (const c of members) {
      const ps = parentsOf.get(c)!;
      if (!ps.length) continue;
      const childTop = rowY(rowOf.get(c)!);
      const px = drop(ps);
      const py =
        ps.length === 1
          ? rowY(rowOf.get(ps[0])!) + BOX_HEIGHT
          : (rowY(rowOf.get(ps[0])!) + rowY(rowOf.get(ps[1])!)) / 2 + BOX_HEIGHT / 2;
      const mid = childTop - ROW_GAP / 2;
      const cx = centerOf(c);
      lines.push({
        child: c,
        parents: ps,
        points: [
          [px, py],
          [px, mid],
          [cx, mid],
          [cx, childTop],
        ],
      });
    }
    left += x1 - x0 + FAMILY_GAP;
  });

  return {
    people,
    couples,
    lines,
    families: order.length,
    width: Math.max(0, left - FAMILY_GAP),
    height: people.length ? rowY(maxGen) + BOX_HEIGHT : 0,
    skipped: skippedTies.size,
  };
}

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
/** Where pairs hang their children in a gap another pair already uses: this far from its middle. */
const DROP_SHIFTS = [0, 5, -5, 10, -10];
/** Between two lines going down beside the same unit. */
const SIDE_STEP = 6;
/** Lines keep this far from the boxes above and below a gap. */
const LANE_MARGIN = 8;
/** Between two runs of lines crossing the same gap, at most. */
const LANE_STEP = 8;
/** Closer than this, two lines read as one. */
const NEAR = 4;

export interface LayoutOptions {
  /** A Character's box width; by default, from the length of the title. */
  width?: (doc: DocSummary) => number;
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
 * `lo` and `hi` (optional, per unit) bound a left edge: the fit is clipped to
 * them, carried along the row so the order and the gaps still hold (a lower
 * bound wins over an upper one it contradicts).
 */
export function packRow(
  desired: number[],
  widths: number[],
  gap: number,
  lo: number[] = [],
  hi: number[] = [],
): number[] {
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
  const fit: number[] = [];
  for (let b = 0; b < sums.length; b++) for (let c = 0; c < counts[b]; c++) fit.push(sums[b] / counts[b]);
  // In the shifted frame the fit only rises; so do bounds carried forward (lower) and back (upper).
  const floor: number[] = [];
  for (let i = 0, m = -Infinity; i < n; i++) floor.push((m = Math.max(m, (lo[i] ?? -Infinity) - offset[i])));
  const ceil: number[] = Array(n);
  for (let i = n - 1, m = Infinity; i >= 0; i--) ceil[i] = m = Math.min(m, (hi[i] ?? Infinity) - offset[i]);
  return fit.map((y, i) => Math.max(floor[i], Math.min(ceil[i], y)) + offset[i]);
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

/** Lay out every family in `g`. */
export function familyLayout(g: KinGraph, opts: LayoutOptions = {}): FamilyLayout {
  const widthOf = opts.width ?? defaultWidth;
  const byTitle = (a: string, b: string) => {
    const da = g.docs.get(a)!;
    const db = g.docs.get(b)!;
    return da.title.localeCompare(db.title) || a.localeCompare(b);
  };
  const ids = [...g.docs.keys()].sort(byTitle);

  // ---- parent ties, with any cycle broken (a back edge of a depth-first walk).
  // A father and a mother naming the same Character is one parent: a bad edge, drawn once.
  const named = (c: string) => [
    ...new Set([g.father.get(c), g.mother.get(c)].filter((p): p is string => !!p && p !== c && g.docs.has(p))),
  ];
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
  // Characters with no parents drawn, joined by marriages among themselves,
  // stand together in one row: the row of a spouse who has parents (Tamar
  // beside Er, Rebekah beside Isaac, however long the chain of spouses), or
  // else just above the nearest child of any of them. A child is always below
  // every parent, so a spouse's row can push their children down; repeated
  // until nothing moves.
  const roots = ids.filter((id) => parentsOf.get(id)!.length === 0);
  const isRoot = new Set(roots);
  const marriedRoots = new UnionFind();
  for (const id of roots)
    for (const s of g.spouses.get(id) ?? []) if (isRoot.has(s) && s !== id) marriedRoots.union(id, s);
  const rootGroups = new Map<string, string[]>();
  for (const id of roots) {
    const r = marriedRoots.find(id);
    rootGroups.set(r, [...(rootGroups.get(r) ?? []), id]);
  }
  const groups = [...rootGroups.values()].map((group) => ({
    group,
    anchors: [...new Set(group.flatMap((id) => (g.spouses.get(id) ?? []).filter((s) => g.docs.has(s) && !isRoot.has(s))))],
    children: [...new Set(group.flatMap((id) => childrenOf.get(id) ?? []))],
  }));
  const gen = new Map<string, number>(ids.map((id) => [id, 0]));
  // Each step only moves rows down; a marriage that loops back into one's own
  // descendants could push forever, so it stops after as many steps as people.
  for (let step = 0; step <= ids.length; step++) {
    let moved = false;
    const set = (id: string, n: number) => {
      if (gen.get(id) !== n) moved = true;
      gen.set(id, n);
    };
    for (const id of topo) {
      const ps = parentsOf.get(id)!;
      if (ps.length) set(id, Math.max(...ps.map((p) => gen.get(p)! + 1)));
    }
    for (const { group, anchors, children } of groups) {
      const n = anchors.length
        ? Math.min(...anchors.map((a) => gen.get(a)!))
        : children.length
          ? Math.min(...children.map((c) => gen.get(c)!)) - 1
          : 0;
      // Never above where it stood: a row only ever moves down.
      for (const id of group) set(id, Math.max(gen.get(id)!, n));
    }
    if (!moved) break;
  }
  // Whatever stopped the loop, every child stands below its parents.
  for (const id of topo) {
    const ps = parentsOf.get(id)!;
    if (ps.length) gen.set(id, Math.max(gen.get(id)!, ...ps.map((p) => gen.get(p)! + 1)));
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

    // Units: spouses (and co-parents) in the same row, side by side, so each
    // bar spans as few boxes as it can. The one with the most partners is the
    // hub: their partners, in the order written, each stand on the side with
    // fewer boxes so far, right first (Mahlon, Ruth, Boaz: two bars, each
    // touching only its couple), and a partner's own other partners stand
    // further out on that side, so no bar of the hub runs behind them.
    const unitOf = new Map<string, Unit>();
    const degree = new Map<string, number>();
    const rowUnits: Unit[][] = rows.map((row) => {
      const units: Unit[] = [];
      const seen = new Set<string>();
      // A Character's own spouses in the order written, then the rest.
      const sameRow = (id: string) =>
        [...new Set([...(g.spouses.get(id) ?? []), ...(partners.get(id) ?? [])])].filter(
          (p) => pairs.has(pairKey(id, p)) && rowOf.get(p) === rowOf.get(id),
        );
      const ranked = [...row].sort((a, b) => sameRow(b).length - sameRow(a).length || byTitle(a, b));
      for (const id of row) degree.set(id, sameRow(id).length);
      /** `x` and the partners not yet placed, on `side` of it (both sides for the hub). */
      const spread = (x: string, side: "left" | "right" | null): string[] => {
        const next = sameRow(x).filter((p) => !seen.has(p));
        for (const p of next) seen.add(p);
        if (side === "right") return [x, ...next.flatMap((p) => spread(p, "right"))];
        if (side === "left") return [...next.map((p) => spread(p, "left")).reverse().flat(), x];
        const right: string[][] = [];
        const left: string[][] = [];
        let r = 0;
        let l = 0;
        for (const p of next) {
          if (l < r) {
            const part = spread(p, "left");
            left.push(part);
            l += part.length;
          } else {
            const part = spread(p, "right");
            right.push(part);
            r += part.length;
          }
        }
        return [...left.reverse().flat(), x, ...right.flat()];
      };
      for (const start of ranked) {
        if (seen.has(start)) continue;
        seen.add(start);
        const list = spread(start, null);
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

    // Where each pair in a unit hangs its children: the gap after its
    // `gap`th member, moved by `shift`. Neighbours, the gap between them; a
    // bar that passes behind other boxes, the gap next to the partner with
    // fewer partners, on the hub's side, so each wife has her own spot on the
    // husband's bar; never a spot another pair already hangs from (the gap
    // next to the hub then, or another between them, or else a little apart
    // in one of them, each pair its own few pixels).
    const slots = new Map<string, { gap: number; shift: number }>();
    for (const u of rowUnits.flat()) {
      const m = u.members;
      const taken = new Set<string>(); // `${gap}:${shift}`
      const far: [number, number][] = [];
      for (let i = 0; i < m.length; i++)
        for (let j = i + 1; j < m.length; j++) {
          if (!pairs.has(pairKey(m[i], m[j]))) continue;
          if (j === i + 1) {
            slots.set(pairKey(m[i], m[j]), { gap: i, shift: 0 });
            taken.add(`${i}:0`);
          } else far.push([i, j]);
        }
      for (const [i, j] of far) {
        const di = degree.get(m[i]) ?? 0;
        const dj = degree.get(m[j]) ?? 0;
        const [spoke, hub] = di < dj || (di === dj && i > j) ? [i, j] : [j, i];
        const next = spoke > hub ? spoke - 1 : spoke;
        const byHub = spoke > hub ? hub : hub - 1;
        const step = byHub > next ? 1 : -1;
        const gaps = [next, byHub];
        for (let k = next + step; k !== byHub && next !== byHub; k += step) gaps.push(k);
        const out = spoke > hub ? 1 : -1;
        let slot: { gap: number; shift: number } | null = null;
        for (const shift of DROP_SHIFTS.map((s) => s * out))
          for (const gap of gaps) if (!slot && !taken.has(`${gap}:${shift}`)) slot = { gap, shift };
        slot ??= { gap: next, shift: 0 }; // More pairs than spots: cannot happen below a dozen spouses.
        taken.add(`${slot.gap}:${slot.shift}`);
        slots.set(pairKey(m[i], m[j]), slot);
      }
    }

    const leftOf = (id: string) => {
      const u = unitOf.get(id)!;
      return u.x + u.at[u.members.indexOf(id)];
    };
    const centerOf = (id: string) => leftOf(id) + widthOf(g.docs.get(id)!) / 2;
    /** The middle of the gap after the `i`th member of `u`. */
    const gapAfter = (u: Unit, i: number) => u.x + (u.at[i] + widthOf(g.docs.get(u.members[i])!) + u.at[i + 1]) / 2;
    /**
     * Pairs in two rows going down on one side of one unit stand apart: the
     * one leaving its bar furthest out goes down furthest out.
     */
    const stagger = (list: [string, string, -1 | 1][]): [string, -1 | 1, number][] => {
      const groups = new Map<string, { k: string; dir: -1 | 1; at: number }[]>();
      for (const [a, b, dir] of list) {
        const { low, at } = slope([a, b]);
        const g = `${unitOf.get(low)!.members[0]}\n${dir}`;
        const k = pairKey(a, b);
        if (!groups.has(g)) groups.set(g, []);
        if (!groups.get(g)!.some((p) => p.k === k)) groups.get(g)!.push({ k, dir, at });
      }
      return [...groups.values()].flatMap((group) =>
        group
          .sort((p, q) => p.dir * (p.at - q.at) || (p.k < q.k ? -1 : 1))
          .map(({ k, dir }, nth): [string, -1 | 1, number] => [k, dir, nth]),
      );
    };
    /**
     * Two parents in different rows (Judah, and Tamar beside Er): the bar
     * slopes from the bottom of the upper one's box to the top of the lower
     * one's. Their children leave it in the gap above the lower row (in a
     * lane of that gap, see below; `at` is where, a quarter of the gap up),
     * and go down just outside the lower parent's unit: never through a box
     * of that row, nor through a gap a couple there hangs its own children
     * from. The side is the nearer one to `at` until the order of the rows
     * is settled; from then on it stays (`side`), so the children keep the
     * side they were ordered by and are packed wholly on it. Drawn, each
     * child's line goes down on the side nearer the child (`dir`), so it
     * never runs under the unit. Several such pairs beside one side of a unit
     * each go down a little further out (`nth`).
     */
    const side = new Map<string, { dir: -1 | 1; nth: number }>();
    const drawnAt = new Map<string, number>(); // `${pair}\n${dir}` → x, as drawn
    const slope = (ps: string[], dir?: -1 | 1) => {
      const [up, low] = rowOf.get(ps[0])! < rowOf.get(ps[1])! ? ps : [ps[1], ps[0]];
      const from: [number, number] = [centerOf(up), rowY(rowOf.get(up)!) + BOX_HEIGHT];
      const to: [number, number] = [centerOf(low), rowY(rowOf.get(low)!)];
      const along = (y: number) => from[0] + ((to[0] - from[0]) * (y - from[1])) / (to[1] - from[1]);
      const at = along(to[1] - ROW_GAP / 4);
      const u = unitOf.get(low)!;
      const before = u.x - UNIT_GAP / 4;
      const after = u.x + u.width + UNIT_GAP / 4;
      const fixed = side.get(pairKey(up, low));
      const d = dir ?? fixed?.dir ?? (Math.abs(at - before) < Math.abs(at - after) ? -1 : 1);
      const x =
        (dir === undefined ? undefined : drawnAt.get(`${pairKey(up, low)}\n${dir}`)) ??
        (d < 0 ? before : after) + d * (fixed?.nth ?? 0) * SIDE_STEP;
      return { up, low, from, to, along, at, x, dir: d, before, after };
    };
    const crossRow = (ps: string[]) => ps.length === 2 && ps[0] !== ps[1] && rowOf.get(ps[0]) !== rowOf.get(ps[1]);
    /** The x a child of these parents goes down at: the bar between them, or the one parent's box. */
    const drop = (ps: string[]): number => {
      const [a, b] = ps;
      if (b === undefined || a === b) return centerOf(a);
      if (crossRow(ps)) return slope(ps).x;
      const u = unitOf.get(a)!;
      const slot = slots.get(pairKey(a, b));
      // Two in one row are always in one unit; should they not be, midway.
      if (!slot || u !== unitOf.get(b)) return (centerOf(a) + centerOf(b)) / 2;
      return gapAfter(u, slot.gap) + slot.shift;
    };

    /**
     * A unit holding a child of parents in two rows stands wholly beside the
     * lower parent's unit, on its side: its line then never runs under that
     * unit, across the lines of the couples there.
     */
    const bounds = (u: Unit): [number, number] => {
      let [lo, hi] = [-Infinity, Infinity];
      u.members.forEach((m, i) => {
        const ps = parentsOf.get(m)!;
        if (!crossRow(ps)) return;
        const { low, dir } = slope(ps);
        const v = unitOf.get(low)!;
        const half = u.at[i] + widthOf(g.docs.get(m)!) / 2;
        if (dir > 0) lo = Math.max(lo, v.x + v.width - half);
        else hi = Math.min(hi, v.x - half);
      });
      return [lo, hi];
    };
    const pack = (units: Unit[], desired: number[]) => {
      const lohi = units.map(bounds);
      const xs = packRow(
        desired,
        units.map((u) => u.width),
        UNIT_GAP,
        lohi.map((b) => b[0]),
        lohi.map((b) => b[1]),
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

    // The order stands: each pair in two rows keeps the side its children
    // were ordered by.
    const settled: [string, string, -1 | 1][] = [];
    for (const { a, b } of pairs.values()) if (rowOf.has(a) && crossRow([a, b])) settled.push([a, b, slope([a, b]).dir]);
    for (const [k, dir, nth] of stagger(settled)) side.set(k, { dir, nth });

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
    // Lines: from the bar (or the one parent's box) down to a run across
    // the gap above the child's row, along it, and down to the child; a child
    // of parents in two rows first runs from the bar to its way down. Runs of
    // different parents that would overlap in one gap each get a lane of their
    // own, spread about the middle of the gap: two lines on one run would read
    // as one family.
    const keyOf = (ps: string[]) => (ps.length === 2 ? pairKey(ps[0], ps[1]) : ps[0]);
    /** A run across a gap: from where its line comes down (`tops`) to where its lines go on down (`downs`). */
    type Run = { gap: number; k: string; a: number; b: number; tops: number[]; downs: number[]; beside: boolean };
    const runs = new Map<string, Run>();
    const extend = (gap: number, k: string, top: number[], down: number[], span: number[] = []) => {
      const xs = [...top, ...down, ...span];
      const [a, b] = [Math.min(...xs), Math.max(...xs)];
      const run = runs.get(`${gap}\n${k}`);
      if (!run) runs.set(`${gap}\n${k}`, { gap, k, a, b, tops: top, downs: down, beside: false });
      else {
        [run.a, run.b] = [Math.min(run.a, a), Math.max(run.b, b)];
        run.tops.push(...top);
        run.downs.push(...down);
      }
    };
    const gapTop = (r: number) => rowY(r) - ROW_GAP;
    // Each child of parents in two rows: the side of the lower unit nearer to it.
    const way = new Map<string, -1 | 1>();
    const going: [string, string, -1 | 1][] = [];
    for (const c of members) {
      const ps = parentsOf.get(c)!;
      if (!crossRow(ps)) continue;
      const { before, after } = slope(ps);
      const cx = centerOf(c);
      way.set(c, Math.abs(cx - before) <= Math.abs(cx - after) ? -1 : 1);
      going.push([ps[0], ps[1], way.get(c)!]);
    }
    // Each way down beside a unit: further out than the one before it on that
    // side, and clear of every other line going down through the same gaps
    // (a few pixels apart, two lines read as one) and of every box it passes.
    const verticals = new Map<number, { x: number; k: string }[]>(); // gap → the lines down through it
    const through = (from: number, to: number, x: number, k: string) => {
      for (let r = from; r <= to; r++) verticals.set(r, [...(verticals.get(r) ?? []), { x, k }]);
    };
    const deepest = new Map<string, number>(); // `${pair}\n${dir}` → the lowest row of its children that way
    for (const c of members) {
      const ps = parentsOf.get(c)!;
      if (!ps.length) continue;
      through(rowOf.get(c)!, rowOf.get(c)!, centerOf(c), keyOf(ps));
      if (crossRow(ps)) {
        const at = `${keyOf(ps)}\n${way.get(c)}`;
        deepest.set(at, Math.max(deepest.get(at) ?? 0, rowOf.get(c)!));
      } else through(Math.max(...ps.map((p) => rowOf.get(p)!)) + 1, rowOf.get(c)!, drop(ps), keyOf(ps));
    }
    let last = { group: "", off: 0 };
    for (const [k, dir, nth] of stagger(going)) {
      const { a, b } = pairs.get(k)!;
      const { low } = slope([a, b]);
      const u = unitOf.get(low)!;
      const [top, bottom] = [rowOf.get(low)!, deepest.get(`${k}\n${dir}`)!];
      const edge = dir < 0 ? u.x : u.x + u.width;
      const group = `${u.members[0]}\n${dir}`;
      const others: { x: number; k: string }[] = [];
      for (let r = top; r <= bottom; r++) others.push(...(verticals.get(r) ?? []));
      const clear = (x: number) =>
        others.every((v) => v.k === k || Math.abs(v.x - x) > NEAR) &&
        rowUnits
          .slice(top, bottom)
          .flat()
          .every((w) => w.members.every((m, i) => x < w.x + w.at[i] - NEAR || x > w.x + w.at[i] + widthOf(g.docs.get(m)!) + NEAR));
      const first = nth === 0 || last.group !== group ? UNIT_GAP / 4 : last.off + SIDE_STEP;
      let off = first;
      for (let tries = 0; tries < 8 && !clear(edge + dir * off); tries++) off += SIDE_STEP / 2;
      if (!clear(edge + dir * off)) off = first;
      last = { group, off };
      drawnAt.set(`${k}\n${dir}`, edge + dir * off);
      through(top, bottom, edge + dir * off, k);
    }
    /** Where the line to `c` goes down from its parents. */
    const downAt = (c: string, ps: string[]) => (crossRow(ps) ? slope(ps, way.get(c)).x : drop(ps));
    for (const c of members) {
      const ps = parentsOf.get(c)!;
      if (!ps.length) continue;
      extend(rowOf.get(c)!, keyOf(ps), [downAt(c, ps)], [centerOf(c)]);
      if (crossRow(ps)) {
        runs.get(`${rowOf.get(c)!}\n${keyOf(ps)}`)!.beside = true;
        const { low, along, x } = slope(ps, way.get(c));
        const top = gapTop(rowOf.get(low)!);
        // From wherever in the gap it leaves the bar (which crosses the whole gap, whatever the lane).
        extend(rowOf.get(low)!, keyOf(ps), [], [x], [along(top + LANE_MARGIN), along(top + ROW_GAP - LANE_MARGIN)]);
      }
    }
    const lane = new Map<string, number>();
    const byGap = new Map<number, Run[]>();
    for (const run of runs.values()) byGap.set(run.gap, [...(byGap.get(run.gap) ?? []), run]);
    for (const [gap, list] of byGap) {
      // Lanes, from the top: a run passing under where another's line comes
      // down goes below that run, and one passing over where another's lines
      // go on down goes above it, so lines cross as little as they can (a
      // cycle of such asks is broken at the run waiting on fewest). Each run takes the
      // highest lane those allow that no run it would overlap holds. Two runs
      // asking each to be above the other cross whatever their lanes: neither
      // ask counts, unless one comes down beside a unit, from parents in two
      // rows; that one goes below, under no other's way down.
      const live = list.filter((r) => r.b - r.a >= 0.5); // The rest go straight down.
      live.sort((p, q) => p.a - q.a || p.b - q.b || (p.k < q.k ? -1 : 1));
      const inside = (r: Run, x: number) => x > r.a + 0.5 && x < r.b - 0.5;
      const above = live.map(() => new Set<number>());
      live.forEach((p, i) =>
        live.forEach((q, j) => {
          if (i === j) return;
          if (q.tops.some((x) => inside(p, x))) above[i].add(j);
          if (q.downs.some((x) => inside(p, x))) above[j].add(i);
        }),
      );
      above.forEach((set, i) => {
        for (const j of set) {
          if (!above[j].has(i)) continue;
          if (live[i].beside === live[j].beside || live[j].beside) set.delete(j);
          if (live[i].beside === live[j].beside || live[i].beside) above[j].delete(i);
        }
      });
      const level: number[] = live.map(() => -1);
      const waiting = (k: number) => [...above[k]].filter((j) => level[j] < 0).length;
      for (let placed = 0; placed < live.length; placed++) {
        let i = -1;
        for (let k = 0; k < live.length; k++) if (level[k] < 0 && (i < 0 || waiting(k) < waiting(i))) i = k;
        let lv = Math.max(0, ...[...above[i]].map((j) => level[j] + 1));
        const clear = (k: number) => live[k].b + UNIT_GAP / 4 < live[i].a || live[i].b + UNIT_GAP / 4 < live[k].a;
        while (level.some((l, k) => l === lv && !clear(k))) lv++;
        level[i] = lv;
      }
      const n = Math.max(0, ...level) + 1;
      const step = n > 1 ? Math.min(LANE_STEP, (ROW_GAP - 2 * LANE_MARGIN) / (n - 1)) : 0;
      const mid = gapTop(gap) + ROW_GAP / 2;
      for (const run of list) lane.set(`${gap}\n${run.k}`, mid);
      live.forEach((run, i) => lane.set(`${gap}\n${run.k}`, mid + (level[i] - (n - 1) / 2) * step));
    }
    const laneOf = (gap: number, ps: string[]) => lane.get(`${gap}\n${keyOf(ps)}`) ?? gapTop(gap) + ROW_GAP / 2;

    for (const { a, b, named: isSpouse } of pairs.values()) {
      if (!rowOf.has(a)) continue;
      if (crossRow([a, b])) {
        const { up, low, from, to, along } = slope([a, b]);
        const y = laneOf(rowOf.get(low)!, [a, b]);
        const [p, q] = up === a ? [from, to] : [to, from];
        couples.push({ a, b, named: isSpouse, x1: p[0], y1: p[1], x2: q[0], y2: q[1], dropX: along(y), dropY: y });
        continue;
      }
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
      const px = downAt(c, ps);
      const mid = laneOf(rowOf.get(c)!, ps);
      const cx = centerOf(c);
      let head: [number, number][];
      if (ps.length === 1) head = [[px, rowY(rowOf.get(ps[0])!) + BOX_HEIGHT]];
      else if (crossRow(ps)) {
        const { low, along } = slope(ps);
        const y = laneOf(rowOf.get(low)!, ps);
        head = [
          [along(y), y],
          [px, y],
        ];
      } else head = [[px, rowY(rowOf.get(ps[0])!) + BOX_HEIGHT / 2]];
      lines.push({ child: c, parents: ps, points: [...head, [px, mid], [cx, mid], [cx, childTop]] });
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

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
/** A bar between two rows leaves and lands this far off the middle of a box (the middle is for the lines of one parent alone). */
const BAR_OFF = 14;
/** How much a partner in a row above counts, against a parent, in where a Character stands. */
const PARTNER_PULL = 0.2;
/** Closer than this, two lines read as one. */
export const NEAR = 4;

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
  /** The bar as drawn, from `a` to `b`: two points in one row, a path of lanes between two rows. */
  points: [number, number][];
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

/** Appends `v` to the list `map` holds at `k`. */
function add<K, V>(map: Map<K, V[]>, k: K, v: V) {
  const list = map.get(k);
  if (list) list.push(v);
  else map.set(k, [v]);
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

/** A run of lines across one gap between rows, for `laneLevels`. */
export interface GapRun {
  /** Its extent. */
  a: number;
  b: number;
  /** Where its line comes down into it, and where its lines go on down from it. */
  tops: number[];
  downs: number[];
  /** From parents in two rows: it never runs under where another's line comes down. */
  cross: boolean;
}

/**
 * The lane of each run across one gap, 0 at the top. A run passing under
 * where another's line comes down goes below that run, and one passing over
 * where another's lines go on down goes above it, so lines cross as little as
 * they can; each run then takes the highest lane those allow that no run it
 * would overlap holds; one whose line goes on down where another's comes
 * down goes below that one. Asks that go round in a circle cannot all be met: in
 * such a circle, a run from parents in two rows (`cross`) is first let go
 * below the others, so it never runs under where another's line comes down;
 * then only asks that keep such a run below another's line count; then none.
 */
export function laneLevels(runs: GapRun[]): number[] {
  const n = runs.length;
  const inside = (r: GapRun, x: number) => x > r.a + 0.5 && x < r.b - 0.5;
  /** above[i]: the runs that go above run `i`; `firm`: the asks kept above a run from two rows. */
  const above = runs.map(() => new Set<number>());
  const firm = runs.map(() => new Set<number>());
  runs.forEach((p, i) =>
    runs.forEach((q, j) => {
      if (i === j) return;
      if (q.tops.some((x) => inside(p, x))) {
        above[i].add(j);
        if (p.cross) firm[i].add(j);
      }
      if (q.downs.some((x) => inside(p, x))) above[j].add(i);
      // Its line going on down where another's comes down: below that one,
      // so the two never run down together.
      const apart = Math.min(Infinity, ...q.tops.flatMap((x) => p.downs.map((d) => Math.abs(d - x))));
      if (apart < NEAR) {
        above[i].add(j);
        // On top of one another, they would read as one line.
        if (apart < NEAR / 2) firm[i].add(j);
      }
    }),
  );
  /** Drops every ask inside a circle that `keep` does not keep. */
  const cut = (keep: (i: number, j: number) => boolean) => {
    const part = circles(n, (i) => above[i]);
    above.forEach((set, i) => {
      for (const j of set) if (part[i] === part[j] && !keep(i, j)) set.delete(j);
    });
  };
  cut((i, j) => !runs[j].cross || runs[i].cross);
  cut((i, j) => firm[i].has(j));
  cut(() => false);
  // In order, each run once every run above it has its lane.
  const level: number[] = runs.map(() => -1);
  const waiting = runs.map((_, i) => above[i].size);
  const below = runs.map(() => [] as number[]);
  above.forEach((set, i) => set.forEach((j) => below[j].push(i)));
  const ready: number[] = [];
  for (let i = 0; i < n; i++) if (!waiting[i]) ready.push(i);
  const clear = (i: number, k: number) => runs[k].b + UNIT_GAP / 4 < runs[i].a || runs[i].b + UNIT_GAP / 4 < runs[k].a;
  while (ready.length) {
    ready.sort((p, q) => p - q);
    const i = ready.shift()!;
    let lv = Math.max(0, ...[...above[i]].map((j) => level[j] + 1));
    while (level.some((l, k) => l === lv && !clear(i, k))) lv++;
    level[i] = lv;
    for (const k of below[i]) if (--waiting[k] === 0) ready.push(k);
  }
  if (level.some((l) => l < 0)) throw new Error("laneLevels: a run left without a lane");
  return level;
}

/** Strongly connected components (Tarjan): `part[i]` is the same for runs on one circle. */
function circles(n: number, next: (i: number) => Iterable<number>): number[] {
  const index: number[] = Array(n).fill(-1);
  const low: number[] = Array(n).fill(0);
  const part: number[] = Array(n).fill(-1);
  const stack: number[] = [];
  const on = new Set<number>();
  let count = 0;
  let parts = 0;
  const visit = (v: number) => {
    index[v] = low[v] = count++;
    stack.push(v);
    on.add(v);
    for (const w of next(v)) {
      if (index[w] < 0) {
        visit(w);
        low[v] = Math.min(low[v], low[w]);
      } else if (on.has(w)) low[v] = Math.min(low[v], index[w]);
    }
    if (low[v] === index[v]) {
      let w: number;
      do {
        w = stack.pop()!;
        on.delete(w);
        part[w] = parts;
      } while (w !== v);
      parts++;
    }
  };
  for (let v = 0; v < n; v++) if (index[v] < 0) visit(v);
  return part;
}

/** A row's cluster of spouses, laid out side by side. */
interface Unit {
  members: string[];
  /** Each member's left edge within the unit. */
  at: number[];
  width: number;
  /** Left edge of the unit. */
  x: number;
  /** How many times it was turned round. */
  turned: number;
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
  // A father and a mother naming the same Character is one parent: a bad edge, drawn once.
  const named = (c: string) => [
    ...new Set([g.father.get(c), g.mother.get(c)].filter((p): p is string => !!p && p !== c && g.docs.has(p))),
  ];
  const kids = new Map<string, string[]>();
  for (const c of ids) for (const p of named(c)) add(kids, p, c);
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
    for (const p of ps) add(childrenOf, p, c);
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
    add(partners, a, b);
    add(partners, b, a);
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
  // Focused (#155), a spouse beside the line with no parents and no children
  // drawn follows the partner nearest the focus instead, so they never drag
  // another partner's row (Bilhah, wife of Jacob and of his father, beside
  // Jacob); they are placed once the rest stands.
  const followers = new Set(
    near
      ? ids.filter(
          (id) =>
            id !== opts.focus!.id &&
            parentsOf.get(id)!.length === 0 &&
            !(childrenOf.get(id) ?? []).length &&
            (partners.get(id) ?? []).length > 0,
        )
      : [],
  );
  const roots = ids.filter((id) => parentsOf.get(id)!.length === 0 && !followers.has(id));
  const isRoot = new Set(roots);
  const marriedRoots = new UnionFind();
  for (const id of roots)
    for (const s of g.spouses.get(id) ?? []) if (isRoot.has(s) && s !== id) marriedRoots.union(id, s);
  const rootGroups = new Map<string, string[]>();
  for (const id of roots) {
    const r = marriedRoots.find(id);
    add(rootGroups, r, id);
  }
  /** Everyone descended from `from`. */
  const descendants = (from: string[]) => {
    const seen = new Set<string>();
    const stack = [...from];
    while (stack.length)
      for (const c of childrenOf.get(stack.pop()!) ?? [])
        if (!seen.has(c)) {
          seen.add(c);
          stack.push(c);
        }
    return seen;
  };
  const groups = [...rootGroups.values()].map((group) => {
    // A marriage to one's own descendant (bad data, or a cycle's leftover)
    // sets no row: following it would push the rows down forever.
    const below = descendants(group);
    return {
      group,
      anchors: [
        ...new Set(
          group.flatMap((id) =>
            (g.spouses.get(id) ?? []).filter((s) => g.docs.has(s) && !isRoot.has(s) && !followers.has(s) && !below.has(s)),
          ),
        ),
      ],
      children: [...new Set(group.flatMap((id) => childrenOf.get(id) ?? []))],
    };
  });
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
  for (const id of followers) {
    const nearest = [...partners.get(id)!].filter((p) => !followers.has(p)).sort((a, b) => distance(a) - distance(b))[0];
    if (nearest !== undefined) gen.set(id, gen.get(nearest)!);
  }

  // ---- each family on its own.
  const families = new Map<string, string[]>();
  for (const id of ids) {
    const r = uf.find(id);
    add(families, r, id);
  }
  const order = [...families.values()].sort((a, b) => b.length - a.length || byTitle(a[0], b[0]));

  const people: PersonBox[] = [];
  const couples: CoupleBar[] = [];
  const lines: ParentLine[] = [];
  const rowY = (n: number) => n * (BOX_HEIGHT + ROW_GAP);
  let left = 0;
  let maxGen = 0;

  order.forEach((members, fi) => {
    // Rows from the top, none left empty: a child stays below its parents
    // and spouses in one row, whatever gaps the generations left.
    const used = [...new Set(members.map((m) => gen.get(m)!))].sort((a, b) => a - b);
    const rowOf = new Map(members.map((m) => [m, used.indexOf(gen.get(m)!)]));
    const rows: string[][] = used.map(() => []);
    for (const m of members) rows[rowOf.get(m)!].push(m);
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
        const unit: Unit = { members: list, at, width: w - COUPLE_GAP, x: 0, turned: 0 };
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

    /** `u` the other way round, each pair keeping its own gap. */
    const turn = (u: Unit) => {
      const m = u.members;
      for (let i = 0; i + 1 < m.length; i++)
        for (let j = i + 1; j < m.length; j++) {
          const slot = slots.get(pairKey(m[i], m[j]));
          if (slot)
            slots.set(pairKey(m[i], m[j]), {
              gap: m.length - 2 - slot.gap,
              shift: -slot.shift,
            });
        }
      m.reverse();
      u.turned++;
      const r = rowOf.get(m[0])!;
      lines_.delete(r);
      lines_.delete(r + 1);
      let w = 0;
      u.at = m.map((id) => {
        const at = w;
        w += widthOf(g.docs.get(id)!) + COUPLE_GAP;
        return at;
      });
    };
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
        const { low, at } = bar([a, b]);
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
     * leaves the bottom of the upper one's box a little off its middle
     * (`sx`), goes down into the gap below, and on along a lane of the gap
     * above the lower row to land a little off the middle of the lower one's
     * box (`lx`): no slope across other lines and boxes. Parents more than a
     * row apart: it first runs along a lane of the gap below the upper one to
     * the way down beside the lower parent's unit, and down there. Their
     * children leave the bar in the gap above the lower row and go down just
     * outside the lower parent's unit (`x`): never through a box of that
     * row, nor through a gap a couple there hangs its own children from. The
     * side is the one where the bar passes over fewer boxes with a line of
     * their own coming down (`over`), else the nearer one to where it comes
     * from (`at`), until the first positions are found; from then on it
     * stays (`side`, settled again should the final places make the other
     * side better), and each child's centre is packed on it. Drawn, each
     * child's line goes down on the side nearer the child (`dir`), so it
     * never runs under the unit, unless that side passes over more such
     * boxes. Several such pairs beside one side of a unit each go down a
     * little further out (`nth`).
     */
    const side = new Map<string, { dir: -1 | 1; nth: number }>();
    const drawnAt = new Map<string, number>(); // `${pair}\n${dir}` → x, as drawn
    /** A little off the middle of `id`'s box, towards `x`. */
    const offMiddle = (id: string, x: number, nth = 0) => {
      const c = centerOf(id);
      const w = widthOf(g.docs.get(id)!);
      return c + (x < c ? -1 : 1) * Math.min(w / 2 - 4, BAR_OFF + nth * SIDE_STEP);
    };
    /** What `bar` found, until a unit moves or a side is settled (`moved`). */
    let known = new Map<string, ReturnType<typeof barNow> & { ax: number; bx: number; ta: number; tb: number }>();
    let settling = false;
    let lines_ = new Map<number, { k: string; c: number; x: number | null }[]>();
    const moved = () => {
      known = new Map();
      lines_ = new Map();
    };
    const bar = (ps: string[], dir?: -1 | 1) => {
      // Placing moves units without a word: what it found holds while the two parents' units stay put.
      const a = unitOf.get(ps[0])!;
      const b = unitOf.get(ps[1])!;
      const k = dir === undefined ? ps[0] + "\0" + ps[1] : ps[0] + "\0" + ps[1] + (dir < 0 ? "\n-" : "\n+");
      let found = known.get(k);
      if (!found || found.ax !== a.x || found.bx !== b.x || found.ta !== a.turned || found.tb !== b.turned)
        known.set(k, (found = { ...barNow(ps, dir), ax: a.x, bx: b.x, ta: a.turned, tb: b.turned }));
      return found;
    };
    const barNow = (ps: string[], dir?: -1 | 1) => {
      const [up, low] = rowOf.get(ps[0])! < rowOf.get(ps[1])! ? ps : [ps[1], ps[0]];
      const far = rowOf.get(low)! - rowOf.get(up)! > 1;
      const u = unitOf.get(low)!;
      const before = u.x - UNIT_GAP / 4;
      const after = u.x + u.width + UNIT_GAP / 4;
      const fixed = side.get(pairKey(up, low));
      const sx = offMiddle(up, centerOf(low));
      const at = far ? centerOf(up) : sx;
      /** Where the bar comes into the gap above the lower row, going down on side `d`. */
      const entry = (d: -1 | 1) => (far ? (d < 0 ? before : after) : sx);
      const kids = (childrenOf.get(up) ?? []).some((c) => parentsOf.get(c)!.includes(low));
      /** Boxes of the lower row with a line of their own coming down that the bar passes over, its children going down on side `d`. */
      const passes = (d: -1 | 1) => {
        const lx = offMiddle(low, entry(d));
        const xs = kids ? [entry(d), lx, d < 0 ? before : after] : [entry(d), lx];
        const [l, r] = [Math.min(...xs), Math.max(...xs)];
        return linesInto(rowOf.get(low)!, l, r);
      };
      // (While placing before the sides are settled, only the nearer: weighing the lines each passes is slow.)
      const natural = (): -1 | 1 =>
        ((settling ? passes(-1) - passes(1) : 0) || Math.abs(at - before) - Math.abs(at - after)) < 0 ? -1 : 1;
      const d = dir ?? fixed?.dir ?? natural();
      const x =
        (dir === undefined ? undefined : drawnAt.get(`${pairKey(up, low)}\n${dir}`)) ??
        (d < 0 ? before : after) + d * (fixed?.nth ?? 0) * SIDE_STEP;
      return { up, low, far, at, x, dir: d, before, after, passes, over: () => Math.min(passes(-1), passes(1)) };
    };
    /**
     * What a run between `l` and `r` across the gap above `row` costs in
     * lines coming down into that row it would cross: each one once, and one
     * coming straight down (no run of its own to pass under) as ten.
     */
    const linesInto = (row: number, l: number, r: number, but = "") => {
      let into = lines_.get(row);
      if (!into) {
        // Each child in the row: its parents, its middle, and where its line leaves them (none for parents in two rows).
        into = rows[row].flatMap((m) => {
          const ps = parentsOf.get(m)!;
          if (!ps.length) return [];
          return [{ k: ps.join("\0"), c: centerOf(m), x: crossRow(ps) ? null : drop(ps) }];
        });
        lines_.set(row, into);
      }
      let n = 0;
      const seen = new Set<string>([but]);
      const inside = (x: number) => x > l && x < r;
      for (const { k, c, x } of into) {
        if (seen.has(k)) continue;
        if (x === null) {
          if (inside(c)) n++;
          continue;
        }
        if (Math.abs(x - c) < 0.5 && inside(x)) n += 10;
        else if (inside(x) || inside(c)) n++;
        // The rest of its children: crossed at most once more, under its run.
        if (inside(x)) seen.add(k);
      }
      return n;
    };
    const crossRow = (ps: string[]) => ps.length === 2 && ps[0] !== ps[1] && rowOf.get(ps[0]) !== rowOf.get(ps[1]);
    /** The x a child of these parents goes down at: the bar between them, or the one parent's box. */
    const drop = (ps: string[]): number => {
      const [a, b] = ps;
      if (b === undefined || a === b) return centerOf(a);
      if (crossRow(ps)) return bar(ps).x;
      const u = unitOf.get(a)!;
      const slot = slots.get(pairKey(a, b));
      // Two in one row are always in one unit; should they not be, midway.
      if (!slot || u !== unitOf.get(b)) return (centerOf(a) + centerOf(b)) / 2;
      return gapAfter(u, slot.gap) + slot.shift;
    };

    /**
     * A unit holding a child of parents in two rows has that child's centre
     * beside the lower parent's unit, on the pair's side: the child's line
     * then never runs under that unit, across the lines of the couples there.
     * (Only the centre: the rest of the child's unit may stand under it.)
     */
    const bounds = (u: Unit): [number, number] => {
      let [lo, hi] = [-Infinity, Infinity];
      u.members.forEach((m, i) => {
        const ps = parentsOf.get(m)!;
        if (!crossRow(ps)) return;
        const { low, dir, x } = bar(ps);
        const v = unitOf.get(low)!;
        const half = u.at[i] + widthOf(g.docs.get(m)!) / 2;
        if (dir > 0) lo = Math.max(lo, v.x + v.width - half);
        else hi = Math.min(hi, v.x - half);
        // …and before the next unit with a line coming down, in that row
        // and the row above the child's: its run there passes under none.
        for (const r of new Set([rowOf.get(low)!, rowOf.get(m)! - 1])) {
          const f = fence(r, x, dir);
          if (dir > 0) hi = Math.min(hi, f - half);
          else lo = Math.max(lo, f - half);
        }
      });
      return [lo, hi];
    };
    /** The near edge of the nearest unit of row `r` past `x` on side `d` with a line coming down from it. */
    const fence = (r: number, x: number, d: -1 | 1) => {
      let best = d > 0 ? Infinity : -Infinity;
      for (const w of rowUnits[r]) {
        if (!w.members.some((m) => childrenOf.get(m)?.length)) continue;
        if (d > 0 && w.x > x && w.x < best) best = w.x;
        if (d < 0 && w.x + w.width < x && w.x + w.width > best) best = w.x + w.width;
      }
      return best;
    };
    /** Room left and right of a unit for the lines of more than one pair going down on that side. */
    const room = new Map<Unit, [number, number]>();
    const pack = (units: Unit[], desired: number[], bounded: boolean) => {
      const lohi = bounded ? units.map(bounds) : [];
      const pad = units.map((u) => (bounded && room.get(u)) || [0, 0]);
      const xs = packRow(
        desired.map((x, i) => x - pad[i][0]),
        units.map((u, i) => u.width + pad[i][0] + pad[i][1]),
        UNIT_GAP,
        lohi.map((b, i) => b[0] - pad[i][0]),
        lohi.map((b, i) => b[1] - pad[i][0]),
      );
      units.forEach((u, i) => (u.x = xs[i] + pad[i][0]));
      lines_ = new Map();
    };
    const packed = (units: Unit[]) => {
      let x = 0;
      for (const u of units) {
        u.x = x;
        x += u.width + UNIT_GAP;
      }
      moved();
    };
    /** Under its parents: the mean of what each member's parents ask for. */
    const wantUp = (u: Unit): number | null => {
      let [sum, weight] = [0, 0];
      u.members.forEach((m, i) => {
        const ps = parentsOf.get(m)!;
        const mid = u.at[i] + widthOf(g.docs.get(m)!) / 2;
        if (ps.length) [sum, weight] = [sum + drop(ps) - mid, weight + 1];
        // A little towards a partner in a row above, where the bar between them comes from.
        for (const p of partners.get(m) ?? [])
          if (rowOf.has(p) && rowOf.get(p)! < rowOf.get(m)!)
            [sum, weight] = [sum + (centerOf(p) - mid) * PARTNER_PULL, weight + PARTNER_PULL];
      });
      return weight ? sum / weight : null;
    };
    /** Over its children: each drop point over the middle of the children hanging from it. */
    /** A unit's children, by the parents they name (two parents in the unit counted once); `up`: the upper of parents in two rows. */
    const broods = new Map<Unit, { ps: string[]; kids: string[]; up: string | null }[]>();
    const broodsOf = (u: Unit) => {
      let list = broods.get(u);
      if (list) return list;
      const byKey = new Map<string, { ps: string[]; kids: string[]; up: string | null }>();
      for (const m of u.members)
        for (const c of childrenOf.get(m) ?? []) {
          const ps = parentsOf.get(c)!;
          if (ps.find((p) => unitOf.get(p) === u) !== m) continue;
          const key = ps.join("\0");
          let b = byKey.get(key);
          const up = crossRow(ps) && rowOf.get(m)! < rowOf.get(ps.find((p) => p !== m)!)! ? m : null;
          if (!b) byKey.set(key, (b = { ps, kids: [], up }));
          b.kids.push(c);
        }
      broods.set(u, (list = [...byKey.values()]));
      return list;
    };
    const wantDown = (u: Unit): number | null => {
      let [sum, n] = [0, 0];
      for (const { ps, kids, up } of broodsOf(u)) {
        // Parents in two rows: their children go down beside the lower
        // parent's unit, wherever the upper one stands (the upper one
        // following them would chase them forever); the upper one is drawn
        // towards where its bar goes instead, which it does not move.
        if (up) {
          const { far, x, low } = bar(ps);
          sum += (far ? x : centerOf(low)) - (centerOf(up) - u.x);
        } else {
          let [lo, hi] = [Infinity, -Infinity];
          for (const c of kids) {
            const x = centerOf(c);
            if (x < lo) lo = x;
            if (x > hi) hi = x;
          }
          sum += (lo + hi) / 2 - (drop(ps) - u.x);
        }
        n++;
      }
      return n ? sum / n : null;
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
    const place = (bounded: boolean) => {
      // Eight passes, or fewer once a pass leaves every unit where the last one did.
      const all = rowUnits.flat();
      let was = all.map((u) => u.x);
      for (let it = 0; it < 8; it++) {
        for (let r = rowUnits.length - 2; r >= 0; r--)
          pack(
            rowUnits[r],
            rowUnits[r].map((u) => wantDown(u) ?? u.x),
            bounded,
          );
        for (let r = 1; r < rowUnits.length; r++)
          pack(
            rowUnits[r],
            rowUnits[r].map((u) => wantUp(u) ?? u.x),
            bounded,
          );
        const now = all.map((u) => u.x);
        if (now.every((x, i) => Math.abs(x - was[i]) < 0.5)) break;
        was = now;
      }
    };
    place(false);
    const acrossRows = [...pairs.values()]
      .filter(({ a, b }) => rowOf.has(a) && crossRow([a, b]))
      .map(({ a, b }) => [a, b]);
    /** A unit a pair in two rows comes down to turned round when its lines would then pass over fewer boxes with a line of their own coming down. */
    const turnAll = () => {
      for (const u of rowUnits.flat()) {
        if (u.members.length < 2) continue;
        const mine = acrossRows.filter((ps) => ps.some((p) => unitOf.get(p) === u));
        if (!mine.length) continue;
        const over = () => mine.reduce((n, ps) => n + bar(ps).over(), 0);
        // Turning the unit of the upper parent moves its own lines too: only
        // to spare a line coming straight down.
        const need = mine.some((ps) => unitOf.get(bar(ps).low) === u) ? 1 : 10;
        const was = over();
        turn(u);
        if (over() > was - need) turn(u);
      }
    };
    // From there, each pair in two rows keeps the side its children go down
    // on; each row is ordered once more by where its parents stand within
    // those sides (one that must stand left of a unit above before one that
    // must stand right of it, so packing can hold both), and placed again.
    // A row whose widths cannot hold a unit on its side in that order trades
    // it with its neighbour that way, and the rows are placed again. Should
    // the new places make the other side of a pair's unit the better one
    // (`over`), it is settled again, a few times at most.
    for (let round = 0; round < 2; round++) {
      const was = new Map(side);
      side.clear();
      moved();
      settling = true;
      turnAll();
      const settled = acrossRows.map(([a, b]): [string, string, -1 | 1] => {
        const s = bar([a, b]);
        const kept = was.get(pairKey(a, b))?.dir;
        // A side kept unless the other is strictly better.
        const better = kept !== undefined && s.passes(kept) <= s.passes(s.dir) ? kept : s.dir;
        return [a, b, better];
      });
      for (const [k, dir, nth] of stagger(settled)) side.set(k, { dir, nth });
      moved();
      // Room beside a unit for the ways down of pairs on one side, and for
      // their children in the row below to stand there, before the next unit.
      room.clear();
      const besides = new Map<string, Set<Unit>>();
      for (const c of members) {
        const ps = parentsOf.get(c)!;
        if (!crossRow(ps)) continue;
        const { low, dir } = bar(ps);
        if (rowOf.get(c) !== rowOf.get(low)! + 1) continue;
        const at = `${low}\n${dir}`;
        besides.set(at, (besides.get(at) ?? new Set()).add(unitOf.get(c)!));
      }
      for (const [k, { dir, nth }] of side) {
        const { low } = bar(k.split("\0"));
        const u = unitOf.get(low)!;
        const kids = [...(besides.get(`${low}\n${dir}`) ?? [])];
        const wide = kids.reduce((w, c) => w + c.width, 0) + (kids.length - 2) * UNIT_GAP;
        const r = room.get(u) ?? [0, 0];
        r[dir < 0 ? 0 : 1] = Math.max(r[dir < 0 ? 0 : 1], nth * SIDE_STEP, wide);
        room.set(u, r);
      }
      if (round > 0 && [...side].every(([k, { dir }]) => was.get(k)?.dir === dir)) break;
      for (let r = 1; r < rowUnits.length; r++) {
        const keyed = rowUnits[r].map((u, i) => {
          const [lo, hi] = bounds(u);
          return { u, i, k: Math.max(lo, Math.min(hi, wantUp(u) ?? u.x)) };
        });
        keyed.sort((a, b) => a.k - b.k || a.i - b.i);
        rowUnits[r].splice(0, rowUnits[r].length, ...keyed.map((x) => x.u));
      }
      place(true);
      for (let tries = 0; tries < 4; tries++) {
        let moved = false;
        for (const row of rowUnits)
          for (let i = 0; i < row.length; i++) {
            const [lo, hi] = bounds(row[i]);
            const j = row[i].x > hi + 0.5 ? i - 1 : row[i].x < lo - 0.5 ? i + 1 : i;
            if (j === i || j < 0 || j >= row.length) continue;
            [row[i], row[j]] = [row[j], row[i]];
            moved = true;
            i = Math.max(i, j);
          }
        if (!moved) break;
        place(true);
      }
    }

    // This family from `left`, its rows from the top.
    const all = rowUnits.flat();
    const x0 = Math.min(...all.map((u) => u.x));
    const x1 = Math.max(...all.map((u) => u.x + u.width));
    for (const u of all) u.x += left - x0;
    moved();

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
    // the gap above the child's row, along it, and down to the child. Runs of
    // different parents that would overlap in one gap each get a lane of their
    // own (`laneLevels`), spread about the middle of the gap: two lines on one
    // run would read as one family. A bar between two rows runs along lanes
    // too, like a line.
    const keyOf = (ps: string[]) => (ps.length === 2 ? pairKey(ps[0], ps[1]) : ps[0]);
    /** A run across a gap: from where its line comes down (`tops`) to where its lines go on down (`downs`). */
    type Run = GapRun & { gap: number; k: string };
    const runs = new Map<string, Run>();
    const extend = (gap: number, k: string, top: number[], down: number[], cross = false) => {
      const xs = [...top, ...down];
      const [a, b] = [Math.min(...xs), Math.max(...xs)];
      const run = runs.get(`${gap}\n${k}`);
      if (!run) runs.set(`${gap}\n${k}`, { gap, k, a, b, tops: top, downs: down, cross });
      else {
        [run.a, run.b] = [Math.min(run.a, a), Math.max(run.b, b)];
        run.tops.push(...top);
        run.downs.push(...down);
        run.cross ||= cross;
      }
    };
    const gapTop = (r: number) => rowY(r) - ROW_GAP;
    // Each child of parents in two rows: the side of the lower unit nearer to it.
    const way = new Map<string, -1 | 1>();
    const going = new Map<string, Set<-1 | 1>>(); // pair → the sides its bar or children go down
    for (const ps of acrossRows) going.set(pairKey(ps[0], ps[1]), new Set([bar(ps).dir]));
    for (const c of members) {
      const ps = parentsOf.get(c)!;
      if (!crossRow(ps)) continue;
      const { before, after, passes } = bar(ps);
      const cx = centerOf(c);
      const near = Math.abs(cx - before) <= Math.abs(cx - after) ? -1 : 1;
      // The other side, should the nearer one cross more lines, from the bar and on to the child.
      const cost = (d: -1 | 1) => {
        const x = d < 0 ? before : after;
        return passes(d) + linesInto(rowOf.get(c)!, Math.min(x, cx), Math.max(x, cx), ps.join("\0"));
      };
      const other = -near as -1 | 1;
      way.set(c, cost(near) > cost(other) ? other : near);
      going.get(keyOf(ps))!.add(way.get(c)!);
    }
    // Each way down beside a unit: further out than the one before it on that
    // side, and clear of every other line going down through the same gaps
    // (a few pixels apart, two lines read as one) and of every box it passes.
    const verticals = new Map<number, { x: number; k: string }[]>(); // gap → the lines down through it
    const through = (from: number, to: number, x: number, k: string) => {
      for (let r = from; r <= to; r++) {
        add(verticals, r, { x, k });
        const list = sortedDown.get(r);
        if (list) {
          let i = list.length;
          while (i > 0 && list[i - 1].x > x) i--;
          list.splice(i, 0, { x, k });
        }
      }
    };
    /** The lines down through gap `r`, by x (kept until another is added). */
    const sortedDown = new Map<number, { x: number; k: string }[]>();
    const downIn = (r: number) => {
      let list = sortedDown.get(r);
      if (!list) sortedDown.set(r, (list = [...(verticals.get(r) ?? [])].sort((p, q) => p.x - q.x)));
      return list;
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
    /** `x` a few pixels from every other line going down through gaps `top` to `bottom`, and from every box of rows `top` to `bottom - 1`. */
    const clearAt = (top: number, bottom: number, k: string, x: number) => {
      for (let r = top; r <= bottom; r++) {
        const list = downIn(r);
        let [i, j] = [0, list.length];
        while (i < j) {
          const h = (i + j) >> 1;
          if (list[h].x < x - NEAR) i = h + 1;
          else j = h;
        }
        for (; i < list.length && list[i].x <= x + NEAR; i++) if (list[i].k !== k) return false;
      }
      for (let r = top; r < bottom; r++)
        for (const w of rowUnits[r])
          if (x > w.x - NEAR && x < w.x + w.width + NEAR)
            if (
              w.members.some((m, i) => x >= w.x + w.at[i] - NEAR && x <= w.x + w.at[i] + widthOf(g.docs.get(m)!) + NEAR)
            )
              return false;
      return true;
    };
    let last = { group: "", off: 0 };
    const ways = [...going].flatMap(([k, dirs]) =>
      [...dirs].map((d): [string, string, -1 | 1] => [...(k.split("\0") as [string, string]), d]),
    );
    for (const [k, dir] of stagger(ways)) {
      const { a, b } = pairs.get(k)!;
      const { low } = bar([a, b]);
      const u = unitOf.get(low)!;
      const top = rowOf.get(low)!;
      const bottom = Math.max(rowOf.get(low)!, deepest.get(`${k}\n${dir}`) ?? 0);
      const edge = dir < 0 ? u.x : u.x + u.width;
      const group = `${u.members[0]}\n${dir}`;
      const clear = (x: number) => clearAt(top, bottom, k, x);
      const first = last.group !== group ? UNIT_GAP / 4 : last.off + SIDE_STEP;
      let off = first;
      for (let tries = 0; tries < 24 && !clear(edge + dir * off); tries++) off += SIDE_STEP / 2;
      if (!clear(edge + dir * off)) off = first;
      last = { group, off };
      drawnAt.set(`${k}\n${dir}`, edge + dir * off);
      moved();
      through(top, bottom, edge + dir * off, k);
    }
    // The bar of parents more than a row apart comes down through the rows
    // between them where it crosses fewest lines on its way there and on to
    // the lower parent, clear of their boxes and lines, nearest where its
    // children go down.
    const downThrough = new Map<string, number>();
    for (const ps of acrossRows) {
      const { up, low, far, dir } = bar(ps);
      if (!far) continue;
      const k = pairKey(ps[0], ps[1]);
      const [top, bottom] = [rowOf.get(up)! + 1, rowOf.get(low)!];
      const px = bar(ps, dir).x;
      const sx = offMiddle(up, px);
      const cost = (x: number) => {
        const lx = offMiddle(low, x);
        return linesInto(top, Math.min(sx, x), Math.max(sx, x)) + linesInto(bottom, Math.min(x, lx), Math.max(x, lx));
      };
      // Free stretches of the rows between, from `lo` to `hi`: off every box and other line there.
      const freeIn = (lo: number, hi: number) => {
        const blocked: [number, number][] = [];
        for (let r = top; r < bottom; r++)
          for (const w of rowUnits[r])
            if (w.x - NEAR < hi && w.x + w.width + NEAR > lo)
              w.members.forEach((m, i) =>
                blocked.push([w.x + w.at[i] - NEAR, w.x + w.at[i] + widthOf(g.docs.get(m)!) + NEAR]),
              );
        for (let r = top; r <= bottom; r++) {
          const list = downIn(r);
          let [i, j] = [0, list.length];
          while (i < j) {
            const h = (i + j) >> 1;
            if (list[h].x < lo - NEAR) i = h + 1;
            else j = h;
          }
          for (; i < list.length && list[i].x - NEAR < hi; i++)
            if (list[i].k !== k) blocked.push([list[i].x - NEAR, list[i].x + NEAR]);
        }
        blocked.sort((p, q) => p[0] - q[0]);
        const free: [number, number][] = [];
        let from = lo;
        for (const [l, r] of blocked) {
          if (l > from) free.push([from, Math.min(l, hi)]);
          from = Math.max(from, r);
        }
        if (from < hi) free.push([from, hi]);
        return free;
      };
      let best: [number, number] | null = null; // [cost, x]
      const pick = (free: [number, number][]) => {
        for (const [l, r] of free) {
          if (r - l < 1) continue;
          const inner = (x: number) => Math.max(l + 0.5, Math.min(r - 0.5, x));
          for (const x of new Set([inner(px), inner(sx), inner(l + 0.5), inner(r - 0.5)])) {
            const c = cost(x) * 1000 + Math.abs(x - px);
            if (!best || c < best[0]) best = [c, x];
          }
        }
      };
      // Near where its children go down, or where it leaves; else anywhere.
      pick(freeIn(px - 4 * UNIT_GAP, px + 4 * UNIT_GAP));
      pick(freeIn(sx - 4 * UNIT_GAP, sx + 4 * UNIT_GAP));
      if (!best) {
        const span = rowUnits.slice(top, bottom).flat();
        pick(
          freeIn(
            Math.min(px, ...span.map((w) => w.x)) - UNIT_GAP,
            Math.max(px, ...span.map((w) => w.x + w.width)) + UNIT_GAP,
          ),
        );
      }
      const x = best?.[1] ?? px;
      downThrough.set(k, x);
      through(top, bottom, x, k);
    }
    /** Where the line to `c` goes down from its parents. */
    const downAt = (c: string, ps: string[]) => (crossRow(ps) ? bar(ps, way.get(c)).x : drop(ps));
    // Each bar between two rows: where it leaves and lands, a little apart from another's on the same box.
    const ends = new Map<string, { sx: number; xv: number; entry: number; lx: number }>();
    {
      const leaving = new Map<string, { k: string; to: number }[]>();
      const landing = new Map<string, { k: string; from: number }[]>();
      const xv = (ps: string[]) => downThrough.get(pairKey(ps[0], ps[1])) ?? bar(ps, bar(ps).dir).x;
      for (const ps of acrossRows) {
        const { up, low, far } = bar(ps);
        const x = xv(ps);
        const k = pairKey(ps[0], ps[1]);
        add(leaving, up, { k, to: far ? x : centerOf(low) });
      }
      const nth = new Map<string, number>();
      for (const [id, list] of leaving) {
        list.sort((p, q) => p.to - q.to);
        const c = centerOf(id);
        const left = list.filter((p) => p.to < c).reverse();
        const right = list.filter((p) => p.to >= c);
        for (const side of [left, right]) side.forEach((p, i) => nth.set(`${p.k}\nup`, i));
      }
      for (const ps of acrossRows) {
        const { up, low, far } = bar(ps);
        const x = xv(ps);
        const k = pairKey(ps[0], ps[1]);
        const sx = offMiddle(up, far ? x : centerOf(low), nth.get(`${k}\nup`));
        const entry = far ? x : sx;
        add(landing, low, { k, from: entry });
        ends.set(k, { sx, xv: x, entry, lx: 0 });
      }
      for (const [id, list] of landing) {
        const c = centerOf(id);
        const left = list.filter((p) => p.from < c).sort((p, q) => q.from - p.from);
        const right = list.filter((p) => p.from >= c).sort((p, q) => p.from - q.from);
        for (const side of [left, right]) side.forEach((p, i) => (ends.get(p.k)!.lx = offMiddle(id, p.from, i)));
      }
    }
    for (const ps of acrossRows) {
      const { up, low, far } = bar(ps);
      const k = pairKey(ps[0], ps[1]);
      const { sx, xv, entry, lx } = ends.get(k)!;
      if (far) extend(rowOf.get(up)! + 1, k, [sx], [xv], true);
      else through(rowOf.get(low)!, rowOf.get(low)!, sx, k);
      through(rowOf.get(low)!, rowOf.get(low)!, lx, k);
      extend(rowOf.get(low)!, k, [entry], [lx], true);
    }
    for (const c of members) {
      const ps = parentsOf.get(c)!;
      if (!ps.length) continue;
      extend(rowOf.get(c)!, keyOf(ps), [downAt(c, ps)], [centerOf(c)], crossRow(ps));
      if (crossRow(ps)) extend(rowOf.get(bar(ps).low)!, keyOf(ps), [], [downAt(c, ps)], true);
    }
    const lane = new Map<string, number>();
    const byGap = new Map<number, Run[]>();
    for (const run of runs.values()) add(byGap, run.gap, run);
    for (const [gap, list] of byGap) {
      const live = list.filter((r) => r.b - r.a >= 0.5); // The rest go straight down.
      live.sort((p, q) => p.a - q.a || p.b - q.b || (p.k < q.k ? -1 : 1));
      const level = laneLevels(live);
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
        const { up, low, far } = bar([a, b]);
        const { sx, xv, entry, lx } = ends.get(pairKey(a, b))!;
        const y = laneOf(rowOf.get(low)!, [a, b]);
        const points: [number, number][] = [[sx, rowY(rowOf.get(up)!) + BOX_HEIGHT]];
        if (far) {
          const y1 = laneOf(rowOf.get(up)! + 1, [a, b]);
          points.push([sx, y1], [xv, y1]);
        }
        points.push([entry, y], [lx, y], [lx, rowY(rowOf.get(low)!)]);
        if (up !== a) points.reverse();
        // Children hang from where the bar comes into the lower gap, or the nearest point to their way down.
        const px = bar([a, b], bar([a, b]).dir).x;
        const dropX = Math.max(Math.min(entry, lx), Math.min(Math.max(entry, lx), px));
        couples.push({
          a,
          b,
          named: isSpouse,
          x1: points[0][0],
          y1: points[0][1],
          x2: points.at(-1)![0],
          y2: points.at(-1)![1],
          points,
          dropX,
          dropY: y,
        });
        continue;
      }
      const ya = rowY(rowOf.get(a)!) + BOX_HEIGHT / 2;
      const yb = rowY(rowOf.get(b)!) + BOX_HEIGHT / 2;
      const [l, r] = leftOf(a) <= leftOf(b) ? [a, b] : [b, a];
      const x1b = leftOf(l) + widthOf(g.docs.get(l)!);
      const x2b = leftOf(r);
      couples.push({
        a,
        b,
        named: isSpouse,
        x1: x1b,
        y1: l === a ? ya : yb,
        x2: x2b,
        y2: l === a ? yb : ya,
        points: [
          [x1b, ya],
          [x2b, yb],
        ],
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
        // From the bar's run above the lower row: straight down where it passes, else along from its nearer end.
        const { entry, lx } = ends.get(keyOf(ps))!;
        const y = laneOf(rowOf.get(bar(ps).low)!, ps);
        const [l, r] = [Math.min(entry, lx), Math.max(entry, lx)];
        head =
          px >= l && px <= r
            ? [[px, y]]
            : [
                [px < l ? l : r, y],
                [px, y],
              ];
      } else head = [[px, rowY(rowOf.get(ps[0])!) + BOX_HEIGHT / 2]];
      lines.push({
        child: c,
        parents: ps,
        points: [...head, [px, mid], [cx, mid], [cx, childTop]],
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

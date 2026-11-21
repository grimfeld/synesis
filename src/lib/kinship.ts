// Kinship derived the other way (CONTEXT.md, Kinship; ADR 0024).
//
// The engine answers each tie as written: a Character names their `father`,
// their `mother` and their `spouses`, and nothing else. A parent's children,
// a Character's siblings, and a spouse named only by the other side are never
// stored; they are read here, from the same edges, for the Hub's Family
// section and, later, the Family tree. Pure: no engine, no React.
import type { DocSummary, Kinship, KinshipWarning } from "./api";

/** Every Character's ties, indexed both ways. */
export interface KinGraph {
  /** id → the Character. */
  docs: Map<string, DocSummary>;
  father: Map<string, string>;
  mother: Map<string, string>;
  /** id → the ids of their children, whichever parent names them. */
  children: Map<string, string[]>;
  /** id → spouses on both sides: those they name first, in the order written, then those naming them. */
  spouses: Map<string, string[]>;
  warnings: KinshipWarning[];
}

/** One parent's children who share the same other parent (`null`: not named). */
export interface ChildGroup {
  other: DocSummary | null;
  /** What the other parent is to these children: the mother on a father's Hub. */
  otherRole: "father" | "mother";
  children: DocSummary[];
}

/** Siblings sharing exactly these parents with the Character: both, or one. */
export interface SiblingGroup {
  parents: DocSummary[];
  siblings: DocSummary[];
}

/** What a Character's Hub shows in its Family section. */
export interface Family {
  father: DocSummary | null;
  mother: DocSummary | null;
  spouses: DocSummary[];
  children: ChildGroup[];
  siblings: SiblingGroup[];
  /** Warnings about this Character's own Kinship Properties. */
  warnings: KinshipWarning[];
}

function push(m: Map<string, string[]>, key: string, value: string) {
  const list = m.get(key);
  if (!list) m.set(key, [value]);
  else if (!list.includes(value)) list.push(value);
}

/** Index the engine's edges both ways. */
export function kinGraph(k: Kinship): KinGraph {
  const g: KinGraph = {
    docs: new Map(),
    father: new Map(),
    mother: new Map(),
    children: new Map(),
    spouses: new Map(),
    warnings: k.warnings,
  };
  const named: [string, string][] = [];
  for (const e of k.edges) {
    g.docs.set(e.character.id, e.character);
    g.docs.set(e.kin.id, e.kin);
    if (e.relation === "spouse") {
      push(g.spouses, e.character.id, e.kin.id);
      named.push([e.kin.id, e.character.id]);
    } else {
      // The engine leaves out a second father or mother; the first stands.
      const parents = e.relation === "father" ? g.father : g.mother;
      if (!parents.has(e.character.id)) parents.set(e.character.id, e.kin.id);
      push(g.children, e.kin.id, e.character.id);
    }
  }
  // Named by the other side only: added after the ones each names.
  for (const [who, by] of named) push(g.spouses, who, by);
  return g;
}

function byTitle(a: DocSummary, b: DocSummary): number {
  return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

/** The Family section of `id`'s Hub. */
export function familyOf(g: KinGraph, id: string): Family {
  const doc = (x: string | undefined) => (x ? (g.docs.get(x) ?? null) : null);
  const fatherId = g.father.get(id);
  const motherId = g.mother.get(id);
  const spouseIds = g.spouses.get(id) ?? [];

  // Children, grouped by the other parent each names: under the spouses in
  // their order, then any other parent by title, then those naming no one.
  const groups = new Map<string, ChildGroup>();
  for (const c of g.children.get(id) ?? []) {
    const otherRole = g.father.get(c) === id ? "mother" : "father";
    const other = (otherRole === "mother" ? g.mother : g.father).get(c) ?? null;
    const key = other ?? `\0${otherRole}`;
    const group = groups.get(key) ?? { other: doc(other ?? undefined), otherRole, children: [] };
    group.children.push(g.docs.get(c)!);
    groups.set(key, group);
  }
  const otherRank = (other: string | null) => {
    if (other === null) return Number.MAX_SAFE_INTEGER;
    const i = spouseIds.indexOf(other);
    return i < 0 ? spouseIds.length : i;
  };
  const children: ChildGroup[] = [...groups.values()]
    .map((c) => ({ ...c, children: c.children.sort(byTitle) }))
    .sort((a, b) => {
      const ra = otherRank(a.other?.id ?? null);
      const rb = otherRank(b.other?.id ?? null);
      if (ra !== rb) return ra - rb;
      return a.other && b.other ? byTitle(a.other, b.other) : 0;
    });

  // Siblings: anyone else sharing a father or a mother, grouped by which.
  const sibs = new Map<string, { parents: string[]; siblings: DocSummary[] }>();
  const candidates = new Set([
    ...(fatherId ? (g.children.get(fatherId) ?? []) : []),
    ...(motherId ? (g.children.get(motherId) ?? []) : []),
  ]);
  candidates.delete(id);
  for (const s of candidates) {
    const shared = [
      fatherId && g.father.get(s) === fatherId ? fatherId : null,
      motherId && g.mother.get(s) === motherId ? motherId : null,
    ].filter((x): x is string => x !== null);
    if (shared.length === 0) continue;
    const key = shared.join("|");
    const group = sibs.get(key) ?? { parents: shared, siblings: [] };
    group.siblings.push(g.docs.get(s)!);
    sibs.set(key, group);
  }
  // Both parents first, then the father's side, then the mother's.
  const rank = (parents: string[]) =>
    parents.length === 2 ? 0 : parents[0] === fatherId ? 1 : 2;
  const siblings: SiblingGroup[] = [...sibs.values()]
    .sort((a, b) => rank(a.parents) - rank(b.parents))
    .map((s) => ({
      parents: s.parents.map((p) => g.docs.get(p)!),
      siblings: s.siblings.sort(byTitle),
    }));

  return {
    father: doc(fatherId),
    mother: doc(motherId),
    spouses: spouseIds.map((s) => g.docs.get(s)!),
    children,
    siblings,
    warnings: g.warnings.filter((w) => w.character.id === id),
  };
}

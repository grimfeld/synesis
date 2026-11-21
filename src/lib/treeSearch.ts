// What the Family tree's search box (src/views/FamilyTreeView.tsx) offers for
// what was typed, and what Enter picks. Pure, so tested without a Vault. The
// arrow keys move as DocPicker's do (`moveActive`, src/lib/docPicker.ts).
import { fold } from "./names";

/** The most matches the list shows. */
export const TREE_SEARCH_LIMIT = 8;

/**
 * The items whose title holds `query`, accent- and case-insensitive: those
 * starting with it first, then by title; at most `limit`. Nothing for an empty query.
 */
export function searchTree<T>(items: T[], query: string, title: (x: T) => string, limit = TREE_SEARCH_LIMIT): T[] {
  const q = fold(query.trim());
  if (!q) return [];
  return items
    .map((x) => ({ x, t: title(x), f: fold(title(x)) }))
    .filter((m) => m.f.includes(q))
    .sort((a, b) => (a.f.startsWith(q) ? 0 : 1) - (b.f.startsWith(q) ? 0 : 1) || a.t.localeCompare(b.t))
    .slice(0, limit)
    .map((m) => m.x);
}

/** The match Enter picks, of `count`: the active one, else the first; none in an empty list. */
export function enterPick(count: number, active: number | null): number | null {
  if (count === 0) return null;
  return active !== null && active < count ? active : 0;
}

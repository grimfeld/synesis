// What `DocPicker` (src/components/Dialogs.tsx) offers for what was typed, and
// what its keys choose. Pure, so the choices are tested without a Vault.
import type { DocSummary, NameEntry } from "./api";
import { fold, matchByName, type NameMatch } from "./names";

export interface PickerSearch {
  /** The candidates shown, those the picker's filter allows. */
  matches: NameMatch[];
  /** An allowed candidate whose title (or Alias) is exactly what was typed. */
  exact: NameMatch | null;
  /**
   * A document of the picker's types named exactly so, but left out by its
   * filter (Esau, already Isaac's child, in Add child): "Create" would make a
   * second Esau, so it is not offered.
   */
  excluded: NameMatch | null;
}

/**
 * Search `docs` (every document of the picker's types) for `q`: by title,
 * case-insensitive, or with `entries` by title and Alias, accent-insensitive
 * (`matchByName`). Exactness is judged over every document, before `allowed`.
 */
export function searchPicker(
  docs: DocSummary[],
  q: string,
  o: { allowed?: (d: DocSummary) => boolean; entries?: NameEntry[] | null; limit?: number } = {},
): PickerSearch {
  const allowed = o.allowed ?? (() => true);
  const limit = o.limit ?? 8;
  const query = q.trim();
  let all: NameMatch[];
  let isExact: (m: NameMatch) => boolean;
  if (o.entries) {
    all = matchByName(docs, o.entries, query, Infinity).matches;
    const f = fold(query);
    isExact = (m) => f !== "" && fold(m.alias ?? m.doc.title) === f;
  } else {
    const f = query.toLowerCase();
    all = docs.filter((d) => !f || d.title.toLowerCase().includes(f)).map((doc) => ({ doc, alias: null }));
    isExact = (m) => f !== "" && m.doc.title.toLowerCase() === f;
  }
  const shown = all.filter((m) => allowed(m.doc));
  const exact = shown.find(isExact) ?? null;
  const excluded = exact ? null : (all.find((m) => isExact(m) && !allowed(m.doc)) ?? null);
  return { matches: shown.slice(0, limit), exact, excluded };
}

/** The "Create" row is offered only for a name no document of the picker's types has. */
export function canCreate(s: PickerSearch, q: string, creates: boolean): boolean {
  return creates && q.trim() !== "" && !s.exact && !s.excluded;
}

/**
 * The active option after an arrow key, over `count` options (the matches,
 * then the Create row): wraps at both ends. `null` is "not moved yet":
 * ArrowDown starts at the first, ArrowUp at the last.
 */
export function moveActive(active: number | null, count: number, dir: 1 | -1): number | null {
  if (count === 0) return null;
  if (active === null || active >= count) return dir === 1 ? 0 : count - 1;
  return (active + dir + count) % count;
}

export type PickerChoice = { kind: "doc"; doc: DocSummary } | { kind: "create" } | null;

/**
 * What Enter chooses. The active option, when the arrows moved to one.
 * Otherwise only what is unambiguous: the one match, an exact title, or
 * "Create" when nothing matches. Several matches and no exact title choose
 * nothing; never a new document the user did not point at.
 */
export function enterChoice(
  matches: DocSummary[],
  exact: DocSummary | null,
  create: boolean,
  active: number | null,
): PickerChoice {
  if (active !== null) {
    if (active < matches.length) return { kind: "doc", doc: matches[active] };
    if (active === matches.length && create) return { kind: "create" };
  }
  if (matches.length === 1) return { kind: "doc", doc: matches[0] };
  if (exact) return { kind: "doc", doc: exact };
  if (matches.length === 0 && create) return { kind: "create" };
  return null;
}

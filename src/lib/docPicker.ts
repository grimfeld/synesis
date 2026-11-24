// What `DocPicker` (src/components/Dialogs.tsx) offers for what was typed, and
// what its keys choose. Pure, so the choices are tested without a Vault.
import { linkTarget, type DocSummary, type NameEntry } from "./api";
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

// ---- Add Source (spec #205): the picker offers only Sources, without the
// ones the Composition's `sources` Property already names.

/** The entries of a `sources` Property as written (`[[Title]]`, a bare name), as names. */
export function sourceNames(raw: string[]): string[] {
  return raw.map((v) => linkTarget(v)).filter((n): n is string => !!n);
}

/**
 * The Source a `sources` entry names, as the engine resolves it closely
 * enough for the picker: its last path segment against a Source's title, or
 * against an Alias in `entries`, accent- and case-insensitive. `null` when
 * nothing of type `source` answers to it.
 */
export function resolveSourceName(
  name: string,
  docs: DocSummary[],
  entries: NameEntry[] = [],
): DocSummary | null {
  const n = fold(name.trim().split("/").pop()!.replace(/\.md$/i, "").trim());
  if (!n) return null;
  const byTitle = docs.find((d) => d.type === "source" && fold(d.title) === n);
  if (byTitle) return byTitle;
  const e = entries.find((x) => x.type === "source" && fold(x.name) === n);
  return (e && docs.find((d) => d.id === e.id)) ?? null;
}

/** What the Add Source picker may offer: a Source, not one already attached. */
export function addSourceFilter(
  attached: string[],
  docs: DocSummary[],
  entries: NameEntry[] = [],
): (d: DocSummary) => boolean {
  const ids = new Set(
    attached.map((n) => resolveSourceName(n, docs, entries)?.id).filter((x): x is string => !!x),
  );
  return (d) => d.type === "source" && !ids.has(d.id);
}

/**
 * A `sources` Property's entries as written, read from the front matter text
 * (`readField`), or from the parsed front matter for a form that does not
 * read back (`parsed`, the document's `frontmatter.sources`).
 */
export function sourcesEntries(raw: string | string[] | null | undefined, parsed?: unknown): string[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") return raw ? [raw] : [];
  if (raw === null) return [];
  if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === "string");
  return typeof parsed === "string" && parsed ? [parsed] : [];
}

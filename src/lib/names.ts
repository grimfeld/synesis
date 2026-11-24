// Client-side mirror of titles and aliases for instant link resolution and
// autocomplete. Normalisation matches engine::index::norm.
import type { DocSummary, DocType, NameEntry } from "./api";

export function norm(s: string): string {
  return s
    .trim()
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/**
 * Accent- and case-insensitive, for matching what the user typed against a
 * title. Looser than `norm`, which mirrors the engine's key: this one strips
 * diacritics so "jerusalem" finds "Jérusalem".
 */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

export class NameIndex {
  private byNorm = new Map<string, NameEntry>();
  entries: NameEntry[] = [];

  constructor(entries: NameEntry[] = []) {
    this.replace(entries);
  }

  replace(entries: NameEntry[]) {
    this.entries = entries;
    this.byNorm = new Map();
    // Titles win over aliases; earlier entries win over later.
    for (const e of entries) {
      const k = norm(e.name);
      const cur = this.byNorm.get(k);
      if (!cur || (cur.alias && !e.alias)) this.byNorm.set(k, e);
    }
  }

  resolve(target: string): NameEntry | undefined {
    const last = target.split("/").pop() ?? target;
    return this.byNorm.get(norm(last));
  }

  /**
   * Whether two documents carry `title`, so a `[[title]]` written for one
   * could resolve to the other: such a link is written as a path instead.
   */
  ambiguous(title: string): boolean {
    const k = norm(title);
    let n = 0;
    for (const e of this.entries) if (!e.alias && norm(e.name) === k && ++n > 1) return true;
    return false;
  }

  has(target: string): boolean {
    return this.resolve(target) !== undefined;
  }

  suggest(prefix: string, limit = 12, types?: DocType[]): NameEntry[] {
    const p = norm(prefix);
    const out: { e: NameEntry; score: number }[] = [];
    for (const e of this.entries) {
      if (types && !types.includes(e.type)) continue;
      const n = norm(e.name);
      let score = -1;
      if (p === "") score = 1;
      else if (n.startsWith(p)) score = 3;
      else if (n.includes(" " + p)) score = 2;
      else if (n.includes(p)) score = 1;
      if (score >= 0) out.push({ e, score: score * 1000 - n.length });
    }
    out.sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name));
    return out.slice(0, limit).map((x) => x.e);
  }
}

/** One candidate of a picker searching by title and Alias. */
export interface NameMatch {
  doc: DocSummary;
  /** The Alias it was found by, when its title does not hold what was typed. */
  alias: string | null;
}

/**
 * The `docs` whose title or one of whose Aliases (from `entries`) holds `q`,
 * accent- and case-insensitive: those found by title first, in `docs` order,
 * then those found by an Alias only. Each once. `exact` is set when a title or
 * an Alias is exactly what was typed, so a picker offers no "Create" for it.
 */
export function matchByName(
  docs: DocSummary[],
  entries: NameEntry[],
  q: string,
  limit = 8,
): { matches: NameMatch[]; exact: NameMatch | null } {
  const f = fold(q.trim());
  const byId = new Map(docs.map((d) => [d.id, d]));
  const out: NameMatch[] = [];
  const seen = new Set<string>();
  let exact: NameMatch | null = null;
  for (const d of docs) {
    const t = fold(d.title);
    if (f && !t.includes(f)) continue;
    const m = { doc: d, alias: null };
    if (f && t === f && !exact) exact = m;
    out.push(m);
    seen.add(d.id);
  }
  if (f)
    for (const e of entries) {
      if (!e.alias || seen.has(e.id)) continue;
      const d = byId.get(e.id);
      const a = fold(e.name);
      if (!d || !a.includes(f)) continue;
      const m = { doc: d, alias: e.name };
      if (a === f && !exact) exact = m;
      out.push(m);
      seen.add(e.id);
    }
  return { matches: out.slice(0, limit), exact };
}

// Client-side mirror of titles and aliases for instant link resolution and
// autocomplete. Normalisation matches engine::index::norm.
import type { DocType, NameEntry } from "./api";

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

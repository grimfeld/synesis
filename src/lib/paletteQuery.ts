// What the Command Palette was asked (PLAN §10, §12.4).
//
// The query text is the whole state, the way a leading ">" already is: a
// `type:` token narrows the document search to one kind of page, and the chips
// under the box only add or remove that token. So what the user sees typed is
// always what is being searched, and a filter can be typed as fast as clicked.
import type { DocType } from "./api";

/** One chip: a key the user can type after `type:`, and what it searches. */
export interface TypeFilter {
  key: string;
  types: DocType[];
}

/**
 * The kinds of page the palette can narrow to. Scripture is one filter for
 * Book, Chapter and Verse pages: nobody searches for "a Chapter" as such.
 */
export const TYPE_FILTERS: TypeFilter[] = [
  { key: "note", types: ["note"] },
  { key: "clipping", types: ["clipping"] },
  { key: "composition", types: ["composition"] },
  { key: "source", types: ["source"] },
  { key: "scripture", types: ["book", "chapter", "verse"] },
  { key: "place", types: ["place"] },
  { key: "character", types: ["character"] },
  { key: "concept", types: ["concept"] },
  { key: "event", types: ["event"] },
  { key: "journey", types: ["journey"] },
];

export interface PaletteQuery {
  /** A leading ">": the query names a Command, not a document. */
  commands: boolean;
  /** The words to search for, without any `type:` token. */
  text: string;
  /** The filter keys the query names, in the order typed. */
  filters: string[];
  /** Every DocType those filters admit; empty means any. */
  types: DocType[];
}

const TOKEN = /^type:(\S*)$/i;

/** Lower-case, without accents: "Événements" and "evenements" are one name. */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/**
 * Read a palette query.
 *
 * `names` maps further spellings to a filter key — the app language's names
 * for each kind, singular and plural — so `type:extrait` works in French as
 * `type:clipping` does everywhere. A `type:` token naming nothing known stays
 * in the text rather than silently filtering to nothing.
 */
export function parsePaletteQuery(
  q: string,
  names: Record<string, string> = {},
): PaletteQuery {
  if (q.startsWith(">"))
    return { commands: true, text: q.slice(1).trim(), filters: [], types: [] };
  const lookup = new Map<string, string>();
  for (const f of TYPE_FILTERS) lookup.set(f.key, f.key);
  for (const [name, key] of Object.entries(names)) lookup.set(fold(name), key);
  const words: string[] = [];
  const filters: string[] = [];
  for (const w of q.split(/\s+/).filter(Boolean)) {
    const m = TOKEN.exec(w);
    const key = m ? lookup.get(fold(m[1])) : undefined;
    if (key) {
      if (!filters.includes(key)) filters.push(key);
    } else if (!(m && m[1] === "")) {
      // A bare "type:" is a filter being typed: neither text nor a filter yet.
      words.push(w);
    }
  }
  const types = TYPE_FILTERS.filter((f) => filters.includes(f.key)).flatMap(
    (f) => f.types,
  );
  return { commands: false, text: words.join(" "), filters, types };
}

/**
 * The query with the `type:key` chip toggled: removed when the query names
 * that filter (under any spelling), otherwise added in front of the words.
 */
export function toggleTypeFilter(
  q: string,
  key: string,
  names: Record<string, string> = {},
): string {
  const parsed = parsePaletteQuery(q, names);
  const keyOf = (w: string) => {
    const m = TOKEN.exec(w);
    if (!m) return undefined;
    return parsePaletteQuery(w, names).filters[0];
  };
  const words = q.split(/\s+/).filter(Boolean);
  if (parsed.filters.includes(key)) {
    const rest = words.filter((w) => keyOf(w) !== key);
    return rest.length ? rest.join(" ") + " " : "";
  }
  const tokens = words.filter((w) => TOKEN.test(w) && keyOf(w));
  const others = words.filter((w) => !(TOKEN.test(w) && keyOf(w)));
  return [...tokens, `type:${key}`, ...others].join(" ") + " ";
}

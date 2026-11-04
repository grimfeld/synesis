/**
 * A search snippet from the engine (`Index::search`), cut into plain text and
 * matched terms. The engine marks each match between U+0002 and U+0003, so
 * brackets, `&` and `<` in the Note stay what they are: text.
 */
export interface SnippetPart {
  text: string;
  match: boolean;
}

const MARKED = /\u0002([^\u0003]*)\u0003/g;

export function snippetParts(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let last = 0;
  for (const m of snippet.matchAll(MARKED)) {
    if (m.index > last) parts.push({ text: snippet.slice(last, m.index), match: false });
    if (m[1]) parts.push({ text: m[1], match: true });
    last = m.index + m[0].length;
  }
  if (last < snippet.length) parts.push({ text: snippet.slice(last), match: false });
  // A stray marker with no partner is not text the user wrote.
  return parts.map((p) => ({ ...p, text: p.text.replace(/[\u0002\u0003]/g, "") }));
}

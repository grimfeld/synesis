/**
 * Where `matched` sits in `body` now, closest to where it used to sit.
 *
 * A Linkable's offset is measured against the body as it stood when the list
 * was fetched, and the fetch is debounced, so anything that shifts the text in
 * between — a writer who keeps typing, a reload, an edit from elsewhere —
 * leaves the offset pointing at the wrong words. Trusting it and refusing on a
 * mismatch is what made the link button do nothing at all, silently; finding
 * the words again keeps it working, and the caller reports only the case where
 * they are genuinely gone.
 *
 * Occurrences already inside a wikilink are skipped, so clicking twice does
 * not nest one link inside another.
 */
/**
 * Where a Linkable's words are in `body` right now, or null if they are gone.
 *
 * The single place either action asks the question, so selecting and linking
 * can never land on different text.
 */
export function resolve(
  body: string,
  l: { start: number; end: number; matched: string },
): number | null {
  return body.slice(l.start, l.end) === l.matched
    ? l.start
    : findOccurrence(body, l.matched, l.start);
}

export function findOccurrence(
  body: string,
  matched: string,
  near: number,
): number | null {
  if (!matched) return null;
  const hits: number[] = [];
  for (let i = body.indexOf(matched); i !== -1; i = body.indexOf(matched, i + 1)) {
    if (!insideLink(body, i)) hits.push(i);
  }
  if (hits.length === 0) return null;
  return hits.reduce((best, i) =>
    Math.abs(i - near) < Math.abs(best - near) ? i : best,
  );
}

/** Whether `at` falls inside a `[[…]]` that is already a Mention. */
function insideLink(body: string, at: number): boolean {
  const open = body.lastIndexOf("[[", at);
  if (open === -1) return false;
  const close = body.indexOf("]]", open);
  return close !== -1 && close > at;
}

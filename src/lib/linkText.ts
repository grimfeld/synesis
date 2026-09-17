import type { DocSummary } from "./api";
import { resolve } from "./findOccurrence";

/**
 * The wikilink that replaces matched text when linking to `target`.
 *
 * The mirror of `engine::unlinked::link_text`, kept in TypeScript because the
 * Linkable side inserts into the open editor rather than through a command:
 * the two paths apply the edit differently, but the text they insert must be
 * identical (ADR 0011).
 *
 * A bare `[[Title]]` only when the prose already reads exactly as the title;
 * otherwise the matched text is kept as the alias so the rendered document
 * does not change by a single character. An ambiguous title is written as a
 * path, because `resolve()` would otherwise send the link to whichever of the
 * same-named documents has the shortest path.
 */
export function linkText(
  target: DocSummary,
  matched: string,
  ambiguous: boolean,
): string {
  if (ambiguous) {
    return `[[${target.path.replace(/\.md$/, "")}|${matched}]]`;
  }
  return matched === target.title
    ? `[[${target.title}]]`
    : `[[${target.title}|${matched}]]`;
}

/**
 * The body with a Linkable turned into a Mention, or null if its words are
 * gone from the text.
 *
 * The splice itself, which used to live inline in the panel beside the
 * identical call that only reveals the words. Keeping the two apart is how
 * they came to disagree by a few characters; keeping the whole edit here is
 * what lets it be tested without an editor.
 */
export function linkInBody(
  body: string,
  l: { start: number; end: number; matched: string; ambiguous: DocSummary[] },
  target: DocSummary,
): { body: string; at: number } | null {
  const at = resolve(body, l);
  if (at == null) return null;
  const link = linkText(target, l.matched, l.ambiguous.length > 1);
  return {
    body: body.slice(0, at) + link + body.slice(at + l.matched.length),
    at,
  };
}

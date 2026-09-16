import type { DocSummary } from "./api";

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

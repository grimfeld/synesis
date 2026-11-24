// Where material dropped into a Composition's text lands (spec #202).
//
// A link goes exactly where it was dropped, inside the sentence. An Embed is
// a block: it goes on a line of its own, and blank lines are added only where
// Markdown would otherwise run it into the paragraph beside it. Kept pure so
// the editor applies the answer as one transaction, and one Undo removes it.

/** What to insert, where, and what to select afterwards (offsets after the insert). */
export interface Placement {
  at: number;
  insert: string;
  selection: { anchor: number; head: number };
}

const HEADING = /^ {0,3}#{1,6}(\s|$)/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
/** Lines that start a block of their own even right after a paragraph. */
const INTERRUPTS = /^ {0,3}(#{1,6}(\s|$)|```|~~~|>|[-*+]\s|1[.)]\s)/;

const blank = (line: string) => line.trim() === "";

/** Where the line holding `pos` starts. (`lastIndexOf` reads a negative start as 0.) */
const lineStart = (text: string, pos: number) =>
  pos <= 0 ? 0 : text.lastIndexOf("\n", pos - 1) + 1;

/** Where the line starting at `from` ends. */
const lineEnd = (text: string, from: number) => {
  const end = text.indexOf("\n", from);
  return end === -1 ? text.length : end;
};

/** Whether a paragraph line right after `line` would start a new block. */
const endsBlock = (line: string) =>
  blank(line) || HEADING.test(line) || THEMATIC_BREAK.test(line);

/** Whether `line`, right after a paragraph line, would start a new block. */
const startsBlock = (line: string) =>
  blank(line) || INTERRUPTS.test(line) || THEMATIC_BREAK.test(line);

/**
 * Place `link` dropped at `pos` in `text`. An Embed (`embed`) dropped on an
 * empty line goes on that line; dropped on a line with text, on a new line
 * after it. The selection covers the link or Embed itself, never the line
 * breaks added around it.
 */
export function placeMaterial(
  text: string,
  pos: number,
  embed: boolean,
  link: string,
): Placement {
  pos = Math.max(0, Math.min(pos, text.length));
  if (!embed) {
    return { at: pos, insert: link, selection: { anchor: pos, head: pos + link.length } };
  }
  const from = lineStart(text, pos);
  const to = lineEnd(text, from);
  const line = text.slice(from, to);
  const prev = from > 0 ? text.slice(lineStart(text, from - 1), from - 1) : null;
  const next = to < text.length ? text.slice(to + 1, lineEnd(text, to + 1)) : null;
  const after = next != null && !startsBlock(next) ? "\n" : "";

  let at: number;
  let before: string;
  if (blank(line)) {
    at = from;
    before = prev != null && !endsBlock(prev) ? "\n" : "";
  } else {
    at = to;
    before = "\n" + (endsBlock(line) ? "" : "\n");
  }
  const anchor = at + before.length;
  return {
    at,
    insert: before + link + after,
    selection: { anchor, head: anchor + link.length },
  };
}

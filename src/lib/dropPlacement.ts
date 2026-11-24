// Where material dropped into a Composition's text lands (spec #202).
//
// A link goes exactly where it was dropped, inside the sentence. An Embed is
// a block: it goes on a line of its own, and blank lines are added only where
// Markdown would otherwise run it into the block beside it. It never changes
// the blocks already written: dropped inside a heading, a list, a quote or a
// fence, it goes after that whole block, and only a paragraph is ever split.
// The blocks are read with the editor's own Markdown parser. Kept pure so the
// editor applies the answer as one transaction, and one Undo removes it.
import { markdownLanguage } from "@codemirror/lang-markdown";

/** What to insert, where, and what to select afterwards (offsets after the insert). */
export interface Placement {
  at: number;
  insert: string;
  selection: { anchor: number; head: number };
}

/**
 * Lines that start a block of their own right after a paragraph line, keeping
 * their meaning: a heading, a fence, a quote, a list item with text (a list
 * other than `1.` cannot interrupt a paragraph), a thematic break.
 */
const INTERRUPTS =
  /^ {0,3}(#{1,6}([ \t]|$)|```|~~~|>|[-*+][ \t]+\S|1[.)][ \t]+\S|([-*_])([ \t]*\3){2,}[ \t]*$)/;
/** A line that, right after a paragraph line, underlines it as a heading. */
const SETEXT_UNDERLINE = /^ {0,3}(-+|=+)[ \t]*$/;
/** Blocks after whose last line a paragraph can start without a blank line. */
const CLOSED = /^(ATXHeading\d|SetextHeading\d|HorizontalRule|FencedCode)$/;

const blank = (line: string) => line.trim() === "";

/** Where the line holding `pos` starts. (`lastIndexOf` reads a negative start as 0.) */
const lineStart = (text: string, pos: number) =>
  pos <= 0 ? 0 : text.lastIndexOf("\n", pos - 1) + 1;

/** Where the line starting at `from` ends. */
const lineEnd = (text: string, from: number) => {
  const end = text.indexOf("\n", from);
  return end === -1 ? text.length : end;
};

/** A top-level block: its node name, its range, and for a fence whether it was never closed. */
interface Block {
  name: string;
  from: number;
  to: number;
  /** A fence never closed, which runs to the end of the text. */
  open: boolean;
}

/** The top-level blocks of `text`, in order, each `to` the end of its last line. */
function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (let n = markdownLanguage.parser.parse(text).topNode.firstChild; n; n = n.nextSibling) {
    const end = n.to > n.from && text[n.to - 1] === "\n" ? n.to - 1 : n.to;
    out.push({
      name: n.name,
      from: n.from,
      to: lineEnd(text, lineStart(text, end)),
      open: n.name === "FencedCode" && n.getChildren("CodeMark").length < 2,
    });
  }
  return out;
}

/**
 * Place `link` dropped at `pos` in `text`. An Embed (`embed`) dropped on an
 * empty line goes on that line; dropped on a paragraph's line, on a new line
 * after it; dropped on any other block, on a new line after that block (and
 * before a fence left open, which nothing after it could leave). The selection
 * covers the link or Embed itself, never the line breaks added around it.
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
  const all = blocks(text);
  const from = lineStart(text, pos);
  const to = lineEnd(text, from);
  const last = all[all.length - 1];
  const block =
    all.find((b) => b.from <= to && b.to >= from) ??
    // A fence left open holds every line after it, empty ones at the end too.
    (last?.open && last.from <= from ? last : undefined);

  // The Embed's own line starts at `at` (`onLine`: an empty line of the text,
  // kept, its spaces after the Embed) or right after a line break added at `at`.
  let at: number;
  let onLine: boolean;
  if (!block) {
    at = from;
    onLine = true;
  } else if (block.open) {
    at = lineStart(text, block.from);
    onLine = true;
  } else {
    at = block.name === "Paragraph" ? to : block.to;
    onLine = false;
  }

  // The line before the Embed's: a blank line keeps it out of a paragraph,
  // list item or quote it would otherwise continue.
  const prevEnd = onLine ? at - 1 : at;
  const prevFrom = prevEnd >= 0 ? lineStart(text, prevEnd) : -1;
  const prevBlock =
    prevFrom < 0 || blank(text.slice(prevFrom, prevEnd))
      ? null
      : all.find((b) => b.from <= prevEnd && b.to >= prevFrom);
  const needsBlankBefore =
    !!prevBlock && (prevBlock.to !== prevEnd || !CLOSED.test(prevBlock.name));

  // The line after it: a blank line keeps it from running on into it, or
  // from being underlined into a heading by it. On an empty line, that is the
  // line after the empty one; before a fence left open, the fence itself.
  const nextFrom = !onLine
    ? at < text.length ? at + 1 : null
    : block
      ? at
      : to < text.length ? to + 1 : null;
  const next = nextFrom == null ? null : text.slice(nextFrom, lineEnd(text, nextFrom));
  const needsBlankAfter =
    next != null && !blank(next) && (!INTERRUPTS.test(next) || SETEXT_UNDERLINE.test(next));

  const before = (onLine ? "" : "\n") + (needsBlankBefore ? "\n" : "");
  // On an empty line, the line's own break follows the Embed; before a fence
  // left open, the Embed brings its own.
  const after = (onLine && block ? "\n" : "") + (needsBlankAfter ? "\n" : "");
  const anchor = at + before.length;
  return {
    at,
    insert: before + link + after,
    selection: { anchor, head: anchor + link.length },
  };
}

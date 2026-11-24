import { describe, expect, it } from "vitest";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { placeMaterial } from "../dropPlacement";
import { rng } from "./randomText";

/** The text after the placement, with the selection marked by « ». */
function apply(text: string, pos: number, embed: boolean, link: string): string {
  const p = placeMaterial(text, pos, embed, link);
  const out = text.slice(0, p.at) + p.insert + text.slice(p.at);
  const { anchor, head } = p.selection;
  return out.slice(0, anchor) + "«" + out.slice(anchor, head) + "»" + out.slice(head);
}

const E = "![[c|Src · p. 1]]";

describe("placeMaterial: a link", () => {
  it("goes inline at the drop point, selected", () => {
    expect(apply("Paul went to .", 13, false, "[[Antioch]]")).toBe(
      "Paul went to «[[Antioch]]».",
    );
  });

  it("goes at the start and the end of the document", () => {
    expect(apply("abc", 0, false, "[[X]]")).toBe("«[[X]]»abc");
    expect(apply("abc", 3, false, "[[X]]")).toBe("abc«[[X]]»");
    expect(apply("", 0, false, "[[X]]")).toBe("«[[X]]»");
  });
});

describe("placeMaterial: an Embed", () => {
  it("dropped mid-line goes on a line of its own after that line", () => {
    expect(apply("Endure with joy.", 5, true, E)).toBe(`Endure with joy.\n\n«${E}»`);
  });

  it("keeps a following paragraph apart from it", () => {
    expect(apply("One.\nTwo.", 2, true, E)).toBe(`One.\n\n«${E}»\n\nTwo.`);
  });

  it("adds no blank line where one is already there", () => {
    expect(apply("One.\n\nTwo.", 2, true, E)).toBe(`One.\n\n«${E}»\n\nTwo.`);
  });

  it("dropped on an empty line goes on that line", () => {
    expect(apply("One.\n\n\nTwo.", 6, true, E)).toBe(`One.\n\n«${E}»\n\nTwo.`);
    expect(apply("", 0, true, E)).toBe(`«${E}»`);
    expect(apply("\nTwo.", 0, true, E)).toBe(`«${E}»\n\nTwo.`);
  });

  it("needs no blank line beside a heading", () => {
    expect(apply("# Joy\nText.", 3, true, E)).toBe(`# Joy\n«${E}»\n\nText.`);
    expect(apply("Text.\n## Next", 2, true, E)).toBe(`Text.\n\n«${E}»\n## Next`);
  });

  it("dropped at the very start of a non-empty first line still goes after it", () => {
    expect(apply("One.", 0, true, E)).toBe(`One.\n\n«${E}»`);
  });

  it("treats a line of spaces as empty, leaving the spaces after it", () => {
    expect(apply("One.\n\n  \n\nTwo.", 7, true, E)).toBe(`One.\n\n«${E}»  \n\nTwo.`);
  });
});

describe("placeMaterial: before a block that interrupts a paragraph", () => {
  it("needs no blank line before a list, a quote, a fence or `***`", () => {
    expect(apply("One.\n\n- item", 5, true, E)).toBe(`One.\n\n«${E}»\n- item`);
    expect(apply("One.\n\n> quote", 5, true, E)).toBe(`One.\n\n«${E}»\n> quote`);
    expect(apply("One.\n\n```\ncode\n```", 5, true, E)).toBe(
      `One.\n\n«${E}»\n\`\`\`\ncode\n\`\`\``,
    );
    expect(apply("One.\n\n***", 5, true, E)).toBe(`One.\n\n«${E}»\n***`);
  });

  it("keeps a blank line before `---` and `===`, which would underline it", () => {
    expect(apply("Para.\n\n---", 6, true, E)).toBe(`Para.\n\n«${E}»\n\n---`);
    expect(apply("Para.\n\n===", 6, true, E)).toBe(`Para.\n\n«${E}»\n\n===`);
  });
});

describe("placeMaterial: on a block of several lines", () => {
  it("dropped on a setext heading's text goes after its underline", () => {
    expect(apply("Title\n---\nText", 2, true, E)).toBe(`Title\n---\n«${E}»\n\nText`);
    expect(apply("Title\n===\n", 2, true, E)).toBe(`Title\n===\n«${E}»\n`);
  });

  it("dropped inside a fence, a list or a quote goes after it", () => {
    expect(apply("```\ncode\n```\nText", 6, true, E)).toBe(
      `\`\`\`\ncode\n\`\`\`\n«${E}»\n\nText`,
    );
    expect(apply("- a\n- b\n\nText", 1, true, E)).toBe(`- a\n- b\n\n«${E}»\n\nText`);
    expect(apply("> a\n> b", 1, true, E)).toBe(`> a\n> b\n\n«${E}»`);
  });

  it("goes before a fence left open, which runs to the end", () => {
    expect(apply("Para.\n```\ncode", 12, true, E)).toBe(`Para.\n\n«${E}»\n\`\`\`\ncode`);
    expect(apply("---\n```\ncode\n", 13, true, E)).toBe(`---\n«${E}»\n\`\`\`\ncode\n`);
  });
});

// The property: an Embed never changes the blocks already written — the same
// headings, thematic breaks, lists, quotes and fences, in the same order with
// the same text — and it is a paragraph of its own holding only the Embed.
// Paragraph text is compared line by line, since an Embed dropped mid-
// paragraph splits it in two (spec #202: "on a new line after that line").
describe("placeMaterial: the blocks around an Embed stay as they were", () => {
  const parse = (text: string) => markdownLanguage.parser.parse(text);

  /** The top-level blocks, or null when the text has none. */
  function blocks(text: string) {
    const out: { name: string; from: number; to: number }[] = [];
    const c = parse(text).cursor();
    if (!c.firstChild()) return out;
    do out.push({ name: c.name, from: c.from, to: c.to });
    while (c.nextSibling());
    return out;
  }

  /** Every block as `name: text`; a paragraph as one entry per line. */
  function structure(text: string, skip?: { from: number; to: number }): string[] {
    const out: string[] = [];
    const c = parse(text).cursor();
    if (!c.firstChild()) return out;
    // Depth-first over block nodes; inline nodes carry no structure.
    const walk = () => {
      do {
        if (skip && c.from === skip.from && c.to === skip.to && c.name === "Paragraph") continue;
        const body = text.slice(c.from, c.to);
        if (c.name === "Paragraph") {
          for (const l of body.split("\n")) out.push(`P: ${l.trim()}`);
        } else if (BLOCKS.has(c.name)) {
          out.push(`${c.name}: ${body.replace(/[ \t]+$/gm, "")}`);
          if (c.firstChild()) {
            walk();
            c.parent();
          }
        }
      } while (c.nextSibling());
    };
    walk();
    return out;
  }

  const BLOCKS = new Set([
    "Blockquote", "BulletList", "OrderedList", "ListItem", "FencedCode", "CodeBlock",
    "HorizontalRule", "HTMLBlock", "LinkReference", "Table",
    "ATXHeading1", "ATXHeading2", "ATXHeading3", "ATXHeading4", "ATXHeading5", "ATXHeading6",
    "SetextHeading1", "SetextHeading2",
  ]);

  const LINES: ((r: () => number) => string[])[] = [
    (r) => [`Text ${Math.floor(r() * 9)}.`],
    () => [""],
    () => ["  "],
    () => ["# Heading"],
    () => ["---"],
    () => ["==="],
    () => ["***"],
    () => ["- item"],
    () => ["1. first"],
    () => ["> quote"],
    (r) => ["```", ...(r() < 0.5 ? ["code", "---"] : ["", "code"]), ...(r() < 0.9 ? ["```"] : [])],
  ];

  function randomDoc(r: () => number): string {
    const n = Math.floor(r() * 8);
    const lines: string[] = [];
    for (let i = 0; i < n; i++) lines.push(...LINES[Math.floor(r() * LINES.length)](r));
    return lines.join("\n");
  }

  it("over random documents and drop points", () => {
    const r = rng(202);
    for (let i = 0; i < 2000; i++) {
      const text = randomDoc(r);
      const pos = Math.floor(r() * (text.length + 1));
      const clipping = r() < 0.7;
      const link = clipping ? E : "[[Note]]";
      const p = placeMaterial(text, pos, clipping, link);
      const out = text.slice(0, p.at) + p.insert + text.slice(p.at);
      const where = JSON.stringify({ text, pos, out });
      expect(out.slice(p.selection.anchor, p.selection.head), where).toBe(link);
      if (!clipping) {
        // A link goes inline, exactly at the drop point.
        expect(out, where).toBe(text.slice(0, pos) + link + text.slice(pos));
        continue;
      }
      const mine = blocks(out).filter(
        (b) => b.name === "Paragraph" && out.slice(b.from, b.to).trim() === E,
      );
      expect(mine.length, where).toBe(1);
      expect(structure(out, mine[0]), where).toEqual(structure(text));
    }
  });
});

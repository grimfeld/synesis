import { describe, expect, it } from "vitest";
import { placeMaterial } from "../dropPlacement";

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

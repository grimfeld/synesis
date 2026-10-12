import { describe, expect, it } from "vitest";
import { PICTURE_SKIP_SOURCE, findPictures, isPictureFile, isPictureTarget } from "../pictures";

describe("Pictures in text (ADR 0019)", () => {
  it("reads the full path the app writes", () => {
    const text = "Before\n![[Attachments/paul in athens.png]]\nAfter";
    expect(findPictures(text)).toEqual([
      { from: 7, to: 7 + "![[Attachments/paul in athens.png]]".length, target: "Attachments/paul in athens.png", width: null },
    ]);
  });

  it("reads the short form and width Obsidian writes", () => {
    const [p] = findPictures("![[athens.JPG|300]]");
    expect(p.target).toBe("athens.JPG");
    expect(p.width).toBe(300);
  });

  it("reads markdown pictures, spaces escaped either way", () => {
    expect(findPictures("![map](Attachments/a%20b.webp)")[0].target).toBe("Attachments/a b.webp");
    expect(findPictures("![map](<Attachments/a b.png>)")[0].target).toBe("Attachments/a b.png");
  });

  it("leaves Embeds, remote pictures and code alone", () => {
    expect(findPictures("![[Clip one]]")).toEqual([]);
    expect(findPictures("![logo](https://example.com/x.svg)")).toEqual([]);
    expect(findPictures("`![[a.png]]`\n```\n![[b.png]]\n```")).toEqual([]);
  });

  it("tells a Picture from a document by extension", () => {
    expect(isPictureTarget("Attachments/athens.png")).toBe(true);
    expect(isPictureTarget("athens.jpeg|200")).toBe(true);
    expect(isPictureTarget("Paul")).toBe(false);
    expect(isPictureTarget("diagram.svg")).toBe(false);
  });

  it("accepts a pasted image with no usable name", () => {
    expect(isPictureFile({ name: "image.png", type: "image/png" })).toBe(true);
    expect(isPictureFile({ name: "", type: "image/jpeg" })).toBe(true);
    expect(isPictureFile({ name: "notes.pdf", type: "application/pdf" })).toBe(false);
    expect(isPictureFile({ name: "x.svg", type: "image/svg+xml" })).toBe(false);
  });
});

describe("Picture syntax the editor steps around", () => {
  // The engine's `attachments::PICTURE_SYNTAX`: the same text must be skipped
  // on both sides, or a Tag or link is shown that the index never recorded.
  const skipped = (text: string) => (text.match(new RegExp(PICTURE_SKIP_SOURCE, "gi")) ?? []).join("");
  it("skips what the engine skips", () => {
    expect(skipped("![[Attachments/athens 2d7116.png|300]]")).toBe("![[Attachments/athens 2d7116.png|300]]");
    expect(skipped("![[a #draft.png]]")).toBe("![[a #draft.png]]");
    expect(skipped("![see Ro 12:2](notes.md)")).toBe("![see Ro 12:2](notes.md)");
  });
  it("leaves an Embed of a document alone", () => {
    expect(skipped("![[Talk on endurance]]")).toBe("");
  });
});

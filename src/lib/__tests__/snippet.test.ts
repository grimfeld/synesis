import { describe, expect, it } from "vitest";
import { snippetParts } from "../snippet";

describe("snippetParts", () => {
  it("marks only what the engine marked", () => {
    expect(snippetParts("See [[\u0002Grace\u0003]] here")).toEqual([
      { text: "See [[", match: false },
      { text: "Grace", match: true },
      { text: "]] here", match: false },
    ]);
  });

  it("keeps brackets, entities and tags as text", () => {
    expect(snippetParts("[note] &amp; <b>x</b>")).toEqual([
      { text: "[note] &amp; <b>x</b>", match: false },
    ]);
  });

  it("handles several matches and a match at either end", () => {
    expect(snippetParts("\u0002a\u0003 b \u0002c\u0003")).toEqual([
      { text: "a", match: true },
      { text: " b ", match: false },
      { text: "c", match: true },
    ]);
  });

  it("drops a stray marker", () => {
    expect(snippetParts("x \u0002y")).toEqual([{ text: "x y", match: false }]);
  });
});

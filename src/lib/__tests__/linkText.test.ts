import { describe, expect, it } from "vitest";
import { linkText } from "../linkText";
import type { DocSummary } from "../api";

const doc = (title: string, path: string): DocSummary =>
  ({ id: "x", path, title, type: "place" }) as DocSummary;

describe("linkText", () => {
  it("writes a bare link when the prose already reads as the title", () => {
    expect(linkText(doc("Antioch", "Places/Antioch.md"), "Antioch", false)).toBe(
      "[[Antioch]]",
    );
  });

  it("keeps the prose as an alias whenever it differs", () => {
    const paul = doc("Paul", "Characters/Paul.md");
    expect(linkText(paul, "Paul's", false)).toBe("[[Paul|Paul's]]");
    // Case alone still counts: Obsidian would otherwise capitalise the word.
    expect(linkText(paul, "paul", false)).toBe("[[Paul|paul]]");
    expect(linkText(doc("Barnabas", "Characters/Barnabas.md"), "Joseph", false)).toBe(
      "[[Barnabas|Joseph]]",
    );
  });

  it("writes an ambiguous title as a path so it cannot resolve to the wrong page", () => {
    expect(
      linkText(doc("Antioch", "Places/Pisidia/Antioch.md"), "Antioch", true),
    ).toBe("[[Places/Pisidia/Antioch|Antioch]]");
  });
});

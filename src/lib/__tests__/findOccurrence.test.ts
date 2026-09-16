import { describe, expect, it } from "vitest";
import { findOccurrence } from "../findOccurrence";

describe("findOccurrence", () => {
  it("finds the text where it actually is now", () => {
    // The writer added words above, so everything shifted right.
    const body = "A new opening line.\n\nAntioch is where they met.";
    expect(findOccurrence(body, "Antioch", 0)).toBe(21);
  });

  it("prefers the occurrence nearest where it used to be", () => {
    const body = "Antioch first. Then later, Antioch again.";
    expect(findOccurrence(body, "Antioch", 0)).toBe(0);
    expect(findOccurrence(body, "Antioch", 40)).toBe(27);
  });

  it("skips text already inside a link, so clicking twice cannot nest", () => {
    const body = "[[Antioch]] grew, and Antioch sent them.";
    expect(findOccurrence(body, "Antioch", 2)).toBe(22);
  });

  it("recovers when the offset is stale by any amount", () => {
    // Whatever moved the text — the writer typing above it, or offsets that
    // were measured against a differently-encoded copy — the words are found
    // where they are now rather than trusted to be where they were.
    const body = "several words added here.\n\nThen Antioch appears.\n";
    const staleOffset = 12;
    expect(body.slice(staleOffset, staleOffset + 7)).not.toBe("Antioch");
    expect(findOccurrence(body, "Antioch", staleOffset)).toBe(
      body.indexOf("Antioch"),
    );
  });

  it("returns null when the words are genuinely gone", () => {
    expect(findOccurrence("nothing here now", "Antioch", 5)).toBeNull();
    expect(findOccurrence("[[Antioch]] only", "Antioch", 2)).toBeNull();
    expect(findOccurrence("anything", "", 0)).toBeNull();
  });
});

// The Tags each document carries, as the shared Period filter weighs them:
// the pairs a view already has, and the documents asked for by chosen Tag.
import { describe, expect, it } from "vitest";
import { tagsByDoc } from "../useTagsByDoc";

describe("tagsByDoc", () => {
  it("is empty with nothing known and no Tag chosen", () => {
    expect(tagsByDoc([], [])).toEqual(new Map());
  });

  it("lists every Tag a known document carries, in order", () => {
    const m = tagsByDoc(
      [
        { doc: "jeremiah", tag: "prophet" },
        { doc: "jeremiah", tag: "priest" },
        { doc: "david", tag: "king" },
      ],
      [],
    );
    expect(m.get("jeremiah")).toEqual(["prophet", "priest"]);
    expect(m.get("david")).toEqual(["king"]);
  });

  it("adds the documents carrying a chosen Tag, each pair once", () => {
    const m = tagsByDoc(
      [{ doc: "jeremiah", tag: "prophet" }],
      [
        { tag: "prophet", docs: [{ id: "jeremiah" }, { id: "isaiah" }] },
        { tag: "exile", docs: [{ id: "jeremiah" }] },
      ],
    );
    expect(m.get("jeremiah")).toEqual(["prophet", "exile"]);
    expect(m.get("isaiah")).toEqual(["prophet"]);
    expect([...m.keys()]).toEqual(["jeremiah", "isaiah"]);
  });
});

// Grouping the Backlinks list: one row per document, however many Mentions it
// makes. The engine keeps returning one row per occurrence, so every rule the
// panel reads is pinned here rather than through the UI.
import { describe, expect, it } from "vitest";
import { groupBacklinks, viaSummary } from "../backlinks";
import type { Backlink, BacklinkKind } from "../api";

const bl = (
  id: string,
  over: Partial<Backlink> & { kind?: BacklinkKind } = {},
): Backlink =>
  ({
    doc: { id, title: id, type: "note", first_verse: null },
    kind: "link",
    via: null,
    property: null,
    excerpt: "",
    start: 0,
    inferred: false,
    ...over,
  }) as Backlink;

describe("groupBacklinks", () => {
  it("collapses every Mention one document makes into a single group", () => {
    const g = groupBacklinks([
      bl("a", { start: 10 }),
      bl("a", { start: 40 }),
      bl("b", { start: 20 }),
    ]);
    expect(g).toHaveLength(2);
    expect(g[0].items).toHaveLength(2);
    expect(g[1].items).toHaveLength(1);
  });

  it("orders groups by each document's first occurrence", () => {
    // The engine sorted these already; grouping must not reshuffle them.
    const g = groupBacklinks([bl("b"), bl("a"), bl("b")]);
    expect(g.map((x) => x.first.doc.id)).toEqual(["b", "a"]);
  });

  it("takes the title, date and excerpt from the first occurrence", () => {
    const g = groupBacklinks([
      bl("a", { start: 5, excerpt: "first sighting" }),
      bl("a", { start: 90, excerpt: "later one" }),
    ]);
    expect(g[0].first.excerpt).toBe("first sighting");
  });

  it("merges the distinct kinds and drops the plain link, which has no marker", () => {
    const g = groupBacklinks([
      bl("a", { kind: "link" }),
      bl("a", { kind: "tag" }),
      bl("a", { kind: "embed" }),
      bl("a", { kind: "tag" }),
    ]);
    expect(g[0].kinds).toEqual(["tag", "embed"]);
  });

  it("leaves kinds empty when a document only ever links plainly", () => {
    const g = groupBacklinks([bl("a"), bl("a")]);
    expect(g[0].kinds).toEqual([]);
  });

  it("collects the distinct via labels, in the order first seen", () => {
    const g = groupBacklinks([
      bl("a", { kind: "mention", via: "Ac 19:9" }),
      bl("a", { kind: "mention", via: "Ac 18:18" }),
      bl("a", { kind: "mention", via: "Ac 19:9" }),
    ]);
    expect(g[0].via).toEqual(["Ac 19:9", "Ac 18:18"]);
  });

  it("marks the group inferred when any one occurrence was", () => {
    expect(
      groupBacklinks([bl("a"), bl("a", { inferred: true })])[0].inferred,
    ).toBe(true);
    expect(groupBacklinks([bl("a"), bl("a")])[0].inferred).toBe(false);
  });

  it("is empty for no backlinks at all", () => {
    expect(groupBacklinks([])).toEqual([]);
  });
});

describe("viaSummary", () => {
  it("shows every label while they fit", () => {
    expect(viaSummary(["Ac 19:9", "Ac 20:31"])).toEqual({
      shown: ["Ac 19:9", "Ac 20:31"],
      more: 0,
    });
  });

  it("caps the list and counts the rest, so the badge cannot grow unbounded", () => {
    const { shown, more } = viaSummary([
      "Ac 18:18",
      "Ac 19:9",
      "Ac 19:23",
      "Ac 20:17",
      "Ac 20:31",
    ]);
    expect(shown).toHaveLength(3);
    expect(more).toBe(2);
  });

  it("never reports a negative remainder", () => {
    expect(viaSummary([]).more).toBe(0);
  });
});

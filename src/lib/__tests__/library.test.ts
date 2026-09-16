// Shelving (ADR 0012): which kinds earn a Shelf, where the misfiled end up,
// and how a `cover` value is read.
import { describe, expect, it } from "vitest";
import type { LibraryEntry } from "../api";
import {
  CHILD_KINDS,
  COVER_BG,
  childKindFor,
  coverBg,
  coverKind,
  isChildKind,
  isShelfKind,
  SHELF_KINDS,
  shelfOf,
  shelve,
  UNSHELVED,
} from "../library";

function entry(over: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    id: "01ABC",
    title: "Untitled",
    kind: "book",
    cover: "",
    date: "",
    parent_id: null,
    child_count: 0,
    ...over,
  };
}

describe("kind classification", () => {
  it("separates kinds that stand alone from kinds that sit inside one", () => {
    expect(isShelfKind("book")).toBe(true);
    expect(isShelfKind("video")).toBe(true);
    expect(isChildKind("chapter")).toBe(true);
    expect(isChildKind("issue")).toBe(true);
    // The two sets never overlap: a kind is one or the other, never both.
    for (const k of CHILD_KINDS) expect(isShelfKind(k)).toBe(false);
    for (const k of SHELF_KINDS) expect(isChildKind(k)).toBe(false);
  });

  it("treats a kind it has never heard of as no Shelf at all", () => {
    // ADR 0003: the vault is hand-editable, so `kind: sermon` must not error.
    expect(isShelfKind("sermon")).toBe(false);
    expect(isChildKind("sermon")).toBe(false);
  });

  it("guesses the child kind a parent most likely holds", () => {
    expect(childKindFor("book")).toBe("chapter");
    expect(childKindFor("periodical")).toBe("issue");
    expect(childKindFor("issue")).toBe("article");
    expect(childKindFor("video")).toBe("article");
    expect(childKindFor("sermon")).toBe("article");
  });
});

describe("shelfOf", () => {
  it("shelves a top-level Source under its kind", () => {
    expect(shelfOf(entry({ kind: "book" }))).toBe("book");
    expect(shelfOf(entry({ kind: "video" }))).toBe("video");
  });

  it("gives a Source with a parent no Shelf: it sits inside one", () => {
    expect(shelfOf(entry({ kind: "chapter", parent_id: "01PARENT" }))).toBe(
      null,
    );
    // Even a shelf-worthy kind disappears from the shelves once it has a parent.
    expect(shelfOf(entry({ kind: "book", parent_id: "01PARENT" }))).toBe(null);
  });

  it("drops a parentless child kind onto Unshelved rather than its own row", () => {
    // The junk-drawer case: a chapter that lost its book is misfiled, not
    // top-level, so it waits on Unshelved instead of creating a Chapters shelf.
    expect(shelfOf(entry({ kind: "chapter" }))).toBe(UNSHELVED);
    expect(shelfOf(entry({ kind: "issue" }))).toBe(UNSHELVED);
  });

  it("drops an unknown or missing kind onto Unshelved", () => {
    expect(shelfOf(entry({ kind: "sermon" }))).toBe(UNSHELVED);
    expect(shelfOf(entry({ kind: "" }))).toBe(UNSHELVED);
  });

  it("reads a kind however it was capitalised or padded by hand", () => {
    expect(shelfOf(entry({ kind: "  Book " }))).toBe("book");
    expect(shelfOf(entry({ kind: "VIDEO" }))).toBe("video");
  });
});

describe("shelve", () => {
  it("groups top-level Sources and leaves children off the shelves", () => {
    const shelves = shelve([
      entry({ id: "b1", kind: "book", title: "Insight" }),
      entry({ id: "c1", kind: "chapter", title: "Ephesus", parent_id: "b1" }),
      entry({ id: "p1", kind: "periodical", title: "The Watchtower" }),
      entry({ id: "v1", kind: "video", title: "Morning Worship" }),
    ]);
    expect(shelves.map((s) => s.id)).toEqual(["book", "periodical", "video"]);
    expect(shelves[0].entries.map((e) => e.id)).toEqual(["b1"]);
  });

  it("drops empty Shelves so a vault with no podcasts shows no podcast row", () => {
    const shelves = shelve([entry({ kind: "book" })]);
    expect(shelves).toHaveLength(1);
    expect(shelves[0].id).toBe("book");
  });

  it("orders Shelves by SHELF_KINDS and always puts Unshelved last", () => {
    const shelves = shelve([
      entry({ id: "x", kind: "chapter" }),
      entry({ id: "y", kind: "article" }),
      entry({ id: "z", kind: "book" }),
    ]);
    expect(shelves.map((s) => s.id)).toEqual(["book", "article", UNSHELVED]);
  });

  it("keeps the engine's order within a Shelf rather than resorting", () => {
    // The engine sorts naturally (ch. 2 before ch. 10); shelving only groups.
    const shelves = shelve([
      entry({ id: "a", kind: "book", title: "Chapter 2" }),
      entry({ id: "b", kind: "book", title: "Chapter 10" }),
    ]);
    expect(shelves[0].entries.map((e) => e.title)).toEqual([
      "Chapter 2",
      "Chapter 10",
    ]);
  });

  it("returns nothing for a vault whose Sources are all children", () => {
    expect(shelve([entry({ kind: "chapter", parent_id: "p" })])).toEqual([]);
    expect(shelve([])).toEqual([]);
  });
});

describe("coverKind", () => {
  it("reads an http(s) value as a picture on the web", () => {
    expect(coverKind("https://example.org/a.jpg")).toEqual({
      kind: "remote",
      url: "https://example.org/a.jpg",
    });
    expect(coverKind("HTTP://example.org/a.jpg").kind).toBe("remote");
  });

  it("reads anything else as a path inside the vault", () => {
    expect(coverKind("Attachments/insight.jpg")).toEqual({
      kind: "attachment",
      path: "Attachments/insight.jpg",
    });
  });

  it("falls back to a drawn Cover when there is no value", () => {
    expect(coverKind("").kind).toBe("generated");
    expect(coverKind("   ").kind).toBe("generated");
    expect(coverKind(null).kind).toBe("generated");
    expect(coverKind(undefined).kind).toBe("generated");
  });
});

describe("coverBg", () => {
  it("gives the same Source the same spine every time", () => {
    expect(coverBg("01ABC")).toBe(coverBg("01ABC"));
  });

  it("always picks a real class from the ramp", () => {
    for (const id of ["a", "01M26CD294EVVTESBDQ0B899XM", "", "zzz"]) {
      expect(COVER_BG).toContain(coverBg(id));
    }
  });

  it("spreads ids across the ramp rather than piling them on one colour", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `01SOURCE${i}`);
    const used = new Set(ids.map(coverBg));
    expect(used.size).toBeGreaterThan(1);
  });
});

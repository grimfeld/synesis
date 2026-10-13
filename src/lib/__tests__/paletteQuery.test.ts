// The Command Palette's query: ">" for Commands, `type:` to narrow the
// document search (PLAN §10, §12.4).
import { describe, expect, it } from "vitest";
import { parsePaletteQuery, toggleTypeFilter } from "../paletteQuery";

const fr = { note: "note", notes: "note", extrait: "clipping", extraits: "clipping", "écriture": "scripture", événements: "event" };

describe("parsePaletteQuery", () => {
  it("reads plain words as a search over every type", () => {
    expect(parsePaletteQuery("  endurance  joy ")).toEqual({
      commands: false,
      text: "endurance joy",
      filters: [],
      types: [],
    });
  });

  it("reads a leading > as Command mode and ignores type: there", () => {
    const q = parsePaletteQuery(">type:note new");
    expect(q.commands).toBe(true);
    expect(q.text).toBe("type:note new");
    expect(q.types).toEqual([]);
  });

  it("takes type: tokens out of the text, wherever they are", () => {
    const q = parsePaletteQuery("endurance type:note joy TYPE:Composition");
    expect(q.text).toBe("endurance joy");
    expect(q.filters).toEqual(["note", "composition"]);
    expect(q.types).toEqual(["note", "composition"]);
  });

  it("widens Scripture to Book, Chapter and Verse pages", () => {
    expect(parsePaletteQuery("type:scripture john").types).toEqual(["book", "chapter", "verse"]);
  });

  it("accepts the app language's names, accents or not", () => {
    expect(parsePaletteQuery("type:extraits joie", fr).filters).toEqual(["clipping"]);
    expect(parsePaletteQuery("type:evenements", fr).filters).toEqual(["event"]);
    expect(parsePaletteQuery("type:Écriture", fr).filters).toEqual(["scripture"]);
  });

  it("keeps an unknown type: in the text instead of filtering to nothing", () => {
    const q = parsePaletteQuery("type:banana split");
    expect(q.filters).toEqual([]);
    expect(q.text).toBe("type:banana split");
  });

  it("treats a bare type: as a filter still being typed", () => {
    expect(parsePaletteQuery("joy type:")).toMatchObject({ text: "joy", filters: [] });
  });

  it("names a filter once however often it is typed", () => {
    expect(parsePaletteQuery("type:note type:notes", fr).filters).toEqual(["note"]);
  });
});

describe("toggleTypeFilter", () => {
  it("adds the token in front of the words", () => {
    expect(toggleTypeFilter("endurance", "note")).toBe("type:note endurance ");
    expect(toggleTypeFilter("", "note")).toBe("type:note ");
  });

  it("keeps filters together, before the words", () => {
    expect(toggleTypeFilter("type:note endurance", "clipping")).toBe(
      "type:note type:clipping endurance ",
    );
  });

  it("removes the filter under whatever spelling it was typed", () => {
    expect(toggleTypeFilter("joie type:extraits", "clipping", fr)).toBe("joie ");
    expect(toggleTypeFilter("type:note", "note")).toBe("");
  });

  it("round-trips: toggling twice gives the same search", () => {
    const once = toggleTypeFilter("endurance", "event");
    const twice = toggleTypeFilter(once, "event");
    expect(parsePaletteQuery(twice)).toEqual(parsePaletteQuery("endurance"));
  });
});

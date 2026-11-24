import { describe, expect, it } from "vitest";
import type { DocSummary, NameEntry } from "../api";
import {
  addSourceFilter,
  canCreate,
  enterChoice,
  moveActive,
  resolveSourceName,
  resolveTarget,
  searchPicker,
  sourceEntry,
  sourceNames,
} from "../docPicker";
import { NameIndex } from "../names";
import { readField, setField } from "../frontmatter";

const d = (id: string, title: string): DocSummary =>
  ({ id, title, label: title, type: "character", path: `${title}.md` }) as DocSummary;

const isaac = d("isaac", "Isaac");
const esau = d("esau", "Esau");
const jacob = d("jacob", "Jacob");
const jael = d("jael", "Jael");
const docs = [isaac, esau, jacob, jael];
const entries: NameEntry[] = [{ name: "Israel", id: "jacob", type: "character", alias: true }];

describe("searchPicker", () => {
  it("offers no Create for the exact title of an excluded document", () => {
    // Add child on Isaac: Esau is already his child, so left out.
    const allowed = (x: DocSummary) => x.id !== "isaac" && x.id !== "esau";
    for (const ents of [null, entries]) {
      const s = searchPicker(docs, "Esau", { allowed, entries: ents });
      expect(s.matches).toEqual([]);
      expect(s.exact).toBeNull();
      expect(s.excluded?.doc.id).toBe("esau");
      expect(canCreate(s, "Esau", true)).toBe(false);
    }
  });

  it("offers no Create for the exact Alias of an excluded document", () => {
    const s = searchPicker(docs, "israel", { allowed: (x) => x.id !== "jacob", entries });
    expect(s.excluded?.doc.id).toBe("jacob");
    expect(canCreate(s, "israel", true)).toBe(false);
  });

  it("offers Create for a name nobody has, and not without onCreate", () => {
    const s = searchPicker(docs, "Laban", { entries });
    expect(s.matches).toEqual([]);
    expect(s.excluded).toBeNull();
    expect(canCreate(s, "Laban", true)).toBe(true);
    expect(canCreate(s, "Laban", false)).toBe(false);
    expect(canCreate(s, "  ", true)).toBe(false);
  });

  it("finds an allowed exact title, case-insensitive", () => {
    const s = searchPicker(docs, "jacob", {});
    expect(s.exact?.doc.id).toBe("jacob");
    expect(canCreate(s, "jacob", true)).toBe(false);
  });

  it("judges exactness beyond the shown limit", () => {
    const many = Array.from({ length: 12 }, (_, i) => d(`a${i}`, `Abi ${i}`)).concat(d("abi", "Abi"));
    const s = searchPicker(many, "abi", { limit: 8 });
    expect(s.matches).toHaveLength(8);
    expect(s.exact?.doc.id).toBe("abi");
  });
});

describe("picker keys", () => {
  it("moves the active option, wrapping, starting from either end", () => {
    expect(moveActive(null, 3, 1)).toBe(0);
    expect(moveActive(null, 3, -1)).toBe(2);
    expect(moveActive(2, 3, 1)).toBe(0);
    expect(moveActive(0, 3, -1)).toBe(2);
    expect(moveActive(1, 3, 1)).toBe(2);
    expect(moveActive(null, 0, 1)).toBeNull();
    expect(moveActive(5, 3, 1)).toBe(0);
  });

  it("Enter picks the active option, the Create row last", () => {
    expect(enterChoice([isaac, esau], null, true, 1)).toEqual({ kind: "doc", doc: esau });
    expect(enterChoice([isaac, esau], null, true, 2)).toEqual({ kind: "create" });
  });

  it("Enter with nothing moved chooses only what is unambiguous", () => {
    expect(enterChoice([jacob], null, true, null)).toEqual({ kind: "doc", doc: jacob });
    expect(enterChoice([jacob, jael], jacob, false, null)).toEqual({ kind: "doc", doc: jacob });
    expect(enterChoice([], null, true, null)).toEqual({ kind: "create" });
    // Several matches and no exact title: nothing, never a new document.
    expect(enterChoice([jacob, jael], null, true, null)).toBeNull();
    expect(enterChoice([], null, false, null)).toBeNull();
  });
});

describe("readField", () => {
  it("reads back what setField wrote", () => {
    let fm = setField("", "father", "[[Isaac]]");
    fm = setField(fm, "spouses", ["[[Leah]]", "[[Rachel]]"]);
    expect(readField(fm, "father")).toBe("[[Isaac]]");
    expect(readField(fm, "spouses")).toEqual(["[[Leah]]", "[[Rachel]]"]);
    expect(readField(fm, "mother")).toBeNull();
  });

  it("reads block lists, quotes and bare scalars", () => {
    const fm = `---\nspouses:\n  - "[[Leah]]"\n  - 'Rachel''s'\nmother: Rebekah # note\nempty:\n---\n`;
    expect(readField(fm, "spouses")).toEqual(["[[Leah]]", "Rachel's"]);
    expect(readField(fm, "mother")).toBe("Rebekah");
    expect(readField(fm, "empty")).toBeNull();
  });

  it("leaves forms it does not take to the parsed front matter", () => {
    expect(readField(`---\nfather: [[Isaac]]\n---\n`, "father")).toBeUndefined();
    expect(readField(`---\nfather:\n  name: Isaac\n---\n`, "father")).toBeUndefined();
    expect(readField(`---\nspouses: [a, {b: c}]\n---\n`, "spouses")).toBeUndefined();
    expect(readField(`---\nspouses: |\n  Leah\n  Rachel\n---\n`, "spouses")).toBeUndefined();
    expect(readField(`---\nfather: >-\n  Isaac\n---\n`, "father")).toBeUndefined();
    expect(readField(`---\nfather: &a "[[Isaac]]"\n---\n`, "father")).toBeUndefined();
    expect(readField(`---\nfather: *a\n---\n`, "father")).toBeUndefined();
    expect(readField(`---\nfather: !!str Isaac\n---\n`, "father")).toBeUndefined();
    expect(readField(`---\nfather: Isaac son\n  of Abraham\n---\n`, "father")).toBeUndefined();
  });
});

describe("Add Source picker", () => {
  const src = (id: string, title: string): DocSummary =>
    ({ id, title, label: title, type: "source", path: `Sources/${title}.md` }) as DocSummary;
  const joy = src("joy", "Keep Enduring with Joy");
  const ch1 = src("ch1", "Chapter One");
  const note = { ...d("n", "Chapter One"), type: "note" } as DocSummary;
  const all = [joy, ch1, note, isaac];

  it("reads names from the Property's entries as written", () => {
    expect(sourceNames(["[[Keep Enduring with Joy]]", "Bare", "[[A|shown]]", ""])).toEqual([
      "Keep Enduring with Joy",
      "Bare",
      "A",
    ]);
  });

  it("offers only Sources, without the attached ones", () => {
    const allowed = addSourceFilter(["keep enduring with joy"], all);
    expect(all.filter(allowed).map((x) => x.id)).toEqual(["ch1"]);
    expect(all.filter(addSourceFilter([], all)).map((x) => x.id)).toEqual(["joy", "ch1"]);
  });

  it("knows an attached Source by its path or an Alias", () => {
    const names = new NameIndex([{ name: "KEJ", id: "joy", type: "source", alias: true }]);
    expect(resolveSourceName("Sources/Keep Enduring with Joy", all)?.id).toBe("joy");
    expect(resolveSourceName("keep-enduring  with joy", all)?.id).toBe("joy");
    expect(resolveSourceName("kej", all, names)?.id).toBe("joy");
    expect(all.filter(addSourceFilter(["KEJ"], all, names)).map((x) => x.id)).toEqual(["ch1"]);
  });

  it("resolves as the engine does, then keeps only a Source", () => {
    // "Chapter One" is also a Note's title, at a shorter path: the engine
    // sends [[Chapter One]] to the Note, so the entry names no Source.
    expect(resolveTarget("Chapter One", all)?.id).toBe("n");
    expect(resolveSourceName("Chapter One", all)).toBeNull();
    expect(resolveSourceName("Sources/Chapter One", all)?.id).toBe("ch1");
    expect(resolveSourceName("Isaac", all)).toBeNull();
    expect(resolveSourceName("Gone", all)).toBeNull();
  });

  it("writes a path link for a Source whose title another document shares", () => {
    const names = new NameIndex([
      { name: "Keep Enduring with Joy", id: "joy", type: "source", alias: false },
      { name: "Chapter One", id: "ch1", type: "source", alias: false },
      { name: "Chapter One", id: "n", type: "note", alias: false },
    ]);
    expect(sourceEntry(joy, names)).toBe("[[Keep Enduring with Joy]]");
    const entry = sourceEntry(ch1, names);
    expect(entry).toBe("[[Sources/Chapter One|Chapter One]]");
    // Written so, it names the Source: attached, and no longer offered.
    const attached = sourceNames([entry]);
    expect(resolveSourceName(attached[0], all, names)?.id).toBe("ch1");
    expect(all.filter(addSourceFilter(attached, all, names)).map((x) => x.id)).toEqual(["joy"]);
  });
});

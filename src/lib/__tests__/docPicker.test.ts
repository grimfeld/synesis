import { describe, expect, it } from "vitest";
import type { DocSummary, NameEntry } from "../api";
import { canCreate, enterChoice, moveActive, searchPicker } from "../docPicker";
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

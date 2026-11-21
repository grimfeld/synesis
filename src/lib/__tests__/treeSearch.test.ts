import { describe, expect, it } from "vitest";
import { moveActive } from "../docPicker";
import { TREE_SEARCH_LIMIT, enterPick, searchTree } from "../treeSearch";

const title = (s: string) => s;

describe("searchTree", () => {
  it("puts the titles starting with the query first, then by title", () => {
    const people = ["Abel", "Jacob", "Benjamin", "Abraham", "Laban"];
    expect(searchTree(people, "ab", title)).toEqual(["Abel", "Abraham", "Laban"]);
  });

  it("folds accents and case both ways", () => {
    const people = ["Élie", "Eli", "Noé", "Daniel"];
    expect(searchTree(people, "ELI", title)).toEqual(["Eli", "Élie"]);
    expect(searchTree(people, "noe", title)).toEqual(["Noé"]);
    expect(searchTree(people, "é", title)).toEqual(["Eli", "Élie", "Daniel", "Noé"]);
  });

  it("shows at most eight, and nothing for an empty query", () => {
    const many = Array.from({ length: 12 }, (_, i) => `Abi ${String(i).padStart(2, "0")}`);
    expect(searchTree(many, "abi", title)).toHaveLength(TREE_SEARCH_LIMIT);
    expect(TREE_SEARCH_LIMIT).toBe(8);
    expect(searchTree(many, "   ", title)).toEqual([]);
    expect(searchTree(many, "zz", title)).toEqual([]);
  });

  it("reads the title through the getter", () => {
    const people = [{ id: "b", doc: { title: "Benjamin" } }, { id: "j", doc: { title: "Jacob" } }];
    expect(searchTree(people, "jac", (p) => p.doc.title).map((p) => p.id)).toEqual(["j"]);
  });
});

describe("tree search keys", () => {
  it("moves the active match with the arrows, wrapping at both ends", () => {
    expect(moveActive(null, 3, 1)).toBe(0);
    expect(moveActive(null, 3, -1)).toBe(2);
    expect(moveActive(2, 3, 1)).toBe(0);
    expect(moveActive(0, 3, -1)).toBe(2);
    expect(moveActive(null, 0, 1)).toBeNull();
  });

  it("Enter picks the active match, else the first, and nothing in an empty list", () => {
    expect(enterPick(3, null)).toBe(0);
    expect(enterPick(3, 1)).toBe(1);
    // An index left from a longer list is the first again.
    expect(enterPick(2, 5)).toBe(0);
    expect(enterPick(0, null)).toBeNull();
    expect(enterPick(0, 0)).toBeNull();
  });
});

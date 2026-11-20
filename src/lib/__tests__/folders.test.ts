// Folders (PLAN §31): the sidebar's tree for Notes and Compositions — its
// order, its counts, and where a document outside its type's folder lands.
import { describe, expect, it } from "vitest";
import { childNames, folderNameProblem, folderTree, foldersHolding, loadOpenFolders, naturalCompare, saveOpenFolders } from "../folders";

const doc = (path: string, label = path.split("/").pop()!.replace(/\.md$/, "")) => ({ id: path, path, label });

describe("folderTree", () => {
  it("puts Folders first, then documents, each in natural order", () => {
    const t = folderTree("Notes", ["Week 10", "Week 2", "archive"], [doc("Notes/b.md"), doc("Notes/A.md"), doc("Notes/Week 2/x.md")]);
    expect(t.folders.map((f) => f.name)).toEqual(["archive", "Week 2", "Week 10"]);
    expect(t.docs.map((d) => d.label)).toEqual(["A", "b"]);
    expect(naturalCompare("Week 2", "Week 10")).toBeLessThan(0);
  });

  it("nests Folders and counts the documents each holds, nested ones included", () => {
    const t = folderTree(
      "Notes",
      ["Sermons", "Sermons/2026", "Empty"],
      [doc("Notes/Sermons/2026/week 2.md"), doc("Notes/Sermons/2026/week 10.md"), doc("Notes/Sermons/intro.md")],
    );
    const [empty, sermons] = t.folders;
    expect(empty).toMatchObject({ name: "Empty", count: 0, folders: [], docs: [] });
    expect(sermons).toMatchObject({ key: "Sermons", path: "Notes/Sermons", count: 3 });
    expect(sermons.folders[0]).toMatchObject({ key: "Sermons/2026", count: 2 });
    expect(sermons.folders[0].docs.map((d) => d.label)).toEqual(["week 2", "week 10"]);
  });

  it("finds a Folder from a document's path when the Folder list does not name it", () => {
    const t = folderTree("Compositions", [], [doc("Compositions/Talks/2025/a.md")]);
    expect(t.folders[0]).toMatchObject({ key: "Talks", count: 1 });
    expect(t.folders[0].folders[0]).toMatchObject({ key: "Talks/2025", count: 1 });
  });

  it("places a document outside the type's folder under its real path, after the type's own Folders", () => {
    const t = folderTree("Notes", ["Zeta"], [doc("loose.md"), doc("Study/deep/x.md"), doc("Notes/n.md")]);
    expect(t.docs.map((d) => d.path)).toEqual(["Notes/n.md"]);
    expect(t.folders.map((f) => f.key)).toEqual(["Zeta", "/", "/Study"]);
    expect(t.folders.map((f) => f.outside)).toEqual([false, true, true]);
    expect(t.folders[1].docs.map((d) => d.path)).toEqual(["loose.md"]);
    const study = t.folders[2];
    expect(study).toMatchObject({ name: "Study", path: "Study", count: 1 });
    expect(study.folders[0]).toMatchObject({ key: "/Study/deep", path: "Study/deep", outside: false });
  });

  it("keeps a Folder named like an outside one apart from it", () => {
    const t = folderTree("Notes", ["Study"], [doc("Study/x.md"), doc("Notes/Study/y.md")]);
    expect(t.folders.map((f) => [f.key, f.count])).toEqual([
      ["Study", 1],
      ["/Study", 1],
    ]);
  });
});

describe("foldersHolding", () => {
  it("names every Folder on the way to a document, outermost first", () => {
    const t = folderTree("Notes", [], [doc("Notes/A/B/x.md"), doc("Notes/top.md")]);
    expect(foldersHolding(t, "Notes/A/B/x.md")).toEqual(["A", "A/B"]);
    expect(foldersHolding(t, "Notes/top.md")).toEqual([]);
    expect(foldersHolding(t, "nowhere")).toEqual([]);
  });
});

describe("open Folders", () => {
  it("round-trips through storage and survives junk", () => {
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    saveOpenFolders("v1", "note", new Set(["Sermons", "Sermons/2026"]), s);
    // The other type saving afterwards leaves Notes' entry alone.
    saveOpenFolders("v1", "composition", new Set(["Talks"]), s);
    expect([...loadOpenFolders("v1", "note", s)].sort()).toEqual(["Sermons", "Sermons/2026"]);
    expect([...loadOpenFolders("v1", "composition", s)]).toEqual(["Talks"]);
    // Another Vault keeps its own.
    expect(loadOpenFolders("v2", "note", s).size).toBe(0);
    store.set("synesis.sidebar.folders:v1:note", "{not json");
    expect(loadOpenFolders("v1", "note", s).size).toBe(0);
    store.set("synesis.sidebar.folders:v1:note", JSON.stringify({ a: 1 }));
    expect(loadOpenFolders("v1", "note", s).size).toBe(0);
  });
});

describe("folderNameProblem", () => {
  it("refuses what the engine refuses", () => {
    expect(folderNameProblem("  ", [])).toEqual({ kind: "empty" });
    expect(folderNameProblem(".git", [])).toEqual({ kind: "dot" });
    for (const c of ["/", "\\", ":", "*", "?", '"', "<", ">", "|", "#", "^", "[", "]"]) expect(folderNameProblem(`a${c}b`, [])).toEqual({ kind: "char", char: c });
    expect(folderNameProblem("sermons", ["Sermons"])).toEqual({ kind: "taken", name: "Sermons" });
    expect(folderNameProblem(" Sermons 2026 ", ["Sermons"])).toBeNull();
  });

  it("finds the siblings of a parent", () => {
    const all = ["A", "A/B", "A/B/C", "A/D", "E"];
    expect(childNames(all, "")).toEqual(["A", "E"]);
    expect(childNames(all, "A")).toEqual(["B", "D"]);
    expect(childNames(all, "A/B")).toEqual(["C"]);
  });
});

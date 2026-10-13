// The local graph of one document (PLAN §10).
import { describe, expect, it } from "vitest";
import { levelFor, localGraph, nodeIdFor } from "../graph";
import type { DocSummary, Graph, GraphNode } from "../api";

const node = (id: string, doc_id: string | null = id): GraphNode => ({
  id,
  label: id,
  type: "note",
  doc_id,
  degree: 1,
});

// a — b — c — d, and e on its own; plus s:43:3 linked from b.
const graph: Graph = {
  nodes: [node("a"), node("b"), node("c"), node("d"), node("e"), node("s:43:3", null)],
  edges: [
    { source: "a", target: "b" },
    { source: "c", target: "b" },
    { source: "c", target: "d" },
    { source: "b", target: "s:43:3" },
  ],
};

const doc = (over: Partial<DocSummary>) => ({ id: "x", type: "note", ...over }) as DocSummary;
const ids = (g: Graph) => g.nodes.map((n) => n.id).sort();

describe("localGraph", () => {
  it("keeps the document and its neighbours, whichever way the link runs", () => {
    const g = localGraph(graph, "b", 1);
    expect(ids(g)).toEqual(["a", "b", "c", "s:43:3"]);
    // Only edges between kept nodes: c — d is gone with d.
    expect(g.edges).toHaveLength(3);
  });

  it("reaches the neighbours' neighbours at depth 2", () => {
    expect(ids(localGraph(graph, "a", 1))).toEqual(["a", "b"]);
    expect(ids(localGraph(graph, "a", 2))).toEqual(["a", "b", "c", "s:43:3"]);
  });

  it("is the document alone when nothing links to it", () => {
    expect(localGraph(graph, "e", 2)).toEqual({ nodes: [node("e")], edges: [] });
  });

  it("is empty when the document is not drawn at all", () => {
    expect(localGraph(graph, "zz", 1)).toEqual({ nodes: [], edges: [] });
  });
});

describe("nodeIdFor", () => {
  it("finds a document by its id", () => {
    expect(nodeIdFor(graph, doc({ id: "c" }))).toBe("c");
  });

  it("finds a Scripture page by its place in the canon", () => {
    expect(nodeIdFor(graph, doc({ id: "p", type: "chapter", book: 43, chapter: 3 }))).toBe("s:43:3");
    expect(nodeIdFor(graph, doc({ id: "p", type: "verse", book: 43, chapter: 3, verse: 16 }))).toBeNull();
  });
});

describe("levelFor", () => {
  it("draws a Scripture page at its own level, anything else at the chosen one", () => {
    expect(levelFor(doc({ type: "verse" }), "chapter")).toBe("verse");
    expect(levelFor(doc({ type: "book" }), "verse")).toBe("book");
    expect(levelFor(doc({ type: "note" }), "verse")).toBe("verse");
  });
});

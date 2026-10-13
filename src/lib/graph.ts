// The local graph of one document (PLAN §10): the document and what is linked
// to it, either way, out to a chosen depth. Cut from the whole graph the
// engine already answers, so there is one notion of an edge, not two.
//
// Kept free of React, like `board.ts` and `timeline.ts`, so it is tested by
// `test:unit` and GraphView stays a shell.
import type { DocSummary, Graph, GraphLevel } from "./api";

/** How far out a local graph reaches: neighbours, or their neighbours too. */
export type Depth = 1 | 2;

/**
 * The Scripture level a document's own node exists at.
 *
 * The whole graph is drawn at one level (Book, Chapter or Verse), and a Verse
 * page has no node of its own at the Chapter level. A local graph of a
 * Scripture page is therefore drawn at that page's level; any other document
 * keeps the level the reader chose.
 */
export function levelFor(doc: DocSummary, chosen: GraphLevel): GraphLevel {
  if (doc.type === "book") return "book";
  if (doc.type === "chapter") return "chapter";
  if (doc.type === "verse") return "verse";
  return chosen;
}

/** The id of the node standing for `doc` in `graph`, if it is drawn. */
export function nodeIdFor(graph: Graph, doc: DocSummary): string | null {
  const byDoc = graph.nodes.find((n) => n.doc_id === doc.id);
  if (byDoc) return byDoc.id;
  // A Scripture node is keyed by its place in the canon, and may be drawn
  // before (or without) its page being indexed against it.
  if (doc.book != null) {
    const id =
      doc.type === "book"
        ? `s:${doc.book}`
        : doc.type === "chapter"
          ? `s:${doc.book}:${doc.chapter}`
          : doc.type === "verse"
            ? `s:${doc.book}:${doc.chapter}:${doc.verse}`
            : null;
    if (id && graph.nodes.some((n) => n.id === id)) return id;
  }
  return null;
}

/**
 * `root` and every node within `depth` edges of it, ignoring direction — a
 * document that Mentions this one and a document this one Mentions are both
 * its neighbours — with the edges between the nodes kept.
 *
 * Degrees are left as the whole graph counts them: a node's size says how
 * connected it is in the Vault, which is what makes a hub stand out here too.
 */
export function localGraph(graph: Graph, root: string, depth: Depth): Graph {
  if (!graph.nodes.some((n) => n.id === root)) return { nodes: [], edges: [] };
  const around = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = around.get(a);
    if (list) list.push(b);
    else around.set(a, [b]);
  };
  for (const e of graph.edges) {
    link(e.source, e.target);
    link(e.target, e.source);
  }
  const keep = new Set([root]);
  let ring = [root];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const id of ring)
      for (const other of around.get(id) ?? [])
        if (!keep.has(other)) {
          keep.add(other);
          next.push(other);
        }
    ring = next;
  }
  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges: graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
  };
}

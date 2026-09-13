// Board geometry (Vitest, jsdom): `npm run test:unit`.
import { describe, expect, it } from "vitest";
import {
  anchorOf,
  centreOf,
  clampZoom,
  contentBounds,
  diffBoards,
  edgeMidpoint,
  edgePath,
  fitAll,
  freeSpotNear,
  intersects,
  MAX_ZOOM,
  MIN_ZOOM,
  moveNodes,
  newId,
  nodeAt,
  nodesIn,
  rectFrom,
  removeNodes,
  toBoard,
  toScreen,
  zoomAt,
} from "../board";
import type { Board, CanvasEdge, CanvasNode } from "../api";

const node = (
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 50,
  type: CanvasNode["type"] = "text",
): CanvasNode => ({ id, type, x, y, width, height });

describe("viewport conversion", () => {
  it("round-trips a point through screen and back", () => {
    const v = { x: -300, y: 120, zoom: 1.5 };
    const [sx, sy] = toScreen(v, 40, 200);
    expect(toBoard(v, sx, sy)).toEqual([40, 200]);
  });

  it("puts the viewport origin at the screen origin", () => {
    expect(toScreen({ x: 50, y: 50, zoom: 2 }, 50, 50)).toEqual([0, 0]);
  });

  it("clamps zoom to the usable range", () => {
    expect(clampZoom(0.0001)).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(1.5)).toBe(1.5);
  });
});

describe("zoomAt", () => {
  it("keeps the board point under the cursor fixed", () => {
    const v = { x: 0, y: 0, zoom: 1 };
    const before = toBoard(v, 300, 200);
    const after = zoomAt(v, 300, 200, 2);
    expect(toBoard(after, 300, 200)[0]).toBeCloseTo(before[0], 6);
    expect(toBoard(after, 300, 200)[1]).toBeCloseTo(before[1], 6);
    expect(after.zoom).toBe(2);
  });

  it("is a no-op once clamped", () => {
    const v = { x: 10, y: 10, zoom: MAX_ZOOM };
    expect(zoomAt(v, 100, 100, 2)).toBe(v);
  });
});

describe("contentBounds and fitAll", () => {
  it("covers every node including groups", () => {
    const b = contentBounds([
      node("a", 0, 0),
      node("b", 400, 300),
      node("g", -50, -50, 600, 500, "group"),
    ]);
    expect(b).toEqual({ x: -50, y: -50, width: 600, height: 500 });
  });

  it("is null for an empty board", () => {
    expect(contentBounds([])).toBeNull();
  });

  it("fits content into the viewport", () => {
    const nodes = [node("a", 0, 0, 200, 100), node("b", 800, 400, 200, 100)];
    const v = fitAll(nodes, 500, 500);
    // Every corner of the content is on screen.
    const [x1, y1] = toScreen(v, 0, 0);
    const [x2, y2] = toScreen(v, 1000, 500);
    expect(x1).toBeGreaterThanOrEqual(0);
    expect(y1).toBeGreaterThanOrEqual(0);
    expect(x2).toBeLessThanOrEqual(500);
    expect(y2).toBeLessThanOrEqual(500);
  });

  it("centres the content it fits", () => {
    const nodes = [node("a", 0, 0, 200, 200)];
    const v = fitAll(nodes, 600, 600);
    const [cx, cy] = toScreen(v, 100, 100);
    expect(cx).toBeCloseTo(300, 5);
    expect(cy).toBeCloseTo(300, 5);
  });

  it("survives a single node, which has no extent to pad", () => {
    const v = fitAll([node("a", 10, 10, 200, 100)], 400, 400);
    expect(Number.isFinite(v.zoom)).toBe(true);
    expect(Number.isFinite(v.x)).toBe(true);
    expect(v.zoom).toBeGreaterThan(0);
  });

  it("does not shrink to nothing on a tall narrow screen", () => {
    // A wide Board on a phone: fitting both axes would shrink it until the
    // width fits and leave most of the height empty.
    const nodes = [node("a", 0, 0, 800, 400)];
    const phone = fitAll(nodes, 412, 915);
    const strict = fitAll(nodes, 412, 915, 0);
    expect(phone.zoom).toBeGreaterThan(strict.zoom);
    // But never beyond what the generous axis can show.
    expect(phone.zoom).toBeLessThanOrEqual(915 / 400);
  });

  it("leaves a balanced viewport fitting both axes", () => {
    const nodes = [node("a", 0, 0, 800, 600)];
    expect(fitAll(nodes, 1000, 800).zoom).toBe(fitAll(nodes, 1000, 800, 0).zoom);
  });

  it("falls back to the origin for an empty board or a zero-size viewport", () => {
    expect(fitAll([], 500, 500)).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(fitAll([node("a", 0, 0)], 0, 0)).toEqual({ x: 0, y: 0, zoom: 1 });
  });
});

describe("hit testing", () => {
  const nodes = [
    node("g", -20, -20, 400, 300, "group"),
    node("a", 0, 0, 100, 50),
    node("b", 200, 0, 100, 50),
  ];

  it("finds the node under a point", () => {
    expect(nodeAt(nodes, 50, 25)?.id).toBe("a");
    expect(nodeAt(nodes, 250, 25)?.id).toBe("b");
  });

  it("prefers a node over the group behind it", () => {
    // The group covers this point too, but the bubble is what was clicked.
    expect(nodeAt(nodes, 50, 25)?.id).toBe("a");
  });

  it("falls back to the group on empty space inside it", () => {
    expect(nodeAt(nodes, 150, 200)?.id).toBe("g");
  });

  it("returns null outside everything", () => {
    expect(nodeAt(nodes, 9999, 9999)).toBeNull();
  });

  it("takes the topmost of two overlapping nodes", () => {
    // Array order is z-index ascending, so the later node wins.
    const stacked = [node("under", 0, 0), node("over", 10, 10)];
    expect(nodeAt(stacked, 50, 40)?.id).toBe("over");
  });
});

describe("marquee selection", () => {
  it("builds a rectangle from corners in any order", () => {
    expect(rectFrom(100, 100, 20, 40)).toEqual({
      x: 20,
      y: 40,
      width: 80,
      height: 60,
    });
  });

  it("takes every node the marquee touches, not only those enclosed", () => {
    const nodes = [node("a", 0, 0), node("b", 200, 0), node("c", 900, 900)];
    const picked = nodesIn(nodes, rectFrom(-10, -10, 250, 30)).map((n) => n.id);
    expect(picked).toEqual(["a", "b"]);
  });

  it("reports no overlap for touching-but-disjoint rectangles", () => {
    expect(
      intersects(
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 10, y: 0, width: 10, height: 10 },
      ),
    ).toBe(false);
  });
});

describe("edges", () => {
  const from = node("a", 0, 0, 100, 100);
  const to = node("b", 400, 0, 100, 100);

  it("leaves from the face pointing at its partner when no side is given", () => {
    const e: CanvasEdge = { id: "e", fromNode: "a", toNode: "b" };
    expect(anchorOf(from, e.fromSide, centreOf(to)).side).toBe("right");
    expect(anchorOf(to, e.toSide, centreOf(from)).side).toBe("left");
  });

  it("picks a vertical face for a node above its partner", () => {
    const below = node("c", 0, 400, 100, 100);
    expect(anchorOf(from, undefined, centreOf(below)).side).toBe("bottom");
    expect(anchorOf(below, undefined, centreOf(from)).side).toBe("top");
  });

  it("honours an explicit side over the direction", () => {
    const a = anchorOf(from, "top", centreOf(to));
    expect(a.side).toBe("top");
    expect(a).toMatchObject({ x: 50, y: 0 });
  });

  it("draws a curve between the two anchors", () => {
    const e: CanvasEdge = { id: "e", fromNode: "a", toNode: "b" };
    const d = edgePath(from, to, e);
    expect(d).toMatch(/^M 100 50 C /);
    expect(d).toMatch(/400 50$/);
  });

  it("puts the label between the endpoints", () => {
    const e: CanvasEdge = { id: "e", fromNode: "a", toNode: "b" };
    expect(edgeMidpoint(from, to, e)).toEqual({ x: 250, y: 50 });
  });
});

describe("freeSpotNear", () => {
  it("uses the requested point when it is clear", () => {
    expect(freeSpotNear([node("a", 0, 0)], 500, 500)).toEqual({
      x: 500,
      y: 500,
    });
  });

  it("moves off a node it would land on", () => {
    const nodes = [node("a", 0, 0, 260, 100)];
    const spot = freeSpotNear(nodes, 0, 0);
    expect(
      intersects({ ...spot, width: 260, height: 100 }, nodes[0]),
    ).toBe(false);
  });

  it("ignores groups, which are backdrops rather than obstacles", () => {
    const g = node("g", 0, 0, 2000, 2000, "group");
    expect(freeSpotNear([g], 100, 100)).toEqual({ x: 100, y: 100 });
  });
});

describe("board edits", () => {
  const board = (): Board => ({
    nodes: [node("a", 0, 0), node("b", 200, 0), node("c", 400, 0)],
    edges: [
      { id: "e1", fromNode: "a", toNode: "b" },
      { id: "e2", fromNode: "b", toNode: "c" },
    ],
  });

  it("moves only the selected nodes, rounding to integers", () => {
    const out = moveNodes(board(), new Set(["a", "c"]), 10.4, -5.6);
    expect(out.nodes.map((n) => [n.id, n.x, n.y])).toEqual([
      ["a", 10, -6],
      ["b", 200, 0],
      ["c", 410, -6],
    ]);
  });

  it("returns the same board when nothing moves", () => {
    const b = board();
    expect(moveNodes(b, new Set(), 10, 10)).toBe(b);
    expect(moveNodes(b, new Set(["a"]), 0, 0)).toBe(b);
  });

  it("deletes a node's edges with it, since an edge cannot dangle", () => {
    const out = removeNodes(board(), new Set(["b"]));
    expect(out.nodes.map((n) => n.id)).toEqual(["a", "c"]);
    expect(out.edges).toEqual([]);
  });

  it("keeps edges between survivors", () => {
    const out = removeNodes(board(), new Set(["c"]));
    expect(out.edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("preserves unknown fields through an edit", () => {
    // The hard requirement: what Obsidian wrote must survive us touching it.
    const b: Board = {
      nodes: [{ ...node("a", 0, 0), styleAttributes: { shape: "diamond" } }],
      edges: [],
      metadata: { from: "obsidian" },
    };
    const out = moveNodes(b, new Set(["a"]), 5, 5);
    expect(out.nodes[0].styleAttributes).toEqual({ shape: "diamond" });
    expect(out.metadata).toEqual({ from: "obsidian" });
  });
});

describe("newId", () => {
  it("makes distinct hex ids", () => {
    const ids = new Set(Array.from({ length: 50 }, newId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("diffBoards", () => {
  const base: Board = {
    nodes: [
      { ...node("a", 0, 0), text: "Endurance" },
      { ...node("b", 200, 0), text: "Patience" },
    ],
    edges: [],
  };

  it("reports an added node", () => {
    const after: Board = {
      ...base,
      nodes: [...base.nodes, { ...node("c", 400, 0), text: "Hope" }],
    };
    expect(diffBoards(base, after)).toEqual([
      { kind: "added", id: "c", label: "Hope" },
    ]);
  });

  it("reports a removed node", () => {
    const after: Board = { ...base, nodes: [base.nodes[0]] };
    expect(diffBoards(base, after)).toEqual([
      { kind: "removed", id: "b", label: "Patience" },
    ]);
  });

  it("tells a move apart from an edit", () => {
    const after: Board = {
      ...base,
      nodes: [
        { ...base.nodes[0], x: 50 },
        { ...base.nodes[1], text: "Long-suffering" },
      ],
    };
    expect(diffBoards(base, after)).toEqual([
      { kind: "changed", id: "b", label: "Long-suffering" },
      { kind: "moved", id: "a", label: "Endurance" },
    ]);
  });

  it("is empty when nothing changed", () => {
    expect(diffBoards(base, base)).toEqual([]);
  });

  it("handles a Board that did not exist yet", () => {
    expect(diffBoards(null, base).map((c) => c.kind)).toEqual([
      "added",
      "added",
    ]);
    expect(diffBoards(base, null).map((c) => c.kind)).toEqual([
      "removed",
      "removed",
    ]);
    expect(diffBoards(null, null)).toEqual([]);
  });

  it("names a file node by its file and a group by its label", () => {
    const before: Board = { nodes: [], edges: [] };
    const after: Board = {
      nodes: [
        { ...node("f", 0, 0, 100, 50, "file"), file: "Notes/steadfast.md" },
        { ...node("g", 0, 0, 400, 300, "group"), label: "Point 1" },
      ],
      edges: [],
    };
    expect(diffBoards(before, after).map((c) => c.label)).toEqual([
      "Point 1",
      "steadfast",
    ]);
  });

  it("truncates a long bubble rather than dumping it into the list", () => {
    const before: Board = { nodes: [], edges: [] };
    const after: Board = {
      nodes: [{ ...node("a", 0, 0), text: "x".repeat(200) }],
      edges: [],
    };
    expect(diffBoards(before, after)[0].label).toHaveLength(48);
  });
});

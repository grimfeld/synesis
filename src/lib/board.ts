// Board geometry: the maths behind the canvas, with no React and no engine,
// so it can be tested directly (`npm run test:unit`) rather than through the
// view. `BoardView` is the SVG shell over this.
//
// Coordinates come in two kinds and mixing them is the bug this module exists
// to prevent. **Board** coordinates are what JSON Canvas stores: integer
// pixels on an unbounded plane whose origin is arbitrary. **Screen**
// coordinates are pixels within the rendered viewport. A `Viewport` converts
// between them.
import type { Board, CanvasEdge, CanvasNode } from "./api";

/** A rectangle in Board coordinates. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What part of the Board is on screen: a pan offset plus a zoom factor. */
export interface Viewport {
  /** Board coordinate at the viewport's left edge. */
  x: number;
  /** Board coordinate at the viewport's top edge. */
  y: number;
  /** Board pixels per screen pixel, inverted: 2 means twice as large. */
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
/** Padding around the content when fitting, as a fraction of its size. */
const FIT_PADDING = 0.08;
/** A new bubble's size, big enough for a line or two without resizing. */
export const DEFAULT_NODE: { width: number; height: number } = {
  width: 260,
  height: 100,
};

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function toScreen(v: Viewport, x: number, y: number): [number, number] {
  return [(x - v.x) * v.zoom, (y - v.y) * v.zoom];
}

export function toBoard(v: Viewport, x: number, y: number): [number, number] {
  return [x / v.zoom + v.x, y / v.zoom + v.y];
}

/**
 * The smallest rectangle covering every node, or null for an empty Board.
 * Group nodes count: a group is a node like any other, and one drawn around
 * everything is exactly the thing a fit should not crop.
 */
export function contentBounds(nodes: CanvasNode[]): Rect | null {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The viewport that shows the whole Board centred in a `width` x `height`
 * screen. Boards open fitted rather than where they were left: a Board's shape
 * is the point, and landing zoomed into a corner is disorienting (PLAN §16.16).
 */
export function fitAll(
  nodes: CanvasNode[],
  width: number,
  height: number,
  /**
   * Smallest fraction of the viewport the content may be shrunk to fill.
   *
   * Fitting both axes means a wide Board on a tall phone shrinks until its
   * width fits, leaving the height mostly empty and the text unreadable. This
   * floor lets the taller axis overflow instead — panning down is natural,
   * squinting is not. 0 restores a strict fit on both axes.
   */
  minFill = 0.55,
): Viewport {
  const b = contentBounds(nodes);
  if (!b || width <= 0 || height <= 0) return { x: 0, y: 0, zoom: 1 };
  // A single node, or a row of them, has no extent on one axis; padding it by
  // a fraction of zero would divide by zero, so fall back to the node size.
  const padX = Math.max(b.width * FIT_PADDING, DEFAULT_NODE.width * FIT_PADDING);
  const padY = Math.max(
    b.height * FIT_PADDING,
    DEFAULT_NODE.height * FIT_PADDING,
  );
  const w = b.width + padX * 2;
  const h = b.height + padY * 2;
  const byWidth = width / w;
  const byHeight = height / h;
  const both = Math.min(byWidth, byHeight);
  // Only relax the fit when one axis is starving the other: never zoom past
  // what the more generous axis can show.
  const zoom = clampZoom(
    both < Math.max(byWidth, byHeight) * minFill
      ? Math.max(byWidth, byHeight) * minFill
      : both,
  );
  // Centre whatever slack the clamp left over.
  return {
    x: b.x + b.width / 2 - width / zoom / 2,
    y: b.y + b.height / 2 - height / zoom / 2,
    zoom,
  };
}

/** Zoom about a screen point, so the Board under the cursor stays put. */
export function zoomAt(
  v: Viewport,
  screenX: number,
  screenY: number,
  factor: number,
): Viewport {
  const zoom = clampZoom(v.zoom * factor);
  if (zoom === v.zoom) return v;
  const [bx, by] = toBoard(v, screenX, screenY);
  return { x: bx - screenX / zoom, y: by - screenY / zoom, zoom };
}

/** Whether two rectangles overlap at all. */
export function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** A rectangle from two corners, in any order. */
export function rectFrom(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Rect {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/**
 * The topmost node at a Board point, or null.
 *
 * Array order is z-index ascending, so the search runs backwards to find what
 * the user sees on top. Groups lose to anything drawn over them: a group is a
 * backdrop, and clicking inside one should pick the node in it, not the box.
 */
export function nodeAt(nodes: CanvasNode[], x: number, y: number): CanvasNode | null {
  let group: CanvasNode | null = null;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (x < n.x || y < n.y || x > n.x + n.width || y > n.y + n.height) continue;
    if (n.type === "group") {
      group ??= n;
      continue;
    }
    return n;
  }
  return group;
}

/** Every node the marquee touches, in Board coordinates. */
export function nodesIn(nodes: CanvasNode[], marquee: Rect): CanvasNode[] {
  return nodes.filter((n) => intersects(n, marquee));
}

/**
 * Where an edge meets a node's edge.
 *
 * JSON Canvas lets an edge name a side, and leaves it open when it does not.
 * An unspecified side is resolved by direction, so an edge always leaves from
 * the face pointing at its partner rather than from a fixed corner.
 */
export function anchorOf(
  node: CanvasNode,
  side: CanvasEdge["fromSide"],
  toward: { x: number; y: number },
): { x: number; y: number; side: NonNullable<CanvasEdge["fromSide"]> } {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  let s = side;
  if (!s) {
    const dx = toward.x - cx;
    const dy = toward.y - cy;
    // Compare against the node's own aspect so a wide node prefers its
    // left/right faces, which is what looks right.
    s =
      Math.abs(dx) * node.height > Math.abs(dy) * node.width
        ? dx > 0
          ? "right"
          : "left"
        : dy > 0
          ? "bottom"
          : "top";
  }
  switch (s) {
    case "top":
      return { x: cx, y: node.y, side: s };
    case "bottom":
      return { x: cx, y: node.y + node.height, side: s };
    case "left":
      return { x: node.x, y: cy, side: s };
    default:
      return { x: node.x + node.width, y: cy, side: "right" };
  }
}

/** Centre of a node, for aiming an edge before its anchor is known. */
export function centreOf(n: CanvasNode): { x: number; y: number } {
  return { x: n.x + n.width / 2, y: n.y + n.height / 2 };
}

/**
 * A cubic Bézier from one node to another, bulging out of the faces it leaves
 * so two edges between the same pair do not lie on top of each other.
 */
export function edgePath(from: CanvasNode, to: CanvasNode, edge: CanvasEdge): string {
  const a = anchorOf(from, edge.fromSide, centreOf(to));
  const b = anchorOf(to, edge.toSide, centreOf(from));
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  // A short edge with a long handle loops back on itself; cap the handle at a
  // third of the span.
  const pull = Math.max(24, Math.min(dist / 3, 120));
  const out = (s: string, p: { x: number; y: number }) =>
    s === "left"
      ? { x: p.x - pull, y: p.y }
      : s === "right"
        ? { x: p.x + pull, y: p.y }
        : s === "top"
          ? { x: p.x, y: p.y - pull }
          : { x: p.x, y: p.y + pull };
  const c1 = out(a.side, a);
  const c2 = out(b.side, b);
  return `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
}

/** The midpoint of an edge's curve, where its label sits. */
export function edgeMidpoint(
  from: CanvasNode,
  to: CanvasNode,
  edge: CanvasEdge,
): { x: number; y: number } {
  const a = anchorOf(from, edge.fromSide, centreOf(to));
  const b = anchorOf(to, edge.toSide, centreOf(from));
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Somewhere to drop a new node so it lands on empty canvas.
 *
 * Tries the requested point, then spirals outward in node-sized steps until
 * nothing overlaps. Dropping a node exactly on top of another hides it, and a
 * user who cannot see what they just made assumes it failed.
 */
export function freeSpotNear(
  nodes: CanvasNode[],
  x: number,
  y: number,
  width = DEFAULT_NODE.width,
  height = DEFAULT_NODE.height,
): { x: number; y: number } {
  const gap = 24;
  const solid = nodes.filter((n) => n.type !== "group");
  const free = (px: number, py: number) =>
    !solid.some((n) => intersects({ x: px, y: py, width, height }, n));
  if (free(x, y)) return { x: Math.round(x), y: Math.round(y) };
  const stepX = width + gap;
  const stepY = height + gap;
  for (let ring = 1; ring <= 12; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        // Only the ring's edge is new; its inside was tried already.
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        const px = x + dx * stepX;
        const py = y + dy * stepY;
        if (free(px, py)) return { x: Math.round(px), y: Math.round(py) };
      }
    }
  }
  return { x: Math.round(x), y: Math.round(y) };
}

/** A fresh node id. Free-form in the spec; Obsidian uses 16 hex characters. */
export function newId(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");
}

export const emptyBoard = (): Board => ({ nodes: [], edges: [] });

/** Move nodes by a Board-space delta, rounding to the integers the spec wants. */
export function moveNodes(
  board: Board,
  ids: ReadonlySet<string>,
  dx: number,
  dy: number,
): Board {
  if (ids.size === 0 || (dx === 0 && dy === 0)) return board;
  return {
    ...board,
    nodes: board.nodes.map((n) =>
      ids.has(n.id)
        ? { ...n, x: Math.round(n.x + dx), y: Math.round(n.y + dy) }
        : n,
    ),
  };
}

/**
 * Remove nodes, and every edge that pointed at one.
 *
 * An edge whose endpoint is gone is unrenderable, and JSON Canvas has no
 * free-floating endpoints to demote it to.
 */
export function removeNodes(board: Board, ids: ReadonlySet<string>): Board {
  return {
    ...board,
    nodes: board.nodes.filter((n) => !ids.has(n.id)),
    edges: board.edges.filter(
      (e) => !ids.has(e.fromNode) && !ids.has(e.toNode),
    ),
  };
}

/** One line of a Board diff: what happened to a node between two Versions. */
export interface BoardChange {
  kind: "added" | "removed" | "moved" | "changed";
  id: string;
  /** A short name for the node: its text, its file, or its group label. */
  label: string;
}

function labelOf(n: CanvasNode): string {
  const raw =
    n.type === "text"
      ? (n.text ?? "")
      : n.type === "file"
        ? (n.file?.split("/").pop()?.replace(/\.md$/, "") ?? "")
        : (n.label ?? "");
  const line = raw.split("\n")[0].trim();
  return line.length > 48 ? `${line.slice(0, 47)}…` : line;
}

/**
 * What changed between two Boards, node by node.
 *
 * A Version covers the talk and its Board together, so restoring one restores
 * both; this is what lets the diff say so rather than leaving it a surprise
 * (PLAN §16.17). Edges are counted as a change to the nodes they join rather
 * than listed separately: an edge has no name of its own to show.
 */
export function diffBoards(before: Board | null, after: Board | null): BoardChange[] {
  const a = new Map((before?.nodes ?? []).map((n) => [n.id, n]));
  const b = new Map((after?.nodes ?? []).map((n) => [n.id, n]));
  const out: BoardChange[] = [];
  for (const [id, node] of a) {
    const now = b.get(id);
    if (!now) {
      out.push({ kind: "removed", id, label: labelOf(node) });
      continue;
    }
    const moved = now.x !== node.x || now.y !== node.y;
    const sized = now.width !== node.width || now.height !== node.height;
    const edited =
      now.text !== node.text ||
      now.file !== node.file ||
      now.label !== node.label ||
      now.color !== node.color;
    if (edited) out.push({ kind: "changed", id, label: labelOf(now) });
    else if (moved || sized) out.push({ kind: "moved", id, label: labelOf(now) });
  }
  for (const [id, node] of b) {
    if (!a.has(id)) out.push({ kind: "added", id, label: labelOf(node) });
  }
  // Additions first, then removals, then the quieter edits: the order in which
  // a reader wants to hear what happened.
  const rank = { added: 0, removed: 1, changed: 2, moved: 3 } as const;
  return out.sort(
    (x, y) => rank[x.kind] - rank[y.kind] || x.label.localeCompare(y.label),
  );
}

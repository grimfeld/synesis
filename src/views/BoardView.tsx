// The Board of a Composition: a JSON Canvas laid out by hand (ADR 0009).
//
// An SVG shell over `src/lib/board.ts`, which holds every calculation. What
// lives here is the interaction: what a pointer press means, what is selected,
// and when to save. Node content is HTML inside `foreignObject` so a Clipping's
// quote wraps like text rather than needing manual line breaking.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Download,
  Group,
  Link2,
  Maximize,
  Palette,
  Plus,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { cn } from "cn";
import { api, type Board, type CanvasNode, type DocSummary } from "@/lib/api";
import {
  DEFAULT_NODE,
  edgeMidpoint,
  edgePath,
  emptyBoard,
  fitAll,
  freeSpotNear,
  moveNodes,
  newId,
  nodeAt,
  nodesIn,
  rectFrom,
  removeNodes,
  toBoard,
  zoomAt,
  type Rect,
  type Viewport,
} from "@/lib/board";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { useIsMobile } from "@/hooks/use-mobile";
import { IconButton } from "@/components/IconButton";
import { boardToSvg, svgToPng } from "@/lib/boardExport";
import { BoardDrawer } from "@/components/BoardDrawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** The six JSON Canvas presets. The spec leaves their actual colours to us. */
const PRESETS = ["1", "2", "3", "4", "5", "6"] as const;
const PRESET_HEX: Record<string, string> = {
  "1": "#e5484d",
  "2": "#f76b15",
  "3": "#ffb224",
  "4": "#30a46c",
  "5": "#00a2c7",
  "6": "#8e4ec6",
};

function colorOf(c: string | undefined): string | null {
  if (!c) return null;
  return c.startsWith("#") ? c : (PRESET_HEX[c] ?? null);
}

/** How far a pointer may travel before a press counts as a drag, not a click. */
const DRAG_SLOP = 4;
/** Long-press duration that picks up a node on touch (PLAN §16.15). */
const LONG_PRESS_MS = 400;

type Gesture =
  | { kind: "none" }
  | { kind: "pan"; startX: number; startY: number; origin: Viewport }
  | {
      kind: "move";
      startX: number;
      startY: number;
      ids: Set<string>;
      base: Board;
      moved: boolean;
    }
  | { kind: "marquee"; startX: number; startY: number; rect: Rect }
  | { kind: "edge"; from: string; x: number; y: number };

export function BoardView({
  id,
  docs,
}: {
  /** The Composition the Board belongs to. */
  id: string;
  /** Every document, for resolving `file` nodes to titles and excerpts. */
  docs: DocSummary[];
}) {
  const s = useStore();
  const t = useT();
  const isMobile = useIsMobile();
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [labelling, setLabelling] = useState<string | null>(null);
  const gesture = useRef<Gesture>({ kind: "none" });
  const [, forceRender] = useState(0);
  const longPress = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  // The Board is fitted once per document, not on every change, or adding a
  // node off-screen would yank the viewport out from under the user.
  const fitted = useRef<string | null>(null);

  const byPath = useMemo(
    () => new Map(docs.map((d) => [d.path, d])),
    [docs],
  );

  useEffect(() => {
    let live = true;
    setBoard(null);
    setSelected(new Set());
    fitted.current = null;
    api.getBoard(id).then((b) => {
      if (live) setBoard(b ?? emptyBoard());
    });
    return () => {
      live = false;
    };
  }, [id]);

  // Track the host's size so fit-all and hit-testing use real pixels.
  //
  // Depends on `board` because the component renders a placeholder until the
  // Board has loaded: the host does not exist on the first pass, and an
  // observer attached then would watch nothing for the rest of the session.
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect;
      setSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    // A ResizeObserver reports the first size asynchronously, so seed it now:
    // the fit would otherwise wait a frame behind the content it frames.
    const r = el.getBoundingClientRect();
    if (r.width > 0) setSize({ width: r.width, height: r.height });
    return () => ro.disconnect();
  }, [board !== null]);

  // Fit on open (PLAN §16.16). The guard is only spent once there is actually
  // something to frame: `board` arrives before `ResizeObserver` has measured
  // the host, and an empty Board must not consume the one chance to fit.
  useEffect(() => {
    if (!board || size.width === 0 || fitted.current === id) return;
    if (board.nodes.length === 0) return;
    fitted.current = id;
    setView(fitAll(board.nodes, size.width, size.height));
  }, [board, size, id]);

  // What a pending save would write, held so unmounting can flush it rather
  // than drop it. A debounce that cancels on unmount loses the last edit
  // whenever the user leaves straight after making one.
  const pending = useRef<{ id: string; board: Board } | null>(null);

  const flush = useCallback(() => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const p = pending.current;
    pending.current = null;
    if (p) void api.saveBoard(p.id, p.board);
  }, []);

  const save = useCallback(
    (next: Board) => {
      setBoard(next);
      pending.current = { id, board: next };
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      // Debounced: a drag produces a change per frame, and each save writes
      // the file and records a CRDT operation.
      saveTimer.current = window.setTimeout(flush, 400);
    },
    [id, flush],
  );

  // Leaving the Board — another tab, another document, closing the window —
  // writes what is pending instead of discarding it.
  useEffect(() => flush, [flush, id]);

  const pointerBoard = useCallback(
    (e: { clientX: number; clientY: number }): [number, number] => {
      const r = hostRef.current?.getBoundingClientRect();
      return toBoard(view, e.clientX - (r?.left ?? 0), e.clientY - (r?.top ?? 0));
    },
    [view],
  );

  const addNode = useCallback(
    (partial: Partial<CanvasNode> & Pick<CanvasNode, "type">) => {
      if (!board) return;
      // A new node lands in the middle of what is on screen, nudged off
      // anything already there.
      const [cx, cy] = toBoard(view, size.width / 2, size.height / 2);
      const width = partial.width ?? DEFAULT_NODE.width;
      const height = partial.height ?? DEFAULT_NODE.height;
      const spot = freeSpotNear(
        board.nodes,
        cx - width / 2,
        cy - height / 2,
        width,
        height,
      );
      const node: CanvasNode = {
        id: newId(),
        x: spot.x,
        y: spot.y,
        width,
        height,
        ...partial,
      };
      save({ ...board, nodes: [...board.nodes, node] });
      setSelected(new Set([node.id]));
      if (node.type === "text") setEditing(node.id);
      return node;
    },
    [board, view, size, save],
  );

  /** Drop a document on the Board as a `file` node. */
  const addDocument = useCallback(
    (doc: DocSummary) => {
      addNode({ type: "file", file: doc.path, height: 140 });
    },
    [addNode],
  );

  const deleteSelected = useCallback(() => {
    if (!board || selected.size === 0) return;
    save(removeNodes(board, selected));
    setSelected(new Set());
  }, [board, selected, save]);

  const setColor = useCallback(
    (color: string | null) => {
      if (!board || selected.size === 0) return;
      save({
        ...board,
        nodes: board.nodes.map((n) => {
          if (!selected.has(n.id)) return n;
          const next = { ...n };
          if (color) next.color = color;
          else delete next.color;
          return next;
        }),
      });
    },
    [board, selected, save],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (editing || labelling) return;
    const target = e.target as HTMLElement;
    // Let the node editors and the toolbar handle their own presses.
    if (target.closest("[data-board-ui]")) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const [bx, by] = pointerBoard(e);
    const hit = board ? nodeAt(board.nodes, bx, by) : null;
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;

    // Holding space, middle-clicking, or dragging empty canvas pans.
    if (!hit) {
      if (isMobile || e.button === 1 || e.altKey) {
        gesture.current = {
          kind: "pan",
          startX: e.clientX,
          startY: e.clientY,
          origin: view,
        };
      } else {
        gesture.current = {
          kind: "marquee",
          startX: bx,
          startY: by,
          rect: { x: bx, y: by, width: 0, height: 0 },
        };
      }
      if (!additive) setSelected(new Set());
      forceRender((n) => n + 1);
      return;
    }

    const ids = additive
      ? new Set([...selected, hit.id])
      : selected.has(hit.id)
        ? new Set(selected)
        : new Set([hit.id]);
    setSelected(ids);

    if (isMobile) {
      // Touch: one finger pans, and only a long press picks a node up, so
      // scrolling the Board never drags its contents by accident.
      gesture.current = {
        kind: "pan",
        startX: e.clientX,
        startY: e.clientY,
        origin: view,
      };
      longPress.current = window.setTimeout(() => {
        if (!board) return;
        gesture.current = {
          kind: "move",
          startX: e.clientX,
          startY: e.clientY,
          ids,
          base: board,
          moved: false,
        };
        navigator.vibrate?.(10);
      }, LONG_PRESS_MS);
      return;
    }

    if (board) {
      gesture.current = {
        kind: "move",
        startX: e.clientX,
        startY: e.clientY,
        ids,
        base: board,
        moved: false,
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (g.kind === "none") return;
    if (longPress.current && g.kind === "pan") {
      const far =
        Math.abs(e.clientX - g.startX) > DRAG_SLOP ||
        Math.abs(e.clientY - g.startY) > DRAG_SLOP;
      if (far) {
        window.clearTimeout(longPress.current);
        longPress.current = null;
      }
    }
    if (g.kind === "pan") {
      setView({
        ...g.origin,
        x: g.origin.x - (e.clientX - g.startX) / g.origin.zoom,
        y: g.origin.y - (e.clientY - g.startY) / g.origin.zoom,
      });
      return;
    }
    if (g.kind === "move") {
      const dx = (e.clientX - g.startX) / view.zoom;
      const dy = (e.clientY - g.startY) / view.zoom;
      if (
        !g.moved &&
        Math.abs(e.clientX - g.startX) < DRAG_SLOP &&
        Math.abs(e.clientY - g.startY) < DRAG_SLOP
      ) {
        return;
      }
      g.moved = true;
      // Recomputed from the gesture's starting Board every frame, so a drag
      // is one edit rather than an accumulation of rounding errors.
      setBoard(moveNodes(g.base, g.ids, dx, dy));
      return;
    }
    if (g.kind === "marquee") {
      const [bx, by] = pointerBoard(e);
      g.rect = rectFrom(g.startX, g.startY, bx, by);
      forceRender((n) => n + 1);
      return;
    }
    if (g.kind === "edge") {
      const [bx, by] = pointerBoard(e);
      g.x = bx;
      g.y = by;
      forceRender((n) => n + 1);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (longPress.current) {
      window.clearTimeout(longPress.current);
      longPress.current = null;
    }
    gesture.current = { kind: "none" };
    if (g.kind === "move" && g.moved && board) {
      save(board);
    } else if (g.kind === "move" && !g.moved && isMobile && board) {
      // A tap on touch opens the document rather than selecting it.
      const n = board.nodes.find((x) => g.ids.has(x.id));
      if (n?.type === "file" && n.file) openNode(n);
    } else if (g.kind === "marquee" && board) {
      const picked = nodesIn(board.nodes, g.rect).map((n) => n.id);
      setSelected((prev) =>
        e.shiftKey ? new Set([...prev, ...picked]) : new Set(picked),
      );
    } else if (g.kind === "edge" && board) {
      const [bx, by] = pointerBoard(e);
      const hit = nodeAt(board.nodes, bx, by);
      if (hit && hit.id !== g.from) {
        save({
          ...board,
          edges: [
            ...board.edges,
            { id: newId(), fromNode: g.from, toNode: hit.id },
          ],
        });
      }
    }
    forceRender((n) => n + 1);
  };

  /** Write the Board out as a picture. SVG or PNG by the chosen extension. */
  const exportBoard = useCallback(async () => {
    const svgEl = svgRef.current;
    if (!svgEl || !board) return;
    const path = await saveDialog({
      defaultPath: "board.png",
      filters: [
        { name: "PNG", extensions: ["png"] },
        { name: "SVG", extensions: ["svg"] },
      ],
    });
    if (!path) return;
    const svg = boardToSvg(svgEl, board);
    if (path.toLowerCase().endsWith(".svg")) {
      await api.exportBoard(path, svg, false);
    } else {
      await api.exportBoard(path, await svgToPng(svg), true);
    }
  }, [board]);

  const openNode = useCallback(
    (n: CanvasNode) => {
      if (n.type !== "file" || !n.file) return;
      const doc = byPath.get(n.file);
      if (doc) s.navigate({ kind: "doc", id: doc.id });
    },
    [byPath, s],
  );

  const onWheel = (e: React.WheelEvent) => {
    const r = hostRef.current?.getBoundingClientRect();
    const x = e.clientX - (r?.left ?? 0);
    const y = e.clientY - (r?.top ?? 0);
    if (e.ctrlKey || e.metaKey || !e.shiftKey) {
      setView((v) => zoomAt(v, x, y, e.deltaY < 0 ? 1.12 : 1 / 1.12));
    } else {
      setView((v) => ({ ...v, x: v.x + e.deltaX / v.zoom }));
    }
  };

  // Keyboard: delete removes the selection, escape clears it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing || labelling) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selected.size > 0) {
          e.preventDefault();
          deleteSelected();
        }
      } else if (e.key === "Escape") {
        setSelected(new Set());
      } else if ((e.key === "a" || e.key === "A") && (e.metaKey || e.ctrlKey)) {
        if (board) {
          e.preventDefault();
          setSelected(new Set(board.nodes.map((n) => n.id)));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, deleteSelected, board, editing, labelling]);

  const nodeById = useMemo(
    () => new Map((board?.nodes ?? []).map((n) => [n.id, n])),
    [board],
  );

  if (!board) {
    return <div className="flex-1" aria-busy="true" />;
  }

  const g = gesture.current;
  const empty = board.nodes.length === 0;

  return (
    <div className="relative flex min-h-0 flex-1">
      <div
        ref={hostRef}
        className={cn(
          "relative min-h-0 flex-1 touch-none overflow-hidden bg-muted/30",
          g.kind === "pan" ? "cursor-grabbing" : "cursor-default",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <svg
          ref={svgRef}
          className="absolute inset-0 size-full"
          role="presentation"
          data-testid="board-canvas"
        >
          <defs>
            <marker
              id="board-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground" />
            </marker>
          </defs>
          <g
            transform={`translate(${-view.x * view.zoom} ${-view.y * view.zoom}) scale(${view.zoom})`}
          >
            {/* Groups first: they are backdrops, whatever the array says. */}
            {board.nodes
              .filter((n) => n.type === "group")
              .map((n) => (
                <g key={n.id} data-node-id={n.id}>
                  <rect
                    x={n.x}
                    y={n.y}
                    width={n.width}
                    height={n.height}
                    rx={12}
                    className={cn(
                      "fill-background/40 stroke-2",
                      selected.has(n.id)
                        ? "stroke-primary"
                        : "stroke-border",
                    )}
                    style={
                      colorOf(n.color)
                        ? { stroke: colorOf(n.color)!, fill: `${colorOf(n.color)}14` }
                        : undefined
                    }
                  />
                  <text
                    x={n.x + 12}
                    y={n.y + 22}
                    className="fill-muted-foreground text-[13px] font-medium"
                    style={colorOf(n.color) ? { fill: colorOf(n.color)! } : undefined}
                    onDoubleClick={() => setLabelling(n.id)}
                    data-board-ui
                  >
                    {n.label || t.board_group}
                  </text>
                </g>
              ))}

            {board.edges.map((e) => {
              const from = nodeById.get(e.fromNode);
              const to = nodeById.get(e.toNode);
              if (!from || !to) return null;
              const mid = edgeMidpoint(from, to, e);
              const stroke = colorOf(e.color);
              return (
                <g key={e.id}>
                  <path
                    d={edgePath(from, to, e)}
                    fill="none"
                    className="stroke-muted-foreground/70"
                    style={stroke ? { stroke } : undefined}
                    strokeWidth={2}
                    markerEnd={
                      e.toEnd === "none" ? undefined : "url(#board-arrow)"
                    }
                  />
                  {e.label && (
                    <foreignObject
                      x={mid.x - 70}
                      y={mid.y - 12}
                      width={140}
                      height={24}
                      data-board-ui
                    >
                      <div className="flex h-full items-center justify-center">
                        <span className="truncate rounded bg-background/90 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {e.label}
                        </span>
                      </div>
                    </foreignObject>
                  )}
                </g>
              );
            })}

            {board.nodes
              .filter((n) => n.type !== "group")
              .map((n) => (
                <NodeBox
                  key={n.id}
                  node={n}
                  doc={n.file ? byPath.get(n.file) : undefined}
                  selected={selected.has(n.id)}
                  editing={editing === n.id}
                  onEdit={() => setEditing(n.id)}
                  onEditDone={(text) => {
                    setEditing(null);
                    if (text !== n.text) {
                      save({
                        ...board,
                        nodes: board.nodes.map((x) =>
                          x.id === n.id ? { ...x, text } : x,
                        ),
                      });
                    }
                  }}
                  onOpen={() => openNode(n)}
                  onStartEdge={() => {
                    gesture.current = {
                      kind: "edge",
                      from: n.id,
                      x: n.x + n.width / 2,
                      y: n.y + n.height / 2,
                    };
                    forceRender((v) => v + 1);
                  }}
                  onResize={(width, height) => {
                    save({
                      ...board,
                      nodes: board.nodes.map((x) =>
                        x.id === n.id ? { ...x, width, height } : x,
                      ),
                    });
                  }}
                  missing={!!n.file && !byPath.has(n.file)}
                  t={t}
                  zoom={view.zoom}
                  mobile={isMobile}
                />
              ))}

            {g.kind === "marquee" && (
              <rect
                x={g.rect.x}
                y={g.rect.y}
                width={g.rect.width}
                height={g.rect.height}
                className="fill-primary/10 stroke-primary"
                strokeWidth={1 / view.zoom}
              />
            )}
            {g.kind === "edge" &&
              (() => {
                const from = nodeById.get(g.from);
                if (!from) return null;
                return (
                  <line
                    x1={from.x + from.width / 2}
                    y1={from.y + from.height / 2}
                    x2={g.x}
                    y2={g.y}
                    className="stroke-primary"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                  />
                );
              })()}
          </g>
        </svg>

        {empty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
            <p className="max-w-sm text-center text-sm text-muted-foreground">
              {t.board_empty}
            </p>
          </div>
        )}

        {/* Toolbar. Not on touch: it would sit under the thumb. */}
        <div
          data-board-ui
          className="absolute top-3 left-3 flex flex-wrap items-center gap-1 rounded-md border bg-background/95 p-1 shadow-sm"
        >
          <IconButton
            label={t.board_add_note}
            onClick={() => addNode({ type: "text", text: "" })}
          >
            <Plus />
          </IconButton>
          {!isMobile && (
            <IconButton
              label={t.board_add_group}
              onClick={() =>
                addNode({
                  type: "group",
                  width: 520,
                  height: 360,
                  label: t.board_group,
                })
              }
            >
              <Group />
            </IconButton>
          )}
          <IconButton
            label={t.board_fit}
            onClick={() => setView(fitAll(board.nodes, size.width, size.height))}
          >
            <Maximize />
          </IconButton>
          <IconButton
            label={t.board_zoom_in}
            onClick={() =>
              setView((v) => zoomAt(v, size.width / 2, size.height / 2, 1.2))
            }
          >
            <ZoomIn />
          </IconButton>
          <IconButton
            label={t.board_zoom_out}
            onClick={() =>
              setView((v) => zoomAt(v, size.width / 2, size.height / 2, 1 / 1.2))
            }
          >
            <ZoomOut />
          </IconButton>
          <IconButton
            label={t.board_export}
            disabled={empty}
            onClick={() => void exportBoard()}
          >
            <Download />
          </IconButton>
          <span className="px-1 text-xs tabular-nums text-muted-foreground">
            {Math.round(view.zoom * 100)}%
          </span>
        </div>

        {selected.size > 0 && !isMobile && (
          <div
            data-board-ui
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-md border bg-background/95 p-1 shadow-sm"
          >
            <span className="px-2 text-xs text-muted-foreground">
              {t.board_selected(selected.size)}
            </span>
            <span className="flex items-center gap-0.5" title={t.board_color}>
              <Palette className="mr-0.5 size-3.5 text-muted-foreground" />
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-label={`${t.board_color} ${p}`}
                  className="size-4 rounded-full border"
                  style={{ background: PRESET_HEX[p] }}
                  onClick={() => setColor(p)}
                />
              ))}
              <button
                type="button"
                aria-label={t.board_color_none}
                className="size-4 rounded-full border bg-background"
                onClick={() => setColor(null)}
              />
            </span>
            {selected.size === 1 && (
              <IconButton
                label={t.board_edge_label}
                onClick={() => {
                  const only = [...selected][0];
                  const edge = board.edges.find(
                    (e) => e.fromNode === only || e.toNode === only,
                  );
                  if (edge) setLabelling(edge.id);
                }}
              >
                <Link2 />
              </IconButton>
            )}
            <IconButton
              label={t.delete}
              className="text-muted-foreground hover:text-destructive"
              onClick={deleteSelected}
            >
              <Trash2 />
            </IconButton>
          </div>
        )}

        {labelling && (
          <LabelPrompt
            initial={
              board.edges.find((e) => e.id === labelling)?.label ??
              board.nodes.find((n) => n.id === labelling)?.label ??
              ""
            }
            title={
              board.edges.some((e) => e.id === labelling)
                ? t.board_edge_label
                : t.board_group_label
            }
            onDone={(value) => {
              setLabelling(null);
              if (value === null) return;
              save({
                ...board,
                edges: board.edges.map((e) =>
                  e.id === labelling ? { ...e, label: value } : e,
                ),
                nodes: board.nodes.map((n) =>
                  n.id === labelling ? { ...n, label: value } : n,
                ),
              });
            }}
          />
        )}
      </div>

      {!isMobile && (
        <BoardDrawer
          compositionId={id}
          onAdd={addDocument}
          onPath={(path) => board.nodes.some((n) => n.file === path)}
        />
      )}
    </div>
  );
}

/** One `text` or `file` node. */
function NodeBox({
  node,
  doc,
  selected,
  editing,
  missing,
  zoom,
  mobile,
  t,
  onEdit,
  onEditDone,
  onOpen,
  onStartEdge,
  onResize,
}: {
  node: CanvasNode;
  doc: DocSummary | undefined;
  selected: boolean;
  editing: boolean;
  missing: boolean;
  zoom: number;
  mobile: boolean;
  t: ReturnType<typeof useT>;
  onEdit: () => void;
  onEditDone: (text: string) => void;
  onOpen: () => void;
  onStartEdge: () => void;
  onResize: (width: number, height: number) => void;
}) {
  const accent = colorOf(node.color);
  return (
    <foreignObject
      x={node.x}
      y={node.y}
      width={node.width}
      height={node.height}
      data-node-id={node.id}
      className="overflow-visible"
    >
      <div
        className={cn(
          "flex size-full flex-col overflow-hidden rounded-lg border bg-background p-2.5 text-[13px] shadow-sm",
          selected && "ring-2 ring-primary",
          missing && "border-dashed",
        )}
        style={accent ? { borderColor: accent } : undefined}
      >
        {node.type === "text" ? (
          editing ? (
            <textarea
              data-board-ui
              autoFocus
              defaultValue={node.text ?? ""}
              className="size-full resize-none bg-transparent outline-none"
              onBlur={(e) => onEditDone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  (e.target as HTMLTextAreaElement).blur();
                }
              }}
            />
          ) : (
            <div
              className="thin-scroll size-full overflow-y-auto whitespace-pre-wrap break-words"
              onDoubleClick={onEdit}
            >
              {node.text || (
                <span className="text-muted-foreground">{t.board_note_empty}</span>
              )}
            </div>
          )
        ) : (
          <button
            type="button"
            data-board-ui
            className="flex size-full flex-col items-start gap-1 text-left"
            onClick={mobile ? undefined : onOpen}
          >
            <span className="flex w-full items-center gap-1.5">
              <span
                className={cn(
                  "truncate text-[13px] font-medium",
                  missing && "text-muted-foreground line-through",
                )}
              >
                {doc?.title ?? node.file?.split("/").pop()}
              </span>
            </span>
            <span className="text-[11px] text-muted-foreground">
              {missing
                ? t.board_missing
                : (doc && t.types[doc.type]) + (node.subpath ? ` ${node.subpath}` : "")}
            </span>
            {!missing && (
              <span className="thin-scroll line-clamp-3 overflow-hidden text-[12px] text-muted-foreground">
                {excerptFor(doc, node)}
              </span>
            )}
          </button>
        )}
      </div>
      {selected && !mobile && (
        <>
          {/* Edge handle, on the right face. */}
          <button
            type="button"
            data-board-ui
            aria-label={t.board_draw_edge}
            className="absolute size-3 -translate-y-1/2 rounded-full border-2 border-background bg-primary"
            style={{
              left: node.width - 6,
              top: node.height / 2,
              transform: `scale(${1 / zoom})`,
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onStartEdge();
            }}
          />
          {/* Resize handle, bottom-right. */}
          <button
            type="button"
            data-board-ui
            aria-label={t.board_resize}
            className="absolute size-3 cursor-nwse-resize rounded-sm border bg-background"
            style={{
              left: node.width - 6,
              top: node.height - 6,
              transform: `scale(${1 / zoom})`,
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              const startX = e.clientX;
              const startY = e.clientY;
              const w0 = node.width;
              const h0 = node.height;
              const move = (ev: PointerEvent) => {
                onResize(
                  Math.max(120, Math.round(w0 + (ev.clientX - startX) / zoom)),
                  Math.max(60, Math.round(h0 + (ev.clientY - startY) / zoom)),
                );
              };
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
          />
        </>
      )}
    </foreignObject>
  );
}

/**
 * What a `file` node shows under its title: a Clipping's quote rather than the
 * name the user gave it, a Note's opening line (PLAN §16.12).
 */
function excerptFor(doc: DocSummary | undefined, node: CanvasNode): string {
  if (!doc) return "";
  if (node.subpath) return node.subpath.replace(/^#\^?/, "");
  return "";
}

/** A small prompt for an edge or group label. */
function LabelPrompt({
  initial,
  title,
  onDone,
}: {
  initial: string;
  title: string;
  onDone: (value: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const t = useT();
  return (
    <div
      data-board-ui
      className="absolute inset-x-0 bottom-16 mx-auto flex w-[min(360px,90%)] items-center gap-2 rounded-md border bg-background p-2 shadow-md"
    >
      <Input
        autoFocus
        value={value}
        aria-label={title}
        placeholder={title}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onDone(value);
          if (e.key === "Escape") onDone(null);
        }}
      />
      <Button size="sm" onClick={() => onDone(value)}>
        {t.save}
      </Button>
    </div>
  );
}

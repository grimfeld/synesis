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
  Eye,
  Group,
  Link2,
  Maximize,
  Palette,
  Pencil,
  Plus,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { cn } from "cn";
import {
  api,
  type Board,
  type BoardExcerpt,
  type CanvasNode,
  type DocSummary,
} from "@/lib/api";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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

/**
 * How a Board excerpt is addressed, matching `board_excerpt_key` in the
 * engine: a Board may hold both a whole document and one of its sections, and
 * those two cards do not show the same text.
 */
function excerptKey(path: string, subpath: string | undefined): string {
  return subpath ? `${path}\u0001${subpath}` : path;
}

/** How far a pointer may travel before a press counts as a drag, not a click. */
const DRAG_SLOP = 4;
/** Long-press duration that picks up a node on touch (PLAN §17.15). */
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
  beside = false,
  delivering = false,
  onPeek,
}: {
  /** The Composition the Board belongs to. */
  id: string;
  /** Every document, for resolving `file` nodes to titles and excerpts. */
  docs: DocSummary[];
  /**
   * Shown beside the talk rather than on its own tab (PLAN §22). The editor
   * keeps the focus it had, where on its own tab the Board takes focus so its
   * keys work without a click first. And the Material drawer starts closed:
   * the side panel's Candidates list the same material, and a 288px drawer
   * would leave half a window's Board too narrow to fit its content.
   */
  beside?: boolean;
  /**
   * In the Delivery view (PLAN §23.7-8): always reading, no mode toggle or
   * tools, and a card press calls `onPeek` instead of leaving the view.
   */
  delivering?: boolean;
  /** Show a card's document over the view, at a screen point. */
  onPeek?: (target: string, x: number, y: number) => void;
}) {
  const s = useStore();
  const { announceBoardSaved } = s;
  const t = useT();
  const isMobile = useIsMobile();
  // The Board's own focus scope. Its keys act only while focus is inside it,
  // so Backspace typed in the talk beside it never deletes a node (PLAN §22.6).
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Reading or arranging. Arranging is the default because the Board exists to
  // be laid out; reading is the mode you switch to once it is. In reading mode
  // a press on a card opens its document and nothing moves.
  //
  // This replaces the per-platform rule in PLAN §17.15 (tap opens on touch,
  // click opens on the desktop): a press that both selects and navigates makes
  // a card hard to pick up, and a `file` node rendered as a button was ignored
  // by the canvas entirely, so it could not be dragged at all. One mode answers
  // both platforms, and touch gets the open gesture the desktop has.
  //
  // Reading mode opens the Board for reading too (PLAN §23.6), and the
  // Delivery view never arranges. The toggle still switches for this visit.
  const [reading, setReading] = useState(() => delivering || s.readingMode);
  // Where the last press landed, so a card opened from the keyboard-free
  // button path can still anchor its preview beside itself.
  const lastPress = useRef({ x: 0, y: 0 });
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

  // The Board excerpts, keyed by node path (PLAN §17.12).
  const [excerpts, setExcerpts] = useState<Record<string, BoardExcerpt>>({});

  // What the excerpts were fetched for: every referenced path with the mtime
  // it had. Editing a document *on* the Board changes its mtime and refetches;
  // editing any other document does not, so a keystroke in an unrelated file
  // does not recompute forty excerpts.
  const refsKey = useMemo(() => {
    if (!board) return "";
    return board.nodes
      .filter((n) => n.type === "file" && n.file)
      .map((n) => `${n.file}\u0000${n.subpath ?? ""}\u0000${byPath.get(n.file!)?.mtime ?? 0}`)
      .sort()
      .join("\u0002");
  }, [board, byPath]);

  useEffect(() => {
    if (!refsKey) {
      setExcerpts({});
      return;
    }
    let live = true;
    const refs = refsKey.split("\u0002").map((entry) => {
      const [path, subpath] = entry.split("\u0000");
      return { path, subpath: subpath || null };
    });
    api.boardExcerpts(refs).then((got) => {
      if (live) setExcerpts(got);
    });
    return () => {
      live = false;
    };
  }, [refsKey]);

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

  // Fit on open (PLAN §17.16). The guard is only spent once there is actually
  // something to frame: `board` arrives before `ResizeObserver` has measured
  // the host, and an empty Board must not consume the one chance to fit.
  useEffect(() => {
    if (!board || size.width === 0 || fitted.current === id) return;
    if (board.nodes.length === 0) return;
    fitted.current = id;
    setView(fitAll(board.nodes, size.width, size.height));
  }, [board, size, id]);

  const loaded = board !== null;
  useEffect(() => {
    if (loaded && !beside) rootRef.current?.focus({ preventScroll: true });
  }, [loaded, beside]);

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
    if (p) void api.saveBoard(p.id, p.board).then(announceBoardSaved);
  }, [announceBoardSaved]);

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
    // Capture keeps a drag alive when the pointer leaves the node it started
    // on. It throws if the id is not an active pointer, which a synthetic
    // event has no reason to be, and losing capture is survivable.
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* no capture: the gesture still tracks through the canvas handlers */
    }
    const [bx, by] = pointerBoard(e);
    const hit = board ? nodeAt(board.nodes, bx, by) : null;
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;

    // Reading: every press pans, and releasing without travelling opens
    // whatever was under it. Nothing is selected, so nothing can be moved,
    // resized or deleted by accident — the whole point of the mode.
    if (reading) {
      gesture.current = {
        kind: "pan",
        startX: e.clientX,
        startY: e.clientY,
        origin: view,
      };
      forceRender((n) => n + 1);
      return;
    }

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
    if (reading) {
      // A press that did not travel is a click, so open what is under it.
      // Measured in client pixels, like the drag slop everywhere else, so the
      // threshold means the same thing at every zoom.
      const still =
        g.kind === "pan" &&
        Math.abs(e.clientX - g.startX) < DRAG_SLOP &&
        Math.abs(e.clientY - g.startY) < DRAG_SLOP;
      if (still && board) {
        const [bx, by] = pointerBoard(e);
        const hit = nodeAt(board.nodes, bx, by);
        if (hit) openNode(hit);
      }
      forceRender((n) => n + 1);
      return;
    }
    if (g.kind === "move" && g.moved && board) {
      save(board);
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
      // Delivering, nothing navigates away: the card's document opens over
      // the view instead (PLAN §23.8). A wikilink names a document by its
      // path without the extension, whatever its title.
      if (delivering) {
        onPeek?.(n.file.replace(/\.md$/i, ""), lastPress.current.x, lastPress.current.y);
        return;
      }
      const doc = byPath.get(n.file);
      if (doc) s.navigate({ kind: "doc", id: doc.id });
    },
    [byPath, s, delivering, onPeek],
  );

  const toggleReading = useCallback(() => {
    setReading((r) => {
      if (!r) {
        setSelected(new Set());
        setEditing(null);
        setLabelling(null);
      }
      return !r;
    });
  }, []);

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

  // Keyboard: delete removes the selection, escape clears it. Only while
  // focus is on the Board: beside the talk, the editor is a `contenteditable`
  // that neither check below would recognise, so a window-wide listener would
  // delete nodes on the talk's Backspace and take its select-all (PLAN §22.6).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing || labelling || reading) return;
      const el = document.activeElement;
      if (!rootRef.current?.contains(el)) return;
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
  }, [selected, deleteSelected, board, editing, labelling, reading]);

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
    <div
      ref={rootRef}
      // Focusable so the keys above have somewhere to live; a press anywhere
      // on the Board lands focus here unless it went to a field of its own.
      tabIndex={-1}
      className="relative flex min-h-0 flex-1 outline-none"
      data-testid="board-root"
      onPointerDownCapture={(e) => {
        lastPress.current = { x: e.clientX, y: e.clientY };
        const target = e.target as HTMLElement;
        if (target.closest("input, textarea, button, [contenteditable=true]")) return;
        rootRef.current?.focus({ preventScroll: true });
      }}
    >
      <div
        ref={hostRef}
        className={cn(
          "relative min-h-0 flex-1 touch-none overflow-hidden bg-muted/30",
          g.kind === "pan"
            ? "cursor-grabbing"
            : reading
              ? "cursor-grab"
              : "cursor-default",
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
                    onDoubleClick={reading ? undefined : () => setLabelling(n.id)}
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
                  excerpt={n.file ? excerpts[excerptKey(n.file, n.subpath)] : undefined}
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
                  reading={reading}
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
          {!delivering && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant={reading ? "secondary" : "ghost"}
                aria-pressed={reading}
                aria-label={reading ? t.board_mode_read : t.board_mode_edit}
                data-testid="board-mode"
                className="min-h-8 gap-1.5 px-2"
                onClick={toggleReading}
              >
                {reading ? (
                  <Eye className="size-4 shrink-0" />
                ) : (
                  <Pencil className="size-4 shrink-0" />
                )}
                <span className="text-xs">
                  {reading ? t.board_mode_read : t.board_mode_edit}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-56">
              {reading ? t.board_mode_read_hint : t.board_mode_edit_hint}
            </TooltipContent>
          </Tooltip>
          )}
          {!delivering && <span className="mx-0.5 h-5 w-px bg-border" />}
          {!reading && (
            <IconButton
              label={t.board_add_note}
              onClick={() => addNode({ type: "text", text: "" })}
            >
              <Plus />
            </IconButton>
          )}
          {!isMobile && !reading && (
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
          {!delivering && (
            <IconButton
              label={t.board_export}
              disabled={empty}
              onClick={() => void exportBoard()}
            >
              <Download />
            </IconButton>
          )}
          <span className="px-1 text-xs tabular-nums text-muted-foreground">
            {Math.round(view.zoom * 100)}%
          </span>
        </div>

        {selected.size > 0 && !isMobile && !reading && (
          <div
            data-board-ui
            data-testid="board-selection"
            data-count={selected.size}
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

      {!isMobile && !reading && (
        <BoardDrawer
          compositionId={id}
          onAdd={addDocument}
          onPath={(path) => board.nodes.some((n) => n.file === path)}
          defaultOpen={!beside}
        />
      )}
    </div>
  );
}

/**
 * The body of a `file` node: a button while reading, an inert div while
 * arranging. Two elements rather than one button with a disabled handler,
 * because the canvas decides what a press means by looking for
 * `data-board-ui` on the target — a button that keeps the attribute stays
 * undraggable however its `onClick` is set, and one that keeps its role
 * without the attribute announces itself to a screen reader as something
 * that does nothing.
 */
function FileCard({
  reading,
  label,
  onOpen,
  children,
}: {
  reading: boolean;
  label: string;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  const className = "flex size-full flex-col items-start gap-1 text-left";
  if (!reading) return <div className={className}>{children}</div>;
  return (
    <button
      type="button"
      data-board-ui
      aria-label={label}
      className={cn(className, "cursor-pointer")}
      onClick={onOpen}
    >
      {children}
    </button>
  );
}

/** One `text` or `file` node. */
function NodeBox({
  node,
  doc,
  excerpt,
  selected,
  editing,
  missing,
  reading,
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
  excerpt: BoardExcerpt | undefined;
  selected: boolean;
  editing: boolean;
  missing: boolean;
  reading: boolean;
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
  const { body, status } = cardText(doc, excerpt, missing, t);
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
              onDoubleClick={reading ? undefined : onEdit}
            >
              {node.text || (
                <span className="text-muted-foreground">{t.board_note_empty}</span>
              )}
            </div>
          )
        ) : (
          // A card is a button only while reading. In arranging mode it must
          // be inert: `data-board-ui` makes the canvas ignore the press, and a
          // `file` node carrying it could never be dragged or marquee-picked.
          <FileCard
            reading={reading}
            label={doc?.label ?? node.file ?? ""}
            onOpen={onOpen}
          >
            <span className="flex w-full min-w-0 items-baseline gap-1.5">
              {/* A Clipping's card carries its quote in the body below, and it
                  has no title to head it with (ADR 0013) — repeating the quote
                  here, truncated, would say the same thing twice and worse. */}
              {doc?.type !== "clipping" && (
                <span
                  className={cn(
                    "min-w-0 truncate text-[13px] font-medium",
                    missing && "text-muted-foreground line-through",
                  )}
                >
                  {doc?.title ?? node.file?.split("/").pop()}
                </span>
              )}
              {/* Which part of the document this is. Kept even when the type
                  label goes, because a sectioned card is otherwise
                  indistinguishable from a whole-document one. */}
              {node.subpath && (
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {node.subpath}
                </span>
              )}
            </span>
            {/* The excerpt replaces the type label rather than stacking under
                it: on a 140px card the type is the least valuable row once
                there is real text to show, and prose usually tells you what
                kind of document you are looking at. */}
            {status ? (
              <span
                className={cn(
                  "text-[11px]",
                  missing || excerpt?.subpath_missing
                    ? "text-muted-foreground/90 italic"
                    : "text-muted-foreground",
                )}
              >
                {status}
              </span>
            ) : null}
            {body && (
              <span className="thin-scroll line-clamp-3 overflow-hidden text-[12px] text-muted-foreground">
                {body}
              </span>
            )}
          </FileCard>
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
 * name the user gave it, a Note's opening line (PLAN §17.12).
 */
/**
 * What the card's two text rows say: `body` is the excerpt, `status` the line
 * that takes its place when there is no prose to show.
 *
 * They swap rather than stack (PLAN §17.12, amended): the type label earns its
 * place only when the card would otherwise be a bare title.
 */
function cardText(
  doc: DocSummary | undefined,
  excerpt: BoardExcerpt | undefined,
  missing: boolean,
  t: ReturnType<typeof useT>,
): { body: string; status: string } {
  if (missing) return { body: "", status: t.board_missing };
  const type = doc ? t.types[doc.type] : "";
  // A Subject Hub with nothing to quote falls back to its inbound link count.
  if (!excerpt?.text) {
    const n = excerpt?.mentions;
    return {
      body: "",
      status: n != null ? `${type} · ${t.board_mentions(n)}` : type,
    };
  }
  // A subpath that no longer resolves: show the document's opening text, and
  // say the section is gone rather than passing it off as what was pinned.
  return {
    body: excerpt.text,
    status: excerpt.subpath_missing ? t.board_section_missing : "",
  };
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

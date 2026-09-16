import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { Maximize2, Search, Waypoints } from "lucide-react";
import {
  api,
  type DocType,
  type Graph,
  type GraphLevel,
  type GraphNode,
} from "@/lib/api";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { TypeDot } from "@/components/DocLink";
import { ViewHeader } from "@/components/ViewHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** Capturing a pointer the browser does not know about throws; the drag works without it. */
function capture(el: Element, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    /* synthetic pointer, or already released */
  }
}

/** Same nodes, same edges, same labels — a redraw, not a new layout. */
function sameGraph(a: Graph, b: Graph) {
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length)
    return false;
  for (let i = 0; i < a.nodes.length; i++) {
    const x = a.nodes[i],
      y = b.nodes[i];
    if (x.id !== y.id || x.label !== y.label || x.degree !== y.degree || x.type !== y.type)
      return false;
  }
  for (let i = 0; i < a.edges.length; i++) {
    if (a.edges[i].source !== b.edges[i].source || a.edges[i].target !== b.edges[i].target)
      return false;
  }
  return true;
}

type N = GraphNode & SimulationNodeDatum & { r: number };
type E = SimulationLinkDatum<N>;

const COLORS: Record<DocType, string> = {
  note: "--c-note",
  clipping: "--c-clipping",
  composition: "--c-composition",
  source: "--c-source",
  book: "--c-scripture",
  chapter: "--c-scripture",
  verse: "--c-scripture",
  place: "--c-place",
  character: "--c-character",
  concept: "--c-concept",
  event: "--c-event",
  journey: "--c-journey",
  other: "--c-other",
};
const FILTERABLE: DocType[] = [
  "note",
  "clipping",
  "composition",
  "source",
  "concept",
  "character",
  "place",
  "event",
  "journey",
  "chapter",
];

export function GraphView() {
  const s = useStore();
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [level, setLevel] = useState<GraphLevel>(
    s.settings?.graph_level ?? "chapter",
  );
  const [graph, setGraph] = useState<Graph | null>(null);
  const [hidden, setHidden] = useState<Set<DocType>>(new Set());
  const [query, setQuery] = useState("");
  const sim = useRef<ReturnType<typeof forceSimulation<N>> | null>(null);
  const nodesRef = useRef<N[]>([]);
  const edgesRef = useRef<E[]>([]);
  const view = useRef({ x: 0, y: 0, k: 1 });
  /** The first settled layout frames itself; later ones leave the view alone. */
  const fitted = useRef(false);
  /** Set by any pan, zoom or drag: the view is the reader's from then on. */
  const touched = useRef(false);
  const hover = useRef<N | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  /** Pinch anchor: finger spread, the screen midpoint, and the world point under it. */
  const pinch = useRef<{
    dist: number;
    k: number;
    wx: number;
    wy: number;
  } | null>(null);
  const drag = useRef<{
    node: N | null;
    panning: boolean;
    lx: number;
    ly: number;
    moved: boolean;
  }>({ node: null, panning: false, lx: 0, ly: 0, moved: false });

  useEffect(() => {
    api
      .graph(level)
      .then((g) =>
        // Every save in the vault refetches the graph. Keep the object the render
        // already has when nothing about the shape changed, so the layout is not
        // thrown away and replayed on each keystroke that reaches disk.
        setGraph((prev) => (prev && sameGraph(prev, g) ? prev : g)),
      )
      .catch(console.error);
    api.setGraphLevel(level).catch(() => {});
  }, [level, s.changeTick, s.docs]);

  const visible = useMemo(() => {
    if (!graph) return null;
    const scriptureHidden = hidden.has("chapter");
    const keep = (n: GraphNode) =>
      !hidden.has(n.type) &&
      !(
        scriptureHidden &&
        (n.type === "book" || n.type === "chapter" || n.type === "verse")
      );
    const nodes = graph.nodes.filter(keep);
    const ids = new Set(nodes.map((n) => n.id));
    const edges = graph.edges.filter(
      (e) => ids.has(e.source) && ids.has(e.target),
    );
    return { nodes, edges };
  }, [graph, hidden]);

  // (Re)build the simulation when the visible graph changes; keep positions for known ids.
  useEffect(() => {
    if (!visible) return;
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));
    const nodes: N[] = visible.nodes.map((n) => {
      const old = prev.get(n.id);
      return {
        ...n,
        x: old?.x,
        y: old?.y,
        vx: 0,
        vy: 0,
        r: 3 + Math.min(12, Math.sqrt(n.degree) * 2),
      };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges: E[] = visible.edges.map((e) => ({
      source: byId.get(e.source)!,
      target: byId.get(e.target)!,
    }));
    nodesRef.current = nodes;
    edgesRef.current = edges;
    if (prev.size === 0) fitted.current = false;
    sim.current?.stop();
    const c = canvas.current!;
    const w = c.clientWidth,
      h = c.clientHeight;
    sim.current = forceSimulation<N>(nodes)
      .force(
        "link",
        forceLink<N, E>(edges)
          .id((d) => d.id)
          .distance(40)
          .strength(0.4),
      )
      // Repulsion has to stop somewhere: unbounded, the nodes with no edge feel
      // nothing but the push of every other node and drift off the canvas forever.
      .force("charge", forceManyBody().strength(-90).distanceMax(320))
      .force("center", forceCenter(w / 2, h / 2))
      // Gravity back towards the middle. It is what holds the orphans in view once
      // repulsion has faded with distance, and it lets the layout come to rest.
      .force("x", forceX<N>(w / 2).strength(0.045))
      .force("y", forceY<N>(h / 2).strength(0.045))
      .force(
        "collide",
        forceCollide<N>((d) => d.r + 4),
      )
      // Settle in a few seconds and then stay put: a graph that never stops moving
      // cannot be read, and the canvas would repaint for as long as the view is open.
      .alphaDecay(0.05)
      .alphaMin(0.02)
      .velocityDecay(0.55)
      // A first layout starts hot; a graph that only gained or lost a few nodes is
      // nudged instead, so the rest of the picture stays where the reader left it.
      .alpha(prev.size ? 0.35 : 1)
      .on("tick", schedule)
      .on("end", () => {
        // The first layout lands wherever the forces put it; frame it once so the
        // graph opens readable instead of somewhere off the side of the canvas.
        if (!fitted.current && !touched.current) {
          fitted.current = true;
          fitView();
        }
        schedule();
      });
    return () => {
      sim.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // getComputedStyle costs a style flush; calling it per node per frame is what
  // makes the graph stutter. Resolve every colour once, and again on theme change.
  const palette = useRef<Record<string, string>>({});
  const readPalette = useCallback(() => {
    const cs = getComputedStyle(document.documentElement);
    const out: Record<string, string> = {};
    for (const name of [
      ...new Set(Object.values(COLORS)),
      "--foreground",
      "--muted-foreground",
      "--background",
      "--font-sans",
    ])
      out[name] = cs.getPropertyValue(name).trim();
    palette.current = out;
  }, []);
  const cssVar = (name: string) => palette.current[name] ?? "";

  const frame = useRef(0);
  /** Coalesce redraws onto one animation frame; d3 ticks faster than the display. */
  function schedule() {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      draw();
    });
  }

  function draw() {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth,
      h = c.clientHeight;
    if (c.width !== w * dpr || c.height !== h * dpr) {
      c.width = w * dpr;
      c.height = h * dpr;
    }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const { x, y, k } = view.current;
    ctx.translate(x, y);
    ctx.scale(k, k);
    const fg = cssVar("--foreground");
    const edge = cssVar("--muted-foreground");
    const q = query.trim().toLowerCase();
    const hov = hover.current;
    const neigh = new Set<string>();
    if (hov)
      for (const e of edgesRef.current) {
        const a = e.source as N,
          b = e.target as N;
        if (a.id === hov.id) neigh.add(b.id);
        if (b.id === hov.id) neigh.add(a.id);
      }
    ctx.lineWidth = 1 / k;
    for (const e of edgesRef.current) {
      const a = e.source as N,
        b = e.target as N;
      const lit = hov && (a.id === hov.id || b.id === hov.id);
      ctx.strokeStyle = lit ? fg : edge;
      ctx.globalAlpha = lit ? 0.9 : hov ? 0.08 : 0.3;
      ctx.beginPath();
      ctx.moveTo(a.x!, a.y!);
      ctx.lineTo(b.x!, b.y!);
      ctx.stroke();
    }
    for (const n of nodesRef.current) {
      const match = q && n.label.toLowerCase().includes(q);
      const dim = (hov && n.id !== hov.id && !neigh.has(n.id)) || (q && !match);
      ctx.globalAlpha = dim ? 0.3 : 1;
      ctx.fillStyle = cssVar(COLORS[n.type]);
      ctx.beginPath();
      ctx.arc(n.x!, n.y!, n.r, 0, Math.PI * 2);
      ctx.fill();
      if (n.doc_id === null) {
        ctx.strokeStyle = cssVar("--background");
        ctx.lineWidth = 1.5 / k;
        ctx.stroke();
      }
    }
    drawLabels(ctx, { w, h, k, fg, hov, neigh, q });
    ctx.globalAlpha = 1;
    ctx.globalAlpha = 1;
  }

  /** Frame the whole graph in the canvas, with a little room around it. */
  const fitView = useCallback(() => {
    touched.current = false;
    const c = canvas.current;
    const nodes = nodesRef.current;
    if (!c || nodes.length === 0) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) {
      if (n.x == null || n.y == null) continue;
      x0 = Math.min(x0, n.x - n.r);
      y0 = Math.min(y0, n.y - n.r);
      x1 = Math.max(x1, n.x + n.r);
      y1 = Math.max(y1, n.y + n.r);
    }
    if (!Number.isFinite(x0)) return;
    const w = c.clientWidth, h = c.clientHeight;
    const pad = 48;
    const k = Math.max(0.2, Math.min(2, Math.min((w - pad * 2) / Math.max(1, x1 - x0), (h - pad * 2) / Math.max(1, y1 - y0))));
    view.current = {
      k,
      x: w / 2 - ((x0 + x1) / 2) * k,
      y: h / 2 - ((y0 + y1) / 2) * k,
    };
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Labels are drawn at a fixed size on screen, so zooming out packs more of them
   * into the same pixels. Name the most connected nodes first and drop any label
   * whose box would land on one already drawn: the view thins itself out as it
   * shrinks, without a label ever sitting on top of another.
   */
  function drawLabels(
    ctx: CanvasRenderingContext2D,
    o: { w: number; h: number; k: number; fg: string; hov: N | null; neigh: Set<string>; q: string },
  ) {
    const { w, h, k, fg, hov, neigh, q } = o;
    // Text keeps a readable size on screen but is allowed to shrink a little as the
    // view pulls back, so the names never dwarf the graph they belong to.
    const size = Math.max(7, Math.min(11, 11 * Math.pow(k, 0.35)));
    ctx.font = `${size / k}px ${cssVar("--font-sans") || "sans-serif"}`;
    ctx.textAlign = "center";
    ctx.fillStyle = fg;
    const v = view.current;
    // Everything below is in screen pixels, where "does it overlap" means what the
    // reader sees rather than what the layout happens to measure at this zoom.
    const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const order = [...nodesRef.current].sort((a, b) => b.degree - a.degree);
    for (const n of order) {
      const match = q ? n.label.toLowerCase().includes(q) : false;
      const forced = (hov && (n.id === hov.id || neigh.has(n.id))) || match;
      // An isolated node names itself only when the view is close enough to read it.
      if (!forced && n.degree === 0 && k < 1.2) continue;
      // Far out the dots are a few pixels wide: naming them all buries the shape of
      // the graph under its own text, so only the hubs keep a name.
      if (!forced && n.r * k < 3 && n.degree < 4) continue;
      const sx = n.x! * k + v.x;
      const sy = (n.y! + n.r) * k + v.y + size;
      if (!forced && (sx < -80 || sy < -20 || sx > w + 80 || sy > h + 20)) continue;
      const half = (ctx.measureText(n.label).width * k) / 2;
      // Padding is what keeps two labels from touching rather than merely not
      // overlapping; at a glance, touching reads as one unreadable run of text.
      const box = { x0: sx - half - 5, y0: sy - size - 3, x1: sx + half + 5, y1: sy + 5 };
      if (!forced && taken.some((t) => box.x0 < t.x1 && box.x1 > t.x0 && box.y0 < t.y1 && box.y1 > t.y0)) continue;
      taken.push(box);
      const dim = (hov && n.id !== hov.id && !neigh.has(n.id)) || (q && !match);
      ctx.globalAlpha = forced ? 1 : dim ? 0.3 : 1;
      ctx.fillText(n.label, n.x!, n.y! + n.r + size / k);
    }
  }

  // The canvas backing store follows its CSS box; without this a rotation or a
  // keyboard opening leaves the last frame stretched, and hit-testing with it.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ro = new ResizeObserver(() => schedule());
    ro.observe(c);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    readPalette();
    const ob = new MutationObserver(() => {
      readPalette();
      schedule();
    });
    ob.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    return () => ob.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readPalette]);

  useEffect(() => {
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const toWorld = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    const { x, y, k } = view.current;
    return { x: (e.clientX - r.left - x) / k, y: (e.clientY - r.top - y) / k };
  };
  const nodeAt = (p: { x: number; y: number }) => {
    let best: N | null = null,
      bd = Infinity;
    for (const n of nodesRef.current) {
      const d = Math.hypot(n.x! - p.x, n.y! - p.y);
      if (d < n.r + 4 && d < bd) {
        best = n;
        bd = d;
      }
    }
    return best;
  };

  /** Finger spread, screen midpoint and the world point under it, right now. */
  const pinchState = () => {
    const [a, b] = [...touches.current.values()];
    if (!a || !b) return null;
    const r = canvas.current!.getBoundingClientRect();
    const mx = (a.x + b.x) / 2 - r.left;
    const my = (a.y + b.y) / 2 - r.top;
    const v = view.current;
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      k: v.k,
      mx,
      my,
      wx: (mx - v.x) / v.k,
      wy: (my - v.y) / v.k,
    };
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (canvas.current) capture(canvas.current, e.pointerId);
    if (touches.current.size === 2) {
      // A second finger turns the gesture into a pinch: drop the drag.
      const d = drag.current;
      if (d.node) {
        d.node.fx = null;
        d.node.fy = null;
        sim.current?.alphaTarget(0);
      }
      drag.current = { node: null, panning: false, lx: 0, ly: 0, moved: true };
      pinch.current = pinchState();
      return;
    }
    pinch.current = null;
    const p = toWorld(e);
    const n = nodeAt(p);
    drag.current = {
      node: n,
      panning: !n,
      lx: e.clientX,
      ly: e.clientY,
      moved: false,
    };
    if (n) {
      n.fx = n.x;
      n.fy = n.y;
      sim.current?.alphaTarget(0.3).restart();
    }
  };
  const onMove = (e: React.PointerEvent) => {
    if (touches.current.has(e.pointerId))
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p0 = pinch.current;
    if (p0 && touches.current.size === 2) {
      const now = pinchState();
      if (!now || now.dist < 1 || p0.dist < 1) return;
      const v = view.current;
      touched.current = true;
      const nk = Math.max(0.2, Math.min(5, p0.k * (now.dist / p0.dist)));
      // Keep the world point that was under the midpoint pinned to it.
      v.x = now.mx - p0.wx * nk;
      v.y = now.my - p0.wy * nk;
      v.k = nk;
      schedule();
      return;
    }
    const d = drag.current;
    if (d.node) {
      const p = toWorld(e);
      d.node.fx = p.x;
      d.node.fy = p.y;
      d.moved = true;
    } else if (d.panning) {
      touched.current = true;
      view.current.x += e.clientX - d.lx;
      view.current.y += e.clientY - d.ly;
      d.lx = e.clientX;
      d.ly = e.clientY;
      d.moved = true;
      schedule();
    } else if (e.pointerType === "mouse") {
      const n = nodeAt(toWorld(e));
      if (n !== hover.current) {
        hover.current = n;
        canvas.current!.style.cursor = n ? "pointer" : "grab";
        schedule();
      }
    }
  };
  const onUp = (e?: React.PointerEvent) => {
    if (e) touches.current.delete(e.pointerId);
    else touches.current.clear();
    if (touches.current.size < 2) pinch.current = null;
    if (touches.current.size > 0) return;
    const d = drag.current;
    if (d.node) {
      d.node.fx = null;
      d.node.fy = null;
      sim.current?.alphaTarget(0);
      if (!d.moved) openNode(d.node);
    }
    // A touch leaves no pointer behind: drop the highlight so it does not stick.
    if (e && e.pointerType !== "mouse" && hover.current) {
      hover.current = null;
      schedule();
    }
    drag.current = { node: null, panning: false, lx: 0, ly: 0, moved: false };
  };
  const onWheel = (e: React.WheelEvent) => {
    touched.current = true;
    const r = canvas.current!.getBoundingClientRect();
    const mx = e.clientX - r.left,
      my = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * 0.0015);
    const v = view.current;
    const nk = Math.max(0.2, Math.min(5, v.k * f));
    v.x = mx - ((mx - v.x) * nk) / v.k;
    v.y = my - ((my - v.y) * nk) / v.k;
    v.k = nk;
    schedule();
  };
  const openNode = (n: N) => {
    if (n.doc_id) return s.openDoc(n.doc_id);
    const m = /^s:(\d+)(?::(\d+))?(?::(\d+))?$/.exec(n.id);
    if (m)
      s.openScripture(
        Number(m[1]),
        m[2] ? Number(m[2]) : undefined,
        m[3] ? Number(m[3]) : undefined,
      );
  };

  const shown = FILTERABLE.filter((ty) => !hidden.has(ty));

  return (
    <div className="flex h-full flex-col">
      <ViewHeader
        title={t.views.graph}
        icon={<Waypoints />}
        className="h-auto min-h-12 flex-wrap gap-y-1.5 py-1.5"
      >
        <div className="relative ml-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-7 w-44 pl-7 text-xs"
            placeholder={t.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select value={level} onValueChange={(v) => setLevel(v as GraphLevel)}>
          <SelectTrigger
            size="sm"
            className="h-7 text-xs"
            aria-label={t.graph_level}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="book">{t.types.book}</SelectItem>
            <SelectItem value="chapter">{t.types.chapter}</SelectItem>
            <SelectItem value="verse">{t.types.verse}</SelectItem>
          </SelectContent>
        </Select>
        <ToggleGroup
          type="multiple"
          value={shown}
          onValueChange={(v) =>
            setHidden(new Set(FILTERABLE.filter((ty) => !v.includes(ty))))
          }
          variant="outline"
          size="sm"
          spacing={1}
          className="ml-1 flex-wrap"
        >
          {FILTERABLE.map((ty) => (
            <ToggleGroupItem
              key={ty}
              value={ty}
              className="h-7 gap-1.5 text-xs data-[state=off]:opacity-45"
            >
              <TypeDot type={ty} />
              {ty === "chapter" ? t.scripture : t.types_plural[ty]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button
          size="icon-sm"
          variant="outline"
          className="ml-1"
          aria-label={t.zoom_fit}
          data-testid="graph-fit"
          onClick={fitView}
        >
          <Maximize2 />
        </Button>
        <Badge
          data-testid="graph-counts"
          variant="secondary"
          className="ml-auto tabular-nums"
        >
          {visible?.nodes.length ?? 0} · {visible?.edges.length ?? 0}
        </Badge>
      </ViewHeader>
      <canvas
        data-testid="graph-canvas"
        ref={canvas}
        className="min-h-0 flex-1"
        style={{
          cursor: "grab",
          width: "100%",
          height: "100%",
          // The browser must not steal the drag for scrolling or its own zoom.
          touchAction: "none",
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={(e) => e.pointerType === "mouse" && onUp(e)}
        onWheel={onWheel}
      />
    </div>
  );
}

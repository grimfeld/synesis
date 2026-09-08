import { useEffect, useMemo, useRef, useState } from "react";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { api, type DocType, type Graph, type GraphLevel, type GraphNode } from "@/lib/api";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { TypeDot } from "@/components/DocLink";

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
  other: "--c-other",
};
const FILTERABLE: DocType[] = ["note", "clipping", "composition", "source", "concept", "character", "place", "chapter"];

export function GraphView() {
  const s = useStore();
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [level, setLevel] = useState<GraphLevel>(s.settings?.graph_level ?? "chapter");
  const [graph, setGraph] = useState<Graph | null>(null);
  const [hidden, setHidden] = useState<Set<DocType>>(new Set());
  const [query, setQuery] = useState("");
  const sim = useRef<ReturnType<typeof forceSimulation<N>> | null>(null);
  const nodesRef = useRef<N[]>([]);
  const edgesRef = useRef<E[]>([]);
  const view = useRef({ x: 0, y: 0, k: 1 });
  const hover = useRef<N | null>(null);
  const drag = useRef<{ node: N | null; panning: boolean; lx: number; ly: number; moved: boolean }>({ node: null, panning: false, lx: 0, ly: 0, moved: false });

  useEffect(() => {
    api.graph(level).then(setGraph).catch(console.error);
    api.setGraphLevel(level).catch(() => {});
  }, [level, s.changeTick, s.docs]);

  const visible = useMemo(() => {
    if (!graph) return null;
    const scriptureHidden = hidden.has("chapter");
    const keep = (n: GraphNode) => !hidden.has(n.type) && !(scriptureHidden && (n.type === "book" || n.type === "chapter" || n.type === "verse"));
    const nodes = graph.nodes.filter(keep);
    const ids = new Set(nodes.map((n) => n.id));
    const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    return { nodes, edges };
  }, [graph, hidden]);

  // (Re)build the simulation when the visible graph changes; keep positions for known ids.
  useEffect(() => {
    if (!visible) return;
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));
    const nodes: N[] = visible.nodes.map((n) => {
      const old = prev.get(n.id);
      return { ...n, x: old?.x, y: old?.y, vx: 0, vy: 0, r: 3 + Math.min(12, Math.sqrt(n.degree) * 2) };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges: E[] = visible.edges.map((e) => ({ source: byId.get(e.source)!, target: byId.get(e.target)! }));
    nodesRef.current = nodes;
    edgesRef.current = edges;
    sim.current?.stop();
    const c = canvas.current!;
    const w = c.clientWidth,
      h = c.clientHeight;
    sim.current = forceSimulation<N>(nodes)
      .force("link", forceLink<N, E>(edges).id((d) => d.id).distance(40).strength(0.4))
      .force("charge", forceManyBody().strength(-90))
      .force("center", forceCenter(w / 2, h / 2))
      .force("collide", forceCollide<N>((d) => d.r + 4))
      .alpha(1)
      .on("tick", draw);
    return () => {
      sim.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

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
    const fg = cssVar("--fg");
    const q = query.trim().toLowerCase();
    const hov = hover.current;
    const neigh = new Set<string>();
    if (hov) for (const e of edgesRef.current) {
      const a = e.source as N, b = e.target as N;
      if (a.id === hov.id) neigh.add(b.id);
      if (b.id === hov.id) neigh.add(a.id);
    }
    ctx.lineWidth = 1 / k;
    for (const e of edgesRef.current) {
      const a = e.source as N, b = e.target as N;
      const lit = hov && (a.id === hov.id || b.id === hov.id);
      ctx.strokeStyle = lit ? fg : cssVar("--border");
      ctx.globalAlpha = hov && !lit ? 0.25 : 1;
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
        ctx.strokeStyle = cssVar("--bg");
        ctx.lineWidth = 1.5 / k;
        ctx.stroke();
      }
      if (n.r >= 6 || k > 1.6 || (hov && (n.id === hov.id || neigh.has(n.id))) || match) {
        ctx.fillStyle = fg;
        ctx.font = `${Math.max(9, 11 / k)}px -apple-system, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(n.label, n.x!, n.y! + n.r + 11 / k);
      }
    }
    ctx.globalAlpha = 1;
  }

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const toWorld = (e: React.MouseEvent) => {
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

  const onDown = (e: React.MouseEvent) => {
    const p = toWorld(e);
    const n = nodeAt(p);
    drag.current = { node: n, panning: !n, lx: e.clientX, ly: e.clientY, moved: false };
    if (n) {
      n.fx = n.x;
      n.fy = n.y;
      sim.current?.alphaTarget(0.3).restart();
    }
  };
  const onMove = (e: React.MouseEvent) => {
    const d = drag.current;
    if (d.node) {
      const p = toWorld(e);
      d.node.fx = p.x;
      d.node.fy = p.y;
      d.moved = true;
    } else if (d.panning) {
      view.current.x += e.clientX - d.lx;
      view.current.y += e.clientY - d.ly;
      d.lx = e.clientX;
      d.ly = e.clientY;
      d.moved = true;
      draw();
    } else {
      const n = nodeAt(toWorld(e));
      if (n !== hover.current) {
        hover.current = n;
        canvas.current!.style.cursor = n ? "pointer" : "grab";
        draw();
      }
    }
  };
  const onUp = () => {
    const d = drag.current;
    if (d.node) {
      d.node.fx = null;
      d.node.fy = null;
      sim.current?.alphaTarget(0);
      if (!d.moved) openNode(d.node);
    }
    drag.current = { node: null, panning: false, lx: 0, ly: 0, moved: false };
  };
  const onWheel = (e: React.WheelEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const mx = e.clientX - r.left,
      my = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * 0.0015);
    const v = view.current;
    const nk = Math.max(0.2, Math.min(5, v.k * f));
    v.x = mx - ((mx - v.x) * nk) / v.k;
    v.y = my - ((my - v.y) * nk) / v.k;
    v.k = nk;
    draw();
  };
  const openNode = (n: N) => {
    if (n.doc_id) return s.openDoc(n.doc_id);
    const m = /^s:(\d+)(?::(\d+))?(?::(\d+))?$/.exec(n.id);
    if (m) s.openScripture(Number(m[1]), m[2] ? Number(m[2]) : undefined, m[3] ? Number(m[3]) : undefined);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
        {!s.sidebarOpen && (
          <button className="btn btn-ghost btn-sm" onClick={() => s.setSidebarOpen(true)}>
            ☰
          </button>
        )}
        <h1 className="text-base font-semibold">{t.views.graph}</h1>
        <input className="w-40 py-1 text-sm" placeholder={t.search} value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="muted ml-2 text-xs">{t.graph_level}</label>
        <select className="py-1 text-sm" value={level} onChange={(e) => setLevel(e.target.value as GraphLevel)}>
          <option value="book">{t.types.book}</option>
          <option value="chapter">{t.types.chapter}</option>
          <option value="verse">{t.types.verse}</option>
        </select>
        <div className="ml-2 flex flex-wrap gap-1">
          {FILTERABLE.map((ty) => (
            <button
              key={ty}
              className={`btn btn-sm ${hidden.has(ty) ? "opacity-40" : ""}`}
              onClick={() =>
                setHidden((h) => {
                  const n = new Set(h);
                  n.has(ty) ? n.delete(ty) : n.add(ty);
                  return n;
                })
              }
            >
              <TypeDot type={ty} />
              {ty === "chapter" ? t.scripture : t.types_plural[ty]}
            </button>
          ))}
        </div>
        <span className="muted ml-auto text-xs">
          {visible?.nodes.length ?? 0} · {visible?.edges.length ?? 0}
        </span>
      </header>
      <canvas ref={canvas} className="min-h-0 flex-1" style={{ cursor: "grab", width: "100%", height: "100%" }} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} onWheel={onWheel} />
    </div>
  );
}

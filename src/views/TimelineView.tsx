// Timeline: every dated thing along the Bible's chronology (PLAN §14).
// Events lane on top, then one lane per Subject carrying at least one Date.
// A span (start+end, born+died) is a bar; any other Date Property is a mark
// labelled by its key; an Event is also drawn on the lanes of the Characters
// and Place it names. Wheel / pinch zooms around the cursor, drag pans.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { CalendarRange, Maximize2, Plus, Search, ZoomIn, ZoomOut } from "lucide-react";
import { api } from "@/lib/api";
import {
  activeCount,
  buildLanes,
  cullToView,
  extentOf,
  filterRows,
  formatYear,
  niceStep,
  placeMarks,
  propertyNames,
  resolveLabels,
  type Lane,
  type Placed,
} from "@/lib/timeline";
import { useQuery } from "@/lib/useQuery";
import { TimelineFilters } from "@/components/TimelineFilters";
import { Input } from "@/components/ui/input";
import { useStore } from "@/lib/store";
import { propertyLabel, useT } from "@/i18n";
import { ViewHeader } from "@/components/ViewHeader";
import { Button } from "@/components/ui/button";
import { TypeDot } from "@/components/DocLink";

const GUTTER_WIDE = 150;
const GUTTER_NARROW = 84; // a phone cannot spare 150px of lane labels
const RIGHT_PAD = 24;
const AXIS_H = 36;
const LANE_H = 34;

/** Roughly how wide an 11px label draws, without measuring the SVG text. */
const labelWidth = (label: string) => label.length * 5.7;

/** Capturing a pointer the browser does not know about throws; the drag works without it. */
function capture(el: Element, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    /* synthetic pointer, or already released */
  }
}

/** The members of a Cluster, listed where the pointer met it (PLAN §16.7). */
function ClusterCard({
  state,
  onZoom,
  onClose,
}: {
  state: { p: Placed; x: number; y: number };
  onZoom: () => void;
  onClose: () => void;
}) {
  const s = useStore();
  const t = useT();
  const left = Math.max(8, Math.min(state.x - 100, window.innerWidth - 232));
  const top = Math.min(state.y + 10, window.innerHeight - 200);
  return (
    <div
      data-testid="tl-cluster-card"
      className="fixed z-50 w-56 rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg"
      style={{ left, top }}
      onPointerLeave={onClose}
    >
      <ul className="thin-scroll max-h-40 overflow-auto">
        {state.p.marks.map((m) => (
          <li key={m.key}>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-accent"
              onClick={() => {
                onClose();
                s.openDoc(m.doc.id);
              }}
            >
              <TypeDot type={m.type} />
              <span className="truncate">{m.label}</span>
              <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                {m.text}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Button
        size="sm"
        variant="ghost"
        className="mt-1 h-7 w-full text-xs"
        onClick={() => {
          onClose();
          onZoom();
        }}
      >
        <ZoomIn />
        {t.zoom_to_these}
      </Button>
    </div>
  );
}

export function TimelineView() {
  const s = useStore();
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [range, setRange] = useState<[number, number] | null>(null);
  const drag = useRef<{ x: number; from: number; to: number } | null>(null);
  // Live touch points, so a second finger turns the drag into a pinch.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; from: number; to: number } | null>(null);

  // Any Subject may carry a Date and any document may Tag one, so the Lanes
  // move with the whole vault. Three reads that have to agree with each
  // other, so they are one query and arrive together.
  const { data } = useQuery({
    key: [],
    deps: { any: true },
    fetch: async () => {
      const [rows, links, docTags] = await Promise.all([
        api.timeline(),
        api.eventLinks(),
        api.timelineTags(),
      ]);
      return { rows, links, docTags };
    },
  });
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const links = useMemo(() => data?.links ?? [], [data]);
  const docTags = useMemo(() => data?.docTags ?? [], [data]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const f = s.timelineFilters;
  const tagsByDoc = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const dt of docTags) m.set(dt.doc, [...(m.get(dt.doc) ?? []), dt.tag]);
    return m;
  }, [docTags]);
  const label = useCallback((name: string) => propertyLabel(name, t), [t]);
  const allLanes = useMemo(
    () => buildLanes(rows, links, t.events, label),
    [rows, links, t.events, label],
  );
  const matched = useMemo(
    () => buildLanes(filterRows(rows, f, tagsByDoc), links, t.events, label),
    [rows, f, tagsByDoc, links, t.events, label],
  );
  // The extent ignores the filters, so narrowing them does not move the view.
  const extent = useMemo(() => extentOf(allLanes), [allLanes]);
  const [from, to] = range ?? extent;
  const GUTTER = width < 520 ? GUTTER_NARROW : GUTTER_WIDE;
  const plotW = Math.max(200, width - GUTTER - RIGHT_PAD);
  const x = useCallback(
    (y: number) => GUTTER + ((y - from) / (to - from)) * plotW,
    [from, to, plotW, GUTTER],
  );
  const yearAt = (px: number) => from + ((px - GUTTER) / plotW) * (to - from);

  const zoom = useCallback(
    (factor: number, aroundYear?: number) => {
      const center = aroundYear ?? (from + to) / 2;
      let span = (to - from) * factor;
      const full = extent[1] - extent[0];
      span = Math.min(Math.max(span, 1), full * 4);
      const left = center - (center - from) * (span / (to - from));
      setRange([left, left + span]);
    },
    [from, to, extent],
  );

  const onWheel = (e: ReactWheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const factor = Math.exp(e.ctrlKey ? e.deltaY * 0.01 : e.deltaY * 0.0015);
    zoom(factor, px >= GUTTER ? yearAt(px) : undefined);
  };
  /** The plot x of a pointer, and the two-finger midpoint / spread when pinching. */
  const spread = () => {
    const [a, b] = [...touches.current.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: (a.x + b.x) / 2 };
  };
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    capture(e.currentTarget, e.pointerId);
    if (touches.current.size === 2) {
      drag.current = null;
      pinch.current = { dist: spread().dist, from, to };
    } else {
      pinch.current = null;
      drag.current = { x: e.clientX, from, to };
    }
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (touches.current.has(e.pointerId))
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pinch.current;
    if (p && touches.current.size === 2) {
      const { dist, mid } = spread();
      if (dist < 1) return;
      const span = Math.min(
        Math.max((p.to - p.from) * (p.dist / dist), 1),
        (extent[1] - extent[0]) * 4,
      );
      const rect = e.currentTarget.getBoundingClientRect();
      const px = Math.max(mid - rect.left, GUTTER);
      const center = p.from + ((px - GUTTER) / plotW) * (p.to - p.from);
      const left = center - ((center - p.from) * span) / (p.to - p.from);
      setRange([left, left + span]);
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dy = ((e.clientX - d.x) / plotW) * (d.to - d.from);
    setRange([d.from - dy, d.to - dy]);
  };
  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    touches.current.delete(e.pointerId);
    pinch.current = null;
    // The finger still down keeps panning from where it now is.
    const [rest] = [...touches.current.values()];
    drag.current = rest ? { x: rest.x, from, to } : null;
  };

  // Cluster members shown on hover, or on tap where there is no hover.
  const [card, setCard] = useState<{ p: Placed; x: number; y: number } | null>(
    null,
  );
  const placedFor = useCallback(
    (lane: Lane) =>
      resolveLabels(placeMarks(lane.marks, x), labelWidth, GUTTER + plotW),
    [x, GUTTER, plotW],
  );
  const showCard = (p: Placed, cx: number, cy: number) =>
    setCard(p.marks.length > 1 ? { p, x: cx, y: cy } : null);
  /** Zoom to a Cluster's own extent, which splits it unless the Dates are identical. */
  const zoomToCluster = useCallback(
    (p: Placed) => {
      const ys = p.marks.map((m) => m.from);
      const lo = Math.min(...ys);
      const hi = Math.max(...ys);
      const span = Math.max((hi - lo) * 3, 1);
      const mid = (lo + hi) / 2;
      setRange([mid - span / 2, mid + span / 2]);
    },
    [],
  );

  // The cull comes last, so it narrows what the other filters already matched.
  const lanes = useMemo(
    () => (f.inView ? cullToView(matched, from, to) : matched),
    [matched, f.inView, from, to],
  );
  const filtered = activeCount(f) > 0;
  const tagChips = useMemo(
    () => [...new Set(docTags.map((d) => d.tag))],
    [docTags],
  );
  const propChips = useMemo(() => propertyNames(rows), [rows]);

  const step = niceStep(to - from, plotW);
  const ticks: number[] = [];
  for (let y = Math.ceil(from / step) * step; y <= to; y += step) ticks.push(y);
  // A floor of three Lanes' worth, so an empty result still leaves a plot the
  // user can pan and zoom back to where the Lanes are.
  const height = AXIS_H + Math.max(lanes.length, 3) * LANE_H + 8;
  const eraLabels = { bce: t.bce, ce: t.ce };

  return (
    <div className="flex h-full flex-col">
      <ViewHeader title={t.views.timeline} icon={<CalendarRange />}>
        <span className="hidden truncate text-xs text-muted-foreground md:inline">
          {lanes.length === 0 ? t.no_timeline : t.timeline_hint}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <div className="relative hidden lg:block">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              data-testid="tl-search"
              value={f.search}
              onChange={(e) =>
                s.setTimelineFilters({ ...f, search: e.currentTarget.value })
              }
              placeholder={t.tl_filter_search}
              className="h-8 w-40 pl-7 text-xs"
            />
          </div>
          <TimelineFilters
            filters={f}
            onChange={s.setTimelineFilters}
            tags={tagChips}
            props={propChips}
            typeLabel={(ty) => t.types_plural[ty] ?? ty}
          />
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={t.zoom_in}
            onClick={() => zoom(0.5)}
          >
            <ZoomIn />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={t.zoom_out}
            onClick={() => zoom(2)}
          >
            <ZoomOut />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={t.zoom_fit}
            onClick={() => setRange(null)}
          >
            <Maximize2 />
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label={t.types.event}
            onClick={() => s.setDialog({ kind: "new", type: "event" })}
          >
            <Plus />
            {/* Icon-only below 360px: beside four icon buttons, "Événement"
                pushes the row past the smallest phones. */}
            <span className="hidden min-[360px]:inline">{t.types.event}</span>
          </Button>
        </div>
      </ViewHeader>
      <div
        ref={host}
        data-testid="timeline"
        className="thin-scroll relative min-h-0 flex-1 overflow-auto"
      >
        {allLanes.length === 0 ? (
          <p data-testid="tl-empty" className="p-8 text-sm text-muted-foreground">
            {t.no_timeline}
          </p>
        ) : (
          <svg
            width={Math.max(width, 320)}
            height={height}
            className="block touch-pan-y cursor-grab select-none active:cursor-grabbing"
            data-from={Math.round(from)}
            data-to={Math.round(to)}
            onWheel={onWheel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <defs>
              <clipPath id="tl-plot">
                <rect x={GUTTER} y={0} width={plotW} height={height} />
              </clipPath>
            </defs>
            {/* axis */}
            <g className="text-[11px] fill-muted-foreground">
              <line
                x1={GUTTER}
                x2={GUTTER + plotW}
                y1={AXIS_H - 8}
                y2={AXIS_H - 8}
                className="stroke-border"
              />
              {ticks.map((y) => (
                <g key={y} transform={`translate(${x(y)},0)`}>
                  <line
                    y1={AXIS_H - 12}
                    y2={height}
                    className="stroke-border"
                    strokeDasharray="2 4"
                  />
                  <text
                    data-testid="tl-year"
                    y={AXIS_H - 14}
                    textAnchor="middle"
                    className="tabular-nums"
                  >
                    {formatYear(y, eraLabels)}
                  </text>
                </g>
              ))}
            </g>
            {/* lanes */}
            {lanes.map((lane, i) => {
              const top = AXIS_H + i * LANE_H;
              const mid = top + LANE_H / 2;
              return (
                <g
                  key={lane.id}
                  data-testid="tl-lane"
                  data-lane={lane.id}
                  data-type={lane.type}
                >
                  {i % 2 === 1 && (
                    <rect
                      x={0}
                      y={top}
                      width={Math.max(width, 320)}
                      height={LANE_H}
                      className="fill-muted/40"
                    />
                  )}
                  <text
                    x={GUTTER - 8}
                    y={mid + 4}
                    textAnchor="end"
                    className={
                      lane.doc
                        ? "cursor-pointer fill-foreground text-xs hover:underline"
                        : "fill-muted-foreground text-[11px] font-semibold uppercase"
                    }
                    onClick={() => lane.doc && s.openDoc(lane.doc.id)}
                  >
                    {(() => {
                      const max = GUTTER === GUTTER_NARROW ? 11 : 22;
                      return lane.title.length > max
                        ? lane.title.slice(0, max - 1) + "…"
                        : lane.title;
                    })()}
                  </text>
                  <g clipPath="url(#tl-plot)">
                    {placedFor(lane).map((p) => {
                      const [m] = p.marks;
                      const cluster = p.marks.length > 1;
                      const color = `var(--c-${m.type === "other" ? "note" : m.type})`;
                      const onLane =
                        m.type === "event" && lane.type !== "event";
                      // A point over a span rides above the bar rather than on it.
                      const cy = mid - (p.overSpan ? 7 : 0);
                      const open = (e: ReactMouseEvent) => {
                        e.stopPropagation();
                        if (cluster) zoomToCluster(p);
                        else s.openDoc(m.doc.id);
                      };
                      return (
                        <g
                          key={p.key}
                          data-testid={cluster ? "tl-cluster" : "tl-mark"}
                          data-doc={cluster ? undefined : m.doc.id}
                          data-count={cluster ? p.marks.length : undefined}
                          data-approx={m.approx ? "true" : "false"}
                          className="cursor-pointer"
                          onClick={open}
                          onPointerEnter={(e) =>
                            showCard(p, e.clientX, e.clientY)
                          }
                          opacity={m.approx && !cluster ? 0.55 : 1}
                        >
                          {!cluster && <title>{`${m.label} · ${m.text}`}</title>}
                          {p.x2 != null ? (
                            <rect
                              x={p.x}
                              y={mid - (onLane ? 4 : 7)}
                              width={p.x2 - p.x}
                              height={onLane ? 8 : 14}
                              rx={4}
                              fill={color}
                              strokeDasharray={m.approx ? "3 3" : undefined}
                              stroke={m.approx ? color : "none"}
                            />
                          ) : cluster ? (
                            <>
                              <circle
                                cx={p.x}
                                cy={cy}
                                r={9}
                                fill="var(--background)"
                                stroke={color}
                                strokeWidth={2}
                              />
                              <text
                                x={p.x}
                                y={cy + 3.5}
                                textAnchor="middle"
                                className="fill-foreground text-[10px] font-semibold tabular-nums"
                              >
                                {p.marks.length}
                              </text>
                            </>
                          ) : (
                            <circle
                              cx={p.x}
                              cy={cy}
                              r={onLane ? 4 : 6}
                              fill={onLane ? "var(--background)" : color}
                              stroke={color}
                              strokeWidth={2}
                              strokeDasharray={m.approx ? "2 2" : undefined}
                            />
                          )}
                          {p.label != null && !cluster && !onLane && (
                            <text
                              x={(p.x2 ?? p.x) + 8}
                              y={mid + 4}
                              className="pointer-events-none fill-foreground text-[11px]"
                            >
                              {p.label}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </g>
                </g>
              );
            })}
          </svg>
        )}
        {allLanes.length > 0 && lanes.length === 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-1/3 flex flex-col items-center gap-3 px-8 text-center">
            <p
              data-testid="tl-empty"
              className="text-sm text-muted-foreground"
            >
              {filtered ? t.tl_filtered_empty : t.tl_filter_in_view}
            </p>
            {filtered && (
              <Button
                size="sm"
                variant="outline"
                className="pointer-events-auto"
                data-testid="tl-empty-clear"
                onClick={() =>
                  s.setTimelineFilters({
                    ...f,
                    hiddenTypes: [],
                    tags: [],
                    props: [],
                    search: "",
                  })
                }
              >
                {t.tl_filter_clear}
              </Button>
            )}
          </div>
        )}
      </div>
      {card && (
        <ClusterCard
          state={card}
          onZoom={() => zoomToCluster(card.p)}
          onClose={() => setCard(null)}
        />
      )}
    </div>
  );
}

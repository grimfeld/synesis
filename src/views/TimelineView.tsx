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
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { CalendarRange, Maximize2, Plus, ZoomIn, ZoomOut } from "lucide-react";
import {
  api,
  type BibleDate,
  type DatedProperty,
  type DocSummary,
  type DocType,
  type EventLink,
} from "@/lib/api";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { ViewHeader } from "@/components/ViewHeader";
import { Button } from "@/components/ui/button";

const GUTTER = 150;
const RIGHT_PAD = 24;
const AXIS_H = 36;
const LANE_H = 34;
const LABEL_MAX_SPAN = 2600; // years visible above which mark labels hide

interface Mark {
  key: string;
  doc: DocSummary;
  /** Property name for a point, "span" for a bar, the Event title on a Subject lane. */
  label: string;
  text: string;
  from: number;
  to: number | null;
  approx: boolean;
  type: DocType;
}

interface Lane {
  id: string;
  title: string;
  type: DocType;
  doc: DocSummary | null;
  first: number;
  marks: Mark[];
}

export function yearOf(d: BibleDate): number {
  const m = d.month ? (d.month - 1) / 12 : 0;
  const day = d.day ? (d.day - 1) / 365 : 0;
  return d.year + m + day;
}

/** The year as people say it: astronomical 0 is 1 BCE. */
export function formatYear(y: number, t: { bce: string; ce: string }): string {
  const r = Math.round(y);
  return r <= 0 ? `${1 - r} ${t.bce}` : `${r} ${t.ce}`;
}

const SPAN_PAIRS: [string, string][] = [
  ["start", "end"],
  ["born", "died"],
];

export function buildLanes(
  rows: DatedProperty[],
  links: EventLink[],
  eventsTitle: string,
): Lane[] {
  const byDoc = new Map<string, { doc: DocSummary; dates: DatedProperty[] }>();
  for (const r of rows) {
    if (!r.date) continue;
    const g = byDoc.get(r.doc.id) ?? { doc: r.doc, dates: [] };
    g.dates.push(r);
    byDoc.set(r.doc.id, g);
  }
  const marksFor = (
    doc: DocSummary,
    dates: DatedProperty[],
    label: (name: string) => string,
  ): Mark[] => {
    const named = new Map(dates.map((d) => [d.name, d]));
    const out: Mark[] = [];
    const used = new Set<string>();
    for (const [a, b] of SPAN_PAIRS) {
      const da = named.get(a);
      const db = named.get(b);
      if (da?.date && db?.date) {
        out.push({
          key: `${doc.id}:${a}-${b}`,
          doc,
          label: label("span"),
          text: `${da.text} – ${db.text}`,
          from: yearOf(da.date),
          to: yearOf(db.date),
          approx: da.date.approx || db.date.approx,
          type: doc.type,
        });
        used.add(a);
        used.add(b);
      }
    }
    for (const d of dates) {
      if (used.has(d.name) || !d.date) continue;
      out.push({
        key: `${doc.id}:${d.name}`,
        doc,
        label: label(d.name),
        text: d.text,
        from: yearOf(d.date),
        to: null,
        approx: d.date.approx,
        type: doc.type,
      });
    }
    return out;
  };
  const events: Lane = {
    id: "events",
    title: eventsTitle,
    type: "event",
    doc: null,
    first: Infinity,
    marks: [],
  };
  const subjects: Lane[] = [];
  const eventMarks = new Map<string, Mark>();
  for (const { doc, dates } of byDoc.values()) {
    if (doc.type === "event") {
      // An Event is one mark: its span, or its start alone.
      const ms = marksFor(doc, dates, () => doc.title);
      const m =
        ms.find((x) => x.to != null) ??
        ms.find((x) => x.key.endsWith(":start")) ??
        ms[0];
      if (!m) continue;
      const mark = { ...m, label: doc.title };
      events.marks.push(mark);
      events.first = Math.min(events.first, mark.from);
      eventMarks.set(doc.id, mark);
    } else {
      const marks = marksFor(doc, dates, (name) =>
        name === "span" ? doc.title : name,
      );
      if (marks.length === 0) continue;
      subjects.push({
        id: doc.id,
        title: doc.title,
        type: doc.type,
        doc,
        first: Math.min(...marks.map((m) => m.from)),
        marks,
      });
    }
  }
  // Events also sit on the lanes of the Subjects they name.
  for (const l of links) {
    const lane = subjects.find((x) => x.id === l.subject);
    const mark = eventMarks.get(l.event);
    if (lane && mark)
      lane.marks.push({ ...mark, key: `${lane.id}:${mark.key}` });
  }
  subjects.sort((a, b) => a.first - b.first || a.title.localeCompare(b.title));
  return [...(events.marks.length ? [events] : []), ...subjects];
}

function niceStep(span: number): number {
  const steps = [10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
  for (const s of steps) if (span / s >= 5) return s;
  return 1;
}

export function TimelineView() {
  const s = useStore();
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<DatedProperty[]>([]);
  const [links, setLinks] = useState<EventLink[]>([]);
  const [width, setWidth] = useState(900);
  const [range, setRange] = useState<[number, number] | null>(null);
  const drag = useRef<{ x: number; from: number; to: number } | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api.timeline(), api.eventLinks()])
      .then(([r, l]) => {
        if (!alive) return;
        setRows(r);
        setLinks(l);
      })
      .catch(console.error);
    return () => {
      alive = false;
    };
  }, [s.changeTick, s.docs]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const lanes = useMemo(
    () => buildLanes(rows, links, t.events),
    [rows, links, t.events],
  );
  const extent = useMemo<[number, number]>(() => {
    const ys = lanes.flatMap((l) =>
      l.marks.flatMap((m) => [m.from, m.to ?? m.from]),
    );
    if (ys.length === 0) return [-2000, 100];
    let lo = Math.min(...ys);
    let hi = Math.max(...ys);
    if (hi - lo < 10) {
      lo -= 5;
      hi += 5;
    }
    const pad = (hi - lo) * 0.06;
    return [lo - pad, hi + pad];
  }, [lanes]);
  const [from, to] = range ?? extent;
  const plotW = Math.max(200, width - GUTTER - RIGHT_PAD);
  const x = useCallback(
    (y: number) => GUTTER + ((y - from) / (to - from)) * plotW,
    [from, to, plotW],
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
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, from, to };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = ((e.clientX - d.x) / plotW) * (d.to - d.from);
    setRange([d.from - dy, d.to - dy]);
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const step = niceStep(to - from);
  const ticks: number[] = [];
  for (let y = Math.ceil(from / step) * step; y <= to; y += step) ticks.push(y);
  const showLabels = to - from <= LABEL_MAX_SPAN;
  const height = AXIS_H + lanes.length * LANE_H + 8;
  const eraLabels = { bce: t.bce, ce: t.ce };

  return (
    <div className="flex h-full flex-col">
      <ViewHeader title={t.views.timeline} icon={<CalendarRange />}>
        <span className="hidden truncate text-xs text-muted-foreground md:inline">
          {lanes.length === 0 ? t.no_timeline : t.timeline_hint}
        </span>
        <div className="ml-auto flex items-center gap-1">
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
            onClick={() => s.setDialog({ kind: "new", type: "event" })}
          >
            <Plus />
            {t.types.event}
          </Button>
        </div>
      </ViewHeader>
      <div
        ref={host}
        data-testid="timeline"
        className="thin-scroll min-h-0 flex-1 overflow-auto"
      >
        {lanes.length === 0 ? (
          <p className="p-8 text-sm text-muted-foreground">{t.no_timeline}</p>
        ) : (
          <svg
            width={Math.max(width, 320)}
            height={height}
            className="block cursor-grab select-none active:cursor-grabbing"
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
                    x={GUTTER - 12}
                    y={mid + 4}
                    textAnchor="end"
                    className={
                      lane.doc
                        ? "cursor-pointer fill-foreground text-xs hover:underline"
                        : "fill-muted-foreground text-[11px] font-semibold uppercase"
                    }
                    onClick={() => lane.doc && s.openDoc(lane.doc.id)}
                  >
                    {lane.title.length > 22
                      ? lane.title.slice(0, 21) + "…"
                      : lane.title}
                  </text>
                  <g clipPath="url(#tl-plot)">
                    {lane.marks.map((m) => {
                      const x1 = x(m.from);
                      const x2 =
                        m.to != null ? Math.max(x(m.to), x1 + 3) : null;
                      const color = `var(--c-${m.type === "other" ? "note" : m.type})`;
                      const onLane =
                        m.type === "event" && lane.type !== "event";
                      return (
                        <g
                          key={m.key}
                          data-testid="tl-mark"
                          data-doc={m.doc.id}
                          data-approx={m.approx ? "true" : "false"}
                          className="cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            s.openDoc(m.doc.id);
                          }}
                          opacity={m.approx ? 0.55 : 1}
                        >
                          <title>{`${m.label} · ${m.text}`}</title>
                          {x2 != null ? (
                            <rect
                              x={x1}
                              y={mid - (onLane ? 4 : 7)}
                              width={x2 - x1}
                              height={onLane ? 8 : 14}
                              rx={4}
                              fill={color}
                              strokeDasharray={m.approx ? "3 3" : undefined}
                              stroke={m.approx ? color : "none"}
                            />
                          ) : (
                            <circle
                              cx={x1}
                              cy={mid}
                              r={onLane ? 4 : 6}
                              fill={onLane ? "var(--background)" : color}
                              stroke={color}
                              strokeWidth={2}
                              strokeDasharray={m.approx ? "2 2" : undefined}
                            />
                          )}
                          {showLabels && !onLane && (
                            <text
                              x={(x2 ?? x1) + 8}
                              y={mid + 4}
                              className="fill-foreground text-[11px]"
                            >
                              {m.label}
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
      </div>
    </div>
  );
}

// The one Subject's Lane, shrunk into its Hub (PLAN §16.9). Static: no zoom or
// pan, because a wheel-zoom inside a scrolling Hub hijacks the page. Two rows,
// own Dates above and the Events naming it below, so the widget stays short.
import { useCallback, useMemo, useState } from "react";
import { CalendarRange } from "lucide-react";
import type { DatedProperty, DocSummary } from "@/lib/api";
import {
  buildLanes,
  extentOf,
  formatYear,
  placeMarks,
  resolveLabels,
  type Lane,
  type Placed,
} from "@/lib/timeline";
import { useStore } from "@/lib/store";
import { propertyLabel, useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { PanelTitle } from "@/components/Field";

const H = 30;
const AXIS = 18;
const PAD = 10;

function labelWidth(label: string) {
  return label.length * 5.7;
}

/** The Subject's own Dates, then the Events naming it, as at most two Lanes. */
export function miniLanes(
  doc: DocSummary,
  dates: DatedProperty[],
  events: { doc: DocSummary; dates: DatedProperty[] }[],
  /** What to call a Property on a mark; the view hands it `propertyLabel`. */
  propertyLabel: (name: string) => string = (n) => n,
): Lane[] {
  const own = buildLanes(
    dates.map((d) => ({ ...d, doc })),
    [],
    "",
    propertyLabel,
  );
  const evLanes = buildLanes(
    events.flatMap((e) => e.dates.map((d) => ({ ...d, doc: e.doc }))),
    [],
    "events",
    propertyLabel,
  );
  const out: Lane[] = [];
  if (own.length > 0) out.push({ ...own[0], id: "own" });
  const ev = evLanes.find((l) => l.id === "events");
  if (ev && ev.marks.length > 0) out.push({ ...ev, id: "events" });
  return out;
}

export function MiniTimeline({
  doc,
  dates,
  events,
}: {
  doc: DocSummary;
  dates: DatedProperty[];
  events: { doc: DocSummary; dates: DatedProperty[] }[];
}) {
  const s = useStore();
  const t = useT();
  const [w, setW] = useState(420);
  const label = useCallback((name: string) => propertyLabel(name, t), [t]);
  const lanes = useMemo(
    () => miniLanes(doc, dates, events, label),
    [doc, dates, events, label],
  );
  const [from, to] = useMemo(() => extentOf(lanes), [lanes]);
  const plotW = Math.max(120, w - PAD * 2);
  const x = (y: number) => PAD + ((y - from) / (to - from)) * plotW;
  if (lanes.length === 0) return null;
  const height = AXIS + lanes.length * H + 4;
  const eras = { bce: t.bce, ce: t.ce };
  return (
    <div data-testid="hub-minitimeline">
      <div className="mb-2 flex items-center gap-2">
        <PanelTitle>{t.views.timeline}</PanelTitle>
        <Button
          size="sm"
          variant="ghost"
          data-testid="tl-open-full"
          className="ml-auto h-6 px-2 text-xs text-muted-foreground"
          onClick={() => {
            // A soft scope: the Subject's era and its title in the search box,
            // so "who else was alive then?" stays answerable (PLAN §16.10).
            s.setTimelineFilters({ ...s.timelineFilters, search: doc.title });
            s.navigate({ kind: "timeline" });
          }}
        >
          <CalendarRange />
          {t.tl_open_in_timeline}
        </Button>
      </div>
      <div
        ref={(el) => {
          if (el && el.clientWidth > 0) setW(el.clientWidth);
        }}
        className="rounded-lg border bg-card/40 p-1"
      >
        <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`}>
          {/* Both ends of the era the widget covers, and nothing between. */}
          <g className="fill-muted-foreground text-[10px]">
            <text x={PAD} y={11}>
              {formatYear(from, eras)}
            </text>
            <text x={w - PAD} y={11} textAnchor="end">
              {formatYear(to, eras)}
            </text>
          </g>
          <line
            x1={PAD}
            x2={w - PAD}
            y1={AXIS - 3}
            y2={AXIS - 3}
            className="stroke-border"
          />
          {lanes.map((lane, i) => {
            const mid = AXIS + i * H + H / 2;
            const placed = resolveLabels(placeMarks(lane.marks, x), labelWidth, w - PAD, (p) => p.x + 6);
            return (
              <g key={lane.id} data-testid="mini-lane" data-lane={lane.id}>
                {placed.map((p) => (
                  <MiniMark
                    key={p.key}
                    p={p}
                    mid={mid}
                    onOpen={(id) => s.openDoc(id)}
                  />
                ))}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function MiniMark({
  p,
  mid,
  onOpen,
}: {
  p: Placed;
  mid: number;
  onOpen: (id: string) => void;
}) {
  const [m] = p.marks;
  const cluster = p.marks.length > 1;
  const color = `var(--c-${m.type === "other" ? "note" : m.type})`;
  // A point over a span rides above the bar rather than on it.
  const cy = mid - (p.overSpan ? 6 : 0);
  return (
    <g
      data-testid={cluster ? "mini-cluster" : "mini-mark"}
      data-doc={cluster ? undefined : m.doc.id}
      data-count={cluster ? p.marks.length : undefined}
      className="cursor-pointer"
      opacity={m.approx && !cluster ? 0.55 : 1}
      onClick={() => !cluster && onOpen(m.doc.id)}
    >
      <title>
        {cluster
          ? p.marks.map((k) => `${k.label} · ${k.text}`).join("\n")
          : `${m.label} · ${m.text}`}
      </title>
      {p.x2 != null ? (
        <rect
          x={p.x}
          y={mid - 5}
          width={p.x2 - p.x}
          height={10}
          rx={3}
          fill={color}
          strokeDasharray={m.approx ? "3 3" : undefined}
          stroke={m.approx ? color : "none"}
        />
      ) : cluster ? (
        <>
          <circle
            cx={p.x}
            cy={cy}
            r={8}
            fill="var(--background)"
            stroke={color}
            strokeWidth={2}
          />
          <text
            x={p.x}
            y={cy + 3}
            textAnchor="middle"
            className="fill-foreground text-[9px] font-semibold tabular-nums"
          >
            {p.marks.length}
          </text>
        </>
      ) : (
        <circle
          cx={p.x}
          cy={cy}
          r={5}
          fill={m.approx ? "var(--background)" : color}
          stroke={color}
          strokeWidth={2}
        />
      )}
      {/* Only a span is wide enough to carry a label, and it carries it inside. */}
      {p.label != null && p.x2 != null && p.x2 - p.x > 40 && (
        <text
          x={p.x + 6}
          y={mid + 3.5}
          className="pointer-events-none fill-background text-[10px] font-medium"
        >
          {p.label}
        </text>
      )}
    </g>
  );
}

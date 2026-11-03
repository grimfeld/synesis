// The Map's time slider (CONTEXT.md: Period): a track over the years the
// Vault's Dates cover, the Period's ends as two handles and the stretch
// between them as a third, so the window can be widened or moved. It writes
// the same shared Period the Timeline's PeriodBar does; the rules of dragging
// are in lib/periodSlider.
import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { useStore } from "@/lib/store";
import { formatYear } from "@/lib/timeline";
import { ordered, type Period } from "@/lib/period";
import {
  dragPeriod,
  fractionOf,
  sliderStops,
  type Extent,
  type Handle,
} from "@/lib/periodSlider";
import { useT } from "@/i18n";

export function PeriodSlider({ extent }: { extent: Extent }) {
  const s = useStore();
  const t = useT();
  const pf = s.periodFilter;
  const period = ordered(pf.period);
  const track = useRef<HTMLDivElement>(null);
  // The Period and pointer when a handle was taken, so a drag is measured from
  // where it began rather than accumulating rounding at every move.
  const held = useRef<{ handle: Handle; x: number; start: Period | null } | null>(null);
  const eras = { bce: t.bce, ce: t.ce };
  const stops = sliderStops(period, extent);
  const span = extent.max - extent.min;
  const pct = (y: number) => `${fractionOf(y, extent) * 100}%`;

  const set = (p: Period) => s.setPeriodFilter({ ...s.periodFilter, period: p });

  const down = (handle: Handle) => (e: PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.currentTarget.focus();
    held.current = { handle, x: e.clientX, start: period };
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const h = held.current;
    const w = track.current?.getBoundingClientRect().width ?? 0;
    if (!h || w <= 0) return;
    set(dragPeriod(h.start, h.handle, ((e.clientX - h.x) / w) * span, extent));
  };
  const up = () => {
    held.current = null;
  };
  const key = (handle: Handle) => (e: KeyboardEvent<HTMLElement>) => {
    const big = Math.max(1, Math.round(span / 10));
    const step: Record<string, number> = {
      ArrowLeft: e.shiftKey ? -10 : -1,
      ArrowDown: e.shiftKey ? -10 : -1,
      ArrowRight: e.shiftKey ? 10 : 1,
      ArrowUp: e.shiftKey ? 10 : 1,
      PageDown: -big,
      PageUp: big,
      Home: -span,
      End: span,
    };
    if (!(e.key in step)) return;
    e.preventDefault();
    set(dragPeriod(period, handle, step[e.key], extent));
  };

  const handle = (h: Handle, at: number, label: string) => (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={extent.min}
      aria-valuemax={extent.max}
      aria-valuenow={at}
      aria-valuetext={formatYear(at, eras)}
      data-testid={`period-slider-${h}`}
      data-year={at}
      onPointerDown={down(h)}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key(h)}
      style={{ left: pct(at) }}
      className="absolute top-1/2 z-10 size-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none rounded-full border-2 border-primary bg-background shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  );

  return (
    <div
      data-testid="period-slider"
      data-active={period ? "true" : "false"}
      aria-label={t.period_slider}
      className="flex w-full min-w-0 items-center gap-3 text-[11px] text-muted-foreground"
    >
      <span className="shrink-0 tabular-nums">{formatYear(extent.min, eras)}</span>
      <div ref={track} className="relative h-6 min-w-0 flex-1">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" />
        <div
          role="slider"
          tabIndex={0}
          aria-label={t.period_slider_middle}
          aria-valuemin={extent.min}
          aria-valuemax={extent.max}
          aria-valuenow={stops.from}
          aria-valuetext={`${formatYear(stops.from, eras)} – ${formatYear(stops.to, eras)}`}
          data-testid="period-slider-middle"
          onPointerDown={down("middle")}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={key("middle")}
          style={{ left: pct(stops.from), width: `calc(${pct(stops.to)} - ${pct(stops.from)})` }}
          className={
            "absolute top-1/2 h-2.5 min-w-2 -translate-y-1/2 cursor-grab touch-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing " +
            (period ? "bg-primary" : "bg-primary/30")
          }
        />
        {handle("from", stops.from, t.period_slider_from)}
        {handle("to", stops.to, t.period_slider_to)}
      </div>
      <span className="shrink-0 tabular-nums">{formatYear(extent.max, eras)}</span>
    </div>
  );
}

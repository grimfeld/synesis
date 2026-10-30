// The Period control (CONTEXT.md: Period): a row under a view's header that
// always says which years are shown, as text ("640–580 BCE"), with the from/to
// fields behind it and a one-click clear, and the Places and Tags chosen with
// it. It reads and writes the shared Period filter in the store, so the
// Timeline and the Map show the same years, Places and Tags.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarClock, Check, MapPin, Tag, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { fold } from "@/lib/names";
import {
  fieldToYear,
  formatPeriod,
  ordered,
  yearToField,
  type Period,
} from "@/lib/period";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/** One end of the Period: a year field and the era it counts in. */
function YearField({
  id,
  label,
  text,
  bce,
  onChange,
}: {
  id: string;
  label: string;
  text: string;
  bce: boolean;
  onChange: (text: string, bce: boolean) => void;
}) {
  const t = useT();
  return (
    <label className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
      <span className="w-8 shrink-0 text-muted-foreground">{label}</span>
      <Input
        data-testid={`period-${id}`}
        inputMode="numeric"
        value={text}
        onChange={(e) => onChange(e.currentTarget.value, bce)}
        className="h-8 w-20 text-xs tabular-nums"
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-testid={`period-${id}-era`}
        data-bce={bce ? "true" : "false"}
        onClick={() => onChange(text, !bce)}
      >
        {bce ? t.bce : t.ce}
      </Button>
    </label>
  );
}

/**
 * The Places the shared filter keeps, any of them (CONTEXT.md: Period): a
 * searchable list of every Place to add or remove one.
 */
function PlacePicker() {
  const s = useStore();
  const t = useT();
  const pf = s.periodFilter;
  const [q, setQ] = useState("");
  const places = useMemo(
    () =>
      s.docs
        .filter((d) => d.type === "place")
        .sort((a, b) => a.title.localeCompare(b.title)),
    [s.docs],
  );
  const shown = useMemo(() => {
    const needle = fold(q.trim());
    return needle ? places.filter((p) => fold(p.title).includes(needle)) : places;
  }, [places, q]);
  const toggle = (id: string) =>
    s.setPeriodFilter({
      ...pf,
      places: pf.places.includes(id)
        ? pf.places.filter((x) => x !== id)
        : [...pf.places, id],
    });
  return (
    <Popover onOpenChange={(open) => !open && setQ("")}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant={pf.places.length > 0 ? "secondary" : "ghost"}
          data-testid="period-places"
          className="min-w-0"
        >
          <MapPin />
          <span className="min-w-0">{t.period_places}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-72 flex-col gap-2">
        <Input
          data-testid="period-places-search"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          placeholder={t.period_places_search}
          className="h-8 text-xs"
        />
        <div className="thin-scroll flex max-h-60 min-w-0 flex-col overflow-auto">
          {shown.length === 0 && (
            <p className="p-2 text-xs text-muted-foreground">{t.period_places_none}</p>
          )}
          {shown.map((p) => {
            const on = pf.places.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                data-testid="period-place-option"
                data-id={p.id}
                data-on={on ? "true" : "false"}
                aria-pressed={on}
                onClick={() => toggle(p.id)}
                className="flex min-w-0 items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent"
              >
                <Check className={on ? "size-3.5 shrink-0" : "size-3.5 shrink-0 opacity-0"} />
                <span className="min-w-0 truncate">{p.title}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** One chosen Place or Tag, shown on the row with a way to remove it. */
function Chip({
  testid,
  id,
  icon,
  label,
  onRemove,
}: {
  testid: string;
  id: string;
  icon: ReactNode;
  label: string;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <span
      data-testid={testid}
      data-id={id}
      className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border bg-secondary py-0.5 pl-2 pr-0.5 text-secondary-foreground"
    >
      <span className="shrink-0 [&_svg]:size-3">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
      <button
        type="button"
        data-testid={`${testid}-remove`}
        aria-label={t.period_remove(label)}
        onClick={onRemove}
        className="shrink-0 rounded-full p-0.5 hover:bg-accent"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

export function PeriodBar({
  undated,
  children,
}: {
  undated: number;
  /** A view's own way of setting the Period (the Map's slider), on a row of its own. */
  children?: ReactNode;
}) {
  const s = useStore();
  const t = useT();
  const pf = s.periodFilter;
  const period = ordered(pf.period);
  const eras = { bce: t.bce, ce: t.ce };

  // The fields keep what is typed, even a half-typed year; the Period itself
  // only ever holds whole years.
  const [from, setFrom] = useState(() => yearToField(pf.period?.from ?? null));
  const [to, setTo] = useState(() => yearToField(pf.period?.to ?? null));
  // Cleared, or set from the other view: the fields follow.
  useEffect(() => {
    const p = pf.period;
    setFrom((f) =>
      fieldToYear(f.text, f.bce) === (p?.from ?? null) ? f : yearToField(p?.from ?? null),
    );
    setTo((f) =>
      fieldToYear(f.text, f.bce) === (p?.to ?? null) ? f : yearToField(p?.to ?? null),
    );
  }, [pf.period]);

  const commit = (
    a: { text: string; bce: boolean },
    b: { text: string; bce: boolean },
  ) => {
    setFrom(a);
    setTo(b);
    const next: Period = {
      from: fieldToYear(a.text, a.bce),
      to: fieldToYear(b.text, b.bce),
    };
    s.setPeriodFilter({
      ...pf,
      period: next.from == null && next.to == null ? null : next,
    });
  };
  const clear = () => s.setPeriodFilter({ ...pf, period: null });

  return (
    <div
      data-testid="period-bar"
      className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-1.5 text-xs"
    >
      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant={period ? "secondary" : "ghost"}
            data-testid="period"
            data-active={period ? "true" : "false"}
            className="min-w-0"
          >
            <CalendarClock />
            <span data-testid="period-text" className="min-w-0 tabular-nums">
              {period ? formatPeriod(period, eras) : t.period}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="flex w-72 flex-col gap-2">
          <YearField
            id="from"
            label={t.period_from}
            text={from.text}
            bce={from.bce}
            onChange={(text, bce) => commit({ text, bce }, to)}
          />
          <YearField
            id="to"
            label={t.period_to}
            text={to.text}
            bce={to.bce}
            onChange={(text, bce) => commit(from, { text, bce })}
          />
        </PopoverContent>
      </Popover>
      <PlacePicker />
      {pf.places.map((id) => (
        <Chip
          key={id}
          testid="period-place"
          id={id}
          icon={<MapPin />}
          label={s.docsById.get(id)?.title ?? id}
          onRemove={() =>
            s.setPeriodFilter({ ...pf, places: pf.places.filter((x) => x !== id) })
          }
        />
      ))}
      {pf.tags.map((tag) => (
        <Chip
          key={tag}
          testid="period-tag"
          id={tag}
          icon={<Tag />}
          label={tag}
          onRemove={() =>
            s.setPeriodFilter({ ...pf, tags: pf.tags.filter((x) => x !== tag) })
          }
        />
      ))}
      {period && undated > 0 && (
        <span data-testid="period-undated" className="min-w-0 text-muted-foreground">
          {t.period_undated(undated)}
        </span>
      )}
      {period && (
        <Button
          size="sm"
          variant="ghost"
          data-testid="period-clear"
          className="ml-auto"
          onClick={clear}
        >
          <X />
          {t.period_clear}
        </Button>
      )}
      {children}
    </div>
  );
}

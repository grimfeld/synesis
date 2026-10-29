// The Period control (CONTEXT.md: Period): a row under a view's header that
// always says which years are shown, as text ("640–580 BCE"), with the from/to
// fields behind it and a one-click clear. It reads and writes the shared
// Period filter in the store, so the Timeline and the Map show the same years.
import { useEffect, useState, type ReactNode } from "react";
import { CalendarClock, X } from "lucide-react";
import { useStore } from "@/lib/store";
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

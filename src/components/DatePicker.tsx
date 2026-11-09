import { useEffect, useId, useRef, useState } from "react";
import { CalendarClock } from "lucide-react";
import {
  api,
  type DatePick,
  type HebrewMonth,
  type HebrewMonthEntry,
  type Lang,
  type Reckoning,
} from "@/lib/api";
import { cn } from "cn";
import { useLang, useT } from "@/i18n";
import { PickerShell } from "@/components/PickerShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { civilMonth } from "@/lib/datePreview";
import {
  daysOf,
  withCalendar,
  withHebrewMonth,
  withMonth,
  type Calendar,
  type MonthPick,
} from "@/lib/datePick";

/** What the segments hold: the year as typed, so a half-typed one is kept. */
interface Segments extends MonthPick {
  approx: boolean;
  year: string;
  bce: boolean;
}

const EMPTY: Segments = {
  approx: false,
  year: "",
  bce: true,
  calendar: "civil",
  month: null,
  hebrew: null,
  day: null,
};

/** The Select value for an empty month or day segment (Radix forbids ""). */
const NONE = "none";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** The engine's Hebrew months per language, asked for once. */
const hebrewMonthsAsked = new Map<Lang, Promise<HebrewMonthEntry[]>>();

/**
 * The Hebrew months the month segment offers, in the engine's order and
 * names for `lang` (`hebrew_months`): the same table a pick writes from and
 * the parser reads. Empty until the engine answers.
 */
function useHebrewMonths(lang: Lang): HebrewMonthEntry[] {
  const [months, setMonths] = useState<HebrewMonthEntry[]>([]);
  useEffect(() => {
    let live = true;
    let asked = hebrewMonthsAsked.get(lang);
    if (!asked) {
      asked = api.hebrewMonths(lang);
      hebrewMonthsAsked.set(lang, asked);
      asked.catch(() => hebrewMonthsAsked.delete(lang));
    }
    asked.then((m) => live && setMonths(m)).catch(() => {});
    return () => {
      live = false;
    };
  }, [lang]);
  return months;
}

/**
 * Touch-sized in the phone Sheet, like the calendar's days; the Popover's
 * compact size from `md` up (the Sheet's breakpoint, `useIsMobile`).
 */
const FINGER = "min-h-10 md:min-h-8";

/** A Select trigger's height, overriding its fixed one: the same sizes. */
const TRIGGER = "data-[size=default]:h-10 md:data-[size=default]:h-8";

/** The year typed, when it is one: a positive whole number the parser reads. */
function yearOf(typed: string): number | null {
  if (!/^\d{1,5}$/.test(typed)) return null;
  const n = Number(typed);
  return n > 0 ? n : null;
}

/**
 * The Date picker beside a Date field (#120): segments for a Date, opened from
 * a button beside the field. The field's text stays the Date (ADR 0005): the
 * picker reads it through the engine (`read_date`), and a pick writes the
 * whole Date part back through the engine (`write_date`), keeping the text's
 * Reckoning and notes. Opening and closing it writes nothing.
 *
 * Segments: approximate, day, month, year, era. The month is civil or Hebrew
 * by a switch; the picker opens on the Hebrew calendar when the text names a
 * Hebrew month. The day waits for a month and offers only the days it has
 * (1–30 in a Hebrew month); clearing the month clears the day.
 *
 * A switch, toggle or Select writes at once; the year writes when it is
 * committed (Enter, leaving the segment, or closing the picker), so typing
 * "1513" never writes "1 BCE", "15 BCE"… on the way.
 */
export function DatePicker({
  text,
  onPick,
  testId,
  disabled,
}: {
  /** The field's text as typed. */
  text: string;
  /** The new text for the field, after a pick that changed it. */
  onPick: (text: string) => void;
  /**
   * The shell's test id; segments are `${testId}-approx`, `-day`, `-month`,
   * `-year`, `-era`, `-calendar` (`-calendar-civil`, `-calendar-hebrew`), and
   * the Select items `-month-<1–12|nisan…adar_ii|none>`, `-day-<n|none>`.
   */
  testId: string;
  disabled?: boolean;
}) {
  const t = useT();
  const lang = useLang();
  const id = useId();
  const hebrewMonths = useHebrewMonths(lang);
  const [open, setOpen] = useState(false);
  const [segments, setSegments] = useState<Segments>(EMPTY);
  const [reckoning, setReckoning] = useState<Reckoning>("common");
  // Only the latest pick's text lands.
  const latest = useRef(0);
  // The texts the picker wrote since it opened. Reading one back would only
  // echo the segments, and could land over a year still being typed: the
  // field can hand back an older pick's text after a newer one is written.
  const wrote = useRef(new Set<string>());
  // A year typed and not yet written.
  const yearTyped = useRef(false);

  // Typing in the field updates the picker. Text that is not a Date leaves
  // the segments as they were, so a pick in progress is not lost; an empty
  // field starts the picker afresh, so no segment writes the old Date back.
  useEffect(() => {
    let live = true;
    const value = text.trim();
    if (!value) {
      setSegments(EMPTY);
      setReckoning("common");
      yearTyped.current = false;
      return;
    }
    if (wrote.current.has(text)) return;
    api
      .readDate(value, lang)
      .then((r) => {
        if (!live || !r.ok) return;
        setSegments({
          approx: r.approx,
          year: String(r.era_year),
          bce: r.bce,
          calendar: r.hebrew_month == null ? "civil" : "hebrew",
          month: r.hebrew_month == null ? r.month : null,
          hebrew: r.hebrew_month,
          day: r.month == null ? null : r.day,
        });
        setReckoning(r.reckoning);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [text, open, lang]);

  /** Set the segments and write the Date they make. */
  const pick = (next: Segments) => {
    setSegments(next);
    write(next);
  };

  /** Write the year typed, if it has not been. */
  const commitYear = () => {
    if (yearTyped.current) write(segments);
  };

  const write = (next: Segments) => {
    yearTyped.current = false;
    const era_year = yearOf(next.year);
    if (era_year == null) return;
    const date: DatePick = {
      era_year,
      bce: next.bce,
      approx: next.approx,
      ...(next.calendar === "hebrew"
        ? {
            hebrew_month: next.hebrew,
            day: next.hebrew == null ? null : next.day,
          }
        : { month: next.month, day: next.month == null ? null : next.day }),
    };
    const ticket = ++latest.current;
    const previous = text;
    api
      .writeDate(date, lang, previous)
      .then((written) => {
        if (ticket !== latest.current || written === previous) return;
        wrote.current.add(written);
        onPick(written);
      })
      .catch(() => {});
  };

  const yearInvalid = segments.year !== "" && yearOf(segments.year) == null;
  const eraWords =
    reckoning === "christian" ? { bce: t.bc, ce: t.ad } : { bce: t.bce, ce: t.ce };
  const hebrew = segments.calendar === "hebrew";
  const days = daysOf(segments);
  const monthValue = hebrew
    ? (segments.hebrew ?? NONE)
    : segments.month == null
      ? NONE
      : String(segments.month);
  const months: { value: string; label: string }[] = hebrew
    ? hebrewMonths.map((h) => ({ value: h.hebrew_month, label: h.name }))
    : MONTHS.map((m) => ({ value: String(m), label: civilMonth(m, lang) }));
  const setMonth = (v: string) =>
    pick(
      hebrew
        ? withHebrewMonth(segments, v === NONE ? null : (v as HebrewMonth))
        : {
            ...segments,
            ...withMonth(segments, v === NONE ? null : Number(v)),
          },
    );
  return (
    <PickerShell
      label={t.date_picker.open}
      icon={<CalendarClock />}
      testId={testId}
      open={open}
      onOpenChange={(next) => {
        // Opening reads the field afresh: it may have been typed in since.
        if (next) wrote.current.clear();
        else commitYear();
        setOpen(next);
      }}
      disabled={disabled}
    >
      <div className="grid min-w-0 gap-3" data-testid={`${testId}-segments`}>
        <div className={cn("flex min-w-0 items-center justify-between gap-3", FINGER)}>
          <Label htmlFor={`${id}-approx`} className="min-w-0 leading-snug">
            {t.date_picker.approx}
          </Label>
          <Switch
            id={`${id}-approx`}
            data-testid={`${testId}-approx`}
            checked={segments.approx}
            disabled={disabled}
            onCheckedChange={(approx) => pick({ ...segments, approx })}
          />
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={0}
          aria-label={t.date_picker.calendar}
          data-testid={`${testId}-calendar`}
          className="w-full min-w-0"
          value={segments.calendar}
          disabled={disabled}
          onValueChange={(v) =>
            v &&
            pick({
              ...segments,
              ...withCalendar(segments, v as Calendar, hebrewMonths),
            })
          }
        >
          <ToggleGroupItem
            value="civil"
            data-testid={`${testId}-calendar-civil`}
            className={cn("h-auto min-w-0 flex-1 whitespace-normal", FINGER)}
          >
            {t.date_picker.civil}
          </ToggleGroupItem>
          <ToggleGroupItem
            value="hebrew"
            data-testid={`${testId}-calendar-hebrew`}
            className={cn("h-auto min-w-0 flex-1 whitespace-normal", FINGER)}
          >
            {t.date_picker.hebrew}
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="flex min-w-0 flex-wrap items-end gap-3">
          <div className="grid min-w-0 basis-20 gap-1.5">
            <Label htmlFor={`${id}-day`} className="min-w-0 leading-snug">
              {t.date_picker.day}
            </Label>
            <Select
              value={segments.day == null ? NONE : String(segments.day)}
              disabled={disabled || days === 0}
              onValueChange={(v) =>
                pick({ ...segments, day: v === NONE ? null : Number(v) })
              }
            >
              <SelectTrigger
                id={`${id}-day`}
                data-testid={`${testId}-day`}
                className={cn("w-full min-w-0 tabular-nums", TRIGGER)}
              >
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE} data-testid={`${testId}-day-none`} className={FINGER}>
                  {t.date_picker.no_day}
                </SelectItem>
                {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
                  <SelectItem
                    key={d}
                    value={String(d)}
                    data-testid={`${testId}-day-${d}`}
                    className={cn("tabular-nums", FINGER)}
                  >
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid min-w-0 flex-1 basis-32 gap-1.5">
            <Label htmlFor={`${id}-month`} className="min-w-0 leading-snug">
              {t.date_picker.month}
            </Label>
            <Select value={monthValue} disabled={disabled} onValueChange={setMonth}>
              <SelectTrigger
                id={`${id}-month`}
                data-testid={`${testId}-month`}
                className={cn("w-full min-w-0", TRIGGER)}
              >
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE} data-testid={`${testId}-month-none`} className={FINGER}>
                  {t.date_picker.no_month}
                </SelectItem>
                {months.map((m) => (
                  <SelectItem
                    key={m.value}
                    value={m.value}
                    data-testid={`${testId}-month-${m.value}`}
                    className={FINGER}
                  >
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-end gap-3">
          <div className="grid min-w-0 flex-1 basis-24 gap-1.5">
            <Label htmlFor={`${id}-year`} className="min-w-0 leading-snug">
              {t.date_picker.year}
            </Label>
            <Input
              id={`${id}-year`}
              data-testid={`${testId}-year`}
              inputMode="numeric"
              autoComplete="off"
              maxLength={5}
              className="h-10 min-w-0 tabular-nums md:h-8"
              value={segments.year}
              disabled={disabled}
              aria-invalid={yearInvalid || undefined}
              onChange={(e) => {
                yearTyped.current = true;
                setSegments({ ...segments, year: e.target.value.replace(/\D/g, "") });
              }}
              onBlur={commitYear}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                commitYear();
              }}
            />
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            spacing={0}
            aria-label={t.date_picker.era}
            data-testid={`${testId}-era`}
            value={segments.bce ? "bce" : "ce"}
            disabled={disabled}
            onValueChange={(v) => v && pick({ ...segments, bce: v === "bce" })}
          >
            <ToggleGroupItem
              value="bce"
              data-testid={`${testId}-era-bce`}
              className={cn("h-auto", FINGER)}
            >
              {eraWords.bce}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="ce"
              data-testid={`${testId}-era-ce`}
              className={cn("h-auto", FINGER)}
            >
              {eraWords.ce}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
    </PickerShell>
  );
}

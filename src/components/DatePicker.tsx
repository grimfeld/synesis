import {
  useEffect,
  useId,
  useReducer,
  useState,
  type Dispatch,
  type ReactNode,
} from "react";
import { CalendarClock } from "lucide-react";
import { api, type DateWords, type Lang } from "@/lib/api";
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
import {
  datePick,
  daysOf,
  INITIAL_PICK,
  yearOf,
  type Calendar,
  type DateSegments,
  type PickAction,
} from "@/lib/datePick";

/** The Select value for an empty month or day segment (Radix forbids ""). */
const NONE = "none";

/** The engine's Date words per language, asked for once. */
const dateWordsAsked = new Map<Lang, Promise<DateWords>>();

/**
 * The words the segments are labelled with, from the engine for `lang`
 * (`date_words`): the same tables a pick writes from and the parser reads.
 * Null until the engine answers.
 */
function useDateWords(lang: Lang): DateWords | null {
  const [words, setWords] = useState<{ lang: Lang; words: DateWords } | null>(null);
  useEffect(() => {
    let live = true;
    let asked = dateWordsAsked.get(lang);
    if (!asked) {
      asked = api.dateWords(lang);
      dateWordsAsked.set(lang, asked);
      asked.catch(() => dateWordsAsked.delete(lang));
    }
    asked.then((w) => live && setWords({ lang, words: w })).catch(() => {});
    return () => {
      live = false;
    };
  }, [lang]);
  return words?.lang === lang ? words.words : null;
}

/**
 * The picker's state (`datePick`) wired to the engine and the field: it reads
 * the field's `text` when it changes or the picker opens, writes each Date the
 * segments ask for, and hands `onPick` the text of the latest write that
 * landed.
 */
function useDatePick(text: string, lang: Lang, onPick: (text: string) => void) {
  const [state, dispatch] = useReducer(datePick, INITIAL_PICK);
  const [open, setOpen] = useState(false);

  // Typing in the field updates the picker. Text that is not a Date leaves
  // the segments as they were, so a pick in progress is not lost; an empty
  // field starts the picker afresh, so no segment writes the old Date back.
  // The reducer drops a read-back of the picker's own write.
  useEffect(() => {
    const value = text.trim();
    if (!value) {
      dispatch({ type: "cleared" });
      return;
    }
    let live = true;
    api
      .readDate(value, lang)
      .then((reading) => {
        if (live && reading.ok) dispatch({ type: "read", text, reading });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [text, open, lang]);

  // Each write asked for, from the text the field holds as it is asked.
  const { write, landed } = state;
  useEffect(() => {
    if (!write) return;
    const previous = text;
    api
      .writeDate(write.date, lang, previous)
      .then((written) =>
        dispatch({ type: "written", ticket: write.ticket, previous, text: written }),
      )
      .catch(() => {});
    // Only a new write asks the engine; `text` and `lang` are read as it is asked.
  }, [write]);

  // The latest write that landed, once.
  useEffect(() => {
    if (landed) onPick(landed.text);
  }, [landed]);

  const onOpenChange = (next: boolean) => {
    // Opening reads the field afresh: it may have been typed in since.
    // Closing commits a year still being typed.
    dispatch(next ? { type: "opened" } : { type: "commitYear" });
    setOpen(next);
  };

  return { segments: state.segments, reckoning: state.reckoning, dispatch, open, onOpenChange };
}

/**
 * Touch-sized in the phone Sheet, like the calendar's days; the Popover's
 * compact size from `md` up (the Sheet's breakpoint, `useIsMobile`).
 */
const FINGER = "min-h-10 md:min-h-8";

/** A Select trigger's height, overriding its fixed one: the same sizes. */
const TRIGGER = "data-[size=default]:h-10 md:data-[size=default]:h-8";

/** One choice in a segment's Select. */
interface SegmentItem {
  value: string;
  label: ReactNode;
}

/**
 * The day or month segment: a labelled Select whose first item empties it.
 * Items are `${testId}-<value>`, the empty one `${testId}-none`.
 */
function SegmentSelect({
  id,
  label,
  testId,
  value,
  onChange,
  noneLabel,
  items,
  disabled,
  numeric,
  className,
}: {
  id: string;
  label: string;
  testId: string;
  value: string | null;
  onChange: (value: string | null) => void;
  noneLabel: string;
  items: SegmentItem[];
  disabled?: boolean;
  /** Numbers, set in tabular figures. */
  numeric?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      <Label htmlFor={id} className="min-w-0 leading-snug">
        {label}
      </Label>
      <Select
        value={value ?? NONE}
        disabled={disabled}
        onValueChange={(v) => onChange(v === NONE ? null : v)}
      >
        <SelectTrigger
          id={id}
          data-testid={testId}
          className={cn("w-full min-w-0", numeric && "tabular-nums", TRIGGER)}
        >
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE} data-testid={`${testId}-none`} className={FINGER}>
            {noneLabel}
          </SelectItem>
          {items.map((item) => (
            <SelectItem
              key={item.value}
              value={item.value}
              data-testid={`${testId}-${item.value}`}
              className={cn(numeric && "tabular-nums", FINGER)}
            >
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The month segment's value: a civil month "1"–"12" or a Hebrew month's id. */
function monthValue(s: DateSegments): string | null {
  if (s.calendar === "hebrew") return s.hebrew;
  return s.month == null ? null : String(s.month);
}

/** The months the month segment offers, in its calendar. */
function monthItems(s: DateSegments, words: DateWords | null): SegmentItem[] {
  if (!words) return [];
  return s.calendar === "hebrew"
    ? words.hebrew_months.map((h) => ({ value: h.hebrew_month, label: h.name }))
    : words.civil_months.map((name, i) => ({ value: String(i + 1), label: name }));
}

/** The days the day segment offers: 1 up to the month's last. */
function dayItems(s: DateSegments): SegmentItem[] {
  return Array.from({ length: daysOf(s) }, (_, i) => ({
    value: String(i + 1),
    label: i + 1,
  }));
}

/** A two-way toggle segment (calendar, era), each item touch-sized. */
function SegmentToggle({
  label,
  testId,
  value,
  onChange,
  items,
  disabled,
  wide,
}: {
  label: string;
  testId: string;
  value: string;
  onChange: (value: string) => void;
  items: SegmentItem[];
  disabled?: boolean;
  /** Fill the row, the items sharing it and wrapping their labels. */
  wide?: boolean;
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      spacing={0}
      aria-label={label}
      data-testid={testId}
      className={cn(wide && "w-full min-w-0")}
      value={value}
      disabled={disabled}
      onValueChange={(v) => v && onChange(v)}
    >
      {items.map((item) => (
        <ToggleGroupItem
          key={item.value}
          value={item.value}
          data-testid={`${testId}-${item.value}`}
          className={cn("h-auto", wide && "min-w-0 flex-1 whitespace-normal", FINGER)}
        >
          {item.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/**
 * The year and era segments. The year is typed and written when committed
 * (Enter or leaving it); a year that is not one (0) is flagged, with a hint
 * under the row saying why.
 */
function YearRow({
  id,
  testId,
  segments,
  eraWords,
  disabled,
  dispatch,
}: {
  id: string;
  testId: string;
  segments: DateSegments;
  eraWords: { bce: string; ce: string } | undefined;
  disabled?: boolean;
  dispatch: Dispatch<PickAction>;
}) {
  const t = useT();
  const { year } = segments;
  const invalid = year !== "" && yearOf(year) == null;
  return (
    <>
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
            value={year}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${id}-year-hint` : undefined}
            onChange={(e) => dispatch({ type: "typeYear", year: e.target.value })}
            onBlur={() => dispatch({ type: "commitYear" })}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              dispatch({ type: "commitYear" });
            }}
          />
        </div>
        <SegmentToggle
          label={t.date_picker.era}
          testId={`${testId}-era`}
          value={segments.bce ? "bce" : "ce"}
          disabled={disabled}
          items={[
            { value: "bce", label: eraWords?.bce },
            { value: "ce", label: eraWords?.ce },
          ]}
          onChange={(v) => dispatch({ type: "era", bce: v === "bce" })}
        />
      </div>
      {invalid && (
        <p
          id={`${id}-year-hint`}
          data-testid={`${testId}-year-hint`}
          className="min-w-0 text-xs leading-snug text-destructive"
        >
          {t.date_picker.year_invalid}
        </p>
      )}
    </>
  );
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
 * "1513" never writes "1 BCE", "15 BCE"… on the way. The rules are
 * `datePick` (`src/lib/datePick.ts`).
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
   * `-year` (its hint `-year-hint`), `-era`, `-calendar` (`-calendar-civil`,
   * `-calendar-hebrew`), and the Select items
   * `-month-<1–12|nisan…adar_ii|none>`, `-day-<n|none>`.
   */
  testId: string;
  disabled?: boolean;
}) {
  const t = useT();
  const lang = useLang();
  const id = useId();
  const words = useDateWords(lang);
  const { segments, reckoning, dispatch, open, onOpenChange } = useDatePick(
    text,
    lang,
    onPick,
  );
  return (
    <PickerShell
      label={t.date_picker.open}
      icon={<CalendarClock />}
      testId={testId}
      open={open}
      onOpenChange={onOpenChange}
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
            onCheckedChange={(approx) => dispatch({ type: "approx", approx })}
          />
        </div>
        <SegmentToggle
          label={t.date_picker.calendar}
          testId={`${testId}-calendar`}
          value={segments.calendar}
          disabled={disabled}
          wide
          items={[
            { value: "civil", label: t.date_picker.civil },
            { value: "hebrew", label: t.date_picker.hebrew },
          ]}
          onChange={(v) =>
            dispatch({
              type: "calendar",
              calendar: v as Calendar,
              months: words?.hebrew_months ?? [],
            })
          }
        />
        <div className="flex min-w-0 flex-wrap items-end gap-3">
          <SegmentSelect
            id={`${id}-day`}
            label={t.date_picker.day}
            testId={`${testId}-day`}
            className="basis-20"
            numeric
            value={segments.day == null ? null : String(segments.day)}
            noneLabel={t.date_picker.no_day}
            items={dayItems(segments)}
            disabled={disabled || daysOf(segments) === 0}
            onChange={(v) => dispatch({ type: "day", day: v == null ? null : Number(v) })}
          />
          <SegmentSelect
            id={`${id}-month`}
            label={t.date_picker.month}
            testId={`${testId}-month`}
            className="flex-1 basis-32"
            value={monthValue(segments)}
            noneLabel={t.date_picker.no_month}
            items={monthItems(segments, words)}
            disabled={disabled}
            onChange={(month) => dispatch({ type: "month", month })}
          />
        </div>
        <YearRow
          id={id}
          testId={testId}
          segments={segments}
          eraWords={words?.eras[reckoning]}
          disabled={disabled}
          dispatch={dispatch}
        />
      </div>
    </PickerShell>
  );
}

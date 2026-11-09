import { useEffect, useId, useRef, useState } from "react";
import { CalendarClock } from "lucide-react";
import { api, type DatePick, type Reckoning } from "@/lib/api";
import { useLang, useT } from "@/i18n";
import { PickerShell } from "@/components/PickerShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** What the segments hold: the year as typed, so a half-typed one is kept. */
interface Segments {
  approx: boolean;
  year: string;
  bce: boolean;
}

const EMPTY: Segments = { approx: false, year: "", bce: true };

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
 * This slice sets a year: approximate, year, era.
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
  /** The shell's test id; segments are `${testId}-approx`, `-year`, `-era`. */
  testId: string;
  disabled?: boolean;
}) {
  const t = useT();
  const lang = useLang();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [segments, setSegments] = useState<Segments>(EMPTY);
  const [reckoning, setReckoning] = useState<Reckoning>("common");
  // Months and days are not segments yet: a pick here would drop them, so a
  // Date that has them is shown, not changed.
  const [finer, setFiner] = useState(false);
  // Only the latest pick's text lands.
  const latest = useRef(0);
  // The texts the picker wrote since it opened. Reading one back would only
  // echo the segments, and could land over a year still being typed: the
  // field can hand back an older pick's text after a newer one is written.
  const wrote = useRef(new Set<string>());

  // Typing in the field updates the picker. Text that is not a Date leaves
  // the segments as they were, so a pick in progress is not lost.
  useEffect(() => {
    let live = true;
    const value = text.trim();
    if (!value) {
      setFiner(false);
      return;
    }
    if (wrote.current.has(text)) return;
    api
      .readDate(value)
      .then((r) => {
        if (!live || !r.ok) return;
        setSegments({ approx: r.approx, year: String(r.era_year), bce: r.bce });
        setReckoning(r.reckoning);
        setFiner(r.precision !== "year");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [text, open]);

  const pick = (next: Segments) => {
    setSegments(next);
    const era_year = yearOf(next.year);
    if (era_year == null) return;
    const date: DatePick = { era_year, bce: next.bce, approx: next.approx };
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
  const locked = finer || disabled;
  return (
    <PickerShell
      label={t.date_picker.open}
      icon={<CalendarClock />}
      testId={testId}
      open={open}
      onOpenChange={(next) => {
        // Opening reads the field afresh: it may have been typed in since.
        if (next) wrote.current.clear();
        setOpen(next);
      }}
      disabled={disabled}
    >
      <div className="grid min-w-0 gap-3" data-testid={`${testId}-segments`}>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <Label htmlFor={`${id}-approx`} className="min-w-0 leading-snug">
            {t.date_picker.approx}
          </Label>
          <Switch
            id={`${id}-approx`}
            data-testid={`${testId}-approx`}
            checked={segments.approx}
            disabled={locked}
            onCheckedChange={(approx) => pick({ ...segments, approx })}
          />
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
              className="min-w-0 tabular-nums"
              value={segments.year}
              disabled={locked}
              aria-invalid={yearInvalid || undefined}
              onChange={(e) =>
                pick({ ...segments, year: e.target.value.replace(/\D/g, "") })
              }
            />
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            spacing={0}
            aria-label={t.date_picker.era}
            data-testid={`${testId}-era`}
            value={segments.bce ? "bce" : "ce"}
            disabled={locked}
            onValueChange={(v) => v && pick({ ...segments, bce: v === "bce" })}
          >
            <ToggleGroupItem
              value="bce"
              data-testid={`${testId}-era-bce`}
              className="h-auto min-h-8"
            >
              {eraWords.bce}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="ce"
              data-testid={`${testId}-era-ce`}
              className="h-auto min-h-8"
            >
              {eraWords.ce}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
    </PickerShell>
  );
}

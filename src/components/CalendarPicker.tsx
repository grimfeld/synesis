import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { enUS, fr } from "react-day-picker/locale";
import { useLang, useT } from "@/i18n";
import { readIsoDate, weekStartsOn, writeIsoDate } from "@/lib/calendarDate";
import { PickerShell } from "@/components/PickerShell";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";

/** The earliest year the year dropdown offers: before the first printed Bibles. */
const FIRST_YEAR = 1000;

/**
 * The calendar date picker beside a calendar date field (#120): a month
 * calendar with month and year dropdowns, Today and Clear, opened from a
 * button beside the field. A pick writes `YYYY-MM-DD`; text that is not ISO
 * is shown with nothing selected and stays as typed until a day is picked.
 * Opening and closing it writes nothing.
 *
 * Month and weekday names come from `Intl` in the app language, and the week
 * starts on the app language's first day, whatever the operating system says.
 */
export function CalendarPicker({
  text,
  onPick,
  testId,
  disabled,
}: {
  /** The field's text as typed. */
  text: string;
  /** The new text for the field: an ISO date, or "" for Clear. */
  onPick: (text: string) => void;
  /** The shell's test id; the buttons are `${testId}-today`, `-clear`. */
  testId: string;
  disabled?: boolean;
}) {
  const t = useT();
  const lang = useLang();
  const [open, setOpen] = useState(false);
  // The month shown, held here so a re-render of the panel around the
  // picker never sends it back to the month it opened on.
  const [month, setMonth] = useState<Date>(() => new Date());
  const selected = readIsoDate(text) ?? undefined;
  const today = new Date();
  const first = new Date(
    Math.min(FIRST_YEAR, selected?.getFullYear() ?? FIRST_YEAR),
    0,
  );
  const last = new Date(
    Math.max(today.getFullYear() + 20, selected?.getFullYear() ?? 0),
    11,
  );

  const write = (next: string) => {
    setOpen(false);
    if (next !== text) onPick(next);
  };

  return (
    <PickerShell
      label={t.calendar_picker.open}
      icon={<CalendarDays />}
      testId={testId}
      open={open}
      onOpenChange={(next) => {
        // Opening shows the field's day, or today's month.
        if (next) setMonth(selected ?? today);
        setOpen(next);
      }}
      disabled={disabled}
      className="w-auto"
    >
      <div className="grid min-w-0 justify-items-center gap-2">
        <Calendar
          // Larger days for a finger in the phone Sheet; the Sheet's own
          // background shows through, as the Popover's does.
          className="bg-transparent [--cell-size:--spacing(10)] md:[--cell-size:--spacing(7)]"
          mode="single"
          // A click on the day already picked keeps it, rather than unpicking.
          required
          captionLayout="dropdown"
          selected={selected}
          month={month}
          onMonthChange={setMonth}
          startMonth={first}
          endMonth={last}
          locale={lang === "fr" ? fr : enUS}
          weekStartsOn={weekStartsOn(lang)}
          formatters={{
            formatCaption: (d) =>
              d.toLocaleDateString(lang, { month: "long", year: "numeric" }),
            formatMonthDropdown: (d) =>
              d.toLocaleDateString(lang, { month: "short" }),
            formatYearDropdown: (d) => String(d.getFullYear()),
            formatWeekdayName: (d) =>
              d.toLocaleDateString(lang, { weekday: "short" }),
          }}
          onSelect={(day: Date) => write(writeIsoDate(day))}
        />
        <div className="flex w-full min-w-0 flex-wrap justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-auto min-h-8"
            data-testid={`${testId}-today`}
            onClick={() => write(writeIsoDate(new Date()))}
          >
            {t.calendar_picker.today}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto min-h-8"
            data-testid={`${testId}-clear`}
            disabled={!text.trim()}
            onClick={() => write("")}
          >
            {t.calendar_picker.clear}
          </Button>
        </div>
      </div>
    </PickerShell>
  );
}

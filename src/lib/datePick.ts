// The Date picker's month and day segments (#123, #124): which days a month
// offers, what a month or calendar change does to the day. Pure, so the rules
// are tested without the engine.

import type { HebrewMonth, HebrewMonthEntry } from "@/lib/api";

/** Civil month, 1–12, and day of the month; `null` when the segment is empty. */
export interface MonthDay {
  month: number | null;
  day: number | null;
}

/**
 * The days the civil month offers. February has 29: a Date's year may be far
 * enough back that whether it was a leap year is not the question.
 */
export function daysInMonth(month: number): number {
  if (month === 2) return 29;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * The segments after the month is set to `month`. Clearing the month clears
 * the day; a day the new month lacks becomes its last.
 */
export function withMonth(current: MonthDay, month: number | null): MonthDay {
  if (month == null) return { month: null, day: null };
  const day = current.day == null ? null : Math.min(current.day, daysInMonth(month));
  return { month, day };
}

/** Which calendar the month segment offers. */
export type Calendar = "civil" | "hebrew";

/**
 * The month segment: a civil month or a Hebrew one, by `calendar`, and the
 * day. The other calendar's month is always `null`.
 */
export interface MonthPick extends MonthDay {
  calendar: Calendar;
  hebrew: HebrewMonth | null;
}

/** Hebrew months run 1–30 in the picker, whichever month it is. */
const HEBREW_DAYS = 30;

/** The days the month segment offers: none until a month is chosen. */
export function daysOf(current: MonthPick): number {
  if (current.calendar === "hebrew") return current.hebrew == null ? 0 : HEBREW_DAYS;
  return current.month == null ? 0 : daysInMonth(current.month);
}

/** The segments after the Hebrew month is set; clearing it clears the day. */
export function withHebrewMonth<T extends MonthPick>(current: T, hebrew: HebrewMonth | null): T {
  return { ...current, hebrew, day: hebrew == null ? null : current.day };
}

/**
 * The segments after switching calendar: a chosen month becomes the other
 * calendar's month at the same place in the year (the engine sorts a Hebrew
 * month at the civil month it usually begins in), and a day it lacks becomes
 * its last. `months` are the engine's Hebrew months, in its order
 * (`api.dateWords`): a civil month becomes the first that begins in it.
 */
export function withCalendar(
  current: MonthPick,
  calendar: Calendar,
  months: readonly HebrewMonthEntry[],
): MonthPick {
  if (calendar === current.calendar) return current;
  if (calendar === "hebrew") {
    const hebrew =
      months.find((m) => m.civil_month === current.month)?.hebrew_month ?? null;
    const day = hebrew == null || current.day == null ? null : Math.min(current.day, HEBREW_DAYS);
    return { calendar, month: null, hebrew, day };
  }
  const month = months.find((m) => m.hebrew_month === current.hebrew)?.civil_month ?? null;
  return {
    calendar,
    hebrew: null,
    ...withMonth({ month, day: current.day }, month),
  };
}

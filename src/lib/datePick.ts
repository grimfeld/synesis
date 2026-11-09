// The Date picker's month and day segments (#123): which days a civil month
// offers, and what a month change does to the day. Pure, so the rules are
// tested without the engine.

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

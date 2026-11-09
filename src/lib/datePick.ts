// The Date picker's segments (#120, #123, #124): which days a month offers,
// what a month or calendar change does to the day, and the picker's state as
// a reducer (`datePick`): what a segment writes, when a typed year commits,
// which read-back of the field is only the picker's own write echoed. Pure,
// so the rules are tested without the engine; `useDatePick` drives it.

import type {
  DatePick,
  DatePreview,
  HebrewMonth,
  HebrewMonthEntry,
  Reckoning,
} from "@/lib/api";

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
export function withMonth<T extends MonthDay>(current: T, month: number | null): T {
  if (month == null) return { ...current, month: null, day: null };
  const day = current.day == null ? null : Math.min(current.day, daysInMonth(month));
  return { ...current, month, day };
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
export function withCalendar<T extends MonthPick>(
  current: T,
  calendar: Calendar,
  months: readonly HebrewMonthEntry[],
): T {
  if (calendar === current.calendar) return current;
  if (calendar === "hebrew") {
    const hebrew =
      months.find((m) => m.civil_month === current.month)?.hebrew_month ?? null;
    const day = hebrew == null || current.day == null ? null : Math.min(current.day, HEBREW_DAYS);
    return { ...current, calendar, month: null, hebrew, day };
  }
  const month = months.find((m) => m.hebrew_month === current.hebrew)?.civil_month ?? null;
  return withMonth({ ...current, calendar, hebrew: null }, month);
}

/** Every segment of the picker: the year as typed, so a half-typed one is kept. */
export interface DateSegments extends MonthPick {
  approx: boolean;
  year: string;
  bce: boolean;
}

/** The year typed, when it is one: a positive whole number the parser reads. */
export function yearOf(typed: string): number | null {
  if (!/^\d{1,5}$/.test(typed)) return null;
  const n = Number(typed);
  return n > 0 ? n : null;
}

/** The Date the segments make, for `write_date`; null without a year. */
export function datePickOf(s: DateSegments): DatePick | null {
  const era_year = yearOf(s.year);
  if (era_year == null) return null;
  // The day is written as the segments hold it: every month change clears it
  // with the month (`withMonth`, `withHebrewMonth`, `withCalendar`), and the
  // day segment stays closed until a month is chosen.
  return {
    era_year,
    bce: s.bce,
    approx: s.approx,
    ...(s.calendar === "hebrew"
      ? { hebrew_month: s.hebrew, day: s.day }
      : { month: s.month, day: s.day }),
  };
}

/** What the engine reads in the field's text (`read_date`), when it is a Date. */
export type DateReading = Omit<
  Extract<DatePreview, { ok: true }>,
  "ok" | "words" | "precision"
>;

/** The segments a reading of the field opens the picker on. */
function segmentsOf(r: DateReading): DateSegments {
  const hebrew = r.hebrew_month != null;
  return {
    approx: r.approx,
    year: String(r.era_year),
    bce: r.bce,
    calendar: hebrew ? "hebrew" : "civil",
    month: hebrew ? null : r.month,
    hebrew: r.hebrew_month,
    day: r.month == null ? null : r.day,
  };
}

/** The Date picker's state. */
export interface PickState {
  segments: DateSegments;
  /** The Reckoning of the field's text: which era words the picker shows. */
  reckoning: Reckoning;
  /** A year typed and not yet written. */
  yearTyped: boolean;
  /** The latest write the picker asked for, numbered: only its text lands. */
  write: { ticket: number; date: DatePick } | null;
  /** The number of the latest write asked for. */
  ticket: number;
  /**
   * The texts the picker wrote since it opened. Reading one back would only
   * echo the segments, and could land over a year still being typed: the
   * field can hand back an older pick's text after a newer one is written.
   */
  wrote: readonly string[];
  /** The text the latest write landed, for the field. */
  landed: { ticket: number; text: string } | null;
}

export type PickAction =
  /** The picker opened: it reads the field afresh. */
  | { type: "opened" }
  /** The field is empty: the picker starts afresh. */
  | { type: "cleared" }
  /** The engine read the field's `text`. */
  | { type: "read"; text: string; reading: DateReading }
  | { type: "approx"; approx: boolean }
  | { type: "era"; bce: boolean }
  | { type: "calendar"; calendar: Calendar; months: readonly HebrewMonthEntry[] }
  /** A civil month as "1"–"12", a Hebrew month by its id, or none. */
  | { type: "month"; month: string | null }
  | { type: "day"; day: number | null }
  /** The year as typed; it is written only when committed. */
  | { type: "typeYear"; year: string }
  /** Enter, leaving the year, or closing the picker. */
  | { type: "commitYear" }
  /** The engine wrote write `ticket` as `text`; the field held `previous`. */
  | { type: "written"; ticket: number; previous: string; text: string };

export const EMPTY_SEGMENTS: DateSegments = {
  approx: false,
  year: "",
  bce: true,
  calendar: "civil",
  month: null,
  hebrew: null,
  day: null,
};

export const INITIAL_PICK: PickState = {
  segments: EMPTY_SEGMENTS,
  reckoning: "common",
  yearTyped: false,
  write: null,
  ticket: 0,
  wrote: [],
  landed: null,
};

/** Set the segments and ask to write the Date they make, when they make one. */
function pick(state: PickState, segments: DateSegments): PickState {
  const date = datePickOf(segments);
  if (date == null) return { ...state, segments, yearTyped: false };
  const ticket = state.ticket + 1;
  return { ...state, segments, yearTyped: false, ticket, write: { ticket, date } };
}

/** The segments after the month segment is set to `month`, in their calendar. */
function monthSet(s: DateSegments, month: string | null): DateSegments {
  return s.calendar === "hebrew"
    ? withHebrewMonth(s, month as HebrewMonth | null)
    : withMonth(s, month == null ? null : Number(month));
}

/** The Date picker's reducer. */
export function datePick(state: PickState, action: PickAction): PickState {
  const s = state.segments;
  switch (action.type) {
    case "opened":
      return { ...state, wrote: [] };
    case "cleared":
      return { ...state, segments: EMPTY_SEGMENTS, reckoning: "common", yearTyped: false };
    case "read":
      if (state.wrote.includes(action.text)) return state;
      return {
        ...state,
        segments: segmentsOf(action.reading),
        reckoning: action.reading.reckoning,
      };
    case "approx":
      return pick(state, { ...s, approx: action.approx });
    case "era":
      return pick(state, { ...s, bce: action.bce });
    case "calendar":
      return pick(state, withCalendar(s, action.calendar, action.months));
    case "month":
      return pick(state, monthSet(s, action.month));
    case "day":
      return pick(state, { ...s, day: action.day });
    case "typeYear":
      return {
        ...state,
        segments: { ...s, year: action.year.replace(/\D/g, "") },
        yearTyped: true,
      };
    case "commitYear":
      return state.yearTyped ? pick(state, s) : state;
    case "written": {
      const { ticket, previous, text } = action;
      // Only the latest write lands, once, and only when it changed the text.
      const stale = ticket !== state.ticket || state.landed?.ticket === ticket;
      if (stale || text === previous) return state;
      return { ...state, wrote: [...state.wrote, text], landed: { ticket, text } };
    }
  }
}

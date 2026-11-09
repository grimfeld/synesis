import { describe, expect, it } from "vitest";
import type { HebrewMonthEntry } from "../api";
import {
  daysOf,
  withCalendar,
  withHebrewMonth,
  withMonth,
  daysInMonth,
  type MonthPick,
} from "../datePick";

describe("daysInMonth", () => {
  it("offers the days the civil month has, February up to 29", () => {
    expect(daysInMonth(1)).toBe(31);
    expect(daysInMonth(2)).toBe(29);
    expect(daysInMonth(4)).toBe(30);
    expect(daysInMonth(6)).toBe(30);
    expect(daysInMonth(9)).toBe(30);
    expect(daysInMonth(11)).toBe(30);
    expect(daysInMonth(12)).toBe(31);
  });
});

describe("withMonth", () => {
  it("clears the day when the month is cleared", () => {
    expect(withMonth({ month: 3, day: 14 }, null)).toEqual({ month: null, day: null });
  });

  it("keeps a day the new month has", () => {
    expect(withMonth({ month: 3, day: 14 }, 4)).toEqual({ month: 4, day: 14 });
  });

  it("brings a day the new month lacks back to its last", () => {
    expect(withMonth({ month: 1, day: 31 }, 2)).toEqual({ month: 2, day: 29 });
    expect(withMonth({ month: 3, day: 31 }, 4)).toEqual({ month: 4, day: 30 });
  });
});

const civil = (month: number | null, day: number | null): MonthPick => ({
  calendar: "civil",
  month,
  hebrew: null,
  day,
});

describe("Hebrew months", () => {
  it("offers days 1-30 in a Hebrew month, none without a month", () => {
    expect(daysOf({ calendar: "hebrew", month: null, hebrew: "nisan", day: null })).toBe(30);
    expect(daysOf({ calendar: "hebrew", month: null, hebrew: "adar_ii", day: null })).toBe(30);
    expect(daysOf({ calendar: "hebrew", month: null, hebrew: null, day: null })).toBe(0);
    expect(daysOf(civil(2, null))).toBe(29);
    expect(daysOf(civil(null, null))).toBe(0);
  });

  it("clears the day when the Hebrew month is cleared, and keeps it otherwise", () => {
    const nisan14: MonthPick = {
      calendar: "hebrew",
      month: null,
      hebrew: "nisan",
      day: 14,
    };
    expect(withHebrewMonth(nisan14, null)).toEqual({
      ...nisan14,
      hebrew: null,
      day: null,
    });
    expect(withHebrewMonth(nisan14, "adar_ii")).toEqual({
      ...nisan14,
      hebrew: "adar_ii",
    });
  });
});

// The engine's Hebrew months (crates/engine/src/api.rs `date_words`), in
// its order; the picker takes the order and the civil months from there.
const MONTHS: HebrewMonthEntry[] = [
  { hebrew_month: "nisan", name: "Nisan", civil_month: 4 },
  { hebrew_month: "tebeth", name: "Tebeth", civil_month: 1 },
  { hebrew_month: "shebat", name: "Shebat", civil_month: 2 },
  { hebrew_month: "adar", name: "Adar", civil_month: 3 },
  { hebrew_month: "adar_i", name: "Adar I", civil_month: 3 },
  { hebrew_month: "adar_ii", name: "Adar II", civil_month: 3 },
];

describe("withCalendar", () => {
  it("moves a civil month to the Hebrew month that usually begins in it", () => {
    expect(withCalendar(civil(4, 14), "hebrew", MONTHS)).toEqual({
      calendar: "hebrew",
      month: null,
      hebrew: "nisan",
      day: 14,
    });
    expect(withCalendar(civil(3, null), "hebrew", MONTHS)).toMatchObject({
      hebrew: "adar",
    });
    expect(withCalendar(civil(1, 31), "hebrew", MONTHS)).toMatchObject({
      hebrew: "tebeth",
      day: 30,
    });
  });

  it("moves a Hebrew month back to its civil month, Adar I and II to March", () => {
    const adar2: MonthPick = {
      calendar: "hebrew",
      month: null,
      hebrew: "adar_ii",
      day: 30,
    };
    expect(withCalendar(adar2, "civil", MONTHS)).toEqual(civil(3, 30));
    const shebat: MonthPick = {
      calendar: "hebrew",
      month: null,
      hebrew: "shebat",
      day: 30,
    };
    expect(withCalendar(shebat, "civil", MONTHS)).toEqual(civil(2, 29));
  });

  it("switches an empty month segment without a month or day", () => {
    expect(withCalendar(civil(null, null), "hebrew", MONTHS)).toEqual({
      calendar: "hebrew",
      month: null,
      hebrew: null,
      day: null,
    });
    const same = civil(5, 2);
    expect(withCalendar(same, "civil", MONTHS)).toBe(same);
  });
});

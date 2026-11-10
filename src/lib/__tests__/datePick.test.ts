import { describe, expect, it } from "vitest";
import type { HebrewMonthEntry } from "../api";
import {
  datePick,
  daysOf,
  INITIAL_PICK,
  withCalendar,
  withHebrewMonth,
  withMonth,
  daysInMonth,
  type MonthPick,
  type PickAction,
  type PickState,
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

  it("keeps the other segments, like withHebrewMonth", () => {
    expect(withMonth({ ...civil(3, 14), approx: true }, 4)).toEqual({
      ...civil(4, 14),
      approx: true,
    });
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

/** The state after each action in turn, from the picker's first state. */
const after = (...actions: PickAction[]): PickState =>
  actions.reduce(datePick, INITIAL_PICK);

const reading = {
  approx: false,
  era_year: 1000,
  bce: true,
  reckoning: "christian",
  month: null,
  hebrew_month: null,
  day: null,
} as const;

/** The engine reads `text` as `reading`, with `era_year` in place. */
const read = (text: string, era_year = 1000): PickAction => ({
  type: "read",
  text,
  reading: { ...reading, era_year },
});

describe("datePick", () => {
  it("opens on the Date the field holds, in its Reckoning, writing nothing", () => {
    const s = after(read("1000 BC (1 Sam 16)"));
    expect(s.segments).toMatchObject({ year: "1000", bce: true, month: null, day: null });
    expect(s.reckoning).toBe("christian");
    expect(s.write).toBeNull();
  });

  it("asks to write the Date a segment makes, each write numbered", () => {
    const s = after(read("1000 BC"), { type: "approx", approx: true });
    expect(s.write?.date).toEqual({
      era_year: 1000,
      bce: true,
      approx: true,
      month: null,
      day: null,
    });
    const t = datePick(s, { type: "era", bce: false });
    expect(t.write?.date).toMatchObject({ bce: false });
    expect(t.write!.ticket).toBeGreaterThan(s.write!.ticket);
  });

  it("does not reset the segments on a read-back of the text just written", () => {
    const s = after(read("1000 BC"), { type: "typeYear", year: "1010" }, { type: "commitYear" });
    const ticket = s.write!.ticket;
    const landed = datePick(s, { type: "written", ticket, previous: "1000 BC", text: "1010 BC" });
    expect(landed.landed).toEqual({ ticket, text: "1010 BC" });
    // A year typed since the write is still there when the field echoes it.
    const typing = datePick(landed, { type: "typeYear", year: "102" });
    expect(datePick(typing, read("1010 BC", 1010))).toBe(typing);
    // Reopening the picker reads the field afresh.
    const reopened = datePick(typing, { type: "opened" });
    expect(datePick(reopened, read("1010 BC", 1010)).segments.year).toBe("1010");
  });

  it("lands only the latest write, and not one that changes nothing", () => {
    const one = after(read("1000 BC"), { type: "approx", approx: true });
    const two = datePick(one, { type: "approx", approx: false });
    const stale = { type: "written", ticket: one.write!.ticket, previous: "1000 BC", text: "c. 1000 BC" } as const;
    expect(datePick(two, stale)).toBe(two);
    const same = { type: "written", ticket: two.write!.ticket, previous: "1000 BC", text: "1000 BC" } as const;
    expect(datePick(two, same)).toBe(two);
  });

  it("commits a typed year on blur or Enter, not while it is typed", () => {
    const typed = after(
      read("1000 BC"),
      { type: "typeYear", year: "1" },
      { type: "typeYear", year: "15" },
      { type: "typeYear", year: "1513" },
    );
    expect(typed.write).toBeNull();
    expect(typed.segments.year).toBe("1513");
    const committed = datePick(typed, { type: "commitYear" });
    expect(committed.write?.date).toMatchObject({ era_year: 1513 });
    // Committing again with nothing typed since writes nothing more.
    expect(datePick(committed, { type: "commitYear" })).toBe(committed);
  });

  it("keeps only the digits typed in the year", () => {
    expect(after({ type: "typeYear", year: "1a5-" }).segments.year).toBe("15");
  });

  it("writes nothing for a year that is not one", () => {
    const zero = after(read("1000 BC"), { type: "typeYear", year: "0" }, { type: "commitYear" });
    expect(zero.write).toBeNull();
    expect(zero.segments.year).toBe("0");
  });

  it("clears the day when the month is cleared", () => {
    const s = after(
      read("1000 BC"),
      { type: "month", month: 4 },
      { type: "day", day: 14 },
      { type: "month", month: null },
    );
    expect(s.segments).toMatchObject({ month: null, day: null });
    expect(s.write?.date).toMatchObject({ month: null, day: null });
  });

  it("clears the day when the Hebrew month is cleared", () => {
    const s = after(
      read("1000 BC"),
      { type: "calendar", calendar: "hebrew", months: MONTHS },
      { type: "hebrewMonth", hebrew: "nisan" },
      { type: "day", day: 14 },
    );
    expect(s.write?.date).toEqual({
      era_year: 1000,
      bce: true,
      approx: false,
      hebrew_month: "nisan",
      day: 14,
    });
    const cleared = datePick(s, { type: "hebrewMonth", hebrew: null });
    expect(cleared.segments).toMatchObject({ hebrew: null, day: null });
  });

  it("ignores a month of the calendar the segment is not on", () => {
    const civilPick = after(read("1000 BC"), { type: "month", month: 4 });
    expect(datePick(civilPick, { type: "hebrewMonth", hebrew: "nisan" })).toBe(civilPick);
    const hebrewPick = after(
      read("1000 BC"),
      { type: "calendar", calendar: "hebrew", months: MONTHS },
      { type: "hebrewMonth", hebrew: "nisan" },
    );
    expect(datePick(hebrewPick, { type: "month", month: 4 })).toBe(hebrewPick);
  });

  it("starts afresh on an empty field", () => {
    const s = after(read("1000 BC"), { type: "typeYear", year: "12" }, { type: "cleared" });
    expect(s.segments).toEqual(INITIAL_PICK.segments);
    expect(s.reckoning).toBe("common");
    expect(datePick(s, { type: "commitYear" })).toBe(s);
  });
});

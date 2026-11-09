import { describe, expect, it } from "vitest";
import { daysInMonth, withMonth } from "../datePick";

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

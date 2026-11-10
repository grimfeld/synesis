import { describe, expect, it } from "vitest";
import {
  calendarLocale,
  readIsoDate,
  weekStartsOn,
  writeIsoDate,
} from "../calendarDate";

describe("calendar dates", () => {
  it("reads an ISO date as that day", () => {
    const d = readIsoDate("1611-05-02");
    expect(d && [d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([
      1611, 4, 2,
    ]);
  });

  it("reads ISO text with surrounding spaces", () => {
    expect(readIsoDate(" 2026-09-08 ")?.getDate()).toBe(8);
  });

  it("does not read text that is not an ISO date", () => {
    for (const text of [
      "",
      "spring 1611",
      "1611",
      "2026-9-8",
      "08/09/2026",
      "2026-02-30",
      "2026-13-01",
    ])
      expect(readIsoDate(text), text).toBeNull();
  });

  it("writes a day as YYYY-MM-DD", () => {
    expect(writeIsoDate(new Date(1611, 4, 2))).toBe("1611-05-02");
    expect(writeIsoDate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("starts the week on Sunday in English and Monday in French", () => {
    expect(weekStartsOn("en")).toBe(0);
    expect(weekStartsOn("fr")).toBe(1);
  });

  it("names the calendar in the app language", () => {
    expect(calendarLocale("en").code).toBe("en-US");
    expect(calendarLocale("fr").code).toBe("fr");
    expect(calendarLocale("fr").labels?.labelMonthDropdown).toBe(
      "Choisir le mois",
    );
    expect(calendarLocale("fr").labels?.labelNext).toBe(
      "Aller au mois suivant",
    );
  });
});

import { describe, expect, it } from "vitest";
import { eventDateText } from "../events";

describe("eventDateText", () => {
  it("joins start and end into a span, as written", () => {
    expect(eventDateText({ type: "event", start: "c. 52 CE", end: "c. 55 CE" })).toBe("c. 52 CE – c. 55 CE");
  });
  it("shows start alone when there is no end", () => {
    expect(eventDateText({ type: "event", start: "14 Nisan 1513 BCE", end: null })).toBe("14 Nisan 1513 BCE");
    expect(eventDateText({ type: "event", start: "1513 BCE", end: "  " })).toBe("1513 BCE");
  });
  it("shows an end without a start as an open span", () => {
    expect(eventDateText({ type: "event", start: null, end: "52 CE" })).toBe("– 52 CE");
  });
  it("keeps unparseable text: the app never rewrites a Date", () => {
    expect(eventDateText({ type: "event", start: "not a date", end: null })).toBe("not a date");
  });
  it("is null for an undated Event and for every other type", () => {
    expect(eventDateText({ type: "event", start: null, end: null })).toBeNull();
    expect(eventDateText({ type: "event", start: "", end: "" })).toBeNull();
    expect(eventDateText({ type: "character", start: "1107 BCE", end: null })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { datePreviewText } from "../datePreview";
import type { DatePreview } from "../api";

// What the engine answers for a few values (crates/engine/src/api.rs
// `read_date`): the words are the engine's, in the app language, as the
// picker writes them.
const exodus = (words: string): DatePreview => ({
  ok: true,
  words,
  era_year: 1513,
  bce: true,
  reckoning: "common",
  month: null,
  hebrew_month: null,
  day: null,
  approx: true,
  precision: "year",
});
const passover = (words: string): DatePreview => ({
  ok: true,
  words,
  era_year: 33,
  bce: false,
  reckoning: "common",
  month: 4,
  hebrew_month: "nisan",
  day: 14,
  approx: false,
  precision: "day",
});
const april = (words: string): DatePreview => ({
  ok: true,
  words,
  era_year: 33,
  bce: false,
  reckoning: "common",
  month: 4,
  hebrew_month: null,
  day: null,
  approx: false,
  precision: "month",
});

describe("datePreviewText", () => {
  it("reads a year in English", () => {
    expect(datePreviewText(exodus("c. 1513 BCE"), en)).toEqual({
      ok: true,
      text: "c. 1513 BCE · year",
    });
  });
  it("reads a Hebrew day in English", () => {
    expect(datePreviewText(passover("14 Nisan 33 CE"), en).text).toBe(
      "14 Nisan 33 CE · day",
    );
  });
  it("shows the engine's words in French, as the picker writes them", () => {
    expect(datePreviewText(exodus("vers 1513 av. n. è."), fr).text).toBe(
      "vers 1513 av. n. è. · année",
    );
    expect(datePreviewText(passover("14 Nissan 33 de n. è."), fr).text).toBe(
      "14 Nissan 33 de n. è. · jour",
    );
  });
  it("names the precision in the app language", () => {
    expect(datePreviewText(april("April 33 CE"), en).text).toBe("April 33 CE · month");
    expect(datePreviewText(april("avril 33 de n. è."), fr).text).toBe(
      "avril 33 de n. è. · mois",
    );
  });
  it("says why a value is not a Date", () => {
    expect(datePreviewText({ ok: false, error: "no_era" }, en)).toEqual({
      ok: false,
      text: en.date_errors.no_era,
    });
    expect(datePreviewText({ ok: false, error: "span_in_one_value" }, fr).text).toBe(
      fr.date_errors.span_in_one_value,
    );
  });
  it("names a Span, never a range or a Period, when one value holds two", () => {
    expect(en.date_errors.span_in_one_value).toMatch(/\bSpan\b/);
    expect(en.date_errors.span_in_one_value).not.toMatch(/range|period/i);
    expect(fr.date_errors.span_in_one_value).toMatch(/\bSpan\b/);
    expect(fr.date_errors.span_in_one_value).not.toMatch(/période|intervalle/i);
  });
  it("gives examples in the picker's forms", () => {
    // What the picker writes: "vers", and the French Hebrew month names
    // (crates/engine/src/dates.rs `HEBREW_MONTHS`).
    for (const s of [
      fr.date_placeholder,
      fr.date_errors.no_era,
      fr.date_errors.unknown_month,
      fr.date_errors.unreadable,
    ]) {
      expect(s).not.toMatch(/\bv\. \d/);
      expect(s).not.toMatch(/\bnisan\b/);
    }
    expect(fr.date_placeholder).toBe("vers 1513 av. n. è.");
    expect(fr.date_errors.unknown_month).toMatch(/14 Nissan 33 de n\. è\./);
  });
});

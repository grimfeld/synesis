import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { datePreviewText } from "../datePreview";
import type { DatePreview } from "../api";

// What the engine answers for a few values (crates/engine/src/dates.rs).
const exodus: DatePreview = {
  ok: true,
  era_year: 1513,
  bce: true,
  era: "common",
  month: null,
  month_name: null,
  day: null,
  approx: true,
  precision: "year",
};
const passover: DatePreview = {
  ok: true,
  era_year: 33,
  bce: false,
  era: "common",
  month: 4,
  month_name: "nisan",
  day: 14,
  approx: false,
  precision: "day",
};
const april: DatePreview = {
  ok: true,
  era_year: 33,
  bce: false,
  era: "common",
  month: 4,
  month_name: null,
  day: null,
  approx: false,
  precision: "month",
};

describe("datePreviewText", () => {
  it("reads a year in English", () => {
    expect(datePreviewText(exodus, en, "en")).toEqual({
      ok: true,
      text: "≈ 1513 BCE · year",
    });
  });
  it("reads a Hebrew day in English", () => {
    expect(datePreviewText(passover, en, "en").text).toBe("14 Nisan 33 CE · day");
  });
  it("reads the same values in French, with French era markers", () => {
    expect(datePreviewText(exodus, fr, "fr").text).toBe("v. 1513 av. n. è. · année");
    expect(datePreviewText(passover, fr, "fr").text).toBe("14 nisan 33 de n. è. · jour");
  });
  it("names a civil month in the app language", () => {
    expect(datePreviewText(april, en, "en").text).toBe("April 33 CE · month");
    expect(datePreviewText(april, fr, "fr").text).toBe("avril 33 de n. è. · mois");
  });
  it("answers in the era family the user wrote, in the app language", () => {
    // "c. 1513 BC" or "v. 1513 av. J.-C."
    const bc: DatePreview = { ...exodus, era: "christian" };
    expect(datePreviewText(bc, en, "en").text).toBe("≈ 1513 BC · year");
    expect(datePreviewText(bc, fr, "fr").text).toBe("v. 1513 av. J.-C. · année");
    const ad: DatePreview = { ...passover, era: "christian" };
    expect(datePreviewText(ad, en, "en").text).toBe("14 Nisan 33 AD · day");
    expect(datePreviewText(ad, fr, "fr").text).toBe("14 nisan 33 ap. J.-C. · jour");
  });
  it("says why a value is not a Date", () => {
    expect(datePreviewText({ ok: false, error: "no_era" }, en, "en")).toEqual({
      ok: false,
      text: en.date_errors.no_era,
    });
    expect(
      datePreviewText({ ok: false, error: "span_in_one_value" }, fr, "fr").text,
    ).toBe(fr.date_errors.span_in_one_value);
  });
  it("names a Span, never a range or a Period, when one value holds two", () => {
    expect(en.date_errors.span_in_one_value).toMatch(/\bSpan\b/);
    expect(en.date_errors.span_in_one_value).not.toMatch(/range|period/i);
    expect(fr.date_errors.span_in_one_value).toMatch(/\bSpan\b/);
    expect(fr.date_errors.span_in_one_value).not.toMatch(/période|intervalle/i);
  });
});

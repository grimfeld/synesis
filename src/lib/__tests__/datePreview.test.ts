import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { datePreviewText } from "../datePreview";
import type { DatePreview } from "../api";

// What the engine answers for a few values (crates/engine/src/dates.rs).
const exodus: DatePreview = {
  ok: true,
  year: -1512,
  era_year: 1513,
  bce: true,
  month: null,
  month_name: null,
  day: null,
  approx: true,
  precision: "year",
};
const passover: DatePreview = {
  ok: true,
  year: 33,
  era_year: 33,
  bce: false,
  month: 4,
  month_name: "nisan",
  day: 14,
  approx: false,
  precision: "day",
};
const april: DatePreview = {
  ok: true,
  year: 33,
  era_year: 33,
  bce: false,
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
  it("says why a value is not a Date", () => {
    expect(datePreviewText({ ok: false, error: "no_era" }, en, "en")).toEqual({
      ok: false,
      text: en.date_errors.no_era,
    });
    expect(
      datePreviewText({ ok: false, error: "looks_like_range" }, fr, "fr").text,
    ).toBe(fr.date_errors.looks_like_range);
  });
});

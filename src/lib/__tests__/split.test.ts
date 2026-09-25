// Talk and Board side by side (Vitest, jsdom): `npm run test:unit`.
import { describe, expect, it } from "vitest";
import {
  clampRatio,
  DEFAULT_RATIO,
  MIN_PANE,
  ratioAt,
  splitFits,
} from "../split";

describe("splitFits", () => {
  it("needs room for both minimums", () => {
    expect(splitFits(MIN_PANE * 2)).toBe(true);
    expect(splitFits(MIN_PANE * 2 - 1)).toBe(false);
  });

  it("is false at phone width", () => {
    expect(splitFits(375)).toBe(false);
  });
});

describe("clampRatio", () => {
  it("keeps a ratio that already fits", () => {
    expect(clampRatio(0.4, 1000)).toBe(0.4);
  });

  it("keeps each side at its minimum", () => {
    expect(clampRatio(0.05, 1000)).toBeCloseTo(MIN_PANE / 1000);
    expect(clampRatio(0.95, 1000)).toBeCloseTo(1 - MIN_PANE / 1000);
  });

  it("is exactly half when only the minimums fit", () => {
    expect(clampRatio(0.2, MIN_PANE * 2)).toBeCloseTo(0.5);
    expect(clampRatio(0.8, MIN_PANE * 2)).toBeCloseTo(0.5);
  });

  it("falls back to half when nothing fits or the ratio is nonsense", () => {
    expect(clampRatio(0.3, 400)).toBe(DEFAULT_RATIO);
    expect(clampRatio(0.3, 0)).toBe(DEFAULT_RATIO);
    expect(clampRatio(Number.NaN, 1000)).toBe(DEFAULT_RATIO);
  });
});

describe("ratioAt", () => {
  it("is the pointer's share of the container", () => {
    expect(ratioAt(600, 100, 1000)).toBeCloseTo(0.5);
    expect(ratioAt(500, 100, 1000)).toBeCloseTo(0.4);
  });

  it("clamps a pointer dragged past either side", () => {
    expect(ratioAt(0, 100, 1000)).toBeCloseTo(MIN_PANE / 1000);
    expect(ratioAt(5000, 100, 1000)).toBeCloseTo(1 - MIN_PANE / 1000);
  });
});

// The Map's time slider: two ends and a middle, dragged in whole years.
import { describe, expect, it } from "vitest";
import { dragPeriod, sliderExtent, sliderStops } from "../periodSlider";

const bce = (n: number) => 1 - n;
const ext = { min: bce(2000), max: 100 };

describe("sliderExtent", () => {
  it("runs from the earliest to the latest year, in whole years", () => {
    expect(sliderExtent([bce(1446), 33.5, bce(587), 67])).toEqual({ min: bce(1446), max: 67 });
  });

  it("is null with no years, and widens a single year so it can be dragged", () => {
    expect(sliderExtent([])).toBeNull();
    expect(sliderExtent([30])).toEqual({ min: 29, max: 31 });
  });
});

describe("sliderStops", () => {
  it("puts an open end at the edge of the track", () => {
    expect(sliderStops(null, ext)).toEqual({ from: ext.min, to: ext.max });
    expect(sliderStops({ from: bce(640), to: null }, ext)).toEqual({ from: bce(640), to: ext.max });
  });

  it("orders the ends and keeps them on the track", () => {
    expect(sliderStops({ from: 50, to: bce(640) }, ext)).toEqual({ from: bce(640), to: 50 });
    expect(sliderStops({ from: bce(5000), to: 500 }, ext)).toEqual({ from: ext.min, to: ext.max });
  });
});

describe("dragPeriod", () => {
  const p = { from: bce(640), to: bce(580) };

  it("moves the start, never past the end or off the track", () => {
    expect(dragPeriod(p, "from", -10, ext)).toEqual({ from: bce(650), to: bce(580) });
    expect(dragPeriod(p, "from", 100, ext)).toEqual({ from: bce(580), to: bce(580) });
    expect(dragPeriod(p, "from", -5000, ext)).toEqual({ from: ext.min, to: bce(580) });
  });

  it("moves the end, never before the start or off the track", () => {
    expect(dragPeriod(p, "to", 20, ext)).toEqual({ from: bce(640), to: bce(560) });
    expect(dragPeriod(p, "to", -100, ext)).toEqual({ from: bce(640), to: bce(640) });
    expect(dragPeriod(p, "to", 5000, ext)).toEqual({ from: bce(640), to: ext.max });
  });

  it("moves the middle as a whole, keeping its width at the edges", () => {
    expect(dragPeriod(p, "middle", 100, ext)).toEqual({ from: bce(540), to: bce(480) });
    expect(dragPeriod(p, "middle", 5000, ext)).toEqual({ from: ext.max - 60, to: ext.max });
    expect(dragPeriod(p, "middle", -5000, ext)).toEqual({ from: ext.min, to: ext.min + 60 });
  });

  it("rounds to whole years", () => {
    expect(dragPeriod(p, "to", 2.6, ext)).toEqual({ from: bce(640), to: bce(577) });
  });

  it("leaves the other end open when one end of an open Period is dragged", () => {
    expect(dragPeriod({ from: bce(640), to: null }, "from", -10, ext)).toEqual({
      from: bce(650),
      to: null,
    });
    // No Period yet: dragging the end sets one, starting from the track's edge.
    expect(dragPeriod(null, "to", -100, ext)).toEqual({ from: null, to: 0 });
  });
});

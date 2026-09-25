// The Delivery view's timer and text size (Vitest): `npm run test:unit`.
import { describe, expect, it } from "vitest";
import {
  clampSize,
  clock,
  DEFAULT_SIZE,
  display,
  durationMinutes,
  elapsed,
  isRunning,
  MAX_SIZE,
  MIN_SIZE,
  newTimer,
  pause,
  reset,
  start,
} from "../delivery";

const MIN = 60_000;

describe("timer", () => {
  it("does not run until started", () => {
    const t = newTimer("a");
    expect(isRunning(t)).toBe(false);
    expect(elapsed(t, 10_000)).toBe(0);
  });

  it("counts while running and holds while paused", () => {
    let t = start(newTimer("a"), 1_000);
    expect(elapsed(t, 4_000)).toBe(3_000);
    t = pause(t, 4_000);
    expect(elapsed(t, 60_000)).toBe(3_000);
    t = start(t, 60_000);
    expect(elapsed(t, 62_000)).toBe(5_000);
  });

  it("ignores a second start and a pause while paused", () => {
    const t = start(newTimer("a"), 1_000);
    expect(start(t, 5_000)).toBe(t);
    const p = pause(t, 2_000);
    expect(pause(p, 9_000)).toBe(p);
  });

  it("resets to zero and keeps the Composition it was for", () => {
    const t = reset(pause(start(newTimer("a"), 0), 5_000));
    expect(elapsed(t, 99_000)).toBe(0);
    expect(t.for).toBe("a");
  });
});

describe("display", () => {
  it("counts up without a duration", () => {
    expect(display(newTimer(null), 0, null)).toEqual({
      text: "0:00",
      phase: "idle",
    });
    const t = start(newTimer(null), 0);
    expect(display(t, 65_000, null)).toEqual({
      text: "1:05",
      phase: "running",
    });
    expect(display(t, 3_725_000, null).text).toBe("1:02:05");
  });

  it("counts down from the duration, amber for the last two minutes", () => {
    expect(display(newTimer(null), 0, 25)).toEqual({
      text: "25:00",
      phase: "idle",
    });
    const t = start(newTimer(null), 0);
    expect(display(t, 500, 25)).toEqual({ text: "25:00", phase: "running" });
    expect(display(t, 22 * MIN, 25)).toEqual({
      text: "3:00",
      phase: "running",
    });
    expect(display(t, 23 * MIN, 25)).toEqual({
      text: "2:00",
      phase: "warning",
    });
    expect(display(t, 25 * MIN - 400, 25)).toEqual({
      text: "0:01",
      phase: "warning",
    });
  });

  it("shows overtime once time is up", () => {
    const t = start(newTimer(null), 0);
    expect(display(t, 25 * MIN, 25)).toEqual({ text: "+0:00", phase: "over" });
    expect(display(t, 26 * MIN + 30_000, 25)).toEqual({
      text: "+1:30",
      phase: "over",
    });
  });

  it("stays amber or red while paused", () => {
    const t = pause(start(newTimer(null), 0), 24 * MIN);
    expect(display(t, 99 * MIN, 25).phase).toBe("warning");
  });
});

describe("durationMinutes", () => {
  it("reads a number or a numeric string", () => {
    expect(durationMinutes(25)).toBe(25);
    expect(durationMinutes(" 40 ")).toBe(40);
    expect(durationMinutes(7.5)).toBe(7.5);
  });

  it("is null for nothing worth counting down from", () => {
    for (const v of [undefined, null, "", "half an hour", 0, -5, [], {}]) {
      expect(durationMinutes(v)).toBeNull();
    }
  });
});

describe("clock", () => {
  it("pads seconds and adds hours past sixty minutes", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(9_999)).toBe("0:09");
    expect(clock(60 * MIN)).toBe("1:00:00");
  });
});

describe("clampSize", () => {
  it("keeps the size within bounds", () => {
    expect(clampSize(1)).toBe(MIN_SIZE);
    expect(clampSize(1000)).toBe(MAX_SIZE);
    expect(clampSize(30.4)).toBe(30);
    expect(clampSize(Number.NaN)).toBe(DEFAULT_SIZE);
  });
});

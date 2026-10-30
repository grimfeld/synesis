// Desktop Windows (spec #35, issue #51), Vitest: `npm run test:unit`.
// How the text is kept the same across Windows is `docSync.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushThen, windowsOffered } from "../windows";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("a Window closing", () => {
  it("closes once its saves have landed", async () => {
    const order: string[] = [];
    await flushThen(
      async () => {
        await Promise.resolve();
        order.push("saved");
      },
      () => void order.push("closed"),
    );
    expect(order).toEqual(["saved", "closed"]);
  });

  it("still closes when saving fails or never answers", async () => {
    const closed = vi.fn();
    await flushThen(() => Promise.reject(new Error("no engine")), closed);
    expect(closed).toHaveBeenCalledTimes(1);
    const p = flushThen(() => new Promise(() => {}), closed, 3000);
    await vi.advanceTimersByTimeAsync(3000);
    await p;
    expect(closed).toHaveBeenCalledTimes(2);
  });
});

describe("Open in new Window", () => {
  it("is offered in the desktop app only", () => {
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
    expect(windowsOffered({ mode: "production", userAgent: mac, tauri: true })).toBe(true);
    expect(windowsOffered({ mode: "web", userAgent: mac, tauri: false })).toBe(false);
    expect(windowsOffered({ mode: "production", userAgent: "Mozilla/5.0 (iPhone)", tauri: true })).toBe(false);
    expect(windowsOffered({ mode: "production", userAgent: "Mozilla/5.0 (Linux; Android 14)", tauri: true })).toBe(false);
    // The dev bridge in a plain browser: no Tauri, so no Windows to make.
    expect(windowsOffered({ mode: "development", userAgent: mac, tauri: false })).toBe(false);
  });
});

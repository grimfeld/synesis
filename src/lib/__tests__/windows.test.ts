// Desktop Windows (spec #35, issue #51), Vitest: `npm run test:unit`.
// How the text is kept the same across Windows is `docSync.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn(() => false) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));

import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  closeOtherWindows,
  flushThen,
  guardWindowClose,
  isSecondaryWindow,
  windowStart,
  windowsOffered,
} from "../windows";

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

/** The desktop app in a Window labelled `label`; returns what the shell can send it. */
function desktopWindow(label: string) {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(invoke).mockReset().mockResolvedValue(null);
  const events = new Map<string, () => unknown>();
  vi.mocked(listen).mockReset().mockImplementation(async (name, cb) => {
    events.set(name, () => (cb as (e: unknown) => unknown)({ payload: {} }));
    return () => {};
  });
  const win = { label, destroy: vi.fn(async () => {}), onCloseRequested: vi.fn() };
  let closeRequested: (() => Promise<void>) | undefined;
  win.onCloseRequested.mockImplementation(async (cb: () => Promise<void>) => {
    closeRequested = cb;
    return () => {};
  });
  vi.mocked(getCurrentWindow).mockReset().mockReturnValue(win as never);
  return { win, events, close: () => closeRequested?.() };
}

describe("which Window this is", () => {
  afterEach(() => vi.mocked(isTauri).mockReturnValue(false));

  it("is secondary when opened with Open in new Window, and main otherwise", () => {
    desktopWindow("doc-1");
    expect(isSecondaryWindow()).toBe(true);
    desktopWindow("main");
    expect(isSecondaryWindow()).toBe(false);
    vi.mocked(getCurrentWindow).mockImplementation(() => {
      throw new Error("no window");
    });
    expect(isSecondaryWindow()).toBe(false);
    vi.mocked(isTauri).mockReturnValue(false);
    vi.mocked(getCurrentWindow).mockReturnValue({ label: "doc-1" } as never);
    expect(isSecondaryWindow()).toBe(false);
  });

  it("opens on the document it was opened for, asked once of the engine", async () => {
    desktopWindow("doc-1");
    vi.mocked(invoke).mockResolvedValue("notes/a.md");
    expect(await windowStart()).toBe("notes/a.md");
    expect(invoke).toHaveBeenCalledWith("window_start");
    vi.mocked(invoke).mockRejectedValue(new Error("no engine"));
    expect(await windowStart()).toBeNull();
    vi.mocked(isTauri).mockReturnValue(false);
    vi.mocked(invoke).mockClear();
    expect(await windowStart()).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("before the Vault changes", () => {
  afterEach(() => vi.mocked(isTauri).mockReturnValue(false));

  it("asks every other Window to save and close, where there are Windows", async () => {
    desktopWindow("main");
    await closeOtherWindows();
    expect(invoke).toHaveBeenCalledWith("close_other_windows");
    vi.mocked(isTauri).mockReturnValue(false);
    vi.mocked(invoke).mockClear();
    await closeOtherWindows();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("guarding a Window's typing", () => {
  afterEach(() => vi.mocked(isTauri).mockReturnValue(false));

  it("saves a secondary Window before it closes, by its button or the main Window's word", async () => {
    vi.useRealTimers();
    const w = desktopWindow("doc-1");
    const flush = vi.fn(async () => {});
    guardWindowClose(flush);
    await w.close();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(w.win.destroy).not.toHaveBeenCalled();
    await w.events.get("windows:close")!();
    await vi.waitFor(() => expect(w.win.destroy).toHaveBeenCalled());
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("has every Window save when the app quits, and says so", async () => {
    vi.useRealTimers();
    const w = desktopWindow("main");
    const flush = vi.fn(async () => {});
    guardWindowClose(flush);
    // The main Window's close is the shell's: no handler of its own here.
    expect(w.win.onCloseRequested).not.toHaveBeenCalled();
    expect(w.events.has("windows:close")).toBe(false);
    w.events.get("windows:flush")!();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("window_flushed"));
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("guards nothing where there are no Windows", () => {
    vi.mocked(listen).mockReset();
    guardWindowClose(async () => {});
    expect(listen).not.toHaveBeenCalled();
  });
});

// Desktop Windows (spec #35, issue #51), Vitest: `npm run test:unit`.
// What this Window tells the engine: the documents it shows, and its edits.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWindowSync, windowsOffered } from "../windows";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function sync() {
  const sent: { id: string; text: string }[] = [];
  const shown: string[][] = [];
  const w = createWindowSync({
    send: (id, text) => sent.push({ id, text }),
    show: (ids) => shown.push(ids),
    delay: 30,
  });
  return { w, sent, shown };
}

describe("the documents a Window shows", () => {
  it("are told to the engine as they open and close", () => {
    const { w, shown } = sync();
    const closeA = w.opened("a");
    w.opened("b");
    closeA();
    expect(shown).toEqual([["a"], ["a", "b"], ["b"]]);
  });

  it("count each document once, whatever opens it twice", () => {
    const { w, shown } = sync();
    const one = w.opened("a");
    w.opened("a");
    one();
    expect(shown).toEqual([["a"]]);
  });
});

describe("an edit in this Window", () => {
  it("goes out with the latest text after a short pause, not per keystroke", async () => {
    const { w, sent } = sync();
    w.edited("a", "h");
    w.edited("a", "he");
    w.edited("b", "x");
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(30);
    expect(sent).toEqual([
      { id: "a", text: "he" },
      { id: "b", text: "x" },
    ]);
  });

  it("goes out at once when its document closes here", () => {
    const { w, sent } = sync();
    const close = w.opened("a");
    w.edited("a", "last words");
    close();
    expect(sent).toEqual([{ id: "a", text: "last words" }]);
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

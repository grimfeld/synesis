// The Board on screen, as Commands reach it (PLAN §17.18).
import { describe, expect, it, vi } from "vitest";
import { activeBoard, registerBoard, whenBoard } from "../activeBoard";

const board = (id: string) => ({ id, exportPicture: vi.fn(async () => {}) });

describe("activeBoard", () => {
  it("finds the Board of one Composition, and forgets it once unmounted", () => {
    const a = board("a");
    const off = registerBoard(a);
    expect(activeBoard("a")).toBe(a);
    expect(activeBoard("b")).toBeUndefined();
    off();
    expect(activeBoard("a")).toBeUndefined();
  });

  it("prefers the most recently mounted Board of the same Composition", () => {
    const first = board("a");
    const second = board("a");
    const offFirst = registerBoard(first);
    const offSecond = registerBoard(second);
    expect(activeBoard("a")).toBe(second);
    offSecond();
    expect(activeBoard("a")).toBe(first);
    offFirst();
  });

  it("waits for a Board that is about to mount", async () => {
    const a = board("a");
    const waiting = whenBoard("a", 1000);
    const off = registerBoard(board("other"));
    const offA = registerBoard(a);
    await expect(waiting).resolves.toBe(a);
    off();
    offA();
  });

  it("gives up when the Board never mounts", async () => {
    vi.useFakeTimers();
    const waiting = whenBoard("never", 500);
    vi.advanceTimersByTime(600);
    await expect(waiting).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});

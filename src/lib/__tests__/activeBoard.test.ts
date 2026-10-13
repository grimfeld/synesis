// The Board on screen, as Commands reach it (PLAN §17.18).
import { describe, expect, it, vi } from "vitest";
import { activeBoard, placeOnBoard, registerBoard, whenBoard } from "../activeBoard";
import type { Board, DocSummary } from "../api";

const board = (id: string) => ({
  id,
  exportPicture: vi.fn(async () => {}),
  place: vi.fn((_doc: DocSummary) => {}),
});

const doc = { id: "n1", path: "Notes/joy.md", label: "Joy", type: "note" } as DocSummary;

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

// PLAN §17.10: the Candidates panel puts material on the Board.
describe("placeOnBoard", () => {
  const io = (stored: Board | null) => {
    const saved: Board[] = [];
    return {
      saved,
      getBoard: vi.fn(async () => stored),
      saveBoard: vi.fn(async (_id: string, b: Board) => {
        saved.push(b);
      }),
    };
  };

  it("goes through the Board on screen, which saves for itself", async () => {
    const b = board("talk");
    const off = registerBoard(b);
    const store = io(null);
    await expect(placeOnBoard("talk", doc, store)).resolves.toBe(false);
    expect(b.place).toHaveBeenCalledWith(doc);
    expect(store.saveBoard).not.toHaveBeenCalled();
    off();
  });

  it("writes the Board itself when none is on screen, even a Board not made yet", async () => {
    const store = io(null);
    await expect(placeOnBoard("talk", doc, store)).resolves.toBe(true);
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0].nodes).toMatchObject([{ type: "file", file: "Notes/joy.md", x: 0, y: 0 }]);
  });

  it("does not write when the document is on the Board already", async () => {
    const store = io({
      nodes: [{ id: "a", type: "file", file: "Notes/joy.md", x: 0, y: 0, width: 260, height: 140 }],
      edges: [],
    });
    await expect(placeOnBoard("talk", doc, store)).resolves.toBe(false);
    expect(store.saveBoard).not.toHaveBeenCalled();
  });
});

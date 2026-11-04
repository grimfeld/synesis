// Saving a Board without dropping an edit (issue #64), Vitest: `npm run test:unit`.
import { describe, expect, it } from "vitest";
import { createBoardSaver, type BoardSaveStatus } from "../boardSave";

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function disk() {
  const written: string[] = [];
  let fail = false;
  const statuses: BoardSaveStatus[] = [];
  const saver = createBoardSaver<string>(
    async (v) => {
      if (fail) throw new Error("disk full");
      written.push(v);
    },
    (s) => statuses.push(s),
  );
  return {
    saver,
    written,
    statuses,
    failing: (f: boolean) => (fail = f),
  };
}

describe("createBoardSaver", () => {
  it("writes what is pending once", async () => {
    const d = disk();
    d.saver.set("a");
    await d.saver.flush();
    await d.saver.flush();
    expect(d.written).toEqual(["a"]);
    expect(d.statuses).toEqual(["saving", "saved"]);
    expect(d.saver.hasPending()).toBe(false);
  });

  it("keeps a failed write pending, says so, and writes it on the next flush", async () => {
    const d = disk();
    d.failing(true);
    d.saver.set("a");
    await expect(d.saver.flush()).rejects.toThrow("disk full");
    expect(d.saver.hasPending()).toBe(true);
    expect(d.statuses.at(-1)).toBe("error");
    d.failing(false);
    await d.saver.flush();
    expect(d.written).toEqual(["a"]);
    expect(d.statuses.at(-1)).toBe("saved");
  });

  it("writes the newest edit after a failure, not the failed one", async () => {
    const d = disk();
    d.failing(true);
    d.saver.set("a");
    await d.saver.flush().catch(() => {});
    d.failing(false);
    d.saver.set("b");
    await d.saver.flush();
    expect(d.written).toEqual(["b"]);
  });

  it("never runs two writes at once, and an edit made during one goes next", async () => {
    const order: string[] = [];
    const first = deferred();
    let calls = 0;
    const saver = createBoardSaver<string>(
      async (v) => {
        order.push(`start ${v}`);
        if (calls++ === 0) await first.promise;
        order.push(`end ${v}`);
      },
      () => {},
    );
    saver.set("a");
    const one = saver.flush();
    saver.set("b");
    const two = saver.flush();
    first.resolve();
    await Promise.all([one, two]);
    expect(order).toEqual(["start a", "end a", "start b", "end b"]);
    expect(saver.hasPending()).toBe(false);
  });

  it("does nothing with nothing pending", async () => {
    const d = disk();
    await d.saver.flush();
    expect(d.statuses).toEqual([]);
  });
});

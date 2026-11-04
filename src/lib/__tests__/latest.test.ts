// The stale-reply guard (issues #71, #72), Vitest: `npm run test:unit`.
import { describe, expect, it, vi } from "vitest";
import { createLatest, deliverLatest } from "../latest";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("createLatest", () => {
  it("keeps only the newest ticket current", () => {
    const l = createLatest();
    const a = l.begin();
    expect(a()).toBe(true);
    const b = l.begin();
    expect(a()).toBe(false);
    expect(b()).toBe(true);
  });

  it("makes every ticket stale on cancel", () => {
    const l = createLatest();
    const a = l.begin();
    l.cancel();
    l.cancel();
    expect(a()).toBe(false);
    expect(l.begin()()).toBe(true);
  });

  it("lets the second of two answers win when the first lands last", async () => {
    const l = createLatest();
    const shown: string[] = [];
    const ask = async (p: Promise<string>) => {
      const current = l.begin();
      const v = await p;
      if (current()) shown.push(v);
    };
    const first = deferred<string>();
    const second = deferred<string>();
    const done = Promise.all([ask(first.promise), ask(second.promise)]);
    second.resolve("new");
    await settle();
    first.resolve("old");
    await done;
    expect(shown).toEqual(["new"]);
  });
});

describe("deliverLatest", () => {
  it("delivers the answer when nothing superseded it", async () => {
    const got = vi.fn();
    deliverLatest(Promise.resolve(1), got);
    await settle();
    expect(got).toHaveBeenCalledWith(1);
  });

  it("drops the answer once cancelled, as an effect cleanup does", async () => {
    const got = vi.fn();
    const failed = vi.fn();
    const slow = deferred<number>();
    const cancel = deliverLatest(slow.promise, got, failed);
    cancel();
    slow.resolve(1);
    await settle();
    expect(got).not.toHaveBeenCalled();
    const err = deferred<number>();
    deliverLatest(err.promise, got, failed)();
    err.reject(new Error("late"));
    await settle();
    expect(failed).not.toHaveBeenCalled();
  });

  it("reports a failure of the current request", async () => {
    const failed = vi.fn();
    deliverLatest(Promise.reject(new Error("no")), () => {}, failed);
    await settle();
    expect(failed).toHaveBeenCalledOnce();
  });
});

// Reading from the engine: who a vault change concerns, and which answer is
// allowed to speak when several are in flight.
import { describe, expect, it, vi } from "vitest";
import type { ChangedPayload, DocSummary, DocType } from "../api";
import { createQuery, matches, type QueryDeps } from "../query";

function doc(id: string, type: DocType): DocSummary {
  return {
    id,
    path: `${type}s/${id}.md`,
    title: id,
    label: id,
    type,
    mtime: 0,
  } as DocSummary;
}

function change(changed: DocSummary[], removed: string[] = []): ChangedPayload {
  return { changed, removed };
}

/** A promise plus the handles to settle it when the test decides to. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("matches", () => {
  it("wakes a type query only for its own types", () => {
    const deps: QueryDeps = { types: ["source"] };
    expect(matches(deps, change([doc("a", "source")]))).toBe(true);
    expect(matches(deps, change([doc("a", "note")]))).toBe(false);
  });

  it("leaves the Library alone while a Note is being written", () => {
    // The whole point: a keystroke that reaches disk used to refetch every view.
    const library: QueryDeps = { types: ["source"] };
    const clippings: QueryDeps = { types: ["clipping"] };
    const saved = change([doc("n", "note")]);
    expect(matches(library, saved)).toBe(false);
    expect(matches(clippings, saved)).toBe(false);
  });

  it("wakes an id query only for its own document", () => {
    const deps: QueryDeps = { ids: ["01H"] };
    expect(matches(deps, change([doc("01H", "note")]))).toBe(true);
    expect(matches(deps, change([doc("01J", "note")]))).toBe(false);
  });

  it("wakes an any query for any document", () => {
    expect(matches({ any: true }, change([doc("a", "note")]))).toBe(true);
  });

  it("never wakes a none query, whatever happened", () => {
    // The Device list: pairing refreshes it, saving a document does not.
    expect(matches({ none: true }, change([doc("a", "note")]))).toBe(false);
    expect(matches({ none: true }, change([], ["Sources/gone.md"]))).toBe(false);
  });

  it("wakes every document query on a removal, since the type is gone with it", () => {
    // `removed` is a path and the document has already left the index, so
    // nothing can say whether it was a Source. Deleting is rare; over-fetch.
    const removed = change([], ["Sources/gone.md"]);
    expect(matches({ types: ["source"] }, removed)).toBe(true);
    expect(matches({ types: ["note"] }, removed)).toBe(true);
    expect(matches({ ids: ["01H"] }, removed)).toBe(true);
    expect(matches({ any: true }, removed)).toBe(true);
  });
});

describe("createQuery", () => {
  it("reports the answer once it arrives", async () => {
    const q = createQuery({ fetch: async () => [1, 2, 3] });
    expect(q.state().status).toBe("loading");
    q.run();
    await vi.waitFor(() => expect(q.state().status).toBe("ready"));
    expect(q.state().data).toEqual([1, 2, 3]);
  });

  it("ignores an answer that arrives after a newer one was asked for", async () => {
    // Two runs in flight, the first settling last: the stale answer must not
    // win. This is the `alive` flag every view was writing by hand.
    const first = deferred<string>();
    const second = deferred<string>();
    const calls = [first, second];
    let n = 0;
    const q = createQuery({ fetch: () => calls[n++].promise });

    q.run();
    q.run();
    second.resolve("second");
    await vi.waitFor(() => expect(q.state().data).toBe("second"));

    first.resolve("first");
    await Promise.resolve();
    expect(q.state().data).toBe("second");
  });

  it("says nothing once cancelled", async () => {
    // The unmount case: the four views that forgot the guard set state on a
    // component that had gone away.
    const d = deferred<string>();
    const q = createQuery({ fetch: () => d.promise });
    const seen: string[] = [];
    q.subscribe((s) => s.data && seen.push(s.data));

    q.run();
    q.cancel();
    d.resolve("too late");
    await Promise.resolve();
    expect(seen).toEqual([]);
    expect(q.state().data).toBeNull();
  });

  it("keeps the previous object when equal says nothing changed", async () => {
    // The Graph's d3 layout is derived from identity: a new object with the
    // same shape throws the layout away and replays it.
    const shapes = [
      { nodes: ["a"] },
      { nodes: ["a"] },
      { nodes: ["a", "b"] },
    ];
    let n = 0;
    const q = createQuery({
      fetch: async () => shapes[n++],
      equal: (a, b) => a.nodes.join() === b.nodes.join(),
    });

    q.run();
    await vi.waitFor(() => expect(q.state().status).toBe("ready"));
    const first = q.state().data;

    q.run();
    await vi.waitFor(() => expect(q.state().data).toBe(first));

    q.run();
    await vi.waitFor(() => expect(q.state().data).not.toBe(first));
    expect(q.state().data).toEqual({ nodes: ["a", "b"] });
  });

  it("reports a failure instead of an empty answer", async () => {
    // Before this, a failed read rendered as an empty list: indistinguishable
    // from a vault that genuinely holds nothing.
    const onError = vi.fn();
    const q = createQuery({
      fetch: async () => {
        throw new Error("engine said no");
      },
      onError,
    });
    q.run();
    await vi.waitFor(() => expect(q.state().status).toBe("error"));
    expect(onError).toHaveBeenCalledOnce();
    expect(q.state().data).toBeNull();
  });

  it("keeps the last good answer on screen when a refetch fails", async () => {
    let ok = true;
    const q = createQuery({
      fetch: async () => {
        if (!ok) throw new Error("gone");
        return "good";
      },
      onError: () => {},
    });
    q.run();
    await vi.waitFor(() => expect(q.state().data).toBe("good"));

    ok = false;
    q.run();
    await vi.waitFor(() => expect(q.state().status).toBe("error"));
    expect(q.state().data).toBe("good");
  });

  it("asks once for a burst of runs when debounced", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(async () => "answer");
      const q = createQuery({ fetch, debounce: 180 });
      q.run();
      q.run();
      q.run();
      expect(fetch).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(180);
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not ask at all if cancelled inside the debounce window", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(async () => "answer");
      const q = createQuery({ fetch, debounce: 180 });
      q.run();
      q.cancel();
      await vi.advanceTimersByTimeAsync(180);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells subscribers and stops when unsubscribed", async () => {
    const q = createQuery({ fetch: async () => "x" });
    const cb = vi.fn();
    const off = q.subscribe(cb);
    q.run();
    await vi.waitFor(() => expect(cb).toHaveBeenCalled());
    const calls = cb.mock.calls.length;
    off();
    q.run();
    await vi.waitFor(() => expect(q.state().status).toBe("ready"));
    expect(cb.mock.calls.length).toBe(calls);
  });
});

describe("createQuery, remounted", () => {
  it("still answers after a cancel/run pair, the way StrictMode double-invokes", async () => {
    // React 19 in development runs an effect, cleans it up, and runs it again.
    // The cleanup cancels; the second run must not be silenced by it.
    const q = createQuery({ fetch: async () => "answer" });
    q.run();
    q.cancel();
    q.run();
    await vi.waitFor(() => expect(q.state().status).toBe("ready"));
    expect(q.state().data).toBe("answer");
  });
});

// Answers arrive out of order. A read asked twice in quick succession — the
// Graph's level switched twice, a save and a watcher event landing together —
// can have the first, slower answer arrive last and overwrite the second. The
// guard here numbers each request so only the newest may speak (issues #71,
// #72).
//
// One guard, used by `createQuery` (src/lib/query.ts), by the store's
// `refresh()` and by the few fetch effects still written by hand.

/** Is the request this came from still the newest one? */
export type Ticket = () => boolean;

export interface Latest {
  /** Start a request; every earlier ticket goes stale. */
  begin(): Ticket;
  /** Make every ticket stale (the asker went away). Safe to call twice. */
  cancel(): void;
}

/** A counter of requests where only the newest is current. */
export function createLatest(): Latest {
  let generation = 0;
  return {
    begin() {
      const mine = ++generation;
      return () => mine === generation;
    },
    cancel() {
      generation++;
    },
  };
}

/**
 * Deliver `promise`'s answer unless the returned cancel ran first: a
 * `useEffect` returns it as its cleanup, so the answer to an effect run that
 * has been superseded (its deps moved on, or the view unmounted) is dropped.
 */
export function deliverLatest<T>(
  promise: Promise<T>,
  onValue: (value: T) => void,
  onError: (e: unknown) => void = console.error,
): () => void {
  const latest = createLatest();
  const current = latest.begin();
  promise.then(
    (v) => {
      if (current()) onValue(v);
    },
    (e) => {
      if (current()) onError(e);
    },
  );
  return latest.cancel;
}

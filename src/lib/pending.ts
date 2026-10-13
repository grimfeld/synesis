// Writes still waiting on a debounce, so an action that reads from disk can
// have them land first.
//
// The editor saves a moment after the last keystroke and the Board a moment
// after the last drag. A Command that copies a document (Duplicate as new
// Composition) reads the file, so it would copy the text as it stood before
// the last few words. Each mounted writer registers how to flush itself; the
// Command flushes them all before it asks the engine.

type Flush = () => Promise<void> | void;

const flushes = new Map<string, Flush>();

/** Register a pending-write flush under `key`; returns the unregister. */
export function registerFlush(key: string, flush: Flush): () => void {
  flushes.set(key, flush);
  return () => {
    if (flushes.get(key) === flush) flushes.delete(key);
  };
}

/** Run every registered flush and wait for all of them. */
export async function flushPending(): Promise<void> {
  await Promise.all([...flushes.values()].map((f) => f()));
}

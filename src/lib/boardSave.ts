// Writing a Board to disk without ever dropping an edit (issue #64).
//
// The Board saves a moment after the last drag. A write can fail — a full
// disk, a file iCloud holds, a permission — and the Board on screen then has
// a change the file does not. What is pending stays pending until a write of
// it succeeds: the next edit or flush writes it (with whatever came after),
// and the status says it is not saved meanwhile. No timer loop: retrying a
// broken disk every few hundred milliseconds helps nobody.
//
// Kept free of React so it is tested once (`test:unit`).

export type BoardSaveStatus = "idle" | "saving" | "saved" | "error";

export interface BoardSaver<T> {
  /** Hold `value` to be written; it replaces anything not yet written. */
  set(value: T): void;
  /**
   * Write what is pending, after a write already in flight. Rejects when the
   * write failed; the value is then still pending.
   */
  flush(): Promise<void>;
  /** Whether something is waiting to be written. */
  hasPending(): boolean;
}

export function createBoardSaver<T>(
  write: (value: T) => Promise<void>,
  onStatus: (status: BoardSaveStatus, error?: unknown) => void,
): BoardSaver<T> {
  let pending: T | null = null;
  let inflight: Promise<void> | null = null;

  async function flush(): Promise<void> {
    // Never two writes at once: the later one must land last.
    while (inflight) await inflight.catch(() => {});
    const value = pending;
    if (value === null) return;
    onStatus("saving");
    const run = write(value).then(
      () => {
        // A newer edit made during the write is still to go.
        if (pending === value) {
          pending = null;
          onStatus("saved");
        }
      },
      (e) => {
        onStatus("error", e);
        throw e;
      },
    );
    inflight = run;
    try {
      await run;
    } finally {
      if (inflight === run) inflight = null;
    }
  }

  return {
    set(value) {
      pending = value;
    },
    flush,
    hasPending: () => pending !== null,
  };
}

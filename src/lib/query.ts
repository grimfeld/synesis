// Reading from the engine: the lifecycle every view repeated by hand — fetch,
// cancel the answer that arrived too late, decide whether a vault change is
// this query's business, and say out loud when it failed.
//
// Kept free of React so it is tested once (`test:unit`) and the views stay
// dumb shells — the `src/lib/board.ts` and `src/lib/timeline.ts` precedent.
// `useQuery` (src/lib/useQuery.ts) is the thin binding to useState/useEffect;
// everything that can be wrong lives here.
//
// The engine already says *what* changed (`vault:changed` carries the changed
// DocSummaries), so a query declares what it depends on and is left alone when
// the change is none of its business. Before this, one counter meant a Note
// saved in the editor refetched the Library, the Map and the Graph.
import type { ChangedPayload, DocType } from "./api";

/**
 * What a vault change has to touch for a query to care.
 *
 * Exactly one of these is set. `none` is for reads a document change cannot
 * affect at all (the Device list); they refresh only when asked.
 */
export type QueryDeps =
  | { types: DocType[]; ids?: never; any?: never; none?: never }
  | { ids: string[]; types?: never; any?: never; none?: never }
  | { any: true; types?: never; ids?: never; none?: never }
  | { none: true; types?: never; ids?: never; any?: never };

/**
 * Whether `change` is this query's business.
 *
 * A removal is deliberately coarse: `ChangedPayload.removed` carries a
 * relative path, not an id, and the document is already out of the index by
 * the time we hear about it (`src-tauri/src/watch.rs`), so nothing can say
 * what type it was. Deleting is rare and refetching is cheap; guessing the
 * type from the folder would put the vault's layout in the UI. Edits — the
 * keystroke path — stay precise, which is the point.
 */
export function matches(deps: QueryDeps, change: ChangedPayload): boolean {
  if (deps.none) return false;
  if (change.removed.length > 0) return true;
  if (deps.any) return true;
  if (deps.ids) return change.changed.some((d) => deps.ids!.includes(d.id));
  return change.changed.some((d) => deps.types!.includes(d.type));
}

export type QueryStatus = "loading" | "ready" | "error";

export interface QueryState<T> {
  /** The last successful answer, kept while a refetch is in flight. */
  data: T | null;
  status: QueryStatus;
  error: unknown;
}

export interface QueryOptions<T> {
  fetch: () => Promise<T>;
  /**
   * Keep the previous object when the new answer means the same thing, so a
   * consumer that derives state from identity (the Graph's d3 layout) is not
   * thrown away and replayed on every save. Compares the answers, not the
   * request.
   */
  equal?: (prev: T, next: T) => boolean;
  /** Wait this long before asking, restarting the wait on every run(). */
  debounce?: number;
  /** Called when a fetch rejects. The view never has to remember to. */
  onError?: (e: unknown) => void;
}

export interface Query<T> {
  state(): QueryState<T>;
  /** Fetch now (after `debounce`, if set). Supersedes anything in flight. */
  run(): void;
  /** Drop everything in flight and pending. Safe to call twice. */
  cancel(): void;
  subscribe(cb: (s: QueryState<T>) => void): () => void;
}

/**
 * One read, over time.
 *
 * Answers arrive out of order and after the thing that asked has gone away, so
 * every run is numbered and only the newest may speak. That is the `alive`
 * flag the views were each writing by hand, in one place and testable — and in
 * the four views that forgot it (the Map, Coverage, Settings, and a Hub's
 * reload), it is the bug fixed.
 */
export function createQuery<T>(options: QueryOptions<T>): Query<T> {
  const { fetch, equal, debounce, onError } = options;
  let state: QueryState<T> = { data: null, status: "loading", error: null };
  const subscribers = new Set<(s: QueryState<T>) => void>();
  // Monotonic: the newest run wins, whatever order the promises settle in.
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function emit(next: QueryState<T>): void {
    state = next;
    for (const cb of subscribers) cb(state);
  }

  async function ask(mine: number): Promise<void> {
    try {
      const value = await fetch();
      if (mine !== generation) return;
      // A fresh answer that means the old thing keeps the old object.
      const data =
        state.data !== null && equal?.(state.data, value) ? state.data : value;
      emit({ data, status: "ready", error: null });
    } catch (e) {
      if (mine !== generation) return;
      // The last good answer stays on screen; an error is not an empty list.
      emit({ data: state.data, status: "error", error: e });
      onError?.(e);
    }
  }

  return {
    state: () => state,
    run() {
      const mine = ++generation;
      if (timer !== undefined) clearTimeout(timer);
      if (state.status !== "loading")
        emit({ ...state, status: "loading", error: null });
      if (debounce === undefined) {
        void ask(mine);
        return;
      }
      timer = setTimeout(() => {
        timer = undefined;
        void ask(mine);
      }, debounce);
    },
    cancel() {
      generation++;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    subscribe(cb) {
      subscribers.add(cb);
      return () => void subscribers.delete(cb);
    },
  };
}

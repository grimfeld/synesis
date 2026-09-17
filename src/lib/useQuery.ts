// Reading from the engine, from a React view: the binding between a `Query`
// (src/lib/query.ts, where the lifecycle actually lives) and useState.
//
// A view says what it wants and what would make it stale; it gets back the
// answer, whether the answer has arrived, and a way to ask again. Everything
// that used to be written out per view — the `alive` flag, the `.catch`, the
// decision to refetch on every save in the vault — is gone from the view.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useT } from "@/i18n";
import { createQuery, matches, type QueryDeps, type QueryState } from "./query";
import { useStore } from "./store";

export interface UseQueryOptions<T> {
  /**
   * Values the answer depends on. Changing any of them asks again, the way a
   * useEffect dependency array does.
   */
  key: readonly unknown[];
  /** What a vault change has to touch for this query to be stale. */
  deps: QueryDeps;
  fetch: () => Promise<T>;
  /** Keep the previous object when the new answer means the same thing. */
  equal?: (prev: T, next: T) => boolean;
  /** Wait this long before asking, restarting the wait while `key` moves. */
  debounce?: number;
  /** Don't ask yet (the document isn't loaded, the panel is shut). */
  enabled?: boolean;
  /**
   * Don't tell the user when this one fails.
   *
   * For reads whose failure is an ordinary answer rather than a fault: a
   * Source with no picture in the vault falls back to a drawn Cover (ADR
   * 0012), and saying "could not read from the vault" about it would be a
   * lie. `status` still reports the error to the caller.
   */
  quiet?: boolean;
}

export interface UseQueryResult<T> extends QueryState<T> {
  /** Ask again now, whatever the deps say. */
  refetch: () => void;
}

/**
 * One read from the engine, kept fresh.
 *
 * Failure is reported, never swallowed: a read that fails used to render as an
 * empty list, which reads as "you have nothing" rather than "this is broken".
 * A view may branch on `status` to say so in place; if it doesn't, the toast
 * still happens.
 */
export function useQuery<T>(options: UseQueryOptions<T>): UseQueryResult<T> {
  const {
    key,
    deps,
    fetch,
    equal,
    debounce,
    enabled = true,
    quiet = false,
  } = options;
  const s = useStore();
  const t = useT();

  // The query outlives any single render; the callbacks it holds must not.
  const latest = useRef({ fetch, equal, quiet, failed: t.load_failed });
  latest.current = { fetch, equal, quiet, failed: t.load_failed };

  const query = useMemo(
    () =>
      createQuery<T>({
        fetch: () => latest.current.fetch(),
        equal: (a, b) => latest.current.equal?.(a, b) ?? false,
        debounce,
        onError: (e) => {
          if (latest.current.quiet) return;
          console.error(e);
          toast(latest.current.failed);
        },
      }),
    // A query per call site, rebuilt only if the debounce itself changes.
    [debounce],
  );

  const [state, setState] = useState<QueryState<T>>(() => query.state());

  useEffect(() => query.subscribe(setState), [query]);

  // `key` and `deps` are written as literals at the call site, so they are new
  // objects on every render. Compare them by value; a dependency array cannot
  // change length between renders, so they are folded into one string rather
  // than spread.
  const keyId = JSON.stringify(key);
  const depsId = JSON.stringify(deps);

  // Ask on mount and whenever the request itself changes.
  useEffect(() => {
    if (!enabled) return;
    query.run();
    return () => query.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, enabled, keyId]);

  // Ask again when the vault changes in a way this query cares about. The
  // engine says what changed; most queries turn out not to be involved.
  const change = s.lastChange;
  useEffect(() => {
    if (!enabled || !change) return;
    if (matches(deps, change)) query.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, enabled, change, depsId]);

  const refetch = useCallback(() => query.run(), [query]);

  return { ...state, refetch };
}

// The Kinship query (every tie in the Vault) as the Hub's Family, Relations
// and tree button, the Show in Family tree Command and the Family tree read
// it: each call site its own query, kept fresh on any change, but the
// requests made for the same Vault change share one engine call.
import type { Kinship } from "./api";
import { sharedKinship } from "./sharedKinship";
import { useQuery, type UseQueryResult } from "./useQuery";
import { useStore } from "./store";

export function useKinship(o: {
  key: readonly unknown[];
  enabled?: boolean;
  quiet?: boolean;
  equal?: (a: Kinship, b: Kinship) => boolean;
}): UseQueryResult<Kinship> {
  const s = useStore();
  return useQuery({
    key: ["kinship", ...o.key],
    // Any page can become, or stop being, a Character: no type list will do.
    deps: { any: true },
    fetch: () => sharedKinship(s.lastChange),
    enabled: o.enabled,
    quiet: o.quiet,
    equal: o.equal,
  });
}

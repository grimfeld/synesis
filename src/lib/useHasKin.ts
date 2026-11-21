// Whether a Character has kin, read live from the Kinship query: the Hub's
// Family tree button and the Show in Family tree Command offer the tree only
// then (#155), by the one rule `hasKin` (src/lib/kinship.ts).
import { api } from "./api";
import { hasKin } from "./kinship";
import { useQuery } from "./useQuery";

/** `false` while not yet known, or when `enabled` is off. */
export function useHasKin(id: string | null, o: { enabled?: boolean; mtime?: number } = {}): boolean {
  const enabled = (o.enabled ?? true) && !!id;
  const { data } = useQuery({
    key: ["kinship", id, o.mtime],
    // Any page can become, or stop being, a Character: no type list will do.
    deps: { any: true },
    fetch: () => api.kinship(),
    enabled,
    quiet: true,
  });
  return enabled && !!data && hasKin(data, id!);
}

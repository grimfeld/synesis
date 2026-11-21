// Whether a Character has kin, read live from the Kinship query: the Hub's
// Family tree button and the Show in Family tree Command offer the tree only
// then (#155), by the one rule `hasKin` (src/lib/kinship.ts).
import { hasKin } from "./kinship";
import { useKinship } from "./useKinship";

/** `false` while not yet known, or when `enabled` is off. */
export function useHasKin(id: string | null, o: { enabled?: boolean; mtime?: number } = {}): boolean {
  const enabled = (o.enabled ?? true) && !!id;
  const { data } = useKinship({ key: [id, o.mtime], enabled, quiet: true });
  return enabled && !!data && hasKin(data, id!);
}

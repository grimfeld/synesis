// The folder-sync Tutorials (docs/tutorials/sync-<method>.<device>.<lang>.md,
// PLAN §25.3) and the rules from ./syncRules, re-exported for the UI.
import type { Lang } from "./api";
import { DEVICE_KINDS, methodsFor, type DeviceKind, type Method } from "./syncRules";
import { syncTutorialId, tutorialSource } from "./tutorials";

export * from "./syncRules";

/** Tutorial markdown for a method on a Device kind, in the UI language. No English fallback (PLAN §25.4). */
export function tutorial(method: Method, kind: DeviceKind, lang: Lang): string | null {
  return tutorialSource(syncTutorialId(method, kind), lang);
}

/** Device kinds that have a tutorial for this method, current one first. */
export function tutorialKinds(method: Method, current: DeviceKind): DeviceKind[] {
  const kinds = DEVICE_KINDS.filter((k) => methodsFor(k).includes(method));
  return [...kinds.filter((k) => k === current), ...kinds.filter((k) => k !== current)];
}

// Bundled sync tutorials (docs/sync/<method>.<device>.<lang>.md) and the rules
// from ./syncRules, re-exported for the UI.
import type { Lang } from "./api";
import { DEVICE_KINDS, methodsFor, type DeviceKind, type Method } from "./syncRules";

export * from "./syncRules";

const files = import.meta.glob("../../docs/sync/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/** Tutorial markdown for a method on a Device kind, in the UI language (English fallback). */
export function tutorial(method: Method, kind: DeviceKind, lang: Lang): string | null {
  const find = (l: string) => Object.entries(files).find(([k]) => k.endsWith(`/${method}.${kind}.${l}.md`))?.[1];
  return find(lang) ?? find("en") ?? null;
}

/** Device kinds that have a tutorial for this method, current one first. */
export function tutorialKinds(method: Method, current: DeviceKind): DeviceKind[] {
  const kinds = DEVICE_KINDS.filter((k) => methodsFor(k).includes(method));
  return [...kinds.filter((k) => k === current), ...kinds.filter((k) => k !== current)];
}

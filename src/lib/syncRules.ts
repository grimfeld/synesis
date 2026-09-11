// Free multi-device sync: which method covers which set of Devices. Pure
// rules, no Vite-specific imports, so unit tests can load this file.
import type { SyncLocation } from "./api";

export type DeviceKind = "mac" | "windows" | "linux" | "ios" | "android";
export const DEVICE_KINDS: DeviceKind[] = ["mac", "windows", "linux", "ios", "android"];

/** The three documented free methods. */
export type Method = "icloud" | "syncthing" | "provider";
export const METHODS: Method[] = ["icloud", "syncthing", "provider"];

/** Tauri's `std::env::consts::OS` -> Device kind. */
export function platformToKind(os: string): DeviceKind {
  switch (os) {
    case "macos":
      return "mac";
    case "windows":
      return "windows";
    case "ios":
      return "ios";
    case "android":
      return "android";
    default:
      return "linux";
  }
}

/** Methods that have a tutorial for a Device kind. */
export function methodsFor(kind: DeviceKind): Method[] {
  switch (kind) {
    case "mac":
      return ["icloud", "syncthing", "provider"];
    case "ios":
      return ["icloud"];
    case "android":
      return ["syncthing"];
    default:
      return ["syncthing", "provider"];
  }
}

export interface Recommendation {
  /** The method to set up, or null when only one Device or no free method exists. */
  method: Method | null;
  /** Other methods that also cover the set. */
  alternatives: Method[];
  /** iPhone/iPad together with Android: no free method reaches both. */
  impossible: boolean;
}

/** Decision rule from docs/PLAN.md §14. */
export function recommend(devices: Set<DeviceKind>): Recommendation {
  if (devices.size <= 1) return { method: null, alternatives: [], impossible: false };
  const has = (k: DeviceKind) => devices.has(k);
  const every = (ks: DeviceKind[]) => [...devices].every((d) => ks.includes(d));
  if (has("ios") && has("android")) return { method: null, alternatives: [], impossible: true };
  if (has("android")) return { method: "syncthing", alternatives: [], impossible: false };
  if (has("ios")) {
    // iCloud Drive runs on macOS, iOS and Windows; not on Linux.
    if (every(["mac", "ios", "windows"])) return { method: "icloud", alternatives: [], impossible: false };
    return { method: null, alternatives: [], impossible: true };
  }
  if (every(["mac"])) return { method: "icloud", alternatives: ["syncthing", "provider"], impossible: false };
  return { method: "provider", alternatives: ["syncthing"], impossible: false };
}

/** Which sync-tool folders (from the engine's `sync_locations`) belong to a method. */
export function locationsFor(method: Method, all: SyncLocation[]): SyncLocation[] {
  const wanted: SyncLocation["method"][] = method === "provider" ? ["onedrive", "gdrive", "dropbox"] : [method];
  return all.filter((l) => wanted.includes(l.method));
}


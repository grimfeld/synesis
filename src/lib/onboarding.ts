// What the Welcome wizard decides before it renders anything: which way in the
// user picked, where the Vault will land, and whether that folder is one they
// can reach (PLAN §21, ADR 0015). Pure — no Tauri, no Vite — so the rules are
// unit-tested rather than clicked through in Cypress.
import type { StorageAccess, SyncLocations } from "./api";

/** The three ways into a Vault, in the order the chooser offers them. */
export type Route = "pairing" | "folder" | "local";
export const ROUTES: Route[] = ["pairing", "folder", "local"];

/** Where a Vault will be written, and whether its owner can browse it. */
export interface Destination {
  path: string;
  /** False when the folder is the private fallback Android hides. */
  visible: boolean;
  /** True when granting a permission would move it somewhere visible. */
  canAsk: boolean;
}

/** Nothing stands in the way unless Android says it does. */
export function visible(storage: StorageAccess | undefined): boolean {
  if (!storage) return true;
  return !storage.needed || storage.granted;
}

/** Whether to offer the "let me reach this folder" button at all. */
export function canAsk(storage: StorageAccess | undefined): boolean {
  return !!storage && storage.needed && !storage.granted;
}

/**
 * Join a folder and a name the way the host does. The engine has the real
 * `free_path`; this only previews it, so a name that collides shows the
 * unsuffixed path until the engine answers with the sibling.
 */
export function joinPath(parent: string, name: string): string {
  const sep = parent.includes("\\") ? "\\" : "/";
  return parent.replace(/[\\/]+$/, "") + sep + name;
}

/**
 * What the Vault-location line says. On mobile the path is derived and the
 * user never types one; on desktop they keep the picker, so `chosen` wins.
 */
export function destination(locations: SyncLocations | null, name: string, chosen?: string): Destination {
  const storage = locations?.storage;
  if (chosen !== undefined && !locations?.app_decides_path) {
    return { path: chosen, visible: true, canAsk: false };
  }
  return {
    path: joinPath(locations?.home ?? "", name.trim()),
    visible: visible(storage),
    canAsk: canAsk(storage),
  };
}

/**
 * Whether a route can be taken to its end. The local route needs a name; the
 * pairing route needs a code that at least looks like one, so the wizard can
 * ask the engine what Vault it is for before anything is written.
 */
export function looksLikeInvite(code: string): boolean {
  return code.trim().startsWith("synesis:");
}

/** A Vault name the user has not filled in is not a Vault name. */
export function nameIsUsable(name: string): boolean {
  return name.trim().length > 0;
}

/**
 * The sync method to record for a route. Pairing and local say what they are;
 * the folder route carries whichever tool the user was shown (PLAN §21.10).
 */
export function methodFor(route: Route, folderMethod: string | null): string {
  if (route === "pairing") return "pairing";
  if (route === "local") return "none";
  return folderMethod ?? "none";
}

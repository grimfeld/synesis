// Naming a new Property: the one rule the Properties panel's "+ add property"
// and the Hub's "Add Date → Date…" share. A name means the same thing and has
// the same type everywhere in the Vault (ADR 0006), so a name already typed
// otherwise cannot be added as a Date.
import { RESERVED_PROPERTIES, type PropertyType } from "./api";

export type NameCheck =
  | { ok: true; name: string; known: PropertyType | undefined }
  | { ok: false; reason: "empty" }
  | { ok: false; reason: "reserved"; name: string }
  | { ok: false; reason: "taken"; name: string; type: PropertyType };

/**
 * Read what the user typed as a new Property's name.
 *
 * `known` is the type the Vault already gives that name, if any. With `fixed`
 * — the type the caller is adding, such as a Date — a name typed otherwise
 * is refused rather than silently retyped.
 */
export function checkNewProperty(
  raw: string,
  types: Record<string, PropertyType>,
  fixed?: PropertyType,
): NameCheck {
  const name = raw.trim().replace(/[^\w-]/g, "");
  if (!name) return { ok: false, reason: "empty" };
  if (RESERVED_PROPERTIES.includes(name)) return { ok: false, reason: "reserved", name };
  const known = types[name];
  if (fixed && known && known !== fixed) return { ok: false, reason: "taken", name, type: known };
  return { ok: true, name, known };
}

/**
 * The name as it would be saved, whether or not it can be added — what the
 * add field shows its type beside — or "" when nothing usable was typed.
 */
export function nameTyped(check: NameCheck): string {
  return check.ok || check.reason !== "empty" ? check.name : "";
}

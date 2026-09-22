// Property labels against the engine's list of built-in Property names.
//
// TypeScript cannot check this pairing: Property names reach the UI as runtime
// strings (the schema is a `Record<string, PropertyType>`), so there is no
// union to make a total map over the way `HUB_SECTIONS` and `FRONTMATTER` do
// over `DocType`. A literal union kept by hand would enforce the table against
// itself and not against Rust, which is the appearance of safety rather than
// safety. So the authoritative list is read from where it is declared.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dictionaries } from "..";
import { en } from "../en";
import { fr } from "../fr";
import { propertyLabel } from "..";

/** The names in `BUILTIN` (crates/engine/src/properties.rs). */
function builtinNames(): string[] {
  // Resolved from the project root: these tests run in jsdom, where
  // `import.meta.url` is an http URL and cannot be turned into a path.
  const path = resolve(process.cwd(), "crates/engine/src/properties.rs");
  const src = readFileSync(path, "utf8");
  const block = /pub const BUILTIN[^=]*=\s*&\[([\s\S]*?)\n\];/.exec(src);
  if (!block) throw new Error("BUILTIN not found in properties.rs");
  const names = [...block[1].matchAll(/\("([a-z_]+)"\s*,/g)].map((m) => m[1]);
  if (names.length === 0) throw new Error("BUILTIN parsed as empty");
  return names;
}

describe("property_labels", () => {
  const names = builtinNames();

  it("reads the engine's built-in names", () => {
    // A guard on the parser itself: if the shape of BUILTIN changes, the tests
    // below must not quietly pass over an empty list.
    expect(names).toContain("born");
    expect(names).toContain("died");
    expect(names.length).toBeGreaterThan(15);
  });

  for (const [lang, dict] of Object.entries(dictionaries)) {
    it(`covers every built-in Property in ${lang}`, () => {
      const missing = names.filter((n) => !(n in dict.property_labels));
      expect(missing, `add these to src/i18n/${lang}.ts`).toEqual([]);
    });

    it(`labels nothing in ${lang} with an empty string`, () => {
      const blank = Object.entries(dict.property_labels)
        .filter(([, v]) => !v.trim())
        .map(([k]) => k);
      expect(blank).toEqual([]);
    });
  }

  it("labels no Property the engine does not know", () => {
    // A label for a name that no longer exists is dead weight, and reads as
    // though the Property were still there.
    const known = new Set(names);
    const stale = Object.keys(en.property_labels).filter((k) => !known.has(k));
    expect(stale, "remove these, or add them to BUILTIN").toEqual([]);
  });
});

describe("propertyLabel", () => {
  it("translates a built-in Property", () => {
    expect(propertyLabel("born", en)).toBe("Born");
    expect(propertyLabel("born", fr)).toBe("Naissance");
  });

  it("shows a Property the user invented exactly as they named it", () => {
    // The demo vault has both: a Character's `reign_start`, a Place's
    // `destroyed`. The app did not name them and cannot translate them.
    expect(propertyLabel("reign_start", fr)).toBe("reign_start");
    expect(propertyLabel("destroyed", en)).toBe("destroyed");
  });

  it("does not mistake a Property for something inherited from Object", () => {
    // `"constructor" in dict.property_labels` is true for every object, so a
    // Property so named must still fall through to its own name.
    expect(propertyLabel("constructor", en)).toBe("constructor");
    expect(propertyLabel("toString", en)).toBe("toString");
  });
});

// Naming a new Property (ADR 0006): one name, one type, vault-wide.
import { describe, expect, it } from "vitest";
import { checkNewProperty } from "../propertyName";
import type { PropertyType } from "../api";

const types: Record<string, PropertyType> = {
  born: "date",
  anointed: "date",
  kind: "text",
};

describe("checkNewProperty", () => {
  it("keeps only the characters a front-matter key can hold", () => {
    expect(checkNewProperty(" fou nded! ", types)).toEqual({
      ok: true,
      name: "founded",
      known: undefined,
    });
  });

  it("refuses an empty name and a reserved one", () => {
    expect(checkNewProperty("  ", types)).toEqual({ ok: false, reason: "empty" });
    expect(checkNewProperty("title", types)).toEqual({
      ok: false,
      reason: "reserved",
      name: "title",
    });
  });

  it("reports a name the vault already types", () => {
    expect(checkNewProperty("kind", types)).toEqual({
      ok: true,
      name: "kind",
      known: "text",
    });
  });

  it("accepts a name already typed as the type asked for", () => {
    expect(checkNewProperty("anointed", types, "date")).toEqual({
      ok: true,
      name: "anointed",
      known: "date",
    });
  });

  it("refuses a name already typed otherwise when the type is fixed", () => {
    expect(checkNewProperty("kind", types, "date")).toEqual({
      ok: false,
      reason: "taken",
      name: "kind",
      type: "text",
    });
  });
});

// scripts/test-vaults.mjs decides which Vaults the Cypress and screenshot
// clean-ups may forget and delete (#68). It lives with the scripts, as Node
// code, but is tested here with the rest of the unit tests.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isTestVault, makeTestVault, MARKER, testVaultRoot } from "../../scripts/test-vaults.mjs";

describe("isTestVault", () => {
  let base = "";
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "test-vaults-"));
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it("accepts a copy made by makeTestVault, and a Vault inside it", () => {
    const dir = makeTestVault(base);
    expect(isTestVault(dir, base)).toBe(true);
    expect(testVaultRoot(join(dir, "wizard-vault"), base)).toBe(dir);
    expect(testVaultRoot(join(dir, "wizard-vault", "..", "Notes"), base)).toBe(dir);
  });

  it("refuses a real folder that only has the name", () => {
    const named = join(base, "synesis-cy-abc123");
    mkdirSync(named);
    expect(isTestVault(named, base)).toBe(false);
    expect(isTestVault(join(base, "Documents", "synesis-cy-notes"), base)).toBe(false);
  });

  it("refuses a marked folder outside the temp directory or with another name", () => {
    const deeper = join(base, "home", "synesis-cy-abc123");
    mkdirSync(deeper, { recursive: true });
    writeFileSync(join(deeper, MARKER), "");
    expect(isTestVault(deeper, base)).toBe(false);
    const renamed = join(base, "synesis-cy-my-real-notes");
    mkdirSync(renamed);
    writeFileSync(join(renamed, MARKER), "");
    expect(isTestVault(renamed, base)).toBe(false);
  });

  it("refuses the temp directory itself and empty input", () => {
    expect(isTestVault(base, base)).toBe(false);
    expect(isTestVault("", base)).toBe(false);
    expect(isTestVault(undefined, base)).toBe(false);
  });
});

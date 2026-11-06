// The throwaway copies of examples/demo-vault that Cypress (cypress.config.ts)
// and scripts/site-screenshots.mjs open through the dev bridge, and the one
// test that decides whether a path is such a copy before anything forgets or
// deletes it.
//
// The dev build shares the installed app's settings, so the vault list a
// clean-up walks holds the developer's real Vaults too. A name alone
// ("synesis-cy-" somewhere in the path) is not proof: a real folder can be
// named that way. A test copy is a folder made by `makeTestVault`: directly in
// the temp directory, named `synesis-cy-` plus mkdtemp's six characters, and
// holding the MARKER file written when it was made. A path inside one (the
// onboarding spec creates a Vault inside its copy) belongs to it.
import { existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export const MARKER = ".synesis-cy";
const PREFIX = "synesis-cy-";
const NAME = /^synesis-cy-[A-Za-z0-9]{6}$/;

const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
};

/** Make an empty test copy folder in `base` (the temp directory) and mark it. */
export function makeTestVault(base = tmpdir()) {
  const dir = mkdtempSync(join(base, PREFIX));
  writeFileSync(join(dir, MARKER), "A Synesis test copy; the test clean-up deletes this folder.\n");
  return dir;
}

/**
 * The test copy `path` is or lies inside, or null. `base` is the temp
 * directory; a parameter only so the unit test can use its own.
 */
export function testVaultRoot(path, base = tmpdir()) {
  if (typeof path !== "string" || path === "") return null;
  const tmp = real(base);
  if (!tmp) return null;
  let dir = resolve(path);
  for (;;) {
    if (NAME.test(basename(dir)) && existsSync(join(dir, MARKER)) && real(dirname(dir)) === tmp) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** Whether `path` is, or lies inside, a test copy made by `makeTestVault`. */
export function isTestVault(path, base = tmpdir()) {
  return testVaultRoot(path, base) !== null;
}

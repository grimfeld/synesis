// Types for scripts/test-vaults.mjs, imported by cypress.config.ts and its unit test.
export const MARKER: string;
export function makeTestVault(base?: string): string;
export function testVaultRoot(path: unknown, base?: string): string | null;
export function isTestVault(path: unknown, base?: string): boolean;

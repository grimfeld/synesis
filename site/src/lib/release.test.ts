// `npm test` in site/: Node's own test runner, so the site needs no test
// dependency and the app's Vitest run never loads the site's config.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fromRelease } from "./release.ts";

const asset = (name: string) => ({ name, browser_download_url: `https://example.com/${name}` });
const assets = [
  asset("Synesis_0.1.0_aarch64.dmg"),
  asset("Synesis_0.1.0_x64.dmg"),
  asset("Synesis_0.1.0_x64-setup.exe"),
  asset("Synesis_0.1.0_amd64.AppImage"),
];
const files = (r: ReturnType<typeof fromRelease>, id: string) => r.platforms.find((p) => p.id === id)!.files;

describe("fromRelease", () => {
  it("keeps every platform closed below 0.1.0", () => {
    const r = fromRelease("v0.0.23", assets);
    assert.equal(r.open, false);
    assert.ok(r.platforms.every((p) => p.files.length === 0));
  });

  it("offers macOS for Apple Silicon first, then Intel", () => {
    assert.deepEqual(files(fromRelease("v0.1.0", assets), "macos"), [
      { name: "Synesis_0.1.0_aarch64.dmg", url: "https://example.com/Synesis_0.1.0_aarch64.dmg", variant: "appleSilicon" },
      { name: "Synesis_0.1.0_x64.dmg", url: "https://example.com/Synesis_0.1.0_x64.dmg", variant: "intel" },
    ]);
  });

  it("offers one file elsewhere and none for a missing asset", () => {
    const r = fromRelease("v0.1.0", assets);
    assert.deepEqual(files(r, "windows"), [
      { name: "Synesis_0.1.0_x64-setup.exe", url: "https://example.com/Synesis_0.1.0_x64-setup.exe" },
    ]);
    assert.deepEqual(files(r, "android"), []);
    assert.deepEqual(
      files(fromRelease("v0.1.0", [asset("Synesis_0.1.0_x64.dmg")]), "macos").map((f) => f.variant),
      ["intel"],
    );
  });
});

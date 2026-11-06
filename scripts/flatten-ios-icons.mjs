// Drop the alpha channel from the iOS app icons.
//
// App Store Connect rejects an IPA whose large app icon has an alpha channel
// (error 90717), even a fully opaque one. `tauri icon` fills the iOS icons
// with the manifest's `bg_color` but still writes RGBA PNGs, so this rewrites
// each one as plain RGB, compositing any leftover transparency onto that
// colour. Run by `npm run icons` after `tauri icon`; idempotent.
//
// `--check` only reports icons that still carry alpha, and exits 1 if any do.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = process.argv.find((a, i) => i > 1 && !a.startsWith("--")) ?? join(root, "src-tauri", "icons", "ios");
const check = process.argv.includes("--check");

const manifest = JSON.parse(readFileSync(join(root, "branding", "icon-manifest.json"), "utf8"));
const hex = /^#([0-9a-f]{6})$/i.exec(manifest.bg_color ?? "");
if (!hex) {
  console.error(`flatten-ios-icons: branding/icon-manifest.json bg_color must be #rrggbb, got ${manifest.bg_color}`);
  process.exit(1);
}
const bg = [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));

/** True when the PNG's colour type stores an alpha channel (4: grey+alpha, 6: RGBA). */
const storesAlpha = (buf) => (buf[25] & 4) !== 0;

const files = readdirSync(dir).filter((f) => f.endsWith(".png"));
const withAlpha = files.filter((f) => storesAlpha(readFileSync(join(dir, f))));

if (check) {
  if (withAlpha.length > 0) {
    console.error(`iOS icons with an alpha channel (App Store Connect rejects them): ${withAlpha.join(", ")}. Run \`npm run icons\`.`);
    process.exit(1);
  }
  process.exit(0);
}

for (const f of withAlpha) {
  const path = join(dir, f);
  const png = PNG.sync.read(readFileSync(path));
  const d = png.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    for (let c = 0; c < 3; c++) d[i + c] = Math.round(d[i + c] * a + bg[c] * (1 - a));
    d[i + 3] = 255;
  }
  writeFileSync(path, PNG.sync.write(png, { colorType: 2, inputHasAlpha: true }));
}
console.log(`flatten-ios-icons: ${withAlpha.length} of ${files.length} icons flattened onto ${manifest.bg_color}`);

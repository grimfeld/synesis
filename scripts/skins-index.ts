// `npm run skins:index`: writes skins/index.json, the list the Skin gallery
// fetches (PLAN §26.4), from the Skin files beside it. Refuses, and writes
// nothing, when a Skin fails the gate; `npm run test:unit` checks the same
// rules and that the index is up to date.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { basePalettes, buildGalleryIndex, formatIndex, INDEX_FILE } from "../src/lib/skinGallery";

const root = process.cwd();
const dir = path.join(root, "skins");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".json") && f !== INDEX_FILE)
  .sort()
  .map((f): [string, string] => [f, readFileSync(path.join(dir, f), "utf8")]);
const { index, errors } = buildGalleryIndex(files, basePalettes(readFileSync(path.join(root, "src/index.css"), "utf8")));
if (errors.length) {
  for (const e of errors) console.error(e);
  process.exit(1);
}
writeFileSync(path.join(dir, INDEX_FILE), formatIndex(index));
console.log(`skins/${INDEX_FILE}: ${index.skins.length} Skin${index.skins.length === 1 ? "" : "s"}`);

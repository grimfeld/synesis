// Adds the `kind` column to the bundled gazetteer (PLAN §27.12) from
// OpenBible.info's classification of each ancient place, joined on the slug
// the gazetteer already carries. Every other column is left exactly as it was.
//
//   node scripts/gazetteer-kinds.mjs            fetch ancient.jsonl and rewrite
//   node scripts/gazetteer-kinds.mjs FILE       use a local copy instead
//
// OpenBible lists about 40 types, most important first; a place takes the kind
// of the first type that maps onto one of the five built-in kinds. A type with
// no clear kind (a campsite, a valley, a road, a people group) maps to nothing,
// and a place with no mapped type is left blank: the plain pin is honest, a
// guessed shape is not.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE =
  "https://raw.githubusercontent.com/openbibleinfo/Bible-Geocoding-Data/main/data/ancient.jsonl";
const TSV = join(dirname(fileURLToPath(import.meta.url)), "../crates/engine/data/gazetteer.tsv");

/** OpenBible type -> built-in kind. Unlisted types map to nothing. */
export const KIND_OF_TYPE = {
  settlement: "settlement",
  "district in settlement": "settlement",
  fortification: "settlement",
  mountain: "mountain",
  hill: "mountain",
  "mountain range": "mountain",
  "mountain ridge": "mountain",
  "mountain pass": "mountain",
  cliff: "mountain",
  promontory: "mountain",
  river: "water",
  spring: "water",
  "body of water": "water",
  pool: "water",
  well: "water",
  wadi: "water",
  canal: "water",
  ford: "water",
  region: "region",
  "natural area": "region",
  island: "region",
  forest: "region",
  gate: "site",
  altar: "site",
  structure: "site",
  garden: "site",
  hall: "site",
  room: "site",
  tree: "site",
  "stone heap": "site",
  rock: "site",
  mine: "site",
  field: "site",
};

async function source() {
  const local = process.argv[2];
  if (local) return readFileSync(local, "utf8");
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`${SOURCE}: ${res.status}`);
  return res.text();
}

const kindBySlug = new Map();
for (const line of (await source()).split("\n")) {
  if (!line.trim()) continue;
  const d = JSON.parse(line);
  const kind = (d.types ?? []).map((t) => KIND_OF_TYPE[t]).find(Boolean) ?? "";
  kindBySlug.set(d.url_slug, kind);
}

const HEADER = "# name\tlat\tlon\tmodern_name\tverses\tslug\tscore\tkind";
const out = [];
let rows = 0;
let kinded = 0;
for (const line of readFileSync(TSV, "utf8").split("\n")) {
  if (!line.trim()) continue;
  if (line.startsWith("#")) {
    out.push(HEADER);
    continue;
  }
  // Idempotent: a rerun replaces the kind column rather than adding another.
  const cols = line.split("\t").slice(0, 7);
  const kind = kindBySlug.get(cols[5]) ?? "";
  out.push([...cols, kind].join("\t"));
  rows++;
  if (kind) kinded++;
}
writeFileSync(TSV, out.join("\n") + "\n");
console.log(`gazetteer.tsv: ${rows} places, ${kinded} with a kind`);

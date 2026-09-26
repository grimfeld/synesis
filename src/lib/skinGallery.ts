// The Skin gallery (PLAN §26): community Skins merged into the repo's `skins/`
// folder, listed by a generated `skins/index.json` and fetched by the app only
// when the gallery opens. This module holds what the index is, how it is built
// and the gate every Skin in the folder passes. Pure, so `npm run test:unit`
// runs the gate and `npm run skins:index` (scripts/skins-index.ts) builds the
// index with the same code.

import { contrast, parseColor, toHex } from "./color";
import { keyContrasts, normalizeSkin, resolveSide, unknownOverrides, type Palette, type Side, type Skin } from "./skin";

/** The colours a gallery row shows for one side: as worn, missing seeds filled from the default palette. */
export interface GallerySwatch {
  background: string;
  text: string;
  accent: string;
}

export interface GalleryEntry {
  id: string;
  name: string;
  author?: string;
  /** The Skin's file in `skins/`. */
  file: string;
  light: GallerySwatch;
  dark: GallerySwatch;
}

export interface GalleryIndex {
  version: 1;
  skins: GalleryEntry[];
}

export const INDEX_FILE = "index.json";
/** What a Skin file in the gallery may be called: the app fetches it by this name. */
export const GALLERY_FILE = /^[a-z0-9]+(-[a-z0-9]+)*\.json$/;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const SIDES: Side[] = ["light", "dark"];

/**
 * The built-in palette for each side, read from `src/index.css` (`:root` and
 * `.dark`), as the app reads it from the page at runtime.
 */
export function basePalettes(css: string): Record<Side, Palette> {
  const block = (selector: string): Palette => {
    const m = new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(css);
    const out: Palette = {};
    for (const d of m?.[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g) ?? []) out[d[1]] = d[2].trim();
    return out;
  };
  const light = block(":root");
  return { light, dark: { ...light, ...block(".dark") } };
}

const hex = (value: string | undefined) => {
  const c = parseColor(value ?? "");
  return c ? toHex(c) : "";
};

function swatch(base: Palette, skin: Skin, side: Side): GallerySwatch {
  const p = { ...base, ...resolveSide(base, skin[side]) };
  return { background: hex(p["--background"]), text: hex(p["--foreground"]), accent: hex(p["--primary"]) };
}

/** What stops a Skin file from entering the gallery. Empty means it may. */
export function checkGallerySkin(file: string, text: string, base: Record<Side, Palette>): string[] {
  const errors: string[] = [];
  if (!GALLERY_FILE.test(file)) errors.push("file name must be lower-case words joined by hyphens, ending in .json");
  let raw: Partial<Skin>;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return [...errors, `not JSON: ${e}`];
  }
  if (typeof raw.name !== "string" || !raw.name.trim()) return [...errors, "no name"];
  const skin = normalizeSkin(raw as Skin);
  if (!ULID.test(skin.id)) errors.push(`id "${skin.id}" is not a ULID`);
  for (const side of SIDES) {
    const unknown = unknownOverrides(skin[side]);
    if (unknown.length) errors.push(`${side}: unknown overrides ${unknown.join(", ")}`);
    const s = skin[side];
    if (!Object.keys(s.seeds).length && !Object.keys(s.overrides).length) continue;
    const ratio = keyContrasts({ ...base[side], ...resolveSide(base[side], s) }).text;
    if (ratio === null || ratio < 4.5) errors.push(`${side}: Text on Background is ${ratio?.toFixed(2) ?? "unreadable"}:1, below 4.5:1`);
  }
  return errors;
}

/**
 * The index for a folder's Skin files (`[file, text]`, index.json excluded),
 * sorted by name, and every reason a file is refused. Ids and names must be
 * unique, names ignoring case.
 */
export function buildGalleryIndex(files: [string, string][], base: Record<Side, Palette>): { index: GalleryIndex; errors: string[] } {
  const errors: string[] = [];
  const skins: GalleryEntry[] = [];
  for (const [file, text] of files) {
    const bad = checkGallerySkin(file, text, base);
    if (bad.length) {
      errors.push(...bad.map((e) => `${file}: ${e}`));
      continue;
    }
    const skin = normalizeSkin(JSON.parse(text));
    const same = skins.find((s) => s.id === skin.id || s.name.toLowerCase() === skin.name.trim().toLowerCase());
    if (same) {
      errors.push(`${file}: ${same.id === skin.id ? "id" : "name"} already used by ${same.file}`);
      continue;
    }
    skins.push({
      id: skin.id,
      name: skin.name.trim(),
      ...(skin.author ? { author: skin.author } : {}),
      file,
      light: swatch(base.light, skin, "light"),
      dark: swatch(base.dark, skin, "dark"),
    });
  }
  skins.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return { index: { version: 1, skins }, errors };
}

/** The index file as written: stable, so the gate can compare it byte for byte. */
export function formatIndex(index: GalleryIndex): string {
  return JSON.stringify(index, null, 2) + "\n";
}

/** Read an index fetched from the repo, dropping what this version cannot use. */
export function readIndex(value: unknown): GalleryEntry[] {
  const skins = (value as Partial<GalleryIndex> | null)?.skins;
  if (!Array.isArray(skins)) throw new Error("not a Skin gallery index");
  const sw = (x: unknown): x is GallerySwatch =>
    !!x && typeof x === "object" && ["background", "text", "accent"].every((k) => typeof (x as Record<string, unknown>)[k] === "string");
  return skins.filter(
    (e): e is GalleryEntry =>
      !!e && typeof e.id === "string" && typeof e.name === "string" && typeof e.file === "string" && GALLERY_FILE.test(e.file) && sw(e.light) && sw(e.dark),
  );
}

/** Contrast of two colours, for tests and the gate's messages. */
export function ratio(a: string, b: string): number | null {
  const [x, y] = [parseColor(a), parseColor(b)];
  return x && y ? contrast(x, y) : null;
}

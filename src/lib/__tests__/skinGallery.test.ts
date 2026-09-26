// The Skin gallery's gate (PLAN §26.5): every Skin in the repo's `skins/`
// folder passes it, and `skins/index.json` is what `npm run skins:index`
// would write. A PR adding a Skin fails here until both hold.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { basePalettes, buildGalleryIndex, checkGallerySkin, formatIndex, INDEX_FILE, ratio, readIndex } from "../skinGallery";
import { normalizeSkin, resolveSide } from "../skin";

const root = path.resolve(__dirname, "../../..");
const dir = path.join(root, "skins");
const BASE = basePalettes(readFileSync(path.join(root, "src/index.css"), "utf8"));
const folder = (): [string, string][] =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== INDEX_FILE)
    .sort()
    .map((f) => [f, readFileSync(path.join(dir, f), "utf8")]);

const ID = "01J9Z3Q4N5P6R7S8T9V0W1X2Y3";
const skin = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ id: ID, name: "Dusk", version: 1, light: {}, dark: { seeds: { background: "#1a1a2e", text: "#e0e0f0", accent: "#9fa8ff" } }, ...over });

describe("the skins/ folder", () => {
  it("holds only Skins that pass the gate", () => {
    expect(buildGalleryIndex(folder(), BASE).errors).toEqual([]);
  });

  it("has an up-to-date index.json (run `npm run skins:index`)", () => {
    const { index } = buildGalleryIndex(folder(), BASE);
    expect(readFileSync(path.join(dir, INDEX_FILE), "utf8")).toBe(formatIndex(index));
  });
});

describe("basePalettes", () => {
  it("reads both sides from index.css, the dark one over the light", () => {
    expect(BASE.light["--background"]).toBe("oklch(0.985 0.004 85)");
    expect(BASE.dark["--background"]).toBe("oklch(0.2 0.008 265)");
    expect(BASE.dark["--radius"]).toBe(BASE.light["--radius"]);
    expect(BASE.dark["--c-cover-1"]).not.toBe(BASE.light["--c-cover-1"]);
  });
});

describe("checkGallerySkin", () => {
  it("passes a good Skin", () => {
    expect(checkGallerySkin("dusk.json", skin(), BASE)).toEqual([]);
  });

  it.each([
    ["a file name the app will not fetch", "Dusk Skin.json", skin(), "file name"],
    ["a file that is not JSON", "dusk.json", "{", "not JSON"],
    ["a Skin without a name", "dusk.json", skin({ name: " " }), "no name"],
    ["an id that is not a ULID", "dusk.json", skin({ id: "dusk" }), "not a ULID"],
    ["an override this version does not know", "dusk.json", skin({ light: { overrides: { "surface.glow": "#fff" } } }), "unknown overrides"],
    ["unreadable text", "dusk.json", skin({ dark: { seeds: { background: "#202020", text: "#404040" } } }), "below 4.5:1"],
  ])("refuses %s", (_, file, text, error) => {
    expect(checkGallerySkin(file, text, BASE).join("\n")).toContain(error);
  });

  it("does not judge a side left to the default", () => {
    expect(checkGallerySkin("dusk.json", skin({ light: {} }), BASE)).toEqual([]);
  });
});

describe("buildGalleryIndex", () => {
  it("lists Skins by name with both sides' colours as worn", () => {
    const { index, errors } = buildGalleryIndex(
      [
        ["zeal.json", skin({ id: "01J9Z3Q4N5P6R7S8T9V0W1X2Y4", name: "Zeal", author: "grimfeld" })],
        ["dusk.json", skin()],
      ],
      BASE,
    );
    expect(errors).toEqual([]);
    expect(index.skins.map((s) => s.name)).toEqual(["Dusk", "Zeal"]);
    expect(index.skins[1].author).toBe("grimfeld");
    expect(index.skins[0].dark).toEqual({ background: "#1a1a2e", text: "#e0e0f0", accent: "#9fa8ff" });
    // The light side is the default one, filled from index.css.
    expect(index.skins[0].light.background).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("refuses a second Skin with the same id or name", () => {
    const { index, errors } = buildGalleryIndex(
      [
        ["a.json", skin()],
        ["b.json", skin({ name: "Other" })],
        ["c.json", skin({ id: "01J9Z3Q4N5P6R7S8T9V0W1X2Y5", name: "DUSK" })],
      ],
      BASE,
    );
    expect(index.skins).toHaveLength(1);
    expect(errors).toEqual(["b.json: id already used by a.json", "c.json: name already used by a.json"]);
  });
});

describe("readIndex", () => {
  it("keeps entries it can use and drops the rest", () => {
    const sw = { background: "#fff", text: "#000", accent: "#00f" };
    const good = { id: ID, name: "Dusk", file: "dusk.json", light: sw, dark: sw };
    expect(readIndex({ version: 1, skins: [good, { ...good, file: "../x.json" }, { name: "No id" }] })).toEqual([good]);
    expect(() => readIndex({ nope: true })).toThrow();
  });
});

describe("the first gallery Skins (PLAN §26.8-9)", () => {
  // Passages, links, Tags and danger are read as text, so they reach 4.5:1 on
  // the page on both sides; inferred Passages and unresolved links stay faint
  // on purpose, as in the built-in palette.
  const read = ["--foreground", "--muted-foreground", "--destructive", "--passage", "--link", "--tag"];
  it.each(["nord.json", "paper.json"])("%s keeps text and editor colours readable on both sides", (file) => {
    const s = normalizeSkin(JSON.parse(readFileSync(path.join(dir, file), "utf8")));
    for (const side of ["light", "dark"] as const) {
      const p = { ...BASE[side], ...resolveSide(BASE[side], s[side]) };
      for (const v of read) expect(ratio(p[v], p["--background"]), `${file} ${side} ${v}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

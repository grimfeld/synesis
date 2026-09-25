// Skins (PLAN §22): colour math and how a Skin side becomes CSS variables.
// The base palette is passed in, so these run without a browser.
import { describe, expect, it } from "vitest";
import { contrast, ensureContrast, parseColor, toHex } from "../color";
import {
  BUILTIN_SKINS,
  emptySide,
  fontStack,
  freeName,
  keyContrasts,
  pickSkin,
  resolveSide,
  sideFor,
  TOKENS,
  typographyVars,
  unknownOverrides,
  type Palette,
  type SkinSide,
} from "../skin";

// A slice of index.css's light palette.
const BASE: Palette = {
  "--background": "oklch(0.985 0.004 85)",
  "--foreground": "oklch(0.24 0.012 265)",
  "--primary": "oklch(0.46 0.085 260)",
  "--primary-foreground": "oklch(0.985 0.005 85)",
  "--muted-foreground": "oklch(0.52 0.015 265)",
  "--c-place": "#c04f6b",
  "--c-cover-1": "#2f4858",
  "--passage": "#5a7d3a",
};

const withSeeds = (seeds: SkinSide["seeds"], rest: Partial<SkinSide> = {}): SkinSide => ({ ...emptySide(), ...rest, seeds });
const col = (s: string | undefined) => parseColor(s ?? "")!;

describe("color", () => {
  it("round-trips hex through OKLCH", () => {
    for (const hex of ["#000000", "#ffffff", "#3b6ea8", "#c04f6b", "#f4ecd8"]) {
      expect(toHex(col(hex))).toBe(hex);
    }
  });

  it("parses oklch with percentages and alpha", () => {
    expect(col("oklch(1 0 0 / 10%)").alpha).toBeCloseTo(0.1);
    expect(col("oklch(50% 0.1 200)").l).toBeCloseTo(0.5);
    expect(parseColor("red")).toBeNull();
    expect(parseColor("#12")).toBeNull();
  });

  it("measures WCAG contrast", () => {
    expect(contrast(col("#000"), col("#fff"))).toBeCloseTo(21, 0);
    expect(contrast(col("#777"), col("#777"))).toBeCloseTo(1);
  });

  it("pushes a foreground just far enough, keeping its hue", () => {
    const bg = col("#ffffff");
    const fg = col("#9aa1ab");
    const fixed = ensureContrast(fg, bg, 4.5);
    expect(contrast(fixed, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fixed, bg)).toBeLessThan(4.7);
    expect(fixed.h).toBeCloseTo(fg.h);
  });
});

describe("resolveSide", () => {
  it("changes nothing for an empty side", () => {
    expect(resolveSide(BASE, emptySide())).toEqual({});
  });

  it("derives the surfaces from a Background seed and keeps the base ink readable", () => {
    const out = resolveSide(BASE, withSeeds({ background: "#1d1d2b" }));
    expect(out["--background"]).toBeDefined();
    expect(out["--card"]).toBeDefined();
    expect(out["--sidebar"]).toBeDefined();
    // The base foreground is dark; on a dark page the app must lift it.
    expect(contrast(col(out["--foreground"]), col(out["--background"]))).toBeGreaterThanOrEqual(7);
    // A dark page draws its borders from the ink, translucent.
    expect(col(out["--border"]).alpha).toBeLessThan(1);
  });

  it("never corrects the user's own Text seed", () => {
    const out = resolveSide(BASE, withSeeds({ background: "#ffffff", text: "#dddddd" }));
    expect(toHex(col(out["--foreground"]))).toBe("#dddddd");
    expect(keyContrasts(out).text!).toBeLessThan(2);
  });

  it("keeps derived muted text and button labels at 4.5:1", () => {
    for (const seeds of [
      { background: "#ffffff", text: "#222222", accent: "#ffd84d" },
      { background: "#101010", text: "#f0f0f0", accent: "#1a3cff" },
      { background: "#f4ecd8", text: "#3d3022", accent: "#8a5a2b" },
    ]) {
      const out = resolveSide(BASE, withSeeds(seeds));
      const k = keyContrasts(out);
      expect(k.muted!, JSON.stringify(seeds)).toBeGreaterThanOrEqual(4.5);
      expect(k.accent!, JSON.stringify(seeds)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("an Accent seed alone touches only the accent family", () => {
    const out = resolveSide(BASE, withSeeds({ accent: "#aa3355" }));
    expect(Object.keys(out).sort()).toEqual(
      ["--primary", "--primary-foreground", "--ring", "--sidebar-primary", "--sidebar-primary-foreground", "--sidebar-ring"].sort(),
    );
  });

  it("the chroma knob tames type colours, keeps hues, and leaves Covers alone", () => {
    const out = resolveSide(BASE, withSeeds({}, { typeChroma: 0.5 }));
    const before = col(BASE["--c-place"]);
    const after = col(out["--c-place"]);
    expect(after.c).toBeCloseTo(before.c * 0.5, 3);
    expect(after.h).toBeCloseTo(before.h, 1);
    expect(out["--passage"]).toBeDefined();
    expect(out["--c-cover-1"]).toBeUndefined();
  });

  it("overrides win over everything and ignore unknown names and junk values", () => {
    const side = withSeeds(
      { background: "#ffffff" },
      { overrides: { "surface.card": "#ff0000", "type.place": "not a colour", "surface.glow": "#00ff00" } },
    );
    const out = resolveSide(BASE, side);
    expect(out["--card"]).toBe("#ff0000");
    expect(out["--c-place"]).toBeUndefined();
    expect(unknownOverrides(side)).toEqual(["surface.glow"]);
  });

  it("one token sets every variable it stands for", () => {
    const out = resolveSide(BASE, withSeeds({}, { overrides: { "surface.muted": "#eeeeee" } }));
    expect(out["--muted"]).toBe("#eeeeee");
    expect(out["--secondary"]).toBe("#eeeeee");
  });
});

describe("the token catalog", () => {
  it("names are unique and no variable is set by two tokens", () => {
    const names = TOKENS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    const vars = TOKENS.flatMap((t) => t.vars);
    expect(new Set(vars).size).toBe(vars.length);
  });
});

describe("built-in Skins", () => {
  it("High contrast reaches AAA for body text on both sides", () => {
    const hc = BUILTIN_SKINS.find((s) => s.id === "builtin:high-contrast")!;
    for (const side of [hc.light, hc.dark]) {
      const k = keyContrasts(resolveSide(BASE, side));
      expect(k.text!).toBeGreaterThanOrEqual(7);
      expect(k.muted!).toBeGreaterThanOrEqual(7);
      expect(k.accent!).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("every override in a built-in names a known token", () => {
    for (const s of BUILTIN_SKINS) for (const side of [s.light, s.dark]) expect(unknownOverrides(side)).toEqual([]);
  });

  it("a missing or deleted Skin falls back to the default", () => {
    expect(pickSkin("01GONE", []).id).toBe("builtin:synesis");
    expect(pickSkin(null, []).id).toBe("builtin:synesis");
    expect(pickSkin("builtin:sepia", []).name).toBe("Sepia");
  });
});

describe("typography and naming", () => {
  it("known fonts map to their stack, unknown names are system families", () => {
    expect(fontStack("literata", "source-serif")).toContain("Literata Variable");
    expect(fontStack(undefined, "source-serif")).toContain("Source Serif 4 Variable");
    expect(fontStack('Bad"; }', "geist")).toBe('"Bad ", ' + fontStack("geist", "geist"));
  });

  it("clamps sizes to something readable", () => {
    const v = typographyVars({ lineHeight: 9, lineWidth: 100, proseSize: 0.1 });
    expect(v["--prose-line-height"]).toBe("2.2");
    expect(v["--prose-width"]).toBe("30rem");
    expect(v["--prose-scale"]).toBe("0.8");
  });

  it("System mode follows the OS", () => {
    expect(sideFor("system", true)).toBe("dark");
    expect(sideFor("system", false)).toBe("light");
    expect(sideFor("light", true)).toBe("light");
  });

  it("finds a free name", () => {
    expect(freeName("Sepia", ["sepia"])).toBe("Sepia 2");
    expect(freeName("Sepia 2", ["Sepia", "Sepia 2"])).toBe("Sepia 3");
    expect(freeName("Mine", ["Sepia"])).toBe("Mine");
  });
});

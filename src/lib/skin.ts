// Skins (PLAN §24): what a seed, an override and a font name mean, and how a
// Skin side becomes CSS variables. Pure: the base palette comes in as input
// (read from index.css at runtime by src/lib/appearance.tsx), so every rule
// here is pinned by Vitest without a browser.

import { contrast, ensureContrast, formatOklch, mix, parseColor, type Oklch } from "./color";

export type Side = "light" | "dark";
export type AppearanceMode = "light" | "dark" | "system";

export interface SkinSeeds {
  background?: string;
  text?: string;
  accent?: string;
}

export interface SkinTypography {
  /** A FONTS id, or any family name installed on the system. */
  proseFont?: string;
  uiFont?: string;
  lineHeight?: number;
  /** CSS px at 100% Text scale. */
  lineWidth?: number;
  /** Relative to the default prose size. */
  proseSize?: number;
}

export interface SkinSide {
  seeds: SkinSeeds;
  /** Multiplier on the chroma of document-type, route and decoration colours. */
  typeChroma?: number;
  overrides: Record<string, string>;
  typography: SkinTypography;
  [key: string]: unknown;
}

export interface Skin {
  /** A ULID, or `builtin:<name>` for the Skins the app ships. */
  id: string;
  name: string;
  author?: string;
  version: number;
  light: SkinSide;
  dark: SkinSide;
  [key: string]: unknown;
}

export const emptySide = (): SkinSide => ({ seeds: {}, overrides: {}, typography: {} });

/** Fill in what a Skin read from a file may leave out. */
export function normalizeSkin(s: Partial<Skin> & { name: string }): Skin {
  const side = (x?: Partial<SkinSide>): SkinSide => ({
    ...x,
    seeds: { ...x?.seeds },
    overrides: { ...x?.overrides },
    typography: { ...x?.typography },
  });
  return { ...s, id: s.id ?? "", version: s.version ?? 1, light: side(s.light), dark: side(s.dark) };
}

// ------------------------------------------------------------ tokens

export type TokenGroup = "surface" | "text" | "accent" | "line" | "status" | "type" | "route" | "cover" | "editor";

export interface TokenDef {
  /** The stable name a Skin file uses. Never rename one: shared Skins name it. */
  name: string;
  /** The CSS variables it sets. The first is the one read back. */
  vars: string[];
  group: TokenGroup;
}

const t = (name: string, group: TokenGroup, ...vars: string[]): TokenDef => ({ name, vars, group });

/** Every colour a Skin can set, in the order the Advanced list shows them. */
export const TOKENS: TokenDef[] = [
  t("surface.background", "surface", "--background"),
  t("surface.card", "surface", "--card"),
  t("surface.popover", "surface", "--popover"),
  t("surface.sidebar", "surface", "--sidebar"),
  t("surface.muted", "surface", "--muted", "--secondary"),
  t("surface.hover", "surface", "--accent"),
  t("surface.sidebarHover", "surface", "--sidebar-accent"),
  t(
    "text.default",
    "text",
    "--foreground",
    "--card-foreground",
    "--popover-foreground",
    "--secondary-foreground",
    "--accent-foreground",
    "--sidebar-foreground",
    "--sidebar-accent-foreground",
  ),
  t("text.muted", "text", "--muted-foreground"),
  t("accent.default", "accent", "--primary", "--sidebar-primary"),
  t("accent.text", "accent", "--primary-foreground", "--sidebar-primary-foreground"),
  t("accent.ring", "accent", "--ring", "--sidebar-ring"),
  t("line.border", "line", "--border", "--sidebar-border"),
  t("line.input", "line", "--input"),
  t("status.danger", "status", "--destructive"),
  ...["note", "clipping", "composition", "source", "scripture", "place", "character", "concept", "event", "journey", "other"].map(
    (k) => t(`type.${k}`, "type", `--c-${k}`),
  ),
  ...[1, 2, 3, 4, 5].map((n) => t(`route.${n}`, "route", `--c-route-${n}`)),
  ...[1, 2, 3, 4, 5, 6].map((n) => t(`cover.${n}`, "cover", `--c-cover-${n}`)),
  t("editor.passage", "editor", "--passage"),
  t("editor.passageInferred", "editor", "--passage-inferred"),
  t("editor.link", "editor", "--link"),
  t("editor.tag", "editor", "--tag"),
  t("editor.unresolved", "editor", "--unresolved"),
];

export const TOKEN_BY_NAME = new Map(TOKENS.map((d) => [d.name, d]));

/** Every CSS variable a Skin may set, for reading the base palette and for clearing. */
export const ALL_VARS = [...new Set(TOKENS.flatMap((d) => d.vars))];

/** Groups the type-colour chroma knob moves. Covers stay: they carry white text. */
const TINTED: TokenGroup[] = ["type", "route", "editor"];

// ------------------------------------------------------------ resolving

/** CSS variable -> value. */
export type Palette = Record<string, string>;

const css = formatOklch;

function setToken(out: Palette, name: string, value: string) {
  for (const v of TOKEN_BY_NAME.get(name)?.vars ?? []) out[v] = value;
}

/**
 * The CSS variables one Skin side changes, on top of `base` (the built-in
 * palette for that side). Layering: base -> derived from the seeds -> the
 * type-colour knob -> Advanced overrides. Derived foregrounds are corrected to
 * 4.5:1 against their surface; the user's own seeds and overrides never are.
 */
export function resolveSide(base: Palette, side: SkinSide): Palette {
  const out: Palette = {};
  const read = (v: string) => parseColor(base[v] ?? "");
  const bgSeed = parseColor(side.seeds.background ?? "");
  const textSeed = parseColor(side.seeds.text ?? "");
  const accentSeed = parseColor(side.seeds.accent ?? "");
  const bg = bgSeed ?? read("--background");
  const accent = accentSeed ?? read("--primary");

  if (bg && (bgSeed || textSeed)) {
    // A base foreground on a new background is the app's choice, so it is
    // the app's job to keep it readable; a Text seed is the user's.
    const darkBg = bg.l < 0.6;
    const baseText = read("--foreground");
    // Flipped to a reading lightness for this page, not just nudged over the line.
    const inked = baseText && contrast(baseText, bg) < 7 ? { ...baseText, l: darkBg ? 0.93 : 0.22 } : baseText;
    const text = textSeed ?? (inked ? ensureContrast(inked, bg, 7) : null);
    const at = (d: number): Oklch => ({ ...bg, l: Math.min(1, Math.max(0, bg.l + d)) });
    const surfaces: [string, number, number][] = [
      // token, offset on a light background, offset on a dark one
      ["surface.card", 0.015, 0.035],
      ["surface.popover", 0.015, 0.035],
      ["surface.sidebar", -0.02, 0.025],
      ["surface.muted", -0.03, 0.07],
      ["surface.hover", -0.05, 0.1],
      ["surface.sidebarHover", -0.065, 0.1],
    ];
    setToken(out, "surface.background", css(bg));
    for (const [name, light, dark] of surfaces) setToken(out, name, css(at(darkBg ? dark : light)));
    if (text) {
      setToken(out, "text.default", css(text));
      const muted = at(darkBg ? 0.07 : -0.03);
      setToken(out, "text.muted", css(ensureContrast(mix(text, bg, 0.4), muted, 4.5)));
      if (darkBg) {
        setToken(out, "line.border", css({ ...text, alpha: 0.1 }));
        setToken(out, "line.input", css({ ...text, alpha: 0.14 }));
      } else {
        setToken(out, "line.border", css(at(-0.08)));
        setToken(out, "line.input", css(at(-0.08)));
      }
    }
  }

  if (accent && (accentSeed || bgSeed)) {
    setToken(out, "accent.default", css(accent));
    // Button labels: whichever of the page and the ink reads better on the
    // accent, then pushed to 4.5:1 if neither does.
    const text = textSeed ?? read("--foreground");
    const candidates = [bg, text].filter((c): c is Oklch => c !== null);
    const label = candidates.sort((a, b) => contrast(b, accent) - contrast(a, accent))[0];
    if (label) setToken(out, "accent.text", css(ensureContrast({ ...label, alpha: 1 }, accent, 4.5)));
    if (bg) setToken(out, "accent.ring", css(mix(accent, bg, 0.3)));
  }

  const k = side.typeChroma;
  if (k !== undefined && k !== 1 && k >= 0) {
    for (const d of TOKENS) {
      if (!TINTED.includes(d.group)) continue;
      const c = read(d.vars[0]);
      if (c) setToken(out, d.name, css({ ...c, c: Math.min(0.37, c.c * k) }));
    }
  }

  for (const [name, value] of Object.entries(side.overrides ?? {})) {
    if (TOKEN_BY_NAME.has(name) && parseColor(value)) setToken(out, name, value);
  }
  return out;
}

/** Token names in `side.overrides` this version does not know, for the "ignored" note. */
export function unknownOverrides(side: SkinSide): string[] {
  return Object.keys(side.overrides ?? {}).filter((n) => !TOKEN_BY_NAME.has(n));
}

/** Contrast of the pairs the reader depends on, on the resolved palette. */
export function keyContrasts(p: Palette): { text: number | null; muted: number | null; accent: number | null } {
  const ratio = (a: string, b: string) => {
    const [x, y] = [parseColor(p[a] ?? ""), parseColor(p[b] ?? "")];
    return x && y ? contrast(x, y) : null;
  };
  return {
    text: ratio("--foreground", "--background"),
    muted: ratio("--muted-foreground", "--background"),
    accent: ratio("--primary-foreground", "--primary"),
  };
}

// ------------------------------------------------------------ typography

export interface FontDef {
  id: string;
  label: string;
  stack: string;
  kind: "serif" | "sans";
}

/** Fonts the app bundles (plus the system's own), so a shared Skin looks the same everywhere. */
export const FONTS: FontDef[] = [
  { id: "source-serif", label: "Source Serif 4", stack: '"Source Serif 4 Variable", Georgia, serif', kind: "serif" },
  { id: "literata", label: "Literata", stack: '"Literata Variable", Georgia, serif', kind: "serif" },
  { id: "geist", label: "Geist", stack: '"Geist Variable", ui-sans-serif, system-ui, sans-serif', kind: "sans" },
  { id: "inter", label: "Inter", stack: '"Inter Variable", ui-sans-serif, system-ui, sans-serif', kind: "sans" },
  { id: "system-serif", label: "System serif", stack: 'Georgia, "Times New Roman", serif', kind: "serif" },
  { id: "system-sans", label: "System sans-serif", stack: "system-ui, -apple-system, sans-serif", kind: "sans" },
];

export const DEFAULT_PROSE_FONT = "source-serif";
export const DEFAULT_UI_FONT = "geist";
export const DEFAULT_LINE_HEIGHT = 1.65;
export const DEFAULT_LINE_WIDTH = 720;

/** A font value from a Skin as a CSS font-family. Unknown names are system families. */
export function fontStack(value: string | undefined, fallback: string): string {
  const id = value?.trim() || fallback;
  const known = FONTS.find((f) => f.id === id);
  if (known) return known.stack;
  const family = id.replace(/["\\;{}]/g, "");
  return `"${family}", ${FONTS.find((f) => f.id === fallback)!.stack}`;
}

/** The typography CSS variables for one side. */
export function typographyVars(t: SkinTypography): Palette {
  const clampN = (x: number | undefined, lo: number, hi: number, d: number) =>
    typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
  return {
    "--font-prose-stack": fontStack(t.proseFont, DEFAULT_PROSE_FONT),
    "--font-ui": fontStack(t.uiFont, DEFAULT_UI_FONT),
    "--prose-line-height": String(clampN(t.lineHeight, 1.2, 2.2, DEFAULT_LINE_HEIGHT)),
    "--prose-width": `${clampN(t.lineWidth, 480, 1200, DEFAULT_LINE_WIDTH) / 16}rem`,
    "--prose-scale": String(clampN(t.proseSize, 0.8, 1.6, 1)),
  };
}

// ------------------------------------------------------------ built-ins

export const BUILTIN_PREFIX = "builtin:";
export const DEFAULT_SKIN_ID = "builtin:synesis";

const side = (seeds: SkinSeeds, rest: Partial<SkinSide> = {}): SkinSide => ({
  ...emptySide(),
  ...rest,
  seeds,
});

/** The Skins the app ships. Read-only: editing one makes a copy. */
export const BUILTIN_SKINS: Skin[] = [
  { id: DEFAULT_SKIN_ID, name: "Synesis", version: 1, light: emptySide(), dark: emptySide() },
  {
    id: "builtin:sepia",
    name: "Sepia",
    version: 1,
    light: side(
      { background: "#f4ecd8", text: "#3d3022", accent: "#8a5a2b" },
      { typeChroma: 0.8, typography: { proseFont: "literata", lineHeight: 1.75 } },
    ),
    dark: side(
      { background: "#27211a", text: "#e3d6bd", accent: "#d4a86a" },
      { typeChroma: 0.7, typography: { proseFont: "literata", lineHeight: 1.75 } },
    ),
  },
  {
    id: "builtin:high-contrast",
    name: "High contrast",
    version: 1,
    light: side(
      { background: "#ffffff", text: "#000000", accent: "#0035a8" },
      {
        typeChroma: 1.2,
        overrides: { "line.border": "#595959", "line.input": "#595959", "text.muted": "#333333", "editor.unresolved": "#595959" },
      },
    ),
    dark: side(
      { background: "#000000", text: "#ffffff", accent: "#8cbcff" },
      {
        typeChroma: 1.2,
        overrides: { "line.border": "#a6a6a6", "line.input": "#a6a6a6", "text.muted": "#d0d0d0", "editor.unresolved": "#a6a6a6" },
      },
    ),
  },
];

export const isBuiltin = (id: string | null | undefined) => !!id && id.startsWith(BUILTIN_PREFIX);

/** The Skin the Vault wears: the one named, else the default. */
export function pickSkin(id: string | null | undefined, vaultSkins: Skin[]): Skin {
  return [...BUILTIN_SKINS, ...vaultSkins].find((s) => s.id === id) ?? BUILTIN_SKINS[0];
}

/** Which side shows, given the Device's mode and the OS preference. */
export function sideFor(mode: AppearanceMode, systemDark: boolean): Side {
  return mode === "system" ? (systemDark ? "dark" : "light") : mode;
}

/** A name not already used by `taken`: "Sepia" -> "Sepia 2". */
export function freeName(name: string, taken: string[]): string {
  const lower = new Set(taken.map((n) => n.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  const stem = name.replace(/\s+\d+$/, "");
  for (let n = 2; ; n++) if (!lower.has(`${stem} ${n}`.toLowerCase())) return `${stem} ${n}`;
}

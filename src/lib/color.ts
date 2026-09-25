// Colour math for Skins (PLAN §24): parse what the palette and a colour picker
// write (hex, oklch()), move colours in OKLCH, and measure WCAG contrast.
// OKLab conversion after Björn Ottosson, https://bottosson.github.io/posts/oklab/

export interface Oklch {
  l: number;
  c: number;
  h: number;
  /** 0..1 */
  alpha: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

function num(s: string, percentScale = 1): number {
  const t = s.trim();
  return t.endsWith("%") ? (parseFloat(t) / 100) * percentScale : parseFloat(t);
}

/** Parse `#rgb`, `#rrggbb`, `#rrggbbaa` or `oklch(L C H [/ A])`. Anything else is null. */
export function parseColor(input: string): Oklch | null {
  const s = input.trim().toLowerCase();
  if (s.startsWith("#")) {
    let hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("");
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(hex)) return null;
    const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
    return { ...rgbToOklch(n(0), n(2), n(4)), alpha: hex.length === 8 ? n(6) : 1 };
  }
  const m = /^oklch\(\s*([^\s/]+)\s+([^\s/]+)\s+([^\s/)]+)\s*(?:\/\s*([^\s)]+)\s*)?\)$/.exec(s);
  if (!m) return null;
  const l = num(m[1]);
  const c = num(m[2], 0.4);
  const h = m[3] === "none" ? 0 : parseFloat(m[3]);
  const alpha = m[4] === undefined ? 1 : num(m[4]);
  if ([l, c, h, alpha].some(Number.isNaN)) return null;
  return { l, c, h, alpha };
}

const round = (x: number, digits: number) => Number(x.toFixed(digits));

export function formatOklch({ l, c, h, alpha }: Oklch): string {
  const body = `${round(clamp(l, 0, 1), 4)} ${round(Math.max(0, c), 4)} ${round(((h % 360) + 360) % 360, 2)}`;
  return alpha < 1 ? `oklch(${body} / ${round(alpha * 100, 1)}%)` : `oklch(${body})`;
}

// ------------------------------------------------------------ conversions

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function rgbToOklch(r8: number, g8: number, b8: number): Omit<Oklch, "alpha"> {
  const [r, g, b] = [r8, g8, b8].map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  const h = c < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

/** Linear sRGB, unclamped (may fall outside 0..1 when out of gamut). */
function oklchToLinear({ l: L, c, h }: Oklch): [number, number, number] {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function toHex(c: Oklch): string {
  const hex = oklchToLinear(c)
    .map((v) => Math.round(clamp(fromLinear(clamp(v, 0, 1)), 0, 1) * 255))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
}

// ------------------------------------------------------------ contrast

/** WCAG relative luminance of an opaque colour. */
export function luminance(c: Oklch): number {
  const [r, g, b] = oklchToLinear(c).map((v) => clamp(v, 0, 1));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1..21. Alpha is ignored. */
export function contrast(a: Oklch, b: Oklch): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/**
 * Move `fg`'s lightness away from `bg` until the pair reaches `min`, keeping
 * its hue and chroma. Goes whichever way has room; returns the best reachable
 * when neither does.
 */
export function ensureContrast(fg: Oklch, bg: Oklch, target = 4.5): Oklch {
  if (contrast(fg, bg) >= target) return fg;
  // A hair over the target, so formatting the result to a few digits cannot
  // round it back under.
  const min = target + 0.05;
  const tryDir = (target: number): Oklch | null => {
    const end = { ...fg, l: target };
    if (contrast(end, bg) < min) return null;
    // Smallest move from fg.l towards `target` that is enough.
    let [lo, hi] = [fg.l, target];
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (contrast({ ...fg, l: mid }, bg) >= min) hi = mid;
      else lo = mid;
    }
    return { ...fg, l: hi };
  };
  const darker = tryDir(0);
  const lighter = tryDir(1);
  const options = [darker, lighter].filter((o): o is Oklch => o !== null);
  if (options.length) return options.sort((a, b) => Math.abs(a.l - fg.l) - Math.abs(b.l - fg.l))[0];
  const black = { ...fg, l: 0 };
  const white = { ...fg, l: 1 };
  return contrast(black, bg) > contrast(white, bg) ? black : white;
}

/** Mix two colours in OKLCH by `t` (0 = a, 1 = b), hue along the short arc. */
export function mix(a: Oklch, b: Oklch, t: number): Oklch {
  let dh = b.h - a.h;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  // A grey has no hue to speak of: take the other colour's.
  const h = a.c < 0.01 ? b.h : b.c < 0.01 ? a.h : a.h + dh * t;
  return { l: a.l + (b.l - a.l) * t, c: a.c + (b.c - a.c) * t, h, alpha: a.alpha + (b.alpha - a.alpha) * t };
}

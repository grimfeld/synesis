// The phone's status and navigation bars follow the Skin's Background (PLAN
// §24.10). Android's WebView and iOS's WKWebView ignore <meta name="theme-color">,
// so the app asks the shell to paint them (src-tauri/src/system_bars.rs).

import { contrast, parseColor, toHex } from "./color";

export interface SystemBars {
  /** `#rrggbb`, what the shell parses. */
  color: string;
  /** The Background is dark, so the bars' icons are light. */
  dark: boolean;
}

const WHITE = parseColor("#ffffff")!;
const BLACK = parseColor("#000000")!;

/** The bars for a Background, or null when it is not a colour. Icons take
 * whichever of white and black reads better on it. */
export function systemBarsFor(background: string): SystemBars | null {
  const c = parseColor(background);
  if (!c) return null;
  return { color: toHex(c), dark: contrast(c, WHITE) > contrast(c, BLACK) };
}

/** Only a phone's webview inside the app has bars to paint: not the desktop,
 * not the web test build, not a browser on the dev bridge. */
export function hasSystemBars(): boolean {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return false;
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch gives it away.
  return /Android|iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

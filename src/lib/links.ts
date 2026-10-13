// Where Synesis's source and licence live. The AGPL (ADR 0021) asks every
// copy, installed or hosted (§13 for the web build), to offer its source.
import { openUrl } from "@tauri-apps/plugin-opener";

export const SOURCE_URL = "https://github.com/grimfeld/synesis";
export const LICENCE_URL = "https://github.com/grimfeld/synesis/blob/main/LICENSE";

/** Open a web page in the browser: through the opener plugin in the app, a new tab elsewhere. */
export function openExternal(url: string) {
  openUrl(url).catch(() => window.open(url, "_blank", "noopener"));
}

/** Modifier key label for shortcut hints: ⌘ on macOS, Ctrl elsewhere. */
export const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
export const shortcut = (key: string) => `${MOD}${MOD === "⌘" ? "" : "+"}${key}`;

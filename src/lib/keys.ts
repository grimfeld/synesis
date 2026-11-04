// Keyboard shortcut specs and their display. A spec is "Mod+Shift+P",
// "Alt+ArrowLeft", "Mod+E": Mod is ⌘ on macOS and Ctrl elsewhere.
export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = IS_MAC ? "⌘" : "Ctrl";

/** Short hint like "⌘K" / "Ctrl+K" for a Mod-based shortcut. */
export const shortcut = (key: string) => `${MOD}${IS_MAC ? "" : "+"}${key}`;

interface Parsed {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}
function parse(spec: string): Parsed {
  const parts = spec.split("+");
  const key = parts.pop() ?? "";
  return { mod: parts.includes("Mod"), shift: parts.includes("Shift"), alt: parts.includes("Alt"), key };
}

/** Does a keydown event match the spec? */
export function matchShortcut(e: KeyboardEvent, spec: string): boolean {
  const p = parse(spec);
  const mod = IS_MAC ? e.metaKey : e.ctrlKey;
  const other = IS_MAC ? e.ctrlKey : e.metaKey;
  if (other || mod !== p.mod || e.shiftKey !== p.shift || e.altKey !== p.alt) return false;
  if (p.key.length === 1) return e.key.toLowerCase() === p.key.toLowerCase() || e.code === `Key${p.key.toUpperCase()}`;
  return e.key === p.key;
}

/** Spec in CodeMirror keymap form: "Mod+Shift+P" -> "Mod-Shift-p". */
export function toCodeMirrorKey(spec: string): string {
  const p = parse(spec);
  return [p.mod && "Mod", p.shift && "Shift", p.alt && "Alt", p.key.length === 1 ? p.key.toLowerCase() : p.key].filter(Boolean).join("-");
}

const GLYPH: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Enter: "↵", Escape: "Esc" };

/** Key caps for display, one entry per <Kbd>. */
export function formatShortcut(spec: string): string[] {
  return spec.split("+").map((p) => {
    if (p === "Mod") return MOD;
    if (p === "Shift") return "⇧";
    if (p === "Alt") return IS_MAC ? "⌥" : "Alt";
    if (GLYPH[p]) return GLYPH[p];
    return p.length === 1 ? p.toUpperCase() : p;
  });
}

/**
 * Is a key going to a text field of its own — a title, a Property, a dialog,
 * the palette's search — rather than the note's editor?
 *
 * An editing Command's shortcut (Mod+B, Mod+I, Mod+L) must then do nothing:
 * run, it would change the note at its last cursor while the user is typing
 * somewhere else (issue #62). The check is on the key event, not in the
 * Command, so the palette can still run "Bold" on the editor by click.
 */
export function typingInField(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(".cm-editor")) return false;
  if (target.closest("input, textarea, select")) return true;
  return target instanceof HTMLElement && target.isContentEditable === true;
}

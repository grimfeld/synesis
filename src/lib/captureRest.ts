// What a capture box keeps once its text was created (spec #206). The box
// stays editable while the create is in flight, so the user may type on
// after Ctrl/⌘+Enter; emptying the box then would lose those words. Only
// what was submitted goes.

/**
 * The text to leave in the box after `submitted` was created, `now` being
 * the box's text at that moment: empty when nothing changed, what was typed
 * after the submitted text when the user only went on, and the whole text
 * when it was edited elsewhere (nothing is thrown away that cannot be told
 * apart from what was kept).
 */
export function captureRest(submitted: string, now: string): string {
  if (now === submitted) return "";
  // Its leading line breaks are only what separated it from the submitted text.
  if (now.startsWith(submitted)) return now.slice(submitted.length).replace(/^\s*\n/, "");
  return now;
}

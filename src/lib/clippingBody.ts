/**
 * The body a Clipping is stored with: the excerpt as a markdown blockquote.
 *
 * A Clipping is the one document type whose words the user did not write
 * (ADR 0013), and a blockquote is how that reads in Obsidian, which opens the
 * same file (ADR 0003). The app itself does not need the marker — `label`
 * strips a leading `>` when it computes the line to show — so this exists for
 * the vault, not for the views.
 *
 * Text the user already quoted is left alone rather than quoted twice, and a
 * blank line inside a quote keeps its marker so the block stays one quote
 * instead of splitting into two.
 */
export function quoteBody(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const quoted = trimmed
    .split(/\r?\n/)
    .map((line) => (/^\s*>/.test(line) ? line : `> ${line}`.trimEnd()))
    .join("\n");
  return quoted + "\n";
}

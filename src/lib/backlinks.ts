// Grouping the Backlinks list by document.
//
// A Backlink is a document that Mentions this one; each Mention inside it is
// an occurrence. The engine returns one row per occurrence — the honest unit
// for `Vault::rename`, which rewrites every one of them — so collapsing them
// into one row per document is a presentation decision and lives here rather
// than in SQL (ADR 0004 keeps the engine on files and facts).
import type { Backlink, BacklinkKind } from "./api";

/** Every Mention one document makes of the page being viewed. */
export interface BacklinkGroup {
  /** The first occurrence, which supplies the title, the date and the excerpt. */
  first: Backlink;
  /** Every occurrence, in the order the engine returned them. */
  items: Backlink[];
  /** Distinct kind markers, minus the plain link, which has no marker. */
  kinds: BacklinkKind[];
  /** Distinct `via` labels (the Passage as each Mention writes it). */
  via: string[];
  /** Whether any occurrence was inferred, which qualifies the `via` list. */
  inferred: boolean;
}

/**
 * One group per document, ordered by its first occurrence.
 *
 * The engine has already sorted the occurrences, so taking each document's
 * first sighting as the group's position keeps the order the list had when
 * every occurrence was its own row. Book grouping is applied over these groups
 * and is unaffected: it keys off `doc.first_verse`, which belongs to the
 * document, so every occurrence of one document falls in the same Book.
 */
export function groupBacklinks(items: Backlink[]): BacklinkGroup[] {
  const by = new Map<string, BacklinkGroup>();
  const order: string[] = [];
  for (const b of items) {
    let g = by.get(b.doc.id);
    if (!g) {
      g = { first: b, items: [], kinds: [], via: [], inferred: false };
      by.set(b.doc.id, g);
      order.push(b.doc.id);
    }
    g.items.push(b);
    // A plain link is the unmarked case: `kindLabel` renders nothing for it,
    // so listing it would put an empty badge on most rows in the vault.
    if (b.kind !== "link" && !g.kinds.includes(b.kind)) g.kinds.push(b.kind);
    if (b.via && !g.via.includes(b.via)) g.via.push(b.via);
    if (b.inferred) g.inferred = true;
  }
  return order.map((id) => by.get(id)!);
}

/**
 * The `via` labels a row shows, and how many it had to leave out.
 *
 * A document that cites five Passages would otherwise write all five into a
 * badge inside an `overflow-hidden` card — and the French strings around it
 * run half again as long. Three then a count keeps the row bounded whatever
 * the language.
 */
export function viaSummary(
  via: string[],
  cap = 3,
): { shown: string[]; more: number } {
  return { shown: via.slice(0, cap), more: Math.max(0, via.length - cap) };
}

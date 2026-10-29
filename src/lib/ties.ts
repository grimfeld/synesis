// Character↔Place ties as a Hub lists them (CONTEXT.md, Character): the
// engine answers one tie per source, the Hub shows one row per Character on a
// Place's page, or per Place on a Character's, with every way it holds.
import type { DocSummary, PlaceTie } from "./api";

export interface HubTie {
  /** The Character on a Place's Hub, the Place on a Character's. */
  other: DocSummary;
  /** Named in the Character's own `places`: holds for their whole life. */
  lifelong: boolean;
  /** Events naming both, each holding for its own time, in the engine's order. */
  events: DocSummary[];
}

/** The ties touching `id`, merged by the other side, in first-seen order. */
export function hubTies(ties: PlaceTie[], id: string): HubTie[] {
  const rows = new Map<string, HubTie>();
  for (const t of ties) {
    const other =
      t.character.id === id ? t.place : t.place.id === id ? t.character : null;
    if (!other) continue;
    let row = rows.get(other.id);
    if (!row) {
      row = { other, lifelong: false, events: [] };
      rows.set(other.id, row);
    }
    if (t.event) {
      if (!row.events.some((e) => e.id === t.event!.id)) row.events.push(t.event);
    } else {
      row.lifelong = true;
    }
  }
  return [...rows.values()];
}

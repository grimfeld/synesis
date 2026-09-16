// An Event's Date as a list row shows it: the `start` and `end` text exactly as
// written (ADR 0005), joined into a span. Anywhere an Event is listed outside
// its own Hub, this text follows its title (PLAN §18).

/** "c. 52 CE – c. 55 CE", "1513 BCE", "– 33 CE" (end alone), or null when there is nothing to show. */
export function eventDateText(doc: {
  type: string;
  start: string | null;
  end: string | null;
}): string | null {
  if (doc.type !== "event") return null;
  const start = doc.start?.trim() || null;
  const end = doc.end?.trim() || null;
  if (start && end) return `${start} – ${end}`;
  if (start) return start;
  if (end) return `– ${end}`;
  return null;
}

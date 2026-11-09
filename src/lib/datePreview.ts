// The live preview under a Date field (ADR 0005): what the engine read. The
// engine words the Date in the app language, as the picker writes it
// (`read_date`), so the preview, the picker and the parser share one table of
// names; this adds the precision, or says why the text is not a Date.

import type { Dict } from "@/i18n/en";
import type { DatePreview } from "./api";

/** "c. 1513 BCE · year", "14 Nissan 33 de n. è. · jour", or why it is not a Date. */
export function datePreviewText(p: DatePreview, t: Dict): { ok: boolean; text: string } {
  if (!p.ok) return { ok: false, text: t.date_errors[p.error] };
  return { ok: true, text: `${p.words} · ${t.date_precision[p.precision]}` };
}

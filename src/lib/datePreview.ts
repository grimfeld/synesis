// The live preview under a Date field (ADR 0005): what the engine read,
// written out in the app language. Built from the parsed parts, never from the
// user's text — the engine is the only Date parser, and the text stays as typed.

import type { Dict } from "@/i18n/en";
import type { DatePreview, Lang } from "./api";

/** "≈ 1513 BCE · year", "14 nisan 33 de n. è. · jour", or why it is not a Date. */
export function datePreviewText(
  p: DatePreview,
  t: Dict,
  lang: Lang,
): { ok: boolean; text: string } {
  if (!p.ok) return { ok: false, text: t.date_errors[p.error] };
  const month = p.month_name
    ? t.hebrew_months[p.month_name]
    : p.month
      ? civilMonth(p.month, lang)
      : null;
  const parts = [
    p.approx ? t.date_approx : null,
    p.day != null ? String(p.day) : null,
    month,
    String(p.era_year),
    p.bce ? t.bce : t.ce,
  ].filter((x): x is string => x != null);
  return { ok: true, text: `${parts.join(" ")} · ${t.date_precision[p.precision]}` };
}

/** "April" or "avril": the month's name in the app language, not the system's. */
function civilMonth(m: number, lang: Lang): string {
  return new Intl.DateTimeFormat(lang, { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2000, m - 1, 1)),
  );
}

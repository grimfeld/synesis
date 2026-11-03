import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "cn";
import { api, type DatePreview as Reading } from "@/lib/api";
import { datePreviewText } from "@/lib/datePreview";
import { useLang, useT } from "@/i18n";

/**
 * Under a Date field, live as you type: how the app reads the value
 * ("≈ 1513 BCE · year"), or why it is not a Date.
 *
 * The engine reads the text (`read_date`); this only writes its answer out in
 * the app language. The field's text is never touched (ADR 0005).
 */
export function DatePreview({
  text,
  testId,
  className,
}: {
  text: string;
  testId: string;
  className?: string;
}) {
  const t = useT();
  const lang = useLang();
  const [reading, setReading] = useState<Reading | null>(null);
  const value = text.trim();
  useEffect(() => {
    if (!value) {
      setReading(null);
      return;
    }
    // A short pause so a fast typist does not ask once per key; the answer to
    // an older text never lands over a newer one.
    let live = true;
    const timer = setTimeout(() => {
      api
        .readDate(value)
        .then((r) => live && setReading(r))
        .catch(() => live && setReading(null));
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [value]);
  if (!value || !reading) return null;
  const shown = datePreviewText(reading, t, lang);
  return (
    <p
      data-testid={testId}
      data-ok={shown.ok ? "true" : "false"}
      data-error={reading.ok ? undefined : reading.error}
      aria-live="polite"
      className={cn(
        "flex min-w-0 items-start gap-1 text-xs",
        shown.ok ? "text-muted-foreground tabular-nums" : "text-destructive",
        className,
      )}
    >
      {!shown.ok && <CircleAlert className="mt-px size-3.5 shrink-0" />}
      <span className="min-w-0 break-words">{shown.text}</span>
    </p>
  );
}

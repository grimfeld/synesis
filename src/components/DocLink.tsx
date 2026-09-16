import { cn } from "cn";
import type { DocSummary, DocType } from "@/lib/api";
import { eventDateText } from "@/lib/events";
import { useStore } from "@/lib/store";

/** Tailwind background class for each document type (colours live in index.css). */
export const TYPE_BG: Record<DocType, string> = {
  note: "bg-type-note",
  clipping: "bg-type-clipping",
  composition: "bg-type-composition",
  source: "bg-type-source",
  book: "bg-type-scripture",
  chapter: "bg-type-scripture",
  verse: "bg-type-scripture",
  place: "bg-type-place",
  character: "bg-type-character",
  concept: "bg-type-concept",
  event: "bg-type-event",
  journey: "bg-type-journey",
  other: "bg-type-other",
};

export function TypeDot({
  type,
  className,
}: {
  type: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        TYPE_BG[type as DocType] ?? TYPE_BG.other,
        className,
      )}
    />
  );
}

/**
 * An Event's Date as written, to follow its title wherever it is listed
 * outside its own Hub (PLAN §18). Renders nothing for anything else. Capped at
 * half the row so a long French span squeezes the title rather than pushing it
 * out of its box.
 */
export function EventDate({
  doc,
  className,
}: {
  doc: Pick<DocSummary, "type" | "start" | "end">;
  className?: string;
}) {
  const text = eventDateText(doc);
  if (!text) return null;
  return (
    <span
      data-testid="event-date"
      className={cn(
        "ml-auto max-w-[50%] shrink-0 truncate text-xs text-muted-foreground tabular-nums",
        className,
      )}
    >
      {text}
    </span>
  );
}

/** A clickable document title with its type colour. */
export function DocLink({
  doc,
  active,
  className,
  children,
}: {
  doc: DocSummary;
  active?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const s = useStore();
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
        active && "bg-accent font-medium",
        className,
      )}
      onClick={() => s.openDoc(doc.id)}
      title={doc.path}
    >
      <TypeDot type={doc.type} />
      <span className="min-w-0 flex-1 truncate">{doc.label}</span>
      <EventDate doc={doc} />
      {children}
    </button>
  );
}

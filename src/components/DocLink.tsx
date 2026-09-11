import { cn } from "cn";
import type { DocSummary, DocType } from "@/lib/api";
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
      <span className="min-w-0 flex-1 truncate">{doc.title}</span>
      {children}
    </button>
  );
}

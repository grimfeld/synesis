import type { DocSummary } from "@/lib/api";
import { useStore } from "@/lib/store";

export function TypeDot({ type }: { type: string }) {
  return <span className={`type-dot type-${type}`} />;
}

/** A clickable document title with its type colour. */
export function DocLink({ doc, className, children }: { doc: DocSummary; className?: string; children?: React.ReactNode }) {
  const s = useStore();
  return (
    <button className={`row-hover flex w-full items-center rounded px-2 py-1 text-left ${className ?? ""}`} onClick={() => s.openDoc(doc.id)} title={doc.path}>
      <TypeDot type={doc.type} />
      <span className="min-w-0 flex-1 truncate">{doc.title}</span>
      {children}
    </button>
  );
}

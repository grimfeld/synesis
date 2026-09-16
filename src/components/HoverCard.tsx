import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Plus } from "lucide-react";
import { api, type Backlink, type DocSummary, type PassageInfo } from "@/lib/api";
import { splitFrontmatter } from "@/lib/frontmatter";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EventDate, TypeDot } from "./DocLink";

export type HoverState = { kind: "passage"; passages: PassageInfo[]; x: number; y: number } | { kind: "link"; target: string; x: number; y: number };

const W = 340;
const H = 360;

function usePosition(x: number, y: number) {
  const left = Math.max(8, Math.min(x, window.innerWidth - W - 8));
  const top = y + 6 + H > window.innerHeight ? Math.max(8, y - 6 - H) : y + 6;
  return { left, top, width: W, maxHeight: H };
}

/** Floating preview anchored to a Passage or wikilink under the cursor in the editor. */
export function HoverCard({ state, excludeId, onClose }: { state: HoverState; excludeId?: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = usePosition(state.x, state.y);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div ref={ref} data-testid="hover-card" className="thin-scroll fixed z-50 overflow-auto rounded-xl border bg-popover p-3 text-sm text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95" style={pos} onMouseLeave={onClose}>
      {state.kind === "passage" ? <PassageCard passages={state.passages} excludeId={excludeId} onClose={onClose} /> : <LinkCard target={state.target} onClose={onClose} />}
    </div>
  );
}

function Loading() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-3.5 w-2/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
    </div>
  );
}

function PassageCard({ passages, excludeId, onClose }: { passages: PassageInfo[]; excludeId?: string; onClose: () => void }) {
  const s = useStore();
  const t = useT();
  const [items, setItems] = useState<Backlink[] | null>(null);
  const p = passages[0];
  useEffect(() => {
    let alive = true;
    const chapter = p.unit === "book" ? undefined : p.start_chapter;
    const verse = p.unit === "verse" || p.unit === "range" ? (p.start_verse ?? undefined) : undefined;
    api.verseMentions(p.book, chapter, verse).then((r) => alive && setItems(r.filter((b) => b.doc.id !== excludeId)));
    return () => {
      alive = false;
    };
  }, [p, excludeId]);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="font-semibold text-passage">{passages.map((x) => x.display).join("; ")}</div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            onClose();
            s.openPassage(p);
          }}
        >
          {t.open_page}
          <ArrowUpRight />
        </Button>
      </div>
      {items === null ? (
        <Loading />
      ) : items.length === 0 ? (
        <div className="text-xs text-muted-foreground">{t.nothing_written}</div>
      ) : (
        <>
          <div className="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{t.mentions_count(items.length)}</div>
          <ul className="space-y-0.5">
            {items.map((b, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="w-full rounded-md px-2 py-1 text-left transition-colors hover:bg-accent"
                  onClick={() => {
                    onClose();
                    s.openDoc(b.doc.id);
                  }}
                >
                  <div className="flex items-center gap-2">
                    <TypeDot type={b.doc.type} />
                    <span className="truncate font-medium">{b.doc.label}</span>
                    <EventDate doc={b.doc} />
                    {b.via && (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {t.via} {b.via}
                      </span>
                    )}
                  </div>
                  {b.excerpt && <div className="line-clamp-2 pl-4 text-xs text-muted-foreground">{b.excerpt}</div>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function LinkCard({ target, onClose }: { target: string; onClose: () => void }) {
  const s = useStore();
  const t = useT();
  const [doc, setDoc] = useState<DocSummary | null | undefined>(undefined);
  const [preview, setPreview] = useState("");
  useEffect(() => {
    let alive = true;
    api.resolveLink(target).then(async (d) => {
      if (!alive) return;
      setDoc(d);
      if (d) {
        const full = await api.getDocument(d.id);
        if (alive) setPreview(splitFrontmatter(full.text).body.trim().slice(0, 400));
      }
    });
    return () => {
      alive = false;
    };
  }, [target]);
  if (doc === undefined) return <Loading />;
  if (doc === null)
    return (
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate font-semibold text-unresolved">{target}</div>
        <Button
          size="sm"
          onClick={() => {
            onClose();
            s.setDialog({ kind: "create-link", target });
          }}
        >
          <Plus />
          {t.create_page}
        </Button>
      </div>
    );
  return (
    <div>
      <button
        type="button"
        className="mb-0.5 flex w-full items-center gap-2 text-left font-semibold hover:underline underline-offset-4"
        onClick={() => {
          onClose();
          s.openDoc(doc.id);
        }}
      >
        <TypeDot type={doc.type} />
        <span className="truncate">{doc.label}</span>
        <EventDate doc={doc} className="font-normal" />
      </button>
      <div className="mb-2 pl-4 text-xs text-muted-foreground">{t.types[doc.type]}</div>
      <div className="font-prose whitespace-pre-wrap text-[13px] leading-relaxed">{preview || <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}

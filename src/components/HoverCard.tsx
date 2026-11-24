import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUpRight, Plus } from "lucide-react";
import { api, type Backlink, type DocSummary, type PassageInfo } from "@/lib/api";
import { useQuery } from "@/lib/useQuery";
import { splitFrontmatter } from "@/lib/frontmatter";
import { useStore, otherPane } from "@/lib/store";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EventDate, TypeDot } from "./DocLink";

export type HoverState = { kind: "passage"; passages: PassageInfo[]; x: number; y: number } | { kind: "link"; target: string; x: number; y: number };

const W = 340;
const H = 360;

function usePosition(x: number, y: number, origin: { x: number; y: number }) {
  const left = Math.max(8, Math.min(x, window.innerWidth - W - 8));
  const top = y + 6 + H > window.innerHeight ? Math.max(8, y - 6 - H) : y + 6;
  return { left: left - origin.x, top: top - origin.y, width: W, maxHeight: H };
}

/**
 * Where `position: fixed` puts (0, 0). The viewport's corner, except inside a
 * transformed ancestor — a dialog, centred with a translate — which becomes
 * the containing block and would shift the card off its word. Measured with a
 * zero-size probe beside the card, so the card's own animation never skews it.
 */
function useFixedOrigin() {
  const probe = useRef<HTMLSpanElement>(null);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const r = probe.current?.getBoundingClientRect();
    if (r && (r.left !== origin.x || r.top !== origin.y)) setOrigin({ x: r.left, y: r.top });
  });
  return { probe, origin };
}

/**
 * Floating preview anchored to a Passage or wikilink under the cursor in the editor.
 *
 * `stay` is the Delivery view's card (PLAN §23.8): the same preview with
 * every way out removed — no Open page, no row that opens a document, no
 * Create page — because nothing there may leave the talk.
 */
export function HoverCard({ state, excludeId, onClose, stay = false }: { state: HoverState; excludeId?: string; onClose: () => void; stay?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { probe, origin } = useFixedOrigin();
  const pos = usePosition(state.x, state.y, origin);
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
    <>
      <span ref={probe} aria-hidden className="pointer-events-none fixed top-0 left-0 size-0" />
      <div ref={ref} data-testid="hover-card" className="thin-scroll fixed z-50 overflow-auto rounded-xl border bg-popover p-3 text-sm text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95" style={pos} onMouseLeave={onClose}>
        {state.kind === "passage" ? <PassageCard passages={state.passages} excludeId={excludeId} onClose={onClose} stay={stay} /> : <LinkCard target={state.target} onClose={onClose} stay={stay} />}
      </div>
    </>
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

function PassageCard({ passages, excludeId, onClose, stay }: { passages: PassageInfo[]; excludeId?: string; onClose: () => void; stay: boolean }) {
  const s = useStore();
  const t = useT();
  const p = passages[0];
  // Any document may Mention this Passage, so the list moves with the vault.
  const { data, status } = useQuery<Backlink[]>({
    key: [p.book, p.unit, p.start_chapter ?? null, p.start_verse ?? null, excludeId ?? ""],
    deps: { any: true },
    fetch: async () => {
      const chapter = p.unit === "book" ? undefined : p.start_chapter;
      const verse = p.unit === "verse" || p.unit === "range" ? (p.start_verse ?? undefined) : undefined;
      const r = await api.verseMentions(p.book, chapter, verse);
      return r.filter((b) => b.doc.id !== excludeId);
    },
  });
  const items = status === "ready" || data ? data : null;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="font-semibold text-passage">{passages.map((x) => x.display).join("; ")}</div>
        {!stay && (
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
        )}
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
                  disabled={stay}
                  className="w-full rounded-md px-2 py-1 text-left transition-colors enabled:hover:bg-accent"
                  onClick={(e) => {
                    onClose();
                    s.openDoc(b.doc.id, otherPane(e));
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

function LinkCard({ target, onClose, stay }: { target: string; onClose: () => void; stay: boolean }) {
  const s = useStore();
  const t = useT();
  // The document this link names, and the opening of its body: one answer, so
  // the preview can never belong to a different document than the title.
  const { data, status } = useQuery({
    key: [target],
    deps: { any: true },
    fetch: async () => {
      const doc = await api.resolveLink(target);
      if (!doc) return { doc: null, preview: "" };
      const full = await api.getDocument(doc.id);
      return {
        doc,
        preview: splitFrontmatter(full.text).body.trim().slice(0, 400),
      };
    },
  });
  const doc: DocSummary | null | undefined =
    status === "ready" || data ? (data?.doc ?? null) : undefined;
  const preview = data?.preview ?? "";
  if (doc === undefined) return <Loading />;
  if (doc === null)
    return (
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate font-semibold text-unresolved">{target}</div>
        {!stay && (
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
        )}
      </div>
    );
  return (
    <div>
      <button
        type="button"
        disabled={stay}
        className="mb-0.5 flex w-full items-center gap-2 text-left font-semibold enabled:hover:underline underline-offset-4"
        onClick={(e) => {
          onClose();
          s.openDoc(doc.id, otherPane(e));
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

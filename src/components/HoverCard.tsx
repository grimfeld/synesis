import { useEffect, useRef, useState } from "react";
import { api, type Backlink, type DocSummary, type PassageInfo } from "@/lib/api";
import { splitFrontmatter } from "@/lib/frontmatter";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { TypeDot } from "./DocLink";

export type HoverState = { kind: "passage"; passages: PassageInfo[]; x: number; y: number } | { kind: "link"; target: string; x: number; y: number };

function usePosition(x: number, y: number) {
  const w = 340;
  const left = Math.max(8, Math.min(x, window.innerWidth - w - 8));
  const top = y + 6 + 360 > window.innerHeight ? Math.max(8, y - 6 - 360) : y + 6;
  return { left, top };
}

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
    <div ref={ref} className="hover-card thin-scroll" style={pos} onMouseLeave={onClose}>
      {state.kind === "passage" ? <PassageCard passages={state.passages} excludeId={excludeId} onClose={onClose} /> : <LinkCard target={state.target} onClose={onClose} />}
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
        <div className="font-semibold" style={{ color: "var(--passage)" }}>
          {passages.map((x) => x.display).join("; ")}
        </div>
        <button
          className="btn btn-sm"
          onClick={() => {
            onClose();
            s.openPassage(p);
          }}
        >
          {t.open_page}
        </button>
      </div>
      {items === null ? (
        <div className="muted">…</div>
      ) : items.length === 0 ? (
        <div className="muted">{t.nothing_written}</div>
      ) : (
        <>
          <div className="panel-title mb-1">{t.mentions_count(items.length)}</div>
          <ul className="space-y-1">
            {items.map((b, i) => (
              <li key={i}>
                <button
                  className="row-hover w-full rounded px-1 py-1 text-left"
                  onClick={() => {
                    onClose();
                    s.openDoc(b.doc.id);
                  }}
                >
                  <div className="flex items-center">
                    <TypeDot type={b.doc.type} />
                    <span className="truncate font-medium">{b.doc.title}</span>
                    {b.via && (
                      <span className="muted ml-2 shrink-0 text-xs">
                        {t.via} {b.via}
                      </span>
                    )}
                  </div>
                  {b.excerpt && <div className="muted line-clamp-2 text-xs">{b.excerpt}</div>}
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
  if (doc === undefined) return <div className="muted">…</div>;
  if (doc === null)
    return (
      <div>
        <div className="mb-2 font-semibold">{target}</div>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => {
            onClose();
            s.setDialog({ kind: "create-link", target });
          }}
        >
          {t.create_page}
        </button>
      </div>
    );
  return (
    <div>
      <button
        className="mb-1 flex w-full items-center text-left font-semibold"
        onClick={() => {
          onClose();
          s.openDoc(doc.id);
        }}
      >
        <TypeDot type={doc.type} />
        {doc.title}
      </button>
      <div className="muted mb-2 text-xs">{t.types[doc.type]}</div>
      <div className="whitespace-pre-wrap text-xs" style={{ fontFamily: "Georgia, serif" }}>
        {preview || <span className="muted">—</span>}
      </div>
    </div>
  );
}

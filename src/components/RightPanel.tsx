import { useEffect, useMemo, useState } from "react";
import { api, fmString, linkTarget, type Backlink, type Candidate, type DetectedRange, type DocSummary, type DocumentPayload, type TrailEntry, CREATABLE_TYPES, SUBJECT_TYPES, unpackVerse } from "@/lib/api";
import { setField } from "@/lib/frontmatter";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { DocLink, TypeDot } from "./DocLink";

interface Props {
  doc: DocumentPayload;
  fm: string;
  onFmChange: (fm: string) => void;
  detected: DetectedRange[];
}

export function RightPanel({ doc, fm, onFmChange, detected }: Props) {
  const s = useStore();
  const id = doc.summary.id;
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [trail, setTrail] = useState<TrailEntry[]>([]);
  const [children, setChildren] = useState<DocSummary[]>([]);
  const type = doc.summary.type;

  useEffect(() => {
    let alive = true;
    api.backlinks(id).then((b) => alive && setBacklinks(b)).catch(console.error);
    if (type === "composition") api.candidates(id).then((c) => alive && setCandidates(c)).catch(console.error);
    if (type === "source") {
      api.sourceTrail(id).then((x) => alive && setTrail(x)).catch(console.error);
      api.sourceChildren(id).then((x) => alive && setChildren(x)).catch(console.error);
    }
    return () => {
      alive = false;
    };
  }, [id, type, s.changeTick, doc.summary.mtime]);

  return (
    <aside className="thin-scroll flex w-80 shrink-0 flex-col overflow-y-auto border-l" style={{ borderColor: "var(--border)", background: "var(--bg-2)" }}>
      <Properties doc={doc} fm={fm} onFmChange={onFmChange} />
      {type === "composition" && <Candidates items={candidates} detected={detected} />}
      {type === "source" && <SourceTrail trail={trail} childrenDocs={children} />}
      <Backlinks items={backlinks} subject={SUBJECT_TYPES.includes(type)} />
    </aside>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
      <button className="panel-title flex w-full items-center justify-between py-1" onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <span>{open ? "▾" : "▸"}</span>
      </button>
      {open && hint && <div className="muted mb-2 text-xs">{hint}</div>}
      {open && children}
    </section>
  );
}

function Properties({ doc, fm, onFmChange }: { doc: DocumentPayload; fm: string; onFmChange: (fm: string) => void }) {
  const s = useStore();
  const t = useT();
  const [adding, setAdding] = useState("");
  const entries = useMemo(() => Object.entries(doc.frontmatter).filter(([k]) => k !== "id"), [doc.frontmatter]);
  const set = (k: string, v: string) => onFmChange(setField(fm, k, v));
  return (
    <Section title={t.properties}>
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="muted w-24 shrink-0 truncate">{t.type}</span>
          {doc.summary.type === "book" || doc.summary.type === "chapter" || doc.summary.type === "verse" ? (
            <span>{t.types[doc.summary.type]}</span>
          ) : (
            <select className="flex-1 py-0.5" value={fmString(doc.frontmatter.type) || "note"} onChange={(e) => set("type", e.target.value)}>
              {CREATABLE_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t.types[x]}
                </option>
              ))}
            </select>
          )}
        </div>
        {entries
          .filter(([k]) => k !== "type")
          .map(([k, v]) => {
            const link = typeof v === "string" && /^\[\[.*\]\]$/.test(v.trim()) ? linkTarget(v) : null;
            return (
              <div key={k} className="flex items-center gap-2 text-sm">
                <span className="muted w-24 shrink-0 truncate" title={k}>
                  {k}
                </span>
                <input
                  className="min-w-0 flex-1 py-0.5"
                  defaultValue={Array.isArray(v) ? v.map(fmString).join(", ") : fmString(v)}
                  key={k + fmString(v)}
                  onBlur={(e) => {
                    const val = e.target.value;
                    if (val === (Array.isArray(v) ? v.map(fmString).join(", ") : fmString(v))) return;
                    if (Array.isArray(v) || k === "aliases" || k === "tags")
                      onFmChange(
                        setField(
                          fm,
                          k,
                          val
                            .split(",")
                            .map((x) => x.trim())
                            .filter(Boolean),
                        ),
                      );
                    else set(k, val);
                  }}
                />
                {link && (
                  <button className="btn btn-ghost btn-sm shrink-0" style={{ color: "var(--link)" }} onClick={() => s.openLink(link)} title={link}>
                    ↗
                  </button>
                )}
              </div>
            );
          })}
        <form
          className="flex gap-1 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            const k = adding.trim().replace(/[^\w-]/g, "");
            if (!k) return;
            set(k, "");
            setAdding("");
          }}
        >
          <input className="flex-1 py-0.5 text-xs" placeholder={t.add_property} value={adding} onChange={(e) => setAdding(e.target.value)} />
        </form>
      </div>
    </Section>
  );
}

function BacklinkItem({ b }: { b: Backlink }) {
  const s = useStore();
  const t = useT();
  return (
    <li>
      <button className="row-hover w-full rounded px-2 py-1 text-left" onClick={() => s.openDoc(b.doc.id)}>
        <div className="flex items-center text-sm">
          <TypeDot type={b.doc.type} />
          <span className="min-w-0 flex-1 truncate font-medium">{b.doc.title}</span>
          <span className="muted ml-2 shrink-0 text-xs">
            {b.kind === "mention" && b.via ? `${t.via} ${b.via}${b.inferred ? ` · ${t.inferred}` : ""}` : b.kind === "tag" ? "#" : b.kind === "property" ? b.property : b.kind === "embed" ? "![[ ]]" : ""}
          </span>
        </div>
        {b.excerpt && <div className="muted line-clamp-2 text-xs">{b.excerpt}</div>}
      </button>
    </li>
  );
}

function Backlinks({ items, subject }: { items: Backlink[]; subject: boolean }) {
  const s = useStore();
  const t = useT();
  const groups = useMemo(() => {
    if (!subject) return [{ label: null as string | null, items }];
    const byBook = new Map<number, Backlink[]>();
    const other: Backlink[] = [];
    for (const b of items) {
      if (b.doc.first_verse == null) other.push(b);
      else {
        const bk = unpackVerse(b.doc.first_verse).book;
        byBook.set(bk, [...(byBook.get(bk) ?? []), b]);
      }
    }
    const out = [...byBook.entries()].sort((a, b) => a[0] - b[0]).map(([bk, its]) => ({ label: s.books.find((x) => x.number === bk)?.name ?? String(bk), items: its.sort((a, b) => (a.doc.first_verse ?? 0) - (b.doc.first_verse ?? 0)) }));
    if (other.length) out.push({ label: t.other_docs, items: other });
    return out;
  }, [items, subject, s.books, t.other_docs]);
  return (
    <Section title={`${t.backlinks} · ${items.length}`} hint={subject && items.length ? t.book_order : undefined}>
      {items.length === 0 ? (
        <div className="muted text-xs">{t.no_backlinks}</div>
      ) : (
        groups.map((g, i) => (
          <div key={i} className="mb-2">
            {g.label && <div className="muted mb-1 text-xs font-semibold">{g.label}</div>}
            <ul className="space-y-0.5">
              {g.items.map((b, j) => (
                <BacklinkItem key={j} b={b} />
              ))}
            </ul>
          </div>
        ))
      )}
    </Section>
  );
}

function Candidates({ items, detected }: { items: Candidate[]; detected: DetectedRange[] }) {
  const s = useStore();
  const t = useT();
  const live = detected.length;
  return (
    <Section title={`${t.candidates} · ${items.length}`} hint={t.candidates_hint}>
      {items.length === 0 ? (
        <div className="muted text-xs">{live ? "…" : t.no_candidates}</div>
      ) : (
        <ul className="space-y-0.5">
          {items.map((c) => (
            <li key={c.doc.id}>
              <button className="row-hover w-full rounded px-2 py-1 text-left" onClick={() => s.openDoc(c.doc.id)}>
                <div className="flex items-center text-sm">
                  <TypeDot type={c.doc.type} />
                  <span className="min-w-0 flex-1 truncate font-medium">{c.doc.title}</span>
                </div>
                <div className="muted truncate text-xs">{[...c.shared_tags.map((x) => "#" + x), ...c.shared_passages].join(" · ")}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function SourceTrail({ trail, childrenDocs }: { trail: TrailEntry[]; childrenDocs: DocSummary[] }) {
  const s = useStore();
  const t = useT();
  return (
    <>
      {childrenDocs.length > 0 && (
        <Section title={`${t.child_sources} · ${childrenDocs.length}`}>
          <ul>
            {childrenDocs.map((d) => (
              <li key={d.id}>
                <DocLink doc={d} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title={`${t.reading_trail} · ${trail.length}`}>
        {trail.length === 0 ? (
          <div className="muted text-xs">{t.no_trail}</div>
        ) : (
          <ul className="space-y-0.5">
            {trail.map((e, i) => (
              <li key={i}>
                <button className="row-hover flex w-full items-center rounded px-2 py-1 text-left text-sm" onClick={() => s.openDoc(e.doc.id)}>
                  <span className="muted w-16 shrink-0 truncate text-xs">{e.locator ?? "—"}</span>
                  <TypeDot type={e.doc.type} />
                  <span className="min-w-0 flex-1 truncate">{e.doc.title}</span>
                  {e.source.id !== trail[0]?.source.id && <span className="muted ml-1 truncate text-xs">{e.source.title}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

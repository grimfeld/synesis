import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
import { api, fmString, linkTarget, type Backlink, type Candidate, type DetectedRange, type DocSummary, type DocumentPayload, type TrailEntry, CREATABLE_TYPES, SUBJECT_TYPES, unpackVerse } from "@/lib/api";
import { setField } from "@/lib/frontmatter";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
    <aside className="thin-scroll flex w-80 shrink-0 flex-col overflow-y-auto border-l bg-sidebar text-sidebar-foreground">
      <Properties doc={doc} fm={fm} onFmChange={onFmChange} />
      {type === "composition" && <Candidates items={candidates} detected={detected} />}
      {type === "source" && <SourceTrail trail={trail} childrenDocs={children} />}
      <Backlinks items={backlinks} subject={SUBJECT_TYPES.includes(type)} />
    </aside>
  );
}

function Section({ title, count, hint, children }: { title: string; count?: number; hint?: string; children: ReactNode }) {
  return (
    <Collapsible defaultOpen className="border-b">
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 px-3 py-2.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase transition-colors hover:text-foreground">
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        <span className="flex-1 text-left">{title}</span>
        {count != null && <span className="font-normal tabular-nums">{count}</span>}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        {hint && <p className="mb-2 text-xs text-muted-foreground">{hint}</p>}
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

function Properties({ doc, fm, onFmChange }: { doc: DocumentPayload; fm: string; onFmChange: (fm: string) => void }) {
  const s = useStore();
  const t = useT();
  const [adding, setAdding] = useState("");
  const entries = useMemo(() => Object.entries(doc.frontmatter).filter(([k]) => k !== "id"), [doc.frontmatter]);
  const set = (k: string, v: string) => onFmChange(setField(fm, k, v));
  const isScripture = doc.summary.type === "book" || doc.summary.type === "chapter" || doc.summary.type === "verse";
  return (
    <Section title={t.properties}>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-sm">
          <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">{t.type}</span>
          {isScripture ? (
            <span className="flex items-center gap-2 text-xs">
              <TypeDot type={doc.summary.type} />
              {t.types[doc.summary.type]}
            </span>
          ) : (
            <Select value={fmString(doc.frontmatter.type) || "note"} onValueChange={(v) => set("type", v)}>
              <SelectTrigger size="sm" className="h-7 flex-1 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CREATABLE_TYPES.map((x) => (
                  <SelectItem key={x} value={x}>
                    <TypeDot type={x} />
                    {t.types[x]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        {entries
          .filter(([k]) => k !== "type")
          .map(([k, v]) => {
            const link = typeof v === "string" && /^\[\[.*\]\]$/.test(v.trim()) ? linkTarget(v) : null;
            const shown = Array.isArray(v) ? v.map(fmString).join(", ") : fmString(v);
            return (
              <div key={k} className="flex items-center gap-2 text-sm">
                <span className="w-24 shrink-0 truncate text-xs text-muted-foreground" title={k}>
                  {k}
                </span>
                <Input
                  className="h-7 min-w-0 flex-1 text-xs"
                  defaultValue={shown}
                  key={k + shown}
                  onBlur={(e) => {
                    const val = e.target.value;
                    if (val === shown) return;
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
                  <Button variant="ghost" size="icon-xs" className="shrink-0 text-link" onClick={() => s.openLink(link)} title={link} aria-label={t.open}>
                    <ExternalLink />
                  </Button>
                )}
              </div>
            );
          })}
        <form
          className="pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            const k = adding.trim().replace(/[^\w-]/g, "");
            if (!k) return;
            set(k, "");
            setAdding("");
          }}
        >
          <Input className="h-7 text-xs" placeholder={`+ ${t.add_property}`} value={adding} onChange={(e) => setAdding(e.target.value)} />
        </form>
      </div>
    </Section>
  );
}

function kindLabel(b: Backlink, via: string, inferred: string): string {
  if (b.kind === "mention" && b.via) return `${via} ${b.via}${b.inferred ? ` · ${inferred}` : ""}`;
  if (b.kind === "tag") return "#";
  if (b.kind === "property") return b.property ?? "";
  if (b.kind === "embed") return "![[ ]]";
  return "";
}

function BacklinkItem({ b }: { b: Backlink }) {
  const s = useStore();
  const t = useT();
  const label = kindLabel(b, t.via, t.inferred);
  return (
    <li>
      <button type="button" className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent" onClick={() => s.openDoc(b.doc.id)}>
        <div className="flex items-center gap-2 text-sm">
          <TypeDot type={b.doc.type} />
          <span className="min-w-0 flex-1 truncate font-medium">{b.doc.title}</span>
          {label && (
            <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px] font-normal text-muted-foreground">
              {label}
            </Badge>
          )}
        </div>
        {b.excerpt && <div className="mt-0.5 line-clamp-2 pl-4 text-xs text-muted-foreground">{b.excerpt}</div>}
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
    <Section title={t.backlinks} count={items.length} hint={subject && items.length ? t.book_order : undefined}>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">{t.no_backlinks}</div>
      ) : (
        groups.map((g, i) => (
          <div key={i} className="mb-2 last:mb-0">
            {g.label && <div className="mb-1 px-2 text-xs font-semibold text-muted-foreground">{g.label}</div>}
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
    <Section title={t.candidates} count={items.length} hint={t.candidates_hint}>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">{live ? t.loading : t.no_candidates}</div>
      ) : (
        <ul className="space-y-0.5">
          {items.map((c) => (
            <li key={c.doc.id}>
              <button type="button" className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent" onClick={() => s.openDoc(c.doc.id)}>
                <div className="flex items-center gap-2 text-sm">
                  <TypeDot type={c.doc.type} />
                  <span className="min-w-0 flex-1 truncate font-medium">{c.doc.title}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1 pl-4">
                  {c.shared_tags.map((x) => (
                    <Badge key={"t" + x} variant="secondary" className="h-4 px-1 text-[10px] font-normal text-tag">
                      #{x}
                    </Badge>
                  ))}
                  {c.shared_passages.map((x) => (
                    <Badge key={"p" + x} variant="secondary" className="h-4 px-1 text-[10px] font-normal text-passage">
                      {x}
                    </Badge>
                  ))}
                </div>
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
        <Section title={t.child_sources} count={childrenDocs.length}>
          <ul className="space-y-0.5">
            {childrenDocs.map((d) => (
              <li key={d.id}>
                <DocLink doc={d} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title={t.reading_trail} count={trail.length}>
        {trail.length === 0 ? (
          <div className="text-xs text-muted-foreground">{t.no_trail}</div>
        ) : (
          <ul className="space-y-0.5">
            {trail.map((e, i) => (
              <li key={i}>
                <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-accent" onClick={() => s.openDoc(e.doc.id)}>
                  <span className="w-14 shrink-0 truncate text-xs text-muted-foreground tabular-nums">{e.locator ?? "—"}</span>
                  <TypeDot type={e.doc.type} />
                  <span className="min-w-0 flex-1 truncate">{e.doc.title}</span>
                  {e.source.id !== trail[0]?.source.id && <span className="ml-1 truncate text-xs text-muted-foreground">{e.source.title}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

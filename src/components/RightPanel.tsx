import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, ExternalLink, Trash2 } from "lucide-react";
import {
  api,
  fmString,
  linkTarget,
  type Backlink,
  type Candidate,
  type DetectedRange,
  type DocSummary,
  type DocumentPayload,
  type HistoryPoint,
  type PropertyType,
  type Version,
  type TrailEntry,
  PROPERTY_TYPES,
  RESERVED_PROPERTIES,
  CREATABLE_TYPES,
  SUBJECT_TYPES,
  unpackVerse,
} from "@/lib/api";
import { setField } from "@/lib/frontmatter";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DocLink, TypeDot } from "./DocLink";
import { PanelTitle } from "./Field";

interface Props {
  doc: DocumentPayload;
  fm: string;
  onFmChange: (fm: string) => void;
  detected: DetectedRange[];
  /** Replace the page's text with a restored Version. */
  onRestore?: (text: string) => void;
  /** Save pending edits before a Version is named. */
  flush?: () => Promise<void>;
}

export function RightPanel({
  doc,
  fm,
  onFmChange,
  detected,
  onRestore,
  flush,
}: Props) {
  const s = useStore();
  const id = doc.summary.id;
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [trail, setTrail] = useState<TrailEntry[]>([]);
  const [children, setChildren] = useState<DocSummary[]>([]);
  const type = doc.summary.type;

  useEffect(() => {
    let alive = true;
    api
      .backlinks(id)
      .then((b) => alive && setBacklinks(b))
      .catch(console.error);
    if (type === "composition")
      api
        .candidates(id)
        .then((c) => alive && setCandidates(c))
        .catch(console.error);
    if (type === "source") {
      api
        .sourceTrail(id)
        .then((x) => alive && setTrail(x))
        .catch(console.error);
      api
        .sourceChildren(id)
        .then((x) => alive && setChildren(x))
        .catch(console.error);
    }
    return () => {
      alive = false;
    };
  }, [id, type, s.changeTick, doc.summary.mtime]);

  return (
    <aside
      data-testid="right-panel"
      className="thin-scroll flex w-80 shrink-0 flex-col overflow-y-auto border-l bg-sidebar text-sidebar-foreground"
    >
      <Properties doc={doc} fm={fm} onFmChange={onFmChange} />
      {type === "composition" && (
        <Candidates items={candidates} detected={detected} />
      )}
      {type === "composition" && onRestore && (
        <Versions
          id={id}
          mtime={doc.summary.mtime}
          onRestore={onRestore}
          flush={flush}
        />
      )}
      {type === "source" && (
        <SourceTrail trail={trail} childrenDocs={children} />
      )}
      <Backlinks items={backlinks} subject={SUBJECT_TYPES.includes(type)} />
    </aside>
  );
}

export function Section({
  title,
  count,
  hint,
  children,
  defaultOpen = true,
}: {
  title: string;
  count?: number;
  hint?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="border-b">
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 px-3 py-2.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase transition-colors hover:text-foreground">
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        <span className="flex-1 text-left">{title}</span>
        {count != null && (
          <span className="font-normal tabular-nums">{count}</span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        {hint && <p className="mb-2 text-xs text-muted-foreground">{hint}</p>}
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function Properties({
  doc,
  fm,
  onFmChange,
  inline,
}: {
  doc: DocumentPayload;
  fm: string;
  onFmChange: (fm: string) => void;
  inline?: boolean;
}) {
  const s = useStore();
  const t = useT();
  const [adding, setAdding] = useState("");
  const [addingType, setAddingType] = useState<PropertyType>("text");
  const entries = useMemo(
    () =>
      Object.entries(doc.frontmatter).filter(
        ([k]) => k !== "id" && k !== "title" && k !== "tags",
      ),
    [doc.frontmatter],
  );
  const set = (k: string, v: string) => onFmChange(setField(fm, k, v));
  const isScripture =
    doc.summary.type === "book" ||
    doc.summary.type === "chapter" ||
    doc.summary.type === "verse";
  const newName = adding.trim().replace(/[^\w-]/g, "");
  const knownType = newName ? s.schema.types[newName] : undefined;
  // Not a component defined inline: that would remount every input on each render.
  const body = (
    <div className={inline ? "grid gap-1.5 sm:grid-cols-2" : "space-y-1.5"}>
      <div className="flex items-center gap-2 text-sm">
        <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">
          {t.type}
        </span>
        {isScripture ? (
          <span className="flex items-center gap-2 text-xs">
            <TypeDot type={doc.summary.type} />
            {t.types[doc.summary.type]}
          </span>
        ) : (
          <Select
            value={fmString(doc.frontmatter.type) || "note"}
            onValueChange={(v) => set("type", v)}
          >
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
        .map(([k, v]) => (
          <PropertyRow
            key={k}
            name={k}
            value={v}
            propType={s.schema.types[k] ?? "text"}
            fm={fm}
            onFmChange={onFmChange}
          />
        ))}
      <form
        className="flex items-center gap-1 pt-1"
        data-testid="add-property"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!newName || RESERVED_PROPERTIES.includes(newName)) return;
          const type = knownType ?? addingType;
          if (!knownType) await s.setPropertyType(newName, type);
          onFmChange(
            setField(
              fm,
              newName,
              type === "checkbox" ? false : type === "list" ? [] : "",
            ),
          );
          setAdding("");
          setAddingType("text");
        }}
      >
        <Input
          className="h-7 min-w-0 flex-1 text-xs"
          placeholder={`+ ${t.add_property}`}
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
        />
        {newName &&
          (knownType ? (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {t.property_types[knownType]}
            </span>
          ) : (
            <Select
              value={addingType}
              onValueChange={(v) => setAddingType(v as PropertyType)}
            >
              <SelectTrigger
                size="sm"
                className="h-7 w-24 shrink-0 text-xs"
                aria-label={t.property_type}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROPERTY_TYPES.map((x) => (
                  <SelectItem key={x} value={x}>
                    {t.property_types[x]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}
      </form>
    </div>
  );
  return inline ? body : <Section title={t.properties}>{body}</Section>;
}

/** One Property: widget chosen by its type (ADR 0006); the key opens a menu to retype it. */
function PropertyRow({
  name,
  value,
  propType,
  fm,
  onFmChange,
}: {
  name: string;
  value: unknown;
  propType: PropertyType;
  fm: string;
  onFmChange: (fm: string) => void;
}) {
  const s = useStore();
  const t = useT();
  const shown = Array.isArray(value)
    ? value.map(fmString).join(", ")
    : fmString(value);
  const link =
    propType === "link" || /^\[\[.*\]\]$/.test(shown.trim())
      ? linkTarget(shown)
      : null;
  const commit = (val: string) => {
    if (val === shown) return;
    switch (propType) {
      case "list":
        onFmChange(
          setField(
            fm,
            name,
            val
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
          ),
        );
        break;
      case "number": {
        const n = Number(val);
        onFmChange(setField(fm, name, val.trim() === "" || isNaN(n) ? val : n));
        break;
      }
      case "link":
        onFmChange(
          setField(
            fm,
            name,
            val.trim() && !/^\[\[.*\]\]$/.test(val.trim())
              ? `[[${val.trim()}]]`
              : val,
          ),
        );
        break;
      default:
        onFmChange(setField(fm, name, val));
    }
  };
  const retypable = !RESERVED_PROPERTIES.includes(name);
  const label = (
    <span
      className="w-24 shrink-0 truncate text-xs text-muted-foreground"
      title={`${name} · ${t.property_types[propType]}`}
    >
      {name}
    </span>
  );
  return (
    <div
      className="flex items-center gap-2 text-sm"
      data-testid={`property-${name}`}
      data-prop-type={propType}
    >
      {retypable ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-24 shrink-0 items-center text-left hover:text-foreground"
              aria-label={`${name}: ${t.property_type}`}
            >
              {label}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>{t.property_type}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={propType}
              onValueChange={(v) =>
                s.setPropertyType(name, v as PropertyType).catch(console.error)
              }
            >
              {PROPERTY_TYPES.map((x) => (
                <DropdownMenuRadioItem key={x} value={x}>
                  {t.property_types[x]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        label
      )}
      {propType === "checkbox" ? (
        <input
          type="checkbox"
          className="size-4"
          checked={value === true || shown === "true"}
          onChange={(e) => onFmChange(setField(fm, name, e.target.checked))}
        />
      ) : (
        <Input
          className="h-7 min-w-0 flex-1 text-xs"
          key={name + shown}
          defaultValue={shown}
          type={
            propType === "number"
              ? "number"
              : propType === "calendar" && /^(\d{4}-\d{2}-\d{2})?$/.test(shown)
                ? "date"
                : "text"
          }
          step={propType === "number" ? "any" : undefined}
          placeholder={
            propType === "date"
              ? t.date_placeholder
              : propType === "link"
                ? "[[…]]"
                : undefined
          }
          onBlur={(e) => commit(e.target.value)}
        />
      )}
      {link && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-link"
          onClick={() => s.openLink(link)}
          title={link}
          aria-label={t.open}
        >
          <ExternalLink />
        </Button>
      )}
    </div>
  );
}

function kindLabel(b: Backlink, via: string, inferred: string): string {
  if (b.kind === "mention" && b.via)
    return `${via} ${b.via}${b.inferred ? ` · ${inferred}` : ""}`;
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
      <button
        type="button"
        className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
        onClick={() => s.openDoc(b.doc.id)}
      >
        <div className="flex items-center gap-2 text-sm">
          <TypeDot type={b.doc.type} />
          <span className="min-w-0 flex-1 truncate font-medium">
            {b.doc.title}
          </span>
          {label && (
            <Badge
              variant="outline"
              className="h-4 shrink-0 px-1 text-[10px] font-normal text-muted-foreground"
            >
              {label}
            </Badge>
          )}
        </div>
        {b.excerpt && (
          <div className="mt-0.5 line-clamp-2 pl-4 text-xs text-muted-foreground">
            {b.excerpt}
          </div>
        )}
      </button>
    </li>
  );
}

export function Backlinks({
  items,
  subject,
  inline,
}: {
  items: Backlink[];
  subject: boolean;
  inline?: boolean;
}) {
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
    const out = [...byBook.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([bk, its]) => ({
        label: s.books.find((x) => x.number === bk)?.name ?? String(bk),
        items: its.sort(
          (a, b) => (a.doc.first_verse ?? 0) - (b.doc.first_verse ?? 0),
        ),
      }));
    if (other.length) out.push({ label: t.other_docs, items: other });
    return out;
  }, [items, subject, s.books, t.other_docs]);
  const content =
    items.length === 0 ? (
      <div className="text-xs text-muted-foreground">{t.no_backlinks}</div>
    ) : (
      groups.map((g, i) => (
        <div key={i} className="mb-2 last:mb-0">
          {g.label && (
            <div className="mb-1 px-2 text-xs font-semibold text-muted-foreground">
              {g.label}
            </div>
          )}
          <ul className="space-y-0.5">
            {g.items.map((b, j) => (
              <BacklinkItem key={j} b={b} />
            ))}
          </ul>
        </div>
      ))
    );
  if (inline)
    return (
      <section data-testid="backlinks">
        <PanelTitle className="mb-3">
          {t.backlinks}
          {items.length > 0 && (
            <span className="ml-2 font-normal tabular-nums">
              {items.length}
            </span>
          )}
        </PanelTitle>
        {subject && items.length > 0 && (
          <p className="mb-2 text-xs text-muted-foreground">{t.book_order}</p>
        )}
        {content}
      </section>
    );
  return (
    <div data-testid="backlinks">
      <Section
        title={t.backlinks}
        count={items.length}
        hint={subject && items.length ? t.book_order : undefined}
      >
        {content}
      </Section>
    </div>
  );
}

export function Candidates({
  items,
  detected,
}: {
  items: Candidate[];
  detected: DetectedRange[];
}) {
  const t = useT();
  const live = detected.length;
  const unused = items.filter((c) => !c.used);
  const used = items.filter((c) => c.used);
  return (
    <>
      <Section
        title={t.candidates}
        count={unused.length}
        hint={t.candidates_hint}
      >
        <div data-testid="candidates" />
        {unused.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            {live ? t.loading : t.no_candidates}
          </div>
        ) : (
          <CandidateList items={unused} />
        )}
      </Section>
      {used.length > 0 && (
        <Section
          title={t.used_material}
          count={used.length}
          hint={t.used_material_hint}
          defaultOpen={false}
        >
          <div data-testid="used-material" />
          <CandidateList items={used} />
        </Section>
      )}
    </>
  );
}

function CandidateList({ items }: { items: Candidate[] }) {
  const s = useStore();
  return (
    <ul className="space-y-0.5">
      {items.map((c) => (
        <li key={c.doc.id}>
          <button
            type="button"
            className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
            onClick={() => s.openDoc(c.doc.id)}
          >
            <div className="flex items-center gap-2 text-sm">
              <TypeDot type={c.doc.type} />
              <span className="min-w-0 flex-1 truncate font-medium">
                {c.doc.title}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap gap-1 pl-4">
              {c.shared_tags.map((x) => (
                <Badge
                  key={"t" + x}
                  variant="secondary"
                  className="h-4 px-1 text-[10px] font-normal text-tag"
                >
                  #{x}
                </Badge>
              ))}
              {c.shared_passages.map((x) => (
                <Badge
                  key={"p" + x}
                  variant="secondary"
                  className="h-4 px-1 text-[10px] font-normal text-passage"
                >
                  {x}
                </Badge>
              ))}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Named Versions of a Composition (ADR 0007) and a browser over its unnamed history. */
function Versions({
  id,
  mtime,
  onRestore,
  flush,
}: {
  id: string;
  mtime: number;
  onRestore: (text: string) => void;
  flush?: () => Promise<void>;
}) {
  const s = useStore();
  const t = useT();
  const [versions, setVersions] = useState<Version[]>([]);
  const [history, setHistory] = useState<HistoryPoint[] | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = () => {
    api.versions(id).then(setVersions).catch(console.error);
    if (history) api.history(id).then(setHistory).catch(console.error);
  };
  useEffect(() => {
    let alive = true;
    api
      .versions(id)
      .then((v) => alive && setVersions(v))
      .catch(console.error);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, mtime]);
  const open = (frontier: string, title: string) =>
    s.setDialog({ kind: "version", id, frontier, label: title, onRestore });
  const when = (ms: number) => new Date(ms).toLocaleString();
  return (
    <Section title={t.versions} count={versions.length} hint={t.versions_hint}>
      <div data-testid="versions" />
      <form
        className="mb-2 flex items-center gap-1"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          try {
            await flush?.();
            await api.saveVersion(id, label.trim() || when(Date.now()));
            setLabel("");
            reload();
          } catch (err) {
            console.error(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input
          className="h-7 min-w-0 flex-1 text-xs"
          placeholder={t.version_label_placeholder}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          aria-label={t.save_version}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="h-7 shrink-0"
          disabled={busy}
        >
          {t.save_version}
        </Button>
      </form>
      {versions.length === 0 ? (
        <div className="text-xs text-muted-foreground">{t.no_versions}</div>
      ) : (
        <ul className="space-y-0.5">
          {versions.map((v) => (
            <li
              key={v.key}
              className="flex items-center gap-1"
              data-testid="version-item"
            >
              <button
                type="button"
                className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                onClick={() => open(v.frontier, v.label)}
              >
                <div className="truncate text-sm font-medium">{v.label}</div>
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {when(v.created)}
                </div>
              </button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                aria-label={`${t.delete_version}: ${v.label}`}
                onClick={() =>
                  api.deleteVersion(id, v.key).then(reload).catch(console.error)
                }
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Collapsible
        className="mt-2"
        onOpenChange={(o) => {
          if (o && !history)
            api.history(id).then(setHistory).catch(console.error);
        }}
      >
        <CollapsibleTrigger className="group flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground">
          <ChevronRight className="size-3 transition-transform group-data-[state=open]:rotate-90" />
          {t.browse_history}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div data-testid="history" />
          {!history ? null : history.length === 0 ? (
            <div className="mt-1 text-xs text-muted-foreground">
              {t.no_history}
            </div>
          ) : (
            <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
              {history.map((h) => (
                <li key={h.frontier}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-accent"
                    onClick={() =>
                      open(
                        h.frontier,
                        h.timestamp
                          ? when(h.timestamp * 1000)
                          : t.history_point(h.ops),
                      )
                    }
                  >
                    <span className="min-w-0 flex-1 truncate tabular-nums">
                      {h.timestamp ? when(h.timestamp * 1000) : "—"}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {t.history_point(h.ops)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CollapsibleContent>
      </Collapsible>
    </Section>
  );
}

export function SourceTrail({
  trail,
  childrenDocs,
}: {
  trail: TrailEntry[];
  childrenDocs: DocSummary[];
}) {
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
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-accent"
                  onClick={() => s.openDoc(e.doc.id)}
                >
                  <span className="w-14 shrink-0 truncate text-xs text-muted-foreground tabular-nums">
                    {e.locator ?? "—"}
                  </span>
                  <TypeDot type={e.doc.type} />
                  <span className="min-w-0 flex-1 truncate">{e.doc.title}</span>
                  {e.source.id !== trail[0]?.source.id && (
                    <span className="ml-1 truncate text-xs text-muted-foreground">
                      {e.source.title}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

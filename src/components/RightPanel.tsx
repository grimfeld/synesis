import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, ExternalLink, Link2, Trash2 } from "lucide-react";
import { cn } from "cn";
import {
  api,
  fmString,
  linkTarget,
  type Backlink,
  type BacklinkKind,
  type Candidate,
  type DetectedRange,
  type DocSummary,
  type DocumentPayload,
  type HistoryPoint,
  type Linkable,
  type PropertyType,
  type Version,
  type TrailEntry,
  type UnlinkedMention,
  type UnlinkedMentions as UnlinkedMentionsData,
  PROPERTY_TYPES,
  RESERVED_PROPERTIES,
  CREATABLE_TYPES,
  LINKABLE_TARGET_TYPES,
  SUBJECT_TYPES,
  WRITING_TYPES,
  unpackVerse,
} from "@/lib/api";
import {
  groupBacklinks,
  viaSummary,
  type BacklinkGroup,
} from "@/lib/backlinks";
import { removeField, setField } from "@/lib/frontmatter";
import { resolve } from "@/lib/findOccurrence";
import { linkInBody } from "@/lib/linkText";
import { useQuery } from "@/lib/useQuery";
import { useStore } from "@/lib/store";
import { propertyLabel, useFormat, useT } from "@/i18n";
import { toast } from "sonner";
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
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
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
import { DocLink, EventDate, TypeDot } from "./DocLink";
import { PanelTitle } from "./Field";

interface Props {
  doc: DocumentPayload;
  /** Inside the mobile Sheet the panel fills it instead of being a fixed column. */
  inSheet?: boolean;
  fm: string;
  onFmChange: (fm: string) => void;
  detected: DetectedRange[];
  /** The body being edited, and a way to write back into it, for Linkables. */
  body?: string;
  onBodyChange?: (text: string) => void;
  /** Put the cursor on one occurrence so the writer can read it in context. */
  onReveal?: (from: number, to: number) => void;
  /** Replace the page's text with a restored Version. */
  onRestore?: (text: string) => void;
  /** Save pending edits before a Version is named. */
  flush?: () => Promise<void>;
}

export function RightPanel({
  doc,
  inSheet,
  fm,
  onFmChange,
  detected,
  body,
  onBodyChange,
  onReveal,
  onRestore,
  flush,
}: Props) {
  const t = useT();
  const id = doc.summary.id;
  const type = doc.summary.type;
  const writing = WRITING_TYPES.includes(type);

  // Anything written anywhere may point here, so the panel's lists move with
  // the whole vault — and with this document's own mtime, because saving the
  // page you are looking at is the commonest way to change what they say.
  const { data: backlinksData } = useQuery<Backlink[]>({
    key: [id, doc.summary.mtime],
    deps: { any: true },
    fetch: () => api.backlinks(id),
  });
  const { data: candidatesData } = useQuery<Candidate[]>({
    key: [id, doc.summary.mtime],
    deps: { any: true },
    enabled: type === "composition",
    fetch: () => api.candidates(id),
  });
  const { data: trailData } = useQuery<TrailEntry[]>({
    key: [id, doc.summary.mtime],
    deps: { types: ["clipping", "note", "source"] },
    enabled: type === "source",
    fetch: () => api.sourceTrail(id),
  });
  const { data: childrenData } = useQuery<DocSummary[]>({
    key: [id, doc.summary.mtime],
    deps: { types: ["source"] },
    enabled: type === "source",
    fetch: () => api.sourceChildren(id),
  });
  const backlinks = useMemo(() => backlinksData ?? [], [backlinksData]);
  const candidates = useMemo(() => candidatesData ?? [], [candidatesData]);
  const trail = useMemo(() => trailData ?? [], [trailData]);
  const children = useMemo(() => childrenData ?? [], [childrenData]);

  // What the editor holds, which is not quite what is on disk: CodeMirror
  // normalises every line ending to "\n" when it loads a document. A file
  // written on Windows is CRLF, so offsets measured against the file are one
  // character per preceding line ahead of the same text in the editor — which
  // put the selection a few characters off and the insert on the wrong words.
  // Everything here works in the editor's own text, so the offsets the engine
  // returns are the offsets the editor understands.
  const editorBody = useMemo(() => body?.replace(/\r\n/g, "\n"), [body]);

  // Linkables follow the text, so they are debounced and stale-guarded the way
  // Passage detection is: the answer is thrown away if the text moved on while
  // the engine was working.
  const { data: linkablesData } = useQuery<Linkable[]>({
    key: [id, editorBody ?? ""],
    deps: { types: LINKABLE_TARGET_TYPES },
    enabled: writing && editorBody != null,
    debounce: 180,
    fetch: () => api.linkables(id, editorBody!),
  });
  const linkables = useMemo(() => linkablesData ?? [], [linkablesData]);

  return (
    <aside
      data-testid="right-panel"
      className={cn(
        "thin-scroll flex flex-col overflow-y-auto bg-sidebar text-sidebar-foreground",
        inSheet ? "h-full w-full" : "w-80 shrink-0 border-l",
      )}
    >
      <Properties doc={doc} fm={fm} onFmChange={onFmChange} />
      {writing && editorBody != null && onBodyChange && (
        <Linkables
          items={linkables}
          // Both actions resolve the position the same way, so the words the
          // label selects are always the words the icon would link. Reading
          // the offset raw in one place and re-finding it in the other is how
          // they came to disagree by a few characters.
          onReveal={(l) => {
            const at = resolve(editorBody, l);
            if (at == null) return void toast(t.link_moved);
            onReveal?.(at, at + l.matched.length);
          }}
          onLink={(l, target) => {
            const next = linkInBody(editorBody, l, target);
            if (!next) return void toast(t.link_moved);
            onBodyChange(next.body);
          }}
        />
      )}
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
  hide,
}: {
  doc: DocumentPayload;
  fm: string;
  onFmChange: (fm: string) => void;
  inline?: boolean;
  /**
   * Properties another part of this screen is editing, left out so the same
   * value is not offered twice.
   *
   * Hidden because *owned here*, not because of what the Property is: a Hub
   * hands over the Span its Dates section edits, while the same document in
   * the editor's panel — where no Dates section exists — still shows them, so
   * a Property is never left with nothing to edit it.
   */
  hide?: readonly string[];
}) {
  const s = useStore();
  const t = useT();
  const [adding, setAdding] = useState("");
  const [addingType, setAddingType] = useState<PropertyType>("text");
  const hidden = useMemo(() => new Set(hide ?? []), [hide]);
  const entries = useMemo(
    () =>
      Object.entries(doc.frontmatter).filter(
        ([k]) =>
          k !== "id" && k !== "title" && k !== "tags" && !hidden.has(k),
      ),
    [doc.frontmatter, hidden],
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
  // The label is translated for a built-in; the tooltip keeps the front-matter
  // name, so what to search the vault for is always a hover away.
  const label = (
    <span
      className="w-24 shrink-0 truncate text-xs text-muted-foreground"
      title={`${name} · ${t.property_types[propType]}`}
    >
      {propertyLabel(name, t)}
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
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              data-testid={`remove-property-${name}`}
              onSelect={() => onFmChange(removeField(fm, name))}
            >
              <Trash2 />
              {t.remove_property}
            </DropdownMenuItem>
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
            {b.doc.label}
          </span>
          <EventDate doc={b.doc} />
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

/**
 * One document that Mentions this page, however many times it does so.
 *
 * The row opens the document, as it always has. A document that Mentions the
 * page more than once also gets a chevron, which reveals the occurrences —
 * each with its own excerpt and marker, exactly as the list showed them when
 * every occurrence was a row of its own. The chevron is a sibling of the main
 * button rather than a child: a button inside a button is invalid markup, and
 * the Linkables rows already pair a label button with an icon button this way.
 */
function BacklinkGroupItem({ g }: { g: BacklinkGroup }) {
  const s = useStore();
  const t = useT();
  const [open, setOpen] = useState(false);
  const many = g.items.length > 1;
  const { shown, more } = viaSummary(g.via);
  return (
    <li data-testid="backlink-row">
      <div className="flex items-start gap-1">
        <button
          type="button"
          className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
          onClick={() => s.openDoc(g.first.doc.id)}
        >
          <div className="flex items-center gap-2 text-sm">
            <TypeDot type={g.first.doc.type} />
            <span className="min-w-0 flex-1 truncate font-medium">
              {g.first.doc.label}
            </span>
            <EventDate doc={g.first.doc} />
            {many && (
              <span
                data-testid="backlink-count"
                className="shrink-0 text-[10px] text-muted-foreground tabular-nums"
              >
                {t.backlink_mentions(g.items.length)}
              </span>
            )}
          </div>
          {(g.kinds.length > 0 || shown.length > 0) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-1 pl-4">
              {g.kinds.map((k) => (
                <Badge
                  key={k}
                  variant="outline"
                  className="h-4 shrink-0 px-1 text-[10px] font-normal text-muted-foreground"
                >
                  {kindMarker(k, g.first.property)}
                </Badge>
              ))}
              {shown.length > 0 && (
                <Badge
                  variant="outline"
                  className="h-4 min-w-0 px-1 text-[10px] font-normal text-muted-foreground"
                >
                  <span className="truncate">
                    {t.via} {shown.join(", ")}
                    {more > 0 ? ` ${t.via_more(more)}` : ""}
                    {g.inferred ? ` · ${t.inferred}` : ""}
                  </span>
                </Badge>
              )}
            </div>
          )}
          {g.first.excerpt && (
            <div className="mt-0.5 line-clamp-2 pl-4 text-xs text-muted-foreground">
              {g.first.excerpt}
            </div>
          )}
        </button>
        {many && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="mt-1 shrink-0"
            aria-label={open ? t.backlink_collapse : t.backlink_expand}
            aria-expanded={open}
            data-testid="backlink-expand"
            onClick={() => setOpen((x) => !x)}
          >
            <ChevronRight
              className={cn("transition-transform", open && "rotate-90")}
            />
          </Button>
        )}
      </div>
      {open && (
        <ul className="ml-4 border-l pl-1" data-testid="backlink-occurrences">
          {g.items.map((b, i) => (
            <BacklinkItem key={i} b={b} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** The marker for one kind, without the `via` label a Mention carries. */
function kindMarker(kind: BacklinkKind, property: string | null): string {
  if (kind === "tag") return "#";
  if (kind === "property") return property ?? "";
  if (kind === "embed") return "![[ ]]";
  return "";
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
  // One row per document (ADR-free, but see CONTEXT.md "Backlink"): the engine
  // still returns one row per Mention, and the panel collapses them here.
  const rows = useMemo(() => groupBacklinks(items), [items]);
  const groups = useMemo(() => {
    if (!subject) return [{ label: null as string | null, items: rows }];
    const byBook = new Map<number, BacklinkGroup[]>();
    const other: BacklinkGroup[] = [];
    // `first_verse` belongs to the document, so every Mention a document makes
    // falls in the same Book and a grouped row has exactly one.
    for (const g of rows) {
      if (g.first.doc.first_verse == null) other.push(g);
      else {
        const bk = unpackVerse(g.first.doc.first_verse).book;
        byBook.set(bk, [...(byBook.get(bk) ?? []), g]);
      }
    }
    const out = [...byBook.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([bk, its]) => ({
        label: s.books.find((x) => x.number === bk)?.name ?? String(bk),
        items: its.sort(
          (a, b) =>
            (a.first.doc.first_verse ?? 0) - (b.first.doc.first_verse ?? 0),
        ),
      }));
    if (other.length) out.push({ label: t.other_docs, items: other });
    return out;
  }, [rows, subject, s.books, t.other_docs]);
  const content =
    rows.length === 0 ? (
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
            {g.items.map((row, j) => (
              <BacklinkGroupItem key={j} g={row} />
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
          {rows.length > 0 && (
            <span className="ml-2 font-normal tabular-nums">{rows.length}</span>
          )}
        </PanelTitle>
        {subject && rows.length > 0 && (
          <p className="mb-2 text-xs text-muted-foreground">{t.book_order}</p>
        )}
        {content}
      </section>
    );
  return (
    <div data-testid="backlinks">
      <Section
        title={t.backlinks}
        count={rows.length}
        hint={subject && rows.length ? t.book_order : undefined}
      >
        {content}
      </Section>
    </div>
  );
}

/**
 * Documents that write this Hub's name without linking it (ADR 0011).
 *
 * Rendered where Backlinks are: `inline` in a Hub's pane, since a Hub does not
 * use the right panel. The two sections are adjacent on purpose — they are the
 * same question asked twice — and their contents never overlap, because a
 * document that already links is a Backlink and nothing else.
 */
export function UnlinkedMentions({
  target,
  data,
  inline,
  onChanged,
}: {
  target: DocSummary;
  data: UnlinkedMentionsData;
  inline?: boolean;
  /**
   * Refetch after a write. The vault watcher also fires, but it arrives as a
   * Tauri event, which does not exist when the UI runs in a plain browser
   * against the dev bridge — so the list refreshes from the call it just made
   * rather than waiting for news of its own edit.
   */
  onChanged: () => void;
}) {
  const s = useStore();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const { items, total } = data;

  // One document may write the name several times; each occurrence is its own
  // row, but "Link all" takes only the first in each, because repeating a link
  // every paragraph is bad writing rather than a gap.
  const firstPerDoc = useMemo(() => {
    const seen = new Set<string>();
    return items.filter((m) =>
      seen.has(m.doc.id) ? false : (seen.add(m.doc.id), true),
    );
  }, [items]);

  const link = async (list: UnlinkedMention[]) => {
    if (busy || list.length === 0) return;
    setBusy(true);
    try {
      const r = await api.linkMentions(
        target.id,
        list.map((m) => ({
          docId: m.doc.id,
          start: m.start,
          end: m.end,
          matched: m.matched,
        })),
      );
      const msg = [
        t.linked_toast(r.linked.length),
        r.skipped.length ? t.linked_skipped(r.skipped.length) : "",
      ]
        .filter(Boolean)
        .join(" ");
      toast(msg, {
        action: r.linked.length
          ? {
              label: t.undo,
              onClick: () => {
                api
                  .undoLinkMentions(r.linked.map((e) => [e.id, e.before]))
                  .then(() => {
                    toast(t.undone);
                    onChanged();
                  })
                  .catch(console.error);
              },
            }
          : undefined,
      });
      onChanged();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const confirmAll = () =>
    s.setDialog({
      kind: "confirm",
      title: t.link_all_title(firstPerDoc.length),
      body: t.link_all_body,
      items: firstPerDoc.map((m) => m.doc.title),
      confirmLabel: t.link_all,
      onConfirm: () => link(firstPerDoc),
    });

  const content = (
    <>
      {firstPerDoc.length > 1 && (
        <Button
          variant="outline"
          size="sm"
          className="mb-2 min-h-7 w-full"
          disabled={busy}
          onClick={confirmAll}
          data-testid="link-all"
        >
          {t.link_all}
        </Button>
      )}
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          {t.no_unlinked_mentions}
        </div>
      ) : (
        <ul className="space-y-0.5">
          {items.map((m, i) => (
            <li key={i} className="flex items-start gap-1">
              <button
                type="button"
                className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                onClick={() => s.openDoc(m.doc.id)}
              >
                <div className="flex items-center gap-2 text-sm">
                  <TypeDot type={m.doc.type} />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {m.doc.label}
                  </span>
                </div>
                <div className="mt-0.5 line-clamp-2 pl-4 text-xs text-muted-foreground">
                  {m.excerpt}
                </div>
              </button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="mt-1 shrink-0 text-muted-foreground hover:text-link"
                disabled={busy}
                aria-label={`${t.link_mention}: ${m.doc.label}`}
                onClick={() => link([m])}
              >
                <Link2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {total > items.length && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t.unlinked_more(total)}
        </p>
      )}
    </>
  );

  if (inline)
    return (
      <section data-testid="unlinked-mentions">
        <PanelTitle className="mb-3">
          {t.unlinked_mentions}
          {total > 0 && (
            <span className="ml-2 font-normal tabular-nums">{total}</span>
          )}
        </PanelTitle>
        <p className="mb-2 text-xs text-muted-foreground">
          {t.unlinked_mentions_hint}
        </p>
        {content}
      </section>
    );
  return (
    <div data-testid="unlinked-mentions">
      <Section
        title={t.unlinked_mentions}
        count={total}
        hint={t.unlinked_mentions_hint}
      >
        {content}
      </Section>
    </div>
  );
}

/**
 * Names in the document being written that could become Mentions.
 *
 * One row per target, not per occurrence: the decision is "should this
 * document link to Barnabas", asked once. Clicking the row selects the
 * occurrence in the editor; the icon inserts the link there, through the
 * editor's own dispatch so the user's undo works normally.
 */
export function Linkables({
  items,
  onLink,
  onReveal,
}: {
  items: Linkable[];
  onLink: (l: Linkable, target: DocSummary) => void;
  onReveal: (l: Linkable) => void;
}) {
  const t = useT();
  return (
    <Section title={t.linkables} count={items.length} hint={t.linkables_hint}>
      <div data-testid="linkables" />
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">{t.no_linkables}</div>
      ) : (
        <ul className="space-y-0.5">
          {items.map((l) => (
            <li key={l.doc.id} className="flex items-start gap-1">
              <button
                type="button"
                className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
                onClick={() => onReveal(l)}
              >
                <div className="flex items-center gap-2 text-sm">
                  <TypeDot type={l.doc.type} />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {l.doc.label}
                  </span>
                  {l.count > 1 && (
                    <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                      {t.linkable_count(l.count)}
                    </span>
                  )}
                </div>
                {l.matched !== l.doc.title && (
                  <div className="mt-0.5 truncate pl-4 text-xs text-muted-foreground">
                    “{l.matched}”
                  </div>
                )}
              </button>
              {/* An ambiguous title is never resolved on the user's behalf. */}
              {l.ambiguous.length > 1 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    {/* Marked, because a click here opens a menu rather than
                        linking: without the mark it reads as a button that
                        did nothing. */}
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="mt-1 shrink-0 text-amber-600 hover:text-link"
                      aria-label={`${t.link_mention}: ${l.doc.label} (${t.ambiguous_pick})`}
                      title={t.ambiguous_pick}
                    >
                      <Link2 />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>{t.ambiguous_pick}</DropdownMenuLabel>
                    {l.ambiguous.map((d) => (
                      <DropdownMenuItem
                        key={d.id}
                        onSelect={() => onLink(l, d)}
                      >
                        {d.path}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="mt-1 shrink-0 text-muted-foreground hover:text-link"
                  aria-label={`${t.link_mention}: ${l.doc.label}`}
                  onClick={() => onLink(l, l.doc)}
                >
                  <Link2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
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
  // Three states, not two: material on the Board is placed but not committed,
  // so it stays a Candidate and is marked rather than moved away (PLAN §17.6).
  const unused = items.filter((c) => !c.used && !c.on_board);
  const placed = items.filter((c) => !c.used && c.on_board);
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
      {placed.length > 0 && (
        <Section
          title={t.on_board}
          count={placed.length}
          hint={t.on_board_hint}
          defaultOpen={false}
        >
          <div data-testid="on-board" />
          <CandidateList items={placed} />
        </Section>
      )}
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
                {c.doc.label}
              </span>
              <EventDate doc={c.doc} />
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
  const fmt = useFormat();
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
  const when = (ms: number) => fmt.dateTime(ms);
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
                  <span className="min-w-0 flex-1 truncate">{e.doc.label}</span>
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

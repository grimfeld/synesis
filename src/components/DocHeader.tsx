import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "cn";
import { fmString, type DocumentPayload } from "@/lib/api";
import { setField } from "@/lib/frontmatter";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { getActiveEditor } from "@/editor/active";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface Props {
  doc: DocumentPayload;
  title: string;
  readOnlyTitle: boolean;
  onRename: (title: string) => Promise<void>;
  fm: string;
  onFmChange: (fm: string) => void;
  /**
   * Shown in place of the title heading, for a Clipping: it has none, and its
   * Citation is what identifies it (ADR 0013). The words themselves are in the
   * editor below, so repeating them here would say the same thing twice.
   */
  citation?: string;
}

/** Title heading and Tags row above the body of a Writing page. */
export function DocHeader({ doc, title, readOnlyTitle, onRename, fm, onFmChange, citation }: Props) {
  return (
    <div className="mx-auto w-full max-w-[720px] px-8 pt-8">
      {citation !== undefined ? (
        <p className="font-prose text-sm text-muted-foreground" data-testid="doc-citation">
          {citation}
        </p>
      ) : (
        <TitleEditor title={title} readOnly={readOnlyTitle} onRename={onRename} />
      )}
      <TagsRow doc={doc} fm={fm} onFmChange={onFmChange} />
    </div>
  );
}

export function TitleEditor({ title, readOnly, onRename, className }: { title: string; readOnly: boolean; onRename: (t: string) => Promise<void>; className?: string }) {
  const t = useT();
  const [value, setValue] = useState(title);
  useEffect(() => setValue(title), [title]);
  // A textarea, not an input, so a long title wraps on a phone instead of
  // being cut mid-word; it grows to its text (`field-sizing` is not in WebKit).
  const box = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value]);
  const commit = async () => {
    const v = value.trim();
    if (!v || v === title) {
      setValue(title);
      return;
    }
    await onRename(v);
  };
  const cls = cn("font-prose w-full bg-transparent text-3xl leading-tight font-bold tracking-tight outline-none", className);
  if (readOnly) return <h1 className={cls}>{title}</h1>;
  return (
    <textarea
      ref={box}
      data-testid="doc-title"
      rows={1}
      className={cn(cls, "block resize-none overflow-hidden rounded-md placeholder:text-muted-foreground/50 focus:bg-accent/40")}
      value={value}
      placeholder={t.title_placeholder}
      aria-label={t.title}
      // A title is one line; a pasted line break becomes a space.
      onChange={(e) => setValue(e.target.value.replace(/\s*\n\s*/g, " "))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
          getActiveEditor()?.focus();
        } else if (e.key === "Escape") {
          setValue(title);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function readList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(fmString).map((x) => x.trim()).filter(Boolean);
  const s = fmString(v).trim();
  return s ? s.split(/\s*,\s*/).filter(Boolean) : [];
}

interface ChipsProps {
  doc: DocumentPayload;
  fm: string;
  onFmChange: (fm: string) => void;
  /** Frontmatter list property to edit. */
  field: string;
  /** Rendered before each value ("#" for tags). */
  prefix?: string;
  /** Label of the add button when the list is empty. */
  addLabel: string;
  /** Clicking a chip opens that page (tags). */
  linkable?: boolean;
  /** Completion candidates; count shown when given. */
  suggestions?: { value: string; count?: number }[];
  /** Normalise typed input (tags: spaces to dashes). */
  normalize?: (s: string) => string;
  className?: string;
}

/** An editable list property shown as chips: tags, aliases. */
export function ChipsRow({ doc, fm, onFmChange, field, prefix = "", addLabel, linkable, suggestions = [], normalize, className }: ChipsProps) {
  const s = useStore();
  const t = useT();
  const values = useMemo(() => readList(doc.frontmatter[field]), [doc.frontmatter, field]);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);
  const write = (next: string[]) => onFmChange(setField(fm, field, next.length ? next : null));
  const add = (raw: string) => {
    let n = raw.trim();
    if (prefix && n.startsWith(prefix)) n = n.slice(prefix.length);
    if (normalize) n = normalize(n);
    if (n && !values.some((x) => x.toLowerCase() === n.toLowerCase())) write([...values, n]);
    setQ("");
    setAdding(false);
  };
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(prefix, "");
    const have = new Set(values.map((x) => x.toLowerCase()));
    return suggestions.filter((x) => !have.has(x.value.toLowerCase()) && (!needle || x.value.toLowerCase().includes(needle))).slice(0, 8);
  }, [q, suggestions, values, prefix]);

  return (
    <div data-testid={`chips-${field}`} className={cn("flex min-h-7 flex-wrap items-center gap-1.5", className)}>
      {values.map((v) => (
        <Badge key={v} data-testid="chip" variant="secondary" className={cn("group h-6 max-w-full gap-1 pr-1 pl-2 font-normal", linkable && "text-tag")}>
          {linkable ? (
            <button type="button" className="min-w-0 truncate hover:underline underline-offset-2" title={`${prefix}${v}`} onClick={() => s.openLink(v)}>
              {prefix}
              {v}
            </button>
          ) : (
            <span className="min-w-0 truncate" title={`${prefix}${v}`}>
              {prefix}
              {v}
            </span>
          )}
          <button type="button" className="rounded-sm p-0.5 text-muted-foreground opacity-60 hover:bg-background hover:text-foreground hover:opacity-100" aria-label={`${t.delete} ${prefix}${v}`} onClick={() => write(values.filter((x) => x !== v))}>
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      {adding ? (
        <div className="relative">
          <input
            ref={inputRef}
            className="h-6 w-40 rounded-md border bg-background px-2 text-xs outline-none focus:border-ring"
            value={q}
            placeholder={addLabel}
            onChange={(e) => setQ(e.target.value)}
            onBlur={() => setTimeout(() => setAdding(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(q || matches[0]?.value || "");
              } else if (e.key === "Escape") setAdding(false);
            }}
          />
          {matches.length > 0 && (
            <ul className="absolute top-full left-0 z-20 mt-1 w-48 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
              {matches.map((x) => (
                <li key={x.value}>
                  <button type="button" className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs hover:bg-accent" onMouseDown={() => add(x.value)}>
                    <span className="truncate">
                      {prefix}
                      {x.value}
                    </span>
                    {x.count != null && <span className="text-muted-foreground tabular-nums">{x.count}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <Button data-testid="chip-add" variant="ghost" size="xs" className="h-6 px-1.5 text-muted-foreground" onClick={() => setAdding(true)}>
          <Plus />
          {values.length === 0 && addLabel}
        </Button>
      )}
    </div>
  );
}

export function TagsRow({ doc, fm, onFmChange, className }: { doc: DocumentPayload; fm: string; onFmChange: (fm: string) => void; className?: string }) {
  const s = useStore();
  const t = useT();
  const suggestions = useMemo(() => s.tags.map((x) => ({ value: x.tag, count: x.count })), [s.tags]);
  return <ChipsRow doc={doc} fm={fm} onFmChange={onFmChange} field="tags" prefix="#" addLabel={t.add_tag} linkable suggestions={suggestions} normalize={(x) => x.replace(/\s+/g, "-")} className={cn("mt-2", className)} />;
}

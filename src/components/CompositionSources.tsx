// The Sources a Composition is drawing on (spec #205): the row of chips at
// the top of its Candidates, and the Add Source dialog that row and the
// palette open.
import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { linkTarget, namesApi, type DocSummary, type DocType, type NameEntry, type SourceRef } from "@/lib/api";
import { addSourceFilter, resolveSourceName, sourceEntry, sourceNames, sourcesEntries } from "@/lib/docPicker";
import { readField, setField } from "@/lib/frontmatter";
import { live } from "@/lib/live";
import { NameIndex } from "@/lib/names";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DocPicker, Shell } from "./Dialogs";
import { TypeDot } from "./DocLink";

/** Visible focus for the buttons inside a chip, which clips nothing. */
const CHIP_FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

/**
 * The Sources a Composition is drawing on: a chip per `sources` entry and the
 * Add Source button. Rendered from the front matter at once; whether an entry
 * names a Source comes from the Candidates query (`refs`), or, for an entry it
 * has not seen yet, from the documents the store holds.
 * Every write goes through `onFmChange`, the Property path, never the text.
 */
export function SourcesRow({
  composition,
  fm,
  parsed,
  refs,
  onFmChange,
  locked,
}: {
  composition: string;
  fm: string;
  /** The parsed `sources` value, for a form `readField` does not read back. */
  parsed: unknown;
  refs?: SourceRef[];
  onFmChange: (fm: string) => void;
  locked: boolean;
}) {
  const s = useStore();
  const t = useT();
  const entries = useMemo(() => sourcesEntries(readField(fm, "sources"), parsed), [fm, parsed]);
  const remove = (i: number) => {
    const next = entries.filter((_, j) => j !== i);
    onFmChange(setField(fm, "sources", next.length ? next : null));
  };
  // Reading mode with nothing attached: nothing to show and nothing to do.
  if (locked && entries.length === 0) return null;
  return (
    <div data-testid="sources-row" role="group" aria-label={t.sources_row} className="mb-3 min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {entries.map((raw, i) => {
          const name = linkTarget(raw) ?? raw;
          const ref = refs?.find((r) => r.name === name);
          const src = ref ? ref.doc : resolveSourceName(name, s.docs);
          // A 24px target that does not make the chip taller: the chip drops
          // its vertical padding and the button reaches over its 1px border.
          const remover = !locked && (
            <button
              type="button"
              data-testid="source-chip-remove"
              className={cn(
                "-my-px -mr-px flex min-h-6 min-w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-60 hover:bg-background hover:text-foreground hover:opacity-100 focus-visible:opacity-100",
                CHIP_FOCUS,
              )}
              aria-label={t.remove_source(src?.title ?? name)}
              title={t.remove_source(src?.title ?? name)}
              onClick={() => remove(i)}
            >
              <X className="size-3" />
            </button>
          );
          const chip = cn("h-auto min-h-6 max-w-full shrink overflow-visible pl-2 font-normal", locked ? "pr-2" : "py-0 pr-0");
          return src ? (
            <Badge
              key={`${i}:${raw}`}
              variant="secondary"
              data-testid="source-chip"
              data-doc={src.id}
              className={cn(chip, "gap-1")}
            >
              <button
                type="button"
                data-testid="source-chip-open"
                className={cn("flex min-w-0 items-center gap-1.5 rounded-sm hover:underline underline-offset-2", CHIP_FOCUS)}
                title={src.title}
                onClick={s.openDocOnClick(src.id)}
              >
                <TypeDot type="source" />
                <span className="min-w-0 truncate">{src.title}</span>
              </button>
              {remover}
            </Badge>
          ) : (
            <Badge
              key={`${i}:${raw}`}
              variant="outline"
              data-testid="source-chip-unresolved"
              className={cn(chip, "flex-wrap gap-x-1.5 gap-y-0 whitespace-normal text-muted-foreground")}
              title={t.source_unresolved}
            >
              <span className="min-w-0 truncate line-through">{name}</span>
              <span className="min-w-0 text-[10px]" data-testid="source-chip-hint">
                {t.source_unresolved}
              </span>
              {remover}
            </Badge>
          );
        })}
        {!locked && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            data-testid="add-source"
            onClick={() => s.setDialog({ kind: "add-source", id: composition })}
          >
            <Plus />
            {t.add_source}
          </Button>
        )}
      </div>
      {entries.length === 0 && !locked && (
        <p className="mt-1 min-w-0 text-xs text-muted-foreground" data-testid="sources-row-hint">
          {t.sources_row_hint}
        </p>
      )}
    </div>
  );
}

const SOURCE_ONLY: DocType[] = ["source"];

/**
 * Add Source: a Source for the open Composition's `sources` Property. Opened
 * from the Sources row and from the palette, so it writes the front matter
 * through the document's live copy (`editFm`, the path every Property edit
 * takes), never through the text.
 */
export function AddSource({ id, onClose }: { id: string; onClose: () => void }) {
  const s = useStore();
  const t = useT();
  const [value, setValue] = useState("");
  const [entries, setEntries] = useState<NameEntry[]>([]);
  useEffect(() => {
    namesApi.names().then(setEntries).catch(console.error);
  }, []);
  // Until the names arrive, the titles the store holds: enough to tell an
  // ambiguous title, which is all the write needs.
  const names = useMemo(
    () =>
      new NameIndex(
        entries.length ? entries : s.docs.map((d) => ({ name: d.title, id: d.id, type: d.type, alias: false })),
      ),
    [entries, s.docs],
  );
  const current = () => {
    const d = live.peek(id);
    if (!d) return null;
    const snap = d.snapshot();
    return { d, fm: snap.fm, list: sourcesEntries(readField(snap.fm, "sources"), snap.doc?.frontmatter.sources) };
  };
  // What is attached as the dialog opens: picking one closes it.
  const [attached] = useState(() => sourceNames(current()?.list ?? []));
  const filter = useMemo(() => addSourceFilter(attached, s.docs, names), [attached, s.docs, names]);
  const add = (doc: DocSummary) => {
    const c = current();
    if (!c) return void toast.error(t.source_not_open);
    if (s.readingMode) return void toast(t.reading_locked);
    // A title another document shares is written as a path, or the engine
    // could resolve it to that document and the Source would bring nothing.
    c.d.editFm(setField(c.fm, "sources", [...c.list, sourceEntry(doc, names)]));
    onClose();
  };
  return (
    <Shell title={t.add_source} description={t.add_source_hint} onClose={onClose}>
      <div data-testid="add-source-dialog" className="min-w-0">
        <DocPicker
          types={SOURCE_ONLY}
          filter={filter}
          aliases
          autoFocus
          inlineList
          value={value}
          placeholder={t.add_source_placeholder}
          testId="add-source-input"
          onChange={(v, doc) => {
            setValue(v);
            if (doc) add(doc);
          }}
        />
      </div>
    </Shell>
  );
}

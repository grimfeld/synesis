// "Move to folder…" (PLAN §31): pick a Folder of the document's own type and
// move it there. A Popover on a desktop, the full-width picker Sheet on a
// phone (`PickerShell`), opened by the Command or a document row's menu.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Folder, FolderRoot } from "lucide-react";
import { cn } from "cn";
import { api } from "@/lib/api";
import { leaf, naturalCompare } from "@/lib/folders";
import { useQuery } from "@/lib/useQuery";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { Input } from "@/components/ui/input";
import { PickerShell, TOUCH_TARGET, TOUCH_TARGET_INPUT } from "@/components/PickerShell";

/** Where a document is, as a Folder key relative to its type's folder (`""` for the top). */
export function folderOf(path: string, top: string): string | null {
  if (!path.startsWith(`${top}/`)) return null;
  const inner = path.slice(top.length + 1);
  const i = inner.lastIndexOf("/");
  return i < 0 ? "" : inner.slice(0, i);
}

export function FolderPicker({ id, onClose }: { id: string; onClose: () => void }) {
  const s = useStore();
  const t = useT();
  const doc = s.docsById.get(id);
  const type = doc?.type === "note" || doc?.type === "composition" ? doc.type : null;
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const { data } = useQuery<string[]>({
    key: ["folder-picker", type],
    deps: { none: true },
    fetch: () => (type ? api.listFolders(type) : Promise.resolve([])),
    enabled: !!type,
  });
  const top = s.info?.doc_types.find((d) => d.type === type)?.folder ?? (type === "composition" ? "Compositions" : "Notes");
  const here = doc ? folderOf(doc.path, top) : null;
  const options = useMemo(() => {
    const f = filter.trim().toLocaleLowerCase();
    const all = ["", ...[...(data ?? [])].sort(naturalCompare)];
    return f ? all.filter((k) => k && k.toLocaleLowerCase().includes(f)) : all;
  }, [data, filter]);

  // Only a Note or a Composition has Folders; anything else closes at once.
  const unmovable = !doc || !type;
  useEffect(() => {
    if (!unmovable) return;
    if (doc) toast.error(t.folders.move_none);
    onClose();
  }, [unmovable, doc, onClose, t]);
  if (!doc || !type) return null;
  const label = (key: string) => (key ? leaf(key) : t.types_plural[type]);
  const move = async (into: string) => {
    const name = doc.path.split("/").pop() ?? "";
    const target = into ? `${top}/${into}/` : `${top}/`;
    // Said in the app's language before the engine is asked; it checks again.
    const clash = s.docs.find((d) => d.id !== id && d.path.toLowerCase() === `${target}${name}`.toLowerCase());
    if (clash) {
      toast.error(t.folders.move_clash(clash.path.split("/").pop() ?? name, label(into)));
      return;
    }
    setBusy(true);
    try {
      await api.moveDocument(id, into);
      await s.announceChanged([id]);
      onClose();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <PickerShell
      label={t.folders.move_title(doc.label)}
      icon={<Folder />}
      testId="folder-picker"
      open
      onOpenChange={(o) => !o && onClose()}
      triggerless
      className="flex max-h-[min(70vh,28rem)] flex-col gap-2"
    >
      <Input
        data-testid="folder-picker-find"
        className={TOUCH_TARGET_INPUT}
        placeholder={t.folders.move_find}
        aria-label={t.folders.move_find}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <ul className="thin-scroll -mx-1 flex min-w-0 flex-col gap-0.5 overflow-y-auto px-1">
        {options.map((key) => {
          const isHere = key === here;
          const depth = key ? key.split("/").length : 0;
          return (
            <li key={key || "/"} className="min-w-0">
              <button
                type="button"
                data-testid="folder-pick"
                data-folder={key}
                disabled={isHere || busy}
                title={key ? `${top}/${key}` : top}
                onClick={() => move(key)}
                className={cn(
                  TOUCH_TARGET,
                  "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent disabled:opacity-60 disabled:hover:bg-transparent",
                )}
                style={{ paddingLeft: `${Math.min(depth, 4) * 0.75 + 0.5}rem` }}
              >
                {key ? <Folder className="size-4 shrink-0 text-muted-foreground" /> : <FolderRoot className="size-4 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1 break-words">{label(key)}</span>
                {isHere && <span className="shrink-0 text-xs text-muted-foreground">{t.folders.move_here}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </PickerShell>
  );
}

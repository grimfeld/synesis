// "Move to folder…" (PLAN §31): pick a Folder of the document's own type and
// move it there. A Popover on a desktop, the full-width picker Sheet on a
// phone (`PickerShell`), opened by the Command or a document row's menu.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Folder, FolderRoot } from "lucide-react";
import { cn } from "cn";
import { api } from "@/lib/api";
import { childNames, folderOf, leaf, naturalCompare } from "@/lib/folders";
import { useMoveDocument, type FolderType } from "@/components/SidebarFolders";
import { useQuery } from "@/lib/useQuery";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { Input } from "@/components/ui/input";
import { PickerShell, TOUCH_TARGET, TOUCH_TARGET_INPUT } from "@/components/PickerShell";

/** A Folder being moved by the picker, and what to do once it has moved. */
export interface MovingFolder {
  type: FolderType;
  key: string;
  onMoved: () => void;
}

/**
 * Pick where a document goes (`id`), or where a Folder goes (`folder`, #150):
 * a Folder never into itself or one of its own Folders, which are not offered.
 */
export function FolderPicker({ id, folder, onClose }: { id?: string; folder?: MovingFolder; onClose: () => void }) {
  const s = useStore();
  const t = useT();
  const doc = id ? s.docsById.get(id) : undefined;
  const docType = doc?.type === "note" || doc?.type === "composition" ? doc.type : null;
  const type = folder?.type ?? docType;
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const moveDocument = useMoveDocument();
  const { data } = useQuery<string[]>({
    key: ["folder-picker", type],
    deps: { none: true },
    fetch: () => (type ? api.listFolders(type) : Promise.resolve([])),
    enabled: !!type,
  });
  const top = s.info?.doc_types.find((d) => d.type === type)?.folder ?? (type === "composition" ? "Compositions" : "Notes");
  const here = folder ? (folder.key.includes("/") ? folder.key.slice(0, folder.key.lastIndexOf("/")) : "") : doc ? folderOf(doc.path, top) : null;
  const options = useMemo(() => {
    const f = filter.trim().toLocaleLowerCase();
    const inside = (k: string) => !!folder && (k === folder.key || k.startsWith(`${folder.key}/`));
    const all = ["", ...[...(data ?? [])].sort(naturalCompare)].filter((k) => !inside(k));
    return f ? all.filter((k) => k && k.toLocaleLowerCase().includes(f)) : all;
  }, [data, filter, folder]);

  // Only a Note or a Composition has Folders; anything else closes at once.
  const unmovable = !folder && (!doc || !type);
  useEffect(() => {
    if (!unmovable) return;
    if (doc) toast.error(t.folders.move_none);
    onClose();
  }, [unmovable, doc, onClose, t]);
  if (!type || (!folder && !doc)) return null;
  const label = (key: string) => (key ? leaf(key) : t.types_plural[type]);
  const moveFolder = async (f: MovingFolder, into: string) => {
    // Said in the app's language first; the engine checks again.
    const name = leaf(f.key);
    const clash = childNames(data ?? [], into).find((n) => n.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (clash) {
      toast.error(t.folders.taken(clash));
      return false;
    }
    try {
      await api.moveFolder(f.type, f.key, into);
      f.onMoved();
      return true;
    } catch (e) {
      toast.error(String(e));
      return false;
    }
  };
  const move = async (into: string) => {
    setBusy(true);
    try {
      const done = folder ? await moveFolder(folder, into) : doc ? await moveDocument(doc, into) : false;
      if (done) onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <PickerShell
      label={folder ? t.folders.move_folder_title(leaf(folder.key)) : t.folders.move_title(doc!.label)}
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
                aria-disabled={isHere || busy || undefined}
                aria-current={isHere || undefined}
                aria-label={key ? `${key.split("/").join(" / ")}${isHere ? ` (${t.folders.move_here})` : ""}` : undefined}
                title={key ? `${top}/${key}` : top}
                onClick={() => !isHere && !busy && move(key)}
                className={cn(
                  TOUCH_TARGET,
                  "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent aria-disabled:opacity-60 aria-disabled:hover:bg-transparent",
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
      {options.length === 0 && (
        <p role="status" data-testid="folder-picker-none" className="px-2 text-sm text-muted-foreground">
          {t.folders.move_none_found}
        </p>
      )}
    </PickerShell>
  );
}

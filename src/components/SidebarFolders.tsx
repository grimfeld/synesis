// The sidebar's Folders (PLAN §31): Notes and Compositions drawn as the tree
// of folders inside `Notes/` and `Compositions/`, and what a person does to a
// Folder from there. The tree's shape lives in `src/lib/folders.ts`; this is
// its renderer, its menus and the name dialog.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ChevronRight, Folder, FolderOpen, MoreHorizontal, Plus } from "lucide-react";
import { cn } from "cn";
import { api, type DocSummary } from "@/lib/api";
import {
  childNames,
  folderNameProblem,
  folderOf,
  leaf,
  parentOf,
  folderTree,
  foldersHolding,
  loadOpenFolders,
  saveOpenFolders,
  type FolderNameProblem,
  type FolderNode,
} from "@/lib/folders";
import { useQuery } from "@/lib/useQuery";
import { useIsMobile } from "@/hooks/use-mobile";
import { FolderPicker } from "./FolderPicker";

import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SidebarMenu, SidebarMenuAction, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { TypeDot } from "./DocLink";

export type FolderType = "note" | "composition";

/** Something a person asked of a Folder, handled by `useFolderActions`. */
export type FolderAct =
  | { kind: "new-folder"; type: FolderType; parent: string }
  | { kind: "new-here"; type: FolderType; folder: string }
  | { kind: "delete"; type: FolderType; folder: string }
  /** A document dropped on a Folder (or on its group, `""`), on desktop. */
  | { kind: "move"; id: string; into: string }
  | { kind: "rename"; type: FolderType; folder: string }
  /** "Move to folder…" from a Folder's menu: the picker. */
  | { kind: "move-folder"; type: FolderType; folder: string }
  /** A Folder dropped on another Folder (or on its group, `""`), on desktop. */
  | { kind: "move-folder-to"; type: FolderType; folder: string; into: string };

interface FolderActions {
  act: (a: FolderAct) => void;
  /** Moves on each change made here, so the trees ask the engine again. */
  version: number;
}

const FolderActionsContext = createContext<FolderActions>({ act: () => {}, version: 0 });


/**
 * The Folder actions for the sidebar's Documents tab: the handler its menus
 * call, and the name dialog it opens. Wrap the trees in `provider`.
 */
export function useFolderActions(): { provider: (children: ReactNode) => ReactNode } {
  const s = useStore();
  const t = useT();
  const [version, setVersion] = useState(0);
  /** The name dialog: a new Folder in `parent`, or (`renaming`) a new name for one. */
  const [naming, setNaming] = useState<{ type: FolderType; parent: string; renaming?: string } | null>(null);
  const [moving, setMoving] = useState<{ type: FolderType; folder: string } | null>(null);
  const moveDocument = useMoveDocument();
  const moveFolder = useMoveFolder();
  /**
   * A Folder moved or renamed: its documents moved with it, so the lists are
   * re-read, and focus goes to the Folder at its new place (the row that
   * opened the dialog was replaced, so it would otherwise fall to the page).
   */
  const folderMoved = async (key: string) => {
    setVersion((v) => v + 1);
    await s.refresh();
    focusFolder(key);
  };

  const act = (a: FolderAct) => {
    if (a.kind === "new-folder") setNaming({ type: a.type, parent: a.parent });
    else if (a.kind === "rename") {
      setNaming({ type: a.type, parent: parentOf(a.folder), renaming: a.folder });
    } else if (a.kind === "move-folder") setMoving({ type: a.type, folder: a.folder });
    else if (a.kind === "move-folder-to") void moveFolder(a.type, a.folder, a.into).then((key) => { if (key) void folderMoved(key); });
    else if (a.kind === "new-here") s.setDialog({ kind: "new", type: a.type, folder: a.folder });
    else if (a.kind === "move") {
      const doc = s.docsById.get(a.id);
      if (doc) void moveDocument(doc, a.into).then((ok) => ok && setVersion((v) => v + 1));
    }
    else
      api
        .deleteFolder(a.type, a.folder)
        .then((held) => {
          if (held.length) toast.error(t.folders.not_empty(leaf(a.folder), held));
          else setVersion((v) => v + 1);
        })
        .catch((e) => toast.error(String(e)));
  };

  const create = async (name: string): Promise<FolderNameProblem | null> => {
    if (!naming) return null;
    const own = naming.renaming ? leaf(naming.renaming) : null;
    // A rename that only changes case is no clash with itself.
    const siblings = childNames(await api.listFolders(naming.type), naming.parent).filter((n) => n !== own);
    const problem = folderNameProblem(name, siblings);
    if (problem) return problem;
    if (naming.renaming) {
      // The engine's answer is the name as kept (trimmed, spaces collapsed).
      await folderMoved(await api.renameFolder(naming.type, naming.renaming, name));
    } else {
      await api.createFolder(naming.type, naming.parent, name);
      setVersion((v) => v + 1);
    }
    setNaming(null);
    return null;
  };

  return {
    provider: (children) => (
      <FolderActionsContext.Provider value={{ act, version }}>
        {children}
        {naming && (
          <FolderNameDialog
            title={
              naming.renaming
                ? t.folders.rename_title(leaf(naming.renaming))
                : naming.parent
                  ? t.folders.new_folder_in(leaf(naming.parent))
                  : t.folders.new_folder
            }
            initial={naming.renaming ? leaf(naming.renaming) : ""}
            submitLabel={naming.renaming ? t.folders.rename : t.create}
            onSubmit={create}
            onClose={() => setNaming(null)}
          />
        )}
        {moving && (
          <FolderPicker
            folder={{ type: moving.type, key: moving.folder, onMoved: (key) => void folderMoved(key) }}
            onClose={() => setMoving(null)}
          />
        )}
      </FolderActionsContext.Provider>
    ),
  };
}

/**
 * Move a document into a Folder of its type, the one way the picker and a
 * drop both take: a clash the sidebar can see is said in the app's language
 * before the engine is asked (it checks again, and its refusal shows as it
 * says it). Resolves with whether the document moved.
 */
export function useMoveDocument() {
  const s = useStore();
  const t = useT();
  return async (doc: DocSummary, into: string): Promise<boolean> => {
    const type = doc.type === "composition" ? "composition" : "note";
    const top = s.info?.doc_types.find((d) => d.type === type)?.folder ?? (type === "note" ? "Notes" : "Compositions");
    const name = doc.path.split("/").pop() ?? "";
    const target = `${into ? `${top}/${into}` : top}/${name}`.toLowerCase();
    const clash = s.docs.find((d) => d.id !== doc.id && d.path.toLowerCase() === target);
    if (clash) {
      toast.error(t.folders.move_clash(leaf(clash.path), into ? leaf(into) : t.types_plural[type]));
      return false;
    }
    try {
      await api.moveDocument(doc.id, into);
      await s.announceChanged([doc.id]);
      return true;
    } catch (e) {
      toast.error(String(e));
      return false;
    }
  };
}

/**
 * Move a Folder into another Folder of its type (`""` for the top), the one
 * way the picker and a drop both take: a sibling with the same name is said in
 * the app's language first; the engine checks again. Resolves with the
 * Folder's new key, or null when it did not move.
 */
export function useMoveFolder() {
  const t = useT();
  return async (type: FolderType, folder: string, into: string): Promise<string | null> => {
    const name = leaf(folder);
    try {
      const clash = childNames(await api.listFolders(type), into).find((n) => n.toLocaleLowerCase() === name.toLocaleLowerCase());
      if (clash) {
        toast.error(t.folders.taken(clash));
        return null;
      }
      return await api.moveFolder(type, folder, into);
    } catch (e) {
      toast.error(String(e));
      return null;
    }
  };
}

/**
 * Focus a Folder's row once the tree shows it (it may take a refresh), or,
 * when it went into a folded Folder, the nearest row above it that shows.
 */
function focusFolder(key: string, tries = 20) {
  requestAnimationFrame(() => {
    const rowOf = (k: string) => document.querySelector<HTMLElement>(`[data-folder="${CSS.escape(k)}"] > [data-testid=folder-row]`);
    let row = rowOf(key);
    if (!row && tries === 0) for (let k = parentOf(key); k && !row; k = parentOf(k)) row = rowOf(k);
    if (row) row.focus();
    else if (tries > 0) focusFolder(key, tries - 1);
  });
}

export function useFolderAct() {
  return useContext(FolderActionsContext).act;
}

/** A Folder's name, typed once: for a new Folder now, for a rename later. */
export function FolderNameDialog({
  title,
  initial = "",
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: string;
  submitLabel: string;
  /** Resolves with what is wrong with the name, or null once it is done. */
  onSubmit: (name: string) => Promise<FolderNameProblem | null>;
  onClose: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const say = (p: FolderNameProblem) => {
    switch (p.kind) {
      case "empty":
        return t.folders.empty_name;
      case "dot":
        return t.folders.dot;
      case "char":
        return t.folders.char(p.char);
      case "taken":
        return t.folders.taken(p.name);
    }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const p = await onSubmit(name);
      if (p) setError(say(p));
    } catch (err) {
      // The engine checks again; whatever it refuses is shown as it says it.
      toast.error(String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="folder-name-dialog">
        <DialogHeader className="min-w-0">
          <DialogTitle className="break-words">{title}</DialogTitle>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid min-w-0 gap-3">
          <Input
            data-testid="folder-name-input"
            aria-label={t.folders.name}
            placeholder={t.folders.name}
            value={name}
            autoFocus
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
          {error && (
            <p data-testid="folder-name-error" role="alert" className="text-sm break-words text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-auto min-h-9" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button type="submit" data-testid="folder-name-submit" className="h-auto min-h-9" disabled={busy}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The drag data type that carries a document of `type`'s id. */
const dragType = (type: FolderType) => `application/x-synesis-${type}`;
/** The drag data type that carries a Folder of `type`'s key. */
const folderDragType = (type: FolderType) => `application/x-synesis-folder-${type}`;

const dropHighlight = "bg-sidebar-accent/70 ring-1 ring-sidebar-ring";

interface Drop {
  type: FolderType;
  /** The Folder a document is being dragged over (`""` for the group), if any. */
  over: string | null;
  handlers: (key: string) => {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
  /** A Folder's drag began (#150): it and its own Folders stop being targets. */
  startFolder: (key: string) => void;
  endFolder: () => void;
}
const DropContext = createContext<Drop | null>(null);

/** How far a nested row moves right; deeper rows stop moving, so labels keep room. */
const indent = (depth: number) => `${Math.min(depth, 4) * 0.75 + 0.75}rem`;

/**
 * Notes or Compositions as their Folders (PLAN §31): Folders first, then
 * documents, natural-sorted at every level. A Folder row folds; its `+` makes
 * a document inside it and its "…" (or a right-click) offers the rest. Which
 * Folders are open is remembered on this Device, and the Folders holding the
 * open document unfold on their own.
 */
export function FolderTreeView({ type, docs, activeId }: { type: FolderType; docs: DocSummary[]; activeId: string | null }) {
  const s = useStore();
  const { version } = useContext(FolderActionsContext);
  const { data } = useQuery<string[]>({
    key: ["sidebar-folders", type, version],
    deps: { types: [type] },
    fetch: () => api.listFolders(type),
  });
  const top = s.info?.doc_types.find((d) => d.type === type)?.folder ?? (type === "note" ? "Notes" : "Compositions");
  const tree = useMemo(() => folderTree(top, data ?? [], docs), [top, data, docs]);
  // Remembered on this Device, per Vault and per type.
  const vault = s.info?.meta.id ?? s.info?.root ?? "";
  const [open, setOpen] = useState<ReadonlySet<string>>(() => loadOpenFolders(vault, type));
  useEffect(() => setOpen(loadOpenFolders(vault, type)), [vault, type]);
  const toggle = (key: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      saveOpenFolders(vault, type, n);
      return n;
    });
  // Unfold the way to a document when it is opened, so its row is in sight.
  // Once per opening: the tree is rebuilt on every save, and a Folder the
  // reader folds afterwards stays folded. Only adds, and is remembered like
  // a fold the reader made.
  const unfoldedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!activeId || unfoldedFor.current === activeId) return;
    if (!docs.some((d) => d.id === activeId)) return;
    unfoldedFor.current = activeId;
    const want = foldersHolding(tree, activeId);
    if (!want.length) return;
    setOpen((o) => {
      if (want.every((k) => o.has(k))) return o;
      const n = new Set([...o, ...want]);
      saveOpenFolders(vault, type, n);
      return n;
    });
  }, [activeId, tree, type, docs, vault]);

  // Drag a document onto a Folder, or onto the group for the top (desktop
  // only, PLAN §31). Only a document of this group's type makes a target
  // light up: its type rides in the drag's data type, which a page may read
  // while dragging, where the data itself it may not.
  const act = useFolderAct();
  const [over, setOver] = useState<string | null>(null);
  const mime = dragType(type);
  const folderMime = folderDragType(type);
  // The Folder being dragged, if one is: never a target for itself or for
  // the Folders inside it.
  const [dragging, setDragging] = useState<string | null>(null);
  const takes = (e: React.DragEvent, key: string) =>
    e.dataTransfer.types.includes(mime) ||
    (e.dataTransfer.types.includes(folderMime) && dragging !== null && key !== dragging && !key.startsWith(`${dragging}/`));
  const dropHandlers = (key: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!takes(e, key)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      if (over !== key) setOver(key);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === key ? null : o));
    },
    onDrop: (e: React.DragEvent) => {
      const moved = e.dataTransfer.getData(folderMime);
      if (moved && takes(e, key)) {
        setOver(null);
        setDragging(null);
        e.preventDefault();
        e.stopPropagation();
        if (parentOf(moved) !== key) act({ kind: "move-folder-to", type, folder: moved, into: key });
        return;
      }
      const id = e.dataTransfer.getData(mime);
      setOver(null);
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      const doc = docs.find((d) => d.id === id);
      if (doc && folderOf(doc.path, top) === key) return;
      act({ kind: "move", id, into: key });
    },
  });
  const drop: Drop = {
    type,
    over,
    handlers: dropHandlers,
    startFolder: (key) => setDragging(key),
    endFolder: () => {
      setDragging(null);
      setOver(null);
    },
  };
  return (
    <DropContext.Provider value={drop}>
      <SidebarMenu
        data-testid={`folder-tree-${type}`}
        data-drop-target={over === "" || undefined}
        className={cn("rounded-md", over === "" && dropHighlight)}
        {...dropHandlers("")}
      >
        <FolderLevel folders={tree.folders} docs={tree.docs} depth={0} type={type} open={open} toggle={toggle} activeId={activeId} />
      </SidebarMenu>
    </DropContext.Provider>
  );
}

function FolderLevel({
  folders,
  docs,
  depth,
  type,
  open,
  toggle,
  activeId,
}: {
  folders: FolderNode<DocSummary>[];
  docs: DocSummary[];
  depth: number;
  type: FolderType;
  open: ReadonlySet<string>;
  toggle: (key: string) => void;
  activeId: string | null;
}) {
  const s = useStore();
  const t = useT();
  return (
    <>
      {folders.map((f) => {
        const isOpen = open.has(f.key);
        const Icon = isOpen ? FolderOpen : Folder;
        // A Folder outside the type's folder is shown where it is, but the
        // Folder operations work inside `Notes/` or `Compositions/` only.
        const ours = !f.key.startsWith("/");
        return (
          <FolderRow key={f.key} folder={f} type={type} ours={ours}>
            <SidebarMenuButton
              data-testid="folder-row"
              size="sm"
              aria-expanded={isOpen}
              className={ours ? "pr-[5.5rem]" : "pr-8"}
              style={{ paddingLeft: indent(depth) }}
              title={f.path}
              onClick={() => toggle(f.key)}
            >
              <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{f.outside ? `/${f.name}` : f.name}</span>
              <span className="sr-only">{t.documents(f.count)}</span>
            </SidebarMenuButton>
            <SidebarMenuBadge data-testid="folder-count" aria-hidden className={ours ? "right-[3.75rem]" : undefined}>
              {f.count}
            </SidebarMenuBadge>
            {isOpen && (
              <ul className="flex min-w-0 flex-col gap-0.5 pt-0.5">
                <FolderLevel folders={f.folders} docs={f.docs} depth={depth + 1} type={type} open={open} toggle={toggle} activeId={activeId} />
              </ul>
            )}
          </FolderRow>
        );
      })}
      {docs.map((d) => (
        <DocRow key={d.id} doc={d} type={type}>
          <SidebarMenuButton
            data-testid="doc-item"
            size="sm"
            className="pr-8"
            style={{ paddingLeft: depth === 0 ? "2rem" : `calc(${indent(depth)} + 1.25rem)` }}
            isActive={activeId === d.id}
            onClick={s.openDocOnClick(d.id)}
            title={d.path}
          >
            <TypeDot type={d.type} className="ml-0.5" />
            <span className="min-w-0 truncate">{d.label}</span>
          </SidebarMenuButton>
        </DocRow>
      ))}
    </>
  );
}

/**
 * A Folder's row, with its `+` and its "…" menu: always shown, so a phone
 * reaches them without hovering, and opened by a right-click on desktop too.
 */
function FolderRow({ folder, type, ours, children }: { folder: FolderNode<DocSummary>; type: FolderType; ours: boolean; children: ReactNode }) {
  const t = useT();
  const act = useFolderAct();
  const drop = useContext(DropContext);
  const mobile = useIsMobile();
  const [menu, setMenu] = useState(false);
  /** Rename and Move open a dialog that takes focus; only then must the menu not take it back. */
  const opensDialog = useRef(false);
  const target = ours && drop?.over === folder.key;
  return (
    <SidebarMenuItem
      className={cn("min-w-0 rounded-md", target && dropHighlight)}
      data-testid="folder"
      data-folder={folder.key}
      data-drop-target={target || undefined}
      {...(ours && drop ? drop.handlers(folder.key) : {})}
      draggable={ours && !mobile}
      onDragStart={(e) => {
        // The innermost Folder row starts the drag, not the ones around it.
        if (!ours || e.target !== e.currentTarget) return;
        e.stopPropagation();
        e.dataTransfer.setData(folderDragType(type), folder.key);
        e.dataTransfer.effectAllowed = "move";
        drop?.startFolder(folder.key);
      }}
      onDragEnd={() => drop?.endFolder()}
      onContextMenu={(e) => {
        // This Folder's own row only, not a row nested inside it.
        const el = e.target as HTMLElement;
        if (!ours || !el.closest("[data-testid=folder-row]") || el.closest("[data-testid=folder]") !== e.currentTarget) return;
        e.preventDefault();
        setMenu(true);
      }}
    >
      {children}
      {ours && (
        <>
          <SidebarMenuAction
            data-testid="folder-new-here"
            className="top-0.5 right-8 w-6"
            title={t.folders.new_here[type]}
            aria-label={`${t.folders.new_here[type]}: ${folder.name}`}
            onClick={() => act({ kind: "new-here", type, folder: folder.key })}
          >
            <Plus />
          </SidebarMenuAction>
          <DropdownMenu open={menu} onOpenChange={setMenu}>
            <DropdownMenuTrigger asChild>
              <SidebarMenuAction data-testid="folder-menu" className="top-0.5 w-6" aria-label={t.folders.menu(folder.name)}>
                <MoreHorizontal />
              </SidebarMenuAction>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="right"
              align="start"
              className="max-w-[min(18rem,calc(100vw-2rem))]"
              onCloseAutoFocus={(e) => {
                if (opensDialog.current) e.preventDefault();
                opensDialog.current = false;
              }}
            >
              <DropdownMenuItem data-testid="folder-menu-new-here" onSelect={() => act({ kind: "new-here", type, folder: folder.key })}>
                {t.folders.new_here[type]}
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="folder-menu-new-folder" onSelect={() => act({ kind: "new-folder", type, parent: folder.key })}>
                {t.folders.new_folder}
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="folder-menu-rename" onSelect={() => {
                  opensDialog.current = true;
                  act({ kind: "rename", type, folder: folder.key });
                }}>
                {t.folders.rename}
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="folder-menu-move" onSelect={() => {
                  opensDialog.current = true;
                  act({ kind: "move-folder", type, folder: folder.key });
                }}>
                {t.folders.move_command}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem data-testid="folder-menu-delete" variant="destructive" onSelect={() => act({ kind: "delete", type, folder: folder.key })}>
                {t.folders.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </SidebarMenuItem>
  );
}

/**
 * A document's row, with its "…" menu (always shown; right-click on desktop):
 * Move to folder… On desktop the row can also be dragged onto a Folder.
 */
function DocRow({ doc, type, children }: { doc: DocSummary; type: FolderType; children: ReactNode }) {
  const s = useStore();
  const t = useT();
  const mobile = useIsMobile();
  const [menu, setMenu] = useState(false);
  return (
    <SidebarMenuItem
      className="min-w-0"
      data-testid="doc-row"
      data-doc={doc.id}
      draggable={!mobile}
      onDragStart={(e) => {
        e.dataTransfer.setData(dragType(type), doc.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu(true);
      }}
    >
      {children}
      <DropdownMenu open={menu} onOpenChange={setMenu}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction data-testid="doc-menu" className="top-0.5 w-6" aria-label={t.folders.doc_menu(doc.label)}>
            <MoreHorizontal />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="max-w-[min(18rem,calc(100vw-2rem))]" onCloseAutoFocus={(e) => e.preventDefault()}>
          <DropdownMenuItem data-testid="doc-menu-move" onSelect={() => s.setDialog({ kind: "move-to-folder", id: doc.id })}>
            {t.folders.move_command}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

/** The "…" beside a Notes or Compositions group's name: New folder at the top. */
export function GroupFolderMenu({ type, label, className }: { type: FolderType; label: string; className?: string }) {
  const t = useT();
  const act = useFolderAct();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid={`group-menu-${type}`}
          aria-label={t.folders.group_menu(label)}
          className={cn(
            "flex size-6 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&_svg]:size-3.5",
            className,
          )}
        >
          <MoreHorizontal />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="max-w-[min(18rem,calc(100vw-2rem))]">
        <DropdownMenuItem data-testid="group-menu-new-folder" onSelect={() => act({ kind: "new-folder", type, parent: "" })}>
          {t.folders.new_folder}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

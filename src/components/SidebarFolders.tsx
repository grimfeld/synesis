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
  leaf,
  folderTree,
  foldersHolding,
  loadOpenFolders,
  saveOpenFolders,
  type FolderNameProblem,
  type FolderNode,
} from "@/lib/folders";
import { useQuery } from "@/lib/useQuery";
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
  | { kind: "delete"; type: FolderType; folder: string };

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
  const [naming, setNaming] = useState<{ type: FolderType; parent: string } | null>(null);

  const act = (a: FolderAct) => {
    if (a.kind === "new-folder") setNaming({ type: a.type, parent: a.parent });
    else if (a.kind === "new-here") s.setDialog({ kind: "new", type: a.type, folder: a.folder });
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
    const siblings = childNames(await api.listFolders(naming.type), naming.parent);
    const problem = folderNameProblem(name, siblings);
    if (problem) return problem;
    await api.createFolder(naming.type, naming.parent, name);
    setVersion((v) => v + 1);
    setNaming(null);
    return null;
  };

  return {
    provider: (children) => (
      <FolderActionsContext.Provider value={{ act, version }}>
        {children}
        {naming && (
          <FolderNameDialog
            title={naming.parent ? t.folders.new_folder_in(leaf(naming.parent)) : t.folders.new_folder}
            submitLabel={t.create}
            onSubmit={create}
            onClose={() => setNaming(null)}
          />
        )}
      </FolderActionsContext.Provider>
    ),
  };
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
  return (
    <SidebarMenu data-testid={`folder-tree-${type}`}>
      <FolderLevel folders={tree.folders} docs={tree.docs} depth={0} type={type} open={open} toggle={toggle} activeId={activeId} />
    </SidebarMenu>
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
        <li key={d.id} className="min-w-0">
          <SidebarMenuButton
            data-testid="doc-item"
            size="sm"
            style={{ paddingLeft: depth === 0 ? "2rem" : `calc(${indent(depth)} + 1.25rem)` }}
            isActive={activeId === d.id}
            onClick={s.openDocOnClick(d.id)}
            title={d.path}
          >
            <TypeDot type={d.type} className="ml-0.5" />
            <span className="min-w-0 truncate">{d.label}</span>
          </SidebarMenuButton>
        </li>
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
  const [menu, setMenu] = useState(false);
  return (
    <SidebarMenuItem
      className="min-w-0"
      data-testid="folder"
      data-folder={folder.key}
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
            <DropdownMenuContent side="right" align="start" className="max-w-[min(18rem,calc(100vw-2rem))]">
              <DropdownMenuItem data-testid="folder-menu-new-here" onSelect={() => act({ kind: "new-here", type, folder: folder.key })}>
                {t.folders.new_here[type]}
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="folder-menu-new-folder" onSelect={() => act({ kind: "new-folder", type, parent: folder.key })}>
                {t.folders.new_folder}
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

// Folders (PLAN §31, CONTEXT "Folder"): how the sidebar's Notes and
// Compositions groups are drawn as a tree. Pure, so the order, the counts and
// where a document outside its type's folder lands are tested once
// (`test:unit`) and `AppSidebar` stays a renderer — the `shelve()` precedent
// in `src/lib/library.ts`.
//
// A Folder is a directory the engine lists (`listFolders`), empty ones
// included. The documents' own paths say the rest, so a Folder holding a
// document appears even if the engine's list failed or is late.

/** The part of a document the tree needs. */
export interface FolderDoc {
  id: string;
  path: string;
  label: string;
}

export interface FolderNode<D extends FolderDoc = FolderDoc> {
  /** The Folder's own name, as on disk. */
  name: string;
  /**
   * Where it is: relative to the type's folder (`Sermons/2026`), or, for one
   * outside it, from the Vault root with a leading `/` (`/Study`). Unique
   * within a tree, so it keys the open state.
   */
  key: string;
  /** Its path from the Vault root (`Notes/Sermons/2026`), for a tooltip. */
  path: string;
  folders: FolderNode<D>[];
  docs: D[];
  /** Documents inside it, nested ones included. */
  count: number;
  /**
   * A top-level Folder outside the type's folder, labelled with its path
   * from the Vault root (`/Study`, or `/` for the Vault root itself).
   */
  outside: boolean;
}

export interface FolderTree<D extends FolderDoc = FolderDoc> {
  folders: FolderNode<D>[];
  docs: D[];
}

/** Natural order: "Week 2" before "Week 10", case and accents ignored. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
export const naturalCompare = (a: string, b: string): number => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

/**
 * The tree for one type: its Folders first, then its documents, both in
 * natural order, at every level.
 *
 * `top` is the type's folder (`Notes`); `folders` are paths relative to it.
 * A document stored outside `top` (the Vault root, `Study/`) is placed under
 * its real path from the Vault root, in Folders keyed with a leading `/` that
 * come after the type's own, so the sidebar never misstates where a file is.
 */
export function folderTree<D extends FolderDoc>(top: string, folders: string[], docs: D[]): FolderTree<D> {
  const root: FolderTree<D> = { folders: [], docs: [] };
  const byKey = new Map<string, FolderNode<D>>();

  /** The node for `segments` under the tree, made with its parents. */
  const nodeFor = (segments: string[], outside: boolean): FolderTree<D> | FolderNode<D> => {
    let at: FolderTree<D> | FolderNode<D> = root;
    for (let i = 0; i < segments.length; i++) {
      const rel = segments.slice(0, i + 1).join("/");
      const key = outside ? `/${rel}` : rel;
      let node = byKey.get(key);
      if (!node) {
        node = {
          name: segments[i],
          key,
          path: outside ? rel : `${top}/${rel}`,
          folders: [],
          docs: [],
          count: 0,
          outside: outside && i === 0,
        };
        byKey.set(key, node);
        at.folders.push(node);
      }
      at = node;
    }
    return at;
  };

  for (const f of folders) {
    const segments = f.split("/").filter(Boolean);
    if (segments.length) nodeFor(segments, false);
  }
  const prefix = `${top}/`;
  for (const d of docs) {
    const inside = d.path.startsWith(prefix);
    const segments = (inside ? d.path.slice(prefix.length) : d.path).split("/").filter(Boolean);
    segments.pop(); // the file itself
    if (!inside && !segments.length) {
      // At the Vault root: under a `/` Folder, never beside the type's own documents.
      let rootNode = byKey.get("/");
      if (!rootNode) {
        rootNode = { name: "", key: "/", path: "", folders: [], docs: [], count: 0, outside: true };
        byKey.set("/", rootNode);
        root.folders.push(rootNode);
      }
      rootNode.docs.push(d);
      continue;
    }
    nodeFor(segments, !inside).docs.push(d);
  }

  const settle = (t: FolderTree<D> | FolderNode<D>): number => {
    // The type's own Folders before those found outside it, each in natural order.
    t.folders.sort((a, b) => Number(a.outside) - Number(b.outside) || naturalCompare(a.name, b.name));
    t.docs.sort((a, b) => naturalCompare(a.label, b.label));
    const n = t.docs.length + t.folders.reduce((sum, f) => sum + settle(f), 0);
    if ("count" in t) t.count = n;
    return n;
  };
  settle(root);
  return root;
}

/** The keys of the Folders holding the document `id`, outermost first. */
export function foldersHolding(tree: FolderTree, id: string): string[] {
  const walk = (nodes: FolderNode[], trail: string[]): string[] | null => {
    for (const n of nodes) {
      const here = [...trail, n.key];
      if (n.docs.some((d) => d.id === id)) return here;
      const deeper = walk(n.folders, here);
      if (deeper) return deeper;
    }
    return null;
  };
  return walk(tree.folders, []) ?? [];
}

// ---- open Folders, per Device (PLAN §31): which Folders the reader unfolded,
// kept across restarts. UI state, never Vault content.

/**
 * Kept per Vault, as the Pane layout is (`panes.ts`): two Vaults may both hold
 * a `Sermons`. And per type: the Notes and Compositions trees each own their
 * entry, so neither writes over the other's.
 */
const openKey = (vault: string, type: string) => `synesis.sidebar.folders:${vault}:${type}`;

/** The open Folders of one type in a Vault, by `FolderNode.key`. */
export function loadOpenFolders(
  vault: string,
  type: string,
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
): Set<string> {
  try {
    const raw = storage?.getItem(openKey(vault, type));
    const v: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveOpenFolders(
  vault: string,
  type: string,
  open: ReadonlySet<string>,
  storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage,
): void {
  try {
    storage?.setItem(openKey(vault, type), JSON.stringify([...open]));
  } catch {
    // Private mode or a full disk: remembering is a convenience.
  }
}

// ---- Folder names (PLAN §31): the same rules as the engine's
// `check_folder_name`, here so a refusal is worded in the app's language
// before anything is asked of the engine, which checks again.

export type FolderNameProblem =
  | { kind: "empty" }
  | { kind: "dot" }
  | { kind: "char"; char: string }
  | { kind: "taken"; name: string };

const FORBIDDEN = '/\\:*?"<>|#^[]';

/** What is wrong with `name` for a Folder among `siblings`, or null. */
export function folderNameProblem(name: string, siblings: readonly string[]): FolderNameProblem | null {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n) return { kind: "empty" };
  if (n.startsWith(".")) return { kind: "dot" };
  // eslint-disable-next-line no-control-regex
  const bad = [...n].find((c) => FORBIDDEN.includes(c) || /[\u0000-\u001f\u007f-\u009f]/.test(c));
  if (bad) return { kind: "char", char: bad };
  const clash = siblings.find((s) => s.toLocaleLowerCase() === n.toLocaleLowerCase());
  if (clash) return { kind: "taken", name: clash };
  return null;
}

/** The names directly inside `parent` (`""` for the top), from `listFolders`' paths. */
export function childNames(folders: readonly string[], parent: string): string[] {
  const prefix = parent ? `${parent}/` : "";
  return folders
    .filter((f) => f.startsWith(prefix) && f.length > prefix.length && !f.slice(prefix.length).includes("/"))
    .map((f) => f.slice(prefix.length));
}

/** The last name in a Folder path. */
export const leaf = (path: string) => path.split("/").pop() || path;

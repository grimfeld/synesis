// One live document per id (spec #35, issue #50).
//
// Two Panes can show the same document. Each used to load, hold and save its
// own copy, so the Pane saving last wrote over the other's typing. Now every
// opener of an id in this Window shares one LiveDocument: it holds the text,
// saves it (debounced, never two saves at once) and hands each editor's
// typing to the other editors as it happens.
//
// Editors join as members. A member's `write` is its typing; every other
// member hears it through `onRemote` and applies it to its own view, so no
// editor waits on a React render to see the other's keystrokes. Wholesale
// replacements (a load, a restored Version, a panel rewriting the body) bump
// `revision` instead, which every editor follows from its props.
//
// Across Windows (#51), each Window keeps its own LiveDocument and the engine
// relays edits between them: a Window's edit is sent to the engine, and an
// edit from another Window arrives here as `receive`, applied like a member's
// write from outside this Window.
import { joinFrontmatter, splitFrontmatter } from "@/lib/frontmatter";
import type { DocumentPayload } from "@/lib/api";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** What a LiveDocument needs from the engine. */
export interface LiveEngine {
  getDocument(id: string): Promise<DocumentPayload>;
  saveDocument(id: string, text: string): Promise<DocumentPayload>;
}

export interface LiveSnapshot {
  doc: DocumentPayload | null;
  fm: string;
  body: string;
  /** Bumped when the text is replaced wholesale, so editors resync even to an equal body. */
  revision: number;
  status: SaveStatus;
  /** The file changed on disk while there was typing not yet saved. */
  external: boolean;
}

/** One editor showing a LiveDocument. */
export interface LiveMember {
  /** This editor's typing: the whole body as it now stands. */
  write(body: string): void;
  leave(): void;
}

/** The part of a LiveDocument an editor needs. */
export interface LiveBody {
  /**
   * Join as an editor. `onRemote` is called at once with the body as it
   * stands, then with every body another editor writes.
   */
  join(onRemote: (body: string) => void): LiveMember;
}

export interface LiveDocuments {
  /** The live document for `id`, without retaining it (for a render). */
  get(id: string): LiveDocument;
  /** The live document for `id`, retained until `release`. */
  open(id: string): LiveDocument;
  /** The live document for `id` if one is open here, without opening one. */
  peek(id: string): LiveDocument | undefined;
}

export interface LiveOptions {
  /** Called after each successful save. */
  onSaved?: () => void;
  /** Called with a document when it is first opened and when it is let go. */
  onOpen?: (doc: LiveDocument) => () => void;
  /** Debounce before typing is saved, in ms. */
  delay?: number;
  /**
   * Called with the whole text after every edit made in this Window (typing,
   * a panel's write, frontmatter, a restored Version), so it can be relayed to
   * the other Windows (#51). Not called for `receive` or for a read of the file.
   */
  onEdit?: (id: string, text: string) => void;
}

const toLf = (s: string) => s.replace(/\r\n?/g, "\n");

export class LiveDocument implements LiveBody {
  private state: LiveSnapshot = {
    doc: null,
    fm: "",
    body: "",
    revision: 0,
    status: "idle",
    external: false,
  };
  private listeners = new Set<() => void>();
  private members = new Set<(body: string) => void>();
  private dirty = false;
  private saving = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The text as this Window last read or wrote it, to tell an echo of its own save from an edit made elsewhere. */
  private known: string | null = null;
  private loaded: Promise<void> | null = null;
  private lastNotice: unknown = null;
  private refs = 0;
  onSaved: (() => void) | undefined;
  onEdit: ((id: string, text: string) => void) | undefined;

  constructor(
    readonly id: string,
    private engine: LiveEngine,
    private delay: number,
    private registry: {
      dispose(d: LiveDocument): void;
      revive(d: LiveDocument): void;
    },
  ) {}

  // ------------------------------------------------------------- reading

  snapshot = (): LiveSnapshot => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<LiveSnapshot>) {
    this.state = { ...this.state, ...patch };
    for (const fn of [...this.listeners]) fn();
  }

  private text() {
    return joinFrontmatter(this.state.fm, this.state.body);
  }

  /** Hand an edit made here to the other Windows. */
  private relay() {
    this.onEdit?.(this.id, this.text());
  }

  // ------------------------------------------------------------- loading

  /** Show `d` as the document, replacing the text in every editor. */
  private apply(d: DocumentPayload) {
    this.known = d.text;
    const sp = splitFrontmatter(d.text);
    // Editors hold "\n" line breaks whatever the file has; the body is kept
    // the same way, so a CRLF file opened is not a CRLF file edited, and the
    // panels' offsets match the editor's.
    this.dirty = false;
    this.set({
      doc: d,
      fm: sp.fm,
      body: toLf(sp.body),
      revision: this.state.revision + 1,
      external: false,
    });
  }

  /**
   * Read the file. With `once`, only if no opener has read it yet: a second
   * Pane opening the document must not reload over the first one's typing.
   */
  load = (opts: { once?: boolean } = {}): Promise<void> => {
    if (opts.once && this.loaded) return this.loaded;
    const p = this.engine.getDocument(this.id).then((d) => this.apply(d));
    this.loaded = p;
    return p;
  };

  // ------------------------------------------------------------- editing

  join = (onRemote: (body: string) => void): LiveMember => {
    this.members.add(onRemote);
    onRemote(this.state.body);
    return {
      write: (body) => this.edit(body, onRemote),
      leave: () => {
        this.members.delete(onRemote);
      },
    };
  };

  private edit(body: string, from: ((body: string) => void) | null) {
    if (body === this.state.body) return;
    this.dirty = true;
    this.set({ body });
    for (const m of [...this.members]) if (m !== from) m(body);
    this.relay();
    this.schedule();
  }

  /** Typing from outside any member editor; every editor hears it. */
  write = (body: string) => this.edit(body, null);

  /**
   * An edit made in another Window (#51), relayed by the engine. Applied
   * like typing: every editor here hears it, and it is not saved again here.
   */
  receive = (text: string) => {
    const sp = splitFrontmatter(text);
    this.known = text;
    if (sp.fm !== this.state.fm) this.set({ fm: sp.fm });
    const body = toLf(sp.body);
    if (body === this.state.body) return;
    this.set({ body });
    for (const m of [...this.members]) m(body);
  };

  /** A write from a panel (linking a Linkable): every editor resyncs. */
  setBodyText = (body: string) => {
    this.dirty = true;
    this.set({ body, revision: this.state.revision + 1 });
    this.relay();
    this.schedule();
  };

  /** Frontmatter edits (type, tags, properties) are visible at once, so they save now. */
  editFm = (fm: string) => {
    this.dirty = true;
    this.set({ fm });
    this.relay();
    clearTimeout(this.timer);
    void this.save();
  };

  /** Replace the whole text (a restored Version) and save at once. */
  replaceText = (text: string) => {
    const sp = splitFrontmatter(text);
    this.dirty = true;
    this.set({ fm: sp.fm, body: sp.body, revision: this.state.revision + 1 });
    this.relay();
    clearTimeout(this.timer);
    void this.save();
  };

  // ------------------------------------------------------------- saving

  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), this.delay);
  }

  private async save() {
    if (!this.dirty || this.saving) return;
    this.saving = true;
    this.set({ status: "saving" });
    const text = this.text();
    try {
      const d = await this.engine.saveDocument(this.id, text);
      this.known = d.text;
      this.dirty = this.text() !== text;
      const patch: Partial<LiveSnapshot> = { doc: d, status: "saved" };
      const sp = splitFrontmatter(d.text);
      if (sp.fm !== this.state.fm && !this.dirty) patch.fm = sp.fm;
      this.set(patch);
      this.onSaved?.();
    } catch (e) {
      console.error(e);
      this.set({ status: "error" });
    } finally {
      this.saving = false;
      if (this.dirty) this.schedule();
    }
  }

  /** Save now if anything is pending (before naming a Version, before a rename). */
  flush = async (): Promise<void> => {
    if (!this.dirty) return;
    clearTimeout(this.timer);
    await this.save();
  };

  // ------------------------------------------------------------- the disk

  /**
   * Files changed on disk. The mtime alone cannot tell: the watcher also
   * reports this Window's own saves, and on Android it can do so while the
   * next save is in flight or with an mtime the save did not return. So the
   * text on disk decides.
   */
  noticeChange = (changed: { id: string; mtime: number }[]) => {
    if (changed === this.lastNotice) return;
    this.lastNotice = changed;
    const doc = this.state.doc;
    const mine = changed.find((d) => d.id === this.id);
    if (!doc || !mine || mine.mtime === doc.summary.mtime) return;
    this.engine
      .getDocument(this.id)
      .then((d) => {
        if (d.text === this.known || d.text === this.text()) {
          // Our own save, or already what the editors show.
          if (!this.saving) this.set({ doc: d });
          return;
        }
        // Checked now rather than before the read, so a keystroke made while
        // it was on its way is never overwritten.
        if (this.dirty || this.saving) this.set({ external: true });
        else this.apply(d);
      })
      .catch(console.error);
  };

  // ------------------------------------------------------------- lifetime

  /**
   * Hold this document open. A document let go by its last opener is
   * registered again (a Strict Mode remount lets go and retains at once).
   */
  retain = () => {
    if (this.refs++ === 0) this.registry.revive(this);
  };

  /** Let go of what `open` or `retain` held. The last opener out saves what is pending. */
  release = () => {
    if (--this.refs > 0) return;
    clearTimeout(this.timer);
    if (this.dirty) {
      this.dirty = false;
      this.engine.saveDocument(this.id, this.text()).catch(console.error);
    }
    // Held again later, it reads the file afresh: no watcher reached it meanwhile.
    this.loaded = null;
    this.registry.dispose(this);
  };
}

export function createLiveDocuments(
  engine: LiveEngine,
  opts: LiveOptions = {},
): LiveDocuments {
  const docs = new Map<string, LiveDocument>();
  const closers = new Map<LiveDocument, () => void>();
  const registry = {
    dispose(d: LiveDocument) {
      if (docs.get(d.id) === d) docs.delete(d.id);
      closers.get(d)?.();
      closers.delete(d);
    },
    revive(d: LiveDocument) {
      if (docs.has(d.id)) return;
      docs.set(d.id, d);
      if (opts.onOpen) closers.set(d, opts.onOpen(d));
    },
  };
  const get = (id: string) => {
    let d = docs.get(id);
    if (!d) {
      d = new LiveDocument(id, engine, opts.delay ?? 700, registry);
      d.onSaved = opts.onSaved;
      d.onEdit = opts.onEdit;
      registry.revive(d);
    }
    return d;
  };
  return {
    get,
    open(id) {
      const d = get(id);
      d.retain();
      return d;
    },
    peek: (id) => docs.get(id),
  };
}

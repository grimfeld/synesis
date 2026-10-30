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
// Across Windows (#51), each Window keeps its own LiveDocument, and a
// `DocSync` keeps its text the same as the other Windows': each change made
// here goes to the engine as an operation, and the other Windows' changes
// come back rebased over typing not yet sent, so none is lost
// (`src/lib/docSync.ts`). A Window saves whatever changed its text, its own
// typing or another Window's: whichever Window saves last, the file ends up
// with the text they all show.
import { joinFrontmatter, splitFrontmatter } from "@/lib/frontmatter";
import type { DocumentPayload } from "@/lib/api";
import { DocSync, type SyncTransport } from "@/lib/docSync";

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
  /**
   * The live document for `id`, without retaining it: for a render, so the
   * first paint already shows the text another Pane has. Nothing is
   * registered until it is retained.
   */
  get(id: string): LiveDocument;
  /** The live document for `id`, retained until `release`. */
  open(id: string): LiveDocument;
  /** The live document for `id` if one is held here, without opening one. */
  peek(id: string): LiveDocument | undefined;
  /** Call `fn` with the id after every successful save; returns the unsubscribe. */
  onSaved(fn: (id: string) => void): () => void;
  /**
   * Save everything pending, then let every document go for good: the Vault
   * is about to change, so nothing held now may be written afterwards.
   */
  suspend(): Promise<void>;
}

export interface LiveOptions {
  /** Called with a document when it is first held and when it is let go. */
  onOpen?: (doc: LiveDocument) => () => void;
  /** Debounce before typing is saved, in ms. */
  delay?: number;
  /** The engine's Window sessions (#51), where there are Windows. */
  sync?: SyncTransport;
}

const toLf = (s: string) => s.replace(/\r\n?/g, "\n");

/** A file's text as the editors hold it: "\n" line breaks in the body. */
function normalise(text: string) {
  const sp = splitFrontmatter(text);
  return joinFrontmatter(sp.fm, toLf(sp.body));
}

/** How long a closing Window waits for the engine before saving what it has. */
const DRAIN_MS = 2000;

const within = (p: Promise<void>, ms: number) =>
  Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))]);

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
  private saving: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The text as this Window last read or wrote it, to tell an echo of its own save from an edit made elsewhere. */
  private known: string | null = null;
  private loaded: Promise<void> | null = null;
  private lastNotice: unknown = null;
  private refs = 0;
  private sync: DocSync | null = null;
  /** The last opener let go: what was pending is being saved. */
  private finishing: Promise<void> | null = null;
  /** Let go for good (the Vault changed): writes nothing more. */
  private dead = false;

  constructor(
    readonly id: string,
    private engine: LiveEngine,
    private delay: number,
    private registry: {
      dispose(d: LiveDocument): void;
      revive(d: LiveDocument): void;
      saved(id: string): void;
      transport?: SyncTransport;
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
   *
   * Shared with other Windows, a read after the first is a Reload: the file
   * replaces the text they all show, as a change.
   */
  load = (opts: { once?: boolean } = {}): Promise<void> => {
    if (opts.once && this.loaded) return this.loaded;
    const p = (async () => {
      // A document let go and held again reads the file once its last save landed.
      await this.finishing;
      const d = await this.engine.getDocument(this.id);
      if (this.dead) return;
      const sync = this.sync;
      if (sync?.active) {
        const text = normalise(d.text);
        await sync.disk(text, true);
        this.known = d.text;
        if (this.text() === text) this.dirty = false;
        this.set({ doc: d, external: false });
        return;
      }
      this.apply(d);
      await sync?.join(this.text());
    })();
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

  /**
   * Every change made in this Window goes through here: show it, hand it to
   * the other editors (unless `wholesale`: they follow `revision`) and the
   * other Windows, and save it, `now` or after the debounce.
   */
  private change(
    patch: { fm?: string; body?: string },
    o: { from?: ((body: string) => void) | null; now?: boolean; wholesale?: boolean } = {},
  ) {
    if (this.dead) return;
    const before = this.text();
    if (patch.body !== undefined) patch.body = toLf(patch.body);
    this.dirty = true;
    this.set(o.wholesale ? { ...patch, revision: this.state.revision + 1 } : patch);
    if (!o.wholesale && patch.body !== undefined)
      for (const m of [...this.members]) if (m !== o.from) m(this.state.body);
    this.sync?.local(before, this.text());
    if (o.now) {
      clearTimeout(this.timer);
      void this.save();
    } else this.schedule();
  }

  private edit(body: string, from: ((body: string) => void) | null) {
    if (body === this.state.body) return;
    this.change({ body }, { from });
  }

  /** Typing from outside any member editor; every editor hears it. */
  write = (body: string) => this.edit(body, null);

  /**
   * Another Window's change (#51), already merged with this Window's text:
   * every editor here hears it. It is saved here too, unless it is the file
   * itself, so the file never misses it whichever Window saves last.
   */
  private remote(text: string, disk: boolean) {
    const sp = splitFrontmatter(text);
    const patch: Partial<LiveSnapshot> = {};
    if (sp.fm !== this.state.fm) patch.fm = sp.fm;
    if (sp.body !== this.state.body) patch.body = sp.body;
    this.set(patch);
    if (patch.body !== undefined) for (const m of [...this.members]) m(sp.body);
    if (disk) {
      this.known = text;
      return;
    }
    this.dirty = true;
    this.schedule();
  }

  /** Another Window changed the text (#51): fetch the change. */
  poke = () => this.sync?.poke();

  /** A write from a panel (linking a Linkable): every editor resyncs. */
  setBodyText = (body: string) => this.change({ body }, { wholesale: true });

  /** Frontmatter edits (type, tags, properties) are visible at once, so they save now. */
  editFm = (fm: string) => this.change({ fm }, { now: true });

  /** Replace the whole text (a restored Version) and save at once. */
  replaceText = (text: string) => {
    const sp = splitFrontmatter(text);
    this.change({ fm: sp.fm, body: sp.body }, { now: true, wholesale: true });
  };

  // ------------------------------------------------------------- saving

  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), this.delay);
  }

  private save(): Promise<void> {
    if (!this.dirty || this.dead) return Promise.resolve();
    if (this.saving) return this.saving;
    this.saving = this.write_().finally(() => {
      this.saving = null;
      if (this.dirty && !this.dead) this.schedule();
    });
    return this.saving;
  }

  private async write_() {
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
      this.registry.saved(this.id);
    } catch (e) {
      console.error(e);
      this.set({ status: "error" });
    }
  }

  /**
   * Save now whatever is pending (before naming a Version, a rename, a
   * Window closing): the changes on their way to the other Windows first,
   * then a save already in flight, then the rest.
   */
  flush = async (): Promise<void> => {
    if (this.sync) await within(this.sync.drain(), DRAIN_MS);
    for (let i = 0; i < 3 && (this.dirty || this.saving) && !this.dead; i++) {
      clearTimeout(this.timer);
      if (this.saving) await this.saving;
      else await this.save();
    }
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
      .then(async (d) => {
        if (this.dead) return;
        if (d.text === this.known || d.text === this.text()) {
          // Our own save, or already what the editors show.
          if (!this.saving) this.set({ doc: d });
          return;
        }
        if (this.sync?.active) {
          // Another Window's save, a step ahead of or behind this one, or an
          // edit made outside the app: the engine knows which.
          const { external } = await this.sync.disk(normalise(d.text), false);
          if (external) this.set({ external: true });
          else if (!this.saving) this.set({ doc: d });
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
    if (this.refs++ > 0 || this.dead) return;
    this.registry.revive(this);
    if (!this.sync && this.registry.transport)
      this.sync = new DocSync(this.id, this.registry.transport, {
        text: () => this.text(),
        remote: (text, disk) => this.remote(text, disk),
      });
  };

  /**
   * Let go of what `open` or `retain` held. When the last opener lets go, and
   * is not back within the same turn (a Strict Mode remount), the changes on
   * their way to the other Windows land, what is pending is saved, and the
   * document leaves its Window session.
   */
  release = () => {
    if (--this.refs > 0 || this.dead) return;
    setTimeout(() => {
      if (this.refs === 0 && !this.dead) this.finish();
    }, 0);
  };

  private finish() {
    clearTimeout(this.timer);
    const sync = this.sync;
    this.sync = null;
    // Held again later, it reads the file afresh: no watcher reached it meanwhile.
    this.loaded = null;
    this.registry.dispose(this);
    this.finishing = (async () => {
      if (sync) await within(sync.drain(), DRAIN_MS);
      if (this.saving) await this.saving;
      if (this.dirty && !this.dead) {
        this.dirty = false;
        await this.engine.saveDocument(this.id, this.text()).then(
          () => this.registry.saved(this.id),
          console.error,
        );
      }
      sync?.leave();
    })();
  }

  /** Save what is pending, then write nothing more (`LiveDocuments.suspend`). */
  async end(): Promise<void> {
    await this.flush();
    await this.finishing;
    this.dead = true;
    clearTimeout(this.timer);
    this.sync?.leave();
    this.sync = null;
    this.registry.dispose(this);
  }

  /** Whether this Window has changes not yet sent to the other Windows (for tests). */
  get unsent(): boolean {
    return this.sync?.pending() ?? false;
  }
}

export function createLiveDocuments(
  engine: LiveEngine,
  opts: LiveOptions = {},
): LiveDocuments {
  const docs = new Map<string, LiveDocument>();
  const closers = new Map<LiveDocument, () => void>();
  const savedFns = new Set<(id: string) => void>();
  const registry = {
    transport: opts.sync,
    dispose(d: LiveDocument) {
      if (docs.get(d.id) === d) docs.delete(d.id);
      closers.get(d)?.();
      closers.delete(d);
    },
    revive(d: LiveDocument) {
      if (!docs.has(d.id)) docs.set(d.id, d);
      if (docs.get(d.id) === d && opts.onOpen && !closers.has(d)) closers.set(d, opts.onOpen(d));
    },
    saved(id: string) {
      for (const fn of [...savedFns]) fn(id);
    },
  };
  const get = (id: string) => {
    let d = docs.get(id);
    if (!d) {
      d = new LiveDocument(id, engine, opts.delay ?? 700, registry);
      docs.set(id, d);
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
    onSaved(fn) {
      savedFns.add(fn);
      return () => savedFns.delete(fn);
    },
    async suspend() {
      const all = [...docs.values()];
      docs.clear();
      await Promise.all(all.map((d) => d.end()));
    },
  };
}

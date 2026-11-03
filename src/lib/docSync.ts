// One document's text kept the same across Windows (spec #35, issue #51).
//
// The engine orders the Windows' changes (`engine::windows`): each Window
// sends a change made on the revision it last saw, one at a time. The engine
// takes it if no other change came first; if one did, it hands back what this
// Window missed, which is applied here with this Window's own unsent typing
// rebased over it (`transform`), and the change goes again. So every Window
// ends on the same text, with every keystroke from every Window in it.
//
// The classic client of operational transformation: `inflight` is the change
// sent and not yet taken, `buffer` the typing since, composed into one.
import { apply, compose, diff, transform, type Op } from "@/lib/textOp";

export interface SyncEntry {
  op: Op;
  /** The change brings the text to what the file now holds: it needs no saving. */
  disk: boolean;
}

export interface SyncReply {
  rev: number;
  ops: SyncEntry[];
  accepted: boolean;
  external: boolean;
}

export interface SyncRequest {
  id: string;
  /** Which live document of the Window asks: one may still be saving as it closes while the next opens. */
  client: number;
  base: number;
  op?: Op;
  disk?: string;
  force?: boolean;
}

/** The engine's side, as `src/lib/windows.ts` reaches it. */
export interface SyncTransport {
  join(id: string, client: number, text: string): Promise<{ rev: number; text: string }>;
  sync(req: SyncRequest): Promise<SyncReply>;
  leave(id: string, client: number): Promise<void>;
}

/** The live document a DocSync keeps in step. */
export interface SyncHost {
  /** The whole text as it stands here. */
  text(): string;
  /** Another Window's change, applied to `text()`: show `text`. */
  remote(text: string, disk: boolean): void;
}

/** A file read from disk, waiting to be sent, and who waits for the answer. */
interface PendingDisk {
  text: string;
  force: boolean;
  done: (r: { external: boolean }) => void;
}

let clients = 0;

export class DocSync {
  readonly client = ++clients;
  private rev = 0;
  /**
   * Where this Window is in the session: not asked yet, asking, in it, or
   * gone for good. One field, so it cannot be joining and closed at once.
   */
  private phase: "new" | "joining" | "joined" | "closed" = "new";
  private inflight: Op | null = null;
  private buffer: Op | null = null;
  private busy = false;
  /** Another Window changed the text: ask for it once the request in hand is answered. */
  private pull = false;
  private disks: PendingDisk[] = [];
  private idle: (() => void)[] = [];

  constructor(
    readonly id: string,
    private transport: SyncTransport,
    private host: SyncHost,
  ) {}

  /**
   * Join with the text as this Window read it. A Window already showing the
   * document may have typed more since its last save: its text is taken here
   * as a change, over any typing made here meanwhile.
   */
  async join(text: string): Promise<void> {
    if (this.phase !== "new") return;
    this.phase = "joining";
    let j: { rev: number; text: string };
    try {
      j = await this.transport.join(this.id, this.client, text);
    } catch (e) {
      // No session: this Window keeps and saves its own text, as without Windows.
      console.error(e);
      return this.leave();
    }
    if (this.left()) {
      // Left while the engine was taking the join: take it back.
      this.transport.leave(this.id, this.client).catch(console.error);
      return;
    }
    this.rev = j.rev;
    this.phase = "joined";
    const d = diff(text, j.text);
    if (d) this.applyRemote(d, false);
    this.kick();
  }

  /** Typing here: the text went from `before` to `after`. */
  local(before: string, after: string) {
    if (this.phase !== "joined" && this.phase !== "joining") return;
    const op = diff(before, after);
    if (!op) return;
    this.buffer = this.buffer ? compose(this.buffer, op) : op;
    this.kick();
  }

  /** Another Window changed the text. */
  poke() {
    this.pull = true;
    this.kick();
  }

  /**
   * The file changed on disk to `text`. Taken when everything the Windows
   * agreed on is saved (or `force`, a Reload), as a change, so typing not
   * sent yet survives; `external` when unsaved typing would be lost.
   */
  disk(text: string, force: boolean): Promise<{ external: boolean }> {
    if (this.phase !== "joined") return Promise.resolve({ external: false });
    return new Promise((done) => {
      this.disks.push({ text, force, done });
      this.kick();
    });
  }

  /** Resolves once every change made here has been taken by the engine (or could not be). */
  drain(): Promise<void> {
    if (this.settled()) return Promise.resolve();
    return new Promise((r) => this.idle.push(r));
  }

  /** Joined, and not left: changes go through the engine. */
  get active(): boolean {
    return this.phase === "joined";
  }

  /** Whether changes made here are still on their way. */
  pending(): boolean {
    return !this.settled();
  }

  leave() {
    if (this.phase === "closed") return;
    const joined = this.phase === "joined";
    this.phase = "closed";
    this.inflight = this.buffer = null;
    this.disks.splice(0).forEach((d) => d.done({ external: false }));
    this.settle();
    if (joined) this.transport.leave(this.id, this.client).catch(console.error);
  }

  // -------------------------------------------------------------------------

  /** Read through a call: TypeScript would keep the phase narrowed across an await. */
  private left() {
    return this.phase === "closed";
  }

  private settled() {
    return this.phase === "closed" || (!this.busy && !this.inflight && !this.buffer && this.disks.length === 0);
  }

  private settle() {
    if (!this.settled()) return;
    this.idle.splice(0).forEach((r) => r());
  }

  private applyRemote(op: Op, disk: boolean) {
    let r = op;
    if (this.inflight) [this.inflight, r] = transform(this.inflight, r);
    if (this.buffer) [this.buffer, r] = transform(this.buffer, r);
    this.host.remote(apply(r, this.host.text()), disk);
  }

  private take(reply: SyncReply) {
    for (const e of reply.ops) this.applyRemote(e.op, e.disk);
    if (reply.accepted) this.inflight = null;
    this.rev = reply.rev;
  }

  /** The next request to send: a file read from disk, then a change, then a pull; null when there is none. */
  private nextRequest(): SyncRequest | null {
    const base = { id: this.id, client: this.client, base: this.rev };
    const disk = this.disks[0];
    if (disk) return { ...base, disk: disk.text, force: disk.force };
    if (!this.inflight && this.buffer) [this.inflight, this.buffer] = [this.buffer, null];
    if (this.inflight) return { ...base, op: this.inflight };
    return this.pull ? base : null;
  }

  private kick() {
    if (this.phase !== "joined" || this.busy) return;
    const req = this.nextRequest();
    if (!req) return this.settle();
    const disk = req.disk === undefined ? undefined : this.disks.shift();
    this.pull = false;
    this.busy = true;
    this.transport.sync(req).then(
      (reply) => this.answered(reply, disk),
      (e) => this.refused(e, disk),
    );
  }

  private answered(reply: SyncReply, disk: PendingDisk | undefined) {
    this.busy = false;
    if (this.phase === "closed") return disk?.done({ external: false });
    this.take(reply);
    disk?.done({ external: reply.external });
    this.kick();
  }

  /**
   * The engine refused (a session ended with the Vault, or a change that does
   * not fit): stop rather than retry forever. This Window keeps and saves its
   * own text, as without Windows.
   */
  private refused(e: unknown, disk: PendingDisk | undefined) {
    console.error(e);
    this.busy = false;
    disk?.done({ external: false });
    this.leave();
  }
}

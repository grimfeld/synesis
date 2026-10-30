// A stand-in for the engine's Window sessions (`engine::windows`, where the
// same rules are tested in Rust), with the IPC between it and each Window
// made explicit: every request waits in `queue` until the test delivers it,
// in whatever order the test likes, as Tauri commands may land.
import { apply, diff, type Op } from "../textOp";
import type { SyncEntry, SyncReply, SyncRequest, SyncTransport } from "../docSync";

interface Session {
  text: string;
  log: SyncEntry[];
  members: Map<string, number>;
  saved: Set<string>;
  onDisk: string;
}

export class FakeEngine {
  sessions = new Map<string, Session>();
  /** Requests on their way, delivered by `step` or `run`. */
  queue: (() => void)[] = [];
  /** Who hears that a document changed: window → poke. */
  pokes = new Map<string, (id: string) => void>();

  transport(window: string): SyncTransport {
    const later = <T>(f: () => T): Promise<T> =>
      new Promise((res, rej) =>
        this.queue.push(() => {
          try {
            res(f());
          } catch (e) {
            rej(e);
          }
        }),
      );
    return {
      join: (id, client, text) => later(() => this.join(window, client, id, text)),
      sync: (req) => later(() => this.sync(window, req)),
      leave: (id, client) => later(() => void this.sessions.get(id)?.members.delete(`${window}/${client}`)),
    };
  }

  join(window: string, client: number, id: string, text: string) {
    let s = this.sessions.get(id);
    if (!s) {
      s = { text, log: [], members: new Map(), saved: new Set(), onDisk: text };
      this.sessions.set(id, s);
    }
    s.members.set(`${window}/${client}`, s.log.length);
    return { rev: s.log.length, text: s.text };
  }

  saved(id: string, text: string) {
    const s = this.sessions.get(id);
    if (!s) return;
    s.saved.add(text);
    s.onDisk = text;
  }

  sync(window: string, req: SyncRequest): SyncReply {
    const s = this.sessions.get(req.id);
    if (!s || !s.members.has(`${window}/${req.client}`)) throw new Error("not joined");
    const push = (op: Op, disk: boolean) => {
      s.text = apply(op, s.text);
      s.log.push({ op, disk });
    };
    let accepted = false;
    let external = false;
    let changed = false;
    if (req.op) {
      if (req.base === s.log.length) {
        push(req.op, false);
        accepted = changed = true;
      }
    } else if (req.disk !== undefined) {
      const own = s.saved.has(req.disk);
      if (req.force || (!own && s.onDisk === s.text)) {
        const op = diff(s.text, req.disk);
        if (op) {
          push(op, true);
          changed = true;
        }
        s.onDisk = req.disk;
      } else if (!own) external = true;
    }
    const ops = accepted ? [] : s.log.slice(req.base);
    s.members.set(`${window}/${req.client}`, s.log.length);
    if (changed)
      for (const [w, poke] of this.pokes) if (w !== window) this.queue.push(() => poke(req.id));
    return { rev: s.log.length, ops, accepted, external };
  }

  /** Deliver one waiting request, chosen by `pick`. */
  step(pick: () => number = () => 0) {
    const i = Math.floor(pick() * this.queue.length);
    const [f] = this.queue.splice(i, 1);
    f?.();
  }
}

/** Let promise callbacks run, without moving any clock. */
export const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** Deliver everything, in random order when given `r`, until nothing is on its way. */
export async function run(engine: FakeEngine, r?: () => number) {
  for (let i = 0; i < 10000; i++) {
    await settle();
    if (engine.queue.length === 0) return;
    engine.step(r);
  }
  throw new Error("the Windows never settled");
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, namesApi, type DetectedRange, type DocumentPayload } from "@/lib/api";
import { joinFrontmatter, splitFrontmatter } from "@/lib/frontmatter";
import { NameIndex } from "@/lib/names";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { Editor } from "@/editor/Editor";
import type { EditorEnv } from "@/editor/decorations";
import { HoverCard, type HoverState } from "@/components/HoverCard";
import { RightPanel } from "@/components/RightPanel";
import { TypeDot } from "@/components/DocLink";

export function DocView({ id }: { id: string }) {
  const s = useStore();
  const t = useT();
  const [doc, setDoc] = useState<DocumentPayload | null>(null);
  const [fm, setFm] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [external, setExternal] = useState(false);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [names, setNames] = useState(() => new NameIndex());
  const [detected, setDetected] = useState<DetectedRange[]>([]);
  const dirty = useRef(false);
  const latest = useRef({ fm: "", body: "" });
  const saveTimer = useRef<number | undefined>(undefined);
  const saving = useRef(false);

  const load = useCallback(async () => {
    const d = await api.getDocument(id);
    const sp = splitFrontmatter(d.text);
    setDoc(d);
    setFm(sp.fm);
    setBody(sp.body);
    latest.current = sp;
    dirty.current = false;
    setExternal(false);
  }, [id]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  useEffect(() => {
    namesApi.names().then((n) => setNames(new NameIndex(n))).catch(console.error);
  }, [s.changeTick, s.docs]);

  const save = useCallback(async () => {
    if (!dirty.current || saving.current) return;
    saving.current = true;
    setStatus("saving");
    const text = joinFrontmatter(latest.current.fm, latest.current.body);
    try {
      const d = await api.saveDocument(id, text);
      dirty.current = joinFrontmatter(latest.current.fm, latest.current.body) !== text;
      setDoc(d);
      const sp = splitFrontmatter(d.text);
      if (sp.fm !== latest.current.fm && !dirty.current) {
        latest.current.fm = sp.fm;
        setFm(sp.fm);
      }
      setStatus("saved");
      s.refresh().catch(console.error);
    } catch (e) {
      console.error(e);
      setStatus("error");
    } finally {
      saving.current = false;
      if (dirty.current) schedule();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const schedule = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => save(), 700);
  }, [save]);

  // Flush on unmount.
  useEffect(() => {
    return () => {
      window.clearTimeout(saveTimer.current);
      if (dirty.current) api.saveDocument(id, joinFrontmatter(latest.current.fm, latest.current.body)).catch(console.error);
    };
  }, [id]);

  const onBodyChange = useCallback(
    (text: string) => {
      latest.current.body = text;
      dirty.current = true;
      schedule();
    },
    [schedule],
  );

  const onFmChange = useCallback(
    (newFm: string) => {
      latest.current.fm = newFm;
      setFm(newFm);
      dirty.current = true;
      schedule();
    },
    [schedule],
  );

  // External edits to this file.
  useEffect(() => {
    const ch = s.lastChange;
    if (!ch || !doc) return;
    const mine = ch.changed.find((d) => d.id === id);
    if (!mine || mine.mtime === doc.summary.mtime) return;
    if (dirty.current || saving.current) setExternal(true);
    else load().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.lastChange]);

  const env = useMemo<EditorEnv>(
    () => ({
      names,
      onOpenLink: (target) => s.openLink(target),
      onOpenPassage: (p) => s.openPassage(p),
      onPassageHover: (i) => setHover(i ? { kind: "passage", passages: i.p, x: i.x, y: i.y } : null),
      onLinkHover: (i) => setHover(i ? { kind: "link", target: i.target, x: i.x, y: i.y } : null),
      embedText: async (target) => {
        const d = await api.resolveLink(target);
        if (!d) return null;
        const full = await api.getDocument(d.id);
        return { title: d.title, body: splitFrontmatter(full.text).body };
      },
    }),
    [names, s],
  );

  if (!doc) return <div className="muted p-6">…</div>;
  const sum = doc.summary;
  const isScripture = sum.type === "book" || sum.type === "chapter" || sum.type === "verse";
  const book = sum.book ? s.books.find((b) => b.number === sum.book) : undefined;
  const scriptureTitle = book ? (sum.type === "book" ? book.name : sum.type === "chapter" ? `${book.name} ${sum.chapter}` : `${book.name} ${sum.chapter}:${sum.verse}`) : sum.title;

  const neighbours = (() => {
    if (!book || !sum.chapter) return null;
    if (sum.type === "verse" && sum.verse) {
      const max = book.chapters[sum.chapter - 1];
      return {
        prev: sum.verse > 1 ? () => s.openScripture(book.number, sum.chapter!, sum.verse! - 1) : undefined,
        next: sum.verse < max ? () => s.openScripture(book.number, sum.chapter!, sum.verse! + 1) : undefined,
        up: () => s.openScripture(book.number, sum.chapter!),
      };
    }
    if (sum.type === "chapter") {
      return {
        prev: sum.chapter > 1 ? () => s.openScripture(book.number, sum.chapter! - 1) : undefined,
        next: sum.chapter < book.chapters.length ? () => s.openScripture(book.number, sum.chapter! + 1) : undefined,
        up: () => s.openScripture(book.number),
      };
    }
    return null;
  })();

  return (
    <div className="flex h-full min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
          {!s.sidebarOpen && (
            <button className="btn btn-ghost btn-sm" onClick={() => s.setSidebarOpen(true)} title="Sidebar">
              ☰
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={s.back} title="Back">
            ←
          </button>
          <TypeDot type={sum.type} />
          <button className="min-w-0 flex-1 truncate text-left text-base font-semibold" onClick={() => !isScripture && s.setDialog({ kind: "rename", id })} title={sum.path}>
            {scriptureTitle}
          </button>
          {neighbours && (
            <div className="flex gap-1">
              <button className="btn btn-ghost btn-sm" onClick={neighbours.up} title="Up">
                ↑
              </button>
              <button className="btn btn-ghost btn-sm" disabled={!neighbours.prev} onClick={neighbours.prev}>
                ‹
              </button>
              <button className="btn btn-ghost btn-sm" disabled={!neighbours.next} onClick={neighbours.next}>
                ›
              </button>
            </div>
          )}
          <span className="muted text-xs">{status === "saving" ? t.saving : status === "saved" ? t.saved : status === "error" ? "⚠" : ""}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => s.setPanelOpen(!s.panelOpen)} title={t.backlinks}>
            ▤
          </button>
          <button className="btn btn-ghost btn-sm btn-danger" onClick={() => s.setDialog({ kind: "delete", id })} title={t.delete}>
            🗑
          </button>
        </header>
        {external && (
          <div className="flex items-center gap-3 px-4 py-2 text-sm" style={{ background: "var(--accent-soft)" }}>
            <span>{t.external_change}</span>
            <button className="btn btn-sm" onClick={() => load()}>
              {t.reload}
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1">
          <Editor value={body} onChange={onBodyChange} onDetected={setDetected} env={env} names={names} tags={s.tags} placeholder={t.empty_doc} autofocus={!isScripture} />
        </div>
      </div>
      {s.panelOpen && <RightPanel doc={doc} fm={fm} onFmChange={onFmChange} detected={detected} />}
      {hover && <HoverCard state={hover} excludeId={id} onClose={() => setHover(null)} />}
    </div>
  );
}

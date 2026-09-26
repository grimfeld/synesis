// Loading, debounced saving, renaming and external-change handling for one
// document. Shared by the Writing page (DocView) and the Hub page (HubView).
import { useCallback, useEffect, useRef, useState } from "react";
import { api, namesApi, type DocumentPayload } from "@/lib/api";
import { joinFrontmatter, splitFrontmatter } from "@/lib/frontmatter";
import { NameIndex } from "@/lib/names";
import { useStore } from "@/lib/store";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export function useDocument(id: string) {
  const s = useStore();
  const [doc, setDoc] = useState<DocumentPayload | null>(null);
  const [fm, setFm] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [external, setExternal] = useState(false);
  /** Bumped when the text is replaced wholesale (load, restore), so the editor resyncs even to an equal body. */
  const [revision, setRevision] = useState(0);
  const [names, setNames] = useState(() => new NameIndex());
  const dirty = useRef(false);
  const latest = useRef({ fm: "", body: "" });
  const saveTimer = useRef<number | undefined>(undefined);
  const saving = useRef(false);
  /** The text as this page last read or wrote it, to tell an echo of its own save from an edit made elsewhere. */
  const known = useRef<string | null>(null);

  /** Show `d` as the document, replacing the text in the editor. */
  const apply = useCallback((d: DocumentPayload) => {
    known.current = d.text;
    const sp = splitFrontmatter(d.text);
    setDoc(d);
    setFm(sp.fm);
    setBody(sp.body);
    setRevision((r) => r + 1);
    latest.current = sp;
    dirty.current = false;
    setExternal(false);
  }, []);

  const load = useCallback(async () => {
    apply(await api.getDocument(id));
  }, [id, apply]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  useEffect(() => {
    namesApi
      .names()
      .then((n) => setNames(new NameIndex(n)))
      .catch(console.error);
  }, [s.changeTick, s.docs]);

  const save = useCallback(async () => {
    if (!dirty.current || saving.current) return;
    saving.current = true;
    setStatus("saving");
    const text = joinFrontmatter(latest.current.fm, latest.current.body);
    try {
      const d = await api.saveDocument(id, text);
      known.current = d.text;
      dirty.current =
        joinFrontmatter(latest.current.fm, latest.current.body) !== text;
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
      if (dirty.current)
        api
          .saveDocument(
            id,
            joinFrontmatter(latest.current.fm, latest.current.body),
          )
          .catch(console.error);
    };
  }, [id]);

  const onBodyChange = useCallback(
    (text: string) => {
      latest.current.body = text;
      // State as well as the ref: panels read the text through `body`, so
      // keeping it only in the ref left them looking at the document as it was
      // loaded. The editor is uncontrolled — its resync effect early-returns
      // when the text already matches — so this costs a React render, not a
      // CodeMirror dispatch.
      setBody(text);
      dirty.current = true;
      schedule();
    },
    [schedule],
  );

  /**
   * A write that came from outside the editor (linking a Linkable).
   *
   * The editor only resyncs on a `revision` bump, so a panel that rewrites the
   * body has to ask for one; typing must not, or every keystroke would
   * round-trip through CodeMirror.
   */
  const setBodyText = useCallback(
    (text: string) => {
      onBodyChange(text);
      setRevision((r) => r + 1);
    },
    [onBodyChange],
  );

  /** Frontmatter edits (type, tags, properties) are visible at once, so they save now. */
  const onFmChange = useCallback(
    (newFm: string) => {
      latest.current.fm = newFm;
      setFm(newFm);
      dirty.current = true;
      window.clearTimeout(saveTimer.current);
      save();
    },
    [save],
  );

  /** Replace the whole text (a restored Version) and save at once. */
  const replaceText = useCallback(
    (text: string) => {
      const sp = splitFrontmatter(text);
      latest.current = { fm: sp.fm, body: sp.body };
      setFm(sp.fm);
      setBody(sp.body);
      setRevision((r) => r + 1);
      dirty.current = true;
      window.clearTimeout(saveTimer.current);
      save();
    },
    [save],
  );

  /** Save now if anything is pending (before naming a Version). */
  const flush = useCallback(async () => {
    if (!dirty.current) return;
    window.clearTimeout(saveTimer.current);
    await save();
  }, [save]);

  const rename = useCallback(
    async (title: string) => {
      if (dirty.current) {
        window.clearTimeout(saveTimer.current);
        await save();
      }
      await api.renameDocument(id, title);
      await s.refresh();
      await load();
    },
    [id, load, s, save],
  );

  // External edits to this file. The mtime alone cannot tell: the watcher
  // also reports this page's own saves, and on Android it can do so while the
  // next save is in flight or with an mtime the save did not return. Reloading
  // then threw away what was typed since and put the caret at the start, so
  // the text on disk decides.
  useEffect(() => {
    const ch = s.lastChange;
    if (!ch || !doc) return;
    const mine = ch.changed.find((d) => d.id === id);
    if (!mine || mine.mtime === doc.summary.mtime) return;
    let stale = false;
    api
      .getDocument(id)
      .then((d) => {
        if (stale) return;
        const current = joinFrontmatter(latest.current.fm, latest.current.body);
        if (d.text === known.current || d.text === current) {
          // Our own save, or already what the page shows.
          if (!saving.current) setDoc(d);
          return;
        }
        // Checked now rather than before the read, so a keystroke made
        // while it was on its way is never overwritten.
        if (dirty.current || saving.current) setExternal(true);
        else apply(d);
      })
      .catch(console.error);
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.lastChange]);

  return {
    doc,
    fm,
    body,
    revision,
    status,
    external,
    names,
    load,
    onBodyChange,
    setBodyText,
    onFmChange,
    rename,
    replaceText,
    flush,
  };
}

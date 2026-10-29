// Loading, debounced saving, renaming and external-change handling for one
// document. Shared by the Writing page (DocView), the Hub page (HubView) and
// the Delivery view.
//
// The text itself lives in one LiveDocument per id (`liveDocument.ts`), shared
// by every Pane showing that document, so two Panes on the same Note show the
// same text and never save over each other (issue #50). Edits are relayed to
// other Windows showing the document through the engine (issue #51).
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api, namesApi } from "@/lib/api";
import { NameIndex } from "@/lib/names";
import { useStore } from "@/lib/store";
import { registerFlush } from "@/lib/pending";
import { engineWindowSync, onEditedElsewhere } from "@/lib/windows";
import {
  createLiveDocuments,
  type LiveBody,
  type LiveDocument,
} from "@/lib/liveDocument";

export type { SaveStatus } from "@/lib/liveDocument";

/** What this Window tells the other Windows through the engine (#51); null without Windows. */
const windows = engineWindowSync();

/** This Window's live documents. */
const live = createLiveDocuments(api, {
  onOpen: (d) => {
    // A Command that reads this file from disk (Duplicate as new Composition)
    // flushes it first, so it never copies the text minus the last few words.
    const unflush = registerFlush(`doc:${d.id}`, d.flush);
    const close = windows?.opened(d.id);
    return () => {
      unflush();
      close?.();
    };
  },
  onEdit: windows ? (id, text) => windows.edited(id, text) : undefined,
});

// An edit made in another Window to a document this one shows.
if (windows)
  onEditedElsewhere((id, text) => live.peek(id)?.receive(text)).catch(console.error);

/**
 * The live document for `id`, held while mounted. Looked up during render, so
 * the first paint already shows the text another Pane has; retained in an
 * effect, so a render React throws away holds nothing.
 */
function useLive(id: string): LiveDocument {
  const d = live.get(id);
  useEffect(() => {
    d.retain();
    return d.release;
  }, [d]);
  return d;
}

export function useDocument(id: string) {
  const s = useStore();
  const d = useLive(id);
  const snap = useSyncExternalStore(d.subscribe, d.snapshot);
  const [names, setNames] = useState(() => new NameIndex());

  useEffect(() => {
    d.load({ once: true }).catch(console.error);
  }, [d]);

  useEffect(() => {
    d.onSaved = () => void s.refresh().catch(console.error);
  }, [d, s]);

  useEffect(() => {
    namesApi
      .names()
      .then((n) => setNames(new NameIndex(n)))
      .catch(console.error);
  }, [s.changeTick, s.docs]);

  const load = useCallback(() => d.load(), [d]);

  const rename = useCallback(
    async (title: string) => {
      await d.flush();
      await api.renameDocument(id, title);
      await s.refresh();
      await d.load();
    },
    [id, d, s],
  );

  // External edits to this file (the watcher).
  useEffect(() => {
    if (s.lastChange) d.noticeChange(s.lastChange.changed);
  }, [s.lastChange, d]);

  return {
    doc: snap.doc,
    fm: snap.fm,
    body: snap.body,
    revision: snap.revision,
    status: snap.status,
    external: snap.external,
    names,
    /** The live text, for an editor to join so it sees other Panes' typing. */
    live: d as LiveBody,
    load,
    /** Typing from an editor that has not joined `live`. */
    onBodyChange: d.write,
    /** A write from outside the editor (linking a Linkable): editors resync. */
    setBodyText: d.setBodyText,
    onFmChange: d.editFm,
    rename,
    replaceText: d.replaceText,
    flush: d.flush,
  };
}

// This Window's live documents (`liveDocument.ts`): one per id, shared by
// every Pane, kept the same as the other Windows' through the engine (#51).
import { api } from "@/lib/api";
import { flushPending, registerFlush } from "@/lib/pending";
import { createLiveDocuments } from "@/lib/liveDocument";
import { engineSyncTransport, guardWindowClose, onChangedElsewhere } from "@/lib/windows";

const transport = engineSyncTransport();

export const live = createLiveDocuments(api, {
  // A Command that reads this file from disk (Duplicate as new Composition)
  // flushes it first, so it never copies the text minus the last few words.
  onOpen: (d) => registerFlush(`doc:${d.id}`, d.flush),
  sync: transport ?? undefined,
});

if (transport) {
  onChangedElsewhere((id) => live.peek(id)?.poke());
  guardWindowClose(flushPending);
}

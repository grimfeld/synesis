// The vault's names (titles and aliases), for `[[` autocomplete and link
// decorations, refetched as the vault changes. Shared by every editor: a
// document's (useDocument) and a capture box's (useEditorEnv).
import { useEffect, useState } from "react";
import { namesApi } from "@/lib/api";
import { deliverLatest } from "@/lib/latest";
import { NameIndex } from "@/lib/names";
import { useStore } from "@/lib/store";

export function useNames(): NameIndex {
  const s = useStore();
  const [names, setNames] = useState(() => new NameIndex());
  useEffect(
    () => deliverLatest(namesApi.names(), (n) => setNames(new NameIndex(n))),
    [s.changeTick, s.docs],
  );
  return names;
}

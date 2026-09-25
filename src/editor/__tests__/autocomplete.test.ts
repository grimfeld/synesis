// Link and Tag completion narrows as the user types. Both sources rank their
// own options (`filter: false`), so CodeMirror must ask them again on every
// keystroke: with a `validFor` it kept the list computed for the empty query,
// and typing after `[[` or Insert embed never found anything outside it.
import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { currentCompletions, startCompletion } from "@codemirror/autocomplete";
import { NameIndex } from "@/lib/names";
import type { DocType } from "@/lib/api";
import { makeAutocomplete } from "../autocomplete";

// More names than the list shows (14), with the one searched for sorting last.
const names = new NameIndex([
  ...Array.from({ length: 20 }, (_, i) => ({ name: `Aaron ${String(i).padStart(2, "0")}`, type: "note" as DocType, alias: false, id: `a${i}` })),
  { name: "Gethsemane", type: "place" as DocType, alias: false, id: "g" },
] as never);
const tags = [...Array.from({ length: 20 }, (_, i) => ({ tag: `aaa${i}`, count: 1 })), { tag: "prayer", count: 3 }];

let view: EditorView | null = null;
afterEach(() => view?.destroy());

const settle = () => new Promise((r) => setTimeout(r, 250));

/** Type one character at a time, the way a person does, letting completion catch up. */
async function type(text: string) {
  for (const ch of text) {
    const at = view!.state.selection.main.head;
    view!.dispatch({ changes: { from: at, insert: ch }, selection: { anchor: at + 1 }, userEvent: "input.type" });
    await settle();
  }
}

async function open(prefix: string) {
  view = new EditorView({
    state: EditorState.create({ doc: prefix, selection: { anchor: prefix.length }, extensions: [makeAutocomplete(() => names, () => tags)] }),
    parent: document.body,
  });
  startCompletion(view);
  await settle();
}

describe("completion", () => {
  it("narrows a link list as the name is typed", async () => {
    await open("See [[");
    expect(currentCompletions(view!.state).map((c) => c.label)).not.toContain("Gethsemane");
    await type("geth");
    expect(currentCompletions(view!.state).map((c) => c.label)).toEqual(["Gethsemane"]);
  });

  it("narrows an embed list the same way", async () => {
    await open("![[");
    await type("geth");
    expect(currentCompletions(view!.state).map((c) => c.label)).toEqual(["Gethsemane"]);
  });

  it("narrows a Tag list as the Tag is typed", async () => {
    await open("See #");
    expect(currentCompletions(view!.state).map((c) => c.label)).not.toContain("prayer");
    await type("pray");
    expect(currentCompletions(view!.state).map((c) => c.label)).toEqual(["prayer"]);
  });
});

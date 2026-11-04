// Where code sits, from the Markdown syntax tree: a fence opened above the
// part being looked at is still a fence, and `~~~` fences and indented code
// count as much as backtick ones (issue #76).
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

const CODE = new Set(["FencedCode", "CodeBlock", "InlineCode"]);

/** Code ranges overlapping `from`–`to`, in document coordinates. */
export function codeZones(state: EditorState, from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter: (n) => {
      if (!CODE.has(n.name)) return;
      out.push([n.from, n.to]);
      return false;
    },
  });
  return out;
}

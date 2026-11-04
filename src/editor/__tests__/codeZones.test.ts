// Code zones come from the syntax tree, so a fence opened above the range
// looked at still hides links inside it, and prose after it does not (#76).
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { codeZones } from "../codeZones";

function state(doc: string) {
  const s = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  ensureSyntaxTree(s, s.doc.length, 5000);
  return s;
}
const inside = (z: [number, number][], at: number) => z.some(([a, b]) => at >= a && at < b);

describe("codeZones", () => {
  it("sees a fence opened before the range", () => {
    const doc = "```\nline\n[[Inside]]\n```\n\n[[Outside]]\n";
    const s = state(doc);
    const from = doc.indexOf("[[Inside]]");
    const z = codeZones(s, from, doc.length);
    expect(inside(z, from)).toBe(true);
    expect(inside(z, doc.indexOf("[[Outside]]"))).toBe(false);
  });

  it("knows tilde fences, indented code and inline code", () => {
    const doc = "Text\n\n~~~\n#tilde\n~~~\n\n    #indented\n\nSee `#inline` and #tag\n";
    const z = codeZones(state(doc), 0, doc.length);
    expect(inside(z, doc.indexOf("#tilde"))).toBe(true);
    expect(inside(z, doc.indexOf("#indented"))).toBe(true);
    expect(inside(z, doc.indexOf("#inline"))).toBe(true);
    expect(inside(z, doc.indexOf("#tag"))).toBe(false);
  });

  it("does not treat an unclosed backtick as code", () => {
    const doc = "a ` b [[Link]]\n";
    const z = codeZones(state(doc), 0, doc.length);
    expect(inside(z, doc.indexOf("[[Link]]"))).toBe(false);
  });
});

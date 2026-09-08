import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

export const markdownHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.heading1, class: "cm-md-h1" },
    { tag: t.heading2, class: "cm-md-h2" },
    { tag: t.heading3, class: "cm-md-h3" },
    { tag: t.heading4, class: "cm-md-h4" },
    { tag: t.heading5, class: "cm-md-h5" },
    { tag: t.heading6, class: "cm-md-h6" },
    { tag: t.strong, class: "cm-md-strong" },
    { tag: t.emphasis, class: "cm-md-em" },
    { tag: t.quote, class: "cm-md-quote" },
    { tag: t.monospace, class: "cm-md-code" },
    { tag: t.url, class: "cm-md-url" },
    { tag: t.link, class: "cm-md-url" },
    { tag: t.processingInstruction, class: "cm-md-mark" },
    { tag: t.meta, class: "cm-md-mark" },
    { tag: t.contentSeparator, class: "cm-md-hr" },
    { tag: t.list, class: "cm-md-list" },
  ]),
);

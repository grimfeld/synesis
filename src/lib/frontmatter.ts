// Minimal, line-preserving YAML frontmatter editing. Only touches the line of
// the key being changed; everything else stays byte-for-byte (ADR 0003).

export interface Split {
  fm: string; // raw frontmatter including fences, "" if none
  body: string;
}

export function splitFrontmatter(text: string): Split {
  const m = /^(?:﻿)?---\r?\n([\s\S]*?)(?:\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m || !text.startsWith(m[0])) return { fm: "", body: text };
  return { fm: m[0], body: text.slice(m[0].length) };
}

export function joinFrontmatter(fm: string, body: string): string {
  return fm + body;
}

export function yamlScalar(v: string): string {
  const needs =
    v === "" ||
    /[:#\[\]{},&*!|>'"%@`]/.test(v) ||
    /^[-?\s]/.test(v) ||
    /\s$/.test(v) ||
    /^(true|false|null|yes|no|~)$/i.test(v) ||
    (!isNaN(Number(v)) && v.trim() !== "");
  return needs ? `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : v;
}

function keyRegex(key: string): RegExp {
  return new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`, "m");
}

/** Lines of the frontmatter block without the fences. */
function fmLines(fm: string): string[] {
  const lines = fm.split(/\r?\n/);
  // drop leading '---' and trailing fence + trailing empty
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (lines[0]?.replace(/^﻿/, "") === "---") lines.shift();
  if (lines.length && (lines[lines.length - 1] === "---" || lines[lines.length - 1] === "...")) lines.pop();
  return lines;
}

function buildFm(lines: string[]): string {
  return lines.length ? `---\n${lines.join("\n")}\n---\n` : "";
}

/** Replace or add a scalar / flow-list value for `key`. `value` is raw (unquoted). */
export function setField(fm: string, key: string, value: string | string[] | null): string {
  const lines = fmLines(fm);
  const re = keyRegex(key);
  const idx = lines.findIndex((l) => re.test(l));
  const rendered = value === null ? null : Array.isArray(value) ? `${key}: [${value.map(yamlScalar).join(", ")}]` : `${key}: ${yamlScalar(value)}`;
  if (idx >= 0) {
    // Remove continuation lines (block lists / nested maps) under this key.
    let end = idx + 1;
    while (end < lines.length && /^(\s+\S|\s*-\s)/.test(lines[end])) end++;
    if (rendered === null) lines.splice(idx, end - idx);
    else lines.splice(idx, end - idx, rendered);
  } else if (rendered !== null) {
    lines.push(rendered);
  }
  return buildFm(lines);
}

export function removeField(fm: string, key: string): string {
  return setField(fm, key, null);
}

// Minimal, line-preserving YAML frontmatter editing. Only touches the line of
// the key being changed; everything else stays byte-for-byte (ADR 0003).

export interface Split {
  fm: string; // raw frontmatter including fences, "" if none
  body: string;
}

export function splitFrontmatter(text: string): Split {
  const m =
    /^(?:﻿)?---\r?\n([\s\S]*?)(?:\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(
      text,
    );
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
  if (
    lines.length &&
    (lines[lines.length - 1] === "---" || lines[lines.length - 1] === "...")
  )
    lines.pop();
  return lines;
}

function buildFm(lines: string[]): string {
  return lines.length ? `---\n${lines.join("\n")}\n---\n` : "";
}

/**
 * Replace or add a value for `key`. A string is written as a YAML scalar
 * (quoted when needed), a string array as a flow list, a number or boolean
 * bare (so `lat: 37.9` stays a number and `done: true` a boolean).
 */
export function setField(
  fm: string,
  key: string,
  value: string | string[] | number | boolean | null,
): string {
  const lines = fmLines(fm);
  const re = keyRegex(key);
  const idx = lines.findIndex((l) => re.test(l));
  const rendered =
    value === null
      ? null
      : Array.isArray(value)
        ? `${key}: [${value.map(yamlScalar).join(", ")}]`
        : typeof value === "number" || typeof value === "boolean"
          ? `${key}: ${String(value)}`
          : `${key}: ${yamlScalar(value)}`;
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

/** `"a \"b\""` → `a "b"`, `'it''s'` → `it's`, `bare # note` → `bare`; `undefined` for a nested list or map. */
function readScalar(raw: string): string | null | undefined {
  const v = raw.trim();
  if (v.startsWith('"')) {
    const m = /^"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/.exec(v);
    return m ? m[1].replace(/\\(.)/g, "$1") : undefined;
  }
  if (v.startsWith("'")) {
    const m = /^'((?:[^']|'')*)'\s*(?:#.*)?$/.exec(v);
    return m ? m[1].replace(/''/g, "'") : undefined;
  }
  if (/^[[{]/.test(v)) return undefined;
  const bare = v.replace(/(^|\s+)#.*$/, "").trim();
  return bare === "" || bare === "~" || bare === "null" ? null : bare;
}

/** The items of a flow list's inside (`"[[Leah]]", Rachel`); `undefined` when one is not a scalar. */
function readFlowItems(inner: string): string[] | undefined {
  const out: string[] = [];
  let i = 0;
  const n = inner.length;
  while (i < n) {
    while (i < n && /\s/.test(inner[i])) i++;
    if (i >= n) break;
    let item: string;
    const q = inner[i];
    if (q === '"' || q === "'") {
      let j = i + 1;
      while (j < n) {
        if (q === '"' && inner[j] === "\\") j += 2;
        else if (inner[j] === q && q === "'" && inner[j + 1] === "'") j += 2;
        else if (inner[j] === q) break;
        else j++;
      }
      if (j >= n) return undefined;
      item = inner.slice(i, j + 1);
      i = j + 1;
    } else {
      const j = inner.indexOf(",", i);
      item = inner.slice(i, j < 0 ? n : j);
      i = j < 0 ? n : j;
    }
    const v = readScalar(item);
    if (v === undefined) return undefined;
    if (v !== null) out.push(v);
    while (i < n && /\s/.test(inner[i])) i++;
    if (i < n && inner[i] !== ",") return undefined;
    i++;
  }
  return out;
}

/**
 * `key`'s value as written in `fm`, for reading back what `setField` wrote: a
 * scalar as a string, a flow (`[a, "b"]`) or block (`- a`) list of scalars as
 * strings, `null` when absent or empty. `undefined` for any other form (a
 * map, a nested list), which the caller then reads from the parsed front
 * matter instead.
 */
export function readField(fm: string, key: string): string | string[] | null | undefined {
  const lines = fmLines(fm);
  const re = keyRegex(key);
  const idx = lines.findIndex((l) => re.test(l));
  if (idx < 0) return null;
  const rest = lines[idx].slice(lines[idx].indexOf(":") + 1).trim();
  if (rest === "" || rest.startsWith("#")) {
    const items: string[] = [];
    for (let i = idx + 1; i < lines.length && /^(\s+\S|\s*-\s)/.test(lines[i]); i++) {
      const m = /^\s*-\s+(.*)$/.exec(lines[i]);
      if (!m) return undefined;
      const v = readScalar(m[1]);
      if (v === undefined) return undefined;
      if (v !== null) items.push(v);
    }
    return items.length ? items : null;
  }
  if (rest.startsWith("[")) {
    const m = /^\[(.*)\]\s*(?:#.*)?$/.exec(rest);
    return m ? readFlowItems(m[1]) : undefined;
  }
  return readScalar(rest);
}

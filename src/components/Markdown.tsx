// A small markdown renderer for bundled help text (tutorials). Headings,
// paragraphs, ordered and bulleted lists, fenced code, bold/italic/code
// spans and links (opened in the system browser). Not for vault content.
import { Fragment, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "cn";

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = key;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<strong key={i++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={i++} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("*")) out.push(<em key={i++}>{tok.slice(1, -1)}</em>);
    else {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      const href = lm[2];
      out.push(
        <a
          key={i++}
          href={href}
          className="text-link underline underline-offset-2"
          onClick={(e) => {
            e.preventDefault();
            openUrl(href).catch(() => window.open(href, "_blank"));
          }}
        >
          {lm[1]}
        </a>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block = { kind: "h"; level: number; text: string } | { kind: "p"; text: string } | { kind: "ul" | "ol"; items: string[] } | { kind: "code"; text: string } | { kind: "quote"; text: string };

function parse(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      blocks.push({ kind: "code", text: buf.join("\n") });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ kind: "h", level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/).test(lines[i])) {
        let item = lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/, "");
        i++;
        // Continuation lines indented under the item.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+[.)])\s+/.test(lines[i])) item += " " + lines[i++].trim();
        items.push(item);
      }
      blocks.push({ kind: ordered ? "ol" : "ul", items });
      continue;
    }
    if (line.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) buf.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ kind: "quote", text: buf.join(" ") });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\s*[-*]\s+|\s*\d+[.)]\s+)/.test(lines[i])) buf.push(lines[i++]);
    blocks.push({ kind: "p", text: buf.join(" ") });
  }
  return blocks;
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parse(source);
  return (
    <div className={cn("text-sm leading-relaxed [&>*+*]:mt-3", className)}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h": {
            const Tag = (`h${Math.min(6, b.level + 1)}`) as "h2" | "h3" | "h4" | "h5" | "h6";
            return (
              <Tag key={i} className={cn("font-semibold", b.level === 1 ? "text-lg" : b.level === 2 ? "mt-5! text-base" : "text-sm")}>
                {inline(b.text)}
              </Tag>
            );
          }
          case "p":
            return <p key={i}>{inline(b.text)}</p>;
          case "quote":
            return (
              <blockquote key={i} className="border-l-2 pl-3 text-muted-foreground">
                {inline(b.text)}
              </blockquote>
            );
          case "code":
            return (
              <pre key={i} className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
                {b.text}
              </pre>
            );
          case "ul":
          case "ol": {
            const List = b.kind;
            return (
              <List key={i} className={cn("space-y-1.5 pl-5", b.kind === "ol" ? "list-decimal" : "list-disc")}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Fragment>{inline(it)}</Fragment>
                  </li>
                ))}
              </List>
            );
          }
        }
      })}
    </div>
  );
}

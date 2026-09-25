// A small markdown renderer for bundled help text (Tutorials). Headings,
// paragraphs, ordered and bulleted lists (nested by indentation), fenced code,
// bold/italic/code spans, links (opened in the system browser) and pictures.
// Not for vault content.
//
// A caller may take over links and pictures by scheme: Tutorials render
// `command:` links as buttons that run the Command and `image:` pictures from
// the chosen image mode (PLAN §24.9, §24.12).
import { createContext, useContext, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "cn";

export interface MarkdownRenderers {
  /** Return null to fall back to an ordinary link. */
  link?: (text: string, href: string, key: number) => ReactNode | null;
  /** Return null to show nothing. */
  image?: (alt: string, src: string, key: number) => ReactNode | null;
}

const Renderers = createContext<MarkdownRenderers>({});

function Inline({ text }: { text: string }) {
  const r = useContext(Renderers);
  const out: ReactNode[] = [];
  const re = /(!\[[^\]]*\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("![")) {
      const im = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(tok)!;
      const key = i++;
      out.push(r.image ? r.image(im[1], im[2], key) : <img key={key} src={im[2]} alt={im[1]} className="max-w-full rounded-md border" />);
    } else if (tok.startsWith("**")) out.push(<strong key={i++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={i++} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("*")) out.push(<em key={i++}>{tok.slice(1, -1)}</em>);
    else {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      const href = lm[2];
      const key = i++;
      const custom = r.link?.(lm[1], href, key);
      out.push(
        custom ?? (
          <a
            key={key}
            href={href}
            className="text-link underline underline-offset-2"
            onClick={(e) => {
              e.preventDefault();
              openUrl(href).catch(() => window.open(href, "_blank"));
            }}
          >
            {lm[1]}
          </a>
        ),
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "code"; text: string }
  | { kind: "quote"; text: string };

const BULLET = /^[-*]\s+/;
const NUMBER = /^\d+[.)]\s+/;

/** Undo the smallest indentation of the non-blank lines. */
function dedent(lines: string[]): string[] {
  const cut = Math.min(...lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length), Infinity);
  return lines.map((l) => l.slice(Number.isFinite(cut) ? cut : 0));
}

export function parse(src: string): Block[] {
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
    if (BULLET.test(line) || NUMBER.test(line)) {
      const marker = NUMBER.test(line) ? NUMBER : BULLET;
      const items: string[] = [];
      while (i < lines.length && marker.test(lines[i])) {
        const item = [lines[i].replace(marker, "")];
        i++;
        // The item runs on through indented lines, and through blank lines
        // that an indented line follows: sub-lists and continuation text.
        while (i < lines.length) {
          if (/^\s{2,}\S/.test(lines[i])) {
            item.push(lines[i++]);
            continue;
          }
          if (!lines[i].trim()) {
            let j = i;
            while (j < lines.length && !lines[j].trim()) j++;
            if (j < lines.length && /^\s{2,}\S/.test(lines[j])) {
              item.push(...lines.slice(i, j));
              i = j;
              continue;
            }
          }
          break;
        }
        const [first, ...more] = item;
        items.push([first, ...dedent(more)].join("\n"));
        // Blank lines between items of one list do not end it.
        let j = i;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length && marker.test(lines[j])) i = j;
      }
      blocks.push({ kind: marker === NUMBER ? "ol" : "ul", items });
      continue;
    }
    if (line.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) buf.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ kind: "quote", text: buf.join(" ") });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|[-*]\s+|\d+[.)]\s+)/.test(lines[i])) buf.push(lines[i++].trim());
    blocks.push({ kind: "p", text: buf.join(" ") });
  }
  return blocks;
}

function Blocks({ source, className }: { source: string; className?: string }) {
  const blocks = parse(source);
  return (
    <div className={cn("[&>*+*]:mt-3", className)}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "h": {
            const Tag = `h${Math.min(6, b.level + 1)}` as "h2" | "h3" | "h4" | "h5" | "h6";
            return (
              <Tag key={i} className={cn("font-semibold", b.level === 1 ? "text-lg" : b.level === 2 ? "mt-5! text-base" : "text-sm")}>
                <Inline text={b.text} />
              </Tag>
            );
          }
          case "p":
            return (
              <p key={i}>
                <Inline text={b.text} />
              </p>
            );
          case "quote":
            return (
              <blockquote key={i} className="border-l-2 pl-3 text-muted-foreground">
                <Inline text={b.text} />
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
                  <li key={j}>{it.includes("\n") ? <Blocks source={it} /> : <Inline text={it} />}</li>
                ))}
              </List>
            );
          }
        }
      })}
    </div>
  );
}

export function Markdown({ source, className, renderers }: { source: string; className?: string; renderers?: MarkdownRenderers }) {
  return (
    <Renderers.Provider value={renderers ?? {}}>
      <Blocks source={source} className={cn("text-sm leading-relaxed", className)} />
    </Renderers.Provider>
  );
}

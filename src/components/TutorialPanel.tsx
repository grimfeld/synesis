// The Tutorial panel (PLAN §25.6): one for the whole app, docked on the right
// and never modal, so the user can do each step in the view beside it. It
// stays open across navigation because several Tutorials cross views. At
// phone width it is a bottom sheet that shrinks to a one-line strip.
//
// And the "?" that opens it from a view (§25.1), and the Command links its
// steps are written with (§25.9).
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, CircleHelp, RotateCcw, X } from "lucide-react";
import { cn } from "cn";
import { useStore } from "@/lib/store";
import { useCommands } from "@/lib/commands";
import { formatShortcut } from "@/lib/keys";
import { useT } from "@/i18n";
import { imageUrl, tutorial, tutorialsFor, type TutorialPlace } from "@/lib/tutorials";
import { useTutorials } from "@/lib/tutorialState";
import type { DeviceKind } from "@/lib/syncRules";
import { useIsMobile } from "@/hooks/use-mobile";
import { Markdown, type MarkdownRenderers } from "@/components/Markdown";
import { IconButton } from "@/components/IconButton";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

/** The "?" in a view's header. Hidden when the view lists no Tutorial. */
export function TutorialButton({ place, deviceKind, className }: { place: TutorialPlace; deviceKind?: DeviceKind; className?: string }) {
  const t = useT();
  const s = useStore();
  const tut = useTutorials();
  const ids = tutorialsFor(place, deviceKind);
  if (!ids.length) return null;
  const total = (id: string) => tutorial(id, s.lang)?.steps.length ?? 1;
  return (
    <IconButton label={t.tutorials.open} data-testid="tutorial-button" className={className} onClick={() => tut.showList(ids, total)}>
      <CircleHelp />
    </IconButton>
  );
}

/** A step's `[text](command:<id>)`: the Command's live title and shortcut, as a button that runs it. */
function CommandLink({ id, fallback }: { id: string; fallback: string }) {
  const t = useT();
  const commands = useCommands();
  const c = commands.find((c) => c.id === id);
  if (!c)
    return (
      <span className="font-medium" title={t.tutorials.unavailable} data-testid="command-link" data-command={id} data-available="false">
        {fallback}
      </span>
    );
  return (
    <button
      type="button"
      data-testid="command-link"
      data-command={id}
      data-available="true"
      onClick={() => c.run()}
      className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 align-baseline font-medium text-foreground transition-colors hover:bg-accent"
    >
      <span className="min-w-0">{c.title}</span>
      {/* No KbdGroup: it is a div, and this sits inside a paragraph. */}
      {c.shortcut && formatShortcut(c.shortcut).map((k) => <Kbd key={k}>{k}</Kbd>)}
    </button>
  );
}

function useRenderers(): MarkdownRenderers {
  const s = useStore();
  const { imageMode } = useTutorials();
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  return {
    link: (text, href, key) => (href.startsWith("command:") ? <CommandLink key={key} id={href.slice("command:".length)} fallback={text} /> : null),
    image: (alt, src, key) => {
      if (!src.startsWith("image:")) return null;
      const url = imageUrl(src.slice("image:".length), imageMode, s.lang, dark ? "dark" : "light");
      return url ? <img key={key} src={url} alt={alt} loading="lazy" data-testid="tutorial-image" data-mode={imageMode} className="my-2 block max-w-full rounded-md border" /> : null;
    },
  };
}

/** A whole Tutorial, rendered where it is read in place (the wizard's sync step), with its Command links live. */
export function TutorialMarkdown({ source, className }: { source: string; className?: string }) {
  return <Markdown source={source} renderers={useRenderers()} className={className} />;
}

/** The list a view's "?" offers when it has several Tutorials. */
function TutorialList({ ids }: { ids: string[] }) {
  const t = useT();
  const s = useStore();
  const tut = useTutorials();
  return (
    // Its own scroll area, like the body: a list taller than the panel would
    // otherwise overflow it, and focusing an entry below the fold scrolls the
    // app's overflow-hidden main pane instead, sliding the whole interface up
    // with no way back.
    <ul className="thin-scroll grid min-h-0 flex-1 content-start gap-1.5 overflow-y-auto p-3" data-testid="tutorial-list">
      {ids.map((id) => {
        const x = tutorial(id, s.lang);
        if (!x) return null;
        const done = tut.progress[id]?.done ?? false;
        return (
          <li key={id}>
            <button
              type="button"
              data-testid="tutorial-list-item"
              data-id={id}
              data-done={done}
              onClick={() => tut.show(id, x.steps.length, ids)}
              className="flex w-full min-w-0 items-center gap-2 rounded-lg border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
            >
              <span className="min-w-0 flex-1">{x.title}</span>
              {done ? <Check className="size-4 shrink-0 text-primary" aria-label={t.tutorials.finished} /> : <ArrowRight className="size-4 shrink-0 text-muted-foreground" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** One Tutorial: intro, the steps with the current one marked, then reference. */
function TutorialBody({ id, step, from }: { id: string; step: number; from?: string[] }) {
  const t = useT();
  const s = useStore();
  const tut = useTutorials();
  const renderers = useRenderers();
  const x = tutorial(id, s.lang);
  const current = useRef<HTMLLIElement>(null);
  useEffect(() => current.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), [step, id]);
  if (!x) return null;
  const total = x.steps.length;
  const done = tut.progress[id]?.done ?? false;
  const last = step === total - 1;
  return (
    <>
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-4" data-testid="tutorial-body" data-id={id}>
        <Markdown source={x.intro} renderers={renderers} className="text-muted-foreground" />
        <ol className="mt-4 grid gap-2">
          {x.steps.map((md, i) => (
            <li
              key={i}
              ref={i === step ? current : undefined}
              data-testid="tutorial-step"
              data-index={i}
              data-current={i === step}
              onClick={() => i !== step && tut.step(id, i, total)}
              className={cn(
                "flex min-w-0 gap-3 rounded-lg border p-3 transition-colors",
                i === step ? "border-primary/60 bg-accent/60" : "cursor-pointer opacity-60 hover:opacity-100",
              )}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  i < step || done ? "bg-primary text-primary-foreground" : i === step ? "border-2 border-primary text-primary" : "border text-muted-foreground",
                )}
              >
                {i < step || done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <Markdown source={md} renderers={renderers} className="min-w-0 flex-1" />
            </li>
          ))}
        </ol>
        {x.after && <Markdown source={x.after} renderers={renderers} className="mt-6 border-t pt-4 text-muted-foreground" />}
      </div>
      <footer className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
        {from && from.length > 1 && (
          <Button variant="ghost" size="sm" onClick={() => tut.showList(from, () => 1)} data-testid="tutorial-to-list" className="min-h-8 h-auto">
            <ArrowLeft />
            {t.tutorials.all}
          </Button>
        )}
        <span className="min-w-0 flex-1 text-xs text-muted-foreground" data-testid="tutorial-progress">
          {done ? t.tutorials.finished : t.tutorials.step_of(step + 1, total)}
        </span>
        <Button variant="outline" size="sm" className="min-h-8 h-auto" disabled={step === 0} onClick={() => tut.step(id, step - 1, total)} data-testid="tutorial-back">
          {t.tutorials.back}
        </Button>
        {!last ? (
          <Button size="sm" className="min-h-8 h-auto" onClick={() => tut.step(id, step + 1, total)} data-testid="tutorial-next">
            {t.tutorials.next}
          </Button>
        ) : done ? (
          <Button size="sm" variant="outline" className="min-h-8 h-auto" onClick={() => tut.step(id, 0, total)} data-testid="tutorial-again">
            <RotateCcw />
            {t.tutorials.again}
          </Button>
        ) : (
          <Button size="sm" className="min-h-8 h-auto" onClick={() => tut.done(id, total)} data-testid="tutorial-done">
            <Check />
            {t.tutorials.done}
          </Button>
        )}
      </footer>
    </>
  );
}

export function TutorialPanel() {
  const t = useT();
  const s = useStore();
  const tut = useTutorials();
  const mobile = useIsMobile();
  const [expanded, setExpanded] = useState(true);
  const open = tut.open;
  // A newly opened Tutorial shows itself in full, even after the strip was shrunk.
  useEffect(() => setExpanded(true), [open?.kind, open?.kind === "one" ? open.id : null]);
  if (!open) return null;

  const x = open.kind === "one" ? tutorial(open.id, s.lang) : null;
  const heading = x ? x.title : t.tutorials.list_title;
  const header = (
    <header className="flex min-h-12 shrink-0 items-center gap-2 border-b px-3">
      <CircleHelp className="size-4 shrink-0 text-muted-foreground" />
      <h2 className="min-w-0 flex-1 text-sm font-semibold" data-testid="tutorial-title">
        {heading}
      </h2>
      {mobile && (
        <IconButton label={t.tutorials.collapse} onClick={() => setExpanded(false)} data-testid="tutorial-collapse">
          <ChevronDown />
        </IconButton>
      )}
      <IconButton label={t.tutorials.close} onClick={tut.close} data-testid="tutorial-close">
        <X />
      </IconButton>
    </header>
  );
  const body = open.kind === "list" ? <TutorialList ids={open.ids} /> : <TutorialBody id={open.id} step={open.step} from={open.from} />;

  if (mobile) {
    if (!expanded)
      return (
        <div
          data-testid="tutorial-strip"
          className="fixed inset-x-0 bottom-0 z-40 flex min-h-12 items-center gap-2 border-t bg-background px-3 py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.08)]"
        >
          <button type="button" onClick={() => setExpanded(true)} data-testid="tutorial-expand" className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm" aria-label={t.tutorials.expand}>
            <ChevronUp className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">
              {x && open.kind === "one" ? `${t.tutorials.step_of(open.step + 1, x.steps.length)} · ${x.title}` : heading}
            </span>
          </button>
          <IconButton label={t.tutorials.close} onClick={tut.close}>
            <X />
          </IconButton>
        </div>
      );
    return (
      <aside
        data-testid="tutorial-panel"
        data-layout="sheet"
        className="fixed inset-x-0 bottom-0 z-40 flex max-h-[62vh] min-w-0 flex-col rounded-t-xl border-t bg-background pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(0,0,0,0.12)]"
      >
        {header}
        {body}
      </aside>
    );
  }
  return (
    <aside data-testid="tutorial-panel" data-layout="docked" className="flex h-full w-80 min-w-0 shrink-0 flex-col border-l bg-background">
      {header}
      {body}
    </aside>
  );
}

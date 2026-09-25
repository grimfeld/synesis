// Writing page: Note, Clipping, Composition. Title and tags above the editor,
// properties and backlinks in the right panel.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  Code,
  CircleHelp,
  Ellipsis,
  Lock,
  LockOpen,
  PanelRight,
  Presentation,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { cn } from "cn";
import { api, fmString, type DetectedRange } from "@/lib/api";
import { splitFrontmatter } from "@/lib/frontmatter";
import { formatShortcut } from "@/lib/keys";
import { useStore } from "@/lib/store";
import { useDocument } from "@/lib/useDocument";
import { useT } from "@/i18n";
import { Editor } from "@/editor/Editor";
import { BoardView } from "@/views/BoardView";
import type { EditorEnv } from "@/editor/decorations";
import { DocHeader } from "@/components/DocHeader";
import { HoverCard, type HoverState } from "@/components/HoverCard";
import { IconButton } from "@/components/IconButton";
import { RightPanel } from "@/components/RightPanel";
import { TutorialButton } from "@/components/TutorialPanel";
import { tutorial, tutorialsFor, type TutorialPlace } from "@/lib/tutorials";
import { useTutorials } from "@/lib/tutorialState";
import { TypeDot } from "@/components/DocLink";
import { Alert, AlertAction, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SplitPanes } from "@/components/SplitPanes";
import type { DocTab } from "@/lib/store";
import { splitFits } from "@/lib/split";
import { toast } from "sonner";

export function DocView({ id }: { id: string }) {
  const s = useStore();
  const t = useT();
  const d = useDocument(id);
  const isMobile = useIsMobile();
  const tut = useTutorials();
  const [hover, setHover] = useState<HoverState | null>(null);
  const [detected, setDetected] = useState<DetectedRange[]>([]);
  // Set once by the editor, so a panel row can put the cursor on what it lists.
  const selectRange = useRef<((from: number, to: number) => void) | null>(null);
  const onEditorReady = useCallback(
    (fn: (from: number, to: number) => void) => {
      selectRange.current = fn;
    },
    [],
  );

  // A Board belongs to the Composition it is paired with, so moving to another
  // document — including through back and forward — starts on the text. A
  // split already shows the text, so it stays: Back from a card opened in
  // reading mode returns to the talk and Board side by side (PLAN §22.7).
  useEffect(() => {
    if (s.docTab === "board") s.setDocTab("talk");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Whether the talk and the Board both fit side by side (PLAN §22.5). The
  // column is measured rather than the window, since the sidebar and the
  // side panel both take from it.
  const columnRef = useRef<HTMLDivElement>(null);
  const [columnWidth, setColumnWidth] = useState(0);
  useLayoutEffect(() => {
    const el = columnRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setColumnWidth(e.contentRect.width));
    ro.observe(el);
    setColumnWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [!!d.doc]);

  // Reading mode: a keystroke into a locked page says why nothing happens,
  // since the lock outlives the session and is easy to forget (PLAN §23.4).
  // Only printable keys with no field focused: shortcuts and typing into the
  // palette or a dialog are not attempts to edit the page.
  const locked = s.readingMode;
  useEffect(() => {
    if (!locked || s.delivery) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        (el instanceof HTMLElement && el.isContentEditable) ||
        document.querySelector("[role=dialog]")
      ) {
        return;
      }
      toast(t.reading_locked, { id: "reading-locked" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, s.delivery, t]);

  // A phone has no room for a column beside the editor: the panel is a sheet
  // there, and it starts closed so the toggle is the only way in and out.
  useEffect(() => {
    if (isMobile) s.setPanelOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  const env = useMemo<EditorEnv>(
    () => ({
      names: d.names,
      onOpenLink: (target) => s.openLink(target),
      onOpenPassage: (p) => s.openPassage(p),
      onPassageHover: (i) =>
        setHover(i ? { kind: "passage", passages: i.p, x: i.x, y: i.y } : null),
      onLinkHover: (i) =>
        setHover(i ? { kind: "link", target: i.target, x: i.x, y: i.y } : null),
      embedText: async (target) => {
        const r = await api.resolveLink(target);
        if (!r) return null;
        const full = await api.getDocument(r.id);
        return { title: r.title, body: splitFrontmatter(full.text).body };
      },
    }),
    [d.names, s],
  );

  const doc = d.doc;
  if (!doc)
    return (
      <div className="flex h-full flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger className="-ml-1" />
          <Skeleton className="h-4 w-48" />
        </header>
        <div className="mx-auto w-full max-w-[720px] space-y-3 px-8 py-8">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    );
  const sum = doc.summary;
  // Only a Composition has a Board, so a stale tab from a previous document
  // can never hide a Note's text.
  const hasBoard = sum.type === "composition";
  // Split is offered only where both sides fit; a split that no longer fits
  // shows the talk, the deliverable, and comes back when there is room
  // (PLAN §22.5). The stored tab is left as it is.
  const canSplit = splitFits(columnWidth);
  const split = hasBoard && s.docTab === "split" && canSplit;
  const showBoard = hasBoard && s.docTab === "board";
  // The editor's Tutorials, or the Board's while the Board is all that shows
  // (PLAN §24.1). On a phone they sit in the header's More menu.
  const tutorialPlace: TutorialPlace = showBoard ? { kind: "board" } : { kind: "editor", type: sum.type };
  const tutorialIdsHere = tutorialsFor(tutorialPlace);
  const openTutorials = tutorialIdsHere.length
    ? () => tut.showList(tutorialIdsHere, (i) => tutorial(i, s.lang)?.steps.length ?? 1)
    : null;
  const tabs: DocTab[] = canSplit ? ["talk", "split", "board"] : ["talk", "board"];
  // The tab to mark as current: a split too narrow to draw reads as the talk.
  const activeTab: DocTab = s.docTab === "split" && !canSplit ? "talk" : s.docTab;
  // A Clipping has no title, so its header is its Citation (ADR 0013): the
  // Source it names and where within it, read the way it would be said aloud.
  // The `source` property is a wikilink, and the brackets are not the name.
  const citation =
    sum.type === "clipping"
      ? [
          fmString(doc.frontmatter.source)
            .replace(/^\[\[|\]\]$/g, "")
            .split("|")[0]
            .trim(),
          fmString(doc.frontmatter.locator).trim(),
        ]
          .filter(Boolean)
          .join(" · ")
      : undefined;

  // The talk: title, Properties and the editor, scrolling as one. Shared by
  // the Talk tab and the left side of a split.
  const talk = (
    <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
      <DocHeader
        doc={doc}
        title={sum.title}
        readOnlyTitle={false}
        citation={citation}
        onRename={d.rename}
        fm={d.fm}
        onFmChange={d.onFmChange}
        locked={locked}
      />
      <div>
        <Editor
          value={d.body}
          revision={d.revision}
          onChange={d.onBodyChange}
          onDetected={setDetected}
          onReady={onEditorReady}
          env={env}
          names={d.names}
          tags={s.tags}
          placeholder={t.empty_doc}
          // Not while locked: focus on a read-only editor does nothing but
          // put a caret where no text can go.
          autofocus={!locked}
          sourceMode={s.sourceMode}
          readOnly={locked}
        />
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-1">
      <div ref={columnRef} className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-1 border-b bg-background px-3">
          <SidebarTrigger className="-ml-1" />
          {!isMobile && (
            <Separator
              orientation="vertical"
              className="mx-1 data-vertical:h-4 data-vertical:self-center"
            />
          )}
          <IconButton
            label={t.back}
            data-testid="doc-back"
            shortcut={formatShortcut("Alt+ArrowLeft").join(" ")}
            disabled={!s.canBack}
            onClick={s.back}
          >
            <ArrowLeft />
          </IconButton>
          <IconButton
            label={t.forward}
            shortcut={formatShortcut("Alt+ArrowRight").join(" ")}
            disabled={!s.canForward}
            onClick={s.forward}
          >
            <ArrowRight />
          </IconButton>
          {!isMobile && <TypeDot type={sum.type} className="mx-1.5" />}
          <span
            className="min-w-0 flex-1 truncate text-sm text-muted-foreground"
            title={sum.path}
          >
            {t.types[sum.type]}
          </span>
          <span
            className={cn(
              "mx-2 text-xs text-muted-foreground transition-opacity",
              d.status === "idle" && "opacity-0",
            )}
            aria-live="polite"
            data-testid="save-status"
            data-status={d.status}
          >
            {d.status === "saving" ? (
              t.saving
            ) : d.status === "saved" ? (
              t.saved
            ) : d.status === "error" ? (
              <CircleAlert className="inline size-3.5 text-destructive" />
            ) : (
              ""
            )}
          </span>
          {hasBoard && (
            <div
              className="mr-1 flex items-center rounded-md border p-0.5"
              role="tablist"
              aria-label={t.board}
            >
              {tabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab}
                  data-testid={`tab-${tab}`}
                  className={cn(
                    "rounded px-2 py-0.5 text-xs transition-colors",
                    activeTab === tab
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => s.setDocTab(tab)}
                >
                  {tab === "talk"
                    ? t.board_tab_talk
                    : tab === "split"
                      ? t.board_tab_split
                      : t.board_tab_board}
                </button>
              ))}
            </div>
          )}
          {hasBoard && (
            <IconButton
              label={t.deliver}
              data-testid="deliver"
              onClick={() => s.openDelivery(id)}
            >
              <Presentation />
            </IconButton>
          )}
          {/* The Device's lock on every Writing (PLAN §23). Its state is always
              on show, since it outlives the session. */}
          <IconButton
            label={locked ? t.reading_unlock : t.reading_mode}
            data-testid="reading-toggle"
            aria-pressed={locked}
            className={cn(locked && "bg-accent text-accent-foreground")}
            onClick={() => s.setReadingMode(!locked)}
          >
            {locked ? <Lock /> : <LockOpen />}
          </IconButton>
          {/* Both act on the editor, which the Board tab replaces; beside the
              Board it is still there, so they stay (PLAN §22.2). */}
          {!showBoard && (
            <>
              {!isMobile && (
                <IconButton
                  label={s.sourceMode ? t.live_preview : t.source_mode}
                  shortcut={formatShortcut("Mod+E").join("")}
                  aria-pressed={s.sourceMode}
                  className={cn(s.sourceMode && "bg-accent text-accent-foreground")}
                  onClick={() => s.setSourceMode(!s.sourceMode)}
                >
                  <Code />
                </IconButton>
              )}
              <IconButton
                label={t.toggle_panel}
                data-testid="toggle-panel"
                aria-pressed={s.panelOpen}
                className={cn(s.panelOpen && "bg-accent text-accent-foreground")}
                onClick={() => s.setPanelOpen(!s.panelOpen)}
              >
                <PanelRight />
              </IconButton>
            </>
          )}
          {isMobile ? (
            // A phone's header cannot hold every control once a Composition
            // adds its tabs, Deliver and the lock (PLAN §23): the two used
            // least while reading move behind one button.
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t.more}
                  data-testid="doc-more"
                >
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!showBoard && (
                  <DropdownMenuItem onSelect={() => s.setSourceMode(!s.sourceMode)}>
                    <Code />
                    {s.sourceMode ? t.live_preview : t.source_mode}
                  </DropdownMenuItem>
                )}
                {openTutorials && (
                  <DropdownMenuItem onSelect={openTutorials} data-testid="tutorial-menu-item">
                    <CircleHelp />
                    {t.tutorials.open}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => s.setDialog({ kind: "delete", id })}
                >
                  <Trash2 />
                  {t.delete}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
            <TutorialButton place={tutorialPlace} />
            <IconButton
              label={t.delete}
              className="text-muted-foreground hover:text-destructive"
              onClick={() => s.setDialog({ kind: "delete", id })}
            >
              <Trash2 />
            </IconButton>
            </>
          )}
        </header>
        {d.external && (
          <Alert className="mx-auto mt-3 w-[min(720px,calc(100%-2rem))]">
            <RefreshCw />
            <AlertTitle>{t.external_change}</AlertTitle>
            <AlertAction>
              <Button size="sm" variant="outline" onClick={() => d.load()}>
                {t.reload}
              </Button>
            </AlertAction>
          </Alert>
        )}
        {showBoard ? (
          <BoardView id={id} docs={s.docs} />
        ) : (
          <SplitPanes
            ratio={s.splitRatio}
            onRatio={s.setSplitRatio}
            width={columnWidth}
            talk={talk}
            board={split ? <BoardView id={id} docs={s.docs} beside /> : null}
          />
        )}
      </div>
      {showBoard ? null : isMobile ? (
        <Sheet open={s.panelOpen} onOpenChange={s.setPanelOpen}>
          <SheetContent
            side="right"
            // pt leaves the close button its own row above the first section.
            className="w-[86vw] gap-0 p-0 pt-10 sm:max-w-sm"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>{t.toggle_panel}</SheetTitle>
              <SheetDescription>{t.toggle_panel}</SheetDescription>
            </SheetHeader>
            <RightPanel
              doc={doc}
              inSheet
              fm={d.fm}
              onFmChange={d.onFmChange}
              detected={detected}
              body={d.body}
              onBodyChange={d.setBodyText}
              onReveal={(from, to) => selectRange.current?.(from, to)}
              onRestore={d.replaceText}
              flush={d.flush}
              locked={locked}
            />
          </SheetContent>
        </Sheet>
      ) : (
        s.panelOpen && (
          <RightPanel
            doc={doc}
            fm={d.fm}
            onFmChange={d.onFmChange}
            detected={detected}
            body={d.body}
            onBodyChange={d.setBodyText}
            onReveal={(from, to) => selectRange.current?.(from, to)}
            onRestore={d.replaceText}
            flush={d.flush}
            locked={locked}
          />
        )
      )}
      {hover && (
        <HoverCard
          state={hover}
          excludeId={id}
          onClose={() => setHover(null)}
        />
      )}
    </div>
  );
}

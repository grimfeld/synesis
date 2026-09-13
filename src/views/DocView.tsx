// Writing page: Note, Clipping, Composition. Title and tags above the editor,
// properties and backlinks in the right panel.
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  Code,
  PanelRight,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { cn } from "cn";
import { api, type DetectedRange } from "@/lib/api";
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

export function DocView({ id }: { id: string }) {
  const s = useStore();
  const t = useT();
  const d = useDocument(id);
  const isMobile = useIsMobile();
  const [hover, setHover] = useState<HoverState | null>(null);
  const [detected, setDetected] = useState<DetectedRange[]>([]);

  // A Board belongs to the Composition it is paired with, so moving to another
  // document — including through back and forward — starts on the text.
  useEffect(() => {
    s.setDocTab("talk");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
  const showBoard = s.docTab === "board" && sum.type === "composition";

  return (
    <div className="flex h-full min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-1 border-b bg-background px-3">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mx-1 data-vertical:h-4 data-vertical:self-center"
          />
          <IconButton
            label={t.back}
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
          <TypeDot type={sum.type} className="mx-1.5" />
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
          {sum.type === "composition" && (
            <div
              className="mr-1 flex items-center rounded-md border p-0.5"
              role="tablist"
              aria-label={t.board}
            >
              {(["talk", "board"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={s.docTab === tab}
                  data-testid={`tab-${tab}`}
                  className={cn(
                    "rounded px-2 py-0.5 text-xs transition-colors",
                    s.docTab === tab
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => s.setDocTab(tab)}
                >
                  {tab === "talk" ? t.board_tab_talk : t.board_tab_board}
                </button>
              ))}
            </div>
          )}
          {/* Both act on the editor, which the Board replaces. */}
          {!showBoard && (
            <>
              <IconButton
                label={s.sourceMode ? t.live_preview : t.source_mode}
                shortcut={formatShortcut("Mod+E").join("")}
                aria-pressed={s.sourceMode}
                className={cn(s.sourceMode && "bg-accent text-accent-foreground")}
                onClick={() => s.setSourceMode(!s.sourceMode)}
              >
                <Code />
              </IconButton>
              <IconButton
                label={t.toggle_panel}
                aria-pressed={s.panelOpen}
                className={cn(s.panelOpen && "bg-accent text-accent-foreground")}
                onClick={() => s.setPanelOpen(!s.panelOpen)}
              >
                <PanelRight />
              </IconButton>
            </>
          )}
          <IconButton
            label={t.delete}
            className="text-muted-foreground hover:text-destructive"
            onClick={() => s.setDialog({ kind: "delete", id })}
          >
            <Trash2 />
          </IconButton>
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
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
          <DocHeader
            doc={doc}
            title={sum.title}
            readOnlyTitle={false}
            onRename={d.rename}
            fm={d.fm}
            onFmChange={d.onFmChange}
          />
          <div>
            <Editor
              value={d.body}
              revision={d.revision}
              onChange={d.onBodyChange}
              onDetected={setDetected}
              env={env}
              names={d.names}
              tags={s.tags}
              placeholder={t.empty_doc}
              autofocus
              sourceMode={s.sourceMode}
            />
          </div>
        </div>
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
              onRestore={d.replaceText}
              flush={d.flush}
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
            onRestore={d.replaceText}
            flush={d.flush}
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

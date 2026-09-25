// The Delivery view (PLAN §23): the full-screen place a Composition is given
// from. Its text, its Board, or both side by side, a timer, and nothing else.
// Nothing here edits, and nothing here navigates away: a Passage, a link or a
// Board card opens over the view.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AArrowDown,
  AArrowUp,
  MoonStar,
  Pause,
  Play,
  RotateCcw,
  X,
} from "lucide-react";
import { cn } from "cn";
import { api } from "@/lib/api";
import { splitFrontmatter } from "@/lib/frontmatter";
import { useStore, type DocTab } from "@/lib/store";
import { useDocument } from "@/lib/useDocument";
import { splitFits } from "@/lib/split";
import {
  display,
  durationMinutes,
  isRunning,
  pause,
  reset,
  SIZE_STEP,
  start,
} from "@/lib/delivery";
import { useT } from "@/i18n";
import { Editor } from "@/editor/Editor";
import type { EditorEnv } from "@/editor/decorations";
import { BoardView } from "@/views/BoardView";
import { SplitPanes } from "@/components/SplitPanes";
import { HoverCard, type HoverState } from "@/components/HoverCard";
import { IconButton } from "@/components/IconButton";
import { Button } from "@/components/ui/button";

export function DeliveryView({ id }: { id: string }) {
  const s = useStore();
  const t = useT();
  const d = useDocument(id);
  // Opens on the face that was showing (§23.12). Local, so leaving returns the
  // page to its own tab untouched.
  const [face, setFace] = useState<DocTab>(s.docTab);
  const [peek, setPeek] = useState<HoverState | null>(null);
  const lastPress = useRef({ x: 0, y: 0 });

  // Side by side only where both fit, by the same rule as the page (§22.5).
  const bodyRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  const canSplit = splitFits(width);
  const shown: DocTab = face === "split" && !canSplit ? "talk" : face;
  const faces: DocTab[] = canSplit
    ? ["talk", "split", "board"]
    : ["talk", "board"];

  const close = s.closeDelivery;
  // Escape closes an open preview first, then the view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (peek) setPeek(null);
      else close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [peek, close]);

  // Keep the screen awake (§23.13). The lock is released whenever the page is
  // hidden, so it is asked for again on the way back.
  const [awake, setAwake] = useState<"yes" | "no" | "pending">("pending");
  useEffect(() => {
    type Sentinel = { release: () => Promise<void> };
    const wl = (
      navigator as Navigator & {
        wakeLock?: { request: (t: "screen") => Promise<Sentinel> };
      }
    ).wakeLock;
    if (!wl) {
      setAwake("no");
      return;
    }
    let sentinel: Sentinel | null = null;
    let alive = true;
    const ask = () => {
      if (document.visibilityState !== "visible") return;
      wl.request("screen")
        .then((x) => {
          if (!alive) return void x.release().catch(() => {});
          sentinel = x;
          setAwake("yes");
        })
        .catch(() => alive && setAwake("no"));
    };
    ask();
    document.addEventListener("visibilitychange", ask);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", ask);
      sentinel?.release().catch(() => {});
    };
  }, []);

  // The talk's links, Passages and Embeds open over the view, never away.
  const peekAt = useCallback((st: HoverState) => setPeek(st), []);
  const env = useMemo<EditorEnv>(
    () => ({
      names: d.names,
      onOpenLink: (target) =>
        peekAt({ kind: "link", target, ...lastPress.current }),
      onOpenPassage: (p) =>
        peekAt({ kind: "passage", passages: [p], ...lastPress.current }),
      onPassageHover: (i) =>
        i && peekAt({ kind: "passage", passages: i.p, x: i.x, y: i.y }),
      onLinkHover: (i) =>
        i && peekAt({ kind: "link", target: i.target, x: i.x, y: i.y }),
      embedText: async (target) => {
        const r = await api.resolveLink(target);
        if (!r) return null;
        const full = await api.getDocument(r.id);
        return { title: r.title, body: splitFrontmatter(full.text).body };
      },
    }),
    [d.names, peekAt],
  );

  const doc = d.doc;
  const minutes = durationMinutes(doc?.frontmatter.duration);

  // Pinch to size the text on touch (§23.11): the talk's container does its
  // own two-finger scaling, since the page's zoom would scale the bar too.
  const pinch = useRef<{ dist: number; size: number } | null>(null);
  const distance = (e: React.TouchEvent) => {
    const [a, b] = [e.touches[0], e.touches[1]];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };

  const talk = (
    <div
      className="thin-scroll min-h-0 flex-1 overflow-y-auto"
      style={{ touchAction: "pan-y" }}
      data-testid="delivery-talk"
      onTouchStart={(e) => {
        if (e.touches.length === 2)
          pinch.current = { dist: distance(e), size: s.deliverySize };
      }}
      onTouchMove={(e) => {
        if (e.touches.length !== 2 || !pinch.current) return;
        const p = pinch.current;
        s.setDeliverySize(p.size * (distance(e) / p.dist));
      }}
      onTouchEnd={() => (pinch.current = null)}
    >
      {doc && (
        <>
          {/* Sized in the prose's ems, so the title keeps the text's column
              (the editor's own 36em measure) at every text size. */}
          <div
            className="mx-auto w-full max-w-[36em] px-8 pt-8"
            style={{ fontSize: `${s.deliverySize}px` }}
          >
            <h1 className="font-prose text-[1.4em] font-bold leading-tight tracking-tight">
              {doc.summary.title}
            </h1>
          </div>
          <Editor
            value={d.body}
            revision={d.revision}
            onChange={() => {}}
            env={env}
            names={d.names}
            tags={s.tags}
            readOnly
            checkboxes={false}
            register={false}
            fontSize={s.deliverySize}
          />
        </>
      )}
    </div>
  );
  const board = (
    <BoardView
      id={id}
      docs={s.docs}
      delivering
      beside={shown === "split"}
      onPeek={(target, x, y) => peekAt({ kind: "link", target, x, y })}
    />
  );

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background text-foreground"
      data-testid="delivery"
      role="dialog"
      aria-modal="true"
      aria-label={doc?.summary.title ?? t.deliver}
      onPointerDownCapture={(e) => {
        lastPress.current = { x: e.clientX, y: e.clientY };
      }}
    >
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-2 py-1">
        <div
          className="flex items-center rounded-md border p-0.5"
          role="tablist"
          aria-label={t.delivery_face}
        >
          {faces.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={shown === f}
              data-testid={`delivery-face-${f}`}
              className={cn(
                "rounded px-2 py-0.5 text-xs transition-colors",
                shown === f
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setFace(f)}
            >
              {f === "talk"
                ? t.board_tab_talk
                : f === "split"
                  ? t.board_tab_split
                  : t.board_tab_board}
            </button>
          ))}
        </div>
        <Timer minutes={minutes} />
        <div className="ml-auto flex items-center gap-0.5">
          {awake === "no" && (
            <span
              className="mr-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
              data-testid="delivery-may-sleep"
            >
              <MoonStar className="size-3.5 shrink-0" />
              <span className="min-w-0">{t.screen_may_sleep}</span>
            </span>
          )}
          {shown !== "board" && (
            <>
              <IconButton
                label={t.text_smaller}
                data-testid="delivery-smaller"
                onClick={() => s.setDeliverySize(s.deliverySize - SIZE_STEP)}
              >
                <AArrowDown />
              </IconButton>
              <IconButton
                label={t.text_larger}
                data-testid="delivery-larger"
                onClick={() => s.setDeliverySize(s.deliverySize + SIZE_STEP)}
              >
                <AArrowUp />
              </IconButton>
            </>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-8 gap-1"
            data-testid="delivery-exit"
            onClick={close}
          >
            <X className="size-4 shrink-0" />
            {t.delivery_exit}
          </Button>
        </div>
      </div>
      <div ref={bodyRef} className="flex min-h-0 flex-1">
        {shown === "board" ? (
          board
        ) : (
          <SplitPanes
            ratio={s.splitRatio}
            onRatio={s.setSplitRatio}
            width={width}
            talk={talk}
            board={shown === "split" ? board : null}
          />
        )}
      </div>
      {peek && (
        <HoverCard
          state={peek}
          excludeId={id}
          stay
          onClose={() => setPeek(null)}
        />
      )}
    </div>
  );
}

/**
 * Countdown from the Composition's duration, or elapsed time without one
 * (§23.10). The state lives in the store, so leaving the view by accident
 * costs nothing.
 */
function Timer({ minutes }: { minutes: number | null }) {
  const s = useStore();
  const t = useT();
  const timer = s.deliveryTimer;
  const running = isRunning(timer);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const iv = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(iv);
  }, [running]);
  const shown = display(timer, running ? now : Date.now(), minutes);
  return (
    <div className="flex items-center gap-0.5">
      <span
        data-testid="delivery-timer"
        data-phase={shown.phase}
        title={
          minutes === null
            ? t.timer_no_duration
            : t.timer_hint_duration(minutes)
        }
        className={cn(
          "min-w-16 rounded-md px-2 text-center text-lg font-semibold tabular-nums",
          shown.phase === "idle" && "text-muted-foreground",
          shown.phase === "warning" &&
            "bg-amber-500/15 text-amber-600 dark:text-amber-400",
          shown.phase === "over" && "bg-destructive/15 text-destructive",
        )}
      >
        {shown.text}
      </span>
      <IconButton
        label={running ? t.timer_pause : t.timer_start}
        data-testid="delivery-timer-toggle"
        onClick={() => {
          const at = Date.now();
          s.setDeliveryTimer(running ? pause(timer, at) : start(timer, at));
          setNow(at);
        }}
      >
        {running ? <Pause /> : <Play />}
      </IconButton>
      <IconButton
        label={t.timer_reset}
        data-testid="delivery-timer-reset"
        onClick={() => s.setDeliveryTimer(reset(timer))}
      >
        <RotateCcw />
      </IconButton>
    </div>
  );
}

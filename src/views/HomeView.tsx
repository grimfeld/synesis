import { useEffect, useMemo, useState } from "react";
import { House, PenLine, Zap } from "lucide-react";
import { api, WRITING_TYPES, type DocSummary } from "@/lib/api";
import { shortcut } from "@/lib/keys";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { stamp } from "@/components/Dialogs";
import { DocLink } from "@/components/DocLink";
import { PanelTitle } from "@/components/Field";
import { ViewHeader } from "@/components/ViewHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";

const DAY = 86_400_000;

function toMs(mtime: number) {
  return mtime > 1e12 ? mtime : mtime * 1000;
}

function useRelative() {
  const t = useT();
  return (mtime: number) => {
    const diff = Date.now() - toMs(mtime);
    if (diff < 60_000) return t.ago.now;
    if (diff < 3_600_000) return t.ago.m(Math.floor(diff / 60_000));
    if (diff < DAY) return t.ago.h(Math.floor(diff / 3_600_000));
    return t.ago.d(Math.floor(diff / DAY));
  };
}

export function HomeView() {
  const s = useStore();
  const t = useT();
  const rel = useRelative();
  const recent = useMemo(
    () =>
      [...s.docs]
        .filter((d) => WRITING_TYPES.includes(d.type))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 10),
    [s.docs],
  );
  const compositions = useMemo(() => {
    const cutoff = Date.now() - 30 * DAY;
    return s.docs
      .filter((d) => d.type === "composition" && toMs(d.mtime) >= cutoff)
      .sort((a, b) => b.mtime - a.mtime);
  }, [s.docs]);

  return (
    <div className="flex h-full flex-col">
      <ViewHeader title={t.views.home} icon={<House />} />
      <div className="thin-scroll min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto grid max-w-4xl gap-6 lg:grid-cols-[1fr_320px]">
          <div className="grid content-start gap-6">
            <QuickCapture />
            <section data-testid="home-progress">
              <PanelTitle className="mb-2">{t.in_progress}</PanelTitle>
              {compositions.length === 0 ? (
                <Empty />
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {compositions.map((d) => (
                    <CompositionCard key={d.id} doc={d} when={rel(d.mtime)} />
                  ))}
                </ul>
              )}
            </section>
          </div>
          <section data-testid="home-recent">
            <PanelTitle className="mb-2">{t.recent_docs}</PanelTitle>
            {recent.length === 0 ? (
              <Empty />
            ) : (
              <ul className="-mx-2 space-y-0.5">
                {recent.map((d) => (
                  <li key={d.id}>
                    <DocLink doc={d}>
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                        {rel(d.mtime)}
                      </span>
                    </DocLink>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Empty() {
  const t = useT();
  return <p className="text-sm text-muted-foreground">{t.nothing_yet}</p>;
}

function QuickCapture() {
  const s = useStore();
  const t = useT();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await s.createDoc("note", stamp(), {}, text.trim() + "\n", false);
      setText("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card data-testid="home-quick">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="size-4 text-muted-foreground" />
          {t.quick_capture}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        <Textarea
          rows={3}
          className="font-prose text-[15px]"
          placeholder={t.quick_capture_hint}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
          }}
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={submit} disabled={!text.trim() || busy}>
            {t.create}
            <Kbd className="bg-primary-foreground/20 text-primary-foreground">
              {shortcut("↵")}
            </Kbd>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CompositionCard({ doc, when }: { doc: DocSummary; when: string }) {
  const s = useStore();
  const t = useT();
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .candidates(doc.id)
      .then((c) => alive && setCount(c.filter((x) => !x.used).length))
      .catch(() => alive && setCount(0));
    return () => {
      alive = false;
    };
  }, [doc.id, doc.mtime]);
  return (
    <li>
      <button
        type="button"
        className="flex w-full flex-col gap-1 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-accent"
        onClick={() => s.openDoc(doc.id)}
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <PenLine className="size-4 shrink-0 text-type-composition" />
          <span className="truncate">{doc.title}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {t.edited_ago(when)}
          {count != null && ` · ${t.candidates_n(count)}`}
        </span>
      </button>
    </li>
  );
}

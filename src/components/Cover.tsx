// The picture that stands for a Source in the Library (ADR 0012). A `cover`
// property is read three ways — a URL, a path inside the vault, or nothing at
// all, which draws one from the Source's own title, kind and date.
import { useEffect, useState } from "react";
import { api, type LibraryEntry } from "@/lib/api";
import { coverBg, coverKind } from "@/lib/library";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * Read a stored picture back as a data URL.
 *
 * Not the asset protocol: it does not exist on the development bridge where
 * every Cypress spec runs, so a Cover that only rendered through it would be
 * one no test ever sees (ADR 0012).
 */
function useAttachment(path: string | null): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!path) {
      setSrc(null);
      return;
    }
    let alive = true;
    api
      .readAttachment(path)
      .then((d) => alive && setSrc(d))
      // A missing or unreadable picture falls back to a drawn Cover rather
      // than leaving a hole in the Shelf.
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [path]);
  return src;
}

/**
 * A Cover drawn from what the Source already knows. Every Source has one, so a
 * Shelf reads as a library from the first day rather than once the user has
 * fed it pictures.
 */
function Drawn({ entry }: { entry: LibraryEntry }) {
  const t = useT();
  const kind = entry.kind.trim().toLowerCase();
  const label = (t.kinds as Record<string, string>)[kind];
  return (
    <div
      data-testid="cover-drawn"
      className={cn(
        "flex size-full flex-col justify-between p-3 text-left",
        coverBg(entry.id),
      )}
    >
      {/* White regardless of theme: the spine colours are deep in both. */}
      <span className="line-clamp-4 text-sm font-medium text-white">
        {entry.title}
      </span>
      <span className="min-w-0 truncate text-[10px] uppercase tracking-wide text-white/70">
        {[label, entry.date].filter(Boolean).join(" · ")}
      </span>
    </div>
  );
}

/**
 * A Source's Cover, at whatever size the caller gives it. Falls back to a
 * drawn Cover when there is no picture, when a remote one fails to load, and
 * when a stored one has gone missing.
 */
export function Cover({
  entry,
  className,
  onResolved,
}: {
  entry: LibraryEntry;
  className?: string;
  /**
   * Whether a real picture is showing. A drawn Cover already carries the
   * title as its artwork, so a card that repeats it underneath says the same
   * thing twice and wastes the line that should carry the date.
   */
  onResolved?: (hasPicture: boolean) => void;
}) {
  const resolved = coverKind(entry.cover);
  const stored = useAttachment(
    resolved.kind === "attachment" ? resolved.path : null,
  );
  // A remote picture that 404s or is blocked offline falls back rather than
  // showing a broken image (ADR 0012).
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [entry.cover]);

  const src =
    resolved.kind === "remote"
      ? resolved.url
      : resolved.kind === "attachment"
        ? stored
        : null;
  const hasPicture = !!src && !failed;
  useEffect(() => onResolved?.(hasPicture), [hasPicture, onResolved]);

  return (
    <div
      className={cn(
        "relative aspect-[2/3] w-full overflow-hidden rounded-md bg-muted",
        className,
      )}
    >
      {hasPicture ? (
        <img
          data-testid="cover-image"
          src={src}
          alt=""
          loading="lazy"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Drawn entry={entry} />
      )}
    </div>
  );
}

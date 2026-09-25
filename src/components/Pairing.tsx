// Pairing UI (ADR 0008): show an Invite (QR + code), approve or remove
// Devices, and join a vault from a code.
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Loader2, QrCode, RefreshCw, ScanLine, Trash2, X } from "lucide-react";
import { cn } from "cn";
import { api, type InviteInfo, type PairingMember, type PairingStatus, type SyncLocations } from "@/lib/api";
import { canAsk, destination, looksLikeInvite, visible } from "@/lib/onboarding";
import { LandsIn } from "@/components/LandsIn";
import { canScan, memberNode, scanCode, usePairing } from "@/lib/pairing";
import { useStore } from "@/lib/store";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function useQr(text: string | null) {
  const [svg, setSvg] = useState<string>("");
  useEffect(() => {
    if (!text) return setSvg("");
    QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M" })
      .then(setSvg)
      .catch(() => setSvg(""));
  }, [text]);
  return svg;
}

/** The vault's Invite: QR + code, pending requests, members. Needs an open vault. */
export function PairingPanel({ className, compact }: { className?: string; compact?: boolean }) {
  const t = useT();
  const s = useStore();
  const { status, refresh, lastEvent } = usePairing();
  const [code, setCode] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const syncNow = async () => {
    setSyncing(true);
    try {
      await api.pairingSyncNow();
      refresh();
    } finally {
      window.setTimeout(() => setSyncing(false), 800);
    }
  };
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const svg = useQr(code);

  const showInvite = async () => {
    setBusy(true);
    try {
      const r = await api.pairingInvite();
      setCode(r.code);
      if (s.settings?.sync_method !== "pairing") await s.setSyncMethod("pairing");
      refresh();
    } finally {
      setBusy(false);
    }
  };
  const revoke = async () => {
    const r = await api.pairingRevokeInvite();
    setCode(r.code);
  };
  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className={cn("grid gap-4", className)} data-testid="pairing-panel">
      {!code ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={showInvite} disabled={busy} data-testid="pairing-show">
            {busy ? <Loader2 className="animate-spin" /> : <QrCode />}
            {t.pairing.show_code}
          </Button>
          <span className="text-xs text-muted-foreground">{t.pairing.show_hint}</span>
        </div>
      ) : (
        <div className={cn("grid gap-4", compact ? "" : "sm:grid-cols-[auto_1fr]")}>
          <div className="mx-auto w-44 rounded-xl border bg-white p-2 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} data-testid="pairing-qr" />
          <div className="grid content-start gap-2">
            <p className="text-sm text-muted-foreground">{t.pairing.scan_hint}</p>
            <div className="flex gap-2">
              <Input readOnly value={code} className="font-mono text-xs" data-testid="pairing-code" onFocus={(e) => e.target.select()} />
              <Button variant="outline" size="icon" onClick={copy} aria-label={t.pairing.copy}>
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
            <div>
              <Button variant="ghost" size="sm" onClick={revoke} className="text-muted-foreground">
                <RefreshCw />
                {t.pairing.revoke}
              </Button>
            </div>
          </div>
        </div>
      )}
      {status && <PendingRequests status={status} onDone={refresh} />}
      {status && status.members.length > 0 && <Members status={status} onDone={refresh} />}
      {status && status.members.length > 1 && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground" data-testid="pairing-activity">
          <span>{status.connected.length > 0 ? t.pairing.connected_n(status.connected.length) : t.pairing.no_peer_online}</span>
          <Button variant="ghost" size="xs" onClick={syncNow} disabled={syncing}>
            <RefreshCw className={cn(syncing && "animate-spin")} />
            {t.pairing.sync_now}
          </Button>
          {lastEvent?.kind === "error" && <span className="text-destructive">{lastEvent.message}</span>}
          {lastEvent?.kind === "synced" && <span>{t.pairing.received_n(lastEvent.files)}</span>}
        </div>
      )}
    </div>
  );
}

function PendingRequests({ status, onDone }: { status: PairingStatus; onDone: () => void }) {
  const t = useT();
  if (status.pending.length === 0) return null;
  return (
    <ul className="grid gap-2" data-testid="pairing-pending">
      {status.pending.map((m) => (
        <li key={memberNode(m)} className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{t.pairing.wants_to_join(m.name || t.sync.unknown_device)}</span>
            <span className="block text-xs text-muted-foreground">{m.platform}</span>
          </span>
          <Button size="sm" onClick={() => api.pairingApprove(memberNode(m), true).then(onDone)} data-testid="pairing-allow">
            <Check />
            {t.pairing.allow}
          </Button>
          <Button size="sm" variant="outline" onClick={() => api.pairingApprove(memberNode(m), false).then(onDone)}>
            <X />
            {t.pairing.deny}
          </Button>
        </li>
      ))}
    </ul>
  );
}

function Members({ status, onDone }: { status: PairingStatus; onDone: () => void }) {
  const t = useT();
  const connected = useMemo(() => new Set(status.connected), [status.connected]);
  return (
    <ul className="divide-y rounded-md border text-sm" data-testid="pairing-members">
      {status.members.map((m: PairingMember) => {
        const id = memberNode(m);
        const self = id === status.node;
        const on = self || connected.has(id);
        return (
          <li key={id} className="flex items-center gap-3 px-3 py-2">
            <span className={cn("size-2 shrink-0 rounded-full", on ? "bg-type-scripture" : "bg-muted-foreground/40")} title={on ? t.pairing.online : t.pairing.offline} />
            <span className="min-w-0 flex-1">
              {/* The name gives way, not the marker: a long name must not hide which row is this Device. */}
              <span className="flex min-w-0 items-baseline gap-2 font-medium">
                <span className="truncate">{m.name || t.sync.unknown_device}</span>
                {self && <span className="shrink-0 text-xs font-normal text-muted-foreground">({t.sync.this_device})</span>}
              </span>
              <span className="block truncate text-xs text-muted-foreground">{m.platform}</span>
            </span>
            {!self && (
              <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" aria-label={t.pairing.remove} onClick={() => api.pairingRemove(id).then(onDone)}>
                <Trash2 />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

interface JoinProps {
  platform: string;
  /** Where Vaults go here, and whether the user can reach that folder. */
  locations: SyncLocations | null;
  /** Called once the join request is sent; the parent shows the waiting state. */
  onJoined: (status: PairingStatus) => void;
  /** Ask Android for the access that moves the folder somewhere visible. */
  onGrant: () => void;
}

/**
 * Enter (or scan) a code from another Device and ask to join its Vault.
 *
 * The folder is not asked for: the Invite says which Vault this is, and the
 * path follows from its name (ADR 0015). When that folder already holds a
 * different Vault the engine offers a sibling, and this says so as a fact —
 * it has already been handled, so it is not an error (ADR 0014).
 */
export function JoinPairing({ platform, locations, onJoined, onGrant }: JoinProps) {
  const t = useT();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [path, setPath] = useState("");
  const valid = looksLikeInvite(code);

  // Ask what the code is for as soon as it looks like one, then ask the engine
  // where that Vault would go. Nothing is written until Join.
  useEffect(() => {
    if (!valid) {
      setInvite(null);
      setPath("");
      return;
    }
    let alive = true;
    (async () => {
      try {
        const proposed = await api.suggestVaultPath("Synesis");
        const info = await api.inspectInvite(code.trim(), proposed);
        if (!alive) return;
        setInvite(info);
        setPath(await api.suggestVaultPath(info.vault_name));
      } catch {
        if (alive) setInvite(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [code, valid]);

  const dest = destination(locations, invite?.vault_name ?? "", path || undefined);
  const shown = path || dest.path;

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      onJoined(await api.pairingJoin(code.trim(), shown));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3" data-testid="pairing-join">
      <div className="flex gap-2">
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t.pairing.paste_code} className="font-mono text-xs" data-testid="pairing-join-code" />
        {canScan(platform) && (
          <Button
            variant="outline"
            onClick={async () => {
              const c = await scanCode();
              if (c) setCode(c);
            }}
          >
            <ScanLine />
            {t.pairing.scan}
          </Button>
        )}
      </div>
      {invite && (
        <div className="grid gap-2" data-testid="join-destination">
          <div className="text-xs text-muted-foreground">{t.join_into(invite.vault_name)}</div>
          <LandsIn path={shown} visible={visible(locations?.storage)} canAsk={canAsk(locations?.storage)} onGrant={onGrant} />
          {invite.check.kind === "occupied" && (
            // Already resolved: the sibling path above is where it goes. Said
            // as information, not as a failure (ADR 0014).
            <p className="text-xs text-muted-foreground" data-testid="join-occupied">
              {t.vault_occupied(shown, invite.check.name)}
            </p>
          )}
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div>
        <Button onClick={join} disabled={!valid || !shown || busy} data-testid="pairing-join-go">
          {busy ? <Loader2 className="animate-spin" /> : <QrCode />}
          {t.pairing.join}
        </Button>
      </div>
    </div>
  );
}

/** "Waiting for approval on …" until the node reports approval. */
export function JoinWaiting({ status }: { status: PairingStatus | null }) {
  const t = useT();
  const others = status?.members.filter((m) => memberNode(m) !== status.node).map((m) => m.name || t.sync.unknown_device) ?? [];
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-4" data-testid="pairing-waiting">
      <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />
      <div className="text-sm">
        <div className="font-medium">{t.pairing.waiting}</div>
        <div className="text-muted-foreground">{others.length ? t.pairing.waiting_on(others.join(", ")) : t.pairing.waiting_hint}</div>
      </div>
      <Badge variant="secondary" className="ml-auto">
        {status?.connected.length ? t.pairing.online : t.pairing.connecting}
      </Badge>
    </div>
  );
}

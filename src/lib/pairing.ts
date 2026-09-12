// Pairing state for the UI: polls the engine node's status and listens to its
// events. One hook, used by the wizard, the Settings card and the approval dialog.
import { useCallback, useEffect, useState } from "react";
import { api, type PairingEvent, type PairingMember, type PairingStatus } from "./api";

export function memberNode(m: PairingMember): string {
  return m.node.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function usePairing(active = true) {
  const [status, setStatus] = useState<PairingStatus | null>(null);
  const [lastEvent, setLastEvent] = useState<PairingEvent | null>(null);
  const refresh = useCallback(() => api.pairingStatus().then(setStatus).catch(() => setStatus(null)), []);
  useEffect(() => {
    if (!active) return;
    refresh();
    let un: (() => void) | undefined;
    api
      .onPairingEvent((e) => {
        setLastEvent(e);
        refresh();
      })
      .then((u) => (un = u));
    const timer = window.setInterval(refresh, 5000);
    return () => {
      un?.();
      window.clearInterval(timer);
    };
  }, [active, refresh]);
  return { status, lastEvent, refresh };
}

/** Whether this platform can scan a QR code with the camera (mobile builds only). */
export function canScan(platform: string): boolean {
  return platform === "android" || platform === "ios";
}

/** Open the camera and return the scanned pairing code, or null when cancelled/unsupported. */
export async function scanCode(): Promise<string | null> {
  try {
    const mod = await import("@tauri-apps/plugin-barcode-scanner");
    const perm = await mod.checkPermissions();
    if (perm !== "granted") {
      const asked = await mod.requestPermissions();
      if (asked !== "granted") return null;
    }
    const r = await mod.scan({ windowed: false, formats: [mod.Format.QRCode] });
    return r?.content ?? null;
  } catch {
    return null;
  }
}

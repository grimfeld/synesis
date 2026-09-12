---
status: accepted
---

# Pairing: a peer-to-peer transport over Iroh that mirrors sync snapshots

ADR 0001 made the sync core a per-device CRDT snapshot folder inside the vault and left the transport pluggable, with a user-owned cloud folder as the free default and peer-to-peer rejected as the primary path because devices must be online together. In practice the free folder path asks too much of most users (Syncthing setup, provider quirks, no path at all for iPhone + Android). We decided to add a built-in transport: paired devices connect directly over Iroh (encrypted QUIC, NAT traversal through public relays that store nothing) and mirror each other's `.bible-study/sync/<device>/` snapshot files. Nothing else changes: the existing import materialises markdown, Obsidian sees the same files, folder methods keep working and may run alongside.

## Considered options

- **Cloud-account APIs (Dropbox, Google Drive) from inside the app.** One-tap login and always-on, but each provider needs its own OAuth flow and app review, iCloud has no usable API, and the vault would depend on a third party's terms. Rejected as the default; may return as an option.
- **Hosted blob store with a free tier.** Best experience, but it is the paid path and puts every user's data on a server we run. Kept as the later always-on peer, reachable through the same pairing.
- **Bundle Syncthing as a sidecar.** Hides its UI on desktop only; impossible on iOS, not embeddable on Android. Rejected.
- **Same-network-only sync.** Private and simple, useless between home and work. Rejected.

## Consequences

- Pairing is per vault: an Invite (QR or text) shown by a paired device, valid until revoked, plus an approval tap on any paired online device. Membership and removals are gossiped; a removed device's node id is refused, its history stays.
- Changes flow only while two paired devices are online. A desktop keeps syncing from the tray after its window closes so that it becomes the always-on peer; the hosted store can later join as one more peer without changing pairing.
- The engine gains a network component (Iroh endpoint, a small protocol: manifest exchange, snapshot streaming, membership gossip) and a per-vault member list stored in the app data directory. Mobile builds need a camera (barcode) plugin.
- Public relays are a third party in the path; they see encrypted traffic only. Self-hosters can set their own relay.
- Key rotation on removal is deferred; a removed device that recorded traffic could read data encrypted under the current vault key until rotation exists.

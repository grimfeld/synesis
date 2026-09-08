---
status: accepted
---

# CRDT merge core with pluggable sync transports

The app is local-first, runs on desktop and mobile via Tauri, and must sync across devices without conflicts and without costing the author money. We decided that every device keeps its own append-only CRDT change log (Automerge or Loro, Rust core), and that markdown files on disk are a readable materialisation of the merged state rather than the source of truth for sync. Transports are interchangeable: a user-owned cloud folder (iCloud, Drive, Dropbox, Syncthing) is the free default, a hosted end-to-end-encrypted blob store is the paid convenience, and the same server is published for self-hosting.

## Considered options

- **Plain markdown files in a synced folder, no merge.** Zero cost and Obsidian-proven, but concurrent offline edits produce provider "conflicted copy" files. Rejected because both the free and paid sync paths need merge anyway.
- **CRDT over peer-to-peer relays (e.g. Iroh).** No server, but relays don't store data, so devices must be online simultaneously. Rejected as the primary path.
- **Hosted sync on a provider with metered egress (e.g. Supabase).** Egress at ~$0.09/GB makes a $5/year subscription unsustainable for users with large vaults. Hosted transport must use a provider with free egress (Cloudflare R2, Backblaze B2).

## Consequences

- Per-device state (the SQLite index, local CRDT snapshots, the device id) lives in the app's data directory, never inside the vault. Anything inside the vault folder is assumed to be synced by the provider; only `.bible-study/sync/<device>/` is meant to be, and each device writes solely to its own subfolder.
- The server is a dumb encrypted blob store; it never reads note content and cannot merge. All merging happens on device.
- External edits to the markdown files (Obsidian, text editors) must be detected and imported as CRDT changes. This is real work and is a known cost of the design.
- Pricing goal is cost recovery, not profit. Platform fees (Apple IAP, Stripe) dominate per-user cost; infrastructure is negligible.

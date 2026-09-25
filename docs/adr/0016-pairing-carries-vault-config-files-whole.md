---
status: accepted
---

# Pairing carries the Vault's config files whole, last writer wins

Pairing (ADR 0008) mirrors only `.bible-study/sync/<device>/`, the Loro snapshots of documents. Everything else in `.bible-study/` — `properties.json` (ADR 0006) today, Skins and `appearance.json` from PLAN §22 — travelled only by folder sync, so a Paired phone never saw a Property type or a Skin chosen on the desktop. We decided Pairing also carries the Vault's config files, `.bible-study/*.json` and `.bible-study/skins/*.json`, each as a whole file: the newest write wins, with no merge.

These files are small, edited on one Device at a time, and edited by deliberate action in Settings, so two Devices changing the same file between syncs is rare and losing the older edit is a cheap outcome. A document is the opposite on every count, which is why it gets a CRDT.

## Considered options

- **Leave the gap.** Folder sync covers these files already; Paired users would export and import Skins by hand. Rejected: Pairing is the one-tap sync the app promotes (PLAN §15), and a setting that silently stays on one Device reads as a bug.
- **Merge them in Loro like documents**, field by field. Correct under concurrent edits, but each file would need its own structured-merge path and Versions, for edits that almost never collide. Rejected on cost.

## Consequences

- A config file needs a modification stamp Pairing can compare that survives folder sync touching mtimes: a `updated` field written by the engine inside each file, not the filesystem mtime.
- Deleting a Skin must travel too: a deletion is a tombstone (the file kept with `deleted: true` until every known Device has seen it), otherwise the next sync from a Device that still holds it brings it back — the same resurrection the live Vault's dead phone folder already shows.
- `properties.json` gains Pairing sync as a side effect; concurrent new-Property declarations on two Devices can lose one declaration, which the next use of that name re-declares.

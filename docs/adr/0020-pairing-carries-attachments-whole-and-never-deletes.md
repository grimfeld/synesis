---
status: accepted
---

# Pairing carries attachments whole and never deletes them

Pairing (ADR 0008) mirrors the Loro snapshots of documents and, since ADR 0016, the Vault's config files. It never carried `Attachments/`, so a Cover saved on the desktop was missing on a Paired phone, and a Picture (ADR 0019) would show "Picture not found" on every Device but the one it was dropped on. We decided Pairing also carries every file in `Attachments/`, whole: each side lists its attachments by name and content hash, and fetches the ones it lacks. Nothing is ever deleted, and nothing is ever overwritten.

An attachment is immutable once written. A Picture's name carries a hash of its bytes (ADR 0019), a name already taken on this Device is never handed out again, and nothing in the app edits a picture in place, so a name identifies one set of bytes for good. That makes the transfer the simplest kind there is: no merge, no stamp, no conflict — a file one side has and the other does not is copied, and that is all. The hash is there to notice a file damaged or half-written by folder sync, not to arbitrate between versions.

No deletions, because the app does not delete attachments (ADR 0019), and a deletion made outside the app on one Device is indistinguishable, to Pairing, from a Device that has not yet received the file. Carrying deletions would need tombstones, as Skins do (ADR 0016), for an operation the app never performs.

## Considered options

- **Leave attachments to folder sync.** Pairing users would see broken Pictures. Rejected: Pairing is the one-tap sync the app promotes (PLAN §15).
- **Last writer wins, like config files.** Rejected as needless: there is only ever one writer per name.
- **Put the bytes in the Loro document** that references them. Rejected: every Version would carry the picture again, and the file would stop being a plain file Obsidian can open.

## Consequences

- A Device whose user deletes a picture in Obsidian gets it back from the next Paired Device that still holds it.
- Two Devices that each drop a picture into "Athens" before syncing do not collide: the hash in each name differs (ADR 0019). A Cover is still named after its Source alone (ADR 0012), so two Devices that each set a Cover for one Source while apart can still collide. The incoming file is then kept under the next free name and the receiving side's `cover` names its own; the hash tells them apart, nothing is overwritten.
- Writes of incoming pictures are one at a time, so two peers delivering different bytes under one name at once cannot both claim the same free name.
- The first sync after pairing a phone copies every attachment in the Vault. Pictures are kept small (ADR 0019) so that this stays cheap.

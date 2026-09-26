---
status: accepted
---

# Pairing carries attachments whole and never deletes them

Pairing (ADR 0008) mirrors the Loro snapshots of documents and, since ADR 0016, the Vault's config files. It never carried `Attachments/`, so a Cover saved on the desktop was missing on a Paired phone, and a Picture (ADR 0018) would show "Picture not found" on every Device but the one it was dropped on. We decided Pairing also carries every file in `Attachments/`, whole: each side lists its attachments by name and content hash, and fetches the ones it lacks. Nothing is ever deleted, and nothing is ever overwritten.

An attachment is immutable once written. `unique_path` never hands out a name that is taken, and nothing in the app edits a picture in place, so a name identifies one set of bytes for good. That makes the transfer the simplest kind there is: no merge, no stamp, no conflict — a file one side has and the other does not is copied, and that is all. The hash is there to notice a file damaged or half-written by folder sync, not to arbitrate between versions.

No deletions, because the app does not delete attachments (ADR 0018), and a deletion made outside the app on one Device is indistinguishable, to Pairing, from a Device that has not yet received the file. Carrying deletions would need tombstones, as Skins do (ADR 0016), for an operation the app never performs.

## Considered options

- **Leave attachments to folder sync.** Pairing users would see broken Pictures. Rejected: Pairing is the one-tap sync the app promotes (PLAN §15).
- **Last writer wins, like config files.** Rejected as needless: there is only ever one writer per name.
- **Put the bytes in the Loro document** that references them. Rejected: every Version would carry the picture again, and the file would stop being a plain file Obsidian can open.

## Consequences

- A Device whose user deletes a picture in Obsidian gets it back from the next Paired Device that still holds it.
- Two Devices that each write the same new name offline (both drop a picture into "Athens" before syncing) collide. The hash tells them apart; the incoming file is kept under the next free name, and the text on the receiving side still names its own. The sender's reference then points at a different picture on the receiver until the next edit is noticed — rare, and visible rather than lost.
- The first sync after pairing a phone copies every attachment in the Vault. Pictures are kept small (ADR 0018) so that this stays cheap.

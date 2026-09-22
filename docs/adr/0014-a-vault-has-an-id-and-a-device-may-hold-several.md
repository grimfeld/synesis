---
status: accepted
---

# A Vault has an id of its own, and a Device may hold several

A Vault was identified by nothing but the folder it sat in. `do_open_vault`
took a path, created it if it was missing, and opened whatever was inside;
`pairing_join` did the same before starting the transfer. Two Vaults that
happened to land on one path therefore became one Vault, and neither the app
nor the user had any way to notice before it happened.

On 2026-09-17 that is exactly what happened. The mobile join path defaults to
`<documents>/Synesis vaults/Synesis` — a fixed name, proposed for every join —
and the phone already held the demo vault there. Joining a second Vault
materialised its snapshots into an occupied folder, the CRDT merged both sets
as it is designed to, and the merge then synced back to the desktop, taking
`F:\WORKPLACE\VAULTS\main` from 35 documents to 405. Nothing was overwritten —
a merge adds — but the user's own work was interleaved with fixtures, and
there was no undo.

We decided a Vault carries its own identity: a ULID and a name in
`.bible-study/vault.json`, written when the Vault comes into being and never
changed. An Invite names the Vault id it is for. Joining compares:

- **An empty folder** adopts the Invite's id. This is the ordinary case.
- **The same id** is a re-pair or a reinstall, and proceeds.
- **A different id** is refused, naming the Vault that occupies the folder and
  offering a sibling path instead.

Refusing is the point. Merging two Vaults is unbounded and irreversible, it is
never what anyone wanted, and a confirmation dialog would be shown at the exact
moment a user is least able to judge it — the same reasoning as the release
workflow's refusal to publish an unsigned APK: failing is better than a result
that looks complete and is not.

A Device also keeps a list of the Vaults it holds — id, name and local path —
added when one is made or joined and removed deliberately. That is separate
from the recents list, which is a history: opening eight other folders used to
push a Vault out of `recent` entirely, which is how a real Vault can go
missing from the only UI that lists one.

## Considered options

- **Make the mobile default unique** (`Synesis vaults/<name>`) and change
  nothing else. Fixes this instance and not the class: two Vaults whose names
  collide still merge in silence, and a renamed folder still becomes a
  different Vault. Kept as part of the fix, not as the fix.
- **Identity from the pairing membership.** No new file, but the identity would
  live only in the Device's app data, so a Vault copied to another machine or
  opened fresh could not say what it is — and saying what it is, to a Device
  that has never seen it, is the whole job.
- **Derive the id by hashing the documents** so two Devices holding copies of
  one pre-existing Vault agree without being told. Rejected: an identity
  computed from content that syncing changes is not an identity.
- **Warn and let the user proceed.** Respects their judgement about their own
  files, and was rejected because the consequence is permanent and the warning
  arrives during a join, when the user is looking at a phone and has no way to
  inspect what would be merged.

## Consequences

- `vault.json` lives in `.bible-study/`, which Obsidian ignores, so ADR 0003
  holds: the vault is still a plain folder of markdown.
- A Vault that predates this gets an id the first time it is opened, named from
  its folder. Two Devices that separately adopt copies of one pre-existing
  Vault will invent different ids; the first join between them refuses and says
  so, which is the correct outcome for two folders that have diverged.
- A Vault's name travels with it, so the same Vault reads the same on every
  Device and an Invite can say what is being joined before it is accepted. The
  folder name stays local.
- The mobile default path is derived from the Vault's name, with a numeric
  suffix when taken, so joining `main` proposes `Synesis vaults/main`.

## Amendment (2026-09-22): a Device's claim on a Vault is the roster, not a folder

The merge this ADR prevents came back in a second form. A phone was re-paired
after its vault folders were separated, and documents that were not part of the
Vault appeared on it and synced to the desktop — from an empty folder.

The Vault held two sync folders for one phone, under two device ids. The retired
id's 636 snapshots had never been removed, because nothing removes another
Device's folder: `import_remote` and the pairing manifest walked every directory
in `sync/` and trusted each one, so a Device was trusted because a folder
bearing its name existed. Pairing mirrored the dead folder to the phone; the
phone materialised 190 documents the Vault no longer had; `publish_missing`
republished 84 of them under the phone's *new* id; the round pushed them back.

So: **a folder in `sync/` is not a claim on the Vault. The pairing roster is.**

- A Device removed from the roster is recorded by its device id
  (`Membership.removed_devices`), not only by its node id — a node id names a
  peer, and the snapshots live under a device id. Removals merge in both
  directions and are never forgotten, so a Device that reappears is not trusted
  again by virtue of reappearing.
- Trust is a blocklist, never a whitelist. A folder the roster has never heard
  of is still read: that is what a folder-synced Vault looks like (no roster at
  all, ADR 0001), and what a Device paired while this one was offline looks like
  before the two memberships meet.
- Approving a Device is the one act that lifts a retirement, so a Device that
  was evicted, wiped and paired again can come back.
- Removing a Vault from a Device is therefore a real operation, not a matter of
  forgetting a path: `Vault::leave` withdraws this Device's snapshots so the
  others stop mirroring them, then drops its index and CRDT, and optionally the
  documents. Evicting another Device (`forget_device`) retires it in the roster
  *before* deleting its folder, so a crash between the two leaves a Vault that
  still syncs rather than a folder that will be trusted again.

Document identity is untouched and still per-Device: the same verse note created
on two Devices gets two ULIDs, so a resurrected file lands beside the original
rather than being recognised as a duplicate. Removal stops new ghosts; it does
not make existing duplicates detectable.

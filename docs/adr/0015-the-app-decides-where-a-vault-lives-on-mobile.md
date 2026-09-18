---
status: accepted
---

# The app decides where a Vault lives on mobile, and it lives where the Files app can see it

On mobile the wizard asked the user for a Vault path. It was a text field with
no folder picker (`can_pick_folder` is false on Android and iOS), pre-filled
with `<documents>/Synesis vaults/Synesis` — a path the user could edit but had
no way to browse, verify, or reach afterwards.

`document_dir()` on Android resolves to `getExternalFilesDir(DOCUMENTS)`, which
is `/storage/emulated/0/Android/data/tech.grimfeld.synesis/files/Documents`.
Since Android 11 the stock Files app refuses to browse `Android/data/`, and so
do most third-party file managers. A Vault created there is, from the user's
side of the screen, gone: not visible in Files, not openable by Obsidian, not
copyable off the device. ADR 0003 says the vault is a plain Obsidian-compatible
folder; on Android it was a plain folder nobody could open.

We decided the app chooses the path and the user chooses the name.

- **Mobile has no path choice at all.** A Vault called `main` lives at
  `<shared Documents>/Synesis/main`, with `free_path`'s numeric suffix when the
  name is taken. Android reaches that folder with `MANAGE_EXTERNAL_STORAGE`;
  iOS reaches its own Documents container with `UIFileSharingEnabled` and
  `LSSupportsOpeningDocumentsInPlace`, and needs no permission.
- **Desktop keeps the picker**, and keeps proposing a path inside the chosen
  sync tool's folder, because iCloud Drive and the provider clients have a
  fixed location that syncs with no further setup (PLAN §14.3).
- **The folder-sync method inverts on mobile.** Android has no canonical synced
  folder to create a Vault inside — Syncthing's is wherever the user put it —
  so the tutorial now points the sync tool at `Documents/Synesis` rather than
  the app hunting for the tool's folder. Discovery still scans the known roots,
  so a Vault already sitting in one is still found and offered.

Asking for "All files access" is a real cost: it is a system-settings trip, and
Google Play requires a declaration justifying it. We accept it because the
alternatives are worse. The Storage Access Framework hands out `content://`
URIs, and the engine is built on `std::fs` (ADR 0004) — adopting SAF means a
virtual filesystem under every read and write in the engine, for a folder the
user still could not hand to Obsidian. A `DocumentsProvider` would surface the
Vault inside the Files app without any permission, but only to apps that go
through the provider; Obsidian, opening a path, would still see nothing.
Obsidian's own Android app takes the same permission for the same reason.

Permission is asked at the moment a Vault location is needed — on the screen
that shows where the Vault will go — and refusing it does not block anything.
The path preview switches to the `Android/data/` fallback and says it will be
hidden from the Files app. A user who declines gets a working Vault in a place
they cannot browse, which is exactly what they asked for, and Settings offers
to move it later.

## Considered options

- **Storage Access Framework.** No scary permission and Play asks no questions,
  but `content://` URIs are not paths: the engine, the watcher and every
  `fs::` call in `vault.rs` would need a VFS seam, and the result still would
  not be a folder Obsidian can open. Rejected on cost and on outcome.
- **A `DocumentsProvider` over the app-private folder.** Manifest-only, no
  permission, and the Vault appears in the Files app under a Synesis entry.
  Rejected because it is visible only through the provider: a path-based reader
  like Obsidian sees nothing, and the point is a folder that is shared.
- **Keep the path field and only change the default.** The field was never
  usable on a phone — no picker, no browsing, no way to check the result — so
  the choice it offered was not a real one. Removing it is the fix; a better
  default alone leaves the confusing field in place.
- **Migrate existing Vaults automatically** on the first launch after the
  update. Rejected for the same reason ADR 0014 refuses a silent merge: moving
  a user's files without asking, on a device that may sleep mid-copy, is a
  permanent consequence decided by the app. Settings offers the move instead.

## Consequences

- `MANAGE_EXTERNAL_STORAGE` goes in the Android manifest, injected by
  `scripts/android-post-init.mjs` alongside the existing `adjustResize` and
  window-inset patches, because `src-tauri/gen/` is generated and gitignored.
  The Play listing needs a justification for the permission.
- The shell gains `storage_access` and `request_storage_access`. Off Android
  they report `{ needed: false, granted: true }`, so the UI has one shape.
- `suggest_vault_path`'s parent becomes `Synesis` rather than `Synesis vaults`,
  on every platform. Existing Vaults are unaffected: they are found through
  `settings.vaults` (ADR 0014), not by scanning that folder.
- A Vault's folder name and its name can differ — already true under ADR 0014,
  and now the ordinary case on mobile, since renaming a Vault never moves it.
- Vaults created before this change stay in `Android/data/`. Settings gains a
  per-Vault "Move to Documents", which closes the Vault, copies the folder,
  updates `settings.vaults` and reopens it at the new path.

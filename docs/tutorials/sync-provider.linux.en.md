# Dropbox, OneDrive or Google Drive on Linux

OneDrive, Google Drive and Dropbox all offer a free tier (5 GB, 15 GB and 2 GB) and a desktop app that mirrors a folder on every computer signed in. Put the vault inside that folder. Their phone apps do **not** mirror folders, so this covers computers only; add Syncthing later if a phone joins.

Only Dropbox ships an official Linux client. For OneDrive and Google Drive, community clients work well; if you would rather avoid them, Syncthing (the other tab) needs no account at all.

## Dropbox (official)

1. Install from [dropbox.com/install-linux](https://www.dropbox.com/install-linux) (deb/rpm) or your distribution's package, then run `dropbox start -i` once and sign in.
2. Folder: `~/Dropbox`. Create the vault at `~/Dropbox/Synesis`.

## OneDrive (abraunegg/onedrive)

1. Install `onedrive` from your distribution or [github.com/abraunegg/onedrive](https://github.com/abraunegg/onedrive).
2. Run `onedrive` once to sign in, then enable the service: `systemctl --user enable --now onedrive`.
3. Folder: `~/OneDrive`. Create the vault at `~/OneDrive/Synesis`.

## Google Drive (rclone mount or GNOME Online Accounts)

1. GNOME: **Settings → Online Accounts → Google**, tick *Files*; Drive appears in Files. It is a network mount, slower and not always available offline; prefer rclone for a real mirror: `rclone config` (Google Drive), then `rclone bisync gdrive:Synesis ~/GoogleDrive/Synesis` on a timer.
2. Create the vault at `~/GoogleDrive/Synesis`.

## Rules for a reliable vault

- Turn **off** "files on demand" / "online-only" for the vault folder, or mark the Synesis folder *Always keep on this device*. Synesis reads files directly; a placeholder that is not downloaded looks empty.
- Do not open the vault from two computers with the desktop app **paused** on one of them for days; the merge copes, but the longer the gap, the more `.bible-study/sync/` has to reconcile at once.
- Provider "conflicted copy" files can appear if two computers save within the same second. Delete the copy; Synesis's merged text is in the original.


## Check that it works

1. On this device, create a Note (Quick capture, `Ctrl/⌘ ⇧ N`) with a line such as *sync test from this device*.
2. Wait for the sync tool's icon to show it has finished uploading.
3. On the other device, open Synesis (or relaunch it). The Note appears in the sidebar under Notes, and Home lists it as recent.
4. Edit the same Note on both devices while one of them is offline, then reconnect. Both edits survive: Synesis keeps a change log per device inside `.bible-study/sync/` and merges them; the sync tool never has to resolve a conflict. If it still produces a "conflicted copy" file, delete that copy: the merged text is already in the original file.

## Good to know

- Everything in the vault folder is synced, including the hidden `.bible-study` folder. Do not exclude it.
- Keep only one Synesis (or Obsidian) instance editing a file at a time; the merge handles offline edits, not two cursors in the same line at the same second.
- Settings → Sync lists every device that has published into the vault and when it last did.

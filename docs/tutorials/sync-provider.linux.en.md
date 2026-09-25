# Dropbox, OneDrive or Google Drive on Linux

OneDrive, Google Drive and Dropbox all offer a free tier (5 GB, 15 GB and 2 GB) and a desktop app that mirrors a folder on every computer signed in. Put the vault inside that folder. Their phone apps do **not** mirror folders, so this covers computers only; add Syncthing later if a phone joins.

Only Dropbox ships an official Linux client. For OneDrive and Google Drive, community clients work well; if you would rather avoid them, Syncthing (the other tab) needs no account at all.

1. Install a client for your provider and create the vault in its folder:
   - **Dropbox** (official)
     - Install from [dropbox.com/install-linux](https://www.dropbox.com/install-linux) (deb/rpm) or your distribution's package, then run `dropbox start -i` once and sign in.
     - Folder: `~/Dropbox`. Create the vault at `~/Dropbox/Synesis`.
   - **OneDrive** (abraunegg/onedrive)
     - Install `onedrive` from your distribution or [github.com/abraunegg/onedrive](https://github.com/abraunegg/onedrive).
     - Run `onedrive` once to sign in, then enable the service: `systemctl --user enable --now onedrive`.
     - Folder: `~/OneDrive`. Create the vault at `~/OneDrive/Synesis`.
   - **Google Drive** (rclone mount or GNOME Online Accounts)
     - GNOME: **Settings → Online Accounts → Google**, tick *Files*; Drive appears in Files. It is a network mount, slower and not always available offline; prefer rclone for a real mirror: `rclone config` (Google Drive), then `rclone bisync gdrive:Synesis ~/GoogleDrive/Synesis` on a timer.
     - Create the vault at `~/GoogleDrive/Synesis`.
2. Keep the vault on this computer: turn **off** "files on demand" / "online-only" for the vault folder, or mark the Synesis folder *Always keep on this device*. Synesis reads files directly; a placeholder that is not downloaded looks empty.
3. Try it once: on this computer, create a Note with [Quick capture](command:create.quick) holding a line such as *sync test from this device*. Wait for the sync tool's icon to show it has finished uploading, then open Synesis on the other computer (or relaunch it): the Note appears in the sidebar under Notes, and Home lists it as recent. Delete the test Note afterwards with the delete button in its header.

## Good to know

- Do not open the vault from two computers with the desktop app **paused** on one of them for days; the merge copes, but the longer the gap, the more `.bible-study/sync/` has to reconcile at once.
- Edit the same Note on both computers while one of them is offline, then reconnect: both edits survive. Synesis keeps a change log per device inside `.bible-study/sync/` and merges them; the sync tool never has to resolve a conflict. Provider "conflicted copy" files can still appear if two computers save within the same second. Delete the copy; Synesis's merged text is in the original.
- Everything in the vault folder is synced, including the hidden `.bible-study` folder. Do not exclude it.
- Keep only one Synesis (or Obsidian) instance editing a file at a time; the merge handles offline edits, not two cursors in the same line at the same second.
- Settings → Sync lists every device that has published into the vault and when it last did.

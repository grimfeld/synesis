# OneDrive, Google Drive or Dropbox on Windows

OneDrive, Google Drive and Dropbox all offer a free tier (5 GB, 15 GB and 2 GB) and a desktop app that mirrors a folder on every computer signed in. Put the vault inside that folder. Their phone apps do **not** mirror folders, so this covers computers only; add Syncthing later if a phone joins.

1. Install your provider's client, set it to keep files on this computer, and create the vault in its folder:
   - **OneDrive** (built into Windows)
     - Click the cloud icon in the taskbar, sign in with a Microsoft account. Your folder is `C:\Users\<you>\OneDrive`.
     - Right-click the OneDrive folder → **Always keep on this device**, or in OneDrive **Settings → Sync and backup → Advanced** turn *Files On-Demand* off.
     - Create the vault at `C:\Users\<you>\OneDrive\Synesis` (Synesis proposes it).
   - **Google Drive for desktop**
     - Install from [google.com/drive/download](https://www.google.com/drive/download/), sign in.
     - In **Preferences → Google Drive**, choose **Mirror files** (not *Stream files*). The folder is `C:\Users\<you>\My Drive` or `G:\My Drive`.
     - Create the vault at `…\My Drive\Synesis`.
   - **Dropbox**
     - Install from [dropbox.com/install](https://www.dropbox.com/install), sign in. Folder: `C:\Users\<you>\Dropbox`.
     - In **Preferences → Sync**, set new files to *Local* (not *Online-only*).
     - Create the vault at `C:\Users\<you>\Dropbox\Synesis`.
2. Keep the vault on this computer: turn **off** "files on demand" / "online-only" for the vault folder, or mark the Synesis folder *Always keep on this device*. Synesis reads files directly; a placeholder that is not downloaded looks empty.
3. Try it once: on this computer, create a Note with [Quick capture](command:create.quick) holding a line such as *sync test from this device*. Wait for the sync tool's icon to show it has finished uploading, then open Synesis on the other computer (or relaunch it): the Note appears in the sidebar under Notes, and Home lists it as recent. Delete the test Note afterwards with the delete button in its header.

## Good to know

- Do not open the vault from two computers with the desktop app **paused** on one of them for days; the merge copes, but the longer the gap, the more `.bible-study/sync/` has to reconcile at once.
- Edit the same Note on both computers while one of them is offline, then reconnect: both edits survive. Synesis keeps a change log per device inside `.bible-study/sync/` and merges them; the sync tool never has to resolve a conflict. Provider "conflicted copy" files can still appear if two computers save within the same second. Delete the copy; Synesis's merged text is in the original.
- Everything in the vault folder is synced, including the hidden `.bible-study` folder. Do not exclude it.
- Keep only one Synesis (or Obsidian) instance editing a file at a time; the merge handles offline edits, not two cursors in the same line at the same second.
- Settings → Sync lists every device that has published into the vault and when it last did.

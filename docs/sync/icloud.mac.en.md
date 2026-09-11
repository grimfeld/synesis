# iCloud Drive on a Mac

Free with any Apple ID (5 GB included; a vault of thousands of notes is a few megabytes). Reaches every Mac, iPhone and iPad signed in to the same Apple ID, and Windows through iCloud for Windows.

## Set up

1. Open **System Settings → [your name] → iCloud → iCloud Drive** and make sure iCloud Drive is **on**.
2. Under *Optimise Mac Storage*, turn it **off** for a reliable vault: with it on, macOS may evict files to the cloud and Synesis would see an empty folder until they download again.
3. In Finder, open **iCloud Drive** (sidebar) and create a folder named **Synesis**. Its path is `~/Library/Mobile Documents/com~apple~CloudDocs/Synesis`; Synesis proposes it in the next step.
4. Create the vault inside that folder. On this Mac that is all.

## On your other Apple devices

- **Another Mac**: sign in to the same Apple ID, turn iCloud Drive on, launch Synesis: it finds the vault under *Synced from this Mac* and opens it.
- **iPhone / iPad**: install Synesis, open it, choose *iCloud Drive* in the wizard; the vault appears in the Files app under iCloud Drive → Synesis and Synesis offers it.

## Notes

- iCloud syncs file by file, usually within seconds on Wi-Fi. Large first uploads can take minutes.
- If a file shows a cloud icon with an arrow in Finder, it is not downloaded yet. Right-click → *Download Now*, or turn *Optimise Mac Storage* off as above.

## Check that it works

1. On this device, create a Note (Quick capture, `Ctrl/⌘ ⇧ N`) with a line such as *sync test from this device*.
2. Wait for the sync tool's icon to show it has finished uploading.
3. On the other device, open Synesis (or relaunch it). The Note appears in the sidebar under Notes, and Home lists it as recent.
4. Edit the same Note on both devices while one of them is offline, then reconnect. Both edits survive: Synesis keeps a change log per device inside `.bible-study/sync/` and merges them; the sync tool never has to resolve a conflict. If it still produces a "conflicted copy" file, delete that copy: the merged text is already in the original file.

## Good to know

- Everything in the vault folder is synced, including the hidden `.bible-study` folder. Do not exclude it.
- Keep only one Synesis (or Obsidian) instance editing a file at a time; the merge handles offline edits, not two cursors in the same line at the same second.
- Settings → Sync lists every device that has published into the vault and when it last did.

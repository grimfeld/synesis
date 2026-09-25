# iCloud Drive on iPhone and iPad

The only free way to reach an iPhone or iPad. Works with a Mac, another iOS device, or Windows with iCloud for Windows.

## Set up

1. **Settings → [your name] → iCloud → iCloud Drive**: turn **Sync this iPhone** on.
2. Still in iCloud settings, tap **Show All** apps and make sure **Synesis** is allowed to use iCloud Drive.
3. Open the **Files** app → Browse → **iCloud Drive**. If the vault was created on another device, a **Synesis** folder is already there; open it once so its files download.
4. Launch Synesis and choose *iCloud Drive* in the wizard. The vault appears under *Synced from …*; tap it. Otherwise choose *Create* and Synesis makes the folder inside iCloud Drive.

## Notes

- iOS downloads files on demand. The first time you open a large vault, give it a minute on Wi-Fi; Synesis indexes what is present and picks up the rest as it arrives.
- Low Power Mode pauses iCloud sync. Plug in or disable it after a long writing session.
- Editing the same Note on iPhone and Mac at once is fine when both are online; offline edits merge when the device reconnects.

## Check that it works

1. On this device, create a Note (Quick capture, `Ctrl/⌘ ⇧ N`) with a line such as *sync test from this device*.
2. Wait for the sync tool's icon to show it has finished uploading.
3. On the other device, open Synesis (or relaunch it). The Note appears in the sidebar under Notes, and Home lists it as recent.
4. Edit the same Note on both devices while one of them is offline, then reconnect. Both edits survive: Synesis keeps a change log per device inside `.bible-study/sync/` and merges them; the sync tool never has to resolve a conflict. If it still produces a "conflicted copy" file, delete that copy: the merged text is already in the original file.

## Good to know

- Everything in the vault folder is synced, including the hidden `.bible-study` folder. Do not exclude it.
- Keep only one Synesis (or Obsidian) instance editing a file at a time; the merge handles offline edits, not two cursors in the same line at the same second.
- Settings → Sync lists every device that has published into the vault and when it last did.

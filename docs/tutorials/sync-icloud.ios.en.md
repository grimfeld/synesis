# iCloud Drive on iPhone and iPad

The only free way to reach an iPhone or iPad. Works with a Mac, another iOS device, or Windows with iCloud for Windows.

1. **Settings → [your name] → iCloud → iCloud Drive**: turn **Sync this iPhone** on.
2. Still in iCloud settings, tap **Show All** apps and make sure **Synesis** is allowed to use iCloud Drive.
3. Open the **Files** app → Browse → **iCloud Drive**. If the vault was created on another device, a **Synesis** folder is already there; open it once so its files download.
4. Launch Synesis and choose *iCloud Drive* in the wizard. The vault appears under *Synced from …*; tap it. Otherwise choose *Create* and Synesis makes the folder inside iCloud Drive.
5. Try it once: on this device, create a Note with [Quick capture](command:create.quick) holding a line such as *sync test from this device*. Wait for the sync tool's icon to show it has finished uploading, then open Synesis on the other device (or relaunch it): the Note appears in the sidebar under Notes, and Home lists it as recent. Delete the test Note afterwards with the delete button in its header.

## Good to know

- iOS downloads files on demand. The first time you open a large vault, give it a minute on Wi-Fi; Synesis indexes what is present and picks up the rest as it arrives.
- Low Power Mode pauses iCloud sync. Plug in or disable it after a long writing session.
- Editing the same Note on iPhone and Mac at once is fine when both are online; offline edits merge when the device reconnects. Synesis keeps a change log per device inside `.bible-study/sync/` and merges them; the sync tool never has to resolve a conflict. If it still produces a "conflicted copy" file, delete that copy: the merged text is already in the original file.
- Everything in the vault folder is synced, including the hidden `.bible-study` folder. Do not exclude it.
- Keep only one Synesis (or Obsidian) instance editing a file at a time; the merge handles offline edits, not two cursors in the same line at the same second.
- Settings → Sync lists every device that has published into the vault and when it last did.

# iCloud Drive on iPhone and iPad

The only free folder sync that reaches an iPhone or iPad. Works with a Mac, another iPhone or iPad, or Windows with iCloud for Windows. Synesis keeps its vaults in its own iCloud Drive folder, **Synesis**, which every one of your Apple devices sees.

1. **Settings → [your name] → iCloud → iCloud Drive**: turn **Sync this iPhone** on. Still in iCloud settings, tap **Show All** and make sure **Synesis** is allowed to use iCloud.
2. Launch Synesis and choose **Use a synced folder**. Tick the other devices you use: iCloud Drive is recommended. If the wizard says iCloud is not available, Synesis cannot reach iCloud yet: check step 1, then come back.
3. A vault already in iCloud Drive → Synesis (made on your Mac or another iPhone) is listed under *Synced from …*; tap it. Otherwise name the vault and choose **Create vault**: Synesis makes it in iCloud Drive → Synesis, and the Files app shows it there.
4. Try it once: on this device, create a Note with [Quick capture](command:create.quick) holding a line such as *sync test from this device*. Wait for the sync tool's icon to show it has finished uploading, then open Synesis on the other device (or relaunch it): the Note appears in the sidebar under Notes, and Home lists it as recent. Delete the test Note afterwards with the delete button in its header.

## Good to know

- iOS keeps files in iCloud and downloads them when needed, and may offload files you have not opened for a while. Synesis keeps such a document listed, asks iCloud for it, and opens it once it has arrived; until then it cannot be edited, so nothing is written over the copy in iCloud. The first time you open a large vault, give it a minute on Wi-Fi.
- Low Power Mode pauses iCloud sync. Plug in or disable it after a long writing session.
- A vault created on this iPhone with *Just this device*, or with Synesis 0.0.19 or earlier, lives in Files → On My iPhone → Synesis and does not sync through iCloud. Pair it with your other device instead, or create a vault in iCloud and copy its notes across in the Files app.
- Editing the same Note on iPhone and Mac at once is fine when both are online; offline edits merge when the device reconnects. Synesis keeps a change log per device inside `.bible-study/sync/` and merges them; the sync tool never has to resolve a conflict. If it still produces a "conflicted copy" file, delete that copy: the merged text is already in the original file.
- Everything in the vault folder is synced, including the hidden `.bible-study` folder. Do not exclude it.
- Settings → Sync lists every device that has published into the vault and when it last did.

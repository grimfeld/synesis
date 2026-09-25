# Syncthing on Android

Syncthing copies a folder directly between your own devices, encrypted, with no account and no cloud. Free and open source on Windows, macOS, Linux and Android (not iOS). Devices sync whenever two of them are online at the same time; a device that stays on (a desktop, a NAS) makes the others sync faster.

1. Install **Syncthing-Fork** from [F-Droid](https://f-droid.org/packages/com.github.catfriend1.syncthingandroid/) or Google Play. (The original Syncthing app was retired from Play in 2024; the Fork is maintained.)

   Open it and grant the permissions it asks for: **All files access** (so it can write the vault folder) and **Ignore battery optimisation** (so it keeps syncing in the background). In the app's **Settings → Run conditions**, choose when it runs: *always* or *only on Wi-Fi* and *when charging* if you want to save battery.
2. Make the vault first. Android has no folder a sync tool is guaranteed to watch, so Synesis makes the vault and you point Syncthing at it — rather than the other way round.

   In Synesis, choose *Use a synced folder*, name the vault, and allow file access when it asks. The screen shows the folder it will use, normally `Documents/Synesis/<name>`. Tap **Create vault**, and note the path on that screen; the next steps need it.
3. Pair with your desktop. In Syncthing-Fork, tap **Devices → +**. Scan the QR code shown on the desktop under *Actions → Show ID*, or paste the ID. Give the desktop a name. On the desktop, accept the *New Device* prompt.
4. Share the vault. In Syncthing-Fork, tap **Folders → +** and choose the folder Synesis showed you (`Documents/Synesis/<name>`). Give it a folder ID you will recognise, and share it with the desktop. On the desktop, accept the *New Folder* prompt and point it at the vault folder there — the same vault, if the desktop already has one, or an empty folder if it does not. Wait for the folder to show *Up to date* on both.
5. Try it once: on this device, create a Note with [Quick capture](command:create.quick) holding a line such as *sync test from this device*. Wait for the sync tool's icon to show it has finished uploading, then open Synesis on the other device (or relaunch it): the Note appears in the sidebar under Notes, and Home lists it as recent. Delete the test Note afterwards with the delete button in its header.

## Good to know

- Edit the same Note on both devices while one of them is offline, then reconnect: both edits survive. Synesis keeps a change log per device inside `.bible-study/sync/` and merges them; the sync tool never has to resolve a conflict. If it still produces a "conflicted copy" file, delete that copy: the merged text is already in the original file.
- Everything in the vault folder is synced, including the hidden `.bible-study` folder. Do not exclude it.
- Keep only one Synesis (or Obsidian) instance editing a file at a time; the merge handles offline edits, not two cursors in the same line at the same second.
- Settings → Sync lists every device that has published into the vault and when it last did.

# Syncthing on Android

Syncthing copies a folder directly between your own devices, encrypted, with no account and no cloud. Free and open source on Windows, macOS, Linux and Android (not iOS). Devices sync whenever two of them are online at the same time; a device that stays on (a desktop, a NAS) makes the others sync faster.

## Install

1. Install **Syncthing-Fork** from [F-Droid](https://f-droid.org/packages/com.github.catfriend1.syncthingandroid/) or Google Play. (The original Syncthing app was retired from Play in 2024; the Fork is maintained.)
2. Open it and grant the permissions it asks for: **All files access** (so it can write the vault folder) and **Ignore battery optimisation** (so it keeps syncing in the background).
3. In the app's **Settings → Run conditions**, choose when it runs: *always* or *only on Wi-Fi* and *when charging* if you want to save battery.

## Pair with your desktop

1. In Syncthing-Fork, tap **Devices → +**. Scan the QR code shown on the desktop under *Actions → Show ID*, or paste the ID. Give the desktop a name.
2. On the desktop, accept the *New Device* prompt.
3. On the desktop, share the *Synesis* folder with the phone (**Edit folder → Sharing**).
4. On the phone, accept the *New Folder* prompt. Set its path to **Internal storage → Sync → Synesis** (`/storage/emulated/0/Sync/Synesis`); Synesis looks there.
5. Wait for the folder to show *Up to date*.

## Open the vault in Synesis

Launch Synesis, choose *Syncthing* in the wizard; the vault appears under *Synced from <your desktop>*. Tap it.


## Check that it works

1. On this device, create a Note (Quick capture, `Ctrl/⌘ ⇧ N`) with a line such as *sync test from this device*.
2. Wait for the sync tool's icon to show it has finished uploading.
3. On the other device, open Synesis (or relaunch it). The Note appears in the sidebar under Notes, and Home lists it as recent.
4. Edit the same Note on both devices while one of them is offline, then reconnect. Both edits survive: Synesis keeps a change log per device inside `.bible-study/sync/` and merges them; the sync tool never has to resolve a conflict. If it still produces a "conflicted copy" file, delete that copy: the merged text is already in the original file.

## Good to know

- Everything in the vault folder is synced, including the hidden `.bible-study` folder. Do not exclude it.
- Keep only one Synesis (or Obsidian) instance editing a file at a time; the merge handles offline edits, not two cursors in the same line at the same second.
- Settings → Sync lists every device that has published into the vault and when it last did.

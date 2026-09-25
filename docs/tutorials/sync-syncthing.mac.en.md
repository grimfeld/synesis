# Syncthing on a Mac

Syncthing copies a folder directly between your own devices, encrypted, with no account and no cloud. Free and open source on Windows, macOS, Linux and Android (not iOS). Devices sync whenever two of them are online at the same time; a device that stays on (a desktop, a NAS) makes the others sync faster.

## Install

1. Install **Syncthing for macOS** (menu-bar app) from [github.com/syncthing/syncthing-macos/releases](https://github.com/syncthing/syncthing-macos/releases), or with Homebrew: `brew install --cask syncthing`.
2. Launch it; a Syncthing icon appears in the menu bar. It starts at login by default.
3. If macOS asks, allow incoming connections.

## Pair the devices

1. On this device, open the Syncthing web UI (it opens in the browser; the tray icon has *Open*). Under **Actions → Show ID**, copy the long **Device ID**.
2. On the other device, **Add Remote Device**, paste the ID, give it a name, save. Back on this device, accept the *New Device* prompt that appears in the web UI.
3. On this device, **Add Folder**: pick the Synesis vault folder (created in the next step, or already there), give it the label *Synesis*, and under **Sharing** tick the other device. Save.
4. On the other device, accept the *New Folder* prompt and choose where to put it (`~/Sync/Synesis` is a good default; Synesis looks there). Sync starts immediately.

## Settings that matter

- **Folder type**: *Send & Receive* on every device.
- **File versioning**: optional. *Staggered* keeps old copies in `.stversions/` outside Synesis's sight.
- **Ignore patterns**: none needed. The hidden `.bible-study/` folder must sync too.
- Give each device a readable name; Synesis shows it as *Synced from <name>*.

Suggested vault path on a Mac: `~/Sync/Synesis`.

## Check that it works

1. On this device, create a Note (Quick capture, `Ctrl/⌘ ⇧ N`) with a line such as *sync test from this device*.
2. Wait for the sync tool's icon to show it has finished uploading.
3. On the other device, open Synesis (or relaunch it). The Note appears in the sidebar under Notes, and Home lists it as recent.
4. Edit the same Note on both devices while one of them is offline, then reconnect. Both edits survive: Synesis keeps a change log per device inside `.bible-study/sync/` and merges them; the sync tool never has to resolve a conflict. If it still produces a "conflicted copy" file, delete that copy: the merged text is already in the original file.

## Good to know

- Everything in the vault folder is synced, including the hidden `.bible-study` folder. Do not exclude it.
- Keep only one Synesis (or Obsidian) instance editing a file at a time; the merge handles offline edits, not two cursors in the same line at the same second.
- Settings → Sync lists every device that has published into the vault and when it last did.

# Syncthing on Windows

Syncthing copies a folder directly between your own devices, encrypted, with no account and no cloud. Free and open source on Windows, macOS, Linux and Android (not iOS). Devices sync whenever two of them are online at the same time; a device that stays on (a desktop, a NAS) makes the others sync faster.

1. Download **SyncTrayzor** (Syncthing with a tray icon and autostart) from [github.com/canton7/SyncTrayzor/releases](https://github.com/canton7/SyncTrayzor/releases), or the plain Syncthing build from [syncthing.net/downloads](https://syncthing.net/downloads/). Run it. Allow it through the Windows firewall on private networks when asked; that is what lets devices find each other on your Wi-Fi. In SyncTrayzor, tick **Start on login** and **Start minimised**.
2. Pair the devices. On this device, open the Syncthing web UI (it opens in the browser; the tray icon has *Open*). Under **Actions → Show ID**, copy the long **Device ID**. On the other device, **Add Remote Device**, paste the ID, give it a name, save. Back on this device, accept the *New Device* prompt that appears in the web UI.
3. Share the vault. On this device, **Add Folder**: pick the Synesis vault folder (already there, or the one you are about to create the vault in), give it the label *Synesis*, and under **Sharing** tick the other device. Save. On the other device, accept the *New Folder* prompt and choose where to put it (`C:\Users\<you>\Sync\Synesis` is a good default; Synesis looks there). Sync starts immediately.
4. Check the settings that matter, on every device:
   - **Folder type**: *Send & Receive*.
   - **Ignore patterns**: none needed. The hidden `.bible-study/` folder must sync too.
   - Give each device a readable name; Synesis shows it as *Synced from <name>*.
5. Try it once: on this device, create a Note with [Quick capture](command:create.quick) holding a line such as *sync test from this device*. Wait for the sync tool's icon to show it has finished uploading, then open Synesis on the other device (or relaunch it): the Note appears in the sidebar under Notes, and Home lists it as recent. Delete the test Note afterwards with the delete button in its header.

## Good to know

- **File versioning** is optional. *Staggered* keeps old copies in `.stversions/` outside Synesis's sight.
- Edit the same Note on both devices while one of them is offline, then reconnect: both edits survive. Synesis keeps a change log per device inside `.bible-study/sync/` and merges them; the sync tool never has to resolve a conflict. If it still produces a "conflicted copy" file, delete that copy: the merged text is already in the original file.
- Everything in the vault folder is synced, including the hidden `.bible-study` folder. Do not exclude it.
- Keep only one Synesis (or Obsidian) instance editing a file at a time; the merge handles offline edits, not two cursors in the same line at the same second.
- Settings → Sync lists every device that has published into the vault and when it last did.

# iCloud Drive on a Mac

Free with any Apple ID (5 GB included; a vault of thousands of notes is a few megabytes). Reaches every Mac, iPhone and iPad signed in to the same Apple ID, and Windows through iCloud for Windows.

1. Open **System Settings → [your name] → iCloud → iCloud Drive** and make sure iCloud Drive is **on**.
2. Choose where the vault lives in iCloud Drive:
   - **If you also use an iPhone or iPad**, the vault must be in Synesis's own iCloud folder, the only one Synesis can reach on iOS. Open Synesis once on the iPhone with iCloud on (its iCloud Drive tutorial) and the folder appears in Finder as **iCloud Drive → Synesis**, at `~/Library/Mobile Documents/iCloud~tech~grimfeld~synesis/Documents`. Synesis on this Mac then proposes that folder, and lists a vault the iPhone made there under *Synced from …*.
   - **With Macs only**, create a folder named **Synesis** in iCloud Drive in Finder (`~/Library/Mobile Documents/com~apple~CloudDocs/Synesis`); Synesis proposes it.
3. Create the vault in that folder, or open the one listed under *Synced from …*. On this Mac that is all.
4. Open the vault on your other Apple devices:
   - **Another Mac**: sign in to the same Apple ID, turn iCloud Drive on, launch Synesis: it finds the vault under *Synced from this Mac* and opens it.
   - **iPhone / iPad**: install Synesis, choose *Use a synced folder* and iCloud Drive in the wizard; a vault in iCloud Drive → Synesis is offered.
5. Try it once: on this Mac, create a Note with [Quick capture](command:create.quick) holding a line such as *sync test from this device*. Wait for the sync tool's icon to show it has finished uploading, then open Synesis on the other device (or relaunch it): the Note appears in the sidebar under Notes, and Home lists it as recent. Delete the test Note afterwards with the delete button in its header.

## Good to know

- iCloud syncs file by file, usually within seconds on Wi-Fi. Large first uploads can take minutes.
- With *Optimise Mac Storage* on, macOS may move files you have not opened for a while back to the cloud. Synesis keeps them listed and asks iCloud to download them; a Note still downloading opens once it has arrived. Turn the option off if you also open the vault in Obsidian or another editor.
- A vault in `com~apple~CloudDocs/Synesis` cannot be reached from an iPhone. To bring an iPhone in, create a vault in iCloud Drive → Synesis and move the notes across in Finder, or pair the iPhone instead.
- Edit the same Note on both devices while one of them is offline, then reconnect: both edits survive. Synesis keeps a change log per device inside `.bible-study/sync/` and merges them; the sync tool never has to resolve a conflict. If it still produces a "conflicted copy" file, delete that copy: the merged text is already in the original file.
- Everything in the vault folder is synced, including the hidden `.bible-study` folder. Do not exclude it.
- Settings → Sync lists every device that has published into the vault and when it last did.

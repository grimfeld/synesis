---
status: accepted
---

# Vaults sync through Synesis's own iCloud container

PLAN §7 promised folder sync through an "iCloud container on Apple", and §14
recommended iCloud Drive for every Apple-only set of Devices. On the iPhone
none of it was real: the "iCloud" folder `sync_locations` reported was the
app's own Documents directory, which iOS never syncs. A Vault made there by
following the iCloud tutorial stayed on the phone.

An iOS app cannot read iCloud Drive at large. Without a document picker and
security-scoped bookmarks (which hand out a URL the engine would have to
re-acquire on every launch, for every file it touches — the same objection
ADR 0015 made to SAF), the only iCloud folder it can use as a plain path is
its own ubiquity container.

We decided Vaults that sync through iCloud live in Synesis's container,
`iCloud.tech.grimfeld.synesis`, in its `Documents` folder, which Info.plist
publishes to iCloud Drive as a folder called **Synesis**. Each Vault is a
folder named after itself inside it. Every Apple Device sees the same folder:
the iPhone through `URLForUbiquityContainerIdentifier`, a Mac at
`~/Library/Mobile Documents/iCloud~tech~grimfeld~synesis/Documents`, Windows
under `iCloudDrive\iCloud~tech~grimfeld~synesis`. It is still a plain folder
of markdown (ADR 0003): Finder, Files and Obsidian open it like any other.

The identifier is the hard-to-reverse part. It is registered in the Apple
Developer portal, written into the iOS entitlements, and is the folder every
Vault in it lives in. Changing it later strands every iCloud Vault in the old
container, which the new build can no longer reach.

## Considered options

- **A document picker over iCloud Drive** (`UIDocumentPickerViewController`
  plus security-scoped bookmarks). Lets the user put a Vault anywhere in
  iCloud Drive, but every engine path would have to be re-opened through the
  bookmark, and the watcher and SQLite index assume a path that stays valid.
  Rejected on the same grounds as SAF in ADR 0015.
- **CloudKit** instead of files. Would sync records rather than a folder,
  leaving nothing Obsidian could open. Rejected by ADR 0003.
- **Keep the local folder and recommend Pairing for iPhones.** Pairing works,
  and stays the recommended route (PLAN §15), but needs the other Device
  online at the same time; the user decided iCloud must ship in 0.1.0 for
  people whose Devices are rarely on together.
- **A container per Vault.** Containers are declared at build time, so this
  is not possible; one container holding many Vault folders is.

## Consequences

- The App ID needs the iCloud capability with this container assigned, and
  the provisioning profile must carry it; `scripts/ios-post-init.mjs` writes
  the entitlements into the generated Xcode project after `tauri ios init`.
- iCloud evicts files on iOS and leaves `.name.icloud` placeholders. The engine
  treats them as present but unreadable (`engine::cloud`) and the shell asks
  iCloud to download them; a placeholder is never indexed, deleted or written
  over.
- A Mac-only user who already keeps a Vault in plain iCloud Drive
  (`com~apple~CloudDocs/Synesis`) is unaffected; to bring an iPhone in they
  create a Vault in the container, or pair. Nothing is migrated automatically
  (ADR 0015's reasoning).
- Vaults created on an iPhone before 0.1.0 stay in On My iPhone → Synesis.
- `NSUbiquitousContainers` is read by iOS only when the bundle version changes,
  so the Synesis folder appears in iCloud Drive from the first build that
  carries it, not on reinstall of the same version.

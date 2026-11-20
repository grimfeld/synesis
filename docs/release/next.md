# Release notes: next version

What changes for people using the app, in the next release. Each change adds a line to its
section as it lands. Whoever runs `npm run release` pastes this into the draft GitHub Release by
hand, then empties the sections for the version after.

## Sync

- A Composition renamed or moved on one Device now brings its Board along on your other Devices,
  and other Boards' cards for it still open it. A folder the move left empty there is tidied away;
  a folder you made and kept empty is never removed.

## Sidebar

- Folders inside `Notes` and `Compositions` now show in the sidebar as a tree, with a count on each,
  including folders you made in Finder, Explorer or Obsidian. They remember which ones you opened, and
  opening a document unfolds the folders holding it.
- Make a folder from the "…" beside Notes or Compositions, or inside another folder, and write a new Note
  straight into it with the folder's "+". An empty folder can be deleted from its "…" menu.
- Move a Note or Composition into a folder with "Move to folder…" (its "…" in the sidebar, or the Command
  Palette), or by dragging it onto the folder on a computer. A Composition's Board goes with it.
- Rename a folder, or move it into another, from its "…" menu (or by dragging it on a computer). Its notes,
  their links and a Composition's Board come along.

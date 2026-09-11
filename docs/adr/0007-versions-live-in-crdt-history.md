---
status: accepted
---

# Composition Versions are named points in the CRDT history, not vault files

A Version is a labelled moment in a Composition's history ("as delivered, 2026-09-20") that the user can read, diff against the current text, and restore. The Loro document (ADR 0001) already holds every edit, so we decided a Version is a label plus a frontier in that history, stored inside the Loro document so it syncs with it. Restoring writes the old text as a new edit; history is never rewound. Obsidian sees only the current markdown; Versions are an app-only feature, an accepted exception to "Obsidian is the fallback client" (ADR 0003).

## Considered options

- **Copies in the vault** (`talk on endurance (v1).md`, a `versions/` folder). Obsidian-visible, but every copy becomes a document with backlinks, graph nodes and candidate matches, and renames drift. Rejected.
- **Automatic history only, no names.** Cheapest, but "the one I gave in March" must be findable by label. Kept as the browser underneath named Versions, not as the whole feature.

## Consequences

- Versions exist only where the document's CRDT state exists; a vault opened fresh in Obsidian on a device that never synced has none.
- "Duplicate as new Composition" is the way to adapt a talk to a new occasion; it is a fork, not a Version.

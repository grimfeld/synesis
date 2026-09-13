---
status: accepted
---

# A Board is a JSON Canvas file paired to its Composition, merged as a structured CRDT

A Board is the spatial arrangement of material for one Composition: the writer's own bubbles, documents from the Vault, and labelled groups. We decided it is stored as a [JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/) file beside the Composition it belongs to (`Compositions/talk on endurance.canvas` next to `talk on endurance.md`), and merged as a node-keyed map inside that Composition's existing Loro document (ADR 0001) rather than as text.

JSON Canvas is the format Obsidian reads natively, so a Board opens in the fallback client as a working canvas rather than as data (ADR 0003). It also supplies `file` nodes with a `subpath`, which puts a Clipping or a single section of a Note on the Board without inventing syntax.

A Board has no identity of its own. JSON Canvas defines only `nodes` and `edges` at the root, with no metadata slot, so a canvas cannot carry the ULID every other file has. Identity comes from the pairing: the Board is the canvas next to the Composition. Renaming the Composition renames both, and renaming any other document rewrites the paths inside every Board that references it.

## Considered options

- **Storage as a hidden sidecar** (`.bible-study/maps/<ulid>.json`) or **as coordinates in the Composition's frontmatter**. Both keep the vault tidy and need no new format, but the Board is then invisible or unreadable in Obsidian, which is the whole reason to build on an open canvas format. Rejected.
- **Boards as a first-class document type** in a `Maps/` folder, able to stand alone. Rejected for the identity problem above: with nowhere to put a ULID, a standalone Board falls back to identity-by-path, which is exactly what the frontmatter `id` exists to avoid.
- **Merging the canvas as text**, reusing the existing markdown path unchanged. Rejected: character-level merge of two edits to a JSON tree produces invalid JSON.
- **Last-writer-wins on the whole file.** Cheapest, and rejected: a Device that dragged nodes while offline loses them, which breaks the conflict-free non-negotiable.
- **A separate Loro document for the canvas**, isolating the new merge path from the text path. Rejected because it splits Versions: a Version would then cover the talk or the Board but not the moment.

## Consequences

- Concurrent edits to *different* nodes both survive. Concurrent edits to the *same* node fall to per-key last-writer-wins, which is the right answer for a coordinate and the wrong one for prose — hence the map, not text.
- A Version (ADR 0007) covers the talk and its Board together, and restoring restores both.
- External edits to a `.canvas` must be folded in structurally — parse, diff node by node, apply — for the same reason markdown edits must (ADR 0003). The vault watcher, which reads `.md` only, learns `.canvas`.
- Fields the app does not understand must be preserved on round-trip. The spec is silent on unknown keys and Obsidian keeps them, so anything parsed and not kept is destroyed the moment the user touches the Board in Synesis.
- The canvas is not a document: it carries no ULID, has no Hub, and is not indexed as a page. References from its `file` nodes are recorded as Board refs, kept apart from prose links so that placing material on a Board does not mark it used.

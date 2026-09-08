---
status: accepted
---

# The vault is an Obsidian-compatible folder of markdown files

The user must own their notes in a form that outlives this app. We decided that the vault on disk is a plain folder that opens cleanly in Obsidian: one markdown file per document, `[[wikilinks]]`, `#tags`, `![[embeds]]` and YAML frontmatter exactly as Obsidian reads them, and no custom syntax anywhere. Document type and Source metadata live in frontmatter. Everything the app computes (detected Passages, indexes, graph layout) and everything sync needs (CRDT change logs) lives in hidden folders that Obsidian ignores.

## Consequences

- The editor cannot introduce syntax Obsidian would not render. Features must be expressed through links, tags, frontmatter, or the app's own UI layered over plain text.
- Verse, Chapter and Book pages that materialise on first Mention are ordinary markdown files with frontmatter identifying the Passage.
- Because sync treats markdown as a materialisation of CRDT state (ADR 0001), external edits made in Obsidian or any text editor must be detected on launch and folded into the CRDT. This is mandatory, not optional.
- Obsidian is the free fallback client on any platform the app has not shipped on yet.

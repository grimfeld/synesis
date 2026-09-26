---
status: accepted
---

# Pictures are named in the text with a full-path wikilink, kept at 1600px, and never indexed

A Picture is an image shown inside a document's text: a map in a Note, a scan in a Composition, a photo of a site in a Place's About. We decided a Picture is written as `![[Attachments/<name>.<ext>]]` on its own line, the file is copied into `Attachments/` named after the document that holds it, downscaled so its longest edge is at most 1600px, and neither the file nor the reference is indexed. This extends ADR 0012, which covered Covers only.

Obsidian's embed syntax, with the full vault path. Every other link in the vault is a wikilink, so a Picture is one too, and Obsidian draws it without any setting. The full path is what lets the engine find the file without an index: Obsidian's default "shortest path" form, `![[athens.png]]`, needs a lookup by file name across the vault, and attachments are deliberately not indexed (ADR 0012). The shortest form and standard markdown `![](path)` are still read, since a vault edited in Obsidian will contain them; the app never writes them.

A `![[…]]` whose target ends in a picture extension is a Picture, not a link. It is not a Mention, has no backlink, is never "unresolved", and is not an Embed: an Embed is a live Clipping (CONTEXT.md), and conflating the two would put image files in the Candidate and backlink logic that only makes sense for documents.

Named after the document that holds it, like a Cover is named after its Source: a Note's or Composition's title, the Hub's title for an About, the Source's title for a Clipping (which has none of its own, ADR 0013). A dropped file's own name is usually `IMG_2031.jpg` or, when pasted, nothing at all, and the name is the only trace from the file back to its owner. An untitled document falls back to the time of the drop, `2026-09-26 101512.png`, rather than refusing: a Picture dropped into a Quick capture should just work.

1600px, not the 600px of a Cover. A Cover is a thumbnail; a Picture is read, and a map or a scanned page has small print. 1600 covers the prose column on a high-density screen and keeps a Picture near a megabyte, which matters because every Picture is carried to every Device (ADR 0019) and read back as a data URL (ADR 0012). A GIF is stored untouched, since resizing drops its animation.

Never deleted automatically. Removing `![[…]]` from the text removes the reference, not the file. Undo, cut-and-paste between documents and restoring a Version (ADR 0007) all bring the text back and expect the file to be there, and Pairing does not carry deletions (ADR 0019), so a delete on one Device would come back from another anyway.

## Considered options

- **Keep the original file.** Full fidelity, and what Obsidian users might expect. Rejected: a phone photo is 4–8 MB, synced to every Device and base64-encoded on every read, for detail nobody reads in a study note.
- **Resize on read, keep the original on disk.** Rejected: the vault and sync still carry the original, and every open pays for the resize.
- **Name after the dropped file.** Rejected: the names that arrive are mostly `image.png` and `IMG_…`.
- **Refuse a Picture in an untitled document**, as a Cover without a title is refused. Rejected: a Quick capture is untitled by design, and a timestamp is legible enough by eye.
- **Widen Embed to cover images.** Rejected: Embed has a precise meaning (a live Clipping) that the Candidate and backlink rules depend on.
- **Index Pictures**, as documents or as references. Rejected for the reasons in ADR 0012; an "unused pictures" sweep can scan the text when someone asks for one.

## Consequences

- Downscaling is lossy and one-way. The vault keeps the Picture the page needs, not the original the user dropped.
- Orphans accumulate in `Attachments/`: nothing deletes a Picture, and nothing indexes who uses one. A sweep is deferred.
- Renaming a document does not rename its Pictures; the file name drifts from the title, as a Cover's does.
- The Passage parser, the link extractor and the editor must all recognise a picture extension inside `![[…]]` and step aside.
- Only jpg, jpeg, png, gif and webp are Pictures; any other dropped file is refused. Attachments in general (PDF, audio) are not part of this decision.

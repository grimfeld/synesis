---
status: accepted
---

# A region's Border is a GeoJSON file beside its Place, and never changes over time

Historical borders need area shapes, while a Place has only been a point (`lat`, `lon`). We decided that a region Place's Border is a `.geojson` file kept in the Vault next to the Place and named in its `border` link property. The file is drawn on the Map or imported. A Border has no dates of its own: when the land changes hands, that is another Place with its own Span and Border (the Kingdom of Judah and the Roman province of Judea are two Places). "Inside a region" means inside its Border and nothing else, so a region with no Border contains no Place.

## Considered options

- **Coordinates in frontmatter.** Keeps everything in one file, and rejected: hundreds of numbers in YAML are unreadable, and Obsidian's Properties panel renders them as noise.
- **Several dated Borders on one Place.** Rejected, because it adds a second timeline inside a Place that the Span already expresses. A change of rule is a change of Place.
- **A `region` link on each Place as a second way of saying "inside".** Rejected, because two answers to "is Bethlehem in Judah?" would eventually disagree. A rough Border is quick to draw.

## Consequences

- The Vault gains a non-markdown file type that Obsidian ignores, like Boards' `.canvas` files (ADR 0009). Only a region has a Border. A `border` that names anything but a `.geojson` file inside the Vault is reported on the Place and never read, written or deleted, so a hand-typed link to a note cannot be overwritten.
- Pairing carries a Border whole, but unlike an attachment (ADR 0020). A picture never changes and is never deleted; a Border is edited in place and goes when its region lets it go. So a Border travels like a config file (ADR 0016): the newer copy wins, "newer" being the later of its `updated` member and its modification time, so an edit made in another tool counts. A deletion leaves a tombstone (the path and when) in a per-Device register beside the index, and the tombstone travels in the Border manifest: a peer holding an older copy deletes it, one holding a later edit keeps it. Only the files some region names travel, never every `.geojson` file in the Vault.
- Deleting a region deletes its Border file, as deleting a Composition deletes its Board; Delete Border removes it too. Either way the file stays while another region still names it.
- Containment is computed geometrically (point in polygon) at index time, and only for Places that have coordinates. A Place on the line counts as inside. The index keeps a copy of each region's polygons beside the Places found inside it, so a Place saved alone is tested against every Border without reading a file, and a Border saved alone against every Place. Because the file can change under an unchanged Place (another tool, Pairing, iCloud), containment is also recomputed when a `.geojson` file changes on disk or arrives from a paired Device, after every Border command, and on every scan. A Border file iCloud has not downloaded yet keeps the containment it had; a missing or malformed one contains nothing.
- The Map still reads Border files when it draws them, rather than from the index, so it can say why a file cannot be drawn (missing, malformed, downloading).

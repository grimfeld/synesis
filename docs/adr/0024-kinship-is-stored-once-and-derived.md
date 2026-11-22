---
status: accepted
---

# Kinship is three built-in link Properties, stored once and derived the other way

Characters need family ties so the app can show a family tree and a Character's children and siblings. We decided that Kinship is exactly three built-in Property names on a Character: `father` and `mother` (link) and `spouses` (list of links), written as ordinary front-matter links that Obsidian reads. Each tie is stored once, on the child or on either spouse; children and siblings are never stored, and a spouse named by only one side counts for both. The app derives the other direction at read time and never writes a second document to keep the two ends in step.

## Considered options

- **A sidecar file or a custom syntax for relations.** Would have allowed richer ties (kinds, dates, sources) but would be the first break from ADR 0003 for a feature that front matter carries fine. Rejected.
- **Storing both directions (`children` on the parent).** Readable in Obsidian from either side, but two files must agree, and every edit to one would have the app rewrite the other. Rejected: one source of truth, and the app does not rewrite what the user did not touch.
- **User-declared kinship kinds** (any Property marked as "points to a parent"). Open-ended, but a schema project of its own, and three names draw any genealogy. Rejected for now.

## Consequences

- In Obsidian, a parent's file does not list its children; the backlinks pane does.
- Legal, adoptive and skipped-generation parenthood are not expressible as Kinship; they live in the About body until a later decision adds them.
- Bad data (a `father` naming a Place, a cycle, two fathers) is reported on the Hub and skipped by the tree, never corrected by the app.
- A Vault that declared one of the three names with another type keeps it; the Kinship query reads the links in the value regardless.

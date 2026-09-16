---
status: accepted
---

# A Clipping has no title; it is known by its text and identified by its Citation

A Clipping is a verbatim excerpt from a Source. We decided it carries no title at all: nothing in the app asks the user to name one, nothing displays a name, and the file's frontmatter has no `title` key. Everywhere a Clipping is shown as a line of text — the Graph, the Command Palette, backlinks, Candidates, Board cards, the Clippings view — it shows its own quoted words, truncated to fit. Its identity on disk is its Citation: the Source it names and the Locator within it, followed by the moment it was kept.

Naming someone else's words is the user's commentary, not the excerpt. A Clipping is the one document type whose content the user did not write, and asking them to title it invites exactly the thing the type exists to prevent — a paraphrase standing in front of the quotation. The vocabulary already said this ("the words are someone else's; the user only chose to keep them"), and the product did not: the New dialog offered a Title field, and when it was left blank the app invented `"<Source> – <first 48 chars>"` and wrote that into frontmatter. A machine-made title is still a title, and it was the string every view then displayed instead of the quote.

The file name is `<source> <locator> <timestamp>.md`, lowercased — `clippings/keep enduring with joy par. 12 2026-08-05 20.10.md`. The Citation is the one label for a Clipping that is not invented, and it is how a reader would say the thing aloud. The timestamp is what makes it unique: two Clippings from one paragraph are ordinary, and the alternative — `unique_path`'s ` 2` suffix — distinguishes them by nothing a person could use. It also decouples the name from the Source's title, so renaming a Source does not have to re-stem its Clippings to keep them unique.

Prose links to a Clipping are always aliased, with the Citation as the alias: `![[keep enduring with joy par. 12 2026-08-05 20.10|Keep Enduring with Joy, par. 12]]`. The stem has to be stable and unique, which makes it long and puts a timestamp in the middle of it; the alias is what a person reads, in Obsidian as much as here. The app writes this shape whenever it inserts the link, which is the same thing `link_text` already does for an ambiguous title. Nothing is lost in the index — the wikilink regex strips the alias before the link is recorded — and `rename_document` already preserves `|alias` when it rewrites.

The quote reaches the views through a new `label` column, not through `title`. Every one-line context is fed by `DocSummary`, which carries `title` and no body, so the quote had to be stored somewhere the summary query already selects. Overwriting `title` itself was cheaper and was rejected: `title_norm` is a resolution key (`index.rs`), and filling it with quoted prose means `[[...]]` targets start matching against the middle of somebody else's sentence. `title` keeps meaning title; `label` means "what to show on one line", and for every type but Clipping it is a copy of `title`.

`label` is a Clipping-only rule, deliberately. `excerpt.rs` makes a virtue of having one excerpt rule for all types, and that rule is right where an excerpt is *added* to a card that already shows the title — a Board card. Here the label *replaces* the title, and only a Clipping has no title to replace. A Note's title is a name its author chose and wants to find it by.

Existing Clippings are not migrated. A Clipping written before this decision has a `title:` key and a title-derived file name, and both are left exactly as they are; `label` simply ignores `title` for Clippings, so old and new ones look identical in the app. Rewriting them would mean rewriting every `[[Endurance is steadfastness]]` in the vault in step, and a wikilink this app failed to rewrite is a link that silently stops resolving — in Obsidian too, where the app cannot see it happen. The `title:` key becomes inert rather than wrong.

## Considered options

- **Keep the auto-generated title, hide the field.** The cheapest option: no engine change, the dialog simply stops asking. Rejected because it is the current behaviour with the symptom hidden — the invented name still exists, still lands in frontmatter, still becomes a file name, and still shows up anywhere `label` is not consulted.
- **Name the file after the ULID** (`01M26CD0D8K68TXRZETRWBXJC4.md`). The only fully honest answer to "it has no name", and rejected against ADR 0003: the vault has to be usable in Obsidian by hand, and a folder of ULIDs is not. It also makes a typed `[[...]]` impossible for a human.
- **Source and Locator with no timestamp**, disambiguated by `unique_path`'s ` 2` suffix. Rejected: same-paragraph Clippings are common, and ` 2` is not a distinction a reader can act on. It also ties the name to the Source's title, so a Source rename would have to re-stem its children to stay unique.
- **The Citation as the one-line label everywhere**, instead of the quote. Rejected because it answers "where from" and never "what it says" — on a Verse page, every Clipping from one Source would render as the same line.
- **The quote as the `title` column.** Rejected for `title_norm` poisoning the link resolver, as above.
- **One excerpt rule for every type**, so Notes and Compositions also display their opening line instead of their title. Rejected: a title the user chose is the thing they search by.
- **Migrating old Clippings on first index.** Rejected for the wikilink breakage described above. The user's frontmatter is theirs, and an inert key is cheaper than a broken link.

## Consequences

- A Clipping's file name is long and contains a timestamp. In Obsidian's file list this reads as a citation with a date on the end, which is legible; in a raw `[[...]]` it is not, which is why the app always writes an alias.
- Two Clippings can carry the same Citation and are told apart only by the moment they were kept. This is correct — they are two excerpts from one paragraph — but it means the Citation alone does not identify a Clipping, and any UI showing only the Citation can show apparent duplicates.
- The vault holds two shapes of Clipping indefinitely: older ones with a `title:` key and a title-derived name, newer ones with neither. Only `label` hides the difference, so anything reading frontmatter directly sees both.
- `documents` gains a column, which means a schema migration and a reindex on upgrade.
- The Clippings view is now the only place that browses Clippings as a set, since they leave the sidebar. If it is wrong, they are hard to find by anything but search.
- A Clipping still has a `title` in the index (derived from its stem), so old `[[Endurance is steadfastness]]` links keep resolving and the Citation-stem resolves as a stem. Nothing that used to resolve stops resolving.
- Renaming a Source no longer renames its Clippings' files, so a Clipping's stem can name a Source under its old title. The `source:` wikilink inside is still rewritten, so the link is right and only the file name is stale — the same drift ADR 0012 accepted for Covers.

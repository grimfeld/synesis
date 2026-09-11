---
status: accepted
---

# Property types are declared once per name, vault-wide, in an app-owned schema file

Properties (frontmatter fields) need types so the app can offer the right widget (Date picker, number input, link picker) and so the engine knows which values are Dates to put on the Timeline. We decided that a Property name has one type everywhere in the vault, chosen the first time the name is used, and that the schema lives in `.bible-study/properties.json` inside the vault (so it syncs with the folder) rather than in Obsidian's `.obsidian/types.json`. Built-in names are pre-declared (`lat`/`lon` number, `start`/`end`/`born`/`died` Date, `source`/`parent`/`place` link, `characters`/`aliases` list, `date` calendar). Types: text, number, date (Bible chronology, ADR 0005), calendar (ISO), link, list, checkbox.

## Considered options

- **Reuse `.obsidian/types.json`.** Same vault-wide-per-name model, but Obsidian's `date` type means ISO and its widget would reject "c. 1513 BCE"; there is no way to declare our own types there. Rejected; we may mirror the compatible subset (number, text, list) into it later as a nicety.
- **Per document-type schema** (`character.born`, `event.start`). Lets the same name mean different things on different types, which is exactly the confusion Obsidian's model avoids. Rejected.
- **Infer Dates by parsing every string value.** Zero config, but silent false positives and no way to have a text field that looks like a Date. Rejected once typed Properties were on the table.

## Consequences

- Unknown Property names are text. Changing a name's type re-indexes the vault.
- The engine, not the UI, reads the schema and interprets values; the UI receives typed Properties from the engine.
- Link-typed Properties produce Mentions and backlinks exactly like inline links, and are what an Event uses to name its Place and Characters.

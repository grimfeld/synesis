---
status: accepted
---

# Attachments live in the vault but stay out of the index; a Cover is one property resolved three ways

A Cover is the picture that stands for a Source in the Library. We decided a Source carries a single `cover` Text property, resolved by looking at the value: `http://` or `https://` is a picture on the web, anything else is a path inside the vault, and an empty value means the app draws a Cover from the Source's own title, kind and date. Pictures kept in the vault live in `Attachments/`, are copied in rather than linked to, and are never indexed.

One property, not two. Obsidian's own convention puts both a URL and a path under `cover:`, and the `http` prefix separates them without ambiguity. Two properties would buy explicitness at the price of a precedence rule, a second dialog field, and a state where both are set and one silently loses. A Source has one Cover.

Attachments are referenced, never indexed. The vault scanner keeps reading `.md` only (`crates/engine/src/vault.rs`), so a picture in `Attachments/` is a file the engine can copy and read back but never a row in `documents`. An image has no title, body, links or type; indexing one would put it in the sidebar, in search results, in the graph, and in every `list()` call, in exchange for a "find unused attachments" query nobody has asked for. The `cover` property is the only thing that knows an attachment exists.

An attachment is named after the Source it covers, and cannot be written until that Source has a title. The name is the only thing tying a picture back to its Source — nothing indexes attachments, so there is no query that answers "what uses this file?" — which makes `untitled.jpg`, and then `untitled 2.jpg`, a folder nobody can read, including the user in Obsidian. The New dialog therefore *stages* a picked Cover and copies it in on submit, when the title is settled; a Source that already exists copies immediately. `unique_path` refuses an empty title rather than falling back, so a caller that forgets cannot quietly produce one.

Copy in, do not link out. `attach_image` copies the chosen file into `Attachments/` and returns a vault-relative path; it does not store the path it was given. A vault that points at `C:\Users\...\Downloads\cover.jpg` is not a vault — it breaks the moment it syncs to the other Device (ADR 0001) and it breaks in Obsidian. Copying in is what makes the vault the whole of the user's material.

Images are read back as bytes and handed to the webview as a data URL. The UI never touches files (ADR 0004), so the picture has to come through the engine either way; Tauri's asset protocol would be cheaper but does not exist on the development bridge, which is where the UI is driven headlessly and where every Cypress spec runs. A Cover that only renders in the real window is a Cover no test ever sees. To keep data URLs affordable, `attach_image` downscales on the way in.

A remote Cover stays remote until the user says otherwise. `Fetch` fills `cover` from the page's `og:image`, which costs nothing and gives the Library a picture on the first click. Saving a copy into `Attachments/` is an explicit action, not a side effect of fetching metadata: pulling third-party images into the user's vault is a decision the user makes.

## Considered options

- **Indexing attachments as documents**, lifting the `.md` filter so the engine knows every file. Rejected: an image satisfies none of what a document is, and the cost lands on every consumer of `DocSummary` while the benefit is hypothetical.
- **A `cover_url` and a `cover_file` property.** Rejected for the precedence rule and the double-set state described above.
- **An absolute host path in `cover`**, with no `Attachments/` folder and no copying. Cheapest, and rejected: the vault stops being self-contained, which defeats sync and defeats Obsidian.
- **Tauri's asset protocol** instead of data URLs. Faster, cached, streamed, and invisible to the development bridge — so the shipped path would be the untested path. Rejected. Supporting both was rejected in turn for the same reason: two code paths, only one of them exercised.
- **Downloading every `og:image` automatically** on fetch. Rejected: it writes to the user's vault as a side effect of asking for a title.
- **Covers as images only, with no generated fallback.** Rejected because the Library's feeling comes from uniformity. A shelf where four books have art and eleven have grey rectangles looks broken; a shelf where every Source has a Cover looks like a library, and the drawn ones are often better than a publisher's logo scraped from a meta tag.

## Consequences

- The vault now holds binaries. `Attachments/` joins the folders created on open, and a vault is no longer all text — which is what makes this hard to reverse and worth writing down.
- Nothing points back from an attachment to the Source using it. Deleting a Source leaves its picture behind, and there is no query that finds orphans, because the file is not indexed. Accepted for now; a sweep can be written later against the `cover` values.
- A remote Cover renders only online and rots when the site reorganises. "Save a copy" is the user's answer to both, and it is one click.
- Renaming a Source does not rename its Cover, so the file name drifts from the title over time. Accepted for now: the name only has to be good enough to identify the picture by eye, and rewriting it would mean rewriting the `cover` property in step.
- Downscaling on copy-in is lossy and one-way. The vault keeps the picture the Library needs, not the original the user chose.
- The engine gains an image dependency for the downscale, which is the first non-text processing it does.
- An `og:image` is frequently a site logo rather than a cover. The generated Cover has to be good enough that replacing a bad scrape is a real choice.

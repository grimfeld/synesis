---
status: accepted
---

# Unlinked mentions may rewrite other documents, one occurrence at a time

A Hub gathers what points at it. It should also be able to show what talks about it without pointing at it: a Note that says "the brothers in Antioch" and never writes `[[Antioch]]`. We call each such occurrence an **Unlinked mention**, and its mirror — a name in the document you are writing that matches a Hub and is not yet a Mention — a **Linkable**.

Both are offered with an action that writes the link. On the Linkable side that edit lands in the document already open in the editor, through CodeMirror's own dispatch, so it undoes like any keystroke. On the Unlinked mention side it lands in **a different document, one the user is not looking at**, through `save_document`.

That second case is the decision worth recording, because it sits against a hard constraint: *never rewrite the user's text*.

We decided the constraint still holds, and that these edits are outside it.

The constraint's target is inference. Passage detection reads "John 3:16" and produces a Mention the user never wrote; materialising that into the file would mean the app editing prose on a guess, at a moment the user did not choose, in a document they may never open. It stays a decoration for exactly that reason (ADR 0002). Linking an Unlinked mention is the opposite on every axis: the user read the row, chose the target, and clicked. The app supplies no judgement, only the typing.

What the app must not do is change how the prose *reads*. So the inserted form preserves the matched text byte for byte:

```
…the brothers in Antioch stayed…      →  …the brothers in [[Antioch]] stayed…
…Paul's letter to the…                →  …[[Paul|Paul's]] letter to the…
…Joseph, called Barnabas…             →  …[[Barnabas|Joseph]], called Barnabas…
```

A bare `[[Title]]` only when the matched text equals the title exactly; `[[Title|matched text]]` in every other case, including a difference of case alone. The rendered document is identical before and after. Only the link machinery is added.

## Considered options

- **Read-only: list the occurrences, link nothing.** No tension with the constraint at all, and rejected because it makes the feature ornamental. Seeing that fourteen Notes mention Antioch is worth little if acting on it means navigating to each one, finding the word, and typing brackets. The occurrences that get linked would be the ones the user was already going to link.
- **Linking every occurrence in a document at once.** Rejected: repeating a link in every paragraph is bad writing, not a gap that wants filling. The convention this follows is link-the-first-mention, so "Link all" takes the first occurrence per document and no more.
- **Obsidian's rule for which documents to list** — every non-link occurrence, including in documents that already link the target elsewhere. Rejected; see the first consequence below.
- **Precomputing the occurrences at index time**, so a Hub reads them instantly. Rejected on write amplification for a read that is cheap anyway: creating one Place would have to re-scan the whole vault to find its Unlinked mentions, and every rename would invalidate every stored row. The FTS index the vault already maintains narrows the haystack to the documents containing the token, and a verify pass over those few finds the real offsets.

## Consequences

- **Unlinked mentions and Backlinks are disjoint.** A document that already Mentions the target anywhere is excluded from its Unlinked mentions entirely, so each document appears in one list or the other and never both. This departs from Obsidian deliberately: the question the section answers is "who talks about this without pointing at it", and a document that already points at it is not an answer. It also gives "Link all" a clean fixpoint — every document it touches leaves the list, so the section empties.
- **A Linkable retires once, not per occurrence.** The row asks "should this document link to Barnabas", and once the writer has linked that target anywhere in the text the question is answered: it leaves the list, however many times the name is still written. This is the editor-side half of the rule above — Unlinked mentions and Backlinks are disjoint per document, and Linkables and Mentions are disjoint within one — and it is the same link-the-first-mention convention "Link all" follows. The count on a row is the unlinked occurrences remaining, so it never counts down; it disappears.
- **An offset can be stale.** The offsets come from the index, which reflects the last save; Obsidian or a sync may have changed the file since. Every splice therefore re-reads the document and verifies the matched text still sits at that offset before writing, and refuses if it does not. A splice at a stale offset would corrupt prose silently, which is the one failure this feature cannot be allowed to have. "Link all" applies the same check per document, skips what fails, and reports the count it skipped rather than aborting a half-finished batch.
- **Ambiguous titles must be qualified.** `resolve()` sends a duplicate title to the shortest path and says nothing, which is tolerable for a link the user typed and not for one the app inserted on their behalf. From a Hub the target is known, so the insert names that Hub's path (`[[Places/Antioch|Antioch]]`). From the editor it is not known, so the user picks before anything is written. Duplicate titles are also surfaced in their own right, beside unresolved links.
- **Scripture is excluded from both directions.** A Verse page has no Unlinked mentions by construction, since Passage detection already finds every Scripture Mention. Offering `[[John]]` beside a detected "John 3:16" would be actively wrong, and the Book "John" shares its name with a Character, so scanning it would list every sentence about the apostle.
- **The eligible set is one rule read in two directions.** Topical Subjects and Sources gather Unlinked mentions; the same documents, and only those, can appear as a Linkable. A future type added to one side belongs on the other.
- **Common-word Subjects are noisy.** A Concept named "Grace" matches every sentence about grace, and some of those genuinely are mentions of it. Both lists are capped and counted rather than filtered by cleverness. A per-document opt-out is the obvious escape hatch and is deliberately not built until the noise is felt.
- **Multi-file writes need a way back.** "Link all" confirms with a count and the document titles first, and reports afterwards with an Undo that restores the pre-edit text of every file it touched. This is the only action in the app that modifies many documents the user has not read.

---
status: accepted
---

# Bible-chronology Dates are human-readable text, parsed by the engine

Events, Characters and Places carry Dates in the Bible's chronology ("c. 1513 BCE", "14 Nisan 33 CE", "52 CE"). We decided that a Date is written in frontmatter exactly as a reader would say it, and that the engine parses it into an astronomical year plus precision (year / month / day) and an approximate flag at index time. The text is never rewritten; an unparseable value simply is not a Date and stays off the Timeline, with a warning on the page. This mirrors how Scripture Mentions are handled (ADR 0002): the user writes naturally, the app decorates and indexes.

## Considered options

- **ISO 8601 / astronomical years** (`-1512-01-01`). Sortable and unambiguous, but YAML and Obsidian choke on negative years, and nobody thinks of 1513 BCE as year −1512. Rejected.
- **Structured objects** (`{year: -1512, approx: true}`). Explicit, but renders as raw YAML in Obsidian's Properties panel and is painful to type. Rejected.

## Consequences

- The Date parser is a tested engine component with a case per bug, like the Passage parser. It accepts English (BCE/CE, BC/AD) and French (av. J.-C. / ap. J.-C. / av. n. è. / de n. è.) era markers, `c.` / `ca.` / `~` for approximate, optional month (Gregorian names and Hebrew months) and day.
- An Event has `start` and, optionally, `end`. Any other Date-typed Property on a Subject (`born`, `died`, `anointed`, ...) is a Timeline mark labelled by its key (ADR 0006).
- Today's-world calendar dates (a Composition's delivery `date`, a Source's publication `date`, `created`) remain ISO and are a different Property type; they never appear on the Timeline.

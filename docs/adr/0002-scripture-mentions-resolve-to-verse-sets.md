---
status: accepted
---

# Scripture Mentions resolve to Verse sets, displayed at the coarsest covering unit

A Mention of a Passage such as "John 3:16-18" is stored as a link to every Verse it covers, not as an opaque string or a range node. This makes backlinks and queries work at any granularity: John 3:17's page shows every Note whose Passage contains it, and John 3's page rolls up everything in the chapter. To keep the graph and backlink panels readable, the UI collapses a Mention to the coarsest unit that covers it (a whole-chapter Mention shows once, not 40 times), and the graph defaults to Chapter-level nodes with a toggle down to Verse level.

## Considered options

- **Range as its own node.** Simple, but "John 3:16-18" and "John 3:17" never connect. Rejected.
- **Expand to verses with no display aggregation.** Correct data, unusable graph (a Psalm 119 note links 176 nodes). Rejected in favour of aggregation at display time.

## Consequences

- The reference parser must resolve abbreviations, roman numerals, contextual "v. 17", and cross-chapter ranges into exact Verse sets. It is the hardest and most-tested component in the app.
- Verse identity uses the 66-book canon with standard English versification, which is also the Jehovah's Witnesses / New World Translation numbering used by the author and first testers. Other versifications (Septuagint Psalm numbering, deuterocanonical books) would be handled later as parser-time input mappings, never as alternative identities.
- The parser must accept Watchtower standard book abbreviations (Ge, Mt, Mr, Lu, Joh, Ac, Ro, Php, Re, ...) as well as common English ones.

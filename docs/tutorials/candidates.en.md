# Candidates

A Candidate is a document in your Vault, most often a Note or a Clipping, that shares a Tag or a Passage with a Composition, or cites a Source it draws on, but that the Composition does not Mention yet: material you might still pull in. They are gathered beside the Composition while you write, so nothing relevant is forgotten.

1. Open one of your Compositions from **Compositions in progress** on [Home](command:nav.home), where each card counts its Candidates, or create one with [New Composition](command:create.composition) (its **Delete** button in the header removes it). If it has no Tag or Passage yet, add a Tag at the end with [Insert tag](command:editor.tag).
2. Look at **Candidate material** in the right panel (**Toggle side panel** in the header shows it). Each Candidate lists the Tags and Passages it shares with the Composition. Click one to read it, and come back with [Back](command:nav.back).
3. Attach a Source you're preparing from with [Add Source](command:composition.addSource), or with **Add Source** at the top of **Candidate material**: every Clipping and Note that cites it joins the Candidates, marked with where it came from ("from *Keep Enduring with Joy*"), even if it shares no Tag or Passage with the Composition. It shows as a chip above the Candidates, whose **×** removes it again.
4. Try it once: pull a Candidate in. On a computer, drag it from **Candidate material** into your text, to where it belongs: a Clipping arrives as an Embed on a line of its own, anything else as a link. Or, on a new line of your Composition, run [Insert link](command:editor.link) and type its title, or embed a Clipping with [Insert embed](command:editor.embed). It leaves **Candidate material** and moves to **Used in this Composition**.

## Good to know

- A Tag naming the Candidate counts as a Mention too.
- Placing a Candidate on the Composition's **Board** does not use it: it is listed under **On the Board** and stays a Candidate until the Composition itself Mentions it. The **Place on the Board** button beside each Candidate puts it there as a card without leaving the talk.
- Attaching a Source that has parts, such as a book, also brings in what cites its parts (its chapters); attaching one chapter brings in only what cites that chapter. Attaching a Source never uses its Clippings: they stay Candidates until the Composition Mentions them. The Sources are kept in the Composition's `sources` Property.

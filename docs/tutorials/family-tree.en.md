# Family

A Character's Hub shows their Kinship under **Family**: their father, mother and spouses, their children and their siblings. Each tie is written once, on one side, as an ordinary link in the Character's Properties; the app reads the other side for you and never writes it into a file.

![Two parents joined as spouses, their children below, each child linked up to the parents it names](image:family-tree)

1. Open a Character's Hub with [Search](command:nav.search), such as Jacob in the demo Vault. Under **Family** come his **Father** and **Mother**, his **Spouses**, his **Children** grouped under the mother each one names, and his **Siblings**.
2. Click his father, Isaac. Isaac's file names none of his sons, yet his **Children** lists Jacob and Esau: their own files name Isaac as their `father`. The same goes for spouses: Leah's file names no one, and her Hub still lists Jacob, because Jacob names her.
3. Look at Isaac's **Siblings**: they are grouped by the parents they share. Ishmael stands under Abraham alone, a half-brother; a full brother or sister would stand under both parents. Come back with [Back](command:nav.back).
4. Try it once: open the Hub of a Character you study and read their **Family**. If it is empty, name a parent under **Properties**: add `father` (or `mother`) and link the parent, such as `[[Isaac]]`. Open the parent's Hub: the Character is now among their **Children**.

## Good to know

- Kinship is three Properties on a Character: `father` and `mother`, one link each, and `spouses`, a list of links. Children and siblings are never written: they are read from the other side. Obsidian reads the same links, and shows the other side in its backlinks.
- Write a marriage on either spouse, or on both: it shows once on each side.
- A Character has one father and one mother. A legal or adoptive father, or a genealogy that skips generations, belongs in the About of the Hub.
- When a tie cannot be read, the Family section says why and leaves it out: a `father` that names a Place, a `father` holding two links, or a Character who would be their own ancestor. The file is left as you wrote it; correct it under **Properties**.

# Properties & Dates

Properties are the named values a document carries besides its text: a Place's latitude, a Note's Source, a Character's birth. Dates among them are written the way you would say them, and the right pair puts a page on the Timeline.

1. Open one of your Places or Characters, or create one with [New Place](command:create.place). Its Properties are under **Properties** near the foot of its page, just above **About** (beside a Note, under **Properties** in the side panel), each with a field that suits its type: a number, a link, a Date.
2. Type a name into **Add property** and press Enter. The first time a name is used you choose its type, and the whole Vault keeps it: type the name on another page and its type is already known. Click a Property's label to change its type or **Remove property**.
3. Write Dates the way a reader says them: `c. 1513 BCE`, `14 Nisan 33 CE`, `52 CE`. The app reads the year, how precise it is and whether it is approximate, and never rewrites what you typed. Under each Date field it shows, as you type, how it reads the value, in the form the Date picker writes (`c. 1513 BCE · year`), or why it is not a Date: no era, an unknown month, or two Dates written in one value (a Span is two Dates, each in its own Property, such as **Start** and **End**). A Date it cannot read is flagged in red under **Dates** on its page, and stays off the Timeline.
4. Or pick a Date: the **Pick a Date** button beside each Date field opens the Date picker. Turn on **Approximate (c.)**, choose a **Day** and a **Month**, from the **Civil** or the **Hebrew** calendar, type the **Year** and choose its era, and the Date is written into the field in the app's language: `c. 1513 BCE`, `14 Nisan 33 CE`. The Year is written when you press Enter, leave it or close the picker. A Year of 0 is flagged and writes nothing: 1 BCE is followed by 1 CE. The day waits for a month, and a month offers only the days it has. A pick keeps the era words you write with, BC/AD or BCE/CE, and a note in brackets such as `(Ex 12-13)`. The field stays yours to type in, and the picker follows what you type; opening and closing it changes nothing. A **Calendar date** field has **Pick a day** instead: a month to click a day in, menus to jump to another month or year, and **Today** and **Clear**. It writes the day as `2026-09-08`.
5. Under **Dates**, **Add Date** offers what the page can still take: **Add lifespan** on a Character adds **Born** and **Died**, **Add Span** on an Event, a Journey or a Place adds **Start** and **End**, and **Date…** adds a Date you name yourself. When one half of the pair is already there, only the other is offered. The new field is ready to type in; it is written to the file once it holds a value.
6. Try it once: create a Character with [New Character](command:create.character), choose **Add Date**, then **Add lifespan**, and fill in **Born** and **Died**, typing one and picking the other. Run [Go to Timeline](command:nav.timeline): the two Dates make a Span, drawn as a bar on the Character's own Lane. Delete the Character from its page header if it was only practice.

## Good to know

- Choose **Date (Bible)** for Scripture chronology and **Calendar date** for today's world.
- On a phone, both pickers open from the bottom of the screen.
- A Date the picker writes is always one the app can read. The app never rewrites a Date on its own: only your pick or your typing changes it.
- A Span is never declared: any page with `born` and `died`, or `start` and `end`, has one. Any other Date is a single mark on its Lane.
- A Place with a **Start** and no **End** is drawn running on to the edge of the Timeline: a city still standing.
- A name the Vault already uses with another type cannot become a Date: a name has one type everywhere.
- Property names stay in English in the file (`born`, `died`), whatever the app's language, so the Vault reads the same in Obsidian.

# Live Preview & Source mode

Documents open in Live Preview: markdown syntax is hidden and shown as what it means, except on the line you are editing. Source mode shows the raw markdown exactly as it is stored, for when you want to see or type the syntax itself. The text underneath is the same in both.

1. Open one of your Notes with [Search](command:nav.search). Headings, bold and checkboxes appear without their `#`, `**` and `- [ ]`. Click into a heading: its `#` shows on that line only.
2. Run [Source mode](command:editor.source). Every line now shows the markdown as it is in the file, `[[links]]` and all. Nothing in the file changed; only how it is shown. The code button in the header is highlighted while Source mode is on.
3. Try it once: create a Note with [New Note](command:create.note) (its **Delete** button in the header removes it again). Type `## A heading`, then on the next line `**some bold words**`. Run [Live Preview](command:editor.source): the `##` disappears, and the `**` disappears too as soon as the cursor leaves that line.

## Good to know

- The mode is one setting for every document, and stays as you left it until you switch it again.
- Passages, links and Tags stay highlighted in both modes.

# Community Skins

Every Skin in this folder appears in the app's **Skin gallery** (Settings → Appearance → Gallery), where anyone can try it on and install it into their Vault. The app fetches `index.json` and the Skin files from this folder on `main` when the gallery is opened, so a Skin merged here reaches every user without a release. Once installed, a Skin belongs to the Vault: later changes here don't reach it until the user installs it again.

A Skin that isn't here can still be shared as a file and brought in with **Import…**.

## Submitting a Skin

1. Make the Skin in the app (Settings → Appearance → Customize), then **Export…** it.
2. Put the file here as `<name>.json`, in lower-case words joined by hyphens (`nord.json`, `dusk-reading.json`). Keep the `id` the app gave it, and set `author` to your name or GitHub handle.
3. Run `npm run skins:index` to add it to `index.json`, then `npm run test:unit`.
4. Open a pull request with a screenshot of each side you defined, light and dark.

## What the checks require

`npm run test:unit` runs these checks on every pull request:

- The file parses as a Skin with a name, and its `id` is a ULID.
- No two Skins share an id, or a name, ignoring case.
- Every override names a colour this version of the app knows.
- On every side the Skin defines, Text on Background reaches 4.5:1.
- `index.json` is exactly what `npm run skins:index` writes.

Review also looks at what the checks can't: the accent's contrast, how Passages, links and Tags read in the editor, and a name that doesn't pass the Skin off as someone else's product.

## Credits

- **Nord**: palette by Arctic Ice Studio and Sven Greb, [nordtheme.com](https://www.nordtheme.com), MIT licence.

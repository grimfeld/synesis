---
status: accepted
---

# Skins live in the Vault; the active Skin is the Vault's, the Appearance mode is the Device's

A Skin (colours and typography for a light and a dark side) could have been a Device preference, like the language and every other setting in `settings.json`. We decided Skins are stored in the Vault at `.bible-study/skins/<name>.json`, and the active Skin is recorded in the Vault at `.bible-study/appearance.json` by Skin id, so that every Device opening the Vault wears the same look without re-importing it. What depends on the screen and the reader stays per Device: the Appearance mode (Light, Dark, System) and the Text scale.

The look is set up once and should follow the user's study to the phone; a Vault-specific look also tells two Vaults apart at a glance. Font sizes in a Skin are relative for the same reason — the Text scale turns them into pixels per Device.

## Considered options

- **Skins per Device**, in the app config directory. Keeps the Vault pure content and lets a phone differ from a desktop, but every Device needs the Skin imported by hand and a shared look drifts. Rejected.
- **Skins in the Vault, active Skin per Device.** Rejected: installing a Skin everywhere but wearing it in one place gives the cost of both and the benefit of neither.

## Consequences

- Skins reach Paired Devices through ADR 0016; the built-in Skins ship with the app and never enter a Vault.
- A Vault pointing at a Skin this Device has not received yet, or that was deleted, falls back to the built-in Skin without complaint.
- Before a Vault is open (boot, Welcome) there is no Skin to read, so each Device caches the last resolved Skin and paints with it first.
- Obsidian ignores `.bible-study/`, so ADR 0003 is untouched: no Skin affects how the Vault looks in Obsidian.

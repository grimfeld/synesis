---
status: accepted
---

# The Map's base layer is a bundled atlas, with online detail only up close

The Map drew Places over the standard OpenStreetMap tiles: motorways, national borders and modern city names in saturated colours, deaf to the Skin and dark mode, and needing the network in a local-first app. We decided the base layer is a shaded-relief atlas built from Natural Earth (public domain), with no modern labels or roads, tiled for the Bible's world (the eastern Mediterranean to Mesopotamia) at zooms 3–8 and bundled with the app. It is toned from Skin tokens, so dark mode gets a dark atlas. Beyond zoom 8, where the atlas runs out of resolution (about 1 km a pixel), a muted online layer fades in when there is a network; offline, the atlas simply stops at zoom 8.

A Bible map should look like a Bible atlas, not a navigation app, and it should work on a plane. Close-up detail (Gethsemane against the Temple) is rare enough to be allowed to depend on the network.

## Considered options

- **Keep OpenStreetMap's standard tiles.** Free and already built, and rejected: modern labels on an ancient map, no theming, online only, and OSM's tile usage policy does not cover an app shipped to many users.
- **A muted online style** (light and dark "Positron"-style tiles). Much of the visual gain for little work, and rejected because it keeps modern labels, the network dependency and a third party's terms.
- **The bundled atlas alone.** Fully offline, and rejected because the Map would go blurry at exactly the zoom where two Places in one city need telling apart.

## Consequences

- The app grows by the tile set (estimated 15–25 MB; measure before building, and drop zoom 8 before accepting much more).
- The atlas needs a reproducible build script that fetches Natural Earth and cuts the tiles, so the bundle can be regenerated rather than hand-kept.
- Tests keep relying on `data-zoom` / `data-center` rather than on tiles, which are now local but still pictures.

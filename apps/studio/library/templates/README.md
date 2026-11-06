# Template media (shipped with the app)

The template designs are code in `packages/composition/src/templates/library/`.
Their media lives here so every server starts with it:

- `music/<template-id>.mp3`: each template's music track (ElevenLabs Eleven Music, paid plan, commercial use).
  The first time a template's music is needed, the app copies the file into the active storage
  (`storage/assets/lib-template-<id>.mp3`, or R2 when configured). Nothing is regenerated.
- `stock-picks.json`: the Pexels photo chosen for each photo slot, per template and orientation.
  The gallery reads these first, so browsing costs no Pexels searches. Picks made on a server
  (when a slot's search changes) are saved in `storage/templates/` on top of these.

## Adding or changing a template

1. Edit or add the design file.
2. Generate its music once on your machine (Templates page, or the `generate-template-music` action, people only).
   In development the new track is also written here as `music/<id>.mp3`.
3. Open the template in the gallery once so its photo picks are saved, then copy
   `storage/templates/stock-picks.json` entries you want to keep into `stock-picks.json` here.
4. Commit the design file and the media together, then deploy.

Later this moves to a managed catalog (media in R2, packs and free/pro in the database).

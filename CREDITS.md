# Credits — Third-Party Assets

All bundled third-party assets are **CC0 / Public Domain** (no attribution legally
required). Listed here as good practice and to record provenance.

## Textures (OpenGameArt.org, CC0)
- **Dirty Grass Seamless** (ground detail normal + AO) — used as terrain detail maps.
  Source: "4K Seamless Grass Dirt Ground Texture with all Shader Maps", CC0.
  Files: `textures/oga/ground_detail_nrm.jpg`, `ground_detail_ao.jpg`, `ground_detail_color.jpg`
  (downscaled to 1024 to fit the texture-memory budget).
- **Wood** (tree bark) — from "Ground Textures Free", CC0.
  File: `textures/oga/wood.jpg` (downscaled to 512).

Procedurally generated in-engine (no external source): terrain color map, roof tiles,
vehicle/infantry weathering.

## Sound Effects (OpenGameArt.org, CC0)
- **25 CC0 bang / firework SFX** — bangs, cannon, and shots used for rifle fire,
  cannon/AT fire, and explosions. CC0.
  Files: `sounds/bang_*.ogg`, `sounds/cannon_*.ogg`, `sounds/shot_*.ogg`
  (firework `fw_*` files are bundled but currently unused).

The UI selection click is synthesized at runtime via WebAudio (no sample).

## Sound Effects (RWM 6.8, RWM-Zero public-domain dedication)
The **complete** RWM sound bank (`SOUNDS.HDR`/`SOUNDS.RUS`) was decoded and
re-encoded to OGG: all 330 named sounds / 693 clips, named by sound + variation,
in `sounds/rwm/` with an index at `sounds/rwm/MANIFEST.json`. RWM is released
under the "RWM Zero License (RWM-Zero 1.0)", an explicit public-domain
dedication of its source, assets, artwork, and audio.

Format: the bank is a clip pool (each `[u32 rate][u32 bits][PCM]`); `SOUNDS.HDR`
holds 64-byte name records, each followed by a variation count + global clip
indices into the pool. Decoded with the parser in `tools/` and ffmpeg.

The game currently uses a curated subset (rifle, MG/SMG bursts, cannon/AT,
explosions, plus wind/birds ambience and a diesel engine bed); the rest of the
library is available for reuse.

## Game logic reference (RWM, RWM-Zero public-domain dedication)
RWM's game logic was reverse-engineered from its binaries/config (unit attribute
schema, unit types & engine modules, orders & controls, AI behaviors, mission
scripting, UI) and documented in `docs/reference/rwm/`. We use it as a design
reference to bring worthwhile mechanics into Under Fire. First port: towed-gun
**deploy / limber (siege)** for AT guns and heavy MGs. Same public-domain
dedication as the RWM sound bank above.

## Playtesting & bug reports

Thanks to the people kicking the tyres and telling us what's broken:

- **willythemoviemaker** — early playtesting and a detailed run of bug reports
  (firing, line-of-sight, formations, death handling, menu, and more).
- **tesserS** — playtesting and feedback.


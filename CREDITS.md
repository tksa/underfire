# Credits — Third-Party Assets

Most bundled third-party assets are **CC0 / Public Domain** (no attribution legally
required); listed here as good practice and to record provenance. The **UI icons**
are **CC-BY 3.0** and attribution is required — see "UI Icons" below.

## UI Icons (game-icons.net — CC-BY 3.0)
Command-bar glyphs in `icons/` are from [game-icons.net](https://game-icons.net),
used under CC-BY 3.0. Icons made by:
- **Lorc** — grenade, bombing-run, gas-mask (smoke)
- **Skoll** — bayonet (attack-move)
- **Quoting** — artillery-shell (attack-ground)

(White-on-transparent variants, recoloured via CSS.)

## Textures (OpenGameArt.org, CC0)
- **Dirty Grass Seamless** (ground detail normal + AO) — used as terrain detail maps.
  Source: "4K Seamless Grass Dirt Ground Texture with all Shader Maps", CC0.
  Files: `textures/oga/ground_detail_nrm.jpg`, `ground_detail_ao.jpg`, `ground_detail_color.jpg`
  (downscaled to 1024 to fit the texture-memory budget).
- **Wood** — from "Ground Textures Free", CC0. File: `textures/oga/wood.jpg`
  (downscaled to 512). Was the tree bark; superseded by the oak bark below.

## Textures (Poly Haven, CC0)
- **Jolcham Oak Bark 01** (tree bark colour + normal) — used on the trunks/branches
  of the EZ-Tree trees. Source: [polyhaven.com](https://polyhaven.com/a/jolcham_oak_bark_01), CC0.
  Files: `textures/bark_color.jpg`, `textures/bark_normal.jpg` (1K, downscaled to 512x1024).

Procedurally generated in-engine (no external source): terrain color map, roof tiles,
vehicle/infantry weathering. Tree geometry is generated at runtime by EZ-Tree (see
Code Libraries); only the CC0 textures above are bundled.

## Code Libraries
All loaded at runtime from a pinned CDN (jsDelivr) via the importmap; not bundled,
and no build step.

- **EZ-Tree** by Daniel Greenheck — procedural tree generator, **MIT licence**.
  We use its geometry only and render it with the CC0 bark/leaf textures above.
  Source: https://github.com/dgreenheck/ez-tree
- **postprocessing** by Raoul van Rüschen (pmndrs) — bloom, tilt-shift depth-of-field,
  colour grading, vignette and SMAA, **MIT licence**.
  Source: https://github.com/pmndrs/postprocessing
- **Three JS Upscaler** by Elijah Brown (DevsDaddy) — FSR-like edge-enhancing
  upscaling shader, **MIT licence**. The shader is ported into `js/engine.js`.
  Source: https://github.com/DevsDaddy/threejs-upscaler

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


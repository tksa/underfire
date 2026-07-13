# Credits — Third-Party Assets

Most bundled third-party assets are **CC0 / Public Domain** (no attribution legally
required); listed here as good practice and to record provenance. The **UI icons**
are attribution-licensed, while the user-provided Polish voice recordings and
mounted-cavalry model have separate provenance with no CC0/public-domain claim
made here.

## UI Icons (game-icons.net — CC-BY 3.0)
Command-bar glyphs in `icons/` are from [game-icons.net](https://game-icons.net),
used under CC-BY 3.0. Icons made by:
- **Lorc** — grenade, bombing-run, gas-mask (smoke)
- **Skoll** — bayonet (attack-move)
- **Quoting** — artillery-shell (attack-ground)

(White-on-transparent variants, recoloured via CSS.)

## UI Icons (IconaMoon — CC BY 4.0)
The building-entry cursor uses the **Enter** icon (Thin) from
[IconaMoon](https://github.com/dariushhpg1/IconaMoon) by **Dariush Habibpour**,
used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (recoloured
+ embedded as an inline SVG cursor in `index.html`).

## 3D Models (Sketchfab, CC BY 4.0)
The French **Char B1 bis** tank model (`models/french_b1.glb`) is by
**MaximDeduytsche** ([Sketchfab profile](https://sketchfab.com/MaximDeduytsche)),
used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Source: https://sketchfab.com/3d-models/char-b1-bis-e8a1fbe0981940b1b4ddcc1a4271ae93

"French Somua S35" (`models/french_s35.glb`) is by **Basic Hsu**
(https://skfb.ly/ptt8z), used under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
(Textures downscaled to 1024 and recompressed for web; geometry unchanged.)

"Hotchkiss H35" (`models/french_h35.glb`) is by **theonrad**
(https://skfb.ly/RLFI), used under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
(Textures downscaled and recompressed for web; geometry unchanged.)

"Renault R35(Girls Und Panzer)" (`models/french_r35.glb`) is by
**Sankocho_DePoligonos** (https://skfb.ly/oP7Yo), used under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). (Its placeholder
textures were replaced in-engine with a weathered French-green repaint.)

"French Panhard 178" (`models/french_panhard.glb`) is by **42manako**
(https://skfb.ly/pw9AX), used under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
(Textures recompressed for web; geometry unchanged.)

The **Renault AHN3 supply truck** (`models/french_supply.glb`) and the
**Laffly fuel truck** (`models/french_fuel.glb`) are original models created for
Under Fire by the project, released as **CC0 / public domain**.

The skinned **WWI/WWII soldier** (`models/soldier.glb`, used for all foot
infantry) is a Sketchfab model ("German WWI Soldier"). **TODO: confirm author +
exact licence/source URL before public release.** Textures downscaled to 512 and
recompressed for web; geometry/rig unchanged.

The **field divider set** (`models/dividers/` — four dry-stone wall variants and
a wooden farm fence) and the **stone bridge** (`models/bridge_stone.glb`) are
original models created for Under Fire by the project (tksa, with ChatGPT +
Sam3D), released as **CC0 / public domain**. (Optimized for instancing: meshes
simplified and textures downscaled via gltf-transform; the walls are re-skinned
in-engine with a procedural dark fieldstone texture.)

## Polish Mounted Cavalry Model (user-provided; separate provenance)

The project owner supplied the rigged horse-and-rider GLB used for the Polish
`mounted_ulan` runtime model (`models/polish_mounted_ulan.glb`). The supplied
asset contains 17 animation clips; the project uses it for the four player-controlled
mounted reserves at Mokra and their mount/dismount presentation.

The source was provided directly to the project, without a public source URL or a
public licence declaration. **No CC0, public-domain, or other public-redistribution
licence is asserted for this model in this document.** Its source provenance and
redistribution rights must be confirmed before distributing it outside the project.

### Horse motion references (not bundled)

The cavalry locomotion was visually compared with the following works by
**Amitesh Nandan**, both licensed under
[CC BY-ND 4.0](https://creativecommons.org/licenses/by-nd/4.0/):

- [Horse Trot](https://skfb.ly/6VDWA)
- [Horse Run](https://skfb.ly/6VCoE)

The reference GLBs are not included in the game, and their morph-target animation
data was not copied or retargeted. They were used only to study gait silhouette,
leg phasing, suspension, and cadence while authoring the project's separate
skeletal animation.

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

## Polish Voice Recordings (user-provided; separate from RWM)

The project owner supplied 77 Polish WAV voice recordings. The original WAV
masters remain outside the repository. Runtime copies are stored in
`sounds/voices/pl/`; they are separate from `sounds/rwm/` and are not entries in
the RWM manifest. **No CC0 or public-domain licence is asserted for these
recordings in this document.**

Of the 77 recordings, the infantry pools use 16 selection, 30 movement,
6 core-attack, and 18 morale/patriotic takes. Polish tank pools reuse
vehicle-neutral supplied recordings: 15 selection, 17 movement, 5 core-attack,
18 shared vehicle-safe morale/patriotic, and 8 stop takes. Because the pools overlap,
75 unique assets are active overall. Dedicated vehicle-crew recordings remain
desirable, but tanks are not silent. Only
`formal-variants/oddzial-gotow-panie-kapitanie` and
`patriotic/za-warszawe` remain reserved for suitable later use.

Runtime processing produces mono 22,050 Hz, signed 16-bit FLAC audio in Ogg
containers, with an 80 Hz high-pass filter and fixed -8 dB gain adjustment. The
repeatable conversion command is implemented in `scripts/process-polish-voices.sh`.

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
- `models/fr_house_2.glb` — French town house, generated by the project author with SAM 3D from their own photo; dedicated to the public domain (CC0).

## Aircraft

- `models/dewoitine_d520.glb` — "Dewoitine D.520" (https://skfb.ly/MPER) by
  **helijah**, licensed under **Creative Commons Attribution 4.0**
  (http://creativecommons.org/licenses/by/4.0/). This is an
  attribution-required asset; keep this credit intact wherever the model ships.
- Fighter engine drone and strafing audio are synthesized in code (no asset).
- `models/bloch_mb152.glb` — "Bloch MB.152" by **helijah** (Sketchfab),
  licensed under **Creative Commons Attribution 4.0** — attribution required.
  (Same author/license family as the D.520 above; confirm the exact Sketchfab
  URL before public release.)
- `models/german_panzer3.glb` — "Panzer 3 Ausf. J" (https://skfb.ly/pA7pr) by
  **Arthur C. Galuppo**, licensed under **Creative Commons Attribution 4.0**
  (http://creativecommons.org/licenses/by/4.0/) — attribution required.

# Under Fire — Effects & Tunables Reference

A map of the visual + reactive effect systems added to the game, where they live,
and the debug-panel knobs for each. Open the debug panel with the **backtick (`` ` ``)**
key; post-processing/VALOR/building/shadow controls are grouped at the bottom, and
**Copy values** dumps the current settings as a paste-back block.

All effects are **degradable**: if a system can't initialise (missing GL feature,
CDN, or asset) the game falls back to a plain render / procedural mesh.

---

## VALOR post-processing (`js/valor.js`, wired in `js/engine.js`)

One extra full-screen pass on top of the pmndrs/postprocessing composer, plus
shared material uniforms. Master toggle per group; each scales to zero cleanly.

| Stage | Effect | Debug group → controls | Default |
|------|--------|------------------------|---------|
| 1 | **Aerial perspective** (distance desaturate + haze tint), **film grain**, **exposure** | VALOR → Exposure, Aerial Strength/Start/End, Far Desaturate, Haze Tint, Film Grain | exposure 1.31, aerial 0.35, desat 0.52, tint 0.3, grain 0.02 |
| 2 | **Sfumato** (far edge softening), **chiaroscuro** (local-contrast unsharp) | VALOR → Chiaroscuro, Sfumato, Sfumato Start | chiaro 0.12, sfumato 0.3 |
| 4 | **Pseudo-semantic grade** (hue-inferred: foliage/skin/metal) + palette desat + temperature | VALOR Grade → Palette Desaturate, Temperature, Foliage Saturation, Metal Desaturate, Skin Warmth | desat 0.09, temp 0.02, foliageSat 0.66, metalDesat 0.42, skinWarm 0.5 |

The haze tint auto-syncs to `Game.scene.fog` each frame. Camera is orthographic,
so the depth buffer is linear and aerial/sfumato use it directly.

### Stage 3 — material weathering (`Game._valorWeatherInject`, in `js/buildings`/`units`/`terrain` via `_addWeathering`)
World-space dirt/grime, up-facing edge-wear, wetness (roughness) and snow,
injected into MeshStandard materials on **units + terrain**. Shared uniforms.
- VALOR Materials → Material Weathering (master), Dirt/Grime, Edge Wear, Wetness, Snow.
- Grime uses smooth value-noise (no tile-grid artifact).

### Stage 5 — persistent scorch decals (`js/renderer.js`)
Explosions leave soft burn marks that persist (pooled flat ground quads,
procedural soot texture, capped). Hooked into `Game.addBlastFlash`.
- VALOR Decals → Scorch Marks (toggle), Scorch Opacity, Scorch Max Count (default 0.5 / 140).

---

## Foliage (`js/terrain.js`, controls in `js/valor.js`)

- **Soft-blend (overlay blur):** feathers leaf-card alpha so trees/hedges meld
  into the background instead of hard cut-outs. Separate sliders for trees vs
  hedges. VALOR Foliage → Tree Blend (0.62), Hedge Blend (0.3).
- **Tank knock-down:** a moving tank flattens small trees + bushes (pivots the
  instance about its base toward travel). VALOR Foliage → Tanks Crush Foliage.
- Forest density was halved + a global ~30% thin (in `buildTerrainMeshes`).

---

## Buildings (`js/buildings.js`)

Model-driven houses with damage states (GLB: `House_0_undam/1/2/3_heavy`),
matched by name prefix; only one state visible at a time, undamaged by default.

- **HP / states:** `BUILDING_MAX_HP` (460). Bands at 100/75/50/25% → states 0–3.
  A few hits to crack to state 1, many more to reach the wreck.
- **Damage delivery:** right-click a building (armed units) shells it; tank HE +
  all explosions damage via `Game.addBlastFlash → Game.damageBuildingAt`; non-HE
  rounds chip on impact. LOS is validated to the building's near edge.
- **Hit FX:** throttled dust/smoke + masonry per hit (`Game._buildingHitFx`).
- **Destruction:** big smoke burst — tall column + footprint dust
  (`Game._buildingDestroyedSmoke`); shows `House_3_heavy`, or procedural rubble
  if no heavy-state mesh; stops sight-blocking; clears shellers; buries occupants.
- **Garrison capacity:** footprint-scaled (`registerBuilding`, 2–12 troops),
  occupancy-tracked, capacity-enforced enter/exit; collapse ejects + harms.
- **Debug:** Buildings → Damage × (shots to wreck), Smoke ×, Max HP (live).
- **Placement:** one fixed scale (`BUILDING_SCALE` 5.5, no per-footprint resize);
  long footprints tile a row of houses with rotation variety (180° flips + yaw).
- **Adding a building model:** drop a Draco GLB with state nodes named
  `House_0_undam/House_1/House_2/House_3*` (separate objects, not joined). The
  DRACO decoder loads from jsDelivr (`js/engine.js`).

---

## Combat / reactive effects

- **Tank crush:** a moving tank runs over **enemy** infantry/crews (friendly step
  aside). `Game.crushUnit` / `Game.applySeparation` (`js/main.js`).
- **Grenades / smoke:** game-loop thrown projectiles (arc, respect pause); smoke
  blocks LOS. Enemy infantry lob **anti-tank grenades** at close player tanks
  (`js/main.js`, `js/ai.js`).
- **Air strike:** wheel selects planes-to-use of those available; rolling
  multi-plane bombardment + synthesized incoming-plane drone (`js/audio.js`).
- **Tank tracks:** fading decals, **fog-gated for the enemy** (you can't read
  enemy movement through unexplored map). `js/renderer.js` / `js/unit_modules.js`.
- **Unit engagement hysteresis:** units hold a firing position once in range+LOS
  and only re-pursue past ~1.18× range (no edge-of-range "twitch").

---

## Impact & dust FX (doc-driven — `ww2_rts_realistic_effects_breakdown.md`)

Staged realism pass over weapon impacts. Implemented stages:

**Stage 1 — dust model (`js/renderer.js` `updateSmoke3D`, `js/main.js` `addBlastFlash`)**
- **Two-stage opacity curve** (doc §2.1): every dust/smoke puff drops ~65% opacity
  in the first 35% of its life, then a slow drifting tail (no more linear fade).
- **Terrain-tinted dust** (`Game._dustColorAt`, doc §8/§20): dust is coloured by
  the ground it was kicked up from — dry tan, wet dark, road/masonry grey, forest
  organic, snow white, water mist. An explicit `s.tint` (e.g. black fuel smoke)
  overrides. Per-puff `rise` and `maxOpacity` fields added.
- **Richer HE impact** (doc §6.2): real explosions (`addBlastFlash` scale ≥ 0.6)
  spawn a rising dirt column + a low ground shock ring + thrown clods, all scaled
  by blast size. Muzzle flashes (< 0.6) stay clean.
- **Distance-scaled camera shake** (doc §17): shake = blast × nearness-to-view;
  distant shells in a big battle don't rattle the screen.

**Stage 2 — AP vs HE ground impact (`js/main.js` `fireAtGround`, `_apGroundImpact`)**
- **HE** craters + dust column, both sized by caliber (`heBlast`).
- **AP / kinetic** (`Game._apGroundImpact`, doc §6.1/§15.2): a directional dirt
  lance flung forward along the shell path + a spark + a narrow gouge scar, and
  **no round crater**. Only penetrators (tanks, AT ≥ pen 2) throw the lance.

**Debug — Effects group** (backtick panel): Dust Opacity, Dust Lifetime x,
Impact Dust x, Camera Shake x (live globals `Game.fxDustOpacity/fxDustLife/fxImpactDust/fxShake`).

Remaining staged work (planned): vehicle destroyed states + wreck smoke;
terrain/weather dust modifiers + dust LOS block; fire + secondary explosions.

---

## Shadows & fog (`js/engine.js`, `js/main.js`)

- **Shadows:** soft default (`sun.shadow.radius` 4). Debug Shadows → Shadow Blur,
  Shadow Strength (global; affects tree shadows et al.).
- **Fog of war:** dims by map position regardless of height (`depthTest:false`),
  so tall tree tops don't poke above the sheet and stay bright.

---

## Notes
- Bundled models/textures must be CC0 and listed in `CREDITS.md`.
- Asset caches on the live host: HTML/JS/data are `no-cache`; if a referenced
  texture/model 404s during a deploy window, bump `ASSET_V` in `js/terrain.js`
  (cache-buster) and ensure the asset is uploaded.

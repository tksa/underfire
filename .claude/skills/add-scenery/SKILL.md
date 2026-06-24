---
name: add-scenery
description: Add or change terrain, scenery, fields, props, or map features in Under Fire (buildings, trees, hedgerows, the village, river, bridge, new tile types, textures). Use when someone asks to change the map, add scenery, or adjust the landscape look.
---

# Add scenery / terrain

The map is generated in `js/terrain.js`. Two functions matter:
- `Game.generateMap()` — builds the tile grid (fields, roads, river, village, props) and records prop data (`Game.buildings`, `Game.haystacks`, `Game.church`, `Game.windmill`, `Game.bridges`, ...).
- `Game.buildTerrainMeshes()` — turns tiles + recorded props into Three.js meshes.

## Add a field / tile type
1. Add a colour to `Game.TILE_COLORS` and gameplay defaults to `Game.makeTile` (move cost, cover, concealment, blocked).
2. Mirror the colour in the minimap palette `TILE_COLORS_2D` in `js/renderer.js`.
3. Paint it in `generateMap` (see the patchwork-field generator) and, if it needs a cultivated-rows look, add a case in `buildTerrainTexture`.

## Add a prop (building, landmark, etc.)
Follow the existing examples in `buildTerrainMeshes` — the church (`Game.church`), windmill (`Game.windmill`), haystacks (`Game.haystacks`), and stone bridge (`Game.bridges`) are all readable, self-contained blocks you can copy. General pattern:
1. In `generateMap`, decide placement (tile coords), optionally stamp footprint tiles (`Game.setPatch`/`Game.addBuilding`), and push prop data onto a `Game.<thing>` array/object.
2. In `buildTerrainMeshes`, read that data and add meshes to `Game.terrainGroup`. Use `Game.getHeight(x, z)` to sit props on the terrain.

## Trees / hedges
Instanced meshes in `buildTerrainMeshes` place trees on `forest`/`orchard` tiles, treelines on hedgerows, and scattered clusters. Tune counts/placement there.

## Textures
Put **CC0** textures in `textures/` (CC0 OpenGameArt set lives in `textures/oga/`). Reference by relative path; add to `CREDITS.md`.

## Heightmap
`Game.shapeHeightmap()` flattens roads/yards/buildings and carves the river channel. If a new feature needs flat or carved ground, extend it there.

## Test
Run the `run-and-test` skill and screenshot the area (set `Game.cam.x/z/zoom` to frame it). Keep the combat corridor and unit spawns passable.

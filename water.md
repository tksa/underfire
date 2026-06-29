# Water effect removal

Status: removed from the runtime.

## What changed

The animated water effect was removed entirely. This includes:

- `js/jeantimex_water.js` deleted.
- `jeantimex_water` removed from the script load list in `index.html`.
- The GPU ripple simulation, random drop helpers, and `Game.updateWater()` loop were removed from `js/main.js`.
- The translucent water surface mesh, shader patching, normal-map scrolling, and additive flow overlay were removed from `js/terrain.js`.
- The generated debug-menu Water groups were removed from `js/engine.js`.
- Water-specific post-processing export values were removed from the copied debug config.
- Water FX globals and raise-surface controls were removed from `js/config.js`.

## What remains

Water remains as terrain/map data:

- Tiles can still be `type: 'water'`.
- The terrain renderer still colors water tiles through the normal terrain material path.
- Riverbed/depth shaping remains in `js/terrain.js` so the terrain can still sink under water tiles.
- Bridges still use the existing river/tile data.

In other words: the custom visual water layer is gone, but the map can still contain water terrain.

## Reason

The animated effect was not producing believable RTS-scale water. It added a separate surface mesh, shader uniforms, flow overlay, and debug controls, but the result still looked artificial and made the debug menu harder to reason about. Removing it returns water to the terrain system instead of carrying a broken effect path.

## Follow-up

If water is rebuilt later, start from a small static terrain treatment first: clear water tile art, a soft shoreline mask, and no independent animated overlay until the base river shape reads correctly.

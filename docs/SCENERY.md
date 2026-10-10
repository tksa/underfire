# Farm scenery

Four building appearances now share existing damage, garrison and collapse
records: the original stone shop, a recovered farmhouse, a taller cottage
(asset key `farm_barn`) and a farm outbuilding (`wood_shed`). Plot fit is checked
at the infantry's metre scale; oversized structures retain the original fallback.

The supplied MOW AS2 archives provide haystacks/hayricks, farm carts, wooden
barrels, firewood, sacks, wells, ploughs and rail fences. Fourteen GLBs were
converted, including a plank-fence and annex variant retained for further map
editing. Source paths and SHA-256 hashes accompany each model. The converter
assembles model placements with one coordinate reflection, preserving joined
walls and roofs. Source materials remain intact; textures are capped at 512px.
The converted collection occupies approximately 5.7MB on disk.

Farm objects are placed deterministically beside suitable buildings and field
edges, avoiding roads, water, doors, steep ground and spawn lanes. Larger props
register cover/collision and release it when destroyed, leaving a flattened
remnant. The 84-object budget is independent of battle size. Shared geometry,
materials and 48-unit instance chunks limit draw and memory costs.

Fence placement uses measured endpoints. Per-piece yaw and 12% overlap were
removed. A spatial pass removes duplicate boundaries, trims crossings and keeps
gaps at road junctions. Connected pieces share their run direction and meet at
endpoints. Destructible fence instances retain their knockdown records.

Run `scripts/scenery-test.mjs` for placement, destruction, collision, garrison
and join checks, and `scripts/scenery-gallery.mjs` for the source-model review.

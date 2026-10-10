# Model pipeline

Under Fire loads GLB assets through `Game.loadModel` and normalizes unit models
in `js/units.js`. Engine-local forward is **+Z**, up is **+Y**. The simulation
heading maps to mesh yaw as `Math.PI / 2 - unit.angle`. Check the actual imported
hierarchy: an asset can contain its own scale and axis-conversion nodes.

## Placement and animation

`MODEL_YAW`, `MODEL_SCALE`, model-name mappings and the loader's measured bounds
control placement. Scale is normalized per model/unit; it is not a universal
`0.5 * unit.size`. A missing vehicle keeps its procedural silhouette. The
dormant `tiger-E.glb` is not the fallback for every tank.

The loader detects turret and barrel nodes and records their base rotations.
New rigid models use explicit `vehiclePart` tags and identity rest rotations;
`js/vehicle_model.js` handles wheels, steering, trails and gun recoil. Their
embedded `weaponMuzzle` markers take precedence over name-based detection.
Separate barrels follow turret traverse and recoil. Fused S35 and Panzer III
geometry is partitioned at runtime, using indexed triangles. The S35 partition
includes the entire barrel below the turret cut so it does not remain on the
hull when traversing. Twin 7TP turrets retain their individual pivots.

`infantry/mow-{soldier,french,polish}.glb` supplies the replacement infantry and
gun-crew rigs, with 50 named clips per skin and separate equipment subtrees.
The old `soldier.glb` remains a legacy asset and is not the default runtime rig.
`js/mow_soldier_model.js` selects faction models, role weapons and clips; the
legacy synthetic leg gait is disabled. Skin bounds from the bind pose are not
used for frustum culling: unit/fog visibility still controls the whole actor.
Never blend between positive and negative joint scales; the asset test checks
reflection consistency across every clip. Additional recoil/aim motion is
restored before the mixer, while authored crew actions run without that legacy
restore layer. `polish_mounted_ulan.glb` supplies horse/rider clips.

## Campaign materials

`js/army_materials.js` retains source camouflage, weathering, UVs, alpha modes,
markings and normal maps. Textured paint receives only a bounded 15% exposure
correction. The aggressive faction palette replacement and generated surface
noise were withdrawn after visual review. Rubber, running gear, wood, canvas,
steel and paint retain separate roughness responses. Per-unit material clones
prevent the shared mortar asset from inheriting another faction's paint.

The R35 retains all eight original texture maps and double-sided surfaces.
Its source turret has 9,534 corner normals opposing the triangle winding;
the isolated geometry repair rebuilds normals without changing positions,
indices or UVs. `scripts/army-material-test.mjs` checks roof coverage, normal
orientation, map preservation, faction isolation and shader compilation.

## Weapon origins

`js/weapon_mounts.js` binds `weapon_muzzle` objects to the actual moving gun or
weapon bone. `MODEL_WEAPON_NODES` identifies the shipped fused/unnamed meshes.
Barrel tips are measured from drawn vertices in engine-local coordinates;
discarded hull vertices in shared split-mesh buffers are excluded. A world
bounding-box corner cannot identify a muzzle reliably.

Infantry weapons contain named muzzle nodes under their hand attachment. Their
native +X barrels are mapped to the engine's +Z forward. Mounted cavalry uses vertices
rigidly weighted to `Gun`, transformed through the inverse bind pose, so the
anchor remains correct through directional takes and model normalization.
Mortars and guns declare their visible tube/barrel; all three HMG teams now have
dedicated GLBs and two animated crew figures. Strafing fighters
have visible wing barrels at measured leading-edge sections; their anchors
follow bank and pitch. The scripted train's turrets traverse before firing and
its shells originate at the recoiling barrel tips.

`Game.getWeaponMuzzle(unit)` synchronizes this simulation frame's hull/turret
heading before returning world position and bore direction. Both direct fire
and attack-ground use it. Tracers, flashes and smoke carry the same origin,
including height. Twin turrets alternate their shot origins. An unbound weapon
has an explicit fallback flagged by the audit.

## Adding or replacing an asset

1. Export a GLB with embedded materials and no unwanted cameras/lights. Preserve
   skinning and animation channels for animated units.
2. Prefer a named `turret` with a child `gun` or `barrel`. Set sensible pivots.
   Add a model-specific node mapping when automatic discovery is insufficient.
3. Verify scale, forward direction, wheel axes, ground contact and crew placement
   in the game. Asset materials are normally retained, with existing skin and
   per-model material handling applied by the loader.
4. Add the configuration to `scripts/model-weapon-audit.mjs`. Review at zero and
   quarter-turn traverse, plus the recoil check. Use the muzzle markers to check
   geometry, not just equality between two computed effect positions.
5. Record the asset's source and license in `CREDITS.md`.

```sh
node scripts/model-weapon-audit.mjs /tmp/underfire-model-review --assert
node scripts/model-coverage-test.mjs
node scripts/model-roster-gallery.mjs
node scripts/weapon-actors-test.mjs /tmp/underfire-actor-review
node scripts/fieldgun-model-test.mjs
node scripts/infantry-asset-test.mjs
node scripts/infantry-visibility-test.mjs
```

The weapon audit covers 32 ground configurations, with separate aircraft/train
checks. Core roster coverage checks all 63 configurations and 14 crewed weapons;
none retain generic geometry. Additional GLBs cover farm scenery, railway pieces
and dormant assets. See `docs/MODEL_COVERAGE.md` for the 15 new
GLBs, runtime articulation, source variants and remaining art approximations.
The larger imported CSV catalogue still has missing dedicated models; core
coverage does not claim every extended type or exact historical variant is finished.

Farm scenery conversion and placement are documented in [SCENERY.md](../docs/SCENERY.md).
Vehicle and infantry proportions are documented in [UNIT_SCALE.md](../docs/UNIT_SCALE.md).

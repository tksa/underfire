# Core roster model coverage

Updated 2026-09-11. The runtime coverage test loads **63 core unit
configurations**, using **38 distinct model paths**. All load a GLB; none keep
the generic geometry fallback. The core set is the built-in roster plus the
four Polish tank variants used by the current missions. **14 configurations
have two skinned weapon operators**, including all six mortar teams.

This is deliberately separate from the much larger imported CSV catalogue.
The extended catalogue still contains types and historical variants without
dedicated art. A loaded model also does not establish exact historical accuracy.

## Replacements in this pass

15 GLBs replace generated geometry for 17 core configurations:

| Runtime asset | Source / scope |
| --- | --- |
| `german_panzer1.glb` | User-supplied MOW `tank_light/pz1b`: enclosed Panzer I B with two separate MG barrels. `pz1` was rejected after its definition identified it as a Flakpanzer. |
| `german_panzer2.glb` | MOW `tank_light/pz2f`. **Ausf. F visual approximation** for the existing early Panzer II; gameplay armor and weapon stats are unchanged. |
| `german_panzer4.glb` | MOW `tank_medium/pz4g` hull/turret with an **original short, open-bore KwK37 presentation barrel**. The long gun and muzzle brake are not used. This is **not an exact early Ausf. D** hull. |
| `german_sdkfz.glb` | MOW `btr/sdkfz222`, preserving the open turret, gun, steering pivots, wheels and accessories. |
| `german_pak36.glb` | MOW `cannon/pak36`, with rolling wheels, animated split trails and barrel recoil. |
| `german_supply.glb`, `german_fuel.glb` | MOW `car/blitz3_6` and `car/blitz3_6f`; distinct cargo and tanker bodies. |
| `mortar46.glb`, `mortar50.glb` | Original compact Polish grenade-launcher and German light-mortar presentation geometry, with integral mounts, hand controls and ammunition chests. |
| `mortar60.glb`, `mortar81.glb` | Original Brandt-pattern tube, ribbed rectangular baseplate, bipod, traverse/elevation controls and optical sight. The 81mm asset is shared by French, German and Polish teams; exact national fittings remain approximations. |
| `polish_bofors37.glb` | Original notched shield, hollow barrel, breech, carriage, controls and folding split trails. No MOW 40mm AA Bofors is substituted for the 37mm AT gun. |
| `polish_wz34.glb` | Original compact riveted armored car with a polygonal turret, MG, steering front wheels, twin rear tyres and curved mudguards. Stylized presentation, not an exact preserved specimen. |
| `polish_supply.glb`, `polish_transport.glb` | Original Fiat 621L presentation with a bonnet/cab, radiator slats, lamps, running boards, live axles and slatted cargo body. Supply has crates/canvas; transport has open benches. |

Existing French/Polish tank and gun assets, shared infantry rigs, cavalry and
all three dedicated HMG models remain in use.

## Articulation and conversion

`scripts/convert-mow-vehicles.py` retains authored pivots but bakes rigid
rotations/reflections into vertices, giving the runtime an identity rest pose
and consistent +Y yaw axes. It reverses triangle winding as needed, transforms
normals, preserves UVs, embeds textures and honors material alpha modes.
Packed vertex color in older MOW files is decoded before reading UVs; the
Panzer I track layout also has an extra weight/index block. Treating these as
the newer layout produced NaN UVs/normals.

`js/vehicle_model.js` binds explicit `vehiclePart` tags. Wheels follow actual
displacement, reverse with the vehicle and stop when blocked. Tracked vehicles
also roll their road wheels while pivoting. Front steering uses the movement
controller's angle for trucks. Gun trails fold when undeployed/towed; the gun
recoils along its bore. These are runtime animations, not imported animation
clips. Track belt meshes do not yet have per-unit animated tread UVs.

Every new armed model has a socket on the visible barrel. Sockets stay in the
moving gun hierarchy, including both Panzer I MGs. Mortar sockets follow the
inclined tube. The ammunition round and loader use the same cycle duration;
travel cancels loading and raises/folds the mortar into its operators' grips.
Idle rounds stay finite even when time since the last shot is infinity.

The original geometry can be rebuilt with Blender:

```sh
blender --background --factory-startup --python scripts/build-mortars.py
blender --background --factory-startup --python scripts/build-polish-support.py
blender --background --factory-startup --python scripts/convert-mow-vehicles.py -- \
  --resources tmp/mow-as2-review/resources \
  --reader /path/to/pinned/blender_goh_gem_exporter/goh_core.py
```

Polish vehicle rivets, tread blocks and planks are batched by material within
each articulated parent: the four models use 19–32 material primitives rather
than hundreds of separate draw calls. No source archives or format-reader
package are added to the game.

German chassis collision envelopes now match the larger replacements. Unarmed
truck definitions retain zero range/damage/accuracy instead of inheriting rifle
defaults, and cannot aim or discharge. Supply trucks keep their ammunition cargo
and continue transferring it to infantry; the stock does not grant them a gun.

## References and provenance

MOW source files and SHA-256 hashes accompany each imported model in its
`.sources.json`. See [CREDITS](../CREDITS.md) and
[the extraction review](MOW_AS2_REVIEW.md) for ownership and exporter credits.
The original meshes are proportioned presentation assets; they are not technical
drawings or recovered MOW models. Reference material includes:

- [1938 armored-car manual, Central Military Library](https://zbrojownia.cbw.wp.mil.pl/Content/1384/SZ_20765_INW_6740.pdf): wz.34 layout, enclosed hull/turret and twin rear wheels.
- [Polish Army Museum's 37mm wz.36 collection](https://muzeumwp.pl/mwpedia/armaty-przeciwpancerne-kal-37-mm-wz-36-w-zbiorach-muzeum-wp-w-warszawie/): identification of the Polish AT weapon, distinct from the 40mm AA Bofors.
- [Museum of the Second World War: recovered wz.31 baseplate](https://www.muzeum1939.pl/aktualnosci/sensacyjne-odkrycie-archeologiczne-na-westerplatte-odnaleziono-element-polskiego-mozdzierza): Polish 81mm mortar/baseplate reference.
- [Period photograph of military Fiat 621 trucks](https://commons.wikimedia.org/wiki/File:POL_PL_fiat_621_military.jpg): cab, bonnet and cargo-body proportions; the photograph is not embedded in the game.

## Verification

- `node scripts/model-coverage-test.mjs`: all 63 core configurations, weapon
  sockets, all six mortar crews, synchronized loading actions, finite idle and
  travel bounds, carrying, abandon/reman visibility, rolling/reversing/blocked
  wheels, steering, trail folding and recoil recovery.
  It also verifies that all seven unarmed core trucks stay unarmed and all three
  supply trucks still resupply infantry.
- `node scripts/model-weapon-audit.mjs --assert --no-images`: 32 ground combat
  configurations, barrel bearings, turret traverse, recoil and matching
  projectile/flash origins.
- `node scripts/model-roster-gallery.mjs`: 40 isolated views of the 17 changed
  configurations, including ready/loading/carrying poses. Output is
  `tmp/model-gallery/index.html`.
- Infantry locomotion/visibility, transport clearance/smoothness, towing,
  supporting fire, field-gun crew and smoke regressions also pass. The core
  coverage check is included in CI.
  The clearance suite accepts `CLEARANCE_UNIT=german_fuel_truck` (or another
  core truck key) to exercise each model's own dimensions and steering scale.

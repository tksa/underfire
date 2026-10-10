# Men of War: Assault Squad 2 — local asset and logic review

Reviewed 2026-09-11 following the arrival of `setup.exe` and the `MD5/`
verification files in the user-provided `Downloads/MOW_AS2` folder.

## Extraction result

The missing decoder dependency is resolved. InnoExtract 1.9 recovered the
matching `unarc.dll`, `cls-lollypop2.dll`, decoder workers and configuration
from the installer without launching setup. All **11 source bins** match
`MD5/fitgirl-bins.md5`.

The complete **6,215,728,036-byte main payload** from `fg-01.bin` is extracted.
Its **40 files** match the final hashes in the installer's
`app/_Redist/fitgirl.md5`. All **12 PAK archives** also pass ZIP CRC checks.
They contain **143,890 entries / 133,264 files**. Counts include scenery,
variants, shaders and UI resources; these are not counts of playable units.

| Recovered content | Evidence |
| --- | --- |
| Gameplay definitions | `resource/gamelogic.pak`: 4,339 entries, including properties, weapon patterns, ammunition, state mappings and 647 shared human `.anm` files |
| Entity models | `resource/entity/{c1,c2,e1,e2}.pak`: meshes, skeleton/part trees, materials, collision volumes, textures and animations |
| Shared textures | `resource/texture.pak`: 7,226 entries, including the common textures referenced through `$/` paths |
| Interface, maps and documentation | Interface pack, four map packs, video pack, map editor and mission editor PDFs |

The other ten bins have been inventoried and checksum-validated but remain
compressed. They contain audio, music, executables and language content. The
main pack supplies the models and gameplay definitions needed for this review.

Working files are in the ignored `tmp/mow-as2-review/` directory:

- `payload/`: recovered PAKs and documents.
- `resources/`: unpacked game logic plus selected model folders and their
  shared texture dependencies.
- `checksums.txt`, `payload-hashes.json`, `payload-validation.log`: validation.
- `pak-summary.json`, `pak-inventory.json`: complete internal archive index.
- `model-previews/`: four GLBs, renders, conversion report and GLB/socket checks.
- `README.md`: extraction procedure and tool references.

## Model conversion findings

Converted the MG 34, MP 40, PaK 36 and Sd.Kfz. 222 for local inspection. The
GLBs embed their textures and retain named moving parts and attachment markers.
The PaK 36 and Sd.Kfz. 222 are now integrated, together with Panzer I B,
Panzer II F, an adapted Panzer IV G, and Opel cargo/fuel trucks. See
[core model coverage](MODEL_COVERAGE.md) for their source variants, runtime
articulation and the original models replacing the remaining core placeholders.

The conversion uses the
[Blender GOH GEM Exporter](https://github.com/f389722475/Blender-GOH-Gem-Exporter/tree/35d2f3e452ca07b48bd8aeb6b145e2e74b8f870d)
format reader with a local MOW compatibility adapter. The exact checked-out
revision is `35d2f3e452ca07b48bd8aeb6b145e2e74b8f870d`. The adapter:

1. Transposes legacy `Matrix34` basis rows for Blender's column-vector transforms.
2. Preserves the source root reflection instead of dropping it.
3. Reverses EPLY triangle winding while preserving vertex normals and UVs.
   Before correction, geometric normals opposed the supplied shading normals,
   producing nearly black surfaces.
4. Resolves `$/...` materials through `texture/common/`, including specular,
   normal, fuel-can and marking textures.
5. Converts infantry weapon rest axes separately from vehicle axes.
6. Adds a measured `weapon_muzzle` under the actual weapon mesh and records its
   local bore axis, keeping the original source markers separately.

| Preview | Triangles | Meshes | Source marker distance from measured barrel end |
| --- | ---: | ---: | ---: |
| MG 34 | 606 | 1 | 2.6 mm |
| MP 40 | 606 | 1 | 2.8 mm |
| PaK 36 | 1,488 | 8 | **351 mm** |
| Sd.Kfz. 222 | 13,646 | 25 | 2.5 mm |

Distances use the conversion's 20 source units per metre scale and the centroid
of the forward barrel-cap vertices. They are geometry checks, not historical
measurements. The PaK's `foresight1` is a poor direct flash origin: its lateral
alignment is close, but it lies well ahead of the barrel. The new measured
sockets are checked against the exported GLBs, within 1 mm of the barrel cap.
The annotated PaK render uses green for the measured muzzle and red for the
original marker.

## Runtime replacements

The default infantry is now `models/infantry/mow-{soldier,french,polish}.glb`,
selected by faction. Each skin supplies **50 named clips**: actual walk/run,
crawl, low running, standing/kneeling/prone aim and fire, reloads, three deaths,
artillery/MG crew actions, and unarmed idle/walk/run/kneel. The shared legacy
baked timeline and its synthetic leg gait no longer drive ordinary infantry.
Normal standing move orders use the run cycle at the infantry's actual ground
pace. Walk/run thresholds and stride playback respect the imported model scale,
with hysteresis to keep formation pace steady. Slow movement pairs the walking
legs with `walk_gun_up`, the authored waist-level carry; `walk_normal_gun_up`
was an aiming walk. Starting a move releases a recent aiming pose immediately,
and aim corrections cannot rotate the carried weapon back onto the sight line.
`scripts/infantry-locomotion-test.mjs` covers actual move orders and turns for nine
roles, carry height through both cycles, formation pace, blocked movement,
aim-to-move transitions, and crouch/prone orders.

The simulation now separates loaded magazines from total ammunition and shot
cycling. Reloads take simulation time, stop on movement/pinning/posture changes,
and never create ammunition. Grenades have a cancellable windup and a single
hand-height release; getting up holds the route until the body is ready to move.
Pistol aiming/reloading and one-handed travel use dedicated role clips. Medics
and mechanics use kneeling work actions; treatment/repair applies only after an
uninterrupted job beside a stationary patient or vehicle. These reuse authored
kneeling repair takes as general hand-work, not a bespoke patient interaction.

The direct GLB writer in `scripts/convert-mow-infantry.py` preserves named bones,
paired upper/lower animation phase, all section palettes, inverse binds and
embedded textures. Section palette entries are **1-based skeleton indices**,
with zero reserved for the rigid mesh frame. Missing tracks inherit an animation
rest pose rather than the mesh bind pose, avoiding a mirrored-thigh scale change
at crossfades. Inventory grips also require a roll correction after attachment.
Root travel in death takes is reduced to keep bodies close to their simulation
positions. `scripts/infantry-asset-test.mjs` checks every weighted vertex and
all 150 exported clips across the three skins, including reflection consistency.

Skinned bodies and their equipment bypass bind-pose frustum spheres. Whole-unit
fog, garrison, passenger and death visibility remain authoritative. The visibility
regression renders **the bodies alone**, excluding weapons/helmets/selection
markers that could mask a disappearing skin. Its 3,780 frames cover nine roles,
seven movement/stance states, turning and both camera edges. It also checks
visible bore alignment with the actual aiming direction; the reflected skeleton
requires the correction to be solved in its parent's matrix frame.

Equipment is selected by role: MG34, BAR-derived wz.28, MP40-derived MP38,
K98-family rifles, Luger, and original FM24, MAS36, MAS38, wz.35, Ruby and Vis geometry. Medics use
unarmed movement and idle clips. French/Polish helmets are original geometry.
The French body uses the British `eng_t1` mesh and the Polish body uses Soviet
`rus_t1`, with faction material treatments: these are **uniform approximations**,
not exact 1939/1940 uniforms. Specialist accessories and some precise national weapon variants remain absent.

All three HMG teams now load dedicated models with two animated crew members:

- German: recovered `mg34_stan` mount plus the separate MG34 weapon, exported by
  `scripts/convert-mow-mg.py`. The mount alone does not contain the gun.
- French: original Hotchkiss M1914 geometry with cooling fins, strip feed,
  spade grips and low tripod.
- Polish: original wz.30 presentation with water jacket, hose, ammunition belt
  and tripod. Both original models are built by `scripts/build-support-weapons.py`.

Six mortar configurations load four dedicated original GLBs with hollow tubes,
baseplates, integral mounts or bipods, sights, controls and ammunition chests.
All have two animated operators, synchronized visible loading rounds, and
folded carrying poses. Their muzzle anchors sit on the elevated tube ends.
The recovered `sgrw42` was identified from its source header as a 120mm model
and was not relabelled as one of these light/medium weapons.

Crews use authored push/kneel/loading actions. HMG loaders follow the magazine
reload timer rather than replaying a belt change after every bullet. MG hand placement is solved against
visible grips/feed parts. HMG effects retain small-arms flash sizes and do not
apply field-gun carriage recoil. The muzzle audit covers all three teams.

## Occasional supporting fire

`js/supporting_fire.js` implements the requested observation-based response.
A visible friendly muzzle bearing creates a short-lived cue; no enemy position
or hidden target is shared. Gunfire observation reaches up to 64 world units
(reduced by weather), using actual sight lines and smoke checks instead of the
shorter individual-unit identification range. Eligible stationary rifle/SMG/LMG infantry make
staggered probabilistic checks, with at most two responders per local eight-second
volley. A response is one or two rounds. Troops already facing gunfire from
friendlies ahead have a 55% response chance and an 8–18-second check delay; other
observed volleys retain the 30% chance and 14–34-second delay. Initial checks are
staggered by 1.5–5 seconds. Quiet sectors are rechecked after 1–2.5 seconds so
they can notice a new engagement promptly. These are gameplay tuning values.

Shots scatter broadly in bearing and travel 1.35–2.35 effective ranges (capped at
180 world units); walls, map edges and rising ground stop them. They consume real
ammunition and cooldown and may apply slight suppression near an impact, with
no direct-hit roll or fog reveal. Copycat rounds do not create more cues. Visible
in-range targets, hold-fire, movement, retreat, boarding and suppression take
priority. A matching manual facing order permits supporting fire without changing
the ordered bearing; an unrelated facing order prevents it. `scripts/supporting-fire-test.mjs` exercises these
constraints on a controlled range.

## Applicable gameplay logic

| Source inspected | Useful behavior | Under Fire implication |
| --- | --- | --- |
| `properties/human.ext` | Separate crawl, run and directional strafe settings; animation playback tied to displacement speed | Preserve animation travel distance and explicit movement direction when retargeting clips; avoid sliding a held pose along a path. |
| `properties/tank_unarmed.ext` | Separate linear/angular accuracy disturbance and recovery; acceleration, braking and forward/reverse gears | The original steadiness implementation already addresses part of this. Queued-route preservation and a braking/reverse/replan final approach now have transport regression coverage. |
| `properties/tank_crew.ext` | Distinct gunner, driver, loader and commander places, linked doors, visibility and boarding sequences | Imported seats must carry roles and entry/exit geometry; adding occupants as static meshes is insufficient. |
| `set/stuff/rifle/rifle.pattern` | Magazine capacity, shot recovery and magazine recharge are separate fields | Implemented separate magazine stock, simulation-owned reload actions and a common discharge transaction; timings remain gameplay profiles. |
| `entity/-vehicle/cannon/pak36/pak36.def` | Distinct push, aim, fire and loader animations, trail-close sequence and different move/attack obstacles | Keep crew tasks synchronized with gun movement and deployment; preserve the complete moving hierarchy. |
| `entity/inventory/-weapon/{mg34,mp40}/*.mdl` | Separate weapon meshes with grip, firing and ejection markers | A weapon-specific mesh and hand grip can replace the rifle silhouette shared by several infantry roles. |

The definitions reference GEM engine features; the packs do not provide source code for the
complete pathfinder or AI implementation. Their values also include game balance
tuning and should not automatically be treated as historical measurements.

## Provenance

The summary was written from the user-provided archives. Original source files
remain in the extracted packs and their hashes are recorded. For the sampled
assets, the MG 34 model header names exporter **Mauzer**, and the PaK 36 header
names **ubrashaev**; these are recorded header credits, not an assertion of sole
ownership. Game assets retain their original authorship and rights. The adjacent
user-provided licence note is preserved as supplied, without representing it as
an independently verified publisher licence.

The external format reader and source archives are development inputs and are
not bundled. The converted GLBs and original conversion scripts are included;
each converted asset has a source-path/SHA-256 manifest. See `CREDITS.md` for
exporter names, original geometry and the runtime attribution record.

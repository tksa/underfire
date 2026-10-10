# Gameplay and animation reference review

Reviewed 2026-09-11 against Under Fire `3c238a7` (v0.21.0).

This is a comparison of observable mechanics and architecture, followed by
original implementations for Under Fire. Neither GitHub reference's code or
assets are bundled. A subsequent user-authorized local MOW AS2 extraction and
asset integration is covered separately below and in `MOW_AS2_REVIEW.md`.

## Sources inspected

- **Spring: 1944**, revision
  [`36b570c251a924a372e8054e3ccf5d03b656a83e`](https://github.com/spring1944/spring1944/tree/36b570c251a924a372e8054e3ccf5d03b656a83e).
  Its [infantry controller](https://github.com/spring1944/spring1944/blob/36b570c251a924a372e8054e3ccf5d03b656a83e/scripts/Infantry.lua)
  distinguishes standing/prone, moving, aiming, pinned and building states, with
  weapon-specific permissions for moving fire. Its
  [vehicle controller](https://github.com/spring1944/spring1944/blob/36b570c251a924a372e8054e3ccf5d03b656a83e/scripts/Vehicle.lua)
  separates aiming, movement, deployment, recoil, wheels and tracks.
  [Craig's combat manager](https://github.com/spring1944/spring1944/blob/36b570c251a924a372e8054e3ccf5d03b656a83e/LuaRules/Gadgets/craig/combat.lua)
  and [waypoint manager](https://github.com/spring1944/spring1944/blob/36b570c251a924a372e8054e3ccf5d03b656a83e/LuaRules/Gadgets/craig/waypoints.lua)
  illustrate squad orders, logistics and traversable strategic waypoints.
  Low-level Spring engine navigation is a separate dependency; these files
  are not a standalone replacement for Under Fire's pathfinder.
- **eliw00d's Realism Mod for Men of War: Assault Squad 2**, revision
  [`37a65c68801c904bec540cf5c1991b3f05903582`](https://github.com/eliw00d/realism-mod/tree/37a65c68801c904bec540cf5c1991b3f05903582).
  [tank_unarmed.ext](https://github.com/eliw00d/realism-mod/blob/37a65c68801c904bec540cf5c1991b3f05903582/resource/properties/tank_unarmed.ext)
  defines accuracy effects from linear/angular motion and separate disturbance
  and recovery times.
  [tank_crew.ext](https://github.com/eliw00d/realism-mod/blob/37a65c68801c904bec540cf5c1991b3f05903582/resource/properties/tank_crew.ext)
  defines crew roles, seats, doors and boarding animation links.
  [gun.pattern](https://github.com/eliw00d/realism-mod/blob/37a65c68801c904bec540cf5c1991b3f05903582/resource/set/stuff/gun/gun.pattern)
  distinguishes gun handling and ammunition presentation. This repository
  contains mod definitions referencing Men of War engine systems; it does not
  provide the game's complete AI, animation system, or pathfinding source.

## Implemented in this change

| Gap observed in Under Fire | Result | Main files |
| --- | --- | --- |
| Infantry and deployed guns rotate toward an enemy, but their firing condition did not require alignment. | A weapon needs a continuous sight picture before firing. Changing target, losing sight or relocating resets the aim. Suppression lengthens the settle time. | `js/fire_control.js`, `js/unit_modules.js` |
| A moving rifleman could shoot behind his back while the movement code correctly kept him facing his route. | Relocation remains authoritative. Rifles and crew-served weapons wait for a halt; SMGs may fire within a forward cone at a controlled walking pace. Mounted cavalry retains its directional firing support. | `js/fire_control.js` |
| Accuracy recovered immediately when a moving/turning vehicle stopped. | Motion disturbs weapon steadiness quickly; accuracy recovers gradually after a halt. Values are original gameplay tuning, not imported historical stats. | `js/fire_control.js`, `js/combat.js` |
| A target selection played a repeating firing take even with no ammunition. | Stable aiming poses are separate from actual discharge. A successful shot drives a brief recoil and weapon-handling motion. Empty weapons use idle poses. | `js/soldier_model.js`, `js/renderer.js` |
| Crawling used a frozen prone pose sliding across terrain. Crouched movement used standing locomotion and standing leg rest angles. | The replacement MOW rig supplies actual crawl/low-run animation, with cadence driven by displacement. The legacy synthetic gait is disabled. | `js/soldier_model.js`, `js/renderer.js` |
| PaK 36 and Bofors 37 lacked loaded models and the shared animated crew path. | PaK 36 now uses the recovered textured MOW carriage; Bofors 37 uses dedicated original GLB geometry. Both have rolling wheels, folding trails, recoil and two skinned crew figures. Crews hide when towed or abandoned. | `js/vehicle_model.js`, `js/fieldgun_model.js`, `docs/MODEL_COVERAGE.md` |
| German medic/mechanic figures missed the shared skinned support-personnel path. | The shared rig fallback applies to support personnel across teams. | `js/units.js` |
| Infantry routes retained grid stair-steps; segment shortcuts checked centre tiles rather than body clearance. | Bounded route smoothing checks body clearance, preserves explicit waypoint markers and avoids shortcuts that substantially increase terrain travel cost. Reachable clicks retain their precise endpoint. | `js/pathfinding.js` |
| A forced target could disappear behind an obstruction while `_inFiringPos` stayed latched indefinitely. | A short LOS grace period holds the firing position; persistent obstruction releases it for pursuit. Active pursuit routes are retained until the target meaningfully moves or the route ends. Failed plans back off. | `js/unit_modules.js` |
| AI firing-position selection could choose an occupied/overlapping pose; a failed selection fell back to charging the enemy's centre. | Candidate poses check full hull/vehicle clearance. Failed selection retains the existing route and retries at a bounded cadence. | `js/ai.js` |
| Gun effects used fixed offsets, world bounding-box corners or a constant height. | Geometry/bone muzzle anchors follow the visible barrel, turret and recoil. Direct fire and attack-ground use the same world origin and height for projectiles/effects. Twin 7TP turrets alternate their origins. | `js/weapon_mounts.js`, `js/combat.js`, `js/main.js`, `js/renderer.js` |
| The S35 turret cut left part of the barrel attached to the hull. Separate guns could recoil along an incorrect native asset axis. | The complete S35 barrel follows its turret; separate-gun recoil uses the bore direction transformed into its parent's coordinates. | `js/units.js`, `js/weapon_mounts.js` |
| Infantry's rifle pose and cavalry's directional takes left the visible weapon off the aiming direction. A halted firing horse used a gallop take. | Aim corrections retain the hand/weapon relationship. Mounted aiming clips combine rider action with the horse's idle tracks. Empty/held mounted weapons leave firing poses, and the sabre hides during rifle aiming. | `js/weapon_mounts.js`, `js/cavalry_model.js`, `js/renderer.js` |
| Strafing rounds originated at a fixed nose offset; the railway gun fired from inside its barrel without traversing. | Visible fighter wing barrels have measured leading-edge mounts. Aircraft origins follow bank/pitch; train turrets traverse before firing and emit from their barrel tips. | `js/aircraft.js`, `js/scenarios/mokra.js` |
| Short gaps in protective posture requests could repeatedly lift a prone soldier. | Automatic low postures persist through a one-second gap; routing and imminent vehicle evasion remain immediate. | `js/unit_modules.js` |

### Core gameplay follow-up

| Gap | Current behavior |
| --- | --- |
| No real magazine/reload distinction | Loaded rounds and total stock are separate; all infantry firing paths share one discharge transaction. Reload progress belongs to simulation time and cancels on movement, pinning, transport or posture changes. Supply transfers no more than the recipient can hold. |
| Instant grenade spawning and sliding get-up | Standing, crouched and prone throws have a cancellable windup, one release from the throwing hand, and real pocket consumption. The other hand retains the firearm. Get-up plays before the queued route resumes. |
| Officers carried rifles | All three officer presentations use pistols with pistol aiming/reload clips and one-handed movement. German officer now has a built-in and CSV roster definition. |
| Instant medical/repair effects | A nearby stationary patient/vehicle requires an uninterrupted kneeling work action. Movement or losing the recipient cancels it. Repair prioritizes disabled tracks, engine and turret before hull HP. |
| Mortar placeholders without operators | Six configurations load four dedicated original mortar GLBs, with distinct light/medium mounts, open bores, sights, synchronized loading rounds, two animated operators and folded carrying poses. HMG loaders follow actual magazine changes. |
| No shared plan for alternating movement | Attacking AI squads plan short alternating bounds, retain stationary armed support, reserve separated destination slots and hand off after arrival or timeout. Explicit orders and defensive reactions take precedence. Direct firing paths wait if a friendly body blocks the lane. |
| Hidden targets could supply live positions | Per-unit contact snapshots expire over 12 seconds; squad plans require current sightings. Existing last-threat behavior remains alongside this bounded memory. |
| Queued transport routes lost early destinations | Shift-click resolves that unit's pending initial route before appending. Recovery preserves all accepted stops. A missed tight final approach brakes, backs out through a clear segment and replans. |
| Mokra transports left passengers unextracted | Extraction includes passengers/towed guns, is idempotent, and reports extracted units separately from living units left behind. Contract tests now cover hold, train, counterattack, withdrawal and final outcome. The existing expanded armoured reserve is retained as gameplay reinforcement. |

## Model coverage

The original **35 GLB containers** (including nested railway/divider assets) were checked
for valid headers and buffer bounds. The visual/weapon audit now instantiates **32
ground combat configurations**, covering the active French, German and Polish
tank/armored-car models, all current gun models,
HMG/mortars, the shared infantry rig and mounted cavalry. It renders zero and
quarter-turn turret views, with red markers at the actual weapon anchors.

The D.520 and MB.152 have a separate banking/diving firing test and render.
The Bf 110 was a visual flyover, its firing behavior is not currently connected
to the aircraft mesh; bombing effects remain scripted. Trucks, scenery,
railway pieces and dormant `tiger-E`/`low_poly_soldier_base` assets do no runtime
weapon firing and are not counted as working combat model configurations.

The audit checks socket presence, spatial bounds, same-frame heading changes,
tracer/flash origins, recoil direction, and twin-turret alternation. Cavalry
also has forward/left/rightward/backward aiming checks. This does not certify
all 638 reference roster entries as complete units or solve every art issue.

## Local MOW_AS2 archives

All 11 local `.bin` archives were identified and their FreeArc header,
directory and footer metadata decompressed (the signature is `ArC\x01`). The
inventory has 795 entries including directories. `fg-01.bin` contains the
useful `gamelogic.pak`, entity packs, textures, maps and editor documentation.
Its 6.22 GB solid payload uses **`srep:m3zf+lollypop2`**. A subsequent folder
check found the matching `setup.exe` and checksum files. All 11 bins passed
their supplied MD5 checks. The installer tools were unpacked with InnoExtract;
calling the matching lollypop2 CLS decoder directly under Wine, followed by
a native SREP decoder, recovered the complete main payload. **All 40 files
match their supplied final MD5 hashes, and all 12 recovered PAKs pass ZIP CRC
validation.** Other bins use MSC, BCM, MPZ and related external codec chains
and remain compressed.

Local diagnostics and decoded metadata are preserved in the ignored
`tmp/mow-as2-review/` directory. It includes the file/block inventory, diagnostic
reader and an extraction-status README. The recovered packs contain 133,264
files (143,890 entries including directories), including 647 shared human
animation files. Three infantry skins and a complete MG34 mount now use
converted MOW assets, alongside original role weapons and French/Polish HMGs.
Seven additional MOW vehicle/gun models and eight original mortar/Polish support
models bring the current tree to 56 GLBs; source manifests accompany the converted
files. See [the MOW asset and logic review](MOW_AS2_REVIEW.md)
for source paths, conversion fixes, a displaced source muzzle marker, and
integration requirements.

## Existing systems retained

Under Fire already has suppression, armor penetration, target hysteresis,
individual cover search, squad roles, gun deployment, gun abandonment/remanning,
transport boarding, cavalry mounting, vehicle steering/recovery, fog of war,
and ammunition/supply logic. Replacing them wholesale would discard working
behavior. This pass addresses specific missing conditions and presentation
gaps within those systems.

## Remaining scope and art limits

The latest model pass replaces 17 core configurations with 15 GLBs. All 63 core
configurations now load a model, including 14 crewed weapons. Exact source
variants, original-art approximations and validation are recorded in
[MODEL_COVERAGE.md](MODEL_COVERAGE.md); this does not cover the entire imported
CSV catalogue. In particular, the Panzer II F and adapted Panzer IV G bodies
remain approximations for the early-war roster.

The active gameplay gaps above now have implementations and focused checks.
This is not a claim that every extended roster entry has finished art or that
the references' complete engines have been recreated:

- French/Polish uniforms, MP38 and wz.28 still use documented approximations.
  Specialist bags/tools/scopes, several national weapon variants and hundreds
  of extended-roster vehicle variants still need dedicated art.
- Vehicle crew casualties are not assigned to individual internal stations;
  separate AP/HE inventories and richer logistics/scoring need further design.
  Existing supply-truck regeneration and fuel support remain game abstractions.
- Friendly firing-lane checks prevent shots through current allied positions;
  they do not provide continuous projectile collision with a friendly who
  enters the path after discharge. Contact memory is bounded and per-unit,
  without a full probabilistic communication system.
- Mokra's railway actor is scripted rather than a targetable train, its bombing
  flyover still uses a Bf 110 stand-in, horse artillery limbers and campaign
  persistence remain absent. The mission documentation now describes the
  existing train/counterattack/withdrawal phases accurately.

## Verification

`scripts/tactical-behavior-test.mjs` exercises actual browser game code: facing
and settle delays, moving orders, empty/held weapons, accuracy recovery, safe
routes and arrival, lost-LOS pursuit, protective posture persistence, low-pose
bone motion, both gun crews, articulated trail folding, recoil recovery and
tactical-pause persistence. All 41 checks pass.
`scripts/tactical-visual-check.mjs [output-directory]` produces repeatable close
views of aiming, crouch walking, crawling and the three gun models; it can run
against a baseline server using `SMOKE_URL`.

`scripts/model-weapon-audit.mjs --assert` passes 360 weapon checks across the 32
configurations; its PNGs and JSON provide an inspectable model review.
`scripts/weapon-actors-test.mjs` passes 32 aircraft, mounted aiming and railway
weapon checks. Both are included in CI alongside the tactical checks.

The existing smoke, five tank-approach drills, transport movement, gun towing,
cavalry movement/mounting, battle-selector and directional-facing checks passed. The Armata model/crew
test now addresses its named body mesh and supplies its faction to the fixture;
its previous assumptions failed against the unchanged baseline.

A 120-second battle animation audit initially exposed 33 rapid pose reversals.
After adding protective-posture persistence, it passed with 18 reversals across
62 tracked soldiers, 0.105 mean clip changes/second, and zero standing corpses.
Two full 120-second battle observations completed; residual target-turning and
the broader gameplay gaps above remain review items, not a claim that the AI is
finished. The follow-up corrected stale transport harnesses that omitted the route queue,
then verified the real queued-route and final-approach fixes. Clearance passes
11 cases, smoothness passes 33 runs, and all four waypoint scenarios pass.
Mokra now passes its updated full-phase and passenger-extraction contract.

## Infantry replacement and observed-fire follow-up

`js/mow_soldier_model.js` replaces the shared legacy runtime rig with three
faction presentations, named motion clips and role equipment. All three HMGs
now have dedicated models and animated crews. `scripts/infantry-asset-test.mjs`
checks skin weights, joints, complete clips and stable reflection signs.
`scripts/infantry-visibility-test.mjs` renders 3,780 body-only frames during
movement/turns at camera edges, plus actual rifle/MG bore alignment checks.

Occasional supporting fire is based on observed friendly firing bearings:
randomly staggered one/two-round responses, broad scatter beyond effective range,
real ammunition use, obstruction handling and no shared hidden target. Direct
engagement and explicit orders retain priority; supporting shots cannot trigger
more supporting shots. See `scripts/supporting-fire-test.mjs` and the MOW review.

The final 120-second battle audit tracked 62 soldiers, with 0.098 mean clip
changes per second, 20 short pose reversals and no standing corpses. The three
finished death takes placed the torso at 20–25% of standing height. These are
observed regression results, not a guarantee that all AI/art gaps are finished.

### Follow-up regression coverage

- `infantry-actions-test`: 57 checks covering magazine stock/reload interruption,
  rendering without simulation, throw cancellation/single release, get-up,
  treatment/repair, pistol bore alignment and three mortar crew presentations.
- `squad-coordination-test`: 16 checks for alternate bounds, slot separation,
  handoff, explicit orders, fallback, friendly lanes and expiring snapshots.
- `infantry-asset-test`: 150 clips and 26,119 weighted vertices across three skins.
- `infantry-locomotion-test`: 113 checks, including running during ordinary move
  orders, turn/formation pace, lowered carry, rapid aim release and low gaits.
- `infantry-visibility-test`: 43 checks and 3,780 body-only frames, minimum
  281 visible body pixels, no disappearance.

These browser diagnostics exercise the shipped runtime and produce local review
images. Ammunition capacities and action durations are gameplay tuning, not a
claim of exact historical firing rates or medical procedures.

The completed 120-second follow-up battle audit tracked 64 soldiers, measured
0.119 clip changes per soldier-second and 24 short reversals, and found no
upright resting corpses. Slowdown hysteresis preserves the running pose through
brief turn/braking pulses. Get-up actions suppress ordinary AI reconsideration
until completion, while renewed protective posture and imminent vehicle evasion
can interrupt them. The audit now lets the final frame's newly started death
animations finish through the production renderer before checking resting poses.
A 90-second rendered Dyle observation produced six battle screenshots.

The forward-support follow-up separates observing a visible friendly volley from
identifying a distant unit. Aligned rear infantry can notice gunfire up to 64
world units ahead (weather/smoke/LOS still apply), with staggered, more responsive
checks and the same two-responder / one-or-two-round limit. Matching manual
facing permits fire along that order. The supporting-fire regression now includes
an actual closer-friendly engagement with the enemy outside the rear shooter's
weapon range, obstruction/smoke checks and an equal-roll probability comparison.

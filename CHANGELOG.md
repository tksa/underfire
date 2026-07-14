# Changelog

All notable changes to Under Fire. Newest first. Versioning is SemVer-ish while pre-1.0 (see `docs/DEPLOYMENT.md`).

The start-mission screen's "Latest Updates" panel is generated from the git commit
log (`scripts/gen-changelog.mjs` → `data/changelog.json`), so it stays current
without hand-editing.

## v0.17.0 — The 7TP Platoon and the Luftwaffe

- **Polish armor arrives in force:** the Mokra reserve now fields the 7TP in all three variants — the single-turret jw with the 37mm Bofors, the twin-machine-gun dw (both turrets traverse independently about their own rings), and the dw refit carrying a gun turret beside an MG turret — plus the 20mm TKS rearmament, the only tankette that can hurt German armor. The MG tankette shares the same new model. All are sized against their real dimensions (a 7TP matches a Panzer II; a TKS is car-sized) and park in the fields facing the German approach.
- **Luftwaffe over Mokra:** the second and final German echelons arrive under air raids — the air-raid siren wails, a Bf-110 flies its attack run across the battlefield, and a stick of bombs walks across positions near the Polish line. Every air strike now shows the bomber itself.
- **Selection always releases:** a Shift keyup lost to a focus change could leave the selection permanently stuck; left-click on empty ground now always deselects, and double-click mass-select requires two clicks on the same soldier.
- **Cleaner Mokra fields:** rock and twig scatter on the cultivated plots is reduced to a quarter of its old density; grass and wheat are untouched.

## v0.16.1 — The Freeze Fix

- **Mass orders no longer freeze the game.** Ordering a large force with vehicles across the map used to hang the whole game for many seconds (profiled at 58 seconds for a 104-unit attack-move) while every vehicle's full-hull route computed synchronously. Vehicle routes now compute on a per-frame budget through a route queue: the click responds instantly and hulls start rolling as their routes land. Pathfinding itself is far cheaper (open-field checks skip the hull sweep entirely) and bounded (an unreachable destination costs bounded work instead of a full-map search). Stall recoveries, truck route rebuilds, and attack-move resumes go through the same queue with backoff, ending the re-plan churn that dragged the town-fight framerate down.
- **Selection ring reads correctly everywhere:** it now drapes over the terrain surface (no more sinking into slopes) and is properly hidden behind vehicles and buildings instead of drawing on top of them.
- **Reference dataset learns railways:** capture batches scatter track runs in every orientation (always including a full east-west line) and the generation prompt renders them as realistic rural single-track railways. Capture-only; gameplay maps are untouched.
- **Menu wordmark** reads as one "UnderFire" mark.

## v0.16.0 — Anti-Tank Doctrine, Rolling Wheels, Push Crews

- **Infantry anti-tank doctrine:** rifles and machine guns never fire on armor they cannot penetrate, whether auto-acquired or ordered (soft-skinned trucks, transports, and towed guns stay valid targets). A plain attack order on armor is refused with a hint; infantry near a tank they cannot hurt automatically dash to cover and kneel, or give ground when caught in the open.
- **Grenade close assault:** double right-clicking an armored vehicle sends selected foot infantry charging it to throw their two anti-tank grenade bundles from short range, then break off when the pockets are empty. Double right-click on ground remains the retreat order.
- **Transports risk their passengers:** every landed hit on a loaded transport has a chance to wound or kill a soldier aboard (higher for high-explosive hits).
- **Rolling field-gun wheels:** the 75 mm Armata's wheels are now separate hub-pivoted nodes (split in Blender) and roll to match the carriage's real ground speed and direction.
- **Field-gun crew push:** while the gun moves the two crewmen step in close, lean over the trails, and drive it with hands on the carriage; at rest they kneel exactly as at spawn, with a smooth transition on stopping.
- **Selection readability:** the green selection ring now shows through raised terrain, while remaining under the fog of war.
- **Mokra railway:** track modules render a further 20% smaller to fit the compressed map.

## v0.15.1 — First-Load Feedback and Mokra Deployment Polish

- **Visible first-load progress:** the black boot cover now identifies itself as battlefield preparation, continuously confirms that loading is active, and cycles through twelve Second World War preparation messages. A longer-load notice appears after nine seconds, with reduced-motion and screen-reader handling included.
- **Silent Mokra preparation:** the persistent white, top-centre three-minute deployment countdown remains active, but the testing siren no longer plays. The audio helper and asset remain available for a later sound pass.
- **Tracked opening formation:** the 25 interleaved line infantry and eight-man reserve retain their standing west-facing posture and subtle deterministic scatter, with explicit deployment IDs for regression coverage.

## v0.15.0 — Railway, Field-Gun Crews, Directional Orders, Bunny CDN

- **Bunny CDN asset delivery:** production loads models, textures, sounds, icons, baked map imagery, and the menu media from `underfire.b-cdn.net`, cache-keyed by a stable release version. A boot-time CORS probe falls back to the origin automatically; localhost and CI keep serving every file locally from the repo.
- **Textured railway line:** the Mokra railway is rendered with Digital Goblin's CC BY 4.0 "Train Track - Modular Pack" (see `CREDITS.md`), instanced along a flattened, grade-limited rail bed. Tile data remains the sole collision and pathfinding authority.
- **Mokra opening deployment:** the persistent white, top-centre three-minute warning gives Poland time to prepare. Opening Polish infantry stand at attention in a subtly, deterministically scattered formation instead of appearing on a rigid grid.
- **Polish 75 mm Armata and crew:** the imported gun now travels muzzle-first instead of trail-first. Its two visible operators use rifle-free clones of the proper Polish-skinned infantry rig, walk through the shared speed-synchronised gait rather than sliding, remain behind the carriage, and recoil in the correct direction. Lightweight figures are retained only as an asset-load fallback.
- **Directional movement orders:** right-dragging open terrain draws a ground arrow from the destination toward the requested heading. Units move into a formation aligned to that heading and rotate only after reaching their assigned slots; a nearby drag rotates the formation in place. Context actions, double-right retreat, Shift waypoints, Ctrl/Cmd gather, attack-move, path replans, and movement recording retain the final-facing intent.
- **Persistent cavalry horses:** dismounting a mounted Polish reserve leaves a riderless horse at the exact stopped pose, preserving position, heading, scale, and ground contact. The authored dismount plays at 1.7× speed and places the foot Ułan 0.82 world units from the horse's flank. The horse cannot be selected or controlled; its linked foot Ułan receives the standard enter cursor and must return to a clear mounting side before remounting. The mounted asset is 15% smaller than its earlier tuning, while the dismounted rider uses normal infantry scale. Walk/run playback now follows the progressive braking speed through the final stride instead of snapping from a fixed minimum gait to idle.

## v0.13.1 — Mokra Performance and Freeze Fixes

- **Wave stalls removed:** German reinforcement commits now use validated authored corridors and staggered infantry routing instead of synchronous vehicle path searches.
- **Stable armour recovery:** Mokra AI vehicles reuse directional scenario corridors for blockages, combat positioning, and retreats rather than triggering late full-map A* freezes.
- **Bounded battlefield rendering:** grass, tracks, crater deformation, foliage knockdown, fog, HUD, minimap, and animation updates now have explicit budgets or throttles.
- **Cheaper combat simulation:** target acquisition and line-of-sight work is range-rejected, cached, and staggered across units.
- **Lower startup pressure:** Polish command voices load on demand, while movement recording uses a fixed sampled circular buffer.
- **Diagnostics:** `scripts/mokra-performance-profile.mjs` and `docs/PERFORMANCE.md` document budgets, measurements, and regression thresholds.

## v0.13.0 — Polish Voices and Mokra Gun Line

- **Polish voices:** 77 supplied recordings now ship as compressed runtime assets, with 75 active across infantry and vehicle command pools.
- **Command feedback:** drag-box selection emits one group acknowledgement; attack-move and attack-ground use attack semantics; Polish attack orders periodically draw from patriotic/morale takes.
- **Mokra event audio:** the final German armoured echelon triggers a dedicated `nie-zlamia-nas` cue that is not lost to normal command throttling.
- **Defensive deployment:** Mokra opens with an alternating line of three Bofors and three 75 mm guns, five interleaved infantry sections, an eight-man reserve, and expanded HMG support.
- **Spawn clearance:** the Polish TKS, wz. 34, medic, guns, and supporting units begin clear of solid terrain and overlapping formations.
- **Audio workflow:** source WAVs remain external and editable; `scripts/process-polish-voices.sh` reproducibly creates the optimised Ogg runtime copies.

## v0.12.0 — Battle of Mokra Preview

- **Battle selector:** Advance to the Dyle remains first and selected by default; Battle of Mokra is available second with a clear Preview label.
- **Poland, 1939:** playable Polish forces with a dedicated early-war roster, weapons, descriptions, presentation colours, and intentionally silent voice slots pending Polish recordings.
- **Mokra battlefield:** a separate railway map covering Mokra I–III, constrained crossings, defensive deployment, and three phased German armoured attacks.
- **Historical guardrails:** the scenario omits anachronistic routine Panzer III/7TP variants and player air support while later train, cavalry, air-attack, and withdrawal phases remain documented future work.
- **Scenario infrastructure:** scenario-aware map/force/mission dispatch, side selection, HUD text, localisation, documentation, and deterministic Dyle/Mokra regression coverage.
- **Transport movement:** restored full-width vehicle pathfinding, oriented hull and trailer collision, swept turns, short reverse corrections, smooth stopping, Shift-waypoint recovery, movement-recorder order coordinates, and automated clearance/smoothness/boarding regressions.

## v0.6.0-dev

- **Data-driven roster:** `data/units.csv` (614 units, incl. the full public-domain RWM/Sudden Strike library) merged over the built-in table at boot. Each unit has an introduction `year`; `Game.unitsForYear` gates per-map availability (a 1940 map won't field the StG-44, Tiger, Panther…).
- **Orders:** Move / Attack-Move stance switch, Attack-Ground, and a double-right-click **Retreat** (break off; infantry sprint, tanks reverse).
- **New systems:** towed-gun deploy/limber (siege), officer morale aura + chain-of-command succession, mine warfare (lay/clear/splash), sapper sandbag emplacements, troop transport and gun towing.
- **Smarter enemy AI:** infantry under fire break for cover, a tree line, or the lee of a friendly tank instead of standing in the open; engagement no longer jitters at the edge of sight (sticky targeting).
- **Refactor:** the monolithic `updateUnit` is split into per-unit modules (`js/unit_modules.js`).
- Always-fresh deploys via a per-load cache-buster on the script loader.

## Unreleased — feature/neural-renderer

- Neural Renderer pipeline (turn the low-poly render into a realistic WW2 frame via conditional image-to-image).
- In-game multi-channel exporter `Game.NeuralExport` (`js/neural_export.js`): aligned rgb / depth / unit-type / team / instance-id / terrain-class buffers, UI hidden. Debug-panel "Export Frame" button.
- Offline toolchain in `neural/` (headless dataset capture, Pix2PixHD packing/training wrappers, ONNX/TensorRT export, inference) and full design docs in `docs/neural-renderer/`.

## v0.5.0-dev — Initial public build

- First public, community-buildable release of Under Fire.
- 3D procedural battlefield: a French village of patchwork hedgerow fields, church, windmill, river and stone bridge.
- Individual-unit tactics: cover, concealment, line-of-sight, suppression, stance (stand/crouch/prone/crawl), armour penetration with facing and obliquity.
- Squad AI: cover-seeking, fire-and-maneuver, and squad-wide threat alerts when a unit is hit.
- Tactical pause, fog of war, procedural effects and audio (CC0 / public-domain).
- New welcome gate, start-mission menu, contributor docs, license, and Claude skills.

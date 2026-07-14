---
title: "Mokra: Hold the Railway — implementation record"
scenario_id: "mokra"
date: "1939-09-01"
status: "Preview"
menu_position: 2
player_side: "Poland"
opponent: "Germany"
---

# Mokra: Hold the Railway

Mokra is the second battle in the scenario selector and is currently presented as a **Preview**. **Advance to the Dyle Line** remains the first/default battle. Selecting the Mokra preview places the player in command of Polish forces from the reinforced Wołyńska Cavalry Brigade against the German 4th Panzer Division.

The complete historical and campaign design source is [Poland 1939 RTS Battle Design Dossier](../POLAND_1939_CAMPAIGN.md). This record distinguishes the current implementation from that larger target.

## Player briefing

Dawn has brought war to the Mokra line. The German armoured division is approaching from Wilkowiecko and the western roads. Our brigade cannot stop the entire invasion, but it can ruin the enemy timetable. Hold the fields and woods before the railway, conceal the Bofors guns, and strike the leading tanks at close range.

## Current mission contract

- Date and place: Mokra near Kłobuck, 1 September 1939.
- Player: Poland; the German side is the AI opponent in this preview mission flow.
- Primary objective: after deployment, hold the central railway crossing for five combat minutes.
- Secondary objective: preserve the command team and at least one 37 mm Bofors gun.
- Defeat: lose the whole Polish force, or leave the central crossing under uncontested German control for 25 seconds.
- Deployment: a persistent white, top-centre three-minute countdown opens the scenario. No Germans spawn or receive attack routes during this period, leaving time to move infantry into the woods and conceal guns. Siren playback is temporarily disabled during testing; its asset is retained for a later audio pass.
- Attack structure: at 3:00 total elapsed time the German vanguard enters inside the westernmost five-tile strip, facing east. Later echelons enter from the same map edge at 3:55, 5:05, and 6:25; the unchanged combat-relative cadence is 0, 55, 125, and 205 seconds.
- Mission length: the railway must be held for 300 combat seconds after the vanguard appears, so victory resolves at 8:00 total elapsed time.
- Air support: none is player-callable. French fighters and generic bomber support are disabled for Mokra.
- Voice behavior: Polish infantry use dedicated Polish command pools, while tank pools reuse vehicle-neutral takes from the same supplied recordings. Attack commands periodically draw from a shared vehicle-safe morale pool, and the final German echelon forces one Polish `nie-zlamia-nas` cue. Dedicated vehicle-crew recordings remain desirable, but tanks are not silent and never fall through to French or German speech. Combat effects, engines, ambience, and UI sounds remain enabled.

## Authored map

The 100 × 100 tile battlefield is deliberately compressed for the current engine. It contains:

- a north–south railway embankment with three vehicle crossings;
- separate Mokra I, Mokra II, and Mokra III settlement/orchard strips;
- broad cultivated western approaches for the German attack;
- irregular woods for Polish concealment and anti-tank ambushes;
- an eastern Polish reserve area;
- no broad river or lake.

Railway tiles slow infantry and block vehicles, forcing vehicles to use the road crossings. The rendered line uses the textured straight module from Digital Goblin's CC BY 4.0 "Train Track - Modular Pack", uniformly reduced by 20%, repeated as one instanced mesh, and pitched section-by-section over the terrain. The four curved pieces are also split into reusable assets for later map work. A Mokra-only terrain pass flattens the rail bed laterally, smooths and grade-limits it along the line, blends its shoulders into the fields, and suppresses micro-relief beneath the modules and crossings. Rendering does not add collision, so the existing tile data remains the sole authority for crossings and pathfinding. Full attribution and modification details are in [`CREDITS.md`](../../CREDITS.md) and the [asset attribution notice](../../models/railway/ATTRIBUTION.md).

Runtime source: [`js/scenarios/mokra.js`](../../js/scenarios/mokra.js). Map metadata: [`maps/mokra/map.json`](../../maps/mokra/map.json).

## Opening defensive deployment

The three-minute deployment phase and subsequent five-combat-minute defence start with a deliberately compressed formation immediately west of the railway:

- six north–south gun positions alternating three 37 mm Bofors anti-tank guns and three 75 mm field guns;
- 25 dismounted infantry standing at attention in five five-man sections, one in each interval between adjacent gun positions; small deterministic offsets scatter them slightly without changing the line or blocking the guns;
- one full eight-man dismounted reserve squad standing at attention behind the line, using the same subtle deterministic spacing;
- four player-controlled `mounted_ulan` reserves east of the railway;
- two Ckm wz. 30 HMGs, plus one 46 mm grenade launcher and one 81 mm mortar.

This allocation makes the line readable and playable at the current map and mission scale. It is not a claim that the opening force represents the Wołyńska Cavalry Brigade's full historical establishment; the larger brigade-scale target remains documented in the campaign dossier.

## Playable Polish roster

| Unit | Battlefield role |
|---|---|
| Ułan (spieszony) | Dismounted cavalry rifleman; use cover and fire-and-manoeuvre, never cavalry charges against tanks. |
| Mounted Ułan, 12th Regiment (`mounted_ulan`) | Four east-of-railway mobile reserves. Reposition on horseback, then dismount for sustained combat; this is distinct from the opening-line dismounted `ulan`. |
| Strzelec piechoty | Attached infantry rifleman providing dependable long-range small-arms fire. |
| Rkm wz. 28 | Mobile two-man Browning light-machine-gun team. |
| Karabin ppanc. wz. 35 “Ur” | Concealed close-range anti-tank rifle team for early tank flanks and running gear. |
| Ckm wz. 30 | Sustained tripod heavy-machine-gun fire; powerful but slow to relocate. |
| Granatnik wz. 36 (46 mm) | Short-range company explosive support. |
| Moździerz wz. 31 (81 mm) | Battalion high-explosive support against infantry, woods, and exposed crews. |
| Armata ppanc. wz. 36 (37 mm Bofors) | The principal Polish tank killer at Mokra; best concealed and firing into flanks. |
| Armata wz. 1902/26 (75 mm) | Dedicated horse-artillery field-gun model with a maximum of two visible Polish-skinned operators; both walk with the carriage and crouch at the trails when deployed. |
| TKS (7.92 mm) | MG-only reconnaissance tankette, explicitly not the rare 20 mm tank-hunter conversion. |
| Samochód pancerny wz. 34 | Fast but thin-skinned wheeled reconnaissance car. |
| Oficer, Saper, Sanitariusz, Mechanik | Command, engineering, medical, and repair support. |
| Polski Fiat 621L supply/transport trucks | Ammunition support plus two ten-seat reserve/evacuation carriers; soft-skinned and unsuitable for the firing line. |

The editable definitions and descriptions are in [`data/units.csv`](../../data/units.csv), with built-in fallbacks in [`js/units.js`](../../js/units.js). Polish weapons have hand-authored behavior in [`js/weapons.js`](../../js/weapons.js).

## Mounted reserve controls and movement

The four eastern reserve units are directly player-controlled. Selecting a mounted reserve exposes the dismount action. The mounted asset is 15% smaller than its earlier tuning. The authored dismount plays at 1.7× speed; once it finishes, the same unit becomes the established foot-cavalry role at normal infantry scale and stands 0.82 world units from a persistent riderless horse that preserves its mounted position, heading, and size. The horse is not a combat unit: it cannot be selected, commanded, garrisoned, or loaded into a transport. Selecting the linked dismounted Ułan and hovering or clicking that horse shows the same green enter affordance used for buildings; the rider walks to the nearest clear, reachable mounting side and mounts only on arrival. The `ulan` soldiers that begin the scenario dismounted remain ordinary infantry and cannot claim reserve horses.

Mounted movement is deliberately weightier than infantry movement: the horse accelerates and brakes progressively, cannot pivot through an unrestricted instant turn, and uses speed-synchronised walk/run playback down through the final slowing stride so the 17-clip rigged horse-and-rider model follows actual movement speed. The mounted state is for reconnaissance, reserve movement, and disengagement. It does not provide an anti-tank charge, and cavalry should dismount before a sustained firefight.

Horse-drawn artillery limbers are a separate system and remain planned. The implemented cavalry mount/dismount state does not imply that the 75 mm guns can yet be hitched to horses.

## German scenario roster

The current allowlist uses Kar98k/MG34 infantry with one limited-issue MP38 squad leader, 5 cm and 8 cm mortars, PaK 36 support, Panzer I, Panzer II, a reconnaissance armoured car, and one rare Panzer IV in the final echelon. The mission fields no Panzer III.

## Preview implementation status

| Dossier feature | Status | Notes |
|---|---|---|
| Mokra second in the battle selector | Preview | Dyle remains the first/default battle; Mokra is explicitly marked Preview. |
| Poland faction and player-relative AI/fog/selection | Implemented | Polish is the locked player side for this mission. |
| Appropriate 1939 core roster | Implemented | Includes editable descriptions and model-safe procedural fallbacks. |
| Railway, limited crossings, Mokra I–III, no major water | Implemented | Dedicated scenario generator; the legacy French river map is not used. |
| Deployment countdown, defensive hold, and German attack waves | Implemented | Persistent white, top-centre three-minute preparation timer followed by five combat minutes; the vanguard enters at 3:00, later waves at 3:55/5:05/6:25, and victory resolves at 8:00 while crossing-control defeat logic remains active. Siren playback is temporarily disabled during testing, with the asset retained for later use. |
| Polish voice assets | Implemented | 75 unique assets are active across infantry and tank pools. Only two context-specific clips remain reserved; tank pools reuse vehicle-neutral takes, with dedicated crew recordings still desirable. |
| Dedicated Polish infantry/vehicle/gun models and PNG skins | Partial | Mounted Ułans use a dedicated supplied 17-clip rigged horse-and-rider GLB. The 75 mm Armata now has a dedicated gun model and two rifle-free clones of the Polish-tinted infantry rig for its visible operators. Foot infantry still use tint rather than a painted Polish PNG, and most Polish vehicles/guns remain procedural. |
| Mounted cavalry reserve | Implemented | Four player-controlled `mounted_ulan` units deploy east of the railway. Dismounting parks a persistent, unselectable riderless horse; its linked Ułan must return through an enter-style order before remounting. Mounted movement uses acceleration, braking, limited turning, and speed-synchronised walk/run animation. |
| Horse artillery limbers | Planned | Horse teams, gun hitching, and limber/unlimber presentation are not part of the mounted-cavalry implementation. |
| Armoured Train No. 53 “Śmiały” | Planned | Railway path exists; train entity, cars, weapons, timetable, and effects do not. |
| Scripted Ju 87 phase | Planned | No player-callable air support is used as a substitute. |
| Multi-state destroyed/immobilized/abandoned/recovered scoring | Planned | Current combat has component damage but not the complete dossier ledger. |
| Counterattack and protected withdrawal east | Planned | Needs multi-zone objective and extraction scripting beyond the current hold phase. |
| Alternate battles/campaign persistence | Planned | Jordanów/Wysoka, Mława, Borowa Góra, Bzura, and Krojanty remain in the dossier backlog. |

## Polish voice implementation

The project owner supplied 77 Polish WAV recordings. Their original WAV masters remain outside the repository; compressed runtime copies live under [`sounds/voices/pl/`](../../sounds/voices/pl/), separately from the public-domain RWM sound bank.

- 16 infantry-selection takes are active for soldier selection.
- 30 movement takes are active for movement orders.
- Infantry attack acknowledgements use 6 core-attack takes and 18 morale/patriotic takes.
- Tank pools reuse vehicle-neutral supplied takes: 15 selection, 17 movement, 5 core-attack, 18 shared vehicle-safe morale/patriotic, and 8 stop.
- The first accepted attack order in each Polish infantry/tank stream uses the morale pool, as does every third attack order thereafter. Calls rejected by the voice throttle do not advance this cadence.
- Direct attacks, attack-move, and attack-ground all choose attack semantics. Drag-box selection emits one aggregate infantry or tank acknowledgement for the whole box.
- The final German Mokra echelon forces exactly one `nie-zlamia-nas` cue through the mission-event voice path.
- Because some recordings serve several pools, 75 unique assets are active overall rather than the sum of every pool size.
- Only `formal-variants/oddzial-gotow-panie-kapitanie` and `patriotic/za-warszawe` remain reserved for suitable later use.
- Dedicated Polish vehicle-crew recordings remain desirable, but tank acknowledgements are no longer silent and never fall through to French or German speech.

Runtime copies are mono 22,050 Hz, signed 16-bit FLAC audio in Ogg containers, processed with an 80 Hz high-pass filter and fixed -8 dB gain adjustment. Rebuild them from a supplied WAV folder with [`scripts/process-polish-voices.sh`](../../scripts/process-polish-voices.sh). No CC0 or public-domain claim is made for these user-provided recordings; their provenance is documented separately in [`CREDITS.md`](../../CREDITS.md).

## Historical guardrails

- Spell the battle **Mokra**, not “Morka” or “Mórka.”
- Do not add a major lake or broad river to this map.
- Polish cavalry fights primarily dismounted; the four mounted reserves represent battlefield mobility, not a replacement for the dismounted defensive line.
- Do not add a mounted anti-tank charge. Sabres and horses are not substitutes for Bofors guns, wz. 35 anti-tank rifles, mines, or artillery.
- Do not field 7TP tanks at Mokra.
- Do not treat routine TKS tankettes as 20 mm tank hunters.
- Use mostly Panzer I and II, very few Panzer IV, and no routine Panzer III.
- Frame Polish success as delay, disruption, combat losses inflicted, and force preservation—not destruction of the entire German division.

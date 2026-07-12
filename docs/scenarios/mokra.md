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
- Primary objective: hold the central railway crossing for five minutes.
- Secondary objective: preserve the command team and at least one 37 mm Bofors gun.
- Defeat: lose the whole Polish force, or leave the central crossing under uncontested German control for 25 seconds.
- Attack structure: a German vanguard followed by three timed echelons from the west.
- Air support: none is player-callable. French fighters and generic bomber support are disabled for Mokra.
- Voice behavior: Polish order acknowledgements are intentionally silent until Polish recordings are supplied. Combat effects, engines, ambience, and UI sounds remain enabled.

## Authored map

The 100 × 100 tile battlefield is deliberately compressed for the current engine. It contains:

- a north–south railway embankment with three vehicle crossings;
- separate Mokra I, Mokra II, and Mokra III settlement/orchard strips;
- broad cultivated western approaches for the German attack;
- irregular woods for Polish concealment and anti-tank ambushes;
- an eastern Polish reserve area;
- no broad river or lake.

Railway tiles slow infantry and block vehicles, forcing vehicles to use the road crossings. Procedural sleepers and steel rails make the feature visible independently of the terrain texture.

Runtime source: [`js/scenarios/mokra.js`](../../js/scenarios/mokra.js). Map metadata: [`maps/mokra/map.json`](../../maps/mokra/map.json).

## Playable Polish roster

| Unit | Battlefield role |
|---|---|
| Ułan (spieszony) | Dismounted cavalry rifleman; use cover and fire-and-manoeuvre, never cavalry charges against tanks. |
| Strzelec piechoty | Attached infantry rifleman providing dependable long-range small-arms fire. |
| Rkm wz. 28 | Mobile two-man Browning light-machine-gun team. |
| Karabin ppanc. wz. 35 “Ur” | Concealed close-range anti-tank rifle team for early tank flanks and running gear. |
| Ckm wz. 30 | Sustained tripod heavy-machine-gun fire; powerful but slow to relocate. |
| Granatnik wz. 36 (46 mm) | Short-range company explosive support. |
| Moździerz wz. 31 (81 mm) | Battalion high-explosive support against infantry, woods, and exposed crews. |
| Armata ppanc. wz. 36 (37 mm Bofors) | The principal Polish tank killer at Mokra; best concealed and firing into flanks. |
| Armata wz. 1902/26 (75 mm) | Horse-artillery field gun represented as a crew-served gun in the current engine. |
| TKS (7.92 mm) | MG-only reconnaissance tankette, explicitly not the rare 20 mm tank-hunter conversion. |
| Samochód pancerny wz. 34 | Fast but thin-skinned wheeled reconnaissance car. |
| Oficer, Saper, Sanitariusz, Mechanik | Command, engineering, medical, and repair support. |
| Polski Fiat 621L supply/transport trucks | Ammunition support plus two ten-seat reserve/evacuation carriers; soft-skinned and unsuitable for the firing line. |

The editable definitions and descriptions are in [`data/units.csv`](../../data/units.csv), with built-in fallbacks in [`js/units.js`](../../js/units.js). Polish weapons have hand-authored behavior in [`js/weapons.js`](../../js/weapons.js).

## German scenario roster

The current allowlist uses Kar98k/MG34 infantry with one limited-issue MP38 squad leader, 5 cm and 8 cm mortars, PaK 36 support, Panzer I, Panzer II, a reconnaissance armoured car, and one rare Panzer IV in the final echelon. The mission fields no Panzer III.

## Preview implementation status

| Dossier feature | Status | Notes |
|---|---|---|
| Mokra second in the battle selector | Preview | Dyle remains the first/default battle; Mokra is explicitly marked Preview. |
| Poland faction and player-relative AI/fog/selection | Implemented | Polish is the locked player side for this mission. |
| Appropriate 1939 core roster | Implemented | Includes editable descriptions and model-safe procedural fallbacks. |
| Railway, limited crossings, Mokra I–III, no major water | Implemented | Dedicated scenario generator; the legacy French river map is not used. |
| Defensive hold objective and German attack waves | Implemented | Five-minute vertical slice with crossing-control defeat logic. |
| Polish voice assets | Awaiting assets | Empty `VOICE_PL` slots prevent cross-language fallback and 404 requests. |
| Dedicated Polish infantry/vehicle/gun models and PNG skins | Placeholder | Shared animated soldier with khaki tint plus procedural vehicles/guns. |
| Mounted cavalry and horse limbers | Planned | Requires horse, rider, dismount, hitch, and limber systems. |
| Armoured Train No. 53 “Śmiały” | Planned | Railway path exists; train entity, cars, weapons, timetable, and effects do not. |
| Scripted Ju 87 phase | Planned | No player-callable air support is used as a substitute. |
| Multi-state destroyed/immobilized/abandoned/recovered scoring | Planned | Current combat has component damage but not the complete dossier ledger. |
| Counterattack and protected withdrawal east | Planned | Needs multi-zone objective and extraction scripting beyond the current hold phase. |
| Alternate battles/campaign persistence | Planned | Jordanów/Wysoka, Mława, Borowa Góra, Bzura, and Krojanty remain in the dossier backlog. |

## Asset hand-off for Polish voices

When recordings are ready, add OGG files under `sounds/rwm/` (or move them to a future Polish sound folder and adjust paths) and list their basenames in `VOICE_PL` inside `js/audio.js` for these semantic slots:

- soldier select, move, and attack;
- vehicle select, move, attack, and stop.

Until a slot contains at least one real take, it stays silent and does not consume the voice throttle.

## Historical guardrails

- Spell the battle **Mokra**, not “Morka” or “Mórka.”
- Do not add a major lake or broad river to this map.
- Polish cavalry fights primarily dismounted.
- Do not field 7TP tanks at Mokra.
- Do not treat routine TKS tankettes as 20 mm tank hunters.
- Use mostly Panzer I and II, very few Panzer IV, and no routine Panzer III.
- Frame Polish success as delay, disruption, combat losses inflicted, and force preservation—not destruction of the entire German division.

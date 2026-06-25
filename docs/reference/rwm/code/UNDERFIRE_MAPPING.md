# RWM code mechanics → Under Fire (carry-over map)

What the RWM mechanics-code RE (`code/`, reconstructed from the DLL disassembly)
documents, and where Under Fire already implements it or where a gap remains.
The RWM side is engine-internal C++; we don't copy code (different engine/2D vs
3D), we carry over the *behavior*.

## Movement (`mechanics_movement.md`, `unit_*_moving.cpp`)

| RWM behavior | Under Fire status |
|---|---|
| Pathfind over grid respecting passability | **Have** — A* in `js/pathfinding.js`; tiles carry `blocked`/`move` (`js/terrain.js`). |
| `movespeed` forward locomotion | **Have** — `maxSpeed = unit.speed` in `js/main.js` movement. |
| `backmovespeed` (reverse for short distances) | **Have** — vehicles reverse for short rear moves, `js/main.js:567`. |
| `crouchmovespeed` (stance speed) | **Have** — `STANCE_SPEED[unit.stance]` multiplier. |
| Terrain move modifiers (road faster, mud/forest slower) | **Have** — `js/main.js:403-406` (road ×1.2, mud/forest ×0.7, wheat ×0.9, dense_forest ×0.3). RWM's `road: {move:0.75}` cost is the same idea. |
| `siegespeed` deploy/limber for towed guns | **Have (added)** — deploy/limber state machine in `js/main.js`. |
| 64-step facing, 8-direction walk frames | **N/A** — that's a 2D sprite-engine detail; Under Fire is 3D with continuous facing. |
| `walkonshallows`/`walkonwater` passability tiers | **Partial** — water is hard-blocked (`terrain.js`); no shallows tier. |

Net: the documented movement model is already in place. The code deep-dive mainly
**validates** Under Fire's movement design and confirms the data-param meanings.

## Bridge building (`mechanics_bridge_building.md`, `unit_gruz_buidpont.cpp`)

| RWM behavior | Under Fire status |
|---|---|
| Static bridge as passable terrain over a river | **Have** — the map's stone arch bridge over the river (`js/terrain.js`). |
| Engineer **builds a pontoon bridge** segment-by-segment over water (`pontbuildcost`/`pontbuildtime`, `land_pont`) | **GAP** — no player-built crossings. This is the one code-documented mechanic Under Fire lacks, and the map has a river, so it's applicable: a sapper could plank a new crossing to flank. |
| `fixmost`/`fixrail` repair bridge/rail | **N/A** — no destructible bridges or rail network on the current map. |

## Architecture note (`code_map.md`)

RWM factors each unit into modules (`_main`/`_moving`/`_fire`/`_scan`/`_commands`/
`_health`/`_pickup`). Under Fire is monolithic (one `Game.updateUnit`) plus
`js/ai.js`, `js/combat.js`, `js/pathfinding.js`. The module split is a good
refactor target if `updateUnit` keeps growing, not a behavior gap.

## Suggested next port from the code docs
**Engineer pontoon/plank bridge** (the one real gap above): a sapper at the
water's edge lays a crossing segment-by-segment to the far bank, turning those
water tiles passable (deck mesh + pathfinding update). Complements the sandbag
emplacements already added. Everything else the code documents is present or N/A.

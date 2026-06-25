# Unit types & engine architecture

From the source-file paths embedded in `n2Game_Dll.dll`
(full list: `raw/engine_source_modules.txt`). These reveal both the **unit type
taxonomy** and the **per-unit module breakdown** - i.e. how the engine factors unit
logic into reusable subsystems.

## Unit types (each is a distinct class with its own logic)

| Type id | Unit class | Notable subsystems present |
|---|---|---|
| `unit_sold` | Infantry soldier | `main`, `moving`, `ani`, `commands` |
| `unit_para` | Paratrooper | `main` (drop/landing) |
| `unit_guner` | Gun crew / gunner | `commands`, `fire`, `scaner` |
| `unit_gun` | Towed gun / AT gun | `main`, `moving`, `fire`, `health` |
| `unit_atg` | Anti-tank gun | `commands` |
| `unit_szenit` | AA gun (zenit) | `commands` |
| `unit_tank` | Tank | `fire`, `scan` |
| `unit_tank2` | Tank (2nd variant / multi-turret) | `fire`, `scan` |
| `unit_samo` | Self-propelled gun | `fire`, `scan` |
| `unit_katya` | Rocket launcher (Katyusha) | `fire`, `main` |
| `unit_jeep` | Light vehicle | `main` |
| `unit_machine` | (MG team / machinery) | `commands`, `health` |
| `unit_gruz` | Supply / engineer truck | `buidpont` (build pontoon), `commands`, `scan` |
| `unit_medic` | Medic | `commands`, `fire` (= heal) |
| `unit_house` | Occupiable building | `fight`, `health`, `main`, `pickup`, `scaner` |
| `unit_portal` | Spawn/reinforcement structure | `fight`, `health`, `pickup` |
| `unit_huge` | Huge unit (ship/large) | `main`, `scan` |
| `unit_turret` | Turret sub-object | `unit_turret` |
| (avia) `avia_plane` | Aircraft | `bomber`, `interceptor`, `transport`, `spy` |

Note the pattern: combat ground units share `fire`+`scan`(+`moving`); carriers
(`house`, transports) add the **container** module; support units (`medic`,
`gruz`) reuse `fire`/`commands` for non-combat actions (heal, build).

## Per-unit modules (the subsystems each unit composes)

| Module file suffix | Responsibility |
|---|---|
| `_main` | construction/lifecycle, core state |
| `_moving` | locomotion, pathing follow, facing |
| `_fire` | target acquisition -> aim -> shoot -> reload |
| `_scan` / `_scaner` | sight, detection, enemy/target scanning |
| `_commands` | order handling (player + AI commands) |
| `_health` | damage, hit reactions, death/wreck |
| `_pickup` | pick up / load / capture |
| `_fight` | (houses/portals) garrison combat |
| `_ani` | animation state |

Shared container modules: `module_fire`, `module_scaner`,
`module_cont_health`, `module_cont_pickup`, `module_cont_scaner` (used by anything
that holds other units).

## Engine subsystems (above individual units)

| Subsystem | Role |
|---|---|
| `pathfind/wrapper` | pathfinding over the iso grid |
| `units_AI/unit_AI`, `Ai/AI_zone` | autonomous unit AI + zone/location AI |
| `Avia/avia_plane*` | aircraft (bomber / interceptor / transport / spy) flight & strike |
| `force/force` | "force" = a scripted bucket of units used by mission triggers |
| `selection/player_selection` | player unit selection |
| `land/land_pont`, `land_stand`, `land_vor` | dynamic terrain: pontoon bridges, standing objects, craters |
| `map/map`, `map/mis_flags` | map state + mission flags |
| `desc/shots`, `desc/explosions` | projectile and explosion descriptors |
| `cgame/cgame_flg` | game/mission flags |

This factoring is a good template for a reimplementation: model each unit as a
**type** that composes a fixed set of **modules** (move/fire/scan/health/commands +
optional container), sitting on top of shared pathfinding, AI, aviation, and a
trigger/"force" system.

# Codebase map (from embedded source paths)

79 source files are referenced in `n2Game_Dll.dll` (full list:
`../raw/engine_source_modules.txt`). Grouped by subsystem, with resolved code
addresses for the mechanics located so far. ImageBase `0x10000000`.

## Subsystems

| Subsystem | Files | Role |
|---|---|---|
| `units/unit_*` | 57 | per unit-type logic (see below) |
| `units/module/*` | (in units) | shared modules: `module_fire`, `module_scaner`, container (`module_cont_health/pickup/scaner`) |
| `units/units_AI/*` | (in units) | per-type autonomous AI (`unit_AI`, `unit_*_AI_*guard`, `unit_gruz_AI`) |
| `land/*` | 4 | dynamic terrain objects: `land_pont` (pontoon bridges), `land_stand`, `land_vor` (craters), `land_descdata` |
| `avia/*` | 5 | aircraft: `avia_plane`, `_bomber`, `_interceptor`, `_transport`, `_spy` |
| `pathfind/wrapper` | 1 | pathfinding over the iso grid |
| `Ai/AI_zone` | 1 | zone/location AI |
| `force/force` | 1 | scripted unit buckets (triggers) |
| `map/*` | 2 | `map`, `mis_flags` |
| `selection/player_selection` | 1 | unit selection |
| `desc/*` | 2 | `desc_shot` (projectiles), `desc_explosion` |
| `cgame/cgame_flg` | 1 | game/mission flags |

## Per unit-type modules
Each unit type splits into `_main` (lifecycle), `_moving` (locomotion),
`_fire` (target->aim->shoot->reload), `_scan`/`_scaner` (sight/detection),
`_commands` (order handling), `_health` (damage/death), `_pickup`/`_fight`
(carriers/garrisons). Types present: `sold, para, guner, gun, atg, szenit, tank,
tank2, samo, katya, jeep, machine, gruz, medic, house, portal, huge, turret`.

## Located mechanic functions (code addresses)

| Mechanic | Source file | Code address(es) |
|---|---|---|
| **Bridge / pontoon build** | `units/unit_gruz/unit_gruz_buidpont.cpp` | function at `0x10024B01` (asserts `0x10024B12`, `0x10024B2F`) |
| **Pontoon land object** | `land/land_pont.cpp` | xref at `0x1007483A` |
| **Bridge/rail repair** | `units/unit_gruz/unit_gruz_commands.cpp` | file string `0x100F87F0`; fields `fixmost`/`fixrail` |
| **Infantry movement** | `units/unit_sold/unit_sold_moving.cpp` | asserts `0x10021C15`, `0x10021C8A` |
| **Gun movement** | `units/unit_gun/unit_gun_moving.cpp` | file string `0x100F89A8` |
| **Rider movement** | `units/unit_ezd/unit_ezd_moving.cpp` | file string `0x100F8C88` |
| **Pathfinding** | `pathfind/wrapper.cpp` | xref at `0x1008F6ED` |
| **Supply-truck AI** | `units/units_AI/unit_gruz_AI.cpp` | file string `0x100F91E0` |
| **Health/damage (generic)** | `units/unit_/unit_health.cpp` | file string `0x100F8FC8` |

The assert handler used by all of the above is **`0x1007ACC0`**
(`push line; push file; push 0xFF; call 0x1007acc0`).

To resolve more: `tools/xref.py <source-keyword>` prints the string VA, then
`grep '<va>' disasm/n2Game_Dll.asm` finds the function.

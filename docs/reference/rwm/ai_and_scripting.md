# AI behavior & mission scripting

Three layers: (1) the **autonomous combat loop** every unit runs, (2) **group AI
behaviors** the editor assigns, (3) the **mission trigger** language
(conditions -> functions).

## 1. Autonomous unit combat loop

Driven by the `_scan`/`_fire`/`_moving` modules and paced by the `ai_*wait*`
attribute timers (`unit_attributes.md`). Reconstructed loop *(inferred from the
state names)*:

```
scan (every `scandelay`/`airscandelay`, within `sight`/`scanrange`)
  -> acquire target (respect `attackpref`, `deadzone`..`range`, `enemyinsight`)
  -> if not in arc/range: turn hull/turret (`turnspeed`,`gunturndelay`) / move
  -> wait `ai_*waitstartattack` / `delaybeforefight`
  -> fire (`fire`, `burstshots`, consume `ammo1/2`) -> reload (`reloadtime`)
  -> if `outofammo`: seek resupply; if morale low (`moralenoattack`): hold/flee
```
Idle units may wander (`ai_*waitrndmove`) or advance toward a zone
(`ai_*waittozonemove`); infantry enter cover/houses (`ai_soldwaitgoin`).

## 2. Group AI behaviors (`editor/n2Editor.iniAI`)

Each scripted group is assigned one **behavior** plus modifier **flags**. Full
verbatim list in `raw/ai_behaviors.iniAI`.

| Behavior | Meaning |
|---|---|
| `AI_NONE` | passive |
| `AI_RECON` | reconnaissance |
| `AI_SOLD_GUARD` | infantry guard a location |
| `AI_SOLD_FOLLOW` | infantry pursue |
| `AI_SOLD_ART` | infantry crew a howitzer |
| `AI_TANK_GUARD` | tanks guard a location |
| `AI_TANK_FOLLOW` | tanks pursue a group |
| `AI_FURG_HELP` | trucks support |
| `AI_FURG_MOVE` | trucks move to location |
| `AI_FURG_TRANSPORT` | trucks ferry units location->location |
| `AI_GRUZ_RELOAD` | supply trucks repair/resupply (and build pontoons) |
| `AI_KATYA_MOVE` | rocket launchers move to location |
| `AI_PLANE_MOVE` | planes move to location (bomb / deliver) |
| `AI_TRAIN_MOVE` | trains guard location / repair track |

Common flags (verbatim meanings from the file):
- `AIF_RNDMOVE` spread randomly through the location
- `AIF_RNDTARGET` randomly change pursued target
- `AIF_ZONEHAVEOWN` move to location only if friendly troops present
- `AIF_ZONENOENEMY` move to location only if no enemy troops
- `AIF_ZRESTRICT` act only inside the location
- `AIF_GRESTRICT` support only selected groups
- `AIF_USEOBJECTS` destroy objects / repair objects (context-dependent)
- `AIF_HOLDFIRE` hold fire (howitzers) / build pontoon bridges (supply trucks)
- Weapon-specific families: `AIF_atg*` (anti-tank guns), `AIF_gaub*` (howitzers),
  `AIF_dom*` (houses: `AMBUSH`, `HIDE`), `AIF_ezd*` (don't use empty guns) - each
  controls occupy/leave/move/tow/drop for that weapon class.

## 3. Mission trigger language

Missions are if-then triggers: when **conditions** hold, run **functions**.
Conditions live in `editor/cnd.ll1`, functions in `editor/fnc.ll1`; cleaned dumps
are in `raw/trigger_conditions.txt` and `raw/trigger_functions.txt`.

### Conditions (the "when")
- Logic: `and`, `or`, `not`
- Time: `timer elapsed`, `mission start`, `countdown is`, `time from start of mission`
- Difficulty: `difficulty level is easy`
- Force counts: `units of group in location` (absolute or `per cents`),
  `units of player in location` (abs/%), `units of player in group`,
  `units in group` (abs/%), `units of player` (abs/%), `units of force`
- Events: `object is dead`, `group was attacked some time ago`, `group ammo`
- AI state checks: `AI_BEHAVIOR for group`, `AI_LOC1/AI_LOC2 for group`,
  `AI_GRP1/AI_GRP2 for group`

### Functions (the "then")
- Flow: `turn off this trigger`, `set/stop timer`, `set timer period`,
  `start countdown`, `set next mission`, `end of mission`
- Presentation: `move screen to location`, `say phrase` (+ pointer to marker),
  `show modal dialog` (+ pointer)
- Fire support: `launch rockets by RL of group to location/marker`,
  `fire a howitzer of group to location/marker`, `fire a V2 of group to location`
- Force ops: `clear force`, `add group/units-in-location/all/player units to force`,
  `put units from force to location` (optionally assign a group),
  `form reinforcement from force` (optionally assign group)
- Unit ops: `set new group for units in location`, `set attribute for units in
  group`, `destroy units of group/in location through the flag`, `restore units`
- Reinforcements: `send reinforcement`, `set initial/infinite reinforcements`,
  zeppelin/airdrop reinforcement set-up
- AI orders (the scripting equivalent of §2): `set AI_BEHAVIOR for group`,
  `set AI_LOC1/AI_LOC2 for group`, `set AI_GRP1/AI_GRP2 for group`,
  `add/shift/clear patrol locations for group`
- Aviation: `send planes of player to location/marker/airfield and land`,
  `add planes/flights to player`, `start plane route`, `add route point over
  marker`, `add strike point over marker`, `send planes via plane route`
- Misc: `transfer group to player`, `let cell contain value` (variables),
  `mathematical operation`

### Key concepts for reuse
- **Group**: a tagged set of units the AI/triggers address collectively.
- **Force**: a scratch bucket triggers fill from groups/locations, then spawn or
  reposition as reinforcements.
- **Location/zone & marker**: named map regions/points used as order targets and
  condition scopes.
- **AI_LOC1/2 & AI_GRP1/2**: per-group AI parameters (target locations/groups) that
  both conditions can read and functions can set - this is how scripted AI adapts
  during a mission.

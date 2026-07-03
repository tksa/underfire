# Code review — 2026-07-03 (AI-assisted deep dive)

Full-codebase review by four parallel review agents (renderer/engine, main/unit_modules,
AI/combat/pathfinding, input/units/mission), each finding verified against surrounding
code before inclusion. Ranked by impact within each section. File:line references are
against commit `377730a`.

## Root cause found: BUGS.md #9 "Pathfinding routes wrong around buildings (goes left)"

Three compounding defects in `Game.findPath`:

1. **Inadmissible A\* heuristic** (`js/pathfinding.js:7`): Manhattan distance overestimates
   on an 8-connected grid where roads cost 0.75/move — up to ~1.9x. A\* degrades to
   near-greedy best-first: it commits to whichever side of a building it expands first
   (deterministically the same side, due to `dirs` order + heap tie-breaking) and never
   reconsiders. Fix: octile heuristic scaled by min tile cost:
   `h = 0.75 * (max + 0.4 * min)` of `|dtx|,|dty|`.
2. **NW-biased destination snap** (`js/pathfinding.js:30-43`): when the clicked tile is
   blocked, the fallback scan takes the first unblocked tile in `dy,dx = -r..r` order —
   always the north-west one — dragging the goal (and the route) around that side.
   Fix: pick the candidate minimizing squared distance, and reject tiles that are
   vehicle-blocked for vehicles.
3. **Diagonal corner-cutting** (`js/pathfinding.js:86-100`): a diagonal step never checks
   the two orthogonal neighbours, so paths cut exactly through building corners; the
   de-penetration code then fights the clip (the "cap de-penetration" commit treats the
   symptom). Fix: require both orthogonal neighbours passable for diagonal moves.

## Critical correctness bugs

- **HE splash never kills** (`js/combat.js:236-249`): splash victims get `hp -=` with no
  death handling; all health-module branches require `hp > 0`, so mortar/HE victims stay
  alive at negative HP forever. Route splash through the standard death block.
- **Wreck darkening mutates shared GLB materials** (`js/renderer.js:31-40`): materials are
  shared across clones for every model except `french_r35`; the first S35 kill darkens all
  living S35s, the second darkens them again (~near-black). Clone materials before
  mutating.
- **Duplicate keydown handlers** (`js/input.js`): F (attack-ground + first aid), L (jump to
  last attack + load truck), C (guard + stance), X (posture + exit vehicle) each fire BOTH
  branches on one keypress. Pressing F to suppress an area silently consumes first-aid
  kits. Merge into one handler/switch.
- **Garrison Q-command teleports infantry** (`js/input.js:749-753`): `enterBuilding` calls
  `garrisonUnit` directly (sets x/z inside) with no range check or walking. Route through
  `orderEnterBuilding` (walk to door) instead.
- **Garrisoned deaths leak occupant slots** (`js/buildings.js:497`): units dying from
  bleed-out or direct fire while garrisoned never `ungarrisonUnit`; the building reports
  full forever. Call ungarrison in the death paths or prune dead ids.
- **Garrisoned units are invisible to enemies** (`js/pathfinding.js:124-129`): the
  sightBlock exemption only checks the *shooter's* garrison, so enemies can never see (or
  return fire at) garrisoned troops. Also exempt samples inside the *target's* building.
- **Immobilized vehicles never decelerate** (`js/unit_modules.js:576-582, 762-771`): all
  decel rates derive from `maxSpeed`; when a mine/hit/fuel-out zeroes it mid-motion the
  vehicle glides at frozen speed indefinitely. Floor the brake/coast rates; zero
  `currentSpeed` where tracks are disabled.
- **`gameClock` advances while paused** (`js/main.js:2404-2406`): orders can be issued
  during pause, but every clock-stamped window (rotate-facing, sticky engagement, AI
  threat memory) burns down in real time. Move the increment inside the pause gate.
- **TNT fuses with real-time `setTimeout`** (`js/main.js:1855-1874`): detonates during
  pause. Tick it in the game loop like grenades.
- **Truck passengers keep stale positions** (`js/main.js:1576-1587`): enemies target and
  fog reveals the empty pickup point. Skip `_inVehicle` units in `nearestEnemy` + fog, or
  sync their x/z to the carrier.
- **CSV NaN stats applied silently** (`js/units.js:416`): a typo'd number makes a unit
  unkillable (`hp = NaN`). Validate with `Number.isFinite` + warn.
- **CSV partial rows wipe armor** (`js/units.js:439-441`): a row omitting class/armor
  columns sets `armor = 0` on a baseline vehicle. Only touch armor when an armor cell is
  present.
- **German tanks retreat from themselves** (`js/ai.js:64-72, 190-233`):
  `nearestFriendlyTank` returns the tank itself; the infantry react-to-contact branch has
  no vehicle gate, so armor perpetually creeps backwards instead of assaulting. Skip
  `a === unit`; gate the branch on `!isVeh`.
- **Crew-bail also explodes** (`js/combat.js:348-359`): the bail branch falls through into
  the knocked-out sequence (second message, XP, explosion). Return after bailing.
- **Mixed `lineOfSight` returns** (`js/pathfinding.js:129 vs 140`): hard block returns
  `false`, foliage block returns `0`; `!== false` call sites treat `0` as clear. Return
  `false` consistently.

## Medium correctness

- New orders don't clear `retreating`/`_retreatThreat` → tanks crawl backwards on the next
  order (`js/input.js:128-208`, `js/unit_modules.js:511`).
- Mutual destruction sets `won` and `lost` in the same tick (`js/mission.js:116-126`).
- Building exit can strand units inside blocked footprint tiles (`js/main.js:1655-1662`);
  place exits at `buildingDoors`.
- Building collapsed during async GLB load pops back up (`js/buildings.js:56-165`): check
  `rec.collapsed` in `_populateBuildingModel`.
- Model loader `.catch` swallows setup exceptions and probes the next path
  (`js/units.js:1387-1389`); use two-arg `.then(onLoad, onErr)`.
- Orders to garrisoned/towed units are silent no-ops that still consume formation slots
  (`js/input.js:84-218`).
- Officer sight aura effectively never applies; binoculars double-counted (4x) in fog
  reveal; officer accuracy "buff" is a permanent ratchet; infantry ammo scavenging is
  uncapped (`js/main.js:641, 1753, 716; js/unit_modules.js:98-106`).
- Dead units keep animating mixers forever; skinned soldiers animate during pause
  (`js/renderer.js:66, 473-487`).
- Enemy wrecks pop visible inside unexplored fog (`js/renderer.js:65`).
- `makeUnit` ignores `opts.holdPoint` (`js/units.js:1503`).
- Air-strike/TNT kills skip `Game.selection` cleanup — suggests a shared `killUnit()`
  helper (six inline death blocks exist in main.js).

## Performance (biggest wins first)

1. **Target scan**: `uMod.scan` calls `nearestEnemy` per unit per frame; `unitCanSee` runs
   the full LOS ray-march *before* the range check. O(units² × ray) per frame. Fix order:
   early-out on range before LOS; throttle scan to ~0.15-0.2s staggered; inline tile math
   in `lineOfSight` (the per-sample `{tx,ty}` allocation churns GC).
2. **Terrain raycast per mousemove** (`js/engine.js:249-271`): 131k-triangle mesh,
   brute-force, at 120-240 events/s. Raycast the flat ground plane then refine with
   `Game.getHeight`, or throttle to once per frame.
3. **`spawnCrater` full-mesh rebuild** (`js/renderer.js:1128-1166`): loops 66k vertices +
   `computeVertexNormals()` on the whole terrain per crater — and MG-armed vehicles crater
   on every bullet (`js/combat.js:127-129` gates on shooter, not weapon). Gate on weapon;
   patch only the affected vertex window.
4. **`updateHUD` rebuilds innerHTML at 60Hz** (`js/renderer.js:1263-1376`) plus 6 array
   filters per frame. Key the rewrite on a change string or throttle to ~4Hz.
5. **Movement stack does 5-6 full unit sweeps per unit per frame** (separation, yield,
   follow, avoid, nearOfficer, getUnitById). Build one spatial grid per tick; make
   `getUnitById` a Map.
6. **Fog-of-war allocates 2 canvases + ImageData every 0.12s** (`js/main.js:1740-1812`);
   hoist and reuse, skip when nothing changed.
7. **Failed pathfinding retries full A\* every frame** (bombard/assault/forced-target/
   enter-building call sites); add a retry cooldown.
8. Track marks unbounded (~2000 draw calls in tank battles) — cap or instance them.
   Sprite cleanup disposes the *shared* sprite geometry (`js/renderer.js:719,769`) —
   dispose only the material. Tracer geometry/material allocated per shot — pool them.
   Boot loads the same GLB once per unit — cache the load *promise*. A\* uses string map
   keys — use `ty*COLS+tx` ints. Minimap palette/filter allocations at 60Hz; formation
   preview rebuilds ring geometry every 150ms; `foliageKD` full scan per frame.
9. `Game.isTank` hardcodes 10 kinds — CSV-imported vehicles miss wreck/tilt/turret
   handling (`js/units.js:371`, used across renderer). Prefer `class === 'vehicle'`.

## Cleared (checked, not bugs)

dt is clamped (33ms); corpse/wreck promotion is centralized and once-only; `applyShot`
guards dead targets; A\* heap + lazy duplicates correct; CSV parser handles RFC-4180
quoting; audio pools bounded; obliquity math matches the design doc; formation slot
assignment terminates.

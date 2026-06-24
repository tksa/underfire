---
name: new-scenario
description: Create or modify a mission/scenario in Under Fire - force composition, spawn positions, the objective, win/lose conditions, and reinforcements. Use when someone asks for a new battle, mission, or to change how the current scenario is set up.
---

# Create / modify a scenario

Scenarios live in `js/mission.js`. The objective position is set in `js/terrain.js` (`generateMap`).

## Spawning forces — `Game.spawnScenario()`
- `Game.spawnSquad(team, x, z, group, opts)` drops a doctrinal squad (leader + support + riflemen). Teams: `Game.TEAM.FRENCH`, `Game.TEAM.GERMAN`.
- `Game.makeUnit(team, kind, x, z, opts)` places a single unit. `kind` must exist in `Game.UNIT_STATS` (see the `add-unit` skill).
- Positions are world units: `tile * Game.TILE` (`T`). Player units use `aiState: 'player'`; defenders use the `hold(x, z)` helper; patrols use `aiState: 'patrol'` + a `patrol: [...]` path.
- Keep French staging (NW) and the German defence coherent with the map, and keep the approach corridor passable.

## Objective + win/lose — `Game.updateMission(dt)`
- The objective marker is at `Game.missionState.objectiveX/objectiveY` (set in `generateMap`). Move it there if your scenario's goal moves.
- Win when a French unit reaches the objective or all enemies die; lose when the French force is destroyed. Edit `updateMission` for custom conditions (timers, hold-for-N-seconds, etc.).
- Reinforcement waves: see the timed block in `updateMission`.

## Toward multiple scenarios (high-value contribution)
There is currently one scenario. A great PR parameterises this: a scenario object that declares its spawns, objective, and a map seed/layout, selected from the menu. The menu already has a single "Mission Briefing" card to build from (`index.html`).

## Test
Run the `run-and-test` skill. Confirm both sides spawn, the objective marker is in the right place, and win/lose triggers fire.

---
name: add-unit
description: Add a new unit type to Under Fire (infantry, support weapon, or vehicle) - its stats, weapon, model, and spawn. Use when someone asks to add a soldier, gun, or tank (e.g. "add a Panzer IV", "add a French sniper team").
---

# Add a unit

Units are defined in `js/units.js` and spawned in `js/mission.js`.

## 1. Define the unit stats — `js/units.js`
Add an entry to `Game.UNIT_STATS`, keyed `"{team}_{kind}"` (teams: `french`, `german`):
```js
german_panzer4: {
  label: 'Panzer IV', kind: 'panzer4', class: 'vehicle',
  weapon: 'kwk37_75mm',          // must exist in Game.WEAPONS
  hp: 220, maxHp: 220,
  armor: { front: 50, side: 30, rear: 20 },   // vehicles; omit/0 for infantry
  speed: 5.2, sight: 14, range: 26, size: 1.0,
  // ...copy the closest existing unit and adjust
}
```
Copy the nearest existing unit of the same `class` (`infantry` / `support` / `vehicle`) and tune. Keep values historically plausible and cite a source in the PR.

## 2. Make sure the weapon exists — `js/weapons.js`
The `weapon` key must resolve in `Game.WEAPONS`. Reuse one or add a new weapon (range/damage/penetration/suppression/accuracy). Ranges are in game meters (1 game m ≈ 5 real m, per `docs/game-vision.txt`).

## 3. Give it a body
- **Procedural (easiest):** the unit mesh factory in `js/units.js` builds meshes by `class`/`kind`; a new kind falls back to a sensible procedural mesh.
- **Custom model (optional):** drop a **CC0** `models/{team}_{kind}.glb` (e.g. `models/german_panzer4.glb`). Loading is auto-wired in `_loadUnitModel` (`js/units.js`); models are auto-scaled. A rig with `idle`/`walk`/`run`/`fire` clips animates automatically. Add the model to `CREDITS.md`.

## 4. Spawn it — `js/mission.js`
```js
Game.makeUnit(GERMAN, 'panzer4', 40 * T, 12 * T, hold(40, 12));
// or add the kind to a roster in Game.spawnSquad
```

## 5. Test
Run the `run-and-test` skill. Confirm it spawns, moves, fights, and throws no console errors.

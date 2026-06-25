# RWM / Sudden Strike — game-logic reference

These documents reconstruct the game logic of the **RWM ("Real War Mod") for
Sudden Strike** — unit attributes, unit types/modules, the player order set and
controls, AI behaviors, the mission-trigger language, and the UI. They are kept
here as a design reference while porting the worthwhile mechanics into Under Fire.

## Source & license

Extracted from the RWM project, which is released under the **RWM Zero License
(RWM-Zero 1.0)** — a public-domain dedication ("use for any purpose, commercial
or not, no permission required"). So these notes and the RWM assets are free to
reuse. Credit is recorded in the repo `CREDITS.md`.

Original extraction lives outside this repo (the RWM distribution's
`extracted_assets/`), including the raw binary/config dumps every claim is traced
to, plus terrain tiles, shared objects, and (partial) unit sprite sheets.

## Files

| File | What |
|---|---|
| `unit_attributes.md` | The 593-field unit attribute schema, grouped by system. |
| `unit_types_and_modules.md` | Unit taxonomy + the per-unit engine modules (move/fire/scan/health/commands/container). |
| `orders_and_controls.md` | The player order set and the keyboard map. |
| `ai_and_scripting.md` | The autonomous combat loop, group AI behaviors, and the mission-trigger condition/function vocabulary. |
| `ui.md` | Menu screens and the in-game HUD/widget set. |

## How this maps to Under Fire (status)

Under Fire already covers a good slice of the RWM model: suppression-driven unit
AI (hold/engage/advance/seek-cover/pinned/retreat), control groups, house
garrison, mortar bombardment, attack-ground, crew, and partial patrol /
reinforcements.

Brought over so far:
- **Towed-gun deploy / limber (siege).** Crew-served guns (AT guns, heavy MGs)
  must set up to fire and pack up to move; handled automatically with a short
  crew-drill delay. See `deployable` in `js/units.js` and the deploy state
  machine in `js/main.js`.

Candidate next ports (not yet done): mine warfare (lay/clear), engineer building
(trench/sandbag/pontoon), vehicle transport + towing, looping patrol, a fuller
mission trigger/force/location scripting layer, an assignable AI group-behavior
layer, and deeper aviation. Per-unit stat *values* still live in RWM's
`rwm_*_stats.sue` archives and have not been extracted (only the schema has).

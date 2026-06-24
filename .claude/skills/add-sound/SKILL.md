---
name: add-sound
description: Add or change a battlefield sound effect, weapon sound, ambient loop, or voice bark in Under Fire. Use when someone asks to add/replace audio. All audio must be CC0 / public-domain.
---

# Add a sound

Audio lives in `js/audio.js` (the `Game.Audio` module) and clips live under `sounds/`.

## Rules
- **CC0 / public-domain only.** Add a `.ogg` file to `sounds/` and record it in `CREDITS.md`. The existing battle clips come from the RWM-Zero public-domain set in `sounds/rwm/`.

## One-shot effects (gunfire, explosions, etc.)
In `js/audio.js`, the `FILES` map groups clips by category:
```js
const FILES = {
  rifle:     ['sounds/rwm/rifle1.ogg', ...],
  mg:        ['sounds/rwm/mg_tank_burst.ogg', ...],
  cannon:    ['sounds/rwm/explo_tankdir.ogg', ...],
  explosion: ['sounds/rwm/smallexplosion.ogg', ...],
};
```
- Add your clip path to the right category's array (it round-robins between them).
- Tune `MIN_GAP` (seconds between plays per category, anti-spam) and `BASE_VOL` (per-category volume).
- New category? Add it to `FILES`, give it `MIN_GAP`/`BASE_VOL`, and expose a play helper (see `Game.Audio.rifle(x, z)` etc. near the bottom). Then call it from the relevant place (e.g. `js/combat.js`).

## Ambient loops
Add to `LOOP_FILES` (e.g. wind, birds, engine). Loop volumes are managed in `loopVol` and faded by distance/activity.

## Positional audio
Play helpers take `(x, z)` and attenuate by distance from the camera focus. Pass the source world position so it sits in space.

## Test
Run the `run-and-test` skill. Note: browsers need a user gesture before audio starts — the menu's Start button triggers `Game.Audio.init()`. Verify no console errors and the clip actually loads (no 404 for the path).

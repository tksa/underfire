# Mortar area fire and infantry response

## Player controls

Select a mortar and press **F** or **Attack ground**, then click the target area
with either mouse button. The order is always visible in the left command panel.
The orange circle previews the area. Use the area-radius slider or the wheel while targeting to change
its radius (2–24 world units; the HUD converts these to metres). A red preview
means the point is inside every selected mortar's minimum range. The selected-unit detail line shows maximum range. An out-of-range
order moves the mortar to a firing position before laying the weapon.

The separate **Ranged** and **Rapid** buttons select the preparation method for selected mortars,
including an active mission. Ranged fire sights for 5.5 seconds for a novice;
rapid fire begins after about 0.6 seconds once aligned. Experience and veterancy
shorten preparation, and suppression slows it. Deployment, ammunition, hold-fire,
transport and crew requirements still apply. These are game pacing choices,
not claimed historical firing tables. Move and stop orders cancel bombardment.

Every round samples a point inside the commanded circle plus crew error. Opening
rounds share a range/bearing bias instead of uniformly pin-pointing the centre.
There is still irreducible dispersion after correction. Ranged fire reduces
initial error; rapid fire trades that preparation for early rounds.

A living friendly observer must see an impact to correct it: observation checks
range, weather, smoke and terrain LOS without requiring a visible enemy. Experienced
crews correct faster per observed round and observed practice grants a small amount
of XP. Unobserved rounds do not acquire targets or earn correction. Retargeting
or moving the firing position invalidates the old solution; in-flight shells
from an old mission cannot improve a new one. Flight visuals arc from the real
tube socket and impacts resolve after flight time, including friendly blast damage.

## Infantry response

Infantry check nearby friendly gunfire after a short staggered delay. Failed
notice rolls retry after 1–2.4 seconds instead of spending a full 8–34-second
response cooldown. Already-facing troops have a 75% notice chance, other troops
30%; actual responders still wait 8–16 or 14–26 seconds between bursts.

Each 16-unit local cell permits two responders per eight-second cue, with six
responders at most across that cue. A broad engagement can therefore produce
small responses from multiple groups. Responses remain one or two inaccurate
rounds and cannot propagate further cues, reveal the enemy or override movement,
explicit target orders, hold-fire, reloads, suppression or friendly firing lanes.

An enemy's recent discharge is visible up to 2.4 times the observer's ordinary
identification radius for 2.5 seconds, reduced by concealment, foliage, weather
and smoke. Walls still block it. Only an actually visible firing position bypasses
stale map fog, and that position alone is revealed. This does not extend accurate
weapon range; farther fire remains uncertain supporting fire.

## Verification

- `node scripts/mortar-fire-test.mjs`: live game order routing, preparation,
  area coverage, observation, XP, retargeting, hold-fire, crew loss, minimum
  range, relocation and control visibility.
- `node scripts/supporting-fire-test.mjs`: sparse bursts, local response limits,
  retry timing, out-of-range fire, ammunition, command priority, terrain and
  spotting of discharges without revealing concealed targets.

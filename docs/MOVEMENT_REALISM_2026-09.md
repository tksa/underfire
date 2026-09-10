# Infantry and AT gun movement under armor (2026-09-10)

Why: the user reported that infantry and towed AT guns moved chaotically and
unrealistically, especially when tanks approached. A code audit (58 deduped,
code-anchored findings) plus a deterministic drill confirmed the causes and this
change set addresses them. Everything below is in `js/ai.js`, `js/unit_modules.js`,
`js/main.js`, `js/combat.js`, `js/input.js`, `js/ai_tactics.js`; the drill is
`scripts/tank-approach-test.mjs`.

## Root causes

- **Several writers of one stance.** `uMod.morale` forced crouch/prone every frame
  while `updateAI` (every 0.25-0.5 s), take-cover, retreat orders, make-way and the
  critical-hit code each wrote `unit.stance` too. Result: run/crouch/prone flicker at
  2-4 Hz, speed jumping between 1.5x and 0.28x, animation clips thrashing.
- **Several writers of one heading.** Path lerp, the fire module's aim pull, `_faceGoal`,
  make-way's 9 rad/s escape rotation and a per-think-tick 1 rad snap in the tank-hunter
  block all rotated the same man in the same frame.
- **Threat model.** AI infantry only knew about a tank from a frozen point where it fired
  8 s ago, never from `_armorThreat`; player take-cover fled straight down the tank's axis.
- **Make-way as a shove.** A positional push at up to 4.5 u/s plus a forced run stance,
  applied to prone men and deployed guns alike, fighting the path step (diagonal slides,
  sawtooth darts, spinning on the spot, guns skating sideways).
- **Guns treated as riflemen.** Retreating by limbering and crawling at 0.9 u/s in front of
  a tank, inheriting infantry stances, toggling limber/deploy on every one-tile path,
  pursuing forced targets on foot, never abandoned when overrun.
- **Squad cascades.** One hit alerted the whole squad with a suppression bump; everyone
  dashed to the same hedge tile; crowd settle deleted paths; broken squads "retreated"
  to the spot they stood on.

## What changed

- **One posture resolver** (`Game.uMod.posture`, runs once per frame after fire): merges
  the behaviour request (`Game.wantStance`), the player's movement-mode preference
  (`Game.setManualStance`), suppression floors with hysteresis (crouch 62/48, prone 88/72)
  and a 4 s just-hit floor. A routing man sprints through the crouch floor; an evading man
  is always on his feet; crew-served pieces have no stance.
- **One heading authority per frame.** Infantry aim only when not moving; deployed guns
  traverse at 0.8 rad/s and never while limbered; `_faceGoal` yields to the fire module;
  the tank hunter uses the continuous facing goal.
- **Armor awareness for both sides** (`Game.armorThreatFor`, `Game.laneInfo`,
  `Game.planArmorEvasion`): a tank is known if seen, heard within 14 u, or it has shot at
  the man in the last 8 s; the threat memory follows the tank instead of the spot it fired
  from. In its lane: leave perpendicularly to the committed side (preferring the side with
  cover if the tank is still far), then cover or the dirt, facing the tank. Off its axis: hold
  cover, or go to ground and lie still. Retreat rally points inside a lane are replaced by
  an off-axis spot; broken squads fall back a dozen metres away from the fire, not to the
  post they are being shot on.
- **Make-way is an intent**, not a shove: `applySeparation` sets `unit._evade`; the move
  module turns the man at a finite rate and runs him along his own heading (adrenaline
  speed floor). Bail side committed per vehicle, "overtaken" judged from the route, a man
  who stepped aside waits at the kerb, a rolling enemy hull is no longer a wall (men are
  crushed instead of bulldozed), remaining pushes are capped by stance.
- **Crew-served gun brain** (`Game._gunAI`): stays in action while armor is in reach
  (`_holdDeployedUntil`), engages soft targets, limbers to the rally only with no armor about,
  and the crew bails out (`Game.dismountGunCrew`) when wrecked, dry, broken or about to be
  overrun; bailed crews re-man the piece once it is quiet. Deploy/limber has 0.45 s
  hysteresis and uses the weapons' setup/teardown times. Deployed guns are immovable by men,
  never make-way'd, never assigned the maneuver role, and never pursue a forced target.
- **Targeting.** AT guns and AT rifles prefer armor; a tank no longer hides the infantry
  beside it from riflemen; "stand ground" (orderMode hold) fires again; a tank yields only
  to its own men; shell splash gives victims a threat bearing.
- **Squad level.** Alerts share position (also with the player's men) but cannot pin a squad
  by themselves; roles follow unit id; fallback needs a real recovery before lifting;
  cover search spreads men along a feature; attackers press on to their goal instead of
  walking back to their spawn; defenders adopt the cover they found as their post.
- **Smaller:** `_infantryFollow` no longer queues behind a standing man; stall-guard budget
  resets on a new order; infantry accelerate over a few strides.

## Second pass after in-game review (same day)

The first build of the resolver recovered only crouch and prone back to standing, so any
man who had sprinted once (dash, evade, retreat) stayed in the run stance for the rest of
the battle: 1.5x speed on every later order and an upright idle between them. That was
what the in-game review saw as "extremely fast" and "standing under fire". Fixed (run is a
request-only stance), plus:

- Foot pace: `Game.FOOT_SPEED_FACTOR` 0.5 (was a hidden 0.6): 2.2 u/s ≈ 1.65 m/s tactical
  walk, 1.2 u/s crouch-walk, 0.6 u/s crawl, 3.4 u/s ≈ 2.5 m/s run. One world unit is
  ~0.74 m (a 1.8 m soldier is 2.45 u tall). Manhandled guns keep 0.6.
- Men advancing under a move order while being shot at go forward at a crouch (the Run
  movement mode is respected); men without orders and no cover within 20 u go prone, not
  crouch; the cover search reaches 20 u (was 14) and forest now counts as cover
  (`Game.COVER_MIN` 0.30, shared by all three cover tests).
- AI riflemen kneel to fire and go prone when rounds come back; nobody fires standing once
  he has been shot at. Recovery to standing needs ten quiet seconds (was three).
- Attack-move is a bounding advance: a man shot at in the open breaks for cover within
  12 u (or drops flat under heavy fire), holds 4-8 s, then the assault resume takes him on.
- Crew-served weapons (mortars, MGs, guns) hold a target for 3 s and only re-lay on one at
  least 30% closer, instead of swivelling after every attacker who is briefly nearest.

Measured on the real Dyle map (`scripts/observe-battle.mjs`, 120 s attack-move, men shot
at in the last six seconds, 5117 samples): standing still 0%, crouched 88%, prone 10%, in
cover 59%, in the open with cover available within 20 u 5%, moving 33% (crouch-walk
1.0 u/s, run 2.7 u/s, crawl 0.44 u/s). Idle men left in run stance: 2 samples.

## Animation pass (same day, after the in-game review)

Audited with `scripts/anim-audit.mjs` (120 s Dyle attack, per-soldier clip trace, corpse
pose check, torso-height scrub of the raw take):

- **Standing corpses.** The rig's baked take has three death performances (each starts at
  full standing height and settles at 0.19-0.20 of it). The inherited fourth window
  `death4` lay in a standing section (torso at 1.00 throughout), so one corpse in four
  stayed on its feet. Removed; the other windows are trimmed to the settled frame. A man
  who dies before his model has loaded is now posed as a finished corpse when it arrives
  instead of playing the standing idle over a tipped placeholder. Knocked-out MG and mortar
  teams go over on their side and their gunner figure is hidden.
- **Kneeling fire.** There was no crouched firing clip, so a crouched man borrowed the
  STANDING fire loop and popped up and down each time he shot. `fire_crouch` is now composed
  from the crouch pose (pelvis and legs) and the standing fire loop (torso, arms, head,
  weapon); its torso sits at 0.78 of standing height (crouch pose: 0.72).
- **To-and-fro jitter.** 45 of 87 measured alternations were a feedback loop: "in cover"
  was judged from a cover value that includes the stance bonus, so a prone man read as
  covered, was told to kneel, read as uncovered, was told to lie down, every think tick.
  Decisions now use `Game.positionCover` (position only). Clip switching is also
  rate-limited: fire/non-fire flips at most once a second, 0.5 s minimum hold otherwise,
  locomotion may start instantly only for commanded movement, and a walking man keeps his
  walk cycle through pauses shorter than 0.4 s. Attack-moving men stay halted 2.5 s after
  the last sighting instead of creeping forward every time a target blinks.
- Result: upright corpses 6/24 -> 0/26, A-B-A alternations 87 -> 20 (remaining ones are
  genuine stop-go of walking men), clip switches 0.106 -> 0.088 per second.

## Measured effect (tank-approach drill, 40 s, MG-armed tank driving through the position)

Columns: lane share (time inside the tank's path) · axis flee · max spin turns on the spot ·
max replans/s · max stance flips/s · survivors in cover at the end.

| case | lane | axis flee | spin | replans/s | flips/s | in cover |
|---|---|---|---|---|---|---|
| ai_open | 0.4 -> 0 | 0 -> 0 | 5.91 -> 1.01 | 1.03 -> 0.05 | 0.29 -> 0.33 | 0 -> 0 |
| ai_hedge | 0.2 -> 0 | 0 -> 0 | 2.83 -> 0.96 | 1.85 -> 0.03 | 0.26 -> 0.23 | 4 -> 3 |
| ai_atgun | 0.5 -> 0 | 0 -> 0 | 1.59 -> 1.03 | 0.15 -> 0.06 | 2 -> 0.15 | 0 -> 0 |
| player_open | 0.41 -> 0 | 0.19 -> 0 | 0.6 -> 0.14 | 0.06 -> 0.03 | 0.18 -> 0.1 | 0 -> 0 |
| player_hedge | 0.32 -> 0 | 0.12 -> 0.06 | 0.46 -> 0.14 | 0.06 -> 0.05 | 0.18 -> 0.13 | 4 -> 5 |

Gun: deployToggles 2 -> 0, net displacement 1.8 -> 0 u, final state retreat -> abandoned

`node scripts/tank-approach-test.mjs --assert` encodes the thresholds; `--dump <case>:<idx>`
prints a half-second timeline of one unit. Runs are deterministic up to the game clock phase.

## Regression status

Pass: smoke, tow-move/at47/approach/click/clutter/spawn, cavalry, directional-facing,
transport-movement, transport-boarding, battle-selector. Known failures that predate this
work (identical on HEAD): six `transport-clearance-test` cases, the
`four-shift-corners-with-boarders` waypoint case, and the Mokra contract test.

## Observed in full battles (scripts/observe-battle.mjs, Dyle attack, 120 s)

- Defenders' idle swivelling fell from 2-3.6 full turns per man (30+ heading reversals) to
  roughly 1.5 with under 15 reversals after the facing-goal damping; what remains is target
  switching by the fire module (a mortar or MG re-laying on the nearest of several attackers).
- Men no longer sit down to rest with a firefight sixty metres away (recent-combat gate in
  `uMod.ambient`; 4 resting instead of 12 at the two-minute mark).
- Still visible: attack-moving squads stop-engage-resume every couple of seconds, switching
  clips about 0.45 times per second; an assault-resume dwell would smooth that.

## Not done / next

- Infantry animation transitions for the new evade and go-to-ground states (crawl and prone
  clips exist; a dive-to-prone would sell the reaction).
- Tank-hunter ambush from cover is in, but AI infantry do not yet place mines or wait for
  the tank's flank deliberately.
- Panic bolt still picks a random direction; a bolt toward the nearest cover would be
  more believable.
- Vehicle-side realism (AI tanks halting at 95% of range, firing-position choice) was out of
  scope here.

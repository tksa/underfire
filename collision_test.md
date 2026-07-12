# Collision and Transport Test Guide

This document covers reproducible tests for vehicle collision/avoidance, transport
boarding, unloading, and movement-record diagnosis.

## Manual reproduction

1. Serve the repository with `python3 -m http.server 8741`.
2. Start the French mission.
3. Open the debug panel and enable **Record unit movement**.
4. Issue the movement, boarding, towing, or unloading order being investigated.
5. Let the interaction run for at least 10 seconds, then stop recording.
6. Save the downloaded JSON with a descriptive name such as `transport.json`.

Movement records contain one row per unit per frame. Important fields:

- `x`, `z`, `a`: world position and heading.
- `spd`: commanded/current movement speed.
- `dsp`: measured displacement speed.
- `mv`: unit has a movement order.
- `stop`: collision/yield stop timer.
- `det`: local vehicle detour is active.
- `rev`: vehicle is reversing.
- `st`, `clip`: infantry stance and active animation.
- `orderX`, `orderZ`, `orderA`: the unit pose when its latest movement order was issued.
- `clickX`, `clickZ`: the raw map position clicked by the player.
- `goalX`, `goalZ`: this unit's assigned formation slot for that click.
- `waypointX`, `waypointZ`, `finalX`, `finalZ`: current next waypoint and retained
  final destination; `orderId` changes whenever a new move command is issued.

Common signatures:

- `spd=0`, `dsp>0`: the unit is being pushed/slid rather than driven.
- `mv=1`, `spd=0`, `det=1`: vehicle has a route but its detour is deadlocked.
- `mv=1`, `spd≈0`, no suppression/order delay: group or column pacing may be zeroing speed.
- Path exhausted away from the requested point: A* ended at a tile centre and needs an exact final waypoint.
- Repeating `stop=0.2`: separation/yield is continuously hard-stopping the vehicle.

## Automated tests

The server must already be running on port 8741.

```bash
# Boarding variants (all run the real game update/path/collision modules)
node scripts/transport-boarding-test.mjs rest
node scripts/transport-boarding-test.mjs crowded
node scripts/transport-boarding-test.mjs moving
node scripts/transport-boarding-test.mjs cancel
node scripts/transport-boarding-test.mjs spawn
node scripts/transport-boarding-test.mjs spawn-second
node scripts/transport-boarding-test.mjs spawn-near
node scripts/transport-boarding-test.mjs spawn-far
node scripts/transport-boarding-test.mjs ten
node scripts/transport-boarding-test.mjs reboard
node scripts/transport-boarding-test.mjs unload-target

# Truck routes around parked tanks
node scripts/transport-movement-test.mjs

# Shift waypoints: ordered corners, recovery append, and reverse-to-forward handoff
node scripts/transport-waypoint-test.mjs

# Repeat all three Shift scenarios three times in one deterministic session
WAYPOINT_REPEATS=3 node scripts/transport-waypoint-test.mjs

# Full-width, independently audited truck/tank clearance suite
node scripts/transport-clearance-test.mjs

# Sustained run (55 routes; eleven geometries repeated five times)
CLEARANCE_REPEATS=5 node scripts/transport-clearance-test.mjs

# Strict smoothness regression: tank directly ahead, destination behind it
SMOOTH_REPEATS=3 node scripts/transport-smoothness-test.mjs

# Focus the closest head-on setup while iterating
SMOOTH_CASE=tank-ahead-close SMOOTH_REPEATS=3 node scripts/transport-smoothness-test.mjs
```

A non-zero exit code is a failure. Boarding spawn modes enforce a 60-second
simulated-time limit. The movement suite fails a route that does not arrive or
remains stopped with a live path for more than five seconds. The clearance suite
uses its own oriented-rectangle SAT implementation (separate from production
collision code), interpolates the full swept pose between simulation ticks, and
fails on any hull penetration, unsafe planned segment, prolonged stall, excessive
route length, incorrect gate choice, or post-arrival drift/turn.
The smoothness suite repeats eleven head-on/rotated/offset/queued geometries at three
sub-tile placements. It independently sweeps both oriented hulls and also fails
on abrupt per-frame motion, excessive acceleration or jerk, steering/yaw chatter,
stop-start cycles, repeated reversals, stalls, excessive route length, or failure
to arrive and remain stopped.
The `moving` boarding case keeps the queued infantry and their transport in one
selection, issues a real ground command to the truck, and verifies that the truck
travels and settles while every soldier retains the carrier assignment and boards
the live tailgate. It does not teleport the transport.
The waypoint suite verifies that an initial move plus three Shift clicks is consumed
in exact order, including with pending passengers. Separate cases add Shift stops
during tank-avoidance recovery and during a player-requested reverse, and reject
lost/reordered stops, misses outside the truck capture radius, excessive detours,
an abrupt speed change, or a reverse that fails to hand back to the forward route.
It also forces an early stuck replan and a no-route Shift click during recovery;
both must leave the previously accepted waypoint sequence intact.

## Collision test scenarios

For manual vehicle tests, cover all of these:

1. Head-on approach to a parked light tank.
   Place the tank directly in front of the transport, then order the transport to
   a point behind the tank so the straight route is physically blocked.
2. Offset approach crossing from left to right.
3. Mirrored offset approach crossing from right to left.
4. Close obstacle requiring the truck to reverse before correcting its turn.
5. Two friendly vehicles moving in the same direction (column following).
6. A moving tank crossing the truck's projected path.
7. Truck towing an AT gun through the same maneuvers.

Verify that the truck:

- never translates sideways while reporting zero wheel speed;
- does not overlap the tank hull;
- retains the player's final destination during avoidance;
- reverses along its own axis when it needs steering room;
- resumes forward movement after the reverse correction;
- eventually clears its detour and reaches the destination.

## Transport interaction scenarios

1. Select resting infantry and click/right-click the truck.
2. Board 10 soldiers from the untouched mission spawn.
3. Board a tightly crowded group.
4. Move the truck while infantry are queued.
5. Unload and reboard the same 10 soldiers.
6. Press **Unload**, choose a distant map position, and verify all 10 exit from
   the tailgate and reach their individual formation slots.

## Issues fixed

- Transport trucks were classified as infantry in movement, separation,
  pathfinding, formation spacing, and terrain-height handling.
- Separation pushed stationary trucks sideways with `currentSpeed=0`.
- Random spawn heading placed tailgates against the fuel/AT cluster.
- Boarding A* paths stopped at tile centres instead of the exact tailgate.
- Resting infantry had a zero movement multiplier after receiving a board order.
- Eight infantry shared too few approach points and deadlocked each other.
- Boarding now uses a distance-sorted, staggered queue with stalled-head rotation.
- A move command shared by a transport and its pending passengers now moves only
  the truck; the infantry retain their carrier-relative order and keep pursuing
  its live tailgate. A move issued to the infantry alone still cancels boarding.
- Left-clicking a transport whose selected soldiers are already queued now selects
  the truck instead of redundantly issuing the same enter order again.
- Column-follow pacing no longer zeroes the speed of boarding/unloading groups.
- Embarked passengers no longer behave as world collision obstacles.
- Assigned carriers are excluded from their passenger's final entry collision.
- Trucks keep their destination after repeated collision replans.
- Truck detours retain steering authority instead of being hard-stopped.
- Long-wheelbase trucks use wider tank-avoidance waypoints.
- A blocked truck can reverse to create steering room, then rebuild its original route.
- Close turns are dry-run with the same bicycle steering model before motion, so
  a required reverse happens deliberately rather than after a collision stop.
- Truck steering is rate-limited, follows a look-ahead point through corners, and
  retires a missed waypoint after crossing its outgoing gate instead of orbiting it.
- Final truck approaches latch into smooth braking once inside the destination
  capture circle, preventing a pointless turn or circle after reaching the order.
- Shift-queued truck legs are planned from the preceding leg's arrival heading,
  and reverse recovery preserves every queued destination instead of skipping ahead.
- Player-added truck waypoints are protected from generated-path shortcutting and
  must enter a 2.25-unit capture radius in order. Waypoints added during a reverse
  are appended to the saved recovery route and remain after forward travel resumes.
- A truck's first two stuck replans rebuild the full remaining Shift sequence rather
  than jumping to the last click. Reverse legs ignore forward pure-pursuit lookahead,
  then hand off to queued forward travel instead of circling the reverse checkpoint.
- Shift clicks added during reverse recovery are path-validated before the saved
  route is changed. An unreachable click is rejected without deleting valid stops.
- Player-reverse braking uses that checkpoint's real arrival radius and completes
  below 0.08 speed before forward waypoints resume, avoiding a visible speed snap.
- Vehicle collision and yielding now use per-model oriented rectangles instead of
  centre circles/three centreline samples; rotating corners are swept continuously.
- Vehicle A* stores arrival heading, checks the complete hull width on every edge,
  includes parked vehicle footprints, and never returns a partial route as success.
- Route smoothing validates the full swept-width corridor and keeps a 0.20-unit
  stand-off, while still accepting openings that the real body can fit through.
- Parked vehicles are included in the command-time full-width A* search. Trucks
  retain that curvature-aware route while moving, so a straight-chord detector
  cannot overwrite a safe committed turn; live-traffic yield and swept collision
  recovery still handle a scene that changes after the order.
- Vehicle path debug rendering shows the centreline, both physical-width edges,
  and exact collision outlines for trucks as well as tanks.
- Procedural German vehicles use model-specific collision dimensions rather than
  inheriting the larger French/modelled hull sizes.
- A limbered AT gun contributes its own rigid trailer rectangle to terrain,
  pathfinding, prediction, and swept vehicle collision checks.
- Unload orders append exact formation destinations and temporarily bypass
  column pacing until every soldier arrives.

## Known limitations

- The Renault source GLB is a single fused mesh. Cargo/crates cannot be cleanly
  hidden as named nodes; destructive runtime triangle cuts must not be used.
- Seat and hitch offsets are model-specific and may need adjustment if the GLB is replaced.
- Dense alleys with both detour sides blocked by structures can still require an
  A* re-route rather than a local steering maneuver.

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
node scripts/transport-boarding-test.mjs spawn
node scripts/transport-boarding-test.mjs spawn-second
node scripts/transport-boarding-test.mjs spawn-near
node scripts/transport-boarding-test.mjs spawn-far
node scripts/transport-boarding-test.mjs ten
node scripts/transport-boarding-test.mjs reboard
node scripts/transport-boarding-test.mjs unload-target

# Truck routes around parked tanks
node scripts/transport-movement-test.mjs
```

A non-zero exit code is a failure. Boarding spawn modes enforce a 60-second
simulated-time limit. The movement suite fails a route that does not arrive or
remains stopped with a live path for more than five seconds.

## Collision test scenarios

For manual vehicle tests, cover all of these:

1. Head-on approach to a parked light tank.
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
- Column-follow pacing no longer zeroes the speed of boarding/unloading groups.
- Embarked passengers no longer behave as world collision obstacles.
- Assigned carriers are excluded from their passenger's final entry collision.
- Trucks keep their destination after repeated collision replans.
- Truck detours retain steering authority instead of being hard-stopped.
- Long-wheelbase trucks use wider tank-avoidance waypoints.
- A blocked truck can reverse to create steering room, then rebuild its original route.
- Unload orders append exact formation destinations and temporarily bypass
  column pacing until every soldier arrives.

## Known limitations

- The Renault source GLB is a single fused mesh. Cargo/crates cannot be cleanly
  hidden as named nodes; destructive runtime triangle cuts must not be used.
- Seat and hitch offsets are model-specific and may need adjustment if the GLB is replaced.
- Dense alleys with both detour sides blocked by structures can still require an
  A* re-route rather than a local steering maneuver.

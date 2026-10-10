# Attack-move performance audit

## Follow-up audit (7 October 2026)

The current pass preserves model, texture, animation and effect appearance.
Reports and test logs are in `tmp/performance-2026-10/`.

- **Collision prediction:** Mokra's 130-unit final-wave sample spent about
  2.9 ms per frame in `applySeparation`, within 6.4 ms of movement work. Vehicle
  pairs previously constructed and tested up to seven pairs of oriented boxes,
  including parked vehicles and vehicles far beyond their prediction horizon.
  Parked pairs now leave that advisory yield check early; the existing swept
  movement gate still enforces their physical collision. A conservative bound
  from hull diagonals, speed, clearance and the full 1.5-second prediction
  horizon rejects distant moving pairs before detailed testing. Infantry hull
  contact also rejects points outside the expanded hull's bounding circle.
  `collision-performance.mjs` verifies identical results against release
  `3c238a7` in 20,000 seeded movement/contact cases. A 48-vehicle spread-out
  sample eliminates 1,722,240 detailed OBB tests over 120 frames. This is a
  component workload, not a whole-game FPS claim.
- **Smoke and flash lifetime:** every expired effect disposed Three.js's shared
  sprite geometry and its own material. Effects now reuse independent sprite
  materials, with idle pools capped at 256 smoke and 128 flash sprites. Visible
  effect counts, tint, fade curves, scale and blending are unchanged. The
  100-burst resource test drops sprite/material creations from 6,400 to 64;
  shared-geometry disposal drops to zero. Overflow disposes only its material.
- **No duplicated loaders found:** the Dyle audit found no repeated script URLs
  or duplicate model requests. Its 182 referenced textures use 152 sources;
  shared sources are expected, not evidence of duplicate downloads. The RGBA
  estimate remains 659.9 MiB and must not be reported as measured VRAM.
- **Animation regression found during verification:** short traffic stops
  reset locomotion immediately, letting aim/crouch poses interrupt the existing
  brief-pause clip hold. The selector now retains locomotion through up to
  0.7 seconds of a commanded movement pause; stride playback still stops with
  actual ground speed. The focused locomotion suite passes 122 checks, including
  repeated crouched pauses with a target present. The full animation audit also
  passes after this correction.

Final Dyle native sample on Apple M4 Max / ANGLE Metal, 1280×800, DPR 1:
480 rendered frames averaged **10.40 ms (96.2 FPS)**, with **16.8 ms p95**;
attack-move dispatch took **2.7 ms**. Rendering submitted 1,480 calls and
2.38 million triangles across all passes. This is an observed short-run result,
not a guaranteed frame rate or a controlled FPS improvement percentage. Earlier
and later battle states differ because loading and random effect creation can
change simulation timing. The unchanged-algorithm collision comparison and
effect resource counts isolate the specific optimizations more reliably.

Remaining opportunities, in priority order:

1. Profile and stage cold shader compilation/texture uploads before play. The
   first isolated render varied from 459 ms to 5.14 seconds, while subsequent
   rendered samples were much smoother. Loading/shader-cache state makes these
   cold numbers unsuitable as an optimization speedup comparison.
2. Audit compression and mip chains for the remaining 2048px model maps and
   4096px terrain map. Preserve authored color/normal detail; validate actual GPU
   allocations and screenshots before changing asset formats or resolution.
3. Reduce static-scene submissions without changing visibility or silhouette.
   The Dyle sample submitted roughly 1,500 calls and 2.38 million triangles
   across all render passes. Profile shadows separately before merging meshes.
4. Continue moving synchronous recovery/cover routes onto the existing bounded
   route queue. The main attack-move dispatch is already small, but individual
   route searches still produce occasional spikes in larger battles.

`mokra-performance-profile.mjs` now reports individual `uMod` stages, separation,
crew animation and smoke alongside whole-unit timing. Parent and child timings
are inclusive and must not be added together. Run native GPU profiles alone;
asynchronous asset completion and frame-budgeted routing can vary the later
simulation even when map generation is seeded.

Measured locally on 11 September 2026, using the default Dyle battle (76 units).
The reproducible audit is `scripts/attack-move-performance.mjs`. It records CPU
costs, loaded resources, duplicate requests, scene submission counts and optional
native GPU frame intervals. Run browser tests and profiles individually.

## Findings and changes

- Mass orders ran complete A* searches in the input handler and route queue.
  The baseline order took 270 ms; a queued search occupied 737 ms of one frame.
  Orders now enqueue large infantry selections as well as vehicles. A* expansion
  and path smoothing yield; the queue works toward a 3 ms frame budget, sharing
  it between units. Full body clearance, ordered stops and route cancellation
  remain authoritative. No partial search result is installed as a route.
- World-wide hedge/tree instance batches drew distant geometry whenever any
  part of the batch was visible. Foliage now uses 48-unit spatial batches;
  undergrowth uses 32-unit batches, and fluffy grass uses eight-tile batches.
  Bounds include wind and knockdown motion. Every tree/hedge placement remains,
  including its instance-specific tank knockdown record.
- Field cover previously allowed 600,000 blades per species on ordinary maps.
  A combined 240,000-instance budget now includes the legacy undergrowth;
  Mokra retains its existing 140,000 combined limit. Editable density and brush
  masks remain intact. Small grass receives shadows without casting its own.
- The default baked terrain uploaded an 8192-square texture: approximately
  341 MiB as RGBA plus mipmaps. Its GPU copy is now at most 4096 square (85 MiB).
  The full-resolution source stays available for map edits and export; region
  edits refresh the same display texture. Source model atlases remain intact.
- Each infantry clone retained meshes for every possible weapon. Inactive
  equipment is removed from each spawned figure, while the cached source keeps
  all roles. Materials are reused within one figure, with independent clones
  between units. The measured scene dropped from 5,809 to 742 material objects.
  Skeletons, animation clips, real muzzle sockets and animated visibility rules
  are preserved. Wreck tinting visits each material once.
- Entry and towing hints performed two identical unit-mesh raycasts per frame.
  They now share one pick; a stationary cursor caches it for 80 ms. Camera,
  cursor, selection and command-mode changes invalidate the cache. Clicks still
  perform fresh picks. Hidden/dead unit roots are rejected before raycasting,
  and unchanged garrison labels do not rebuild their DOM.
- High-density displays multiplied all HDR and postprocessing targets by four.
  The 3D buffer now uses at most 1.5 device pixels per CSS pixel and a three-million
  pixel budget, recalculated on resize. DOM text stays at native resolution.
  Two-sample MSAA plus SMAA replaces four-sample MSAA plus SMAA.
- No duplicate script tags or model downloads appeared in the baseline audit.
  There is one gameplay animation-frame loop; the other frame callbacks are
  one-shot setup/capture helpers. The audit adds no runtime profiling loop.

- Direct-fire trails now share one instanced ribbon batch (256 visual slots),
  with no per-shot geometry/material allocations. Ordinary rounds are often
  invisible or faint; occasional warm glints have varied brightness and short
  world-space lengths. Mortars preserve real shell flight time and arcs. Visual
  overflow never skips terrain impacts, and presentation randomness has its own
  generator so it cannot change combat accuracy rolls.
- The command panel reuses card DOM nodes while health/ammo change. Unit-type
  silhouettes are inline vectors, without an extra renderer, loop or textures.
  Conflicting legacy letter-key actions now require Shift for their secondary
  meaning; F/Q/N cannot silently trigger first aid/garrison/entrench as well.

## Measurement method

```sh
node scripts/attack-move-performance.mjs tmp/performance/report.json
PROFILE_GPU=metal PROFILE_RENDER_FRAMES=240 node scripts/attack-move-performance.mjs tmp/performance/native.json
PROFILE_GPU=metal PROFILE_DPR=2 PROFILE_RENDER_FRAMES=240 node scripts/attack-move-performance.mjs tmp/performance/retina.json
```

The CPU phases step the game at 30 Hz with rendering disabled. Each reports
mean, 95th percentile and maximum frame cost. These numbers are not FPS. A
separate render records geometry across all passes, including shadows. Native
frame sampling restores uninstrumented functions and includes actual rendering,
with ten warm-up frames. The profiler reports the GPU backend; SwiftShader frame
rates must not be presented as native hardware performance.

Texture estimates sum uncompressed RGBA plus mipmaps for referenced texture
objects. Sources and samplers may share GPU allocations, so this is a resource
estimate, not a measurement of actual VRAM use. Seeded initialization makes the
battle repeatable, but asynchronous loading and time-budgeted searches can
change the precise later simulation state. Compare the same viewport/backend.

## Limits

The queue budget is cooperative: one expansion/smoothing segment can overrun
it. Small immediate routes, Shift-appended legs and compound truck recovery
still have synchronous callers. Cold shader compilation, texture uploads and
garbage collection can cause occasional stalls; the optimization does not
promise a locked frame rate on every map or GPU. Geometry reduction is mainly
from scenery culling and grass density, not removing units or their animations.

## Regression coverage

`performance-regression-test.mjs` checks terrain source/display ownership,
texture refresh, vegetation budgets, knockdown references, issued equipment,
animation visibility, cursor picking, high-density buffer limits and queued
route completion/cancellation/obstacle clearance. The existing transport,
tactical, weapon and animation tests cover gameplay behavior.

Scenery uses 48-unit instance chunks, a cap of 84 farm props and textures of
512px or smaller. Contact debris shares a single bounded 128-instance mesh.

The rejected faction palette/noise shader was removed during visual recovery;
authored texture detail now remains intact with a bounded exposure correction.

## Verified recovery run (11 September 2026)

`tmp/performance/recovery-native.json`, run alone on Apple M4 Max / ANGLE Metal,
1280×800, DPR 1, with all farm/building/fence models loaded:

| Measurement | Result |
|---|---:|
| Attack-move order dispatch | 2.8 ms |
| 240 rendered frames, mean interval | 10.28 ms |
| 95th-percentile frame interval | 17.1 ms |
| Sample average frame rate | 97.3 FPS |
| Estimated referenced textures | 659.9 MiB |
| Submitted triangles, all passes | 2.38 million |
| Duplicate script URLs / runtime errors | 0 / 0 |

This is a short controlled sample, not a guaranteed frame rate. The first
uncached render submitted in 489 ms, so cold uploads/compilation remain a stall
source even when the subsequent battle sample is smooth.

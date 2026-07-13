# Mokra performance investigation

This document records the v0.13 Mokra freeze investigation, the baseline evidence gathered during the audit, the mitigations now present in the working tree, and the remaining performance work. The measurements below are headless or static instrumentation results; they are not production GPU frame-rate measurements.

## Baseline evidence

| Area | Observed baseline |
| --- | --- |
| Reinforcement waves | The synchronous spawn-and-route path stalled for about **5.03 s**, **3.25 s**, and **1.40 s** at the first, second, and final timed wave commits respectively. |
| Unit targeting and sight | In a controlled five-frame, 121-unit sample, the core frames took about **153 ms total** (**30.7 ms/frame**). `nearestEnemy` ran 737 times for about 92 ms cumulative; LOS ran 25,410 evaluations for about 71 ms cumulative. These timings are inclusive/nested and must not be added on top of the 153 ms total. |
| Grass | The old Mokra terrain configuration produced about **636,700 grass blades** across legacy undergrowth and fluffy grass. |
| Craters | The terrain contains **66,049 vertices**. Every old crater impact scanned the full geometry and ran a full `computeVertexNormals`; several impacts could do this in one frame. |
| Tracks | A stress/wave audit found more than **1,000 track-mark groups**, representing more than **2,000 tread meshes**, under the old 15-second, two-mesh-per-mark design. |
| Fog of war | A 300 x 300 map at `FOG_RES = 2` uses a 600 x 600, **360,000-cell** Float32 visibility grid. The old 0.12-second update swept the full grid and recreated a 256 x 256 `ImageData`, temporary canvas, and context before the 65,536-pixel render pass. |
| Audio | v0.12 created 216 `HTMLAudioElement`s for 56 URLs. The v0.13 baseline created **520 elements for 132 URLs**. Seventy-five active Polish voice files alone became 300 elements at pool size four. Unique compressed audio was about 3.733 MiB, with worst-case element-weighted fetch exposure about 14.412 MiB and a decoded Float32 upper bound about 54.195 MiB. |
| Movement recorder | When enabled, the old recorder stored every living unit on every frame, capped at 400,000 records by repeatedly shifting 8,000 entries from the front. Stopping it then stringified and downloaded the large JSON capture. When disabled, it only incurred its null guard. |

The five-frame targeting/LOS figures came from static/headless instrumentation performed during this audit, not from `scripts/mokra-performance-profile.mjs`. The audio audit found startup allocation pressure, not a per-command listener or timer leak.

## Post-fix headless verification

The final integrated three-second-per-phase sampler (rendering disabled) produced the following results:

| Check | Result |
| --- | --- |
| Timed wave commit | About **3.9 ms**, **4.3 ms**, and **3.0 ms**, down from 5.03 s, 3.25 s, and 1.40 s. |
| Authored armour routes | All **14/14** vehicles routed; zero lane fallbacks, route failures, or empty infantry/support paths. |
| In-motion vehicle recovery | One recovery was exercised in **0.3 ms** with no failure. The same generic recovery had taken about 966 ms before it was moved onto the authored corridor. |
| Remaining `findPath` work | Infantry/support only in the sample, with a **3.9 ms** maximum call. All 52 queued routes completed. |
| Grass | 139,970 combined blades across 72 chunks, within the 140,000 budget (about 78% below the old allocation). |
| Tracks | Peak held at the 240-mark cap; overflow retired instead of accumulating. |
| Audio | 17 pooled sources and 72 elements at startup; one event voice raised this to 18 sources/74 elements. |
| Peak-force simulation | At 121 living units, `updateUnit` averaged about **4.67 ms per sampled loop**; target acquisition averaged about **0.08 ms per loop**. No browser long-task entry was reported. |

The full nonvisual Mokra mission contract and the default Dyle smoke test passed. Targeted isolated checks also passed for fog-reset cache safety, recorder ring chronology, local crater deformation/bounds, hidden-track cap priority, and deferred-track fading. These are software-rendered/headless CPU results, not a promise of production GPU frame rate.

## Implemented mitigations

These changes remove or bound the identified worst cases. They still require browser and real-hardware validation; their presence is not itself proof of a particular post-fix frame rate.

### Reinforcement routing

- Mokra vehicles use parallel authored field corridors south of Mokra II's asynchronously sealed building footprints. Each segment is checked for full-footprint clearance, while connectors and final fan-out remain individualized.
- Wave spawning no longer runs full heading-state vehicle A* synchronously for every new vehicle.
- Tagged German armour also reuses the forward or reversed authored corridor for AI repositioning and stuck/blocker recovery, rather than launching a late 80,000-state vehicle search.
- Infantry and support routes enter a queue, and Mokra dispatches at most one A* job per update frame.
- `Game._mokraRouteStats` records authored routes, recoveries, lane/recovery failures, infantry queue/routing failures, and maximum queue depth.

### Targeting, LOS, and lookup work

- Unforced target acquisition is staggered over roughly 0.14-0.20 seconds by unit ID, retaining a valid cached target between scans.
- Squad AI reuses cached unit sightings instead of repeating nearest-enemy work for each member.
- LOS performs a squared-distance range rejection before tile walking.
- Unit ID lookup uses a map index, and officer lists are cached per team for 0.35 seconds.
- Firing still validates relevant current-frame LOS; the throttling applies to acquisition scans.

### Grass and foliage

- Mokra has a combined **140,000-blade** budget for legacy undergrowth and fluffy grass, down from the roughly 636,700-blade baseline.
- Eligible tiles are counted before construction and density is scaled to the budget.
- Grass is split into 16-tile spatial chunks so frustum culling can reject off-screen chunks.
- Rebuilds dispose instance-owned buffers/materials and clear stale mesh references.
- Tank foliage knockdown uses 8-unit spatial cells, checks nearby buckets at 10 Hz, and keeps an active list only for foliage that is currently falling.
- Grass remains enabled by default. `Game._fluffStats` exposes the actual budget, counts, chunks, and species breakdown.

### Tracks and craters

- Track marks are capped at 240 and live for at most eight seconds. Overflow is disposed, and unseen enemy tracks defer GPU allocation unless they become visible before expiry.
- Both treads are stored in one geometry and one mesh instead of a group containing two meshes.
- Crater impacts enter a bounded 48-item queue, nearby queued impacts are merged, and deformation is batched every 0.35 seconds.
- A crater batch touches local terrain windows and runs `computeVertexNormals` once after the batch, rather than once per impact.
- `Game._trackPerf` and `Game._craterPerf` expose drop, peak, queue, and batching information.

### Main loop, fog, and animation

- Fog updates run at 5 Hz, reuse `ImageData` and the blur canvas/context, and decay only the cells visible in the preceding update except when a debug-mode transition requires a reset.
- Camouflage runs at 4 Hz, the HUD at 10 Hz, and the minimap at 8 Hz instead of all three running every animation frame.
- Dead skeletal mixers stop after the death animation. Fog-hidden and off-map enemy units skip animation mixer/bone updates.

### Audio and movement recording

- Audio startup eagerly creates only the battlefield sounds, four utility sounds, and four loops. Command voice pools are created on first use and contain two elements instead of four.
- Immediately after `Game.Audio.init()`, before any voice is heard, the current design has 17 pooled sources and 72 audio elements. Each newly heard unique voice adds one source and two elements. `Game.Audio.resourceStats` reports the live counts.
- The movement recorder samples at 15 Hz into a 240,000-record circular buffer, avoiding repeated front-of-array shifts. At 121 living units this is about 1,815 records/second and fills in about 132 seconds.
- Recording remains intentionally expensive and should stay disabled during performance sampling.

## Running the Mokra profiler

The sampler requires Playwright's Chromium and a local static server:

```sh
python3 -m http.server 8741
```

In another terminal:

```sh
node scripts/mokra-performance-profile.mjs
```

Useful options:

```sh
PROFILE_MS=8000 node scripts/mokra-performance-profile.mjs
SMOKE_URL=http://localhost:8741 node scripts/mokra-performance-profile.mjs
PROFILE_RENDER=1 node scripts/mokra-performance-profile.mjs
```

The default five-second samples disable `Game.renderScene` because headless Chromium normally uses SwiftShader, whose software-rendering load can drown out simulation timings. The script samples the opening and the three timed wave thresholds, and prints JSON containing:

- JavaScript/console errors plus a count of optional missing-resource warnings;
- wrapped-function call count, cumulative time, mean, and maximum;
- animation-frame gap count, mean, p95, maximum, and count over 50 ms;
- long-task count/maximum, JS heap, and browser task duration;
- unit/effect counts, terrain vertices, and audio resource counts.

`PROFILE_RENDER=1` includes the render path for comparative smoke checks. Its headless frame time/FPS must not be presented as production GPU performance. This script is a nonvisual profiler, not a gameplay or visual-correctness test, and the movement recorder should remain off while it runs.

The profiler exits nonzero for real page errors, route/recovery failures, an undrained route queue, grass/track/audio budget violations, or any Mokra wave/path call exceeding 50 ms. Optional missing model/texture warnings are counted separately because the game already has procedural fallbacks for those assets.

## Built-in counters

Inspect these in the browser console during a Mokra run:

```js
Game._mokraRouteStats
Game._fluffStats
Game._trackPerf
Game._craterPerf
Game.Audio.resourceStats
Game.trackMarks?.length
Game._craterQueue?.length
```

The counters are cumulative from the relevant scenario construction/rebuild or page load. Reload the page to begin a clean comparison. `Game._perfProfile` exists only while the external sampler is running.

## Remaining work

- Validate authored vehicle corridors against all reinforcement compositions. For larger arbitrary waves, consider hierarchical, flow-field, or shared routes and a hard per-frame routing time budget.
- Spatially partition enemy candidates and consider cell/pair LOS caching. Move route calculation to workers or asynchronous jobs where the architecture permits.
- Replace the remaining full `computeVertexNormals` crater batch with partial normal updates or shader/decal displacement, and reduce or defer terrain attribute uploads.
- Batch or instance track decals, share geometry/materials, or use an atlas/ring buffer to reduce the remaining maximum of 240 track drawables.
- Reduce the remaining 65,536-pixel fog canvas pass/texture upload with dirty regions, a lower-resolution path, or worker/offscreen processing.
- Consider a fixed small voice-channel pool, selected-faction-only preload, and explicit audio teardown disposal.
- Use HUD state signatures to avoid rebuilding unchanged markup even at 10 Hz, and throttle animation when the page/menu is hidden.
- For long recorder captures, use chunked/typed storage and revoke the download Blob URL after export.
- Confirm results in a hardware-accelerated browser with Chrome Performance, Memory, and WebGL tooling. Use user-supplied screenshots for visual validation.

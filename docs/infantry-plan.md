# Infantry: Low-Poly 3D Models + Reactive AI

A design + implementation plan for infantry as **simple animated 3D units with
believable behavior** (not character-sim). Targets a Sudden Strike-style oblique
camera, where the priorities are: clear silhouette, readable stance
(stand / crouch / prone), convincing movement, believable reactions under fire,
and good performance with many units.

This doc is split into:
1. **Current state** — what already exists in this repo (honest audit)
2. **What you need to provide** — assets I cannot generate here (rigged GLB + clips)
3. **What I can build in-engine** — the code roadmap, mapped to our files
4. **Model spec** — proportions / rig / poly budget for the artist (or Blender)
5. **Phased plan** — adapted to this codebase

---

## 1. Current state in this codebase

| System | Status | Where |
|--------|--------|-------|
| Procedural soldier mesh (boxes: legs, torso, arms, helmet, rifle) | ✅ Done (Phase 1 placeholder) | `units.js _createUnitMesh` |
| Per-role model variants (rifle/SMG/MG/officer/medic/sniper) | ✅ Basic, in-engine | `units.js _createUnitMesh` |
| Stances stand / crouch / prone / run | ✅ Movement + visuals | `main.js` (speed), `renderer.js` (crouch squash, prone tilt, run lean) |
| Stance cycle (C) + Crawl button + run toggle (S) | ✅ Done | `input.js`, `index.html` |
| Movement, health/HP states, death (body left on field) | ✅ Done | `main.js updateUnit`, `combat.js` |
| Suppression: accumulation, decay, auto-crouch/prone thresholds | ✅ Done (Phase 3 core) | `main.js updateUnit`, `combat.js applyShot` |
| Cover — **tile-based passive** (grass/hedge/wall/house cover values) | ⚠️ Partial | `pathfinding.js computeCover` + tile defs in `terrain.js` |
| Cover — **points + scoring + seek-cover behavior** | ❌ Missing (Phase 4) | — |
| Enemy AI — move-to-enemy / patrol / hold | ⚠️ Very simple | `ai.js updateAI` |
| AI — FSM (idle/engage/suppressed/seek-cover/pinned/retreat) | ❌ Missing (Phase 4/5) | — |
| Squad spawn (grouped units, doctrinal rosters) | ✅ Spawn only | `mission.js spawnSquad` |
| Squad AI (shared knowledge, role assignment, spacing) | ❌ Missing (Phase 5) | — |
| GLB load path (per-kind model, mixer/animation setup) | ✅ Infrastructure ready | `units.js _loadUnitModel` (loads `models/<kind>.glb`, builds `AnimationMixer`) |
| Animation clips actually played / stance→clip mapping | ❌ Missing | — |
| LOD / billboards / AI update throttling for far units | ❌ Missing (Phase 6) | — |
| Command delay, personality variation | ⚠️ Command delay done; personality not | `input.js commandDelay` |

**Takeaway:** Phases 1 and 3 are largely done. The biggest gaps are (a) real
animated GLB models + a stance→clip animator, (b) a cover-point system with
seek-cover behavior, (c) an FSM/squad AI layer, and (d) LOD/perf for scale.

---

## 2. What you need to provide (assets I can't generate here)

Rigged, animated models require Blender (or an artist / asset pack) — they
can't be authored in this environment. Provide these and the engine will use them.

### 2.1 Models — `models/<kind>.glb`
One shared rig, equipment swaps per type. The loader already looks for
`models/<unit.kind>.glb` (e.g. `fusilier.glb`, `grenadier.glb`, `smg.glb`,
`fm24.glb`, `mg34.glb`, `sniper.glb`, `officer.glb`, `medic.glb`). A single
`rifleman.glb` reused for all riflemen is fine to start.

```
rifleman.glb
  Mesh:     body, helmet, backpack, rifle
  Skeleton: pelvis, spine, head, upper_arm_l/r, lower_arm_l/r,
            hand_l/r, upper_leg_l/r, lower_leg_l/r, foot_l/r
  Anims:    idle, walk, run, crouch_idle, crouch_walk, prone_idle,
            crawl, fire_stand, fire_crouch, fire_prone, reload, death_1, death_2
```

### 2.2 Animation clips (named exactly as above)
Short loopable clips; 8–16 keyframes each is plenty for an RTS camera. The
engine maps stance + state → clip name (see §3.3).

### 2.3 Textures
- 512×512 atlas per unit class (1024 only for hero/close units).
- Paint pockets, straps, wrinkles, boots **into the texture** — not geometry.
- Provide tint variants or a tintable base for squad variety.

### 2.4 Poly budget
- Close LOD: 800–1500 tris · Mid LOD: 300–600 · Far LOD: 50–150 or billboard.

> If you can only provide one thing first, make it **`rifleman.glb` with
> idle / walk / fire_stand / death**. That alone is a massive visual upgrade and
> drops straight into the existing loader.

---

## 3. What I can build in-engine (code roadmap)

### 3.1 Animator (`InfantryAnimator`) — when GLB clips arrive
`_loadUnitModel` already builds `mesh.userData.mixer` and stores
`mesh.userData.animations`. Needed: a small controller per soldier that
play/crossfades clips and is ticked from `Game.syncUnitMeshes`.

```js
class InfantryAnimator {
  constructor(mixer, clips) { ... }   // index clips by name
  play(name) { ... }                  // set active action
  crossFadeTo(name, dur) { ... }      // smooth blend
  update(dt) { this.mixer.update(dt) }
}
```
Crossfades: idle→walk 0.15s, walk→run 0.15s, stand→crouch 0.20s,
crouch→prone 0.25s, any→death 0.05s.

### 3.2 Stance → clip mapping (drives the animator from existing state)
We already track `unit.stance` (`stand|crouch|prone|run`) and `unit.moving` /
`unit.cooldownLeft`. Map:

```
stand + idle            -> idle
stand + moving          -> walk
run   + moving          -> run
crouch + idle           -> crouch_idle
crouch + moving         -> crouch_walk
prone + idle            -> prone_idle
prone + moving          -> crawl
firing (any stance)     -> fire_<stance>
dead                    -> death_1 / death_2
```

### 3.3 Cover system (Phase 4) — biggest behavior win
- Tag cover objects (walls, hedges, buildings, wrecks, craters) with
  `{ height, blocksBullets, blocksVision }`.
- Generate `CoverPoint`s around them (start with manual points if auto-gen is hard).
- Score points vs. threat: blocks LoF (×100) + faces threat + close + unoccupied
  − occupied − path cost.
- Visibility/cover checks via `THREE.Raycaster` (enemy eye → soldier/cover point).

### 3.4 FSM AI (Phase 4/5) — replaces the one-liner in `ai.js`
States: `Idle, MoveToOrder, EngageEnemy, Suppressed, SeekCover, InCover,
PronePinned, Retreat, Dead`. Each soldier gets a blackboard
(`enemyVisible, knownEnemyPos, threatDir, incomingFire, suppression, morale,
health, ammo, nearestCover, stance`).

### 3.5 Suppression-driven reactions (Phase 3 — mostly done, refine)
Already: suppression rises on hits, decays, forces crouch (>62) / prone (>88).
To add: react to **near-misses** (not just hits) — when a tracer passes within
N metres, add suppression + store threat direction. Thresholds:
- 0–25 continue · 25–50 crouch + return fire · 50–75 seek cover · 75–100 prone/pinned.

### 3.6 Personality variation (cheap, high payoff)
`{ courage, discipline, aggression }` per soldier;
`effectiveSuppression = suppression / courage`. Brave troops hold and fire;
panicky ones hit the dirt. One multiplier ≈ visible variety.

### 3.7 LOD + perf (Phase 6)
`THREE.LOD`: 0–40u animated, 40–90u cheap mesh, 90u+ billboard/static.
Throttle AI: near 0.1–0.2s, mid 0.5s, far 1.0s. `InstancedMesh` for dead bodies
/ helmets / far dots only — keep close animated soldiers as cloned skinned meshes
(use `SkeletonUtils.clone()`, not plain clone, for rigged GLB).

---

## 4. Model spec for the artist / Blender (basic)

Build to the proportions of the current in-engine placeholder so swaps line up
(local **+Z = forward**, feet at y=0, ~1.0–1.1u tall):

```
legs      : 2 boxes, ~0.10w x 0.32h, slightly apart, boots at base
torso     : ~0.30w x 0.36h x 0.18d, belt at hips
arms      : angled forward onto the weapon
head      : small sphere at ~0.85h, skin tone
helmet    : hemisphere + thin brim (officer: peaked cap; no brim)
weapon    : held diagonally, pointing +Z; oversize slightly so it reads from above
backpack  : box behind torso
```
Keep hands minimal, helmet simple, silhouette strong. Different helmet /
backpack / head + tint = variety from one rig.

---

## 5. Phased plan (adapted to this repo)

- **Phase 1 — placeholder infantry.** ✅ Done: procedural soldier, stances,
  firing, health, death.
- **Phase 2 — animated GLB soldier.** ⬜ Needs `rifleman.glb` + clips (§2), then
  `InfantryAnimator` + stance→clip map (§3.1–3.2). Loader is ready.
- **Phase 3 — suppression.** ✅ Core done; ⬜ add near-miss suppression + thresholds (§3.5).
- **Phase 4 — cover.** ⬜ Cover points + scoring + raycast LoF + seek-cover state (§3.3–3.4).
- **Phase 5 — squad behavior.** ⬜ Shared enemy knowledge, role assignment, spacing.
- **Phase 6 — LOD + perf.** ⬜ LOD models, billboards, AI throttling, body instancing.

### Practical first version (the core experience)
One rifleman model · one weapon · 3 stances · 5 AI states
(idle/moving/engaging/suppressed/seeking_cover) · 3 reactions
(crouch when lightly suppressed → prone when heavily → run/crawl to cover when it
exists). Get this loop working before advanced anim blending or ballistics:
**shot at → crouch → find cover → move to cover → fire back → prone if pinned.**

---

## Notes
- The GLB pipeline is already wired (`_loadUnitModel`): drop `models/<kind>.glb`
  in and it loads, strips embedded lights/cameras, auto-orients, ground-snaps,
  and builds an `AnimationMixer`. The missing piece is *playing* the clips.
- Until GLB arrives, the in-engine procedural models (with per-role variants from
  §"Current state") are the working placeholder.

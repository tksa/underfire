# Tank Recoil System Design

## Real-World Recoil Mechanics

When a tank fires:
1. **Gun barrel** slides backward along its bore axis (the main visible recoil)
2. **Turret/head** jolts slightly backward from the force transfer
3. **Hull** rocks backward subtly (more noticeable on lighter vehicles)

Each component has a different magnitude and timing.

## Spring-Damper Model

Recoil follows a damped spring curve, not a linear ramp:
- **Phase 1: Snap back** (0–50ms) — gun/turret kicks backward sharply
- **Phase 2: Recovery** (50–200ms) — spring pulls back toward rest, overshoots slightly
- **Phase 3: Settle** (200–350ms) — oscillation dampens to rest

Formula per frame:
```
offset = amplitude * sin(t * frequency) * e^(-decay * t)
```

Where `t` is time since fire, and values vary per caliber.

## Per-Caliber Settings

| Caliber | Gun Slide | Head Kick | Hull Rock | Duration |
|---------|-----------|-----------|-----------|----------|
| 20mm    | 0.005     | 0.003     | 0.001     | 150ms    |
| 37mm    | 0.010     | 0.008     | 0.002     | 200ms    |
| 47mm    | 0.015     | 0.010     | 0.003     | 250ms    |
| 75mm    | 0.025     | 0.015     | 0.005     | 300ms    |
| 88mm    | 0.035     | 0.020     | 0.008     | 350ms    |

All values are in radians for rotation offsets. Gun slide could alternatively be a position offset along the barrel axis.

## Node Hierarchy & What Moves

```
mesh (hull)                    ← hull rocks on X
  └─ model
       └─ turretGroup          ← yaw rotation (Y axis)
            ├─ Tiger_H1_Head   ← head kicks on local X
            └─ Tiger_H1_Gun   ← gun slides on local Z (position) or kicks on X
```

- **Hull rock**: applied to `unit.mesh.rotation` — tiny X offset, same spring-damper
- **Head kick**: applied to `headNode.rotation.x` — medium offset
- **Gun slide**: applied to `gunNode.position` along barrel axis — largest visible effect
  - For the Tiger FBX, gun's barrel axis is local Z in the turretGroup

## Implementation Plan

### 1. Recoil state on unit object
```js
recoilTime: 0,        // time since fire (counts up)
recoilDuration: 0.3,  // total duration (from caliber table)
recoilAmplitude: {     // from caliber table
    gun: 0.035,        // gun position slide (units)
    head: 0.020,       // head X rotation (radians)
    hull: 0.008,       // hull X rotation (radians)
},
```

### 2. Trigger in `combat.js`
When `applyShot` fires for a tank, set `recoilTime = 0` and look up amplitude from weapon caliber.

### 3. Animate in `renderer.js`
Each frame while `recoilTime < recoilDuration`:
```js
const t = unit.recoilTime;
const decay = 8;  // damping factor
const freq = 18;  // oscillation frequency
const envelope = Math.exp(-decay * t) * Math.sin(freq * t);

// Gun position slide along barrel axis
gunNode.position.z = gunBaseZ + recoilAmplitude.gun * envelope;

// Head rotation kick
headNode.rotation.x = headBaseX + recoilAmplitude.head * envelope;

// Hull rock
unit.mesh.children[0].rotation.x += recoilAmplitude.hull * envelope;
```

### 4. Save base positions
On model load, save `gunNode.position.z` and `headNode.rotation.x` as base values (already doing this for head via `_headBaseRotX`).

## Verification
- Fire while turret faces different directions — recoil should always go along barrel
- Rapid fire should restart recoil cleanly (reset `recoilTime = 0`)
- Larger caliber = more visible recoil
- Hull should barely move (subtle effect)

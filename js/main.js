/**
 * Under Fire — main.js (ES module)
 * Imports THREE, sets it globally, then boots the game.
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { Tree } from '@dgreenheck/ez-tree';
import {
    EffectComposer, RenderPass, EffectPass,
    BloomEffect, TiltShiftEffect, HueSaturationEffect,
    BrightnessContrastEffect, VignetteEffect, SMAAEffect,
    BlendFunction, KernelSize,
    Effect, EffectAttribute,
} from 'postprocessing';
window.THREE = THREE;
window.Game.THREE = THREE;
window.Game.FBXLoader = FBXLoader;
window.Game.PLYLoader = PLYLoader;
window.Game.GLTFLoader = GLTFLoader;
window.Game.DRACOLoader = DRACOLoader;
window.Game.SkeletonUtils = { clone: skeletonClone };  // proper clone for rigged/skinned models
window.Game.EZTree = { Tree };   // procedural tree generator (MIT); we swap in CC0 materials
window.Game.PostFX = {           // pmndrs/postprocessing (MIT), loaded from CDN
    EffectComposer, RenderPass, EffectPass,
    BloomEffect, TiltShiftEffect, HueSaturationEffect,
    BrightnessContrastEffect, VignetteEffect, SMAAEffect,
    BlendFunction, KernelSize,
    Effect, EffectAttribute,
};

// ═══════════════════════════════════════════════════════
//  UNIT COLLISION AVOIDANCE
// ═══════════════════════════════════════════════════════

/**
 * Apply separation steering so units don't overlap.
 * Tanks push harder; infantry yields to tanks.
 */
// A moving tank that drives over an ENEMY man crushes him. Tanks never crush their
// own side — friendly infantry get shoved clear instead (see applySeparation).
// Crew-served gun teams get crushed too; other tanks do not (handled by collision).
Game.crushUnit = (tank, victim) => {
    if (!victim.alive || victim._crushed) return;
    if (victim.team === tank.team) return;   // never run over friendlies
    if (Game.isTank(victim.kind) || victim._towed || victim._inVehicle != null) return;
    victim._crushed = true;
    victim.hp = 0;
    victim.alive = false;
    victim.suppressionValue = 100;
    if (Game.selection.has(victim.id)) Game.selection.delete(victim.id);
    if (victim.mesh) victim.mesh.visible = false;
    // Squashed-earth mark + a low thud where he went under the tracks.
    Game.craters.push({ x: victim.x, z: victim.z, r: Game.rand(0.25, 0.45) });
    Game.cameraShake = Math.max(Game.cameraShake || 0, 2);
    if (Game.Audio) Game.Audio.explosion(victim.x, victim.z);
    const who = victim.team === Game.TEAM.FRENCH ? 'friendly' : 'enemy';
    Game.pushMessage(`${tank.label} ran over ${who} ${victim.label}.`, 1.6);
};

// Tank collision tuning (debug-adjustable). The collision radius of a tank is
// unit.size * TANK_SEP_RADIUS. It used to be ×2.5, which made tanks react to each
// other while still well apart ("move when not even touching"); 1.3 keeps the ring
// close to the hull. Tunable live from the debug panel ("Tanks" group).
Game.TANK_SEP_RADIUS = 1.3;
Game.TANK_SEP_STRENGTH = 4.0;     // de-overlap push strength
Game.TANK_SEP_GAP = 0.25;         // extra clearance between hulls
Game._showTankRings = false;      // debug: draw each tank's collision boundary
Game._showPaths = false;          // debug: draw every unit's movement path as a line
Game.tankDebugDefaults = { tankSepRadius: 1.3, tankSepStrength: 4.0, tankRings: 0, truckMaxSteer: 0.5, truckWheelbase: 3.2, truckAccel: 0.6 };
// Truck (wheeled) steering tunables — read in the bicycle-model branch of uMod.move.
Game.TRUCK_MAX_STEER = 0.5;     // max wheel angle (rad); smaller = wider arc
Game.TRUCK_WHEELBASE = 3.2;     // × unit.size; larger = bigger turn radius (slower turn)
Game.TRUCK_ACCEL = 0.6;         // accel fraction of max speed per second

// A tank's collision footprint is a RECTANGLE aligned to the hull (longer than it
// is wide), sized just outside the model — not a round bubble. Half-extents are
// unit.size × these multipliers; +y is forward (length), +x is across (width).
Game.TANK_BOX_LEN = 1.5;        // half-length along the hull (× size)
Game.TANK_BOX_WID = 1.0;        // half-width across the hull (× size)

/**
 * Push a point (a unit at ux,uz with collision radius r) out of a tank's oriented
 * rectangular footprint, expanded by r + margin (Minkowski). Returns the world
 * de-penetration vector {x,z} plus the per-axis penetration {px,pz}, or null when
 * the point is clear of the box. Resolves along the least-penetrated hull axis, so
 * a man slides squarely off the nearest flat side instead of off a circle.
 */
Game._tankBoxPush = (ux, uz, tank, r, margin) => {
    const c = Math.cos(tank.angle), s = Math.sin(tank.angle);
    const dx = ux - tank.x, dz = uz - tank.z;
    const lx = dx * c + dz * s;        // local: along hull length (forward)
    const lz = -dx * s + dz * c;       // local: across hull width (right)
    const hl = tank.size * (Game.TANK_BOX_LEN || 1.5) + r + margin;
    const hw = tank.size * (Game.TANK_BOX_WID || 1.0) + r + margin;
    const px = hl - Math.abs(lx);      // penetration along length
    const pz = hw - Math.abs(lz);      // penetration along width
    if (px <= 0 || pz <= 0) return null;            // outside the box
    let plx = 0, plz = 0;
    if (px < pz) plx = lx >= 0 ? px : -px;          // pop out the near length face
    else plz = lz >= 0 ? pz : -pz;                  // pop out the near width face
    return { x: plx * c - plz * s, z: plx * s + plz * c, px, pz };
};

/**
 * How much a tank should ease off for units CROSSING its path (1 = full speed,
 * 0 = stop). It yields to anyone moving ACROSS its nose (so it doesn't bulldoze
 * through troops who are meant to pass), then resumes once they clear. It does NOT
 * yield to a man standing in the way (make-way shoves him aside — yielding there
 * would freeze the tank forever) nor to escorts moving the same way as the tank.
 */
/**
 * Car-following speed factor for a vehicle (1 = full speed, 0 = stop) so vehicles
 * moving the SAME way form a smooth COLUMN behind a leader instead of weaving around
 * each other (the grouped-tank "everyone detours around everyone" churn). Slows as it
 * closes on the rear of a same-team vehicle ahead that's moving roughly our heading;
 * does NOT trigger on stopped/crossing hulls (those are detoured around as before).
 */
Game._vehicleFollow = (unit) => {
    const hx = Math.cos(unit.angle), hz = Math.sin(unit.angle);
    const len = (unit.size || 1) * (Game.TANK_BOX_LEN || 1.5);
    let factor = 1;
    for (const o of Game.units) {
        if (!o.alive || o.id === unit.id || o.team !== unit.team) continue;
        if (!(Game.isTank(o.kind) || o.kind === 'fuel' || o.kind === 'supply')) continue;
        if ((o.currentSpeed || 0) < 0.25) continue;            // stopped -> detour around it, don't follow
        const rx = o.x - unit.x, rz = o.z - unit.z;
        const ahead = rx * hx + rz * hz;
        if (ahead <= 0) continue;
        const lateral = Math.abs(rx * -hz + rz * hx);
        const lane = (unit.size || 1) * (Game.TANK_BOX_WID || 1.0) + 0.6;
        if (lateral > lane) continue;                          // not directly in front
        const ofx = Math.cos(o.angle), ofz = Math.sin(o.angle);
        if (ofx * hx + ofz * hz < 0.5) continue;               // not moving our way -> not a leader
        const minGap = len + (o.size || 1) * (Game.TANK_BOX_LEN || 1.5) + 0.4;  // bumper-to-bumper
        const slowGap = minGap + 4.0;                          // start easing off here
        factor = Math.min(factor, Game.clamp((ahead - minGap) / (slowGap - minGap), 0, 1));
    }
    return factor;
};

Game._tankYield = (unit) => {
    const hx = Math.cos(unit.angle), hz = Math.sin(unit.angle);
    const lookLen = unit.size * (Game.TANK_BOX_LEN || 1.5) + 3.2;   // just past the nose
    const halfW = unit.size * (Game.TANK_BOX_WID || 1.0) + 0.7;
    let factor = 1;
    for (const o of Game.units) {
        if (!o.alive || o.id === unit.id || Game.isTank(o.kind)) continue;
        const rx = o.x - unit.x, rz = o.z - unit.z;
        const ahead = rx * hx + rz * hz;
        if (ahead < 0.2 || ahead > lookLen) continue;
        if (Math.abs(rx * -hz + rz * hx) > halfW) continue;          // not in our lane
        // Yield only to a man ACTUALLY moving across — not one who has merely stopped
        // to wait for us (else tank and man both wait forever). Tanks have right of
        // way over halted/standing troops.
        if ((o.currentSpeed || 0) < 0.5) continue;
        // Crossing? compare his heading to ours — skip escorts moving the same way.
        if (o.path && o.path.length) {
            let odx = o.path[0].x - o.x, odz = o.path[0].z - o.z;
            const ol = Math.hypot(odx, odz);
            if (ol > 0.01 && (odx / ol) * hx + (odz / ol) * hz > 0.5) continue;
        }
        const f = Game.clamp(ahead / lookLen, 0, 1);                  // closer = harder yield
        factor = Math.min(factor, f * f);
    }
    return factor;
};

// ── Movement recorder (debug) ───────────────────────────────────────────────
// Records every FRIENDLY unit's position/heading/speed/state each frame so movement
// can be replayed/analysed. Toggle from the debug panel ("Record unit movement") or
// call Game.startMoveRec() / Game.stopMoveRec(). Stopping prints a per-unit jitter
// summary (heading + speed reversals, path length vs net travel = "wiggle") to the
// console and downloads the full sample log as JSON.
Game._moveRec = null;
Game.startMoveRec = () => {
    Game._moveRec = [];
    Game._moveRecT0 = Game.gameClock || 0;
    if (Game.pushMessage) Game.pushMessage('Recording unit movement…', 1.5);
};
Game.recordMoveFrame = () => {
    if (!Game._moveRec) return;
    const t = +(((Game.gameClock || 0) - Game._moveRecT0)).toFixed(3);
    for (const u of Game.units) {
        if (!u.alive || u.team !== Game.TEAM.FRENCH) continue;   // all friendly units
        Game._moveRec.push({
            t, id: u.id, kind: u.kind, cls: u.class, x: +u.x.toFixed(3), z: +u.z.toFixed(3),
            a: +(u.angle || 0).toFixed(3), spd: +(u.currentSpeed || 0).toFixed(2),
            stop: +(u.stopTimer || 0).toFixed(2), det: u._detour ? 1 : 0, rev: u._reversing ? 1 : 0,
            mv: u.moving ? 1 : 0,
        });
    }
    if (Game._moveRec.length > 400000) Game._moveRec.splice(0, 8000);
};
Game.stopMoveRec = () => {
    if (!Game._moveRec) { if (Game.pushMessage) Game.pushMessage('Not recording.', 1.2); return null; }
    const data = Game._moveRec; Game._moveRec = null;
    const byId = {};
    data.forEach(s => { (byId[s.id] = byId[s.id] || []).push(s); });
    const summary = Object.keys(byId).map(id => {
        const s = byId[id];
        let headRev = 0, spdRev = 0, pathLen = 0, lastA = 0, lastSd = 0, stopFrames = 0;
        for (let i = 1; i < s.length; i++) {
            pathLen += Math.hypot(s[i].x - s[i - 1].x, s[i].z - s[i - 1].z);
            const da = Game.angleDiff(s[i - 1].a, s[i].a);
            if (Math.abs(da) > 0.01) { if (lastA !== 0 && Math.sign(da) !== Math.sign(lastA)) headRev++; lastA = da; }
            const sd = Math.sign(s[i].spd - s[i - 1].spd);
            if (sd !== 0) { if (lastSd !== 0 && sd !== lastSd) spdRev++; lastSd = sd; }
            if (s[i].spd < 0.05) stopFrames++;
        }
        const net = s.length ? Math.hypot(s[s.length - 1].x - s[0].x, s[s.length - 1].z - s[0].z) : 0;
        return {
            id: +id, kind: s[0].kind, frames: s.length, headingReversals: headRev,
            speedReversals: spdRev, stopFrames, pathLen: +pathLen.toFixed(1),
            net: +net.toFixed(1), wiggle: +(pathLen / (net || 1)).toFixed(2),
        };
    });
    console.log('=== TANK MOVEMENT SUMMARY (jitter = many reversals / high wiggle) ===');
    if (console.table) console.table(summary); else console.log(JSON.stringify(summary, null, 1));
    try {
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = 'tank_movement.json'; a.click();
    } catch (e) { /* headless: no DOM download */ }
    if (Game.pushMessage) Game.pushMessage(`Recording stopped (${data.length} samples) — summary in console.`, 3.0);
    Game._moveRecSummary = summary;
    return summary;
};

Game.applySeparation = (unit, dt) => {
    let sepX = 0, sepZ = 0;
    const isVeh = Game.isTank(unit.kind);
    const radMult = Game.TANK_SEP_RADIUS || 1.3;
    const myRadius = isVeh ? unit.size * radMult : unit.size * 0.7;
    // A tank rolling at speed crushes anyone under its hull.
    const tankMoving = isVeh && (unit.currentSpeed || 0) > 0.6;
    const crushRadius = unit.size * 1.15;
    const fwdX = Math.cos(unit.angle), fwdZ = Math.sin(unit.angle);
    let blockedAhead = false;

    for (const other of Game.units) {
        if (!other.alive || other.id === unit.id) continue;

        const dx = unit.x - other.x;
        const dz = unit.z - other.z;
        const distSq = dx * dx + dz * dz;

        const otherVeh = Game.isTank(other.kind);

        // MAKE WAY: a foot soldier standing in the path of an ADVANCING FRIENDLY
        // tank scrambles aside before it arrives, so the tank isn't blocked by its
        // own infantry and the man isn't run down. Runs ahead of the overlap test
        // (it's a look-ahead, not a contact response). Urgency scales with how
        // close the tank is and how deep in its lane the man stands.
        //
        // Gate on the tank ACTUALLY TRANSLATING (currentSpeed), not merely "having a
        // path". A tank that is only rotating in place to line up its next waypoint
        // has a path but isn't advancing — the old "|| has path" test made the man
        // flee the swinging heading the whole time the hull turned, so he got swept
        // a long way around. Once the tank rolls forward the look-ahead catches him.
        //
        // Only STANDING troops scramble. A man crossing under his own move order is
        // "meant to pass" — the TANK yields to him instead (see Game._tankYield), so
        // we skip make-way for him here and let him walk his line.
        const manUnderOrders = unit.path && unit.path.length && !unit._idleMoving;
        if (!isVeh && otherVeh && other.team === unit.team
            && (other.currentSpeed || 0) > 0.45 && !manUnderOrders) {
            const fX = Math.cos(other.angle), fZ = Math.sin(other.angle);
            const relX = unit.x - other.x, relZ = unit.z - other.z;
            const ahead = relX * fX + relZ * fZ;               // + = in front of the tank
            const lateral = relX * -fZ + relZ * fX;            // signed offset across its path
            const halfWidth = other.size * radMult + unit.size * 0.7 + 0.6;
            // Look well ahead (scaled by the tank's speed) so the man starts moving
            // out early rather than at the last second.
            const lookAhead = other.size * 2.6 + (other.currentSpeed || 0) * 2.5;
            if (ahead > -other.size && ahead < lookAhead && Math.abs(lateral) < halfWidth) {
                // Commit to one side and HOLD it (so he doesn't dither across the
                // centreline); a man dead-centre picks left deterministically by id.
                if (unit._bailFor !== other.id) {
                    unit._bailFor = other.id;
                    unit._bailSide = Math.abs(lateral) > 0.05 ? (lateral >= 0 ? 1 : -1) : ((unit.id & 1) ? 1 : -1);
                }
                const dir = unit._bailSide;
                const urgency = 1 - Math.max(0, ahead) / lookAhead;          // closer = stronger
                const push = (halfWidth - Math.abs(lateral) + 0.6) * (6 + urgency * 10);
                sepX += (-fZ * dir) * push;
                sepZ += (fX * dir) * push;
            } else if (unit._bailFor === other.id && (ahead <= -other.size || Math.abs(lateral) >= halfWidth)) {
                unit._bailFor = null;                          // cleared the lane — release
            }
        }

        // Run-over: a moving tank overlapping ENEMY foot soldiers flattens them
        // rather than nudging them aside. Friendly infantry are never crushed.
        if (isVeh && !otherVeh && tankMoving && other.team !== unit.team
            && distSq < crushRadius * crushRadius) {
            Game.crushUnit(unit, other);
            continue;
        }

        // Infantry vs tank — RECTANGULAR collide-and-slide against the hull box
        // (slightly larger than the model), handled here (before the circular gate)
        // so the box's full length/corners are respected. De-penetrate by exactly
        // the overlap, once, along the nearest hull face: no spring, no halt — the
        // man grazes the side and slides along it (his path/detour route him round).
        if (!isVeh && otherVeh) {
            const tankRolling = (other.currentSpeed || 0) > 0.6;
            const enemyRolling = tankRolling && other.team !== unit.team;
            const push = Game._tankBoxPush(unit.x, unit.z, other, unit.size * 0.7, 0.12);
            if (push) {
                if (!enemyRolling) { unit.x += push.x; unit.z += push.z; }
                if (tankRolling) {   // scramble toward a flank to clear the lane
                    const fX = Math.cos(other.angle), fZ = Math.sin(other.angle);
                    let pX = -fZ, pZ = fX;
                    if (dx * pX + dz * pZ < 0) { pX = -pX; pZ = -pZ; }
                    const m = Math.max(push.px, push.pz) + 0.6;
                    sepX += pX * m * 7.0; sepZ += pZ * m * 7.0;
                }
            }
            continue;
        }

        const otherRadius = otherVeh ? other.size * radMult : other.size * 0.7;
        const gap = (isVeh && otherVeh) ? (Game.TANK_SEP_GAP ?? 0.25) : 0.3;
        const minDist = myRadius + otherRadius + gap;
        const minDistSq = minDist * minDist;
        if (distSq >= minDistSq || distSq <= 0.0001) continue;

        const dist = Math.sqrt(distSq);
        const overlap = minDist - dist;
        const nx = dx / dist, nz = dz / dist;
        let strength = overlap * (Game.TANK_SEP_STRENGTH || 3.0);

        if (isVeh && otherVeh) {
            // Tank vs tank: a tank can NOT drive through another. A STATIONARY tank
            // holds its ground (immovable) while the MOVER de-overlaps and routes
            // around it — so a moving tank never shoves a parked friendly aside.
            // RADIAL (circular) de-overlap here: the oriented-box min-translation push
            // flips between the hull's long/short face as two tanks cross the box
            // corner, and that flip-flop was the jitter. The radial push is smooth.
            // (Infantry still de-penetrate off the square hull box — that's where the
            // rectangular footprint is visible and it's flicker-free for a point.)
            const iMoving = (unit.currentSpeed || 0) > 0.3 || (unit.path && unit.path.length > 0);
            const otherMoving = (other.currentSpeed || 0) > 0.3 || (other.path && other.path.length > 0);
            if (iMoving || !otherMoving) {
                sepX += nx * strength;
                sepZ += nz * strength;
            }
            // Yield (brief stop) only if the OTHER hull is ahead AND has priority —
            // a stationary tank, or the lower-id one among two movers. This breaks
            // the symmetry so two tanks meeting never both freeze and lock together;
            // exactly one eases around while the other proceeds. BUT if the other hull
            // is moving roughly our own heading, we're following it in column — the
            // car-following slowdown handles the spacing smoothly, so don't hard-stop
            // (that stop/go behind a leader was the "repeat movements" stutter).
            const otherAhead = (-nx) * fwdX + (-nz) * fwdZ > 0.25;
            const following = otherMoving && (Math.cos(other.angle) * fwdX + Math.sin(other.angle) * fwdZ) > 0.6;
            if (otherAhead && !following && (!otherMoving || other.id < unit.id)) blockedAhead = true;
        } else if (isVeh && !otherVeh) {
            // Tank vs infantry: a tank is immovable by men (no push on the tank).
        } else {
            // Infantry vs infantry.
            sepX += nx * strength;
            sepZ += nz * strength;
        }
    }

    if (isVeh) {
        // De-overlap directly apart (capped). The old code projected separation onto
        // the forward axis only, which let a tank bulldoze a hull in front of it.
        // The cap is kept LOW so a de-overlap reads as a gentle nudge, not a sideways
        // SKID — with the column-following + spread-slots keeping hulls from packing,
        // big de-overlaps are rare and a hard shove just looked like the tank sliding.
        const sepMag = Math.hypot(sepX, sepZ);
        if (sepMag > 0.0001) {
            const m = Math.min(sepMag, 2.8);
            unit.x += (sepX / sepMag) * m * dt;
            unit.z += (sepZ / sepMag) * m * dt;
        }
        // Yield to a tank sitting in our path: pause rather than grind into it.
        if (blockedAhead) unit.stopTimer = Math.max(unit.stopTimer || 0, 0.2);
    } else {
        // Infantry: push in any direction
        const sepMag = Math.hypot(sepX, sepZ);
        const maxSep = 8.0;
        if (sepMag > maxSep) {
            sepX = (sepX / sepMag) * maxSep;
            sepZ = (sepZ / sepMag) * maxSep;
        }
        unit.x += sepX * dt;
        unit.z += sepZ * dt;
        // A tank blocking the way ahead: pause path-stepping briefly so the lateral
        // steer above carries him around the hull instead of grinding into it.
        if (blockedAhead) unit.stopTimer = Math.max(unit.stopTimer || 0, 0.15);
    }
};

// ── Local obstacle avoidance around tanks ───────────────────────────────────
// A tank is a moving obstacle A* can't see (tanks aren't in the static tile
// grid). Without this, anything routed through one grinds against it — tanks
// nose to nose, and FOOT TROOPS marching on the spot into a hull. This maintains
// a temporary side-step waypoint ("invisible waypoint, dynamically updated") that
// the normal path-follower steers toward, carrying the unit around the tank and
// back onto its route. Applies to tanks, trucks AND infantry; the side is chosen
// once and held until the tank is cleared, so the unit doesn't waver.
Game._vehicleAvoid = (unit) => {
    if (unit.retreating || unit._garrisoned || !unit.path || !unit.path.length) {
        unit._detour = null; return;
    }
    const radMult = Game.TANK_SEP_RADIUS || 1.3;
    const selfIsTank = Game.isTank(unit.kind);
    const isTruck = unit.kind === 'fuel' || unit.kind === 'supply';
    const vehSized = selfIsTank || isTruck;              // vehicle-sized footprint
    const myR = vehSized ? unit.size * radMult : unit.size * 0.7;
    const goal = unit.path[unit.path.length - 1];
    // Arriving at the final destination — let de-overlap settle it, don't circle.
    if (unit.path.length === 1 && Game.dist(unit.x, unit.z, goal.x, goal.z) < myR * 2.2) {
        if (unit._detour && unit.path[0] === unit._detour) unit.path.shift();
        unit._detour = null; return;
    }
    // Destination sits ON a tank (A* routes over the grid and can't see tanks, so a
    // goal under/behind a hull is unreachable). Once we're up against that tank,
    // call it arrived instead of orbiting the hull forever trying to step onto it.
    if (unit.path.length === 1) {
        for (const o of Game.units) {
            if (!o.alive || o.id === unit.id || !Game.isTank(o.kind)) continue;
            const tr = o.size * radMult;
            if (Game.distSq(goal.x, goal.z, o.x, o.z) < (tr + 0.4) * (tr + 0.4)
                && Game.distSq(unit.x, unit.z, o.x, o.z) < (tr + myR + 0.8) * (tr + myR + 0.8)) {
                if (unit._detour && unit.path[0] === unit._detour) unit.path.shift();
                unit._detour = null; unit.path.length = 0; unit.moving = false;
                return;
            }
        }
    }
    const hx = Math.cos(unit.angle), hz = Math.sin(unit.angle);

    // Most-blocking TANK inside a corridor straight ahead. Trucks turn wide, so
    // they look further ahead to start the detour in time.
    let block = null, blockD = Infinity;
    const lookAhead = myR + (isTruck ? 9 : (selfIsTank ? 6 : 3.5));
    for (const o of Game.units) {
        if (!o.alive || o.id === unit.id || !Game.isTank(o.kind)) continue;
        const rx = o.x - unit.x, rz = o.z - unit.z;
        const ahead = rx * hx + rz * hz;                 // along heading
        if (ahead <= 0.3 || ahead > lookAhead) continue;
        const lateral = rx * -hz + rz * hx;              // signed perpendicular offset
        const corridor = myR + o.size * radMult + 0.4;
        if (Math.abs(lateral) > corridor) continue;      // not in our lane
        // Tank vs tank: only the higher-id mover swerves (the other holds course)
        // so they don't mirror each other. Trucks and foot troops ALWAYS go round
        // a tank (a tank has right of way over them).
        const oMoving = (o.currentSpeed || 0) > 0.3 || (o.path && o.path.length > 0);
        if (selfIsTank && oMoving && o.id < unit.id) continue;
        // Don't weave around a tank we're FOLLOWING (moving roughly our heading) — the
        // car-following slowdown forms a column behind it instead. Only stopped or
        // crossing hulls are real obstacles to detour around.
        if ((o.currentSpeed || 0) > 0.3) {
            const ofx = Math.cos(o.angle), ofz = Math.sin(o.angle);
            if (ofx * hx + ofz * hz > 0.6) continue;
        }
        if (ahead < blockD) { blockD = ahead; block = o; }
    }

    const nowT = Game.gameClock || 0;
    const blockMoving = block ? ((block.currentSpeed || 0) > 0.3 || (block.path && block.path.length > 0)) : false;

    // FOOT TROOPS never weave a detour. They only stop briefly for a MOVING FRIENDLY
    // tank CROSSING the lane (not one they're escorting); the collide-and-slide routes
    // them around a hull, so the side-step waypoint was pure jitter for them.
    if (!vehSized) {
        if (block && blockMoving && (block.currentSpeed || 0) > 0.3 && block.team === unit.team) {
            const tfx = Math.cos(block.angle), tfz = Math.sin(block.angle);
            const following = (hx * tfx + hz * tfz) > 0.45;
            if (!following) unit.stopTimer = Math.max(unit.stopTimer || 0, 0.4);
        }
        if (unit._detour && unit.path[0] === unit._detour) unit.path.shift();
        unit._detour = null; return;
    }

    // VEHICLES — HOLD an active detour through brief block-loss FLICKER. A tank steers
    // at the side-step point, which shifts the blocking hull out of its corridor for a
    // frame; the old code then retired the detour and reacquired it next frame — det
    // toggling 1/0/1/0, heading shimmying ±0.04 every frame, the hull juddering in
    // place. Keeping the detour for ~0.4s before re-evaluating gives a steady heading.
    const activeDetour = unit._detour && unit.path[0] === unit._detour;
    if (activeDetour && (nowT - (unit._detour.t || 0)) < 0.4) return;

    if (!block) {                                        // hold expired, lane clear — retire
        if (activeDetour) unit.path.shift();
        unit._detour = null; return;
    }

    // Reuse the chosen side while still avoiding the same tank; pick afresh otherwise.
    let side;
    if (unit._detour && unit._detour.forId === block.id) {
        side = unit._detour.side;
    } else if (blockMoving) {
        // Crossing tank: pass BEHIND it. Pick the side toward the tank's rear so we
        // cut in behind rather than across its nose.
        const fx = Math.cos(block.angle), fz = Math.sin(block.angle);
        const perpDotFwd = (-hz) * fx + hx * fz;         // p·F for the side=+1 axis
        if (Math.abs(perpDotFwd) < 0.2) {                // moving roughly parallel — clearer side
            const lateral = (block.x - unit.x) * -hz + (block.z - unit.z) * hx;
            side = lateral > 0 ? -1 : 1;
        } else {
            side = perpDotFwd > 0 ? -1 : 1;              // the rear-ward side
        }
    } else {
        const lateral = (block.x - unit.x) * -hz + (block.z - unit.z) * hx;
        side = lateral > 0 ? -1 : 1;                     // stationary: side the hull isn't on
    }
    const off = myR + block.size * radMult + 0.8;
    let px = -hz * side, pz = hx * side;
    let gx = block.x + px * off, gz = block.z + pz * off;
    if (blockMoving) {                                   // bias the waypoint toward the tank's rear
        const fx = Math.cos(block.angle), fz = Math.sin(block.angle);
        gx -= fx * off * 0.5; gz -= fz * off * 0.5;
    } else {
        // Stationary tank: lead the waypoint PAST the hull toward the goal, not just
        // beside it. Otherwise the unit reaches the side, the goal again lines up
        // through the tank, and it re-detours on the spot — orbiting the hull. The
        // forward bias rounds it and carries it onward so it clears in one pass.
        const tgx = goal.x - block.x, tgz = goal.z - block.z;
        const tgl = Math.hypot(tgx, tgz) || 1;
        gx += (tgx / tgl) * off * 0.7;
        gz += (tgz / tgl) * off * 0.7;
    }
    gx = Game.clamp(gx, 1, Game.WORLD_W - 1);
    gz = Game.clamp(gz, 1, Game.WORLD_H - 1);
    const t = Game.getTileAtWorld(gx, gz);
    if (t && (t.blocked || (vehSized && t.vehicleBlocked))) {  // that side is walled — try the other
        side = -side; px = -px; pz = -pz;
        gx = Game.clamp(block.x + px * off, 1, Game.WORLD_W - 1);
        gz = Game.clamp(block.z + pz * off, 1, Game.WORLD_H - 1);
    }

    if (unit._detour && unit.path[0] === unit._detour) {
        unit._detour.x = gx; unit._detour.z = gz; unit._detour.forId = block.id; unit._detour.side = side; unit._detour.t = nowT;
    } else {
        unit._detour = { x: gx, z: gz, forId: block.id, side, t: nowT, _detour: true };
        unit.path.unshift(unit._detour);
    }
};

// Debug controls for tank collision (registered into the post-FX panel).
Game._tankControlDefs = () => [
    { group: 'Tanks', key: 'tankSepRadius', label: 'Collision radius x (size)', min: 0.5, max: 3, step: 0.05, apply: v => { Game.TANK_SEP_RADIUS = v; } },
    { group: 'Tanks', key: 'tankSepStrength', label: 'Separation push x', min: 1, max: 10, step: 0.5, apply: v => { Game.TANK_SEP_STRENGTH = v; } },
    { group: 'Tanks', key: 'tankBoxLen', label: 'Hull box length x (size)', min: 0.6, max: 3, step: 0.05, apply: v => { Game.TANK_BOX_LEN = v; } },
    { group: 'Tanks', key: 'tankBoxWid', label: 'Hull box width x (size)', min: 0.5, max: 2, step: 0.05, apply: v => { Game.TANK_BOX_WID = v; } },
    { group: 'Tanks', key: 'tankRings', label: 'Show collision box (0/1)', min: 0, max: 1, step: 1, apply: v => { Game._showTankRings = v >= 1; } },
    { group: 'Tanks', key: 'showPaths', label: 'Show movement paths (0/1)', min: 0, max: 1, step: 1, apply: v => { Game._showPaths = v >= 1; } },
    { group: 'Tanks', key: 'recMovement', label: 'Record unit movement (0/1)', min: 0, max: 1, step: 1, apply: v => { if (v >= 1) Game.startMoveRec(); else Game.stopMoveRec(); } },
    { group: 'Trucks', key: 'truckMaxSteer', label: 'Max steer (rad)', min: 0.2, max: 0.9, step: 0.02, apply: v => { Game.TRUCK_MAX_STEER = v; } },
    { group: 'Trucks', key: 'truckWheelbase', label: 'Wheelbase x size (turn radius)', min: 1.5, max: 6, step: 0.1, apply: v => { Game.TRUCK_WHEELBASE = v; } },
    { group: 'Trucks', key: 'truckAccel', label: 'Acceleration', min: 0.2, max: 2, step: 0.05, apply: v => { Game.TRUCK_ACCEL = v; } },
];

// ═══════════════════════════════════════════════════════
//  PER-UNIT UPDATE
// ═══════════════════════════════════════════════════════

// Morale aura: is a living friendly officer within command radius? Officers
// steady nearby troops (faster suppression recovery, higher break thresholds).
Game.nearOfficer = (unit) => {
    const R = 14;
    for (const o of Game.units) {
        if (!o.alive || o.team !== unit.team) continue;
        if (!(o.supportType === 'officer' || o._actingOfficer)) continue; // real or field-promoted
        if (o === unit) continue;
        if (Game.distSq(o.x, o.z, unit.x, unit.z) <= R * R) return true;
    }
    return false;
};

// Game.updateUnit moved to js/unit_modules.js (decomposed into per-unit modules:
// frame / morale / health / supply / deploy / scan / bombard / engage / fire /
// move, orchestrated there). See js/unit_modules.js.

Game.updateMessages = (dt) => {
    for (let i = Game.messages.length - 1; i >= 0; i--) {
        Game.messages[i].ttl -= dt;
        if (Game.messages[i].ttl <= 0) Game.messages.splice(i, 1);
    }
};

// ═══════════════════════════════════════════════════════
//  SUPPORT UNIT AUTO-BEHAVIORS
// ═══════════════════════════════════════════════════════

Game.updateSupportUnits = (dt) => {
    // Reset officer sight bonuses each frame
    Game.units.forEach(u => { if (u.alive) u._officerSightBonus = 0; });

    Game.units.forEach(unit => {
        if (!unit.alive) return;
        const base = Game.UNIT_STATS[unit.statKey];
        if (!base || base.class !== 'support') return;

        // Support cooldown — act every ~2 seconds
        unit._supportTimer = (unit._supportTimer || 0) - dt;
        if (unit._supportTimer > 0) return;
        unit._supportTimer = 2.0;

        const sType = base.supportType;
        const range = sType === 'supply' || sType === 'fuel' ? 8 : (sType === 'officer' ? 12 : 4);

        // Supply truck passive regen: +1 ammo per 5s when idle
        if (sType === 'supply' && !unit.moving) {
            unit._regenTimer = (unit._regenTimer || 0) + 2.0;
            if (unit._regenTimer >= 5) {
                unit._regenTimer = 0;
                unit.ammo = Math.min(unit.maxAmmo || 999, unit.ammo + 1);
            }
        }

        for (const other of Game.units) {
            if (!other.alive || other.team !== unit.team || other.id === unit.id) continue;
            const d = Game.dist(unit.x, unit.z, other.x, other.z);
            if (d > range) continue;

            if (sType === 'medic' && !Game.isTank(other.kind) && other.hp < other.maxHp) {
                // Heal infantry
                other.hp = Math.min(other.maxHp, other.hp + 8);
                unit.experience = Math.min(100, (unit.experience || 0) + 1);
                break;
            }
            if (sType === 'mechanic' && Game.isTank(other.kind)) {
                if (other.hp < other.maxHp) {
                    other.hp = Math.min(other.maxHp, other.hp + 5);
                    unit.experience = Math.min(100, (unit.experience || 0) + 1);
                    break;
                }
                if (other.tracksDisabled) {
                    other.tracksDisabled = false;
                    const ob = Game.UNIT_STATS[other.statKey];
                    if (ob) other.speed = ob.speed;
                    Game.pushMessage(`${other.label} tracks repaired!`, 2.0);
                    break;
                }
                if (other.engineDamaged) {
                    other.engineDamaged = false;
                    const ob2 = Game.UNIT_STATS[other.statKey];
                    if (ob2) other.speed = ob2.speed;
                    Game.pushMessage(`${other.label} engine repaired!`, 2.0);
                    break;
                }
                if (other.turretDamaged) {
                    other.turretDamaged = false;
                    Game.pushMessage(`${other.label} turret repaired!`, 2.0);
                    break;
                }
            }
            if (sType === 'supply' && other.ammo < other.maxAmmo) {
                // Supply trucks spend own ammo 1:1 when resupplying
                const give = Math.min(5, unit.ammo);
                if (give > 0) {
                    other.ammo = Math.min(other.maxAmmo, other.ammo + give);
                    unit.ammo -= give;
                }
                break;
            }
            if (sType === 'fuel' && other.fuel >= 0 && other.fuel < other.maxFuel) {
                other.fuel = Math.min(other.maxFuel, other.fuel + 10);
                break;
            }
            if (sType === 'officer') {
                // Accuracy aura — temporary veterancy boost
                other.veterancy = Math.min(1, other.veterancy + 0.02);
                // Vision sharing — +6 sight range to nearby friendlies
                other._officerSightBonus = 6;
            }
        }
    });
};

// ═══════════════════════════════════════════════════════
//  AIR STRIKE SYSTEM
// ═══════════════════════════════════════════════════════

Game.airStrikes = [];
Game.airStrikesAvailable = 1;     // planes (sorties) available
Game.airStrikePlanesToUse = 1;    // how many to commit in the next strike

// Clamp the "planes to use" selector into the legal range for the current stock.
Game.adjustAirStrikePlanes = (delta) => {
    const avail = Math.max(0, Game.airStrikesAvailable);
    if (avail <= 0) { Game.airStrikePlanesToUse = 0; return 0; }
    Game.airStrikePlanesToUse = Game.clamp((Game.airStrikePlanesToUse || 1) + delta, 1, avail);
    return Game.airStrikePlanesToUse;
};

Game.callAirStrike = (x, z) => {
    const avail = Game.airStrikesAvailable;
    if (avail <= 0) {
        Game.pushMessage('No air strikes available!', 2.0);
        return;
    }
    const planes = Game.clamp(Math.round(Game.airStrikePlanesToUse || 1), 1, avail);
    Game.airStrikesAvailable -= planes;
    Game.airStrikePlanesToUse = Math.min(Game.airStrikePlanesToUse || 1, Math.max(1, Game.airStrikesAvailable));

    Game.pushMessage(`${planes} aircraft inbound! Bombs away in 3s... (${Game.airStrikesAvailable} sortie${Game.airStrikesAvailable === 1 ? '' : 's'} left)`, 3.0);
    // Engine drone overhead — louder/longer for a bigger flight.
    if (Game.Audio && Game.Audio.plane) Game.Audio.plane(3.0 + planes * 0.5);

    // Rolling bombardment: each plane makes its run a beat after the last, fanned
    // across the target so a multi-plane strike carpets a wider strip.
    for (let p = 0; p < planes; p++) {
        const off = p - (planes - 1) / 2;
        Game.airStrikes.push({
            x: x + off * 4, z: z + off * 2.5,
            delay: 3.0 + p * 0.7, shells: 10, done: false,
        });
    }
};

Game.updateAirStrikes = (dt) => {
    for (let i = Game.airStrikes.length - 1; i >= 0; i--) {
        const strike = Game.airStrikes[i];
        strike.delay -= dt;
        if (strike.delay <= 0 && !strike.done) {
            strike.done = true;
            // Drop shells
            for (let s = 0; s < strike.shells; s++) {
                const sx = strike.x + Game.rand(-6, 6);
                const sz = strike.z + Game.rand(-6, 6);
                // Damage all units in blast
                const blastR = 4.0;
                Game.units.forEach(u => {
                    if (!u.alive) return;
                    const d = Game.dist(sx, sz, u.x, u.z);
                    if (d < blastR) {
                        const falloff = 1 - d / blastR;
                        u.hp -= 40 * falloff;
                        u.suppressionValue = Math.min(100, u.suppressionValue + 30 * falloff);
                        u.shaken = 0.5;
                        if (u.hp <= 0) {
                            u.alive = false;
                            u.hp = 0;
                            if (u.mesh) u.mesh.visible = false;
                        }
                    }
                });
                // Smoke/crater effect
                Game.smoke.push({
                    x: sx, z: sz,
                    r: 1.5, life: 1.2, total: 1.2,
                    vx: Game.rand(-0.5, 0.5), vz: Game.rand(-1, -0.3),
                    mesh: null,
                });
                Game.craters.push({ x: sx, z: sz, r: Game.rand(0.8, 1.5) });
                if (Game.Audio) Game.Audio.explosion(sx, sz);
                Game.addBlastFlash(sx, sz, 1.6);
            }
            Game.cameraShake = 12;
            Game.lastAttackPos = { x: strike.x, z: strike.z };
            // Bombing run visual — tracer lines from approach direction
            for (let t = 0; t < 5; t++) {
                const approachX = strike.x + Game.rand(-3, 3);
                const approachZ = strike.z - 15; // Planes come from north
                Game.tracers.push({
                    x: approachX, z: approachZ,
                    tx: strike.x + Game.rand(-5, 5), tz: strike.z + Game.rand(-5, 5),
                    life: 0.5, total: 0.5,
                    team: Game.TEAM.FRENCH, big: true, mesh: null,
                });
            }
            Game.pushMessage('Air strike impact!', 2.0);
        }
        if (strike.done && strike.delay < -2) {
            Game.airStrikes.splice(i, 1);
        }
    }
};

// ═══════════════════════════════════════════════════════
//  INDIRECT FIRE / BOMBARDMENT (mortars target ground)
// ═══════════════════════════════════════════════════════

Game.indirectShells = [];

/** Bright additive blast flash at an explosion point (textured billboard). */
// FX §8/§13: how much dust a surface throws and how long it lingers. Colour is
// handled separately (updateSmoke3D / _dustColorAt); this scales count, life,
// rise and radius. Wet ground halves dust; masonry/road throws less volume;
// sand throws a wide pale sheet; rain knocks dust down.
Game._dustModAt = (x, z) => {
    const t = Game.getTileAtWorld ? Game.getTileAtWorld(x, z) : null;
    let m = { amount: 1, life: 1, rise: 1, radius: 1 };
    if (t) switch (t.type) {
        case 'mud': case 'swamp': case 'water': m = { amount: 0.5, life: 0.6, rise: 0.7, radius: 0.9 }; break;
        case 'sand': m = { amount: 1.1, life: 1.2, rise: 0.9, radius: 1.2 }; break;
        case 'road': case 'yard': case 'wall': case 'house': m = { amount: 0.7, life: 1.0, rise: 1.1, radius: 0.9 }; break;
        case 'forest': case 'dense_forest': m = { amount: 1.1, life: 0.9, rise: 0.9, radius: 1.0 }; break;
        case 'snow': m = { amount: 1.0, life: 1.1, rise: 1.0, radius: 1.1 }; break;
        default: break;
    }
    if (Game.weatherEffect === 'rain') { m.amount *= 0.6; m.life *= 0.6; }
    else if (Game.weatherEffect === 'snow') { m.life *= 1.1; }
    return m;
};

Game.addBlastFlash = (x, z, scale = 1) => {
    Game.muzzleFlashes = Game.muzzleFlashes || [];
    Game.muzzleFlashes.push({ x, z, r: 0.9 * scale, life: 0.2, total: 0.2, big: true, mesh: null });
    // VALOR Stage 5: leave a persistent scorch scar for real explosions (skip the
    // small muzzle/MG-hit flashes). Radius scales with the blast.
    if (scale >= 0.6 && Game.addScorch) Game.addScorch(x, z, 1.1 * scale);
    // Buildings take blast damage (tank HE, grenades, AT, mortars, air strikes
    // all funnel through here) — steps their damage state and finally collapses.
    if (scale >= 0.5 && Game.damageBuildingAt) Game.damageBuildingAt(x, z, 42 * scale, 2.2 * scale);

    // FX §6.2 HE ground impact: a rising dirt column + a low shock ring + a few
    // thrown clods, all scaled by blast size. Dust colour comes from the ground
    // it was kicked up from (updateSmoke3D). Skip the tiny muzzle/MG flashes.
    if (scale >= 0.6 && Game.smoke) {
        const dustMul = (Game.fxImpactDust != null) ? Game.fxImpactDust : 1;
        const mod = Game._dustModAt ? Game._dustModAt(x, z) : { amount: 1, life: 1, rise: 1, radius: 1 };
        const n = Math.max(1, Math.round((3 + scale * 3) * dustMul * mod.amount));
        for (let i = 0; i < n; i++) {
            const rr = scale * (0.4 + Math.random() * 0.7);
            const life = (1.6 + scale * 1.6) * mod.life;
            Game.smoke.push({
                x: x + Game.rand(-rr, rr), z: z + Game.rand(-rr, rr),
                r: (0.6 + Math.random() * 0.8) * scale * mod.radius,
                life, total: life,
                vx: Game.rand(-0.3, 0.3) * scale, vz: Game.rand(-0.3, 0.3) * scale,
                rise: (1.3 + scale * 1.4) * mod.rise, maxOpacity: 0.7, dust: true, mesh: null,
            });
        }
        // wide, brief low shock ring hugging the ground
        Game.smoke.push({ x, z, r: 1.3 * scale * mod.radius, life: 0.55, total: 0.55, rise: 0.25, maxOpacity: 0.5, dust: true, mesh: null });

        // FX §18.1: large HE / bomb dust briefly obscures line of sight (reuses
        // the LOS-only smokeClouds; the visible dust is the puffs above). Scales
        // with caliber; off when fxDustLOS = 0.
        const losMul = (Game.fxDustLOS != null) ? Game.fxDustLOS : 1;
        if (scale >= 1.0 && losMul > 0 && Game.smokeClouds) {
            Game.smokeClouds.push({ x, z, radius: scale * 1.6, life: Game.clamp(scale * 2.5, 1.5, 18) * losMul * mod.life });
        }

        // FX §12.1: a real blast on dry vegetation can start a ground fire.
        if (scale >= 0.8 && Game.igniteFire) Game.igniteFire(x, z, scale);
    }

    // FX §17: camera shake scaled by blast size AND distance to the view centre,
    // so distant shells in a big battle don't rattle the whole screen.
    if (Game.cam) {
        const d = Math.hypot(x - Game.cam.x, z - Game.cam.z);
        const reach = (Game.cam.zoom || 20) * 2.5;
        const near = Game.clamp(1 - d / reach, 0, 1);
        const shakeMul = (Game.fxShake != null) ? Game.fxShake : 1;
        Game.cameraShake = Math.max(Game.cameraShake || 0, scale * 6 * near * shakeMul);
    }
};

// FX §6.1 / §15.2: an AP / kinetic round striking the ground reads as a
// directional dirt lance flung forward along the shell's path, plus a spark and
// a narrow gouge scar — NOT a round HE crater, and the dust thins fast.
Game._apGroundImpact = (x, z, angle, scale = 1) => {
    const dustMul = (Game.fxImpactDust != null) ? Game.fxImpactDust : 1;
    const mod = Game._dustModAt ? Game._dustModAt(x, z) : { amount: 1, life: 1, rise: 1, radius: 1 };
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const n = Math.max(1, Math.round((2 + scale * 2) * dustMul * mod.amount));
    for (let i = 0; i < n; i++) {
        const fwd = (0.2 + Math.random() * 1.2) * scale;   // strung out forward
        const life = (0.5 + scale * 0.7) * mod.life;
        Game.smoke.push({
            x: x + cos * fwd + Game.rand(-0.2, 0.2) * scale,
            z: z + sin * fwd + Game.rand(-0.2, 0.2) * scale,
            r: (0.3 + Math.random() * 0.4) * scale * mod.radius,
            life, total: life,
            vx: cos * (1.5 + Math.random()) * scale, vz: sin * (1.5 + Math.random()) * scale,
            rise: (0.7 + Math.random() * 0.7) * mod.rise, maxOpacity: 0.5, dust: true, mesh: null,
        });
    }
    // bright kinetic spark at the strike point
    Game.muzzleFlashes = Game.muzzleFlashes || [];
    Game.muzzleFlashes.push({ x, z, r: 0.35 * scale, life: 0.1, total: 0.1, big: false, mesh: null });
    // narrow persistent gouge scar, offset slightly along travel
    if (Game.addScorch) Game.addScorch(x + cos * 0.6 * scale, z + sin * 0.6 * scale, 0.4 * scale);
};

/**
 * Drive a mortar firing on its commanded bombard point.
 * Sets unit._bombarding=true while firing in place; moves into range otherwise.
 */
Game.updateBombard = (unit, dt, weapon) => {
    const tx = unit.bombardX, tz = unit.bombardZ;
    const d = Game.dist(unit.x, unit.z, tx, tz);
    const minR = weapon.minRange || 0;

    if (d > unit.range) {
        // Too far — advance to a firing position within range
        unit._bombarding = false;
        if (!unit.path || !unit.path.length) {
            const ang = Game.angleTo(tx, tz, unit.x, unit.z);
            const standoff = unit.range * 0.8;
            const gx = Game.clamp(tx + Math.cos(ang) * standoff, 1, Game.WORLD_W - 1);
            const gz = Game.clamp(tz + Math.sin(ang) * standoff, 1, Game.WORLD_H - 1);
            unit.path = Game.findPath(unit, unit.x, unit.z, gx, gz);
            unit.moving = true;
        }
        return;
    }
    if (d < minR) {
        // Too close for indirect fire — abandon the order
        unit._bombarding = false;
        unit.bombardX = null; unit.bombardZ = null;
        Game.pushMessage(`${unit.label}: target too close for indirect fire.`, 1.5);
        return;
    }

    // In range — stop and lob shells
    unit._bombarding = true;
    unit.path = [];
    unit.moving = false;
    unit.currentSpeed = 0;
    unit.angle = Game.angleTo(unit.x, unit.z, tx, tz);
    unit.turretAngle = unit.angle;
    if (unit.cooldownLeft <= 0) {
        Game.fireBombard(unit, tx, tz, weapon);
        const xpReloadMod = 1 - (unit.experience || 0) * 0.0015;
        unit.cooldownLeft = unit.cooldown * Game.clamp(1 + unit.suppressionValue / 160, 0.6, 1.8) * xpReloadMod;
    }
};

/**
 * Direct-fire "attack ground": take up a firing position within range + line of
 * sight of the commanded spot, then suppress it. Unlike a mortar, the unit does
 * not lob over cover — it needs LOS, and it stops short rather than walking onto
 * the point.
 */
Game.updateGroundFire = (unit, dt, weapon) => {
    const tx = unit.bombardX, tz = unit.bombardZ;
    // If the spot is a building, the building's own walls block LOS to its centre,
    // so validate LOS + range to its near edge — otherwise units never fire on it.
    const bRec = Game.buildingAt ? Game.buildingAt(tx, tz) : null;
    const losTgt = (bRec && Game.buildingNearPoint) ? Game.buildingNearPoint(bRec, unit.x, unit.z) : { x: tx, z: tz };
    const d = Game.dist(unit.x, unit.z, losTgt.x, losTgt.z);
    const losClear = Game.lineOfSight(unit, losTgt) !== false;
    const canHit = d <= unit.range && losClear;

    if (!canHit) {
        // Move into a firing position (within range + LOS), re-pathing periodically.
        unit._bombarding = false;
        unit._gfTimer = (unit._gfTimer || 0) - dt;
        if (!unit.moving || unit._gfTimer <= 0) {
            unit._gfTimer = 0.6;
            const ang = Game.angleTo(tx, tz, unit.x, unit.z);
            const standoff = Math.max(2, Math.min(unit.range * 0.8, d * 0.6));
            const gx = Game.clamp(tx + Math.cos(ang) * standoff, 1, Game.WORLD_W - 1);
            const gz = Game.clamp(tz + Math.sin(ang) * standoff, 1, Game.WORLD_H - 1);
            unit.path = Game.findPath(unit, unit.x, unit.z, gx, gz);
            unit.moving = true;
        }
        return;
    }

    // In position — stop, face the spot, and fire on it.
    unit._bombarding = true;
    unit.path = [];
    unit.moving = false;
    unit.currentSpeed = 0;
    const aim = Game.angleTo(unit.x, unit.z, tx, tz);
    unit.angle = aim;
    unit.turretAngle = aim;
    if (unit.deployable && !unit._canFire) return; // still setting up
    if (unit.cooldownLeft <= 0) {
        Game.fireAtGround(unit, tx, tz, weapon);
        const xpReloadMod = 1 - (unit.experience || 0) * 0.0015;
        unit.cooldownLeft = unit.cooldown * Game.clamp(1 + unit.suppressionValue / 160, 0.6, 1.8) * xpReloadMod;
    }
};

/**
 * One direct round onto a ground point: tracer + dust, suppression (and, for HE,
 * light wounding + a crater) to anything caught near the impact.
 */
Game.fireAtGround = (unit, tx, tz, weapon) => {
    if (unit.ammo === 0) {
        unit.bombardX = null; unit.bombardZ = null; unit._bombarding = false;
        Game.pushMessage(`${unit.label} out of ammo.`, 1.5);
        return;
    }
    if (unit.ammo > 0) unit.ammo--;

    const isTank = Game.isTank(unit.kind);
    const acc = (weapon.accuracy?.medium ?? 0.6) + (unit.experience || 0) / 600;
    const scatter = Game.clamp((1 - acc) * 2.0, 0.3, 2.5);
    const ix = tx + Game.rand(-scatter, scatter);
    const iz = tz + Game.rand(-scatter, scatter);
    const mx = unit.x + Math.cos(unit.angle) * (unit.size || 1);
    const mz = unit.z + Math.sin(unit.angle) * (unit.size || 1);
    const d = Game.dist(mx, mz, ix, iz);

    Game.tracers.push({
        x: mx, z: mz, tx: ix, tz: iz,
        life: 0.1 + d / 90, total: 0.1 + d / 90,
        team: unit.team, big: isTank, mesh: null,
    });
    Game.smoke.push({
        x: ix, z: iz, r: 0.6, life: 0.5, total: 0.5,
        vx: Game.rand(-0.3, 0.3), vz: Game.rand(-0.5, -0.2), mesh: null,
    });

    // Area effect: suppress (HE also lightly wounds) enemies near the impact.
    const blastR = weapon.heBlast ? weapon.heBlast : (isTank ? 2.0 : 1.2);
    Game.units.forEach(u => {
        if (!u.alive || u.team === unit.team) return;
        const bd = Game.dist(ix, iz, u.x, u.z);
        if (bd >= blastR) return;
        const fall = 1 - bd / blastR;
        u.suppressionValue = Game.clamp((u.suppressionValue || 0) + (weapon.suppression || 12) * fall, 0, 100);
        u.shaken = Math.max(u.shaken || 0, 0.3);
        if (weapon.heBlast) {
            const armorMult = (typeof u.armor === 'number' && u.armor === 0) ? 1.0 : 0.2;
            u.hp -= (weapon.damage || 25) * fall * armorMult * 0.5;
            if (u.hp <= 0) {
                u.alive = false; u.hp = 0;
                if (u.mesh) u.mesh.visible = false;
                if (Game.selection.has(u.id)) Game.selection.delete(u.id);
            }
        }
    });

    if (weapon.heBlast) {
        // HE: round crater + dust column, both scaled by caliber (heBlast size).
        const cal = Game.clamp(weapon.heBlast / 2.2, 0.7, 2.2);
        Game.craters.push({ x: ix, z: iz, r: 0.4 * cal + Game.rand(0, 0.4 * cal) });
        if (Game.addBlastFlash) Game.addBlastFlash(ix, iz, cal);   // HE impact also damages buildings
    } else {
        // AP / kinetic: directional gouge + spark, no crater. Only penetrators
        // (tanks, AT guns) throw a visible dirt lance; small arms just chip.
        const ap = isTank || (weapon.penetration || 0) >= 2;
        if (ap && Game._apGroundImpact) {
            const ang = Math.atan2(iz - mz, ix - mx);
            Game._apGroundImpact(ix, iz, ang, isTank ? 1.0 : 0.7);
        }
        if (Game.damageBuildingAt) {
            // Light arms (infantry rifles/MGs) only ever scuff a building to light
            // damage; AP guns and tanks can wreck it.
            const lightArms = !isTank && (weapon.penetration || 0) < 2;
            Game.damageBuildingAt(ix, iz, (weapon.damage || 12) * 0.6, isTank ? 1.4 : 0.9,
                lightArms ? { maxLevel: 1 } : undefined);
        }
    }
    // Muzzle flash is purely visual — keep it below the blast thresholds so a
    // unit firing next to a building doesn't damage it from its own muzzle.
    if (Game.addBlastFlash) Game.addBlastFlash(mx, mz, isTank ? 0.45 : 0.3);
    Game.cameraShake = Math.max(Game.cameraShake || 0, 0.3);
};

Game.fireBombard = (unit, tx, tz, weapon) => {
    if (unit.ammo === 0) {
        unit.bombardX = null; unit.bombardZ = null;
        Game.pushMessage(`${unit.label} out of ammo.`, 1.5);
        return;
    }
    if (unit.ammo > 0) unit.ammo--;

    // Scatter shrinks with crew skill; first rounds land wider
    const acc = (weapon.accuracy?.medium ?? 0.5) + (unit.veterancy || 0) * 0.2 + (unit.experience || 0) / 600;
    const scatter = Game.clamp((1 - acc) * 3.0, 0.5, 4.0);
    const sx = tx + Game.rand(-scatter, scatter);
    const sz = tz + Game.rand(-scatter, scatter);
    const d = Game.dist(unit.x, unit.z, tx, tz);

    // Muzzle puff + faint kick
    Game.smoke.push({
        x: unit.x, z: unit.z, r: 0.5, life: 0.4, total: 0.4,
        vx: Game.rand(-0.3, 0.3), vz: Game.rand(-0.9, -0.4), mesh: null,
    });
    Game.cameraShake = Math.max(Game.cameraShake || 0, 0.5);

    Game.indirectShells.push({
        sx, sz, t: 1.0 + d / 140,
        blast: weapon.heBlast || 3,
        dmg: weapon.damage || 30,
        supp: weapon.suppression || 15,
        team: unit.team,
    });
};

Game.updateIndirectShells = (dt) => {
    for (let i = Game.indirectShells.length - 1; i >= 0; i--) {
        const s = Game.indirectShells[i];
        s.t -= dt;
        if (s.t > 0) continue;
        const blastR = s.blast;
        Game.units.forEach(u => {
            if (!u.alive) return;
            const bd = Game.dist(s.sx, s.sz, u.x, u.z);
            if (bd >= blastR) return;
            const falloff = 1 - bd / blastR;
            // HE is brutal to infantry, weak against armor
            const armorMult = (typeof u.armor === 'number' && u.armor === 0) ? 1.0 : 0.22;
            u.hp -= s.dmg * falloff * armorMult;
            u.suppressionValue = Game.clamp(u.suppressionValue + s.supp * falloff, 0, 100);
            u.shaken = 0.4;
            if (u.hp <= 0) {
                u.alive = false; u.hp = 0;
                if (u.mesh) u.mesh.visible = false;
                if (Game.selection.has(u.id)) Game.selection.delete(u.id);
            }
        });
        Game.smoke.push({
            x: s.sx, z: s.sz, r: blastR * 0.7, life: 1.0, total: 1.0,
            vx: Game.rand(-0.4, 0.4), vz: Game.rand(-1.0, -0.4), mesh: null,
        });
        Game.craters.push({ x: s.sx, z: s.sz, r: Game.rand(0.5, 1.0) });
        Game.cameraShake = Math.max(Game.cameraShake || 0, 3);
        Game.lastAttackPos = { x: s.sx, z: s.sz };
        if (Game.Audio) Game.Audio.explosion(s.sx, s.sz);
        Game.addBlastFlash(s.sx, s.sz, s.blast * 0.5);
        Game.indirectShells.splice(i, 1);
    }
};

// ═══════════════════════════════════════════════════════
//  GRENADE SYSTEM
// ═══════════════════════════════════════════════════════

// ── Thrown projectiles (frag / smoke / anti-tank) ──────────────────────────
// Game-loop driven so they pause with the game, arc visibly toward the target,
// and detonate on landing. Shared by the player's Grenade/Smoke orders and the
// enemy tank-hunter AI.
Game.MAX_THROW = 14;          // max throw distance (world units)
Game.thrownGrenades = [];

Game._makeThrownMesh = (color) => {
    const THREE = Game.THREE;
    if (!THREE || !Game.scene) return null;
    const geo = new THREE.SphereGeometry(0.13, 8, 6);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
    m.castShadow = true;
    m.raycast = () => { };
    Game.scene.add(m);
    return m;
};

Game.spawnThrownGrenade = (fromX, fromZ, tx, tz, opts = {}) => {
    const x0 = fromX, z0 = fromZ;
    const dur = opts.dur || (0.35 + Game.dist(x0, z0, tx, tz) * 0.045);
    Game.thrownGrenades.push({
        x0, z0, tx, tz, x: x0, z: z0,
        y: (Game.getHeight ? Game.getHeight(x0, z0) : 0) + 0.6,
        t: 0, dur,
        type: opts.type || 'frag',                 // 'frag' | 'smoke' | 'at'
        dmg: opts.dmg ?? 25,
        blastR: opts.blastR ?? 2.5,
        supp: opts.supp ?? 40,
        arc: opts.arc ?? 2.0,
        mesh: Game._makeThrownMesh(opts.type === 'smoke' ? 0x9aa0a6 : 0x2c2e27),
    });
};

Game._detonateThrown = (g) => {
    if (g.type === 'smoke') {
        Game.smokeClouds.push({ x: g.tx, z: g.tz, radius: 5, life: 12.0 });
        for (let k = 0; k < 5; k++) {
            Game.smoke.push({
                x: g.tx + Game.rand(-1, 1), z: g.tz + Game.rand(-1, 1),
                r: 2.2, life: 12.0, total: 12.0,
                vx: Game.rand(-0.2, 0.2), vz: Game.rand(-0.3, -0.1), mesh: null,
            });
        }
        Game.pushMessage('Smoke screen up.', 1.2);
        return;
    }
    const blastR = g.blastR;
    Game.units.forEach(u => {
        if (!u.alive) return;
        const bd = Game.dist(g.tx, g.tz, u.x, u.z);
        if (bd >= blastR) return;
        const falloff = 1 - bd / blastR;
        let dmg = g.dmg * falloff;
        // AT bundle wrecks armour but is poor against troops; frag is the reverse.
        if (g.type === 'at') dmg *= Game.isTank(u.kind) ? 1.0 : 0.4;
        else dmg *= Game.isTank(u.kind) ? 0.25 : 1.0;
        u.hp -= dmg;
        u.suppressionValue = Math.min(100, u.suppressionValue + g.supp * falloff);
        u.shaken = 0.4;
        if (u.hp <= 0) {
            u.alive = false; u.hp = 0;
            if (u.mesh) u.mesh.visible = false;
            if (Game.selection.has(u.id)) Game.selection.delete(u.id);
        }
    });
    Game.smoke.push({
        x: g.tx, z: g.tz, r: g.type === 'at' ? 1.3 : 1.0,
        life: 0.9, total: 0.9, vx: Game.rand(-0.3, 0.3), vz: Game.rand(-0.8, -0.3), mesh: null,
    });
    Game.craters.push({ x: g.tx, z: g.tz, r: Game.rand(0.3, 0.6) });
    Game.cameraShake = Math.max(Game.cameraShake || 0, g.type === 'at' ? 5 : 3);
    if (Game.Audio) Game.Audio.explosion(g.tx, g.tz);
    Game.addBlastFlash(g.tx, g.tz, g.type === 'at' ? 1.3 : 1.0);
};

Game.updateThrownGrenades = (dt) => {
    for (let i = Game.thrownGrenades.length - 1; i >= 0; i--) {
        const g = Game.thrownGrenades[i];
        g.t += dt;
        const p = Math.min(1, g.t / g.dur);
        g.x = Game.lerp(g.x0, g.tx, p);
        g.z = Game.lerp(g.z0, g.tz, p);
        const ground = Game.getHeight ? Game.getHeight(g.x, g.z) : 0;
        g.y = ground + 0.5 + Math.sin(p * Math.PI) * g.arc;
        if (g.mesh) g.mesh.position.set(g.x, g.y, g.z);
        if (p >= 1) {
            Game._detonateThrown(g);
            if (g.mesh) {
                Game.scene.remove(g.mesh);
                g.mesh.geometry.dispose();
                g.mesh.material.dispose();
            }
            Game.thrownGrenades.splice(i, 1);
        }
    }
};

Game.throwGrenade = (unit, x, z) => {
    if (!unit || !unit.alive || Game.isTank(unit.kind)) return;
    unit._grenades = unit._grenades ?? 3;
    if (unit._grenades <= 0) {
        Game.pushMessage('No grenades left!', 1.5);
        return;
    }
    let d = Game.dist(unit.x, unit.z, x, z);
    // Clamp an over-long throw to max range along the same bearing instead of refusing.
    if (d > Game.MAX_THROW) {
        const a = Game.angleTo(unit.x, unit.z, x, z);
        x = unit.x + Math.cos(a) * Game.MAX_THROW;
        z = unit.z + Math.sin(a) * Game.MAX_THROW;
    }
    unit._grenades--;
    unit.angle = Game.angleTo(unit.x, unit.z, x, z);
    Game.spawnThrownGrenade(unit.x, unit.z, x, z, { type: 'frag', dmg: 28, blastR: 2.6, supp: 40 });
    Game.pushMessage(`Grenade out! (${unit._grenades} left)`, 1.2);
    if (Game.Audio) Game.Audio.voice('f_sold_attack');
};

// ═══════════════════════════════════════════════════════
//  SMOKE GRENADE SYSTEM
// ═══════════════════════════════════════════════════════

Game.smokeClouds = [];

Game.throwSmoke = (unit, x, z) => {
    if (!unit || !unit.alive || Game.isTank(unit.kind)) return;
    unit._smokeGrenades = unit._smokeGrenades ?? 2;
    if (unit._smokeGrenades <= 0) {
        Game.pushMessage('No smoke grenades left!', 1.5);
        return;
    }
    let d = Game.dist(unit.x, unit.z, x, z);
    if (d > Game.MAX_THROW) {
        const a = Game.angleTo(unit.x, unit.z, x, z);
        x = unit.x + Math.cos(a) * Game.MAX_THROW;
        z = unit.z + Math.sin(a) * Game.MAX_THROW;
    }
    unit._smokeGrenades--;
    unit.angle = Game.angleTo(unit.x, unit.z, x, z);
    Game.spawnThrownGrenade(unit.x, unit.z, x, z, { type: 'smoke', arc: 1.6 });
    Game.pushMessage(`Smoke thrown! (${unit._smokeGrenades} left)`, 1.4);
    if (Game.Audio) Game.Audio.voice('f_sold_move');
};

Game.updateSmokeClouds = (dt) => {
    for (let i = Game.smokeClouds.length - 1; i >= 0; i--) {
        Game.smokeClouds[i].life -= dt;
        if (Game.smokeClouds[i].life <= 0) {
            Game.smokeClouds.splice(i, 1);
        }
    }
};

// ═══════════════════════════════════════════════════════
//  VEHICLE ENTRY / EXIT / CAPTURE
// ═══════════════════════════════════════════════════════

Game.enterVehicle = (infantry, vehicle) => {
    if (!infantry.alive || !vehicle || Game.isTank(infantry.kind)) return;
    if (vehicle.alive) return; // Must be abandoned
    // Revive vehicle with infantry as crew
    vehicle.alive = true;
    vehicle.team = infantry.team;
    vehicle.hp = Math.max(vehicle.hp, vehicle.maxHp * 0.3); // At least 30% HP
    vehicle.experience = infantry.experience || 0;
    if (vehicle.mesh) vehicle.mesh.visible = true;
    // Remove infantry
    infantry.alive = false;
    infantry.hp = 0;
    if (infantry.mesh) infantry.mesh.visible = false;
    Game.pushMessage(`${infantry.label} captured ${vehicle.label}!`, 3.0);
};

Game.exitVehicle = (vehicle) => {
    if (!vehicle.alive || !Game.isTank(vehicle.kind)) return;
    // Spawn crew member next to vehicle
    const crewKind = vehicle.team === Game.TEAM.FRENCH ? 'fusilier' : 'grenadier';
    const crew = Game.makeUnit(vehicle.team, crewKind,
        vehicle.x + Game.rand(-1.5, 1.5),
        vehicle.z + Game.rand(-1.5, 1.5),
        { aiState: 'player' }
    );
    if (crew) crew.experience = vehicle.experience || 0;
    // Abandon vehicle
    vehicle.alive = false;
    if (vehicle.mesh) vehicle.mesh.visible = false;
    Game.pushMessage(`Crew exited ${vehicle.label}.`, 2.0);
};

// ═══════════════════════════════════════════════════════
//  ENTRENCHMENT
// ═══════════════════════════════════════════════════════

Game.entrenchUnit = (unit) => {
    if (unit.entrenched) {
        unit.entrenched = false;
        unit.coverBonus = 0;
        Game.pushMessage(`${unit.label} un-entrenched.`, 1.5);
    } else {
        unit.entrenched = true;
        unit.coverBonus = 0.5;
        unit.path = [];
        unit.moving = false;
        Game.pushMessage(`${unit.label} entrenched!`, 1.5);
    }
};

// ═══════════════════════════════════════════════════════
//  ENGINEER FIELD DEFENSES (sandbag emplacements)
// ═══════════════════════════════════════════════════════

// A sapper stacks a low sandbag wall just ahead of itself. Unlike entrenchment
// (self-only dig-in), it's a placed object that gives cover to ANY friendly unit
// who fights from behind it (see computeCover / coverAt). Limited supply.
Game.buildSandbag = (unit) => {
    if (!unit.alive || unit.supportType !== 'sapper') {
        Game.pushMessage('Select a sapper to build sandbags.', 1.5);
        return;
    }
    unit._sandbags = unit._sandbags ?? 3;
    if (unit._sandbags <= 0) { Game.pushMessage('No sandbags left!', 1.5); return; }
    unit._sandbags--;
    const fx = unit.x + Math.cos(unit.angle) * 1.0;
    const fz = unit.z + Math.sin(unit.angle) * 1.0;
    const def = { x: fx, z: fz, cover: 0.55, team: unit.team, mesh: null };
    if (Game.scene && Game.THREE && Game.terrainGroup) {
        const THREE = Game.THREE;
        const grp = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({ color: 0x9b8b5e, roughness: 1.0 });
        for (let k = -1; k <= 1; k++) {
            const bag = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.5), mat);
            bag.position.set(k * 0.5, 0.2, 0);
            bag.castShadow = true;
            grp.add(bag);
        }
        grp.position.set(fx, (Game.getHeight ? Game.getHeight(fx, fz) : 0), fz);
        grp.rotation.y = -unit.angle;
        Game.terrainGroup.add(grp);
        def.mesh = grp;
    }
    Game.defenses.push(def);
    Game.pushMessage(`Sandbags built (${unit._sandbags} left).`, 1.4);
};

// ═══════════════════════════════════════════════════════
//  MINE SYSTEM
// ═══════════════════════════════════════════════════════

Game.mines = [];

Game.layMine = (unit) => {
    if (!unit.alive) return;
    unit._mines = unit._mines ?? 2;
    if (unit._mines <= 0) {
        Game.pushMessage('No mines left!', 1.5);
        return;
    }
    unit._mines--;
    const mine = { x: unit.x, z: unit.z, team: unit.team, armed: true, mesh: null };
    // The laying side can see its own minefield (faint disc); enemy mines stay hidden.
    if (mine.team === Game.TEAM.FRENCH && Game.scene && Game.THREE && Game.effectsGroup) {
        const THREE = Game.THREE;
        const m = new THREE.Mesh(
            new THREE.CircleGeometry(0.5, 14),
            new THREE.MeshBasicMaterial({ color: 0x8a6a3c, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })
        );
        m.rotation.x = -Math.PI / 2;
        m.position.set(mine.x, (Game.getHeight ? Game.getHeight(mine.x, mine.z) : 0) + 0.06, mine.z);
        Game.effectsGroup.add(m);
        mine.mesh = m;
    }
    Game.mines.push(mine);
    Game.pushMessage('Mine placed!', 1.0);
};

Game._removeMine = (mine, i) => {
    if (mine.mesh && Game.effectsGroup) {
        Game.effectsGroup.remove(mine.mesh);
        mine.mesh.geometry.dispose();
        mine.mesh.material.dispose();
    }
    Game.mines.splice(i, 1);
};

Game.updateMines = (dt) => {
    for (let i = Game.mines.length - 1; i >= 0; i--) {
        const mine = Game.mines[i];
        if (!mine.armed) continue;
        for (const u of Game.units) {
            if (!u.alive || u.team === mine.team) continue;
            const d = Game.dist(u.x, u.z, mine.x, mine.z);
            // An enemy sapper carefully defuses the mine instead of setting it off.
            if (u.supportType === 'sapper' && d < 1.4) {
                if (Game.isFogVisible && Game.isFogVisible(mine.x, mine.z)) {
                    Game.pushMessage('Mine cleared.', 1.2);
                }
                Game._removeMine(mine, i);
                break;
            }
            // Only vehicles are heavy enough to trip an AT mine.
            if (Game.isTank(u.kind) && d < 1.5) {
                u.hp -= 60;
                u.tracksDisabled = true;
                u.speed = 0;
                u.shaken = 0.5;
                Game.cameraShake = Math.max(Game.cameraShake, 5);
                Game.smoke.push({
                    x: mine.x, z: mine.z, r: 1.5, life: 1.0, total: 1.0,
                    vx: 0, vz: Game.rand(-0.5, -0.2), mesh: null,
                });
                Game.craters.push({ x: mine.x, z: mine.z, r: Game.rand(0.4, 0.8) });
                Game.lastAttackPos = { x: mine.x, z: mine.z };
                if (Game.Audio) Game.Audio.explosion(mine.x, mine.z);
                Game.addBlastFlash(mine.x, mine.z, 1.4);
                Game.pushMessage(`Mine detonated! ${u.label} tracks disabled!`, 2.5);
                // Blast catches nearby enemy infantry too.
                Game.units.forEach(v => {
                    if (!v.alive || v.team === mine.team || Game.isTank(v.kind)) return;
                    const bd = Game.dist(mine.x, mine.z, v.x, v.z);
                    if (bd >= 3) return;
                    const fall = 1 - bd / 3;
                    v.hp -= 35 * fall;
                    v.suppressionValue = Game.clamp((v.suppressionValue || 0) + 45 * fall, 0, 100);
                    v.shaken = Math.max(v.shaken || 0, 0.4);
                    if (v.hp <= 0) { v.alive = false; v.hp = 0; if (v.mesh) v.mesh.visible = false; if (Game.selection.has(v.id)) Game.selection.delete(v.id); }
                });
                if (u.hp <= 0) {
                    u.alive = false;
                    u.hp = 0;
                    if (u.mesh) u.mesh.visible = false;
                }
                Game._removeMine(mine, i);
                break;
            }
        }
    }
};

// ═══════════════════════════════════════════════════════
//  TOWING
// ═══════════════════════════════════════════════════════

// Anything with an engine can tow: tanks, armored cars, and the trucks.
Game.canTow = (u) => Game.isVehicle(u) || ['supply', 'fuel'].includes(u.supportType);

Game.towUnit = (tower, target) => {
    if (!tower.alive || !target.alive) return;
    if (!Game.canTow(tower)) return;
    if (!target.deployable) { Game.pushMessage('Only guns can be towed.', 1.5); return; }
    if (target._towed) return;
    target._towed = true;
    target._towedBy = tower.id;
    target.path = [];
    target.moving = false;
    target.deployed = false; target._deployT = 0; // rides limbered
    Game.pushMessage(`${tower.label} is towing ${target.label}.`, 2.0);
};

Game.updateTowing = (dt) => {
    Game.units.forEach(u => {
        if (!u.alive || !u._towed) return;
        const tower = Game.units.find(t => t.id === u._towedBy && t.alive);
        if (!tower) {
            u._towed = false;
            u._towedBy = null;
            return;
        }
        // Follow the towing vehicle
        u.x = tower.x - Math.cos(tower.angle) * 2.0;
        u.z = tower.z - Math.sin(tower.angle) * 2.0;
        u.angle = tower.angle;
    });
    // A destroyed carrier spills its passengers (shaken and wounded).
    Game.units.forEach(c => {
        if (!c._passengers || !c._passengers.length || c.alive) return;
        c._passengers.forEach(pid => {
            const inf = Game.getUnitById(pid);
            if (!inf || !inf.alive) return;
            inf._inVehicle = null;
            if (inf.mesh) inf.mesh.visible = true;
            inf.x = c.x + Game.rand(-2, 2); inf.z = c.z + Game.rand(-2, 2);
            inf.hp = Math.max(1, inf.hp - 40);
            inf.suppressionValue = Game.clamp((inf.suppressionValue || 0) + 50, 0, 100);
        });
        c._passengers = [];
    });
};

Game.untowUnit = (target) => {
    if (!target._towed) return;
    target._towed = false;
    target._towedBy = null;
    Game.pushMessage(`${target.label} un-towed.`, 1.5);
};

// ═══════════════════════════════════════════════════════
//  TROOP TRANSPORT (carry infantry in trucks)
// ═══════════════════════════════════════════════════════

Game.CARRIER_CAP = 5;
Game.isCarrier = (u) => ['supply', 'fuel'].includes(u.supportType);

Game.loadUnit = (inf, carrier) => {
    if (!inf.alive || !carrier.alive || inf === carrier) return false;
    if (inf.class === 'vehicle' || Game.isTank(inf.kind) || inf.deployable) return false; // foot troops only
    carrier._passengers = carrier._passengers || [];
    if (carrier._passengers.length >= Game.CARRIER_CAP) { Game.pushMessage(`${carrier.label} is full.`, 1.5); return false; }
    carrier._passengers.push(inf.id);
    inf._inVehicle = carrier.id;
    inf.path = []; inf.moving = false;
    if (inf.mesh) inf.mesh.visible = false;
    if (Game.selection.has(inf.id)) Game.selection.delete(inf.id);
    return true;
};

Game.unloadCarrier = (carrier) => {
    if (!carrier._passengers || !carrier._passengers.length) return;
    let n = 0;
    carrier._passengers.forEach((pid, i, arr) => {
        const inf = Game.getUnitById(pid);
        if (!inf || !inf.alive) return;
        const a = (i / arr.length) * Math.PI * 2;
        inf.x = Game.clamp(carrier.x + Math.cos(a) * 2.2, 1, Game.WORLD_W - 1);
        inf.z = Game.clamp(carrier.z + Math.sin(a) * 2.2, 1, Game.WORLD_H - 1);
        inf._inVehicle = null;
        inf.path = []; inf.moving = false;
        if (inf.mesh) inf.mesh.visible = true;
        n++;
    });
    carrier._passengers = [];
    Game.pushMessage(`${carrier.label} unloaded ${n} troops.`, 1.8);
};

// ═══════════════════════════════════════════════════════
//  RECON PLANE
// ═══════════════════════════════════════════════════════

Game.reconAreas = [];

Game.callRecon = (x, z) => {
    Game.reconAreas.push({ x, z, radius: 20, life: 10.0 });
    Game.pushMessage('Recon plane dispatched!', 2.0);
};

Game.updateRecon = (dt) => {
    for (let i = Game.reconAreas.length - 1; i >= 0; i--) {
        Game.reconAreas[i].life -= dt;
        if (Game.reconAreas[i].life <= 0) {
            Game.reconAreas.splice(i, 1);
        }
    }
};

// Check if a position is revealed by recon
Game.isReconRevealed = (x, z) => {
    for (const area of Game.reconAreas) {
        if (Game.dist(x, z, area.x, area.z) < area.radius) return true;
    }
    return false;
};

// ═══════════════════════════════════════════════════════
//  BUILDING GARRISON
// ═══════════════════════════════════════════════════════

Game.enterBuilding = (unit, bx, bz) => {
    if (!unit.alive || Game.isTank(unit.kind)) return;
    const rec = Game.buildingRecAt ? Game.buildingRecAt(bx, bz) : null;
    if (!rec || rec.collapsed) {
        Game.pushMessage('Must target a standing building!', 1.5);
        return;
    }
    if (!Game.buildingHasRoom(rec)) {
        Game.pushMessage(`Building full (${rec.occupants.length}/${rec.capacity}).`, 1.8);
        return;
    }
    if (Game.garrisonUnit(unit, rec)) {
        Game.pushMessage(`${unit.label} garrisoned (${rec.occupants.length}/${rec.capacity}).`, 1.8);
    }
};

Game.exitBuilding = (unit) => {
    if (!unit._garrisoned) return;
    if (Game.ungarrisonUnit) Game.ungarrisonUnit(unit);
    else { unit._garrisoned = false; unit.coverBonus = 0; if (unit.mesh) unit.mesh.visible = true; }
    unit.x += Game.rand(-1.5, 1.5);
    unit.z += Game.rand(-1.5, 1.5);
    Game.pushMessage(`${unit.label} exited building.`, 1.5);
};

// ═══════════════════════════════════════════════════════
//  WEATHER SYSTEM
// ═══════════════════════════════════════════════════════

Game.weatherEffect = 'clear'; // 'clear', 'rain', 'snow'

Game.getWeatherSpeedMod = () => {
    if (Game.weatherEffect === 'rain') return 0.9;
    if (Game.weatherEffect === 'snow') return 0.85;
    return 1.0;
};

Game.getWeatherVisibilityMod = () => {
    if (Game.weatherEffect === 'rain') return 0.8;
    if (Game.weatherEffect === 'snow') return 0.7;
    return 1.0;
};

// Check if LOS passes through smoke
Game.isInSmoke = (x, z) => {
    for (const cloud of Game.smokeClouds) {
        if (Game.dist(x, z, cloud.x, cloud.z) < cloud.radius) return true;
    }
    return false;
};

// ═══════════════════════════════════════════════════════
//  FOG OF WAR
// ═══════════════════════════════════════════════════════

Game.fogGrid = null;
Game.FOG_RES = 2; // fog cells per world unit
Game.FOG_UPDATE_INTERVAL = 0.12; // seconds between fog recomputes

Game.initFogOfWar = () => {
    const cols = Math.ceil(Game.WORLD_W * Game.FOG_RES);
    const rows = Math.ceil(Game.WORLD_H * Game.FOG_RES);
    Game.fogGrid = new Float32Array(cols * rows); // 0=hidden, 0.5=explored, 1=visible
    Game.fogCols = cols;
    Game.fogRows = rows;

    // Create 3D fog overlay canvas + mesh
    const THREE = Game.THREE;
    const fogCanvas = document.createElement('canvas');
    fogCanvas.width = 256;
    fogCanvas.height = 256;
    Game._fogCanvas = fogCanvas;
    Game._fogCtx = fogCanvas.getContext('2d');
    Game._fogTex = new THREE.CanvasTexture(fogCanvas);
    Game._fogTex.minFilter = THREE.LinearFilter;
    Game._fogTex.magFilter = THREE.LinearFilter;

    // Drape the fog sheet over the terrain, high enough to cover trees/roofs
    const fogGeo = new THREE.PlaneGeometry(Game.WORLD_W, Game.WORLD_H, 128, 128);
    fogGeo.rotateX(-Math.PI / 2);
    const fpos = fogGeo.attributes.position;
    for (let i = 0; i < fpos.count; i++) {
        const wx = fpos.getX(i) + Game.WORLD_W / 2;
        const wz = fpos.getZ(i) + Game.WORLD_H / 2;
        fpos.setY(i, Game.getHeight(wx, wz) + 5.5);
    }
    const fogMat = new THREE.MeshBasicMaterial({
        map: Game._fogTex,
        transparent: true,
        depthWrite: false,
        depthTest: false,   // dim by map position regardless of height, so tall
                            // tree tops don't poke above the sheet and stay bright
        side: THREE.DoubleSide,
    });
    Game._fogMesh = new THREE.Mesh(fogGeo, fogMat);
    Game._fogMesh.position.set(Game.WORLD_W / 2, 0, Game.WORLD_H / 2);
    Game._fogMesh.renderOrder = 999;
    Game._fogMesh.raycast = () => { }; // Don't intercept mouse raycasts
    Game.scene.add(Game._fogMesh);
};

Game.updateFogOfWar = (dt) => {
    if (!Game.fogGrid) return;
    // Throttled — fog doesn't need per-frame recompute
    Game._fogTimer = (Game._fogTimer || 0) - (dt || 0.016);
    if (Game._fogTimer > 0) return;
    Game._fogTimer = Game.FOG_UPDATE_INTERVAL;
    // Decay visible to explored
    for (let i = 0; i < Game.fogGrid.length; i++) {
        if (Game.fogGrid[i] > 0.5) Game.fogGrid[i] = 0.5;
    }
    // Reveal around friendly units
    Game.units.forEach(u => {
        if (!u.alive || u.team !== Game.TEAM.FRENCH) return;
        const baseSight = u._binocularTimer > 0 ? u.sight * 2 : u.sight;
        // LOS refresh delay: moving units have reduced sight (SS mechanic)
        const isOfficer = Game.UNIT_STATS[u.statKey]?.supportType === 'officer';
        const movePenalty = u.moving ? (isOfficer ? 0.8 : 0.6) : 1.0;
        const sight = (baseSight + (u._officerSightBonus || 0)) * movePenalty;
        const sightTiles = Math.ceil(sight * Game.FOG_RES);
        const cx = Math.floor(u.x * Game.FOG_RES);
        const cz = Math.floor(u.z * Game.FOG_RES);
        for (let dz = -sightTiles; dz <= sightTiles; dz++) {
            for (let dx = -sightTiles; dx <= sightTiles; dx++) {
                if (dx * dx + dz * dz > sightTiles * sightTiles) continue;
                const gx = cx + dx;
                const gz = cz + dz;
                if (gx >= 0 && gx < Game.fogCols && gz >= 0 && gz < Game.fogRows) {
                    Game.fogGrid[gz * Game.fogCols + gx] = 1.0;
                }
            }
        }
    });

    // Render fog overlay to canvas
    if (Game._fogCtx) {
        const ctx = Game._fogCtx;
        const w = 256, h = 256;
        const imgData = ctx.createImageData(w, h);
        const data = imgData.data;
        for (let py = 0; py < h; py++) {
            for (let px = 0; px < w; px++) {
                const gx = Math.floor((px / w) * Game.fogCols);
                const gz = Math.floor((py / h) * Game.fogRows);
                const fogVal = (gx >= 0 && gx < Game.fogCols && gz >= 0 && gz < Game.fogRows)
                    ? Game.fogGrid[gz * Game.fogCols + gx] : 0;
                const idx = (py * w + px) * 4;
                data[idx] = 0;     // R
                data[idx + 1] = 0; // G
                data[idx + 2] = 0; // B
                if (fogVal >= 1.0) {
                    data[idx + 3] = 0;    // Visible = transparent
                } else if (fogVal > 0) {
                    data[idx + 3] = 115;  // Explored = readable dim
                } else {
                    data[idx + 3] = 215;  // Hidden = nearly opaque
                }
            }
        }
        ctx.putImageData(imgData, 0, 0);

        // Smooth fog edges with a canvas blur pass
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = w;
        tmpCanvas.height = h;
        const tmpCtx = tmpCanvas.getContext('2d');
        tmpCtx.filter = 'blur(3px)';
        tmpCtx.drawImage(ctx.canvas, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(tmpCanvas, 0, 0);

        Game._fogTex.needsUpdate = true;
    }
};

Game.isFogVisible = (x, z) => {
    if (!Game.fogGrid) return true;
    const gx = Math.floor(x * Game.FOG_RES);
    const gz = Math.floor(z * Game.FOG_RES);
    if (gx < 0 || gx >= Game.fogCols || gz < 0 || gz >= Game.fogRows) return false;
    return Game.fogGrid[gz * Game.fogCols + gx] >= 1.0;
};

Game.isFogExplored = (x, z) => {
    if (!Game.fogGrid) return true;
    const gx = Math.floor(x * Game.FOG_RES);
    const gz = Math.floor(z * Game.FOG_RES);
    if (gx < 0 || gx >= Game.fogCols || gz < 0 || gz >= Game.fogRows) return false;
    return Game.fogGrid[gz * Game.fogCols + gx] > 0;
};

// ═══════════════════════════════════════════════════════
//  CAMOUFLAGE
// ═══════════════════════════════════════════════════════

Game.updateCamouflage = () => {
    Game.units.forEach(u => {
        if (!u.alive) return;
        const tile = Game.getTileAtWorld(u.x, u.z);
        u._camouflaged = tile && (tile.type === 'forest' || tile.type === 'dense_forest' || tile.type === 'hedge');
    });
};

// ═══════════════════════════════════════════════════════
//  TNT / DEMOLITIONS
// ═══════════════════════════════════════════════════════

Game.throwTNT = (unit, tx, tz) => {
    if (!unit.alive) return;
    unit._tntCharges = unit._tntCharges ?? 1;
    if (unit._tntCharges <= 0) {
        Game.pushMessage('No TNT charges left!', 1.5);
        return;
    }
    unit._tntCharges--;
    // Delayed detonation (2s fuse)
    setTimeout(() => {
        // AoE 80 damage in 3.5 radius
        Game.units.forEach(u => {
            if (!u.alive) return;
            const d = Game.dist(u.x, u.z, tx, tz);
            if (d < 3.5) {
                const dmg = 80 * (1 - d / 3.5);
                u.hp -= dmg;
                u.shaken = 0.5;
                if (u.hp <= 0) { u.alive = false; u.hp = 0; if (u.mesh) u.mesh.visible = false; }
            }
        });
        Game.cameraShake = Math.max(Game.cameraShake || 0, 8);
        Game.craters.push({ x: tx, z: tz, r: Game.rand(1.0, 2.0) });
        Game.smoke.push({ x: tx, z: tz, r: 2.5, life: 1.5, total: 1.5, vx: 0, vz: Game.rand(-0.5, -0.2), mesh: null });
        Game.lastAttackPos = { x: tx, z: tz };
        if (Game.Audio) Game.Audio.explosion(tx, tz);
        Game.addBlastFlash(tx, tz, 1.8);
        Game.pushMessage('TNT detonated!', 2.0);
    }, 2000);
    Game.pushMessage('TNT fuse lit! 2 seconds...', 2.0);
};

// ═══════════════════════════════════════════════════════
//  BINOCULARS
// ═══════════════════════════════════════════════════════

Game.useBinoculars = (unit) => {
    if (!unit.alive) return;
    unit._binocularTimer = 8.0; // 8 seconds extended vision
    unit._originalSight = unit._originalSight || unit.sight;
    unit.sight = unit._originalSight * 2;
    Game.pushMessage(`${unit.label} using binoculars...`, 2.0);
};

Game.updateBinoculars = (dt) => {
    Game.units.forEach(u => {
        if (!u.alive || !u._binocularTimer) return;
        u._binocularTimer -= dt;
        if (u._binocularTimer <= 0) {
            u._binocularTimer = 0;
            u.sight = u._originalSight || u.sight;
            u._originalSight = null;
        }
    });
};

// ═══════════════════════════════════════════════════════
//  ELITE CREWS
// ═══════════════════════════════════════════════════════

Game.updateEliteCrews = () => {
    Game.units.forEach(u => {
        if (!u.alive || !Game.isTank(u.kind)) return;
        const prevElite = u._eliteCrew || false;
        u._eliteCrew = (u.experience || 0) >= 50;
        if (u._eliteCrew && !prevElite) {
            Game.pushMessage(`${u.label} crew is now elite!`, 3.0);
        }
    });
};

// ═══════════════════════════════════════════════════════
//  RAMMING
// ═══════════════════════════════════════════════════════

Game.ramVehicle = (attacker, target) => {
    if (!attacker.alive || !target.alive) return;
    if (!Game.isTank(attacker.kind) || !Game.isTank(target.kind)) return;
    const d = Game.dist(attacker.x, attacker.z, target.x, target.z);
    if (d > 3.0) {
        Game.pushMessage('Too far to ram! Get closer.', 1.5);
        return;
    }
    const ramDmg = 25 + (attacker.speed || 0) * 5;
    target.hp -= ramDmg;
    attacker.hp -= ramDmg * 0.3; // Self-damage
    target.tracksDisabled = Math.random() < 0.4;
    target.shaken = 0.6;
    attacker.shaken = 0.3;
    Game.cameraShake = Math.max(Game.cameraShake || 0, 4);
    if (target.hp <= 0) { target.alive = false; target.hp = 0; if (target.mesh) target.mesh.visible = false; }
    if (attacker.hp <= 0) { attacker.alive = false; attacker.hp = 0; if (attacker.mesh) attacker.mesh.visible = false; }
    Game.pushMessage(`${attacker.label} rammed ${target.label}!`, 2.5);
};

Game.updateHover = () => {
    Game.hoverUnit = null;
    const wx = Game.mouse.worldX, wz = Game.mouse.worldZ;
    let best = Infinity;
    for (const unit of Game.units) {
        if (!unit.alive) continue;
        const d = Game.distSq(wx, wz, unit.x, unit.z);
        const pick = (unit.size + 0.5) * (unit.size + 0.5) * 3;
        if (d < pick && d < best) {
            best = d;
            Game.hoverUnit = unit;
        }
    }
};

// ═══════════════════════════════════════════════════════
//  DYNAMIC LIGHTING & CLOUDS
// ═══════════════════════════════════════════════════════

Game.updateLighting = (dt) => {
    const t = Game.gameClock;
    const dynEnabled = document.getElementById('dbgDynLight')?.checked ?? true;

    const sunBase = Game._dbgSunBase ?? 5.05;
    const ambBase = Game._dbgAmbientBase ?? 2.1;
    const cloudBase = Game._dbgCloudBase ?? 0;

    if (dynEnabled) {
        // Slowly vary sun intensity — simulates clouds passing over
        if (Game.sun) {
            Game.sun.intensity = sunBase + Math.sin(t * 0.15) * 0.2
                + Math.sin(t * 0.07) * 0.15;
        }
        // Subtle ambient variation
        if (Game.ambient) {
            Game.ambient.intensity = ambBase + Math.sin(t * 0.1 + 1.0) * 0.08;
        }
        // Drift cloud shadow plane slowly across terrain
        if (Game.cloudShadow) {
            Game.cloudShadow.position.x = Game.WORLD_W / 2 + Math.sin(t * 0.02) * 15;
            Game.cloudShadow.position.z = Game.WORLD_H / 2 + t * 0.3;
            Game.cloudShadow.material.opacity = cloudBase + Math.sin(t * 0.12) * 0.04;
        }
    }
};

// ═══════════════════════════════════════════════════════
//  DEBUG CONTROLS
// ═══════════════════════════════════════════════════════

// Toggle debug panel with backtick key
document.addEventListener('keydown', (e) => {
    if (e.key === '`') {
        const panel = document.getElementById('debugPanel');
        if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
});

// Height scale slider
const dbgHeight = document.getElementById('dbgHeight');
const dbgHeightVal = document.getElementById('dbgHeightVal');
if (dbgHeight) {
    dbgHeight.addEventListener('input', () => {
        const v = parseFloat(dbgHeight.value);
        Game.HEIGHT_SCALE = v;
        dbgHeightVal.textContent = v.toFixed(2);
    });
}

// Smooth passes slider
const dbgSmooth = document.getElementById('dbgSmooth');
const dbgSmoothVal = document.getElementById('dbgSmoothVal');
if (dbgSmooth) {
    dbgSmooth.addEventListener('input', () => {
        dbgSmoothVal.textContent = dbgSmooth.value;
    });
}

// Crater height slider
const dbgCrater = document.getElementById('dbgCrater');
const dbgCraterVal = document.getElementById('dbgCraterVal');
if (dbgCrater) {
    dbgCrater.addEventListener('input', () => {
        const v = parseFloat(dbgCrater.value);
        Game.CRATER_Y_OFFSET = v;
        dbgCraterVal.textContent = v.toFixed(2);
    });
}

// Texture filter dropdown — applies to terrain texture immediately
const dbgTexFilter = document.getElementById('dbgTexFilter');
if (dbgTexFilter) {
    dbgTexFilter.addEventListener('change', () => {
        if (!Game.terrainMesh) return;
        const tex = Game.terrainMesh.material.map;
        if (!tex) return;
        const THREE = Game.THREE;
        const mode = dbgTexFilter.value;
        if (mode === 'nearest') {
            tex.magFilter = THREE.NearestFilter;
            tex.minFilter = THREE.NearestFilter;
        } else if (mode === 'linear') {
            tex.magFilter = THREE.LinearFilter;
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.anisotropy = 1;
        } else {
            tex.magFilter = THREE.LinearFilter;
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.anisotropy = Game.renderer.capabilities.getMaxAnisotropy();
        }
        tex.needsUpdate = true;
    });
}

// Texture scale slider — adjusts UV repeat
const dbgTexScale = document.getElementById('dbgTexScale');
const dbgTexScaleVal = document.getElementById('dbgTexScaleVal');
if (dbgTexScale) {
    dbgTexScale.addEventListener('input', () => {
        const v = parseFloat(dbgTexScale.value);
        dbgTexScaleVal.textContent = v.toFixed(1);
        if (!Game.terrainMesh) return;
        const tex = Game.terrainMesh.material.map;
        if (!tex) return;
        tex.repeat.set(v, v);
        tex.needsUpdate = true;
    });
}

// ── Terrain material controls ──
const _dbgSlider = (id, valId, cb) => {
    const el = document.getElementById(id);
    const val = document.getElementById(valId);
    if (el) el.addEventListener('input', () => { const v = parseFloat(el.value); if (val) val.textContent = v.toFixed(2); cb(v); });
};

_dbgSlider('dbgBump', 'dbgBumpVal', v => {
    if (Game.terrainMesh) { Game.terrainMesh.material.bumpScale = v; }
});

_dbgSlider('dbgRough', 'dbgRoughVal', v => {
    if (Game.terrainMesh) { Game.terrainMesh.material.roughness = v; }
});

_dbgSlider('dbgMetal', 'dbgMetalVal', v => {
    if (Game.terrainMesh) { Game.terrainMesh.material.metalness = v; }
});

const dbgFlatShade = document.getElementById('dbgFlatShade');
if (dbgFlatShade) {
    dbgFlatShade.addEventListener('change', () => {
        if (!Game.terrainMesh) return;
        Game.terrainMesh.material.flatShading = dbgFlatShade.checked;
        Game.terrainMesh.material.needsUpdate = true;
    });
}

// ── Lighting controls ──
_dbgSlider('dbgSun', 'dbgSunVal', v => {
    Game._dbgSunBase = v;
    if (Game.sun) Game.sun.intensity = v;
});

_dbgSlider('dbgAmbient', 'dbgAmbientVal', v => {
    Game._dbgAmbientBase = v;
    if (Game.ambient) Game.ambient.intensity = v;
});

_dbgSlider('dbgCloud', 'dbgCloudVal', v => {
    Game._dbgCloudBase = v;
    if (Game.cloudShadow) Game.cloudShadow.material.opacity = v;
});

// ── Camera controls ──
_dbgSlider('dbgCamTilt', 'dbgCamTiltVal', v => {
    Game.camTiltDeg = v; // read live by updateCamera (90 = straight down, lower = more oblique)
});
_dbgSlider('dbgZoomMin', 'dbgZoomMinVal', v => {
    Game.zoomMin = v;
});
_dbgSlider('dbgZoomMax', 'dbgZoomMaxVal', v => {
    Game.zoomMax = v;
});
_dbgSlider('dbgZoomCur', 'dbgZoomCurVal', v => {
    Game.cam.targetZoom = v;
});
// ── Tank Model Debug ──
Game._dbgTankFrozen = false; // when true, skip auto turret rotation

// Populate tank dropdown on debug panel open
Game.dbgPopulateTanks = () => {
    const sel = document.getElementById('dbgTankSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- select --</option>';
    Game.units.filter(u => u.alive && Game.isTank(u.kind)).forEach(u => {
        const opt = document.createElement('option');
        opt.value = u.id;
        opt.textContent = `${u.label} #${u.id} (${u.team})`;
        sel.appendChild(opt);
    });
};

// Scan a tank's FBX hierarchy and create rotation sliders for each named node
Game.dbgScanTank = () => {
    const sel = document.getElementById('dbgTankSelect');
    const container = document.getElementById('dbgTankNodes');
    if (!sel || !container) return;

    const id = parseInt(sel.value);
    const unit = Game.units.find(u => u.id === id);
    if (!unit || !unit.mesh) {
        container.innerHTML = '<div style="color:#d44">Select a tank first</div>';
        return;
    }

    // Freeze auto turret rotation while debugging
    Game._dbgTankFrozen = true;
    Game._dbgTankId = id;

    container.innerHTML = '';
    const header = document.createElement('div');
    header.style.cssText = 'color:#d8ba7b;margin-bottom:6px;font-weight:600';
    header.textContent = `${unit.label} — nodes:`;
    container.appendChild(header);

    // ── Model Center Offset Controls ──
    const modelInner = unit.mesh.children.find(c => c.name === 'modelWrapper');
    const innerModel = modelInner ? modelInner.children[0] : null;
    if (innerModel) {
        const centerSection = document.createElement('div');
        centerSection.style.cssText = 'margin:6px 0 10px;padding:6px;border:1px solid rgba(200,170,80,0.4);background:rgba(40,35,20,0.5);border-radius:3px';

        const centerTitle = document.createElement('div');
        centerTitle.style.cssText = 'color:#c9a45d;font-weight:700;margin-bottom:6px;font-size:11px';
        centerTitle.textContent = '⊕ Model Center Offset';
        centerSection.appendChild(centerTitle);

        const centerInfo = document.createElement('div');
        centerInfo.style.cssText = 'font-size:9px;color:#8a9a6a;margin-bottom:4px';
        centerInfo.textContent = `Current: X=${innerModel.position.x.toFixed(2)} Y=${innerModel.position.y.toFixed(2)} Z=${innerModel.position.z.toFixed(2)}`;
        centerSection.appendChild(centerInfo);

        ['x', 'y', 'z'].forEach(axis => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:4px;margin:3px 0';

            const label = document.createElement('span');
            label.style.cssText = 'color:#c9a45d;width:14px;font-weight:700';
            label.textContent = axis.toUpperCase();

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = '-100';
            slider.max = '100';
            slider.step = '0.5';
            slider.value = innerModel.position[axis].toString();
            slider.style.cssText = 'flex:1;max-width:100px';

            const val = document.createElement('span');
            val.style.cssText = 'font-family:monospace;color:#c9a45d;min-width:50px;text-align:right;font-size:10px';
            val.textContent = innerModel.position[axis].toFixed(1);

            slider.addEventListener('input', () => {
                const v = parseFloat(slider.value);
                innerModel.position[axis] = v;
                val.textContent = v.toFixed(1);
                centerInfo.textContent = `Current: X=${innerModel.position.x.toFixed(2)} Y=${innerModel.position.y.toFixed(2)} Z=${innerModel.position.z.toFixed(2)}`;
            });

            row.appendChild(label);
            row.appendChild(slider);
            row.appendChild(val);
            centerSection.appendChild(row);
        });

        // Also add wrapper position offset (Y ground snap)
        const wrapperTitle = document.createElement('div');
        wrapperTitle.style.cssText = 'color:#9ac;font-weight:600;margin:6px 0 4px;font-size:10px';
        wrapperTitle.textContent = 'Wrapper Y (Ground Snap)';
        centerSection.appendChild(wrapperTitle);

        const wrapRow = document.createElement('div');
        wrapRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin:3px 0';

        const wrapSlider = document.createElement('input');
        wrapSlider.type = 'range';
        wrapSlider.min = '-5';
        wrapSlider.max = '10';
        wrapSlider.step = '0.1';
        wrapSlider.value = modelInner.position.y.toString();
        wrapSlider.style.cssText = 'flex:1;max-width:120px';

        const wrapVal = document.createElement('span');
        wrapVal.style.cssText = 'font-family:monospace;color:#9ac;min-width:40px;text-align:right;font-size:10px';
        wrapVal.textContent = modelInner.position.y.toFixed(2);

        wrapSlider.addEventListener('input', () => {
            const v = parseFloat(wrapSlider.value);
            modelInner.position.y = v;                 // live
            wrapVal.textContent = v.toFixed(2);
            // PERSIST: store as the absolute wrapper-Y override for this model so it
            // sticks across reloads/new spawns and shows up in the copy-config. This
            // is what makes the value you set here (e.g. 0.80) the value that's kept.
            const tk = unit.team + '_' + unit.kind;
            Game.MODEL_WRAPPER_Y = Game.MODEL_WRAPPER_Y || {};
            Game.MODEL_WRAPPER_Y[tk] = v;
            if (Game._refreshPostFXCopyBox) Game._refreshPostFXCopyBox();
        });

        wrapRow.appendChild(wrapSlider);
        wrapRow.appendChild(wrapVal);
        centerSection.appendChild(wrapRow);

        container.appendChild(centerSection);
    }

    // Gather all named nodes
    const nodes = [];
    unit.mesh.traverse(child => {
        if (child.name && child.name.length > 0) {
            nodes.push(child);
        }
    });

    if (nodes.length === 0) {
        container.innerHTML += '<div style="color:#d44">No named nodes found in model</div>';
        return;
    }

    nodes.forEach(node => {
        const section = document.createElement('div');
        section.style.cssText = 'margin:6px 0;padding:4px;border:1px solid rgba(80,90,100,0.3);background:rgba(30,35,40,0.5)';

        const title = document.createElement('div');
        title.style.cssText = 'color:#9ac;font-weight:600;margin-bottom:4px';
        title.textContent = `${node.name} (${node.type})`;
        section.appendChild(title);

        // Current rotation info
        const info = document.createElement('div');
        info.style.cssText = 'font-size:9px;color:#6a7a8a;margin-bottom:4px';
        info.textContent = `pos: ${node.position.x.toFixed(1)}, ${node.position.y.toFixed(1)}, ${node.position.z.toFixed(1)}`;
        section.appendChild(info);

        // X, Y, Z sliders
        ['x', 'y', 'z'].forEach(axis => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:4px;margin:2px 0';

            const label = document.createElement('span');
            label.style.cssText = 'color:#b0bcc8;width:14px;font-weight:600';
            label.textContent = axis.toUpperCase();

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = '-3.14159';
            slider.max = '3.14159';
            slider.step = '0.05';
            slider.value = node.rotation[axis].toString();
            slider.style.cssText = 'flex:1;max-width:100px';

            const val = document.createElement('span');
            val.style.cssText = 'font-family:monospace;color:#d8ba7b;min-width:44px;text-align:right;font-size:10px';
            val.textContent = (node.rotation[axis] * 180 / Math.PI).toFixed(1) + '°';

            slider.addEventListener('input', () => {
                const v = parseFloat(slider.value);
                node.rotation[axis] = v;
                val.textContent = (v * 180 / Math.PI).toFixed(1) + '°';
            });

            row.appendChild(label);
            row.appendChild(slider);
            row.appendChild(val);
            section.appendChild(row);
        });

        // Color picker (only for mesh nodes with materials)
        if (node.isMesh && node.material) {
            const colorRow = document.createElement('div');
            colorRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin:4px 0 2px';

            const colorLabel = document.createElement('span');
            colorLabel.style.cssText = 'color:#b0bcc8;width:36px;font-weight:600;font-size:10px';
            colorLabel.textContent = 'Color';

            // Get current color as hex
            const currentColor = node.material.color
                ? '#' + node.material.color.getHexString()
                : '#888888';

            const colorPicker = document.createElement('input');
            colorPicker.type = 'color';
            colorPicker.value = currentColor;
            colorPicker.style.cssText = 'width:28px;height:22px;border:1px solid rgba(80,90,100,0.4);background:none;cursor:pointer;padding:0';

            const hexInput = document.createElement('input');
            hexInput.type = 'text';
            hexInput.value = currentColor;
            hexInput.style.cssText = 'width:70px;background:#2a3038;color:#d8ba7b;border:1px solid rgba(80,90,100,0.4);font-family:monospace;font-size:10px;padding:2px 4px';

            const applyColor = (hex) => {
                if (/^#[0-9a-fA-F]{6}$/.test(hex) && node.material.color) {
                    node.material.color.set(hex);
                }
            };

            colorPicker.addEventListener('input', () => {
                hexInput.value = colorPicker.value;
                applyColor(colorPicker.value);
            });

            hexInput.addEventListener('input', () => {
                let v = hexInput.value;
                if (!v.startsWith('#')) v = '#' + v;
                if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                    colorPicker.value = v;
                    applyColor(v);
                }
            });

            colorRow.appendChild(colorLabel);
            colorRow.appendChild(colorPicker);
            colorRow.appendChild(hexInput);
            section.appendChild(colorRow);
        }

        container.appendChild(section);
    });

    // Unfreeze button
    const unfreezeBtn = document.createElement('button');
    unfreezeBtn.textContent = 'Resume Auto-Rotation';
    unfreezeBtn.style.cssText = 'margin-top:6px;padding:3px 10px;cursor:pointer;background:#2a4038;color:#8fc;border:1px solid rgba(80,140,100,0.4);font-size:10px';
    unfreezeBtn.onclick = () => {
        Game._dbgTankFrozen = false;
        container.innerHTML = '<div style="color:#8fc">Auto-rotation resumed</div>';
    };
    container.appendChild(unfreezeBtn);
};

// Populate tanks when debug panel is toggled
document.addEventListener('keydown', (e) => {
    if (e.key === '`') Game.dbgPopulateTanks();
});

// Rebuild terrain with current debug values
Game.debugRebuildTerrain = () => {
    Game._debugSmoothPasses = parseInt(document.getElementById('dbgSmooth')?.value || '14');
    // Re-run heightmap + terrain build (buildTerrainMeshes clears children internally)
    Game.loadHeightmap().then(() => {
        Game.buildTerrainMeshes();
        // Re-apply texture settings
        if (dbgTexFilter) dbgTexFilter.dispatchEvent(new Event('change'));
        if (dbgTexScale) dbgTexScale.dispatchEvent(new Event('input'));
    });
};

// ═══════════════════════════════════════════════════════
//  GAME LOOP
// ═══════════════════════════════════════════════════════

Game.tick = (now) => {
    const dt = Math.min(0.033, (now - Game.lastTime) / 1000);
    Game.lastTime = now;
    Game.gameClock += dt;

    Game.updateCamera(dt);

    // Pause gate — skip unit updates when paused
    if (!Game._paused) {
        if (Game.updateSquadAI) Game.updateSquadAI(dt);
        if (Game.updateChainOfCommand) Game.updateChainOfCommand(dt);
        Game.units.forEach(unit => Game.updateUnit(unit, dt));
        Game.updateSupportUnits(dt);
        if (Game.updateIndirectShells) Game.updateIndirectShells(dt);
        if (Game.updateAirStrikes) Game.updateAirStrikes(dt);
        if (Game.updateThrownGrenades) Game.updateThrownGrenades(dt);
        if (Game.updateSmokeClouds) Game.updateSmokeClouds(dt);
        if (Game.updateTracers3D) Game.updateTracers3D(dt);
        if (Game.updateWreckFx) Game.updateWreckFx(dt);
        if (Game.updateFires) Game.updateFires(dt);
        if (Game.updateBuildings) Game.updateBuildings(dt);
        if (Game.updateBuildingEntry) Game.updateBuildingEntry(dt);
        if (Game.updateSmoke3D) Game.updateSmoke3D(dt);
        if (Game.updateScorch3D) Game.updateScorch3D(dt);
        if (Game.updateFoliageKnockdown) Game.updateFoliageKnockdown(dt);
        if (Game.updateTracks3D) Game.updateTracks3D(dt);
        Game.updateMines(dt);
        Game.updateTowing(dt);
        Game.updateRecon(dt);
        Game.updateFogOfWar(dt);
        Game.updateCamouflage();
        Game.updateBinoculars(dt);
        Game.updateEliteCrews();
        Game.updateMission(dt);
        Game.updateHover();
        Game.updateMessages(dt);
        Game.updateLighting(dt);
    } // end pause gate

    // Order markers animate even while paused (orders are issued during pause)
    if (Game.updateOrderMarkers) Game.updateOrderMarkers(dt);
    // Garrison labels + enter affordance (runs while paused so you can read/queue)
    if (Game.updateGarrisonUI) Game.updateGarrisonUI();
    if (Game.updateFoliage) Game.updateFoliage(dt);

    // VALOR finishing pass: animate grain + sync haze tint (runs while paused too)
    if (Game.updateValor) Game.updateValor(dt);

    // Ambient + engine audio bed (runs regardless of pause)
    if (Game.Audio && Game.Audio.updateAmbient) Game.Audio.updateAmbient(dt);

    // Sync 3D meshes with game state
    Game.syncUnitMeshes(dt);

    // Targeting cursor: red reticle when attack-move stance is set or a one-shot
    // target mode (attack-ground, grenade, smoke, air strike, rotate) is armed.
    const wantAtkCursor = Game.orderStance === 'attack' || !!Game._commandMode;
    if (wantAtkCursor !== Game._lastAtkCursor) {
        Game._lastAtkCursor = wantAtkCursor;
        const vp = document.getElementById('viewport');
        if (vp) vp.classList.toggle('cmd-attack', wantAtkCursor);
    }

    // Update HUD
    Game.updateHUD();
    Game.updateSelectionBox();
    Game.updateMinimap();

    // Render 3D scene
    Game.renderScene();

    requestAnimationFrame(Game.tick);
};

// ═══════════════════════════════════════════════════════
//  BOOT SEQUENCE (async for heightmap loading)
// ═══════════════════════════════════════════════════════

Game.boot = async () => {
    // HUD refs
    Game.hud.statusPill = document.getElementById('statusPill');
    Game.hud.missionPanel = document.getElementById('missionPanel');
    Game.hud.selectedPanel = document.getElementById('selectedPanel');
    Game.hud.messages = document.getElementById('gameMessages');
    Game.hud.selectionBox = document.getElementById('selectionBox');
    Game.hud.minimapCanvas = document.getElementById('minimapCanvas');

    // Minimap click-to-navigate
    if (Game.hud.minimapCanvas) {
        Game.hud.minimapCanvas.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            const rect = Game.hud.minimapCanvas.getBoundingClientRect();
            const mx = (e.clientX - rect.left) / rect.width;
            const mz = (e.clientY - rect.top) / rect.height;
            Game.cam.x = Game.clamp(mx * Game.WORLD_W, 0, Game.WORLD_W);
            Game.cam.z = Game.clamp(mz * Game.WORLD_H, 0, Game.WORLD_H);
        });
    }

    // Command button click handlers
    const cmdHandlers = {
        cmdAttack: () => { Game.setOrderStance('attack'); },
        stanceMove: () => { Game.setOrderStance('move'); },
        stanceAttack: () => { Game.setOrderStance('attack'); },
        cmdAttackGround: () => { Game._commandMode = 'attackground'; Game.pushMessage('Attack ground — right-click a spot to suppress.', 2.0); },
        cmdStop: () => { Game.selectedPlayerUnits().forEach(u => { u.path = []; u.moving = false; u.orderMode = 'hold'; u.forcedTargetId = null; u.bombardX = null; u.bombardZ = null; u._bombarding = false; }); Game.pushMessage('Units stopped.', 1.0); },
        cmdHold: () => { Game.toggleHoldFire(); },
        cmdGrenade: () => { Game._commandMode = 'grenade'; Game.pushMessage('Grenade — right-click target.', 2.0); },
        cmdMove: () => { Game.setOrderStance('move'); },
        cmdSmoke: () => { Game._commandMode = 'smoke'; Game.pushMessage('Smoke — right-click target.', 2.0); },
        cmdAirStrike: () => { if (Game.airStrikesAvailable > 0) { Game._commandMode = 'airstrike'; Game.adjustAirStrikePlanes(0); Game.pushMessage(`Air strike: ${Game.airStrikePlanesToUse} of ${Game.airStrikesAvailable} plane(s). Wheel to adjust, right-click target.`, 3.5); } else { Game.pushMessage('No air strikes available!', 2.0); } },
        cmdRotate: () => { Game._commandMode = 'rotate'; Game.pushMessage('Rotate — right-click direction.', 2.0); },
        cmdProne: () => { Game.toggleProneSelection(); },
    };
    Object.entries(cmdHandlers).forEach(([id, fn]) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    });

    // Init Three.js
    Game.initEngine();

    // Merge the editable unit roster (data/units.csv) over the built-in table
    // before anything spawns. Falls back to the built-in roster if unavailable.
    if (Game.loadUnitsCSV) await Game.loadUnitsCSV();

    // Load heightmap from depth image (async)
    await Game.loadHeightmap();

    // Generate tile-based map data
    Game.generateMap();

    // Build 3D terrain meshes (uses heightmap)
    Game.buildTerrainMeshes();

    // Spawn scenario
    Game.spawnScenario();



    // Initialize fog of war
    Game.initFogOfWar();

    // Set initial camera centered on largest concentration of player troops
    const playerUnits = Game.units.filter(u => u.team === Game.TEAM.FRENCH && u.alive);
    if (playerUnits.length > 0) {
        // Find densest cluster: weight each unit by how many allies are nearby
        let bestX = 0, bestZ = 0, bestWeight = 0;
        const clusterRadius = 15;
        for (const u of playerUnits) {
            let weight = 0;
            for (const o of playerUnits) {
                const d = Game.dist(u.x, u.z, o.x, o.z);
                if (d < clusterRadius) weight += 1;
            }
            if (weight > bestWeight) {
                bestWeight = weight;
                bestX = u.x;
                bestZ = u.z;
            }
        }
        // Average positions of units near the densest point
        const nearby = playerUnits.filter(u => Game.dist(u.x, u.z, bestX, bestZ) < clusterRadius);
        Game.cam.x = nearby.reduce((s, u) => s + u.x, 0) / nearby.length;
        Game.cam.z = nearby.reduce((s, u) => s + u.z, 0) / nearby.length;
    } else {
        Game.cam.x = Game.WORLD_W / 2;
        Game.cam.z = Game.WORLD_H / 2;
    }

    // Start input
    Game.handleInputEvents();

    // Go
    requestAnimationFrame(Game.tick);
};

// ═══════════════════════════════════════════════════════
//  MENU → GAME START
// ═══════════════════════════════════════════════════════

Game.startFromMenu = () => {
    const menu = document.getElementById('mainMenu');
    const mission = document.querySelector('.mission-card.selected')?.dataset.mission || 'dyle';
    const side = document.querySelector('.side-btn.selected')?.dataset.side || 'french';

    Game.selectedMission = mission;
    Game.selectedSide = side;

    // Hide menu
    menu.classList.add('hidden');
    Game._paused = false;

    // Audio needs a user gesture to start (this click qualifies)
    if (Game.Audio) Game.Audio.init();

    // Center camera on largest troop concentration
    const playerUnits = Game.units.filter(u => u.team === Game.TEAM.FRENCH && u.alive);
    if (playerUnits.length > 0) {
        let bestX = 0, bestZ = 0, bestWeight = 0;
        const clusterRadius = 15;
        for (const u of playerUnits) {
            let weight = 0;
            for (const o of playerUnits) {
                if (Game.dist(u.x, u.z, o.x, o.z) < clusterRadius) weight++;
            }
            if (weight > bestWeight) { bestWeight = weight; bestX = u.x; bestZ = u.z; }
        }
        const nearby = playerUnits.filter(u => Game.dist(u.x, u.z, bestX, bestZ) < clusterRadius);
        Game.cam.x = nearby.reduce((s, u) => s + u.x, 0) / nearby.length;
        Game.cam.z = nearby.reduce((s, u) => s + u.z, 0) / nearby.length;
    }

    Game.pushMessage(`Mission: ${mission.toUpperCase()} | Side: ${side.toUpperCase()}`, 5.0);
};

// Save/Load was removed for the single-session public build. A persistent
// campaign/save system is on the roadmap — see vision.md.

// Wire menu buttons (deferred until DOM ready)
const wireMenuButtons = () => {
    document.getElementById('btnStartMission')?.addEventListener('click', () => Game.startFromMenu());
};

// Wait for DOM, then boot (game starts paused behind menu)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { wireMenuButtons(); Game.boot(); });
} else {
    wireMenuButtons();
    Game.boot();
}

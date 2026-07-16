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
    const who = victim.team === Game.playerTeam ? 'friendly' : 'enemy';
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
Game.tankDebugDefaults = { tankSepRadius: 1.3, tankSepStrength: 4.0, tankRings: 0, truckMaxSteer: 0.5, truckWheelbase: 1.7, truckAccel: 0.6 };
// Truck (wheeled) steering tunables — read in the bicycle-model branch of uMod.move.
Game.TRUCK_MAX_STEER = 0.5;     // max wheel angle (rad); smaller = wider arc
Game.TRUCK_WHEELBASE = 1.7;     // × unit.size/model scale; ~3u axle span on the Renault
Game.TRUCK_ACCEL = 0.6;         // accel fraction of max speed per second
Game.TRUCK_ORDER_STOP_RADIUS = 2.25; // centre capture for player Shift waypoints

// A tank's collision footprint is a RECTANGLE aligned to the hull (longer than it
// is wide), sized just outside the model — not a round bubble. Half-extents are
// unit.size × these multipliers; +y is forward (length), +x is across (width).
Game.TANK_BOX_LEN = 1.5;        // half-length along the hull (× size)
Game.TANK_BOX_WID = 1.0;        // half-width across the hull (× size)

// Physical body dimensions in world units. These match the visible hull/body,
// not gun barrels, mirrors, or selection circles. Trucks previously rendered at
// ~3.4-3.6u long but collided as a 2.55u body, so their visible corners could be
// well inside a tank before the old three-disc test noticed anything.
Game.VEHICLE_FOOTPRINTS = {
    // Team/model-specific procedural fallbacks.
    german_supply_truck: { length: 2.21, width: 1.05 },
    german_fuel_truck:   { length: 2.21, width: 1.05 },
    german_panzer1:      { length: 2.03, width: 1.58 },
    german_panzer2:      { length: 2.44, width: 1.89 },
    german_panzer4:      { length: 2.71, width: 2.10 },
    german_sdkfz:        { length: 2.30, width: 1.46 },

    // Kind fallbacks and current French/modelled bodies.
    transport: { length: 3.60, width: 1.65 },
    supply:    { length: 3.60, width: 1.65 },
    fuel:      { length: 3.50, width: 1.65 },
    h35:       { length: 3.15, width: 1.85 },
    r35:       { length: 3.15, width: 1.85 },
    s35:       { length: 3.80, width: 2.05 },
    b1:        { length: 5.00, width: 2.45 },
    panhard:   { length: 3.45, width: 1.70 },
    panzer1:   { length: 3.10, width: 1.80 },
    panzer2:   { length: 3.35, width: 1.90 },
    panzer3:   { length: 4.15, width: 2.20 },
    panzer4:   { length: 4.40, width: 2.30 },
    sdkfz:     { length: 3.50, width: 1.75 },
};

Game._vehicleHalfExtents = (unit) => {
    const fp = Game.VEHICLE_FOOTPRINTS[unit.statKey]
        || Game.VEHICLE_FOOTPRINTS[unit.kind];
    if (fp) return { hl: fp.length * 0.5, hw: fp.width * 0.5 };
    return {
        hl: (unit.size || 1) * (Game.TANK_BOX_LEN || 1.5),
        hw: (unit.size || 1) * (Game.TANK_BOX_WID || 1.0),
    };
};

Game._vehicleOBB = (unit, x = unit.x, z = unit.z, angle = unit.angle) => {
    const { hl, hw } = Game._vehicleHalfExtents(unit);
    const c = Math.cos(angle || 0), s = Math.sin(angle || 0);
    return { unit, x, z, angle: angle || 0, hl, hw, fx: c, fz: s, rx: -s, rz: c };
};

// Collision shape for a powered vehicle plus its rigidly limbered AT gun. The
// renderer/towing update locks the gun to the tower's heading, so two exact OBBs
// model the shape without inflating the empty space beside truck and trailer.
Game._vehicleCollisionOBBs = (unit, x = unit.x, z = unit.z, angle = unit.angle) => {
    const primary = Game._vehicleOBB(unit, x, z, angle);
    const boxes = [primary];
    if (unit._towedUnitId == null) return boxes;
    const trailer = Game.units && Game.units.find(u => u.id === unit._towedUnitId
        && u.alive && u._towed && u._towedBy === unit.id);
    if (!trailer) return boxes;
    const c = Math.cos(angle || 0), s = Math.sin(angle || 0);
    boxes.push({
        unit: trailer,
        x: x - c * 2.371,
        z: z - s * 2.371,
        angle: angle || 0,
        hl: 0.671,
        hw: 0.720,
        fx: c, fz: s, rx: -s, rz: c,
        trailer: true,
    });
    return boxes;
};

// Exact 2D oriented-rectangle SAT. Returns the minimum overlap depth/axis, or
// null when a separating axis exists. All four rectangle axes are tested, so
// side panels and rotated corners are first-class collision geometry.
Game._obbPenetration = (a, b, margin = 0) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const axes = [
        [a.fx, a.fz], [a.rx, a.rz],
        [b.fx, b.fz], [b.rx, b.rz],
    ];
    let depth = Infinity, axisX = 0, axisZ = 0;
    for (const [ax, az] of axes) {
        const ra = a.hl * Math.abs(ax * a.fx + az * a.fz)
            + a.hw * Math.abs(ax * a.rx + az * a.rz);
        const rb = b.hl * Math.abs(ax * b.fx + az * b.fz)
            + b.hw * Math.abs(ax * b.rx + az * b.rz);
        const signed = dx * ax + dz * az;
        const overlap = ra + rb + margin - Math.abs(signed);
        if (overlap <= 0) return null;
        if (overlap < depth) {
            depth = overlap;
            const sign = signed >= 0 ? -1 : 1; // axis pushes A away from B
            axisX = ax * sign; axisZ = az * sign;
        }
    }
    return { depth, axisX, axisZ };
};

Game._vehiclePosePenetration = (unit, x, z, angle = unit.angle, margin = 0.02, parkedOnly = false) => {
    const bodies = Game._vehicleCollisionOBBs(unit, x, z, angle);
    let depth = 0, hit = null;
    for (const other of Game.units) {
        if (!other.alive || other.id === unit.id) continue;
        if (!(Game.isTank(other.kind) || Game.isTruck(other.kind))) continue;
        if (parkedOnly && (other.currentSpeed || 0) > 0.15) continue;
        const otherBodies = Game._vehicleCollisionOBBs(other);
        for (const body of bodies) for (const otherBody of otherBodies) {
            const reach = Math.hypot(body.hl, body.hw)
                + Math.hypot(otherBody.hl, otherBody.hw) + margin;
            if (Game.distSq(body.x, body.z, otherBody.x, otherBody.z) > reach * reach) continue;
            const p = Game._obbPenetration(body, otherBody, margin);
            if (p && p.depth > depth) { depth = p.depth; hit = other; }
        }
    }
    return { depth, hit };
};

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
    const ext = Game._vehicleHalfExtents
        ? Game._vehicleHalfExtents(tank)
        : { hl: tank.size * (Game.TANK_BOX_LEN || 1.5), hw: tank.size * (Game.TANK_BOX_WID || 1.0) };
    const hl = ext.hl + r + margin;
    const hw = ext.hw + r + margin;
    const px = hl - Math.abs(lx);      // penetration along length
    const pz = hw - Math.abs(lz);      // penetration along width
    if (px <= 0 || pz <= 0) return null;            // outside the box
    let plx = 0, plz = 0;
    if (px < pz) plx = lx >= 0 ? px : -px;          // pop out the near length face
    else plz = lz >= 0 ? pz : -pz;                  // pop out the near width face
    return { x: plx * c - plz * s, z: plx * s + plz * c, px, pz };
};

/**
 * Depth of a vehicle's exact oriented hull inside any OTHER vehicle hull at
 * position (x, z). 0 = clear. uMod.move uses this to
 * make hulls SOLID: any step that would end deeper inside another vehicle than
 * it started is refused, so vehicles stop at contact instead of overlapping or
 * being slid apart.
 */
Game._vehPenetration = (unit, x, z, angle = unit.angle) =>
    Game._vehiclePosePenetration(unit, x, z, angle, 0.02, false).depth;

/**
 * How many samples across a unit's BODY footprint at (x, z) land on a solid tile
 * (wall / house / water — and, for vehicles, any genuinely impassable vehicle
 * terrain except dense forest, which tanks crush through). 0 = fully clear.
 *
 * The move gate used to test only the unit's CENTRE tile, so a hull could drive
 * up to a half-length into a building before its centre crossed the blocked tile
 * — the "tank stuck inside the house" clipping. Sampling the whole oriented hull
 * (foot troops: a small ring) makes a unit stop with its BODY at the wall face.
 * Callers compare new-vs-previous counts so a unit that already overlaps a
 * structure (e.g. spawned clipping one) can still back out — it is only refused a
 * step that puts MORE of itself inside solid than before.
 */
Game._bodySolidCount = (unit, x, z, angle = unit.angle) => {
    if (!Game.getTileAtWorld) return 0;
    const isVeh = Game.isTank(unit.kind) || Game.isTruck(unit.kind);
    const solidAt = (sx, sz) => {
        // getTileAtWorld clamps its tile coordinate, so it cannot distinguish an
        // off-map corner from the legal edge tile. Reject it explicitly.
        if (sx < 0 || sz < 0 || sx >= Game.WORLD_W || sz >= Game.WORLD_H) return true;
        const t = Game.getTileAtWorld(sx, sz);
        if (!t) return true;                                  // off-map reads as solid
        if (t.blocked) return true;
        if (isVeh && t.vehicleBlocked && t.type !== 'dense_forest') return true;
        return false;
    };
    let hits = 0;
    if (isVeh) {
        const bodies = Game._vehicleCollisionOBBs
            ? Game._vehicleCollisionOBBs(unit, x, z, angle)
            : [Game._vehicleOBB(unit, x, z, angle)];
        for (const body of bodies) {
            // Sample a grid over each rigid body spaced <= ~1.2 units so no
            // 3-unit blocked tile can slip between truck or trailer samples.
            const nl = Math.max(2, Math.ceil((2 * body.hl) / 1.2));
            const nw = Math.max(2, Math.ceil((2 * body.hw) / 1.2));
            for (let i = 0; i <= nl; i++) {
                const along = -body.hl + (2 * body.hl) * (i / nl);
                for (let j = 0; j <= nw; j++) {
                    const across = -body.hw + (2 * body.hw) * (j / nw);
                    if (solidAt(body.x + along * body.fx + across * body.rx,
                        body.z + along * body.fz + across * body.rz)) hits++;
                }
            }
        }
        return hits;
    }
    // Foot troops: centre + a ring at the collision radius.
    if (solidAt(x, z)) hits++;
    const r = (unit.size || 0.5) * 1.1 + 0.15;
    for (let a = 0; a < 8; a++) {
        const ang = a * Math.PI / 4;
        if (solidAt(x + Math.cos(ang) * r, z + Math.sin(ang) * r)) hits++;
    }
    return hits;
};

// Continuous-ish swept-body gate. Interpolate finely enough that neither a
// translating corner nor a rotating long hull can tunnel between 30/60Hz frame
// endpoints. The last clear pose is returned; callers stop there, never inside.
Game._sweepVehicleMotion = (unit, ax, az, aa, bx, bz, ba) => {
    const trans = Math.hypot(bx - ax, bz - az);
    const da = Game.angleDiff(aa, ba);
    const startBodies = Game._vehicleCollisionOBBs(unit, ax, az, aa);
    const cornerR = Math.max(...startBodies.map(body =>
        Math.hypot(body.x - ax, body.z - az) + Math.hypot(body.hl, body.hw)));
    const steps = Math.max(1, Math.ceil(Math.max(trans, cornerR * Math.abs(da)) / 0.05));
    const baseSolid = Game._bodySolidCount ? Game._bodySolidCount(unit, ax, az, aa) : 0;
    // Baseline overlap is tracked per other hull. A deep legacy overlap with A
    // must never mask a brand-new, shallower collision with B.
    const basePen = new Map();
    if (Game._vehicleOBB && Game._obbPenetration) {
        for (const other of Game.units) {
            if (!other.alive || other.id === unit.id) continue;
            if (!(Game.isTank(other.kind) || Game.isTruck(other.kind))) continue;
            let depth = 0;
            const otherBodies = Game._vehicleCollisionOBBs(other);
            for (const body of startBodies) for (const otherBody of otherBodies) {
                const p = Game._obbPenetration(body, otherBody, 0.02);
                if (p) depth = Math.max(depth, p.depth);
            }
            if (depth > 0) basePen.set(other.id, depth);
        }
    }
    let last = { x: ax, z: az, angle: aa };
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        const angle = aa + da * t;
        const solid = Game._bodySolidCount ? Game._bodySolidCount(unit, x, z, angle) : 0;
        if (solid > baseSolid) return { ...last, blocked: true, type: 'terrain' };
        if (Game._vehicleOBB && Game._obbPenetration) {
            const bodies = Game._vehicleCollisionOBBs(unit, x, z, angle);
            for (const other of Game.units) {
                if (!other.alive || other.id === unit.id) continue;
                if (!(Game.isTank(other.kind) || Game.isTruck(other.kind))) continue;
                let depth = 0;
                const otherBodies = Game._vehicleCollisionOBBs(other);
                for (const body of bodies) for (const otherBody of otherBodies) {
                    const p = Game._obbPenetration(body, otherBody, 0.02);
                    if (p) depth = Math.max(depth, p.depth);
                }
                if (depth > Math.max(0.001, (basePen.get(other.id) || 0) + 1e-4)) {
                    return { ...last, blocked: true, type: 'vehicle', hit: other };
                }
            }
        }
        last = { x, z, angle };
    }
    return { ...last, blocked: false, type: null, hit: null };
};

// Dry-run the lorry's REAL bicycle driver against its planned route. The A*
// corridor is geometrically full-width, but a close first turn can still be
// unreachable from the current steering pose. This predictor lets the driver
// make a deliberate short back-up before moving, rather than discovering the
// mismatch by hitting the hard collision gate at road speed.
Game._predictTruckRouteBlock = (unit, route = unit.path, horizon = 5.0) => {
    if (!Game.isTruck(unit.kind) || !route || !route.length) return null;
    const points = route.map(p => ({
        x: p.x, z: p.z,
        exact: !!p._exactGoal,
        ordered: !!p._orderStop,
    }));
    let x = unit.x, z = unit.z, angle = unit.angle || 0;
    let speed = Math.max(0, unit.currentSpeed || 0);
    let steer = unit._truckSteer || 0;
    let index = 0;
    const dt = 1 / 30;
    const maxSpeed = unit.speed || 5;
    const maxSteer = Game.TRUCK_MAX_STEER ?? 0.5;
    const modelScale = (Game.MODEL_SCALE
        && Game.MODEL_SCALE[unit.team + '_' + unit.kind]) || 1;
    const wheelbase = Math.max(0.8,
        (unit.size || 0.85) * (Game.TRUCK_WHEELBASE ?? 1.7) * modelScale);
    const accelRate = maxSpeed * (Game.TRUCK_ACCEL ?? 0.6);
    const brakeRate = maxSpeed * 1.5;
    const steerRate = 1.35;
    let finalStopCommitted = false;

    for (let elapsed = 0; elapsed < horizon && index < points.length; elapsed += dt) {
        let next = points[index];
        let dx = next.x - x, dz = next.z - z, d = Math.hypot(dx, dz);
        const arrival = next.exact ? 1.15 : 1.5;
        while (index < points.length - 1) {
            const after = points[index + 1];
            const outX = after.x - next.x, outZ = after.z - next.z;
            const outLen = Math.hypot(outX, outZ);
            const along = outLen > 0.01
                ? ((x - next.x) * outX + (z - next.z) * outZ) / outLen
                : Infinity;
            const waypointBearing = Math.atan2(dz, dx);
            const behind = Math.abs(Game.angleDiff(angle, waypointBearing)) > Math.PI / 2;
            const orderedClose = !next.ordered
                || d < (Game.TRUCK_ORDER_STOP_RADIUS || 2.25);
            if (d >= arrival && !(d < 8 && orderedClose && along > 0.05 && behind)) break;
            next = points[++index];
            dx = next.x - x; dz = next.z - z; d = Math.hypot(dx, dz);
        }
        if (index === points.length - 1 && d < arrival) finalStopCommitted = true;
        if (index === points.length - 1 && finalStopCommitted && speed < 0.08) break;

        let bearing = Math.atan2(dz, dx);
        if (index < points.length - 1) {
            const after = points[index + 1];
            const outX = after.x - next.x, outZ = after.z - next.z;
            const outLen = Math.hypot(outX, outZ);
            if (outLen > 0.01) {
                const lookAhead = Game.clamp(speed * 1.15 + 1.5, 2.5, 6.0);
                if (d < lookAhead) {
                    const advance = Math.min(outLen, lookAhead - d);
                    const aimX = next.x + outX / outLen * advance;
                    const aimZ = next.z + outZ / outLen * advance;
                    bearing = Math.atan2(aimZ - z, aimX - x);
                }
            }
        }
        const headErr = Game.angleDiff(angle, bearing);
        const desiredSteer = Game.clamp(headErr, -maxSteer, maxSteer);
        steer += Game.clamp(desiredSteer - steer, -steerRate * dt, steerRate * dt);
        let targetSpeed = maxSpeed * Game.clamp(1 - Math.abs(headErr) / 1.8, 0.30, 1);
        if (index === points.length - 1 && (d < 4 || finalStopCommitted)) {
            targetSpeed = Math.min(targetSpeed, finalStopCommitted
                ? 0
                : Math.sqrt(2 * brakeRate * Math.max(0, d - arrival)));
        }
        if (speed < targetSpeed) speed = Math.min(targetSpeed, speed + accelRate * dt);
        else speed = Math.max(targetSpeed, speed - brakeRate * dt);
        angle += (speed / wheelbase) * Math.tan(steer) * dt;
        x += Math.cos(angle) * speed * dt;
        z += Math.sin(angle) * speed * dt;

        const bodies = Game._vehicleCollisionOBBs(unit, x, z, angle);
        for (const other of Game.units) {
            if (!other.alive || other.id === unit.id) continue;
            if (!(Game.isTank(other.kind) || Game.isTruck(other.kind))) continue;
            if ((other.currentSpeed || 0) > 0.15) continue;
            const otherBodies = Game._vehicleCollisionOBBs(other);
            let blocked = false;
            for (const body of bodies) for (const otherBody of otherBodies) {
                const reach = Math.hypot(body.hl, body.hw)
                    + Math.hypot(otherBody.hl, otherBody.hw) + 0.20;
                if (Game.distSq(body.x, body.z, otherBody.x, otherBody.z) > reach * reach) continue;
                if (Game._obbPenetration(body, otherBody, 0.20)) blocked = true;
            }
            if (blocked) {
                return { hit: other, time: elapsed + dt, x, z, angle };
            }
        }
    }
    return null;
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
    const selfExt = Game._vehicleHalfExtents(unit);
    let factor = 1;
    for (const o of Game.units) {
        if (!o.alive || o.id === unit.id || o.team !== unit.team) continue;
        if (!(Game.isTank(o.kind) || Game.isTruck(o.kind))) continue;
        if ((o.currentSpeed || 0) < 0.25) continue;            // stopped -> detour around it, don't follow
        const rx = o.x - unit.x, rz = o.z - unit.z;
        const ahead = rx * hx + rz * hz;
        if (ahead <= 0) continue;
        const lateral = Math.abs(rx * -hz + rz * hx);
        const otherExt = Game._vehicleHalfExtents(o);
        const lane = selfExt.hw + otherExt.hw + 0.35;
        if (lateral > lane) continue;                          // not directly in front
        const ofx = Math.cos(o.angle), ofz = Math.sin(o.angle);
        if (ofx * hx + ofz * hz < 0.5) continue;               // not moving our way -> not a leader
        const minGap = selfExt.hl + otherExt.hl + 0.4;          // centre distance at safe bumpers
        const slowGap = minGap + 4.0;                          // start easing off here
        factor = Math.min(factor, Game.clamp((ahead - minGap) / (slowGap - minGap), 0, 1));
    }
    return factor;
};

/**
 * Foot-column pacing (car-following for infantry): a man eases off behind a
 * comrade directly ahead on his lane instead of marching into his back. Without
 * this the separation push cancelled his step outright each frame, so a packed
 * file advanced as a stop-go ACCORDION — hundreds of sub-second halts per march.
 * Head-on passers are skipped (separation slips them past each other laterally).
 */
Game._infantryFollow = (unit) => {
    const hx = Math.cos(unit.angle), hz = Math.sin(unit.angle);
    let factor = 1;
    for (const o of Game.units) {
        if (!o.alive || o.id === unit.id || o.team !== unit.team) continue;
        if (Game.isTank(o.kind) || Game.isTruck(o.kind)) continue;
        if (o._garrisoned || o._inVehicle != null) continue;
        const rx = o.x - unit.x, rz = o.z - unit.z;
        if (rx * rx + rz * rz > 4) continue;                 // only the man right ahead
        const ahead = rx * hx + rz * hz;
        if (ahead <= 0.1) continue;
        if (Math.abs(rx * -hz + rz * hx) > 0.55) continue;   // not in my lane
        // Walking toward me: let separation slip us past, don't mutually freeze.
        if ((o.currentSpeed || 0) > 0.3 && Math.cos(o.angle - unit.angle) < -0.3) continue;
        const minGap = ((unit.size || 0.5) + (o.size || 0.5)) * 0.7 + 0.25;
        factor = Math.min(factor, Game.clamp((ahead - minGap) / 0.9, 0, 1));
    }
    return factor;
};

// ── Constrained local planner (the ORCA idea passed through a tank driver) ──
// When a moving tank's dead-reckoned course conflicts with another vehicle
// inside the look-ahead horizon, sample the handful of TRACK-LEGAL maneuvers a
// real driver has — hold course, steer off left/right, ease, stop, back out —
// simulate each with the hull's own turn/accel limits, score the predicted
// futures (collision, goal progress, facing, reverse reluctance) and command
// the winner. Prediction happens in velocity space like ORCA; the OUTPUT is
// only ever throttle/steer/reverse — a tank cannot sidestep, so no candidate
// contains lateral motion. Returns null while the current course is clean
// (the normal driver keeps full control); a chosen command is held briefly so
// the tank commits instead of flip-flopping between maneuvers every frame.
Game.TANK_PLANNER = { horizon: 1.6, step: 0.27, replan: 0.3 };

Game._tankDriverPlan = (unit, maxSpeed) => {
    if (!unit.path || !unit.path.length || maxSpeed <= 0) { unit._drvCmd = null; return null; }
    const now = Game.gameClock || 0;
    if (unit._drvCmd && now < unit._drvCmd.until) return unit._drvCmd.cmd;   // commit briefly
    const P = Game.TANK_PLANNER;

    // Neighbors that matter: other vehicles nearby, dead-reckoned at constant
    // velocity over the horizon (parked hulls predict as stationary obstacles).
    const nbrs = [];
    for (const o of Game.units) {
        if (!o.alive || o.id === unit.id) continue;
        if (!(Game.isTank(o.kind) || Game.isTruck(o.kind))) continue;
        if (Game.distSq(unit.x, unit.z, o.x, o.z) > 26 * 26) continue;
        const dir = o._reversing ? -1 : 1;
        nbrs.push({
            x: o.x, z: o.z,
            vx: Math.cos(o.angle) * (o.currentSpeed || 0) * dir,
            vz: Math.sin(o.angle) * (o.currentSpeed || 0) * dir,
            // WIDTH-based circle: side-by-side passage must be legal. The first
            // cut used hull LENGTH, which put parked formation neighbours inside
            // the "conflict" ring permanently — every candidate scored dirty and
            // STOP won, freezing tanks beside their own platoon for good.
            r: o.size * (Game.TANK_BOX_WID || 1.0) + 0.15,
        });
    }
    if (!nbrs.length) { unit._drvCmd = null; return null; }

    const myR = unit.size * (Game.TANK_BOX_WID || 1.0);
    // Baseline: how bad is the standing situation already? Only a course that
    // makes it WORSE is a conflict — sitting near a parked platoon-mate is fine.
    let baseWorst = 0;
    for (const n of nbrs) {
        const pen = (myR + n.r + 0.35) - Math.hypot(unit.x - n.x, unit.z - n.z);
        if (pen > baseWorst) baseWorst = pen;
    }
    const wp = unit.path[0];
    const turnRate = (unit.rotationSpeed || 1.5) * 0.8;

    // Roll one candidate forward under tank kinematics; worst = deepest
    // clearance violation against any neighbor's predicted position, terr =
    // steps spent on impassable terrain (a maneuver into a building is no fix).
    const sim = (thr, steer, rev) => {
        let x = unit.x, z = unit.z, a = unit.angle;
        let v = (unit.currentSpeed || 0) * (unit._reversing ? -1 : 1);
        const target = rev ? -maxSpeed * 0.4 : maxSpeed * thr;
        let worst = 0, terr = 0;
        for (let t = P.step; t <= P.horizon + 1e-6; t += P.step) {
            const rate = (Math.abs(target) > Math.abs(v) ? 0.5 : 1.2) * maxSpeed * P.step;
            v += Game.clamp(target - v, -rate, rate);
            a += steer * turnRate * P.step;
            x += Math.cos(a) * v * P.step;
            z += Math.sin(a) * v * P.step;
            for (const n of nbrs) {
                const pen = (myR + n.r + 0.35)
                    - Math.hypot(x - (n.x + n.vx * t), z - (n.z + n.vz * t));
                if (pen > worst) worst = pen;
            }
            const tile = Game.getTileAtWorld(x, z);
            if (!tile || tile.blocked || (tile.vehicleBlocked && tile.type !== 'dense_forest')) terr++;
        }
        return { worst, terr, x, z, a };
    };

    // Current course clean (no worse than the standing baseline)? Stay out of
    // the driver's way entirely.
    if (sim(1, 0, false).worst <= baseWorst + 0.05) { unit._drvCmd = null; return null; }

    const desiredA = Game.angleTo(unit.x, unit.z, wp.x, wp.z);
    const CANDS = [
        { thr: 1, steer: 0, rev: false },
        { thr: 1, steer: -1, rev: false }, { thr: 1, steer: 1, rev: false },
        { thr: 0.45, steer: 0, rev: false },
        { thr: 0.45, steer: -1, rev: false }, { thr: 0.45, steer: 1, rev: false },
        { thr: 0, steer: 0, rev: false },
        { thr: 0, steer: 0, rev: true },
    ];
    let best = null, bestScore = Infinity;
    const last = unit._drvCmd && unit._drvCmd.cmd;   // expired command: continuity memory
    for (const c of CANDS) {
        const p = sim(c.thr, c.steer, c.rev);
        const score = Math.max(0, p.worst - baseWorst) * 100
            + p.terr * 40                                 // never steer into a building
            + Game.dist(p.x, p.z, wp.x, wp.z) * 1.5
            + Math.abs(Game.angleDiff(p.a, desiredA)) * 2
            + (c.rev ? 3 : 0)
            // COMMIT to a side: flipping the steer sign between re-plans swung
            // the hull left-right-left for seconds on end. Changing sides has
            // to be clearly worth it.
            + (last && last.steer && c.steer && c.steer !== last.steer ? 8 : 0);
        if (score < bestScore) { bestScore = score; best = c; }
    }
    // Steer/reverse maneuvers are held longer than throttle tweaks — a swing
    // needs time to develop before it's second-guessed.
    unit._drvCmd = { cmd: best, until: now + ((best.steer || best.rev) ? 0.6 : P.replan) };
    return best;
};

/**
 * Predictive crossing yield — the sound core of ORCA/RVO adapted to tracked
 * vehicles. Full ORCA solves for an arbitrary new VELOCITY each frame, which
 * assumes an agent that can side-step (pedestrians); a tank cannot, and this
 * engine forbids any off-axis translation. What we keep is (1) the velocity
 * obstacle idea — project both hulls forward and find the closest point of
 * approach — and (2) reciprocity — exactly ONE of the pair yields, decided by
 * the same size/id right-of-way used everywhere, so no mutual dithering. The
 * ONLY output is a speed factor (ease off / hold back); steering is untouched.
 * Same-heading pairs are excluded (car-following paces those); parked hulls
 * are excluded (the corridor detour routes around them).
 */
Game._vehicleCrossingYield = (unit) => {
    if ((unit.currentSpeed || 0) < 0.3) return 1;
    const HORIZON = 2.5;                          // seconds of look-ahead
    const dirU = unit._reversing ? -1 : 1;
    const vux = Math.cos(unit.angle) * unit.currentSpeed * dirU;
    const vuz = Math.sin(unit.angle) * unit.currentSpeed * dirU;
    let factor = 1;
    for (const o of Game.units) {
        if (!o.alive || o.id === unit.id) continue;
        if (!(Game.isTank(o.kind) || Game.isTruck(o.kind))) continue;
        if ((o.currentSpeed || 0) < 0.3) continue;             // parked: detour handles it
        const rx = o.x - unit.x, rz = o.z - unit.z;
        if (rx * rx + rz * rz > 900) continue;                 // 30u interest radius
        // Same way = column, not a crossing.
        const dirO = o._reversing ? -1 : 1;
        if (Math.cos(o.angle - unit.angle) * dirU * dirO > 0.6) continue;
        // Right of way: the larger hull holds course; equal size -> lower id holds.
        const iYield = o.size > unit.size + 0.01
            || (Math.abs(o.size - unit.size) <= 0.01 && o.id < unit.id);
        if (!iYield) continue;
        // Closest point of approach under current velocities.
        const vox = Math.cos(o.angle) * o.currentSpeed * dirO;
        const voz = Math.sin(o.angle) * o.currentSpeed * dirO;
        const rvx = vox - vux, rvz = voz - vuz;                // o's motion relative to us
        const rv2 = rvx * rvx + rvz * rvz;
        if (rv2 < 0.01) continue;
        const tcpa = -(rx * rvx + rz * rvz) / rv2;
        if (tcpa <= 0 || tcpa > HORIZON) continue;             // diverging or far off
        const mx = rx + rvx * tcpa, mz = rz + rvz * tcpa;      // miss vector at CPA
        const clearance = (unit.size + o.size) * (Game.TANK_BOX_LEN || 1.5) + 0.6;
        if (Math.hypot(mx, mz) > clearance) continue;          // clean pass
        // Conflict: ease off in proportion to how soon it happens, so the other
        // hull crosses ahead and we roll through behind it.
        factor = Math.min(factor, Game.clamp((tcpa - 0.4) / 1.6, 0.15, 1));
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
// Samples every living unit's position/heading/speed/stance/animation at 15 Hz
// so movement problems (rotation spins, jitter, repeated animations, sliding) can
// be replayed/analysed without the recorder itself becoming a late-game stall.
// A fixed circular log keeps the newest samples. Start/stop from the debug panel
// (` key → "Movement
// Recorder") or call Game.startMoveRec() / Game.stopMoveRec(). Stopping prints a
// per-unit jitter summary to the console (heading reversals, full turns made on
// the spot, animation-clip switches, path length vs net travel = "wiggle") and
// downloads the full sample log as JSON.
Game._moveRec = null;
Game.MOVE_REC_HZ = 15;
Game.MOVE_REC_CAPACITY = 240000;
Game.startMoveRec = () => {
    Game._moveRec = [];
    Game._moveRecT0 = Game.gameClock || 0;
    Game._moveRecNextSample = Game._moveRecT0;
    Game._moveRecWrite = 0;
    Game._moveRecWrapped = false;
    if (Game.pushMessage) Game.pushMessage('Recording unit movement…', 1.5);
};
Game.recordMoveFrame = () => {
    if (!Game._moveRec) return;
    const now = Game.gameClock || 0;
    if (now + 1e-6 < (Game._moveRecNextSample || 0)) return;
    Game._moveRecNextSample = now + 1 / Game.MOVE_REC_HZ;
    const t = +((now - Game._moveRecT0)).toFixed(3);
    const append = sample => {
        if (Game._moveRec.length < Game.MOVE_REC_CAPACITY) {
            Game._moveRec.push(sample);
            Game._moveRecWrite = Game._moveRec.length % Game.MOVE_REC_CAPACITY;
        } else {
            Game._moveRec[Game._moveRecWrite] = sample;
            Game._moveRecWrite = (Game._moveRecWrite + 1) % Game.MOVE_REC_CAPACITY;
            Game._moveRecWrapped = true;
        }
    };
    for (const u of Game.units) {
        if (!u.alive) continue;                       // ALL living units, both teams
        const order = u._lastMoveOrder || null;
        const waypoint = u.path && u.path.length ? u.path[0] : null;
        const finalWaypoint = u.path && u.path.length ? u.path[u.path.length - 1] : null;
        append({
            t, id: u.id, team: u.team, kind: u.kind, cls: u.class,
            x: +u.x.toFixed(3), z: +u.z.toFixed(3),
            a: +(u.angle || 0).toFixed(3), spd: +(u.currentSpeed || 0).toFixed(2),
            dsp: +(u._dispSpeed || 0).toFixed(2),     // measured ground speed (slide detector)
            stop: +(u.stopTimer || 0).toFixed(2), det: u._detour ? 1 : 0, rev: u._reversing ? 1 : 0,
            mv: u.moving ? 1 : 0, st: u.stance || '',
            ai: u._ai || u.aiState || '',
            clip: (u.mesh && u.mesh.userData && u.mesh.userData._activeClip) || '',
            // Last player movement order. click* is the raw destination;
            // goal* is this unit's formation slot; face* is the optional
            // right-drag endpoint/heading; order* is its pose when ordered.
            orderId: order ? order.id : null,
            orderT: order ? +((order.t - Game._moveRecT0).toFixed(3)) : null,
            orderMode: order ? order.mode : '', orderQueue: order ? order.queue : 0,
            clickX: order ? +order.clickX.toFixed(3) : null,
            clickZ: order ? +order.clickZ.toFixed(3) : null,
            orderX: order ? +order.startX.toFixed(3) : null,
            orderZ: order ? +order.startZ.toFixed(3) : null,
            orderA: order ? +order.startA.toFixed(3) : null,
            goalX: order ? +order.goalX.toFixed(3) : null,
            goalZ: order ? +order.goalZ.toFixed(3) : null,
            faceX: order && Number.isFinite(order.faceX) ? +order.faceX.toFixed(3) : null,
            faceZ: order && Number.isFinite(order.faceZ) ? +order.faceZ.toFixed(3) : null,
            faceA: order && Number.isFinite(order.faceA) ? +order.faceA.toFixed(3) : null,
            waypointX: waypoint ? +waypoint.x.toFixed(3) : null,
            waypointZ: waypoint ? +waypoint.z.toFixed(3) : null,
            finalX: finalWaypoint ? +finalWaypoint.x.toFixed(3) : null,
            finalZ: finalWaypoint ? +finalWaypoint.z.toFixed(3) : null,
        });
    }
};
Game.stopMoveRec = () => {
    if (!Game._moveRec) { if (Game.pushMessage) Game.pushMessage('Not recording.', 1.2); return null; }
    const raw = Game._moveRec;
    const data = Game._moveRecWrapped
        ? raw.slice(Game._moveRecWrite).concat(raw.slice(0, Game._moveRecWrite))
        : raw;
    Game._moveRec = null;
    const byId = {};
    data.forEach(s => { (byId[s.id] = byId[s.id] || []).push(s); });
    const summary = Object.keys(byId).map(id => {
        const s = byId[id];
        let headRev = 0, spdRev = 0, pathLen = 0, lastA = 0, lastSd = 0, stopFrames = 0;
        let totalRot = 0, clipSwitches = 0, spinRot = 0;
        for (let i = 1; i < s.length; i++) {
            const step = Math.hypot(s[i].x - s[i - 1].x, s[i].z - s[i - 1].z);
            pathLen += step;
            const da = Game.angleDiff(s[i - 1].a, s[i].a);
            totalRot += Math.abs(da);
            if (step < 0.02) spinRot += Math.abs(da);   // turning while going nowhere
            if (Math.abs(da) > 0.01) { if (lastA !== 0 && Math.sign(da) !== Math.sign(lastA)) headRev++; lastA = da; }
            const sd = Math.sign(s[i].spd - s[i - 1].spd);
            if (sd !== 0) { if (lastSd !== 0 && sd !== lastSd) spdRev++; lastSd = sd; }
            if (s[i].spd < 0.05) stopFrames++;
            if (s[i].clip !== s[i - 1].clip) clipSwitches++;
        }
        const net = s.length ? Math.hypot(s[s.length - 1].x - s[0].x, s[s.length - 1].z - s[0].z) : 0;
        const dur = s.length > 1 ? Math.max(0.001, s[s.length - 1].t - s[0].t) : 0.001;
        return {
            id: +id, team: s[0].team, kind: s[0].kind, frames: s.length,
            headingReversals: headRev,
            // full 360s turned while standing still — the "spinning on the spot" metric
            spinTurns: +(spinRot / (Math.PI * 2)).toFixed(2),
            totalTurns: +(totalRot / (Math.PI * 2)).toFixed(2),
            // clip switches per second — high = animation thrash / repeats
            clipPerSec: +(clipSwitches / dur).toFixed(2),
            speedReversals: spdRev, stopFrames, pathLen: +pathLen.toFixed(1),
            net: +net.toFixed(1), wiggle: +(pathLen / (net || 1)).toFixed(2),
        };
    });
    // Worst offenders first: spinning in place, then animation thrash.
    summary.sort((a, b) => (b.spinTurns - a.spinTurns) || (b.clipPerSec - a.clipPerSec));
    console.log('=== UNIT MOVEMENT SUMMARY (spinTurns = 360s on the spot; clipPerSec = anim thrash; high wiggle = weaving) ===');
    if (console.table) console.table(summary); else console.log(JSON.stringify(summary, null, 1));
    try {
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = 'unit_movement.json'; a.click();
    } catch (e) { /* headless: no DOM download */ }
    if (Game.pushMessage) Game.pushMessage(`Recording stopped (${data.length} samples) — summary in console, JSON downloaded.`, 3.0);
    Game._moveRecSummary = summary;
    return summary;
};

// Debug-panel section for the recorder (the functions existed but were never
// exposed in the UI — this is the missing "record movement" control).
Game.buildMoveRecUI = () => {
    const panel = document.getElementById('debugPanel');
    if (!panel || document.getElementById('dbgMoveRec')) return;
    const wrap = document.createElement('div');
    wrap.id = 'dbgMoveRec';
    const title = document.createElement('div');
    title.className = 'dbg-title';
    title.style.marginTop = '8px';
    title.textContent = 'Movement Recorder';
    wrap.appendChild(title);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:4px;margin-top:3px';
    const btnCss = 'background:#2a2e35;color:#cdd3da;border:1px solid #454b55;border-radius:3px;padding:3px 10px;font-size:11px;cursor:pointer';
    const start = document.createElement('button');
    start.textContent = '● Record';
    start.style.cssText = btnCss;
    const stop = document.createElement('button');
    stop.textContent = '■ Stop + Save';
    stop.style.cssText = btnCss;
    start.addEventListener('click', () => {
        Game.startMoveRec();
        start.style.background = '#7a2a2a';
    });
    stop.addEventListener('click', () => {
        Game.stopMoveRec();
        start.style.background = '#2a2e35';
    });
    row.appendChild(start);
    row.appendChild(stop);
    wrap.appendChild(row);
    const hint = document.createElement('div');
    hint.style.cssText = 'color:#7a8a96;font-size:10px;margin-top:3px';
    hint.textContent = 'Records ALL units every frame (position, heading, speed, stance, anim clip). Stop downloads unit_movement.json + prints a per-unit jitter table to the console.';
    wrap.appendChild(hint);
    panel.appendChild(wrap);
};

Game.applySeparation = (unit, dt) => {
    let sepX = 0, sepZ = 0;
    const isVeh = Game.isTank(unit.kind) || Game.isTruck(unit.kind);
    const isMounted = Game.isMountedCavalry && Game.isMountedCavalry(unit);
    const radMult = Game.TANK_SEP_RADIUS || 1.3;
    const myRadius = isVeh ? unit.size * radMult : unit.size * (isMounted ? 1.0 : 0.7);
    // A tank rolling at speed crushes anyone under its hull.
    const tankMoving = isVeh && (unit.currentSpeed || 0) > 0.6;
    const crushRadius = unit.size * 1.15;
    const fwdX = Math.cos(unit.angle), fwdZ = Math.sin(unit.angle);
    let blockedAhead = false;

    for (const other of Game.units) {
        if (!other.alive || other.id === unit.id || other._inVehicle != null || other._garrisoned) continue;
        if (unit._enterCarrierId === other.id) continue; // exact final waypoint is the assigned rear tailgate

        const dx = unit.x - other.x;
        const dz = unit.z - other.z;
        const distSq = dx * dx + dz * dz;

        const otherVeh = Game.isTank(other.kind) || Game.isTruck(other.kind);

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
        // A man being OVERTAKEN — vehicle bearing down from behind on roughly
        // his own heading — scrambles aside even under orders: the tank only
        // yields to men CROSSING its lane, so a same-way man ahead used to just
        // get shoved along by the hull. And men dodge tanks regardless of team
        // (an enemy tank is MORE worth dodging); the crush check below still
        // catches anyone too slow.
        const overtaken = manUnderOrders && Math.cos(unit.angle - other.angle) > 0.5;
        if (!isVeh && otherVeh
            && (other.currentSpeed || 0) > 0.45 && (!manUnderOrders || overtaken)) {
            const fX = Math.cos(other.angle), fZ = Math.sin(other.angle);
            const relX = unit.x - other.x, relZ = unit.z - other.z;
            const ahead = relX * fX + relZ * fZ;               // + = in front of the tank
            const lateral = relX * -fZ + relZ * fX;            // signed offset across its path
            const halfWidth = other.size * radMult
                + unit.size * (isMounted ? 1.0 : 0.7) + 0.6;
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
                const push = (halfWidth - Math.abs(lateral) + 0.6) * (5 + urgency * 7);
                const exX = -fZ * dir, exZ = fX * dir;                       // out of the lane
                sepX += exX * push;
                sepZ += exZ * push;
                // RUN clear, don't slide: face the escape direction and break into a run
                // so it reads as a man scrambling out of the way rather than bouncing
                // sideways. (Capped to run speed below, not a sideways dart.)
                // TURN at a finite rate — the escape vector rotates with the passing
                // tank, and snapping the facing to it every frame swept the man
                // through continuous full circles on the spot.
                unit.angle = Game.rotateTo(unit.angle, Math.atan2(exZ, exX), 9 * dt);
                unit.turretAngle = unit.angle;
                if (unit.stance !== 'prone' && unit.stance !== 'crouch') { unit.stance = 'run'; unit._autoStance = true; }
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
            const push = Game._tankBoxPush(unit.x, unit.z, other,
                unit.size * (isMounted ? 1.0 : 0.7), 0.12);
            if (push) {
                if (!enemyRolling) {
                    // Resolve over a few frames, not in one pop: a deep overlap (a man
                    // shoved into a hull by a crowd) would otherwise jump him >1u in a
                    // single frame, which reads as a teleport. Cap the correction at a
                    // RUN-speed rate (dt-scaled) — the old fixed per-FRAME cap of 0.35u
                    // meant up to ~20u/s at 60fps, and a man straddling the box edge
                    // visibly vibrated/bounced against the hull every frame.
                    const pm = Math.hypot(push.x, push.z), cap = 3.4 * dt;
                    const k = pm > cap ? cap / pm : 1;
                    unit.x += push.x * k; unit.z += push.z * k;
                }
                if (tankRolling) {   // scramble toward a flank to clear the lane
                    const fX = Math.cos(other.angle), fZ = Math.sin(other.angle);
                    let pX = -fZ, pZ = fX;
                    if (dx * pX + dz * pZ < 0) { pX = -pX; pZ = -pZ; }
                    const m = Math.max(push.px, push.pz) + 0.6;
                    sepX += pX * m * 7.0; sepZ += pZ * m * 7.0;
                } else if (unit.path && unit.path.length) {
                    // TANGENTIAL SLIDE around a STOPPED hull. De-penetration alone is
                    // radial — a man heading for a goal BEYOND a parked tank just gets
                    // shoved straight back off the rear and grinds there. If his
                    // destination is past this hull, add a sideways push so he slides
                    // AROUND it. The side is committed per-tank so he doesn't dither.
                    const wp = unit.path[unit.path.length - 1];
                    const gx = wp.x - unit.x, gz = wp.z - unit.z;
                    const glen = Math.hypot(gx, gz) || 1;
                    const tox = -dx, toz = -dz;                  // unit -> tank
                    const tlen = Math.hypot(tox, toz) || 1;
                    if ((gx * tox + gz * toz) / (glen * tlen) > 0.45) {   // goal lies past the tank
                        let pX = -toz / tlen, pZ = tox / tlen;   // perpendicular to tank dir
                        if (unit._slideFor !== other.id) {
                            unit._slideFor = other.id;
                            unit._slideSign = (gx * pX + gz * pZ >= 0) ? 1 : -1;  // toward the goal
                        }
                        const sgn = unit._slideSign || 1;
                        sepX += pX * sgn * 5.0; sepZ += pZ * sgn * 5.0;
                    }
                }
            }
            continue;
        }

        // Vehicle-to-vehicle proximity is rectangular too. The former circle
        // gate stopped a truck between two tanks even when its entire square
        // body fit through the opening—the exact failure caused by treating a
        // rectangular unit as a radius. Look for an OBB conflict now or along a
        // short forward prediction, then yield; side-by-side clear hulls proceed.
        if (isVeh && otherVeh && Game._vehicleOBB && Game._obbPenetration) {
            // Match the route planner's 0.20u stand-off. A larger circular-era
            // yield margin could veto a corridor that pathfinding had correctly
            // proved wide enough.
            const clearance = 0.20;
            let conflict = !!Game._obbPenetration(
                Game._vehicleOBB(unit), Game._vehicleOBB(other), clearance);
            if (!conflict && ((unit.currentSpeed || 0) > 0.05 || (other.currentSpeed || 0) > 0.05)) {
                const horizon = 1.5;
                for (let t = 0.25; t <= horizon && !conflict; t += 0.25) {
                    const us = (unit.currentSpeed || 0) * (unit._reversing ? -1 : 1);
                    const os = (other.currentSpeed || 0) * (other._reversing ? -1 : 1);
                    const ua = unit.angle || 0, oa = other.angle || 0;
                    const ub = Game._vehicleOBB(unit,
                        unit.x + Math.cos(ua) * us * t,
                        unit.z + Math.sin(ua) * us * t, ua);
                    const ob = Game._vehicleOBB(other,
                        other.x + Math.cos(oa) * os * t,
                        other.z + Math.sin(oa) * os * t, oa);
                    conflict = !!Game._obbPenetration(ub, ob, clearance);
                }
            }
            if (!conflict) continue;

            const dist = Math.sqrt(Math.max(distSq, 0.0001));
            const nx = dx / dist, nz = dz / dist;
            const otherMoving = (other.currentSpeed || 0) > 0.15;
            // A parked hull is owned by full-width A* plus the swept hard gate.
            // Stopping on a straight-line heading prediction prevents a wheeled
            // truck from rolling far enough to steer onto that safe bypass and
            // deadlocks it forever at the margin. Moving traffic still yields.
            if (!otherMoving) continue;
            const otherAhead = (-nx) * fwdX + (-nz) * fwdZ > 0.25;
            const following = otherMoving
                && (Math.cos(other.angle) * fwdX + Math.sin(other.angle) * fwdZ) > 0.6;
            const me = Game._vehicleHalfExtents(unit), oe = Game._vehicleHalfExtents(other);
            const myArea = me.hl * me.hw, otherArea = oe.hl * oe.hw;
            const yieldToOther = otherArea > myArea + 0.02
                || (Math.abs(otherArea - myArea) <= 0.02 && other.id < unit.id);
            if (otherAhead && !following && yieldToOther && !unit._detour) blockedAhead = true;
            continue;
        }

        const otherMounted = Game.isMountedCavalry && Game.isMountedCavalry(other);
        const otherRadius = otherVeh ? other.size * radMult
            : other.size * (otherMounted ? 1.0 : 0.7);
        const gap = 0.3;
        const minDist = myRadius + otherRadius + gap;
        const minDistSq = minDist * minDist;
        if (distSq >= minDistSq || distSq <= 0.0001) continue;

        const dist = Math.sqrt(distSq);
        const overlap = minDist - dist;
        const nx = dx / dist, nz = dz / dist;
        let strength = overlap * (Game.TANK_SEP_STRENGTH || 3.0);

        if (isVeh && !otherVeh) {
            // Tank vs infantry: a tank is immovable by men (no push on the tank).
        } else {
            // Infantry vs infantry.
            sepX += nx * strength;
            sepZ += nz * strength;
        }
    }

    if (isVeh) {
        // NO positional de-overlap for vehicles — ever. Translating a hull off
        // another hull is exactly the sideways SLIDE that must not exist: a
        // tracked vehicle can only move along its own axis. Solidity is
        // enforced in uMod.move instead (a step that would end inside another
        // hull is refused outright), so overlap never happens to begin with;
        // here we only decide to yield.
        if (blockedAhead) {
            unit.stopTimer = Math.max(unit.stopTimer || 0, 0.2);
            unit._crawlT = 0.8;   // creep back up after the yield (see uMod.move)
        }
    } else {
        // Infantry: push in any direction, but capped to a RUN speed so getting out of
        // a tank's way looks like scrambling clear, not a sideways teleport-bounce.
        const sepMag = Math.hypot(sepX, sepZ);
        const maxSep = isMounted ? 2.4 : 4.5;
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

/**
 * Is a PARKED vehicle sitting on this unit's route within the next lookAhead
 * units of travel? Walks the path polyline in ~1u samples against parked
 * hulls' footprint boxes. Returns the blocking vehicle or null. Feeds the
 * dynamic re-route in uMod.move.
 */
Game._pathBlockedByVehicle = (unit, lookAhead = 12) => {
    if (!unit.path || !unit.path.length) return null;
    const parked = [];
    for (const o of Game.units) {
        if (!o.alive || o.id === unit.id) continue;
        if (unit._enterCarrierId === o.id) continue; // allow the boarding route to terminate at its truck
        if (unit._towApproachTruckId === o.id) continue; // the hook-up route ends at this truck by design
        if (!(Game.isTank(o.kind) || Game.isTruck(o.kind))) continue;
        if ((o.currentSpeed || 0) > 0.15) continue;
        if (Game.distSq(unit.x, unit.z, o.x, o.z) > (lookAhead + 8) * (lookAhead + 8)) continue;
        parked.push(o);
    }
    if (!parked.length) return null;
    const vehSized = Game.isTank(unit.kind) || Game.isTruck(unit.kind);
    const mountedSized = Game.isMountedCavalry && Game.isMountedCavalry(unit);
    const r = unit.size * ((vehSized || mountedSized) ? 1.0 : 0.7);
    let px = unit.x, pz = unit.z, travelled = 0;
    for (let i = 0; i < unit.path.length && travelled < lookAhead; i++) {
        const wp = unit.path[i];
        const seg = Math.hypot(wp.x - px, wp.z - pz);
        const angle = seg > 0.001 ? Math.atan2(wp.z - pz, wp.x - px) : (unit.angle || 0);
        const steps = Math.max(1, Math.ceil(seg / (vehSized ? 0.3 : 1)));
        for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const sx = px + (wp.x - px) * t, sz = pz + (wp.z - pz) * t;
            for (const o of parked) {
                if (vehSized) {
                    const bodies = Game._vehicleCollisionOBBs
                        ? Game._vehicleCollisionOBBs(unit, sx, sz, angle)
                        : [Game._vehicleOBB(unit, sx, sz, angle)];
                    const otherBodies = Game._vehicleCollisionOBBs
                        ? Game._vehicleCollisionOBBs(o)
                        : [Game._vehicleOBB(o)];
                    for (const body of bodies) for (const otherBody of otherBodies) {
                        if (Game._obbPenetration(body, otherBody, 0.20)) return o;
                    }
                } else if (Game._tankBoxPush(sx, sz, o, r, 0.15)) {
                    return o;
                }
            }
        }
        travelled += seg; px = wp.x; pz = wp.z;
    }
    return null;
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
    const isTruck = Game.isTruck(unit.kind);
    const isMounted = Game.isMountedCavalry && Game.isMountedCavalry(unit);
    const vehSized = selfIsTank || isTruck;              // vehicle-sized footprint
    const myExt = vehSized && Game._vehicleHalfExtents ? Game._vehicleHalfExtents(unit) : null;
    const myR = vehSized ? Math.hypot(myExt.hl, myExt.hw)
        : unit.size * (isMounted ? 1.0 : 0.7);
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
            if (!o.alive || o.id === unit.id || !(Game.isTank(o.kind) || Game.isTruck(o.kind))) continue;
            if (unit._enterCarrierId === o.id) continue; // the assigned tailgate is intentionally on this hull
            if (unit._towApproachTruckId === o.id) continue; // hook-up goal legitimately hugs this truck
            const oe = Game._vehicleHalfExtents ? Game._vehicleHalfExtents(o) : { hl: o.size * radMult, hw: o.size * radMult };
            const tr = Math.hypot(oe.hl, oe.hw);
            if (Game.distSq(goal.x, goal.z, o.x, o.z) < (tr + 0.4) * (tr + 0.4)
                && Game.distSq(unit.x, unit.z, o.x, o.z) < (tr + myR + 0.8) * (tr + myR + 0.8)) {
                if (unit._detour && unit.path[0] === unit._detour) unit.path.shift();
                unit._detour = null; unit.path.length = 0; unit.moving = false;
                return;
            }
        }
    }
    // Examine the route we intend to follow, not merely the current bonnet
    // bearing while the truck is still steering onto that route. Otherwise a
    // valid A* bypass was immediately replaced by a centre-circle detour.
    const firstWp = unit.path[0];
    const routeAngle = firstWp
        ? Math.atan2(firstWp.z - unit.z, firstWp.x - unit.x)
        : unit.angle;
    const hx = Math.cos(routeAngle), hz = Math.sin(routeAngle);

    // Most-blocking TANK inside a corridor straight ahead. Trucks turn wide, so
    // they look further ahead to start the detour in time.
    let block = null, blockD = Infinity;
    const lookAhead = myR + (isTruck ? 9 : (selfIsTank ? 6 : (isMounted ? 6 : 3.5)));
    for (const o of Game.units) {
        if (!o.alive || o.id === unit.id || !(Game.isTank(o.kind) || Game.isTruck(o.kind))) continue;
        if (unit._enterCarrierId === o.id) continue;
        const rx = o.x - unit.x, rz = o.z - unit.z;
        const ahead = rx * hx + rz * hz;                 // along heading
        if (ahead <= 0.3 || ahead > lookAhead) continue;
        const lateral = rx * -hz + rz * hx;              // signed perpendicular offset
        const oe = Game._vehicleHalfExtents ? Game._vehicleHalfExtents(o) : { hw: o.size * radMult };
        const corridor = (vehSized ? myExt.hw : myR) + oe.hw + 0.4;
        if (Math.abs(lateral) > corridor) continue;      // not in our lane
        // Tank vs tank: only the higher-id mover swerves (the other holds course)
        // so they don't mirror each other. Trucks and foot troops ALWAYS go round
        // a tank (a tank has right of way over them).
        const oMoving = (o.currentSpeed || 0) > 0.15;
        // Parked hulls are already part of the full-width A* configuration
        // space. Do not replace that safe route with the legacy local circle
        // waypoint; local avoidance is reserved for genuinely moving traffic.
        if (vehSized && !oMoving) continue;
        // Right of way by SIZE: hold course past a SMALLER moving tank (it gives way to
        // us); only swerve around a LARGER one (equal size -> lower id holds course).
        if (selfIsTank && oMoving && (o.size < unit.size - 0.01
            || (Math.abs(o.size - unit.size) <= 0.01 && o.id < unit.id))) continue;
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
    const blockMoving = block ? (block.currentSpeed || 0) > 0.15 : false;

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
    // Long-wheelbase trucks need a wider side point than tracked vehicles: if
    // the waypoint merely clears the collision box, the lorry reaches contact
    // before its nose can arc toward it and stalls against the tank.
    const blockExt = Game._vehicleHalfExtents
        ? Game._vehicleHalfExtents(block)
        : { hw: block.size * radMult };
    const off = myExt.hw + blockExt.hw + (isTruck ? 2.0 : 0.8);
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
    const tileBad = (x, z) => {
        const tt = Game.getTileAtWorld(x, z);
        return !tt || tt.blocked || (vehSized && tt.vehicleBlocked && tt.type !== 'dense_forest');
    };
    if (tileBad(gx, gz)) {                               // that side is walled — try the other
        side = -side; px = -px; pz = -pz;
        gx = Game.clamp(block.x + px * off, 1, Game.WORLD_W - 1);
        gz = Game.clamp(block.z + pz * off, 1, Game.WORLD_H - 1);
        if (tileBad(gx, gz)) {
            // Both flanks are inside buildings/walls (hull parked in an alley):
            // no geometric side-step exists — drop the detour and let the
            // stuck-replan route a real A* path instead of aiming at masonry.
            if (activeDetour) unit.path.shift();
            unit._detour = null;
            return;
        }
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
    { group: 'Fighter', key: 'fighterYawD520', label: 'D.520 yaw (rad)', min: -3.15, max: 3.15, step: 0.05, default: Math.PI / 2, apply: v => { if (Game.FIGHTER_TYPES) Game.FIGHTER_TYPES.d520.yaw = v; } },
    { group: 'Fighter', key: 'fighterYawMB152', label: 'MB.152 yaw (rad)', min: -3.15, max: 3.15, step: 0.05, default: Math.PI / 2, apply: v => { if (Game.FIGHTER_TYPES) Game.FIGHTER_TYPES.mb152.yaw = v; } },
    { group: 'Fighter', key: 'fighterScale', label: 'Model length (world u)', min: 3, max: 14, step: 0.5, default: 7, apply: v => { if (Game.FIGHTER) { Game.FIGHTER.scale = v; Game._fighterProtos = {}; Game._fighterLoadTried = {}; (Game.fighters || []).forEach(f => { if (f.mesh) { Game.scene.remove(f.mesh); f.mesh = null; } Game._attachFighterMesh(f); }); } } },
    { group: 'Fighter', key: 'fighterAlt', label: 'Patrol altitude', min: 8, max: 60, step: 1, default: 34, apply: v => { if (Game.FIGHTER) Game.FIGHTER.alt = v; } },
    { group: 'Fighter', key: 'fighterPitchD520', label: 'D.520 pitch trim (rad)', min: -0.6, max: 0.6, step: 0.02, default: 0, apply: v => { if (Game.FIGHTER_TYPES) Game.FIGHTER_TYPES.d520.pitchFix = v; } },
    { group: 'Fighter', key: 'fighterPitchMB152', label: 'MB.152 pitch trim (rad)', min: -0.6, max: 0.6, step: 0.02, default: 0, apply: v => { if (Game.FIGHTER_TYPES) Game.FIGHTER_TYPES.mb152.pitchFix = v; } },
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
    const now = Game.gameClock || 0;
    if (!Game._officersByTeam || now >= (Game._officerCacheUntil || 0)) {
        Game._officersByTeam = {};
        for (const candidate of Game.units) {
            if (!candidate.alive || !(candidate.supportType === 'officer' || candidate._actingOfficer)) continue;
            (Game._officersByTeam[candidate.team] ||= []).push(candidate);
        }
        Game._officerCacheUntil = now + 0.35;
    }
    for (const o of Game._officersByTeam[unit.team] || []) {
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
// No player-callable aircraft at Mokra. Later German Ju 87 attacks are a
// scripted enemy event, not an ahistorical Polish support button.
Game.airStrikesAvailable = Game.currentScenario === 'mokra' ? 0 : 1;
Game.airStrikePlanesToUse = Game.airStrikesAvailable ? 1 : 0;

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
    // Real RWM bomber flyby; the synth drone stays as the no-asset fallback.
    if (Game.Audio && Game.Audio.heavyPlane) Game.Audio.heavyPlane();
    else if (Game.Audio && Game.Audio.plane) Game.Audio.plane(3.0 + planes * 0.5);

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

// ── Bomber flyover: a Bf-110 crosses the strike point during the bombing run,
// north to south like the strike tracers, and flies off the map. Purely
// visual; the walking bomb stick below carries the damage.
Game._bombers = [];
Game._spawnBomberFlyover = (x, z) => {
    if (!Game.THREE || !Game.scene || !Game.loadModel) return;
    const THREE = Game.THREE;
    const launch = (proto) => {
        const mesh = proto.clone();
        mesh.traverse(o => { o.castShadow = false; o.receiveShadow = false; });
        const fromX = x + Game.rand(-8, 8), fromZ = z - 95;
        const len = Math.hypot(x - fromX, 95);
        const dx = (x - fromX) / len, dz = 95 / len;
        mesh.rotation.y = Math.atan2(dx, dz);   // model nose is +Z
        Game.scene.add(mesh);
        Game._bombers.push({ mesh, x: fromX, z: fromZ, dx, dz, speed: 36, alt: 27, life: 6.5 });
    };
    if (Game._bomberProto) { launch(Game._bomberProto); return; }
    Game.loadModel('models/german_bf110.glb').then(model => {
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        // Same oversized read as the fighters (Game.FIGHTER.scale): planes at
        // altitude must stay legible from the RTS camera.
        const s = 7.0 / Math.max(0.001, size.x, size.z);
        model.scale.setScalar(s);
        Game._bomberProto = model;
        launch(model);
    }).catch(() => { /* flyover is optional garnish; bombs still fall */ });
};

Game.updateBombers = (dt) => {
    for (let i = Game._bombers.length - 1; i >= 0; i--) {
        const b = Game._bombers[i];
        b.x += b.dx * b.speed * dt;
        b.z += b.dz * b.speed * dt;
        b.life -= dt;
        b.mesh.position.set(b.x, b.alt, b.z);
        if (b.life <= 0) {
            Game.scene.remove(b.mesh);
            Game._bombers.splice(i, 1);
        }
    }
};

Game.updateAirStrikes = (dt) => {
    for (let i = Game.airStrikes.length - 1; i >= 0; i--) {
        const strike = Game.airStrikes[i];
        strike.delay -= dt;
        // Shells fall as a WALKING STICK of bombs, one after another — not the
        // whole load detonating in a single frame (that read as a "firecracker"
        // burst of overlapping little explosions instead of a bombing run).
        if (strike.delay <= 0 && !strike.done) {
            if (!strike._runStarted) {
                strike._runStarted = true;
                strike._shellT = 0;
                Game.lastAttackPos = { x: strike.x, z: strike.z };
                if (Game._spawnBomberFlyover) Game._spawnBomberFlyover(strike.x, strike.z);
                // Bombing run visual — tracer lines from approach direction
                for (let t = 0; t < 5; t++) {
                    const approachX = strike.x + Game.rand(-3, 3);
                    const approachZ = strike.z - 15; // Planes come from north
                    Game.tracers.push({
                        x: approachX, z: approachZ,
                        tx: strike.x + Game.rand(-5, 5), tz: strike.z + Game.rand(-5, 5),
                        life: 0.5, total: 0.5,
                        team: Game.playerTeam, big: true, mesh: null,
                    });
                }
                Game.pushMessage('Air strike impact!', 2.0);
            }
            strike._shellT -= dt;
            while (strike._shellT <= 0 && strike.shells > 0) {
                strike._shellT += Game.rand(0.12, 0.3);
                strike.shells--;
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
                Game.cameraShake = Math.max(Game.cameraShake || 0, 9);
            }
            if (strike.shells <= 0) strike.done = true;
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
    const crewKind = vehicle.team === Game.TEAM.POLISH ? 'ulan'
        : (vehicle.team === Game.TEAM.FRENCH ? 'fusilier' : 'grenadier');
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
        if (Game.clearArrivalFacing) Game.clearArrivalFacing(unit);
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
    if (mine.team === Game.playerTeam && Game.scene && Game.THREE && Game.effectsGroup) {
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
Game.canTow = (u) => Game.isVehicle(u) || ['supply', 'fuel', 'transport'].includes(u.supportType);
Game.isTowableAT = (u) => !!u && u.deployable && u.kind !== 'hmg';
Game.towedBy = (tower) => Game.units.find(u => u.alive && u._towed && u._towedBy === tower.id) || null;
Game.towHitchPoint = (tower) => ({
    x: tower.x - Math.cos(tower.angle) * 1.4,
    z: tower.z - Math.sin(tower.angle) * 1.4,
});
// Drawbar length: hitch to the towed gun's axle. Pivot 1.4 + drawbar 0.6 puts
// the riding gun 2.0 behind the truck's centre — right on the tailgate.
Game.TOW_DRAWBAR = 0.6;
Game.transportEntryPoint = (carrier) => ({
    x: carrier.x - Math.cos(carrier.angle) * 1.82,
    z: carrier.z - Math.sin(carrier.angle) * 1.82,
});
Game.nearTowTarget = (tower, radius = 2.8) => {
    const hitch = Game.towHitchPoint(tower);
    let best = null, bd = radius * radius;
    Game.units.forEach(u => {
        if (!u.alive || u.team !== tower.team || !Game.isTowableAT(u) || u._towed) return;
        const d = Game.distSq(hitch.x, hitch.z, u.x, u.z);
        if (d < bd) { bd = d; best = u; }
    });
    return best;
};

Game.towUnit = (tower, target, quiet = false) => {
    if (!tower.alive || !target.alive) return;
    if (!Game.canTow(tower)) return;
    if (!Game.isTowableAT(target)) { Game.pushMessage('Only anti-tank guns can be towed.', 1.5); return; }
    if (Game.towedBy(tower)) { Game.pushMessage(`${tower.label} is already towing a gun.`, 1.5); return; }
    if (target._towed) return;
    if (Game.clearArrivalFacing) Game.clearArrivalFacing(target);
    target._towed = true;
    target._towedBy = tower.id;
    tower._towedUnitId = target.id;
    target.path = [];
    target.moving = false;
    target.deployed = false; target._deployT = 0; // rides limbered
    // Couple up straight behind the hitch; the trailer sim swings it from here.
    const hitch = Game.towHitchPoint(tower);
    target.angle = tower.angle + Math.PI;
    target.x = Game.clamp(hitch.x + Math.cos(target.angle) * Game.TOW_DRAWBAR, 1, Game.WORLD_W - 1);
    target.z = Game.clamp(hitch.z + Math.sin(target.angle) * Game.TOW_DRAWBAR, 1, Game.WORLD_H - 1);
    // A manned gun's crew climbs aboard as real passengers (visible in the
    // truck's passenger badge and unloadable like any infantry).
    let crewBoarded = false;
    if (Game.GUN_CREWS && Game.GUN_CREWS[target.kind] && !target._unmanned
        && (target._crewAboard ?? 2) > 0) {
        const kind = (Game.GUN_CREW_KINDS_BY_TEAM && Game.GUN_CREW_KINDS_BY_TEAM[target.team]) || 'fusilier';
        const men = target._crewAboard ?? 2;
        tower._passengers = tower._passengers || [];
        for (let i = 0; i < men; i++) {
            const man = Game.makeUnit(target.team, kind, tower.x, tower.z, {
                group: 'crew',
                aiState: target.team === Game.playerTeam ? 'player' : 'hold',
            });
            if (!man) continue;
            man._crewOfGunId = target.id;
            man._inVehicle = tower.id;
            man._preCarrierStance = man.stance;
            if (man.mesh) man.mesh.visible = false;
            tower._passengers.push(man.id);
        }
        target._crewAboard = 0;
        target._unmanned = true;
        crewBoarded = true;
    }
    if (!quiet) Game.pushMessage(crewBoarded
        ? `${tower.label} is towing ${target.label} — the crew rides on the truck.`
        : `${tower.label} is towing ${target.label}.`, 2.0);
};

// ── Gun crews as real men: dismount to infantry, re-man like a horse ────────
// Dismounting spawns the crew as ordinary foot soldiers beside the trails and
// leaves the piece unmanned (it cannot move or fire). Any foot infantry can be
// sent back onto an unmanned gun by clicking it; on arrival they are absorbed
// and the gun works again.
Game.GUN_CREW_KINDS_BY_TEAM = { french: 'fusilier', polish: 'rifleman', german: 'grenadier' };

Game.dismountGunCrew = (gun) => {
    if (!gun || !gun.alive || !(Game.GUN_CREWS && Game.GUN_CREWS[gun.kind])) return false;
    if (gun._towed) { Game.pushMessage('Detach the gun from the truck first.', 1.6); return false; }
    if (gun._unmanned) return false;
    const kind = Game.GUN_CREW_KINDS_BY_TEAM[gun.team] || 'fusilier';
    const men = gun._crewAboard ?? 2;
    const behind = gun.angle + Math.PI;
    for (let i = 0; i < men; i++) {
        const side = i % 2 ? 1 : -1;
        const x = Game.clamp(gun.x + Math.cos(behind) * 1.5
            + Math.cos(gun.angle + Math.PI / 2) * side * 0.9, 1, Game.WORLD_W - 1);
        const z = Game.clamp(gun.z + Math.sin(behind) * 1.5
            + Math.sin(gun.angle + Math.PI / 2) * side * 0.9, 1, Game.WORLD_H - 1);
        const man = Game.makeUnit(gun.team, kind, x, z, {
            group: 'crew',
            aiState: gun.team === Game.playerTeam ? 'player' : 'hold',
        });
        if (man) man._crewOfGunId = gun.id;
    }
    gun._crewAboard = 0;
    gun._unmanned = true;
    Game.pushMessage(`${gun.label}: crew dismounts.`, 1.8);
    return true;
};

Game.orderManGun = (gun, candidates) => {
    if (!gun || !gun.alive || gun._towed) return false;
    const need = 2 - (gun._crewAboard || 0);
    if (need <= 0) return false;
    const takers = candidates.slice(0, need);
    if (!takers.length) return false;
    takers.forEach(u => {
        u._enterGunId = gun.id;
        u.forcedTargetId = null;
        u._enterRec = null;
        u._enterCarrierId = null;
        if (Game.cancelQueuedPath) Game.cancelQueuedPath(u);
        u.path = Game.findPath(u, u.x, u.z, gun.x, gun.z);
        u.moving = true;
        u.orderDelay = Game.commandDelay ? Game.commandDelay(u) : 0;
    });
    Game.pushMessage(`${takers.length} soldier${takers.length === 1 ? '' : 's'} moving to man ${gun.label}.`, 1.8);
    return true;
};

Game.updateGunManning = () => {
    for (const u of Game.units) {
        if (!u.alive || u._enterGunId == null) continue;
        const gun = Game.getUnitById(u._enterGunId);
        if (!gun || !gun.alive || gun._towed || (gun._crewAboard || 0) >= 2) {
            // The piece got hitched while its crew was still walking back:
            // they chase the truck and ride along instead of standing lost.
            if (gun && gun.alive && gun._towed && u._crewOfGunId === gun.id) {
                const tower = Game.getUnitById(gun._towedBy);
                if (tower && tower.alive && Game.transportHasRoom(tower)) {
                    const entry = Game.transportEntryPoint(tower);
                    u._enterCarrierId = tower.id;
                    u.path = Game.findCarrierEntryPath(u, entry.x, entry.z);
                    u.moving = u.path.length > 0;
                }
            }
            u._enterGunId = null;
            continue;
        }
        if (Game.dist(u.x, u.z, gun.x, gun.z) < 1.5) {
            u._enterGunId = null;
            u.alive = false;
            u._absorbed = true;
            // He stepped onto the gun, he didn't die: skip the corpse
            // promotion in the renderer (no phantom body left behind).
            u._deathHandled = true;
            u._noRemnant = true;
            if (u.mesh) u.mesh.visible = false;
            Game.selection.delete(u.id);
            gun._crewAboard = (gun._crewAboard || 0) + 1;
            if (gun._unmanned) {
                gun._unmanned = false;
                Game.pushMessage(`${gun.label} is manned again.`, 1.8);
            }
        }
    }
};

// Hover affordance: a selected transport over a towable gun (or a selected
// towable gun over a free transport) advertises click-to-attach. Works with
// ANY selection size — the requirement of exactly one selected unit meant a
// box-select or double-click selection made the right-click silently fall
// through to a plain move order (walk to the truck and stand there), which
// looked like the hook-up "not working". The mover is the nearest eligible
// selected unit; an unmanned gun cannot move itself.
Game.getTowHoverPair = (hoverUnit, explain = false) => {
    if (!hoverUnit || !hoverUnit.alive || hoverUnit.team !== Game.playerTeam) return null;
    const sel = Game.selectedPlayerUnits().filter(u => u !== hoverUnit);
    if (!sel.length) return null;
    const truckFree = u => Game.isTruck(u.kind) && Game.canTow(u) && !Game.towedBy(u);
    const gunFree = u => Game.isTowableAT(u) && !u._towed;
    // A crew walking back to its piece counts as manned: the approach simply
    // waits for them. Without this, ordering a re-attach in the seconds after
    // a detach was refused and the click degraded to a dead plain move.
    const crewInbound = g => Game.units.some(m => m.alive && m._enterGunId === g.id);
    const canDrive = g => !g._unmanned || crewInbound(g);
    const nearest = (list) => list.sort((a, b) =>
        Game.distSq(a.x, a.z, hoverUnit.x, hoverUnit.z)
        - Game.distSq(b.x, b.z, hoverUnit.x, hoverUnit.z))[0];
    if (gunFree(hoverUnit)) {
        const truck = nearest(sel.filter(truckFree));
        if (truck) return { mover: truck, truck, gun: hoverUnit };
    }
    if (truckFree(hoverUnit)) {
        const gun = nearest(sel.filter(u => gunFree(u) && canDrive(u)));
        if (gun) return { mover: gun, truck: hoverUnit, gun };
    }
    // On an actual CLICK (not the per-frame hover probe), almost-pairs get a
    // reason and the click is consumed — degrading to a plain move order is
    // exactly the "walks to the truck and stands there" bug.
    if (!explain) return null;
    if (truckFree(hoverUnit) && sel.some(u => gunFree(u) && !canDrive(u))) {
        Game._towClickReason = true;
        Game.pushMessage('The gun has no crew — man it first, or bring the truck to it.', 2.4);
    } else if (sel.some(truckFree) && Game.isTowableAT(hoverUnit) && hoverUnit._towed) {
        Game._towClickReason = true;
        Game.pushMessage(`${hoverUnit.label} is already being towed.`, 1.8);
    } else if (sel.some(gunFree) && Game.isTruck(hoverUnit.kind) && Game.towedBy(hoverUnit)) {
        Game._towClickReason = true;
        Game.pushMessage(`${hoverUnit.label} is already towing a gun — detach it first.`, 2.0);
    }
    return null;
};

// Forgiving pick for the click-to-attach flow: a click near (not exactly on)
// the counterpart still counts, like enemyAtWorld does for attack orders.
Game.towCounterpartAtWorld = (gx, gz, radius = 3.0) => {
    let best = null, bd = radius * radius;
    for (const u of Game.units) {
        if (!u.alive || u.team !== Game.playerTeam) continue;
        const eligible = (Game.isTruck(u.kind) && Game.canTow(u) && !Game.towedBy(u))
            || (Game.isTowableAT(u) && !u._towed);
        if (!eligible) continue;
        const d = Game.distSq(gx, gz, u.x, u.z);
        if (d < bd) { bd = d; best = u; }
    }
    return best;
};

// Where an approaching gun aims: past the hitch, clear of the truck's own
// parked footprint, so A* can actually deliver the gun there.
Game.towApproachPoint = (tower) => ({
    x: tower.x - Math.cos(tower.angle) * 2.9,
    z: tower.z - Math.sin(tower.angle) * 2.9,
});

// A* returns tile-centre waypoints, but the hook-up point is a precise spot
// at the truck's tailgate. Preserve the A* chain and append the exact rear
// point as its final, directly walkable leg (same treatment as infantry
// boarding paths) so the gun really arrives at the back of the truck.
Game.towApproachPath = (mover, truck) => {
    const ap = Game.towApproachPoint(truck);
    const path = Game.findPath(mover, mover.x, mover.z, ap.x, ap.z) || [];
    const last = path.length ? path[path.length - 1] : { x: mover.x, z: mover.z };
    if (Game.distSq(last.x, last.z, ap.x, ap.z) > 0.01
        && (!Game.segmentPassable || Game.segmentPassable(mover, last.x, last.z, ap.x, ap.z))) {
        path.push({ x: ap.x, z: ap.z, _exactGoal: true });
    }
    return path;
};

// A truck never aims at the gun's exact spot: its bicycle steering orbits a
// point it keeps overshooting. Stop short on the approach line; the hookup's
// hold-and-swing closes the rest.
Game.towTruckGoal = (truck, gun) => {
    const d = Math.max(0.001, Game.dist(truck.x, truck.z, gun.x, gun.z));
    const t = Math.max(0, (d - 4.2) / d);
    return {
        x: Game.clamp(truck.x + (gun.x - truck.x) * t, 1, Game.WORLD_W - 1),
        z: Game.clamp(truck.z + (gun.z - truck.z) * t, 1, Game.WORLD_H - 1),
    };
};

Game.orderTowApproach = (pair) => {
    const { mover, truck, gun } = pair || {};
    if (!mover || !truck || !gun) return false;
    mover._towApproachTruckId = truck.id;
    mover._towApproachGunId = gun.id;
    mover._towProg = null;
    mover._towRepathT = 0;
    mover._towCoupleT = 0;
    if (Game.cancelQueuedPath) Game.cancelQueuedPath(mover);
    // A clean relocate: nothing may halt the approach to fight.
    mover.orderMode = 'move';
    mover.forcedTargetId = null;
    mover._assaultGoal = null;
    mover._engageId = null;
    mover._inFiringPos = false;
    const goal = mover === truck ? Game.towTruckGoal(truck, gun) : Game.towApproachPoint(truck);
    if ((Game.isTank(mover.kind) || Game.isTruck(mover.kind)) && Game.queueVehiclePath
        && Game.dist(mover.x, mover.z, goal.x, goal.z) > 20) {
        mover.path = [];
        Game.queueVehiclePath(mover, goal.x, goal.z, (path) => {
            if (mover._towApproachGunId !== gun.id) return;
            mover.path = path;
        });
    } else if (mover === truck) {
        mover.path = Game.findPath(mover, mover.x, mover.z, goal.x, goal.z);
    } else {
        mover.path = Game.towApproachPath(mover, truck);
    }
    mover.moving = true;
    mover.stopTimer = 0;
    // No command-reaction delay: the crew hustles straight to the hook-up.
    // (A deployed gun still takes its 1 s to limber before rolling.)
    mover.orderDelay = 0;
    Game.spawnOrderMarker(goal.x, goal.z, 0x55ccff);
    Game.pushMessage(mover === truck
        ? `${truck.label} moving to hook up ${gun.label}.`
        : `${gun.label} moving to ${truck.label} for towing.`, 2.0);
    return true;
};

Game.updateTowApproaches = (dt = 1 / 60) => {
    for (const u of Game.units) {
        if (!u.alive || u._towApproachGunId == null) continue;
        const gun = Game.getUnitById(u._towApproachGunId);
        const truck = Game.getUnitById(u._towApproachTruckId);
        if (!gun || !gun.alive || !truck || !truck.alive
            || gun._towed || Game.towedBy(truck)) {
            u._towApproachGunId = null;
            u._towApproachTruckId = null;
            continue;
        }
        const gap = Game.dist(truck.x, truck.z, gun.x, gun.z);
        // Sudden-Strike hookup: close in, the truck swings its rear toward
        // the gun, and the coupling happens once roughly aligned. Inside the
        // hold radius the mover stops and waits for the swing instead of
        // chasing the rotating hitch point around the truck.
        const HOLD = 5.4, ATTACH_ALIGN = 0.6;
        const away = Game.angleTo(gun.x, gun.z, truck.x, truck.z);
        const aligned = Math.abs(Game.angleDiff(truck.angle, away)) < ATTACH_ALIGN;
        if (gap < 8) {
            truck.angle = Game.rotateTo(truck.angle, away,
                Math.max(truck.rotationSpeed || 0, 1.6) * dt);
            truck.turretAngle = truck.angle;
        }
        if (gap < HOLD) {
            u.path = [];
            u.moving = false;
            // The crew wheels the piece around on the spot (a gun can spin a
            // full circle in place) so its trail meets the hitch while the
            // truck swings its rear. And the coupling must NEVER hang on a
            // perfect line-up: once close for a couple of seconds, hook up.
            const rideAngle = Game.angleTo(truck.x, truck.z, gun.x, gun.z);
            gun.angle = Game.rotateTo(gun.angle, rideAngle, 2.4 * dt);
            if (gun.turretAngle != null) gun.turretAngle = gun.angle;
            u._towCoupleT = (u._towCoupleT || 0) + dt;
            if (aligned || u._towCoupleT > 2.5) {
                u._towApproachGunId = null;
                u._towApproachTruckId = null;
                u._towCoupleT = 0;
                Game.towUnit(truck, gun);
            }
        } else if (u === truck && gap < 9 && !gun._unmanned) {
            // Sudden-Strike handoff: the truck parks close and the crew
            // wheels the gun the last stretch (the truck's bicycle steering
            // orbits tight goals; the gun is agile and never misses).
            truck.path = [];
            truck.moving = false;
            truck._towApproachGunId = null;
            truck._towApproachTruckId = null;
            gun._towApproachGunId = gun.id;
            gun._towApproachTruckId = truck.id;
            gun.path = Game.towApproachPath(gun, truck);
            gun.moving = gun.path.length > 0;
            gun.orderDelay = 0;
        } else {
            u._towCoupleT = 0;
            // Mid-route watchdog. Two triggers: the path ran dry short of the
            // hook-up (partial A* leg, counterpart moved), or the gap simply
            // stopped shrinking — local avoidance cleared the path, or a
            // parked hull keeps re-arming the stop timer. Either way re-path
            // and keep driving: an approach order must never quietly die.
            const pathDry = (!u.path || !u.path.length) && (u.stopTimer || 0) <= 0
                && (u.orderDelay || 0) <= 0 && (u._deployT || 0) <= 0;
            if (!u._towProg || gap < u._towProg.gap - 0.4) u._towProg = { gap, t: 0 };
            else u._towProg.t += dt;
            u._towRepathT = (u._towRepathT || 0) - dt;
            if (((pathDry && u._towRepathT <= 0) || u._towProg.t > 2.0) && !u._routePending) {
                u._towRepathT = 1.2;
                u._towProg = { gap, t: 0 };
                u.stopTimer = 0;
                u.orderDelay = 0;
                if (u === truck) {
                    const goal = Game.towTruckGoal(truck, gun);
                    u.path = Game.findPath(u, u.x, u.z, goal.x, goal.z);
                } else {
                    u.path = Game.towApproachPath(u, truck);
                }
                u.moving = u.path.length > 0;
            }
        }
    }
};

Game.updateTowing = (dt) => {
    Game.updateGunManning();
    Game.updateTowApproaches(dt);
    Game.units.forEach(u => {
        if (!u.alive || !u._towed) return;
        const tower = Game.units.find(t => t.id === u._towedBy && t.alive);
        if (!tower) {
            const oldTower = Game.units.find(t => t.id === u._towedBy);
            if (oldTower) oldTower._towedUnitId = null;
            u._towed = false;
            u._towedBy = null;
            return;
        }
        // Trailer kinematics, not a rigid weld: the gun pivots at the hitch
        // and is DRAGGED — each frame it keeps its drawbar length along the
        // previous hitch-to-gun direction, so it swings out through turns and
        // straightens on the move. A jackknife clamp keeps it within ~55 deg
        // of straight-behind.
        const hitch = Game.towHitchPoint(tower);
        const DRAWBAR = Game.TOW_DRAWBAR;
        let dx = u.x - hitch.x, dz = u.z - hitch.z;
        const len = Math.hypot(dx, dz);
        const straight = tower.angle + Math.PI;
        let dir = len < 0.05 ? straight : Math.atan2(dz, dx);
        dir = straight + Game.clamp(Game.angleDiff(straight, dir), -0.95, 0.95);
        u.x = hitch.x + Math.cos(dir) * DRAWBAR;
        u.z = hitch.z + Math.sin(dir) * DRAWBAR;
        u.angle = dir;
    });
    Game.updateCarrierEntry(dt);
    Game.updateCarrierPassengers();
    // A destroyed carrier spills its passengers (shaken and wounded).
    Game.units.forEach(c => {
        if (!c._passengers || !c._passengers.length || c.alive) return;
        c._passengers.forEach(pid => {
            const inf = Game.getUnitById(pid);
            if (!inf || !inf.alive) return;
            inf._inVehicle = null;
            if (inf.mesh) inf.mesh.visible = true;
            inf.x = c.x + Game.rand(-2, 2); inf.z = c.z + Game.rand(-2, 2);
            inf.y = Game.getHeight ? Game.getHeight(inf.x, inf.z) : 0;
            inf.stance = inf._preCarrierStance || 'stand';
            inf._preCarrierStance = null;
            inf.hp = Math.max(1, inf.hp - 40);
            inf.suppressionValue = Game.clamp((inf.suppressionValue || 0) + 50, 0, 100);
        });
        c._passengers = [];
    });
};

Game.untowUnit = (target) => {
    if (!target._towed) return;
    const tower = Game.units.find(t => t.id === target._towedBy);
    if (tower) tower._towedUnitId = null;
    target._towed = false;
    target._towedBy = null;
    // The riding crew hops off beside the gun and mans it again (the manning
    // loop absorbs them next tick, so this reads as one smooth motion).
    if (tower && tower._passengers && tower._passengers.length) {
        const crewIds = tower._passengers.filter(pid => {
            const man = Game.getUnitById(pid);
            return man && man._crewOfGunId === target.id;
        });
        crewIds.forEach((pid, i) => {
            const man = Game.getUnitById(pid);
            tower._passengers = tower._passengers.filter(id => id !== pid);
            man._inVehicle = null;
            man.stance = man._preCarrierStance || 'stand';
            man._preCarrierStance = null;
            man.x = Game.clamp(target.x + Game.rand(-0.8, 0.8), 1, Game.WORLD_W - 1);
            man.z = Game.clamp(target.z + Game.rand(-0.8, 0.8), 1, Game.WORLD_H - 1);
            man.y = Game.getHeight ? Game.getHeight(man.x, man.z) : 0;
            if (man.mesh) man.mesh.visible = true;
            man._enterGunId = target.id;
            man.path = [];
            man.moving = false;
        });
    }
    Game.pushMessage(`${target.label} un-towed.`, 1.5);
};

// ═══════════════════════════════════════════════════════
//  TROOP TRANSPORT (carry infantry in trucks)
// ═══════════════════════════════════════════════════════

Game.CARRIER_CAP = 5;
Game.TRANSPORT_CAP = 10;
Game.isCarrier = (u) => ['supply', 'fuel', 'transport'].includes(u.supportType);
Game.carrierCapacity = (u) => u.supportType === 'transport' ? Game.TRANSPORT_CAP : Game.CARRIER_CAP;
Game.transportHasRoom = (u) => Game.isCarrier(u)
    && (u._passengers ? u._passengers.length : 0) < Game.carrierCapacity(u);

// A* returns tile-centre waypoints. That is normally desirable, but a tailgate
// is a precise point near a tile edge: stopping at the containing tile's centre
// can leave a soldier more than a unit from the truck. Preserve the A* chain and
// append the exact boarding/staging point as its final, directly walkable leg.
Game.findCarrierEntryPath = (inf, tx, tz) => {
    const path = Game.findPath(inf, inf.x, inf.z, tx, tz) || [];
    const last = path.length ? path[path.length - 1] : { x: inf.x, z: inf.z };
    if (Game.distSq(last.x, last.z, tx, tz) > 0.01
        && (!Game.segmentPassable || Game.segmentPassable(inf, last.x, last.z, tx, tz))) {
        path.push({ x: tx, z: tz, _carrierEntry: true });
    }
    return path;
};

Game.loadUnit = (inf, carrier) => {
    if (!inf.alive || !carrier.alive || inf === carrier) return false;
    if (!Game.isFootInfantry(inf) || inf.deployable) return false; // foot troops only
    if (Game.cancelHorseMountOrder) Game.cancelHorseMountOrder(inf);
    carrier._passengers = carrier._passengers || [];
    if (carrier._passengers.length >= Game.carrierCapacity(carrier)) { Game.pushMessage(`${carrier.label} is full.`, 1.5); return false; }
    if (Game.clearArrivalFacing) Game.clearArrivalFacing(inf);
    carrier._passengers.push(inf.id);
    if (carrier._boardingQueue) {
        const qi = carrier._boardingQueue.indexOf(inf.id);
        if (qi >= 0) carrier._boardingQueue.splice(qi, 1);
    }
    inf._inVehicle = carrier.id;
    inf._enterCarrierId = null;
    inf._enterCarrierRepath = null;
    inf._preCarrierStance = inf.stance;
    inf.stance = 'rest';
    inf.path = []; inf.moving = false; inf.currentSpeed = 0; inf._dispSpeed = 0;
    // Transport passengers remain visible, seated along the open bed. Legacy
    // supply/fuel carriers keep their occupants abstracted inside the body.
    if (inf.mesh) inf.mesh.visible = carrier.supportType === 'transport';
    if (Game.selection.has(inf.id)) Game.selection.delete(inf.id);
    return true;
};

// Building-style entry order: selected infantry walk to the tailgate and board
// when they reach it instead of disappearing into a distant truck instantly.
Game.orderEnterCarrier = (carrier) => {
    if (!carrier || !carrier.alive || carrier.supportType !== 'transport') return;
    carrier._boardingQueue = (carrier._boardingQueue || []).filter(id => {
        const u = Game.getUnitById(id);
        return u && u.alive && u._inVehicle == null;
    });
    const room = Game.carrierCapacity(carrier)
        - (carrier._passengers ? carrier._passengers.length : 0) - carrier._boardingQueue.length;
    const rear = Game.transportEntryPoint(carrier);
    const inf = Game.selectedPlayerUnits().filter(u => u.alive && Game.isFootInfantry(u)
        && u._inVehicle == null && !u._garrisoned && !carrier._boardingQueue.includes(u.id))
        .sort((a, b) => Game.distSq(a.x, a.z, rear.x, rear.z) - Game.distSq(b.x, b.z, rear.x, rear.z))
        .slice(0, Math.max(0, room));
    if (!inf.length) {
        Game.pushMessage(room > 0 ? 'Select infantry to enter the transport.' : `${carrier.label} is full.`, 1.5);
        return;
    }
    inf.forEach((u, i) => {
        if (Game.cancelHorseMountOrder) Game.cancelHorseMountOrder(u);
        if (Game.clearArrivalFacing) Game.clearArrivalFacing(u);
        carrier._boardingQueue.push(u.id);
        u._enterCarrierId = carrier.id;
        u._enterCarrierRepath = 0;
        // A soldier ordered aboard may currently be in the autonomous `rest`
        // posture, whose movement multiplier is deliberately zero. Wake him
        // before assigning the tailgate path or he has a route but cannot move.
        if (Game.AI && Game.AI.clearPosture) Game.AI.clearPosture(u);
        u.stance = 'stand';
        u._autoStance = false;
        u.orderMode = 'move';
        u.orderDelay = Game.commandDelay ? Game.commandDelay(u) : 0;
    });
    Game.updateCarrierEntry(0);
    if (Game.spawnOrderMarker) Game.spawnOrderMarker(rear.x, rear.z, 0x66ccff);
    Game.pushMessage(`Entering ${carrier.label}.`, 1.6);
};

Game.updateCarrierEntry = (dt) => {
    Game.units.forEach(carrier => {
        if (!carrier._boardingQueue || !carrier._boardingQueue.length) return;
        carrier._boardingQueue = carrier._boardingQueue.filter(id => {
            const u = Game.getUnitById(id);
            return u && u.alive && u._inVehicle == null && u._enterCarrierId === carrier.id;
        });
        if (!carrier.alive || !Game.transportHasRoom(carrier)) {
            carrier._boardingQueue.forEach(id => {
                const u = Game.getUnitById(id);
                if (u) { u._enterCarrierId = null; u.path = []; u.moving = false; }
            });
            carrier._boardingQueue = [];
            return;
        }
        const fX = Math.cos(carrier.angle), fZ = Math.sin(carrier.angle);
        const lX = -fZ, lZ = fX;
        const head = Game.getUnitById(carrier._boardingQueue[0]);
        if (head) {
            const rear = Game.transportEntryPoint(carrier);
            const hd = Game.dist(head.x, head.z, rear.x, rear.z);
            if (carrier._boardingHeadId !== head.id || hd < (carrier._boardingHeadBest ?? Infinity) - 0.15) {
                carrier._boardingHeadId = head.id;
                carrier._boardingHeadBest = hd;
                carrier._boardingHeadStall = 0;
            } else {
                carrier._boardingHeadStall = (carrier._boardingHeadStall || 0) + dt;
                // Do not let one blocked approach hold seven soldiers at their
                // valid staging points forever. Rotate it to the back, retain its
                // boarding order, and retry after the others have advanced.
                if (carrier._boardingHeadStall > 3 && hd > 1) {
                    carrier._boardingQueue.push(carrier._boardingQueue.shift());
                    carrier._boardingHeadId = null;
                    carrier._boardingHeadBest = Infinity;
                    carrier._boardingHeadStall = 0;
                }
            }
        }
        carrier._boardingQueue.slice().forEach((id, i) => {
            const inf = Game.getUnitById(id);
            if (!inf) return;
            // Only the head of the queue uses the tailgate. Everyone else waits
            // in a staggered file behind it, preventing eight men from colliding
            // over the same final waypoint.
            const row = Math.floor((Math.max(1, i) - 1) / 2);
            const side = i === 0 ? 0 : (i % 2 ? -0.62 : 0.62);
            const back = i === 0 ? 1.82 : 2.55 + row * 0.68;
            const tx = carrier.x - fX * back + lX * side;
            const tz = carrier.z - fZ * back + lZ * side;
            const d2 = Game.distSq(inf.x, inf.z, tx, tz);
            // Hull collision keeps a soldier's centre about 0.63u from this
            // point even when he is visibly at the tailgate. Board within 0.75u
            // so he enters at rear contact instead of walking past and looping.
            if (i === 0 && d2 <= 0.5625) {
                Game.loadUnit(inf, carrier);
                return;
            }
            inf._enterCarrierRepath = (inf._enterCarrierRepath || 0) - dt;
            if (inf._enterCarrierRepath <= 0 && d2 > 0.16) {
                inf.path = Game.findCarrierEntryPath(inf, tx, tz);
                inf.moving = inf.path.length > 0;
                inf._enterCarrierRepath = 0.45;
            }
        });
    });
};

Game.updateCarrierPassengers = () => {
    Game.units.forEach(carrier => {
        if (!carrier.alive || carrier.supportType !== 'transport' || !carrier._passengers) return;
        const fX = Math.cos(carrier.angle), fZ = Math.sin(carrier.angle);
        const lX = -fZ, lZ = fX;
        carrier._passengers.forEach((pid, i) => {
            const inf = Game.getUnitById(pid);
            if (!inf || !inf.alive) return;
            const side = i % 2 ? 1 : -1;
            const row = Math.floor(i / 2);
            // Five pairs fit when the first bench row uses the free space toward
            // the cab; the remaining rows continue rearward at the same spacing.
            const along = 0.22 - row * 0.38;
            inf.x = carrier.x + fX * along + lX * side * 0.22;
            inf.z = carrier.z + fZ * along + lZ * side * 0.22;
            inf.y = (carrier.y || 0) + 0.72;
            // Face across the bed toward the opposite bench. The original seat
            // yaw pointed both rows outward through the truck's side panels.
            inf.angle = carrier.angle + (side < 0 ? Math.PI / 2 : -Math.PI / 2);
            inf.stance = 'rest';
            inf._dispSpeed = 0;
            if (inf.mesh) inf.mesh.visible = true;
        });
    });
};

Game.unloadCarrier = (carrier, tx = null, tz = null) => {
    if (!carrier._passengers || !carrier._passengers.length) return;
    let n = 0;
    const rear = Game.transportEntryPoint(carrier);
    const fX = Math.cos(carrier.angle), fZ = Math.sin(carrier.angle);
    const lX = -fZ, lZ = fX;
    carrier._passengers.forEach((pid, i, arr) => {
        const inf = Game.getUnitById(pid);
        if (!inf || !inf.alive) return;
        // Everyone exits through the rear, fanned just enough not to overlap.
        const side = (i % 2 ? 1 : -1) * (0.28 + Math.floor(i / 2) * 0.12);
        inf.x = Game.clamp(rear.x - fX * 0.25 + lX * side, 1, Game.WORLD_W - 1);
        inf.z = Game.clamp(rear.z - fZ * 0.25 + lZ * side, 1, Game.WORLD_H - 1);
        inf._inVehicle = null;
        inf.stance = inf._preCarrierStance || 'stand';
        inf._preCarrierStance = null;
        inf.y = Game.getHeight ? Game.getHeight(inf.x, inf.z) : 0;
        inf.path = []; inf.moving = false;
        if (tx != null && tz != null) {
            const a = (i / Math.max(1, arr.length)) * Math.PI * 2;
            const r = i === 0 ? 0 : 0.9 + Math.floor((i - 1) / 4) * 0.8;
            const gx = Game.clamp(tx + Math.cos(a) * r, 1, Game.WORLD_W - 1);
            const gz = Game.clamp(tz + Math.sin(a) * r, 1, Game.WORLD_H - 1);
            inf.path = Game.findCarrierEntryPath(inf, gx, gz);
            inf.moving = inf.path.length > 0;
            inf._unloading = inf.moving;
            inf.orderMode = 'move';
            inf.orderDelay = Game.commandDelay ? Game.commandDelay(inf) : 0;
        }
        if (inf.mesh) inf.mesh.visible = true;
        n++;
    });
    carrier._passengers = [];
    Game.pushMessage(`${carrier.label} unloaded ${n} troops${tx != null ? ' to the marked position' : ''}.`, 1.8);
};

Game.toggleSelectedTow = () => {
    const tower = Game.selectedPlayerUnits().find(u => u.supportType === 'transport');
    if (!tower) return;
    const attached = Game.towedBy(tower);
    if (attached) Game.untowUnit(attached);
    else {
        const target = Game.nearTowTarget(tower);
        if (target) Game.towUnit(tower, target);
        else Game.pushMessage('Back the truck up to an anti-tank gun first.', 1.8);
    }
};

Game.toggleSelectedCarrier = () => {
    const carrier = Game.selectedPlayerUnits().find(u => u.supportType === 'transport');
    if (!carrier) return;
    if (carrier._passengers && carrier._passengers.length) {
        Game.unloadCarrier(carrier);
        return;
    }
    const pool = Game.units.filter(u => u.alive && u.team === carrier.team
        && Game.isFootInfantry(u) && u._inVehicle == null
        && Game.distSq(u.x, u.z, carrier.x, carrier.z) < 10 * 10);
    let n = 0;
    pool.forEach(u => { if (Game.loadUnit(u, carrier)) n++; });
    Game.pushMessage(n ? `${carrier.label} loaded ${n} troops.` : 'No infantry nearby to load.', 1.6);
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
Game.FOG_UPDATE_INTERVAL = 0.2; // 5 Hz is responsive and avoids a constant 8.3 Hz CPU tax

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
    Game._fogImageData = Game._fogCtx.createImageData(256, 256);
    Game._fogBlurCanvas = document.createElement('canvas');
    Game._fogBlurCanvas.width = 256;
    Game._fogBlurCanvas.height = 256;
    Game._fogBlurCtx = Game._fogBlurCanvas.getContext('2d');
    Game._fogBlurCtx.filter = 'blur(3px)';
    Game._fogVisibleCells = [];
    Game._fogNextVisibleCells = [];
    Game._fogWasDisabled = false;
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
    if (Game._fogDisabled) {
        // debug: full light, whole map visible
        // Keep this authoritative while debug visibility is active: scenario/
        // side reset paths are allowed to clear the grid between fog updates.
        Game.fogGrid.fill(1);
        Game._fogVisibleCells.length = 0;
        Game._fogWasDisabled = true;
    } else {
    // Decay only cells that were visible last pass. Sweeping the entire 360k
    // grid every update dominated Mokra because 55 friendly units reveal only a
    // fraction of it. Leaving debug full-visibility is the one full reset.
    if (Game._fogWasDisabled) {
        for (let i = 0; i < Game.fogGrid.length; i++) {
            if (Game.fogGrid[i] > 0.5) Game.fogGrid[i] = 0.5;
        }
        Game._fogWasDisabled = false;
    } else {
        // A side/scenario reset can clear the grid without knowing about this
        // cache. Do not resurrect its old visible cells as explored afterward.
        for (const index of Game._fogVisibleCells) {
            if (Game.fogGrid[index] === 1) Game.fogGrid[index] = 0.5;
        }
    }
    const visibleNow = Game._fogNextVisibleCells;
    visibleNow.length = 0;
    const reveal = index => {
        if (Game.fogGrid[index] === 1) return;
        Game.fogGrid[index] = 1;
        visibleNow.push(index);
    };
    // Reveal around friendly units
    Game.units.forEach(u => {
        if (!u.alive || u.team !== Game.playerTeam) return;
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
                    reveal(gz * Game.fogCols + gx);
                }
            }
        }
    });
    // Friendly aircraft on station: a MASSIVE recon bubble rides the plane —
    // the whole reason to call the sortie even with nothing to strafe. The
    // PATROL RING itself stays lit for the entire sortie too (second stamp):
    // the pilot keeps eyes on his target area while swinging wide between
    // passes, so the enemy he's lining up on never blinks back into fog.
    if (Game.fighters) {
        const stamp = (wx, wz, radius) => {
            const r = Math.ceil(radius * Game.FOG_RES);
            const cx = Math.floor(wx * Game.FOG_RES);
            const cz = Math.floor(wz * Game.FOG_RES);
            for (let dz = -r; dz <= r; dz++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (dx * dx + dz * dz > r * r) continue;
                    const gx = cx + dx, gz = cz + dz;
                    if (gx >= 0 && gx < Game.fogCols && gz >= 0 && gz < Game.fogRows) {
                        reveal(gz * Game.fogCols + gx);
                    }
                }
            }
        };
        for (const f of Game.fighters) {
            if (f.state === 'crash') continue;
            stamp(f.x, f.z, Game.FIGHTER.reveal || 36);
            if (f.state === 'onstation') stamp(f.cx, f.cz, (Game.FIGHTER.radius || 15) * 1.5);
        }
    }
    const previousVisible = Game._fogVisibleCells;
    Game._fogVisibleCells = visibleNow;
    Game._fogNextVisibleCells = previousVisible;
    }

    // Render fog overlay to canvas
    if (Game._fogCtx) {
        const ctx = Game._fogCtx;
        const w = 256, h = 256;
        const imgData = Game._fogImageData;
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
                    data[idx + 3] = 78;   // Explored = readable dim (softened:
                                          // 115 made the reveal bubble read as
                                          // a bright band against it)
                } else {
                    data[idx + 3] = 215;  // Hidden = nearly opaque
                }
            }
        }
        ctx.putImageData(imgData, 0, 0);

        // Smooth fog edges with a canvas blur pass
        const tmpCanvas = Game._fogBlurCanvas;
        const tmpCtx = Game._fogBlurCtx;
        tmpCtx.clearRect(0, 0, w, h);
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
    const _t = e.target;
    if (_t && (_t.tagName === 'INPUT' || _t.tagName === 'TEXTAREA' || _t.tagName === 'SELECT' || _t.isContentEditable)) return;
    if (e.key === '`') {
        const panel = document.getElementById('debugPanel');
        if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
});

// Reference mode: strip the view down to bare terrain plus walls/fences for
// clean reference shots. Hides units, effects, fog of war, buildings, trees,
// bridges, props and the top-left menu button; toggling off restores each
// object's exact previous visibility (some are legitimately hidden already,
// e.g. the procedural bridge fallback). Annotation markers, fixed screen
// size at any zoom: bright purple dot = tree, bright blue dot = bush,
// bright red = terrain damage (circles = craters sized by dot, triangles =
// small shell/round impacts).
Game._buildRefMarkers = () => {
    const THREE = Game.THREE;
    if (!THREE || !Game.scene) return null;
    const sprite = (draw) => {
        // white shape, tinted by the material color
        const c = document.createElement('canvas');
        c.width = c.height = 32;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        draw(ctx);
        ctx.fill();
        return new THREE.CanvasTexture(c);
    };
    if (!Game._refDotTex) Game._refDotTex = sprite((ctx) => ctx.arc(16, 16, 15, 0, Math.PI * 2));
    if (!Game._refTriTex) Game._refTriTex = sprite((ctx) => {
        ctx.moveTo(16, 2);
        ctx.lineTo(30, 28);
        ctx.lineTo(2, 28);
        ctx.closePath();
    });
    const layer = (spots, color, name, px, tex) => {
        if (!spots || !spots.length) return null;
        const pos = new Float32Array(spots.length * 3);
        spots.forEach((s, i) => {
            pos[i * 3] = s.x;
            pos[i * 3 + 1] = (Game.getHeight ? Game.getHeight(s.x, s.z) : 0) + 0.3;
            pos[i * 3 + 2] = s.z;
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({
            color,
            map: tex || Game._refDotTex,
            // px on screen at any zoom (gl_PointSize is in device pixels)
            size: (px || 5) * (Game.renderer ? Game.renderer.getPixelRatio() : 1),
            sizeAttenuation: false,
            transparent: true,
            alphaTest: 0.5,
            depthTest: false,
            depthWrite: false,
        });
        const pts = new THREE.Points(geo, mat);
        pts.name = name;
        pts.renderOrder = 1000;
        pts.raycast = () => { };
        Game.scene.add(pts);
        return pts;
    };
    const made = [
        layer(Game.treeSpots, 0xbf00ff, 'ref-tree-markers', 5),
        layer(Game.shrubSpots, 0x00aaff, 'ref-bush-markers', 5),
    ];
    // damage spots vary in size, and PointsMaterial has one size per
    // material, so bucket them by shape + pixel size
    const dmgGroups = {};
    const dmgSrc = Game._refCleanDamage ? (Game.runtimeDamageSpots || []) : (Game.damageSpots || []);
    for (const s of dmgSrc) {
        const k = s.shape + ':' + s.px;
        (dmgGroups[k] = dmgGroups[k] || []).push(s);
    }
    for (const k in dmgGroups) {
        const g = dmgGroups[k];
        made.push(layer(g, 0xff2222, 'ref-damage-' + k, g[0].px,
            g[0].shape === 'triangle' ? Game._refTriTex : Game._refDotTex));
    }
    // Bright pink AREA marker over the town footprint (yard squares plus
    // house/wall tiles): same idea as the dots but for a region — wherever
    // the generator sees pink it renders cobbled village ground. (Was yellow,
    // but generators confused wheat/stubble fields with the marker.) One quad
    // per tile, merged; sits just above the terrain so dividers still occlude
    // it, while the screen-fixed dot markers draw on top.
    {
        const T = Game.TILE;
        const verts = [];
        const yAt = (x, z) => (Game.getHeight ? Game.getHeight(x, z) : 0) + 0.15;
        for (let ty = 0; ty < Game.MAP_ROWS; ty++) {
            for (let tx = 0; tx < Game.MAP_COLS; tx++) {
                const t = Game.terrain[ty] && Game.terrain[ty][tx];
                if (!t || (t.type !== 'yard' && t.type !== 'house' && t.type !== 'wall')) continue;
                const x0 = tx * T, z0 = ty * T, x1 = x0 + T, z1 = z0 + T;
                verts.push(
                    x0, yAt(x0, z0), z0, x0, yAt(x0, z1), z1, x1, yAt(x1, z0), z0,
                    x1, yAt(x1, z0), z0, x0, yAt(x0, z1), z1, x1, yAt(x1, z1), z1,
                );
            }
        }
        if (verts.length) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
            const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
                color: 0xff69b4, fog: false, side: THREE.DoubleSide,
            }));
            mesh.name = 'ref-town-overlay';
            mesh.raycast = () => { };
            Game.scene.add(mesh);
            made.push(mesh);
        }
    }
    const out = made.filter(Boolean);
    return out.length ? out : null;
};

// Reference mode: tip a random minority of wall/fence pieces over and tint
// them red, marking collapsed dividers as terrain damage. Reuses the tank
// knock-down transform (tilt about the piece's base along the run axis).
// The random pick is made once per map so repeated toggles annotate the
// same pieces; pieces a tank already crushed in-game are left alone.
Game._setRefFallenDividers = (on) => {
    const THREE = Game.THREE;
    if (!THREE || !Game.foliageKD) return;
    const clean = !!Game._refCleanDamage;   // neural captures: no invented damage
    if (on && (!Game._refFallen || Game._refFallen.src !== Game.foliageKD
        || Game._refFallen.clean !== clean)) {
        const sel = [];
        if (!clean) {
            for (const r of Game.foliageKD) {
                const nm = (r.leaves && r.leaves.name) || '';
                if (!nm.startsWith('divider-') || nm === 'divider-pierrier') continue;
                if (Math.random() > 0.18) continue;
                sel.push({ r, side: Math.random() < 0.5 ? 1 : -1, ang: Game.rand(1.5, 1.75) });
            }
        }
        // n = registry size at pick time, so the enforcement sweep can tell
        // when async-loaded pieces registered after this pick
        Game._refFallen = { src: Game.foliageKD, sel, n: Game.foliageKD.length, clean };
    }
    if (!Game._refFallen) return;
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), axis = new THREE.Vector3();
    const qY = new THREE.Quaternion(), qT = new THREE.Quaternion();
    const mat = new THREE.Matrix4(), col = new THREE.Color();
    const dirty = new Set();
    for (const f of Game._refFallen.sel) {
        const r = f.r;
        if (r.triggered) continue;   // crushed in-game — already fallen, skip
        pos.set(r.x, r.y, r.z);
        qY.setFromAxisAngle(up, r.rotY);
        scl.set(r.s, r.sy != null ? r.sy : r.s, r.sz != null ? r.sz : r.s);
        if (on) {
            // tip sideways: rotate about the piece's long axis at its base
            axis.set(Math.cos(r.rotY), 0, -Math.sin(r.rotY));
            qT.setFromAxisAngle(axis, f.side * f.ang).multiply(qY);
            mat.compose(pos, qT, scl);
        } else {
            mat.compose(pos, qY, scl);
        }
        r.leaves.setMatrixAt(r.idx, mat);
        if (r.leaves.instanceColor) {
            if (on && f.tint == null) {
                r.leaves.getColorAt(r.idx, col);
                f.tint = col.getHex();
            }
            r.leaves.setColorAt(r.idx, col.setHex(on ? 0xff2222 : f.tint));
        }
        dirty.add(r.leaves);
    }
    dirty.forEach(m => {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
};

// What stays visible in reference mode. Shared by the enable sweep and the
// per-frame enforcement below.
Game._refKeep = (o) => o === Game.terrainMesh
    || o.name === 'water-surface'
    // The railway is part of the ground-truth layout: reference shots of the
    // Mokra map must show the track line, like walls and fences.
    || o.name === 'mokra-railway-model'
    || (o.name && o.name.startsWith('divider-'));

// Models attach through async loader callbacks (dividers, bridge, windmill),
// so a single sweep at enable time misses whatever lands afterwards — e.g.
// right after a capture-mode map regen. Ticked every frame while reference
// mode is on: hides late arrivals and extends the fallen-divider pick when
// new wall/fence pieces register.
Game._refEnforceSweep = () => {
    const saved = Game._refSaved;
    if (!saved) return;
    for (const child of (Game.terrainGroup ? Game.terrainGroup.children : [])) {
        if (!Game._refKeep(child) && !saved.has(child)) {
            saved.set(child, child.visible);
            child.visible = false;
        }
    }
    const kd = Game.foliageKD;
    if (kd && Game._refFallen && Game._refFallen.src === kd && kd.length > Game._refFallen.n) {
        Game._setRefFallenDividers(false);
        Game._refFallen = null;
        Game._setRefFallenDividers(true);
    }
};

Game.setReferenceMode = (on) => {
    on = !!on;
    if (on === !!Game._refMode) return;
    Game._refMode = on;
    // off-map colour: captures must keep the pale margin the model was
    // trained on; play uses the dark UI tone (engine sets it at boot)
    if (Game.renderer) Game.renderer.setClearColor(on ? 0xcabf9f : (Game.OFFMAP_COLOR || 0x14161c));
    if (Game.scene && Game.scene.fog) {
        Game.scene.fog.color.setHex(on ? (Game.REF_FOG_COLOR || 0xd0cab0) : (Game.OFFMAP_COLOR || 0x14161c));
    }
    if (Game.groundPlane && Game._groundPlaneRefMat) {
        if (on) {
            Game._groundPlanePlayMat = Game.groundPlane.material;
            Game.groundPlane.material = Game._groundPlaneRefMat;
        } else if (Game._groundPlanePlayMat) {
            Game.groundPlane.material = Game._groundPlanePlayMat;
        }
    }
    if (on) {
        const saved = Game._refSaved = new Map();
        const hide = (o) => {
            if (o && !saved.has(o)) { saved.set(o, o.visible); o.visible = false; }
        };
        for (const child of (Game.terrainGroup ? Game.terrainGroup.children : [])) {
            if (!Game._refKeep(child)) hide(child);
        }
        hide(Game.unitsGroup);
        hide(Game.effectsGroup);
        hide(Game._fogMesh);
        Game._refMarkers = Game._buildRefMarkers();
        Game._setRefFallenDividers(true);
    } else {
        for (const [obj, vis] of Game._refSaved || []) obj.visible = vis;
        Game._refSaved = null;
        for (const m of Game._refMarkers || []) {
            Game.scene.remove(m);
            m.geometry.dispose();
            m.material.dispose();
        }
        Game._refMarkers = null;
        Game._setRefFallenDividers(false);
    }
    const menuBtn = document.getElementById('btnMenu');
    if (menuBtn) menuBtn.style.display = on ? 'none' : '';
    const hudBar = document.getElementById('hudBar');
    if (hudBar) hudBar.style.display = on ? 'none' : '';
    const refCb = document.getElementById('dbgRefMode');
    if (refCb) refCb.checked = on;
};

document.getElementById('dbgRefMode')?.addEventListener('change', (e) => {
    Game.setReferenceMode(e.target.checked);
});

// ── Reference capture: batches of annotated stills across fresh maps ──
// Start Capture asks once for an output folder (Chrome/Edge File System
// Access API), then loops unattended: frame a random spot at a random zoom,
// render, save a JPEG, and after every "per map" images tear the world down
// and generate a brand-new procedural map. JPEG q0.92 keeps files ~10x
// smaller than PNG with no visible loss on these renders; names carry a
// timestamp + random hash so parallel runs into one folder never collide.
// The game is paused for the duration so nothing drifts between shots.
Game._refCap = null;

Game._refCapShot = () => new Promise((resolve, reject) => {
    // render right before reading — the WebGL buffer is only valid for a
    // synchronous read in the same task (preserveDrawingBuffer is off)
    Game.renderScene();
    Game.renderer.domElement.toBlob(
        (b) => b ? resolve(b) : reject(new Error('canvas capture failed')),
        'image/jpeg', 0.92);
});

// Top-down orthographic capture for the ortho dataset: a 1718x915 reference
// image at the bake's pixel density (NEURAL_BAKE_PPU), centred on (cx, cz).
// Reference mode must already be on. Row 0 = north, exactly like the bake, so
// a model trained on these sees the same distribution the bake feeds it.
Game._refCapShotOrtho = (cx, cz, w, h) => {
    const THREE = Game.THREE;
    const PPU = Game.NEURAL_BAKE_PPU || 21.6;
    const W = w || 1718, H = h || 915;
    const hw = W / PPU / 2, hh = H / PPU / 2;
    const cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 1, 500);
    cam.position.set(cx, 250, cz);
    cam.up.set(0, 0, -1);
    cam.lookAt(cx, 0, cz);
    cam.updateMatrixWorld();
    const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4, colorSpace: THREE.SRGBColorSpace });
    const fog = Game.scene.fog, bg = Game.scene.background;
    Game.scene.fog = null;
    Game.scene.background = null;
    Game.renderer.setRenderTarget(rt);
    Game.renderer.render(Game.scene, cam);
    const px = new Uint8Array(W * H * 4);
    Game.renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
    Game.renderer.setRenderTarget(null);
    Game.scene.fog = fog;
    Game.scene.background = bg;
    rt.dispose();
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
        img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    }
    ctx.putImageData(img, 0, 0);
    return new Promise((resolve, reject) => c.toBlob(
        (b) => b ? resolve(b) : reject(new Error('ortho capture failed')), 'image/jpeg', 0.92));
};

Game._refCapMetaOrtho = (image, cap, cx, cz) => {
    const PPU = Game.NEURAL_BAKE_PPU || 21.6;
    const W = 1718, H = 915;
    const x0 = cx - W / PPU / 2, z0 = cz - H / PPU / 2;
    const toPx = (s) => ({
        wx: +s.x.toFixed(2), wz: +s.z.toFixed(2),
        ix: Math.round((s.x - x0) * PPU), iy: Math.round((s.z - z0) * PPU),
    });
    const inside = (p) => p.ix >= -40 && p.iy >= -40 && p.ix <= W + 40 && p.iy <= H + 40;
    return {
        image, map: cap.mapHash, mapIndex: cap.map, ortho: true, ppu: PPU,
        canvas: { w: W, h: H },
        bounds: { x0: +x0.toFixed(2), z0: +z0.toFixed(2) },
        trees: (Game.treeSpots || []).map(toPx).filter(inside),
        bushes: (Game.shrubSpots || []).map(toPx).filter(inside),
        damage: (Game.damageSpots || []).map(s => ({ ...toPx(s), shape: s.shape, px: s.px })).filter(inside),
    };
};

Game._refCapRegen = async () => {
    // Free the outgoing map's GPU resources first. Three.js only releases
    // buffers on explicit dispose, and a long capture run rebuilds the world
    // hundreds of times — without this the context eventually dies. Disposed
    // shared assets (tree protos etc.) re-upload on next use.
    const seen = new Set();
    const disposeMat = (m) => {
        if (!m || seen.has(m)) return;
        seen.add(m);
        for (const k in m) {
            const v = m[k];
            if (v && v.isTexture && !seen.has(v)) { seen.add(v); v.dispose(); }
        }
        m.dispose();
    };
    Game.terrainGroup.traverse((o) => {
        if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(disposeMat);
    });
    Game._beginMapSeed((Math.random() * 0xffffffff) >>> 0);
    await Game.loadHeightmap();
    Game.generateMap();
    Game.buildTerrainMeshes();
    Game._endMapSeed();
    // Walls/fences attach via async loader callbacks, and they are the one
    // thing that must be in every reference shot — wait until at least one
    // divider batch registered and the registry has stopped growing (capped,
    // in case a map genuinely has none).
    let last = -1;
    for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 300));
        const kd = Game.foliageKD || [];
        const hasDividers = kd.some((r) => r.leaves && r.leaves.name && r.leaves.name.startsWith('divider-'));
        if (hasDividers && kd.length === last) return;
        last = kd.length;
    }
};

// Sidecar metadata for one capture: exact camera, canvas size, and every
// annotated spot in both world and image coordinates (spots near the view
// only). The training pipeline can then crop, split by map, and re-render
// markers or per-pixel label maps at any resolution, instead of recovering
// 5px dots from a compressed JPEG. Image coords are in JPEG pixels (the
// canvas drawing buffer, i.e. CSS pixels x dpr).
Game._refCapMeta = (image, cap) => {
    const THREE = Game.THREE;
    const cw = Game.renderer.domElement.width, ch = Game.renderer.domElement.height;
    const v = new THREE.Vector3();
    const proj = (x, z) => {
        v.set(x, (Game.getHeight ? Game.getHeight(x, z) : 0) + 0.3, z).project(Game.camera);
        if (v.z < -1 || v.z > 1) return null;
        const sx = (v.x + 1) / 2 * cw, sy = (1 - v.y) / 2 * ch;
        if (sx < -40 || sy < -40 || sx > cw + 40 || sy > ch + 40) return null;
        return [Math.round(sx), Math.round(sy)];
    };
    const pack = (spots, extra) => {
        const out = [];
        for (const s of spots || []) {
            const p = proj(s.x, s.z);
            if (!p) continue;
            const rec = { wx: +s.x.toFixed(2), wz: +s.z.toFixed(2), ix: p[0], iy: p[1] };
            if (extra) Object.assign(rec, extra(s));
            out.push(rec);
        }
        return out;
    };
    return {
        image,
        map: cap.mapHash,
        mapIndex: cap.map,
        canvas: { w: cw, h: ch, dpr: Game.renderer.getPixelRatio() },
        camera: {
            x: +Game.cam.x.toFixed(2), z: +Game.cam.z.toFixed(2),
            zoom: +Game.cam.zoom.toFixed(2), yawDeg: Game.camYawDeg || 0,
        },
        trees: pack(Game.treeSpots),
        bushes: pack(Game.shrubSpots),
        damage: pack(Game.damageSpots, (s) => ({ shape: s.shape, px: s.px })),
        fallen: pack((Game._refFallen ? Game._refFallen.sel : []).map((f) => f.r),
            (s) => ({ rotY: +s.rotY.toFixed(3) })),
    };
};

// Capture-only track scatter: a few straight railway runs at random angles
// and lengths, so the dataset sees tracks in every orientation (the Mokra map
// itself has one north-south line; procedural maps have none). The group is
// scene-level, so the reference sweep (terrainGroup only) leaves it visible,
// and it is torn down when the capture ends.
Game._refScatterTracks = async () => {
    Game._refClearTracks();
    if (!Game.buildTrackRun || !Game.THREE || !Game.scene) return;
    const group = new Game.THREE.Group();
    group.name = 'ref-random-tracks';
    Game.scene.add(group);
    Game._refTrackGroup = group;
    // Always include one long east-west line (the Mokra map's own railway is
    // north-south, so the dataset was blind to horizontal tracks), then a few
    // fully random runs on top.
    await Game.buildTrackRun(group,
        5, Game.rand(Game.WORLD_H * 0.2, Game.WORLD_H * 0.8),
        Math.PI / 2 + Game.rand(-0.17, 0.17), Game.WORLD_W - 10);
    const runs = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < runs; i++) {
        await Game.buildTrackRun(group,
            Game.rand(5, Game.WORLD_W - 5), Game.rand(5, Game.WORLD_H - 5),
            Math.random() * Math.PI * 2, Game.rand(25, 90));
    }
};

Game._refClearTracks = () => {
    const group = Game._refTrackGroup;
    if (!group) return;
    Game.scene.remove(group);
    // InstancedMesh.dispose frees the per-instance buffers only; geometry and
    // material belong to the cached rail model and stay shared.
    group.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
    Game._refTrackGroup = null;
};

Game.startRefCapture = async (perMap, total) => {
    if (Game._refCap) return;
    const status = document.getElementById('dbgCapStatus');
    const btn = document.getElementById('dbgCapBtn');
    const say = (t) => { if (status) status.textContent = t; };
    if (!window.showDirectoryPicker) {
        say('needs Chrome/Edge (folder access API)');
        return;
    }
    let dir;
    try {
        dir = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (e) {
        say('no folder picked');
        return;
    }
    perMap = Math.max(1, perMap | 0);
    total = Math.max(1, total | 0);
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    const hex = () => {
        const a = new Uint8Array(4);
        crypto.getRandomValues(a);
        return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
    };
    // mapHash groups every image taken on one generated map. Training splits
    // must go by map, not by image — different shots of the same map are
    // near-duplicates and leak across train/val otherwise.
    const ortho = !!document.getElementById('dbgCapOrtho')?.checked;
    const cap = Game._refCap = { stop: false, saved: 0, map: 1, mapHash: hex() };
    if (btn) btn.textContent = 'Stop Capture';
    const wasPaused = Game._paused;
    Game._paused = true;
    Game.setReferenceMode(true);
    await Game._refScatterTracks();
    try {
        while (cap.saved < total && !cap.stop) {
            if (cap.saved > 0 && cap.saved % perMap === 0) {
                say(`map ${cap.map + 1}: generating...`);
                Game.setReferenceMode(false);   // restore before teardown so the sweep state stays clean
                await Game._refCapRegen();
                Game.setReferenceMode(true);
                await Game._refScatterTracks();
                cap.map++;
                cap.mapHash = hex();
            }
            const name = `ref_m${cap.mapHash}_${Date.now()}_${hex()}.jpg`;
            let blob, meta;
            if (ortho) {
                // top-down shot fully inside the map (no off-map white edges)
                const PPU = Game.NEURAL_BAKE_PPU || 21.6;
                const hw = 1718 / PPU / 2, hh = 915 / PPU / 2;
                const ocx = Game.rand(hw, Game.WORLD_W - hw);
                const ocz = Game.rand(hh, Game.WORLD_H - hh);
                await raf();   // let the reference sweep settle
                blob = await Game._refCapShotOrtho(ocx, ocz);
                meta = Game._refCapMetaOrtho(name, cap, ocx, ocz);
            } else {
                Game.cam.x = Game.rand(0, Game.WORLD_W);
                Game.cam.z = Game.rand(0, Game.WORLD_H);
                // Fixed camera height for the whole dataset: one consistent ground
                // scale (the generation prompt assumes a fixed altitude, and marker
                // sizes are screen-fixed). Default = the game's starting zoom, so
                // training pairs match what players actually see. Override with
                // Game.REF_CAP_ZOOM in the console before starting a run.
                Game.cam.zoom = Game.cam.targetZoom = Game.REF_CAP_ZOOM || 20;
                await raf(); await raf();   // let updateCamera clamp + place the rig
                blob = await Game._refCapShot();
                meta = Game._refCapMeta(name, cap);
            }
            const fh = await dir.getFileHandle(name, { create: true });
            const w = await fh.createWritable();
            await w.write(blob);
            await w.close();
            const mh = await dir.getFileHandle(name.replace(/\.jpg$/, '.json'), { create: true });
            const mw = await mh.createWritable();
            await mw.write(new Blob([JSON.stringify(meta)], { type: 'application/json' }));
            await mw.close();
            cap.saved++;
            say(`${cap.saved}/${total} · map ${cap.map}`);
        }
        say(cap.stop ? `stopped at ${cap.saved}/${total}` : `done: ${cap.saved} images`);
    } catch (e) {
        console.error('reference capture failed:', e);
        say('error: ' + e.message);
    }
    Game._refClearTracks();
    Game._refCap = null;
    Game._paused = wasPaused;
    if (btn) btn.textContent = 'Start Capture';
};

Game.stopRefCapture = () => {
    if (Game._refCap) Game._refCap.stop = true;
};

document.getElementById('dbgCapBtn')?.addEventListener('click', () => {
    if (Game._refCap) { Game.stopRefCapture(); return; }
    const perMap = parseInt(document.getElementById('dbgCapPerMap')?.value || '20', 10);
    const total = parseInt(document.getElementById('dbgCapTotal')?.value || '100', 10);
    Game.startRefCapture(perMap, total);
});

// ── Dataset stage 2: reference -> realistic, via the local sidecar ──
// The button talks to scripts/ref-pipeline.mjs on localhost:8742, which holds
// the OpenAI key (from .env) and does the actual image generation. The key
// stays out of the browser on purpose: anything the page can read, devtools
// and extensions can read too. Start the sidecar with:
//   node scripts/ref-pipeline.mjs
{
    const btn = document.getElementById('dbgGenBtn');
    const status = document.getElementById('dbgGenStatus');
    const base = 'http://127.0.0.1:8742';
    const say = (t) => { if (status) status.textContent = t; };
    const offline = () => say('sidecar not running: node scripts/ref-pipeline.mjs');
    let timer = null;
    const poll = async () => {
        try {
            const s = await (await fetch(base + '/status')).json();
            say((s.running ? `generating ${s.done + s.failed + 1}/${s.total}` : `idle, ${s.pending} pending`)
                + (s.failed ? `, ${s.failed} failed` : '')
                + (s.dry ? ' (dry)' : ''));
            if (!s.running && timer) { clearInterval(timer); timer = null; }
        } catch (e) {
            offline();
            if (timer) { clearInterval(timer); timer = null; }
        }
    };
    btn?.addEventListener('click', async () => {
        try {
            await fetch(base + '/generate', { method: 'POST' });
            if (!timer) timer = setInterval(poll, 2000);
            poll();
        } catch (e) { offline(); }
    });
}

// ── Deterministic map seeds + named map saves ──
// Map generation is driven by Math.random; seeding it for the generation
// window means one integer replays the IDENTICAL map — heightmap, tiles,
// village, ponds, every tree. Saves live in IndexedDB (the baked texture is
// far too big for localStorage).
Game._mulberry32 = (seed) => {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};
Game._beginMapSeed = (seed) => {
    Game.mapSeed = seed >>> 0;
    Game._origRandom = Math.random;
    Math.random = Game._mulberry32(Game.mapSeed);
};
Game._endMapSeed = () => {
    if (Game._origRandom) {
        Math.random = Game._origRandom;
        Game._origRandom = null;
    }
};

Game._mapDB = () => new Promise((res, rej) => {
    const rq = indexedDB.open('uf-maps', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('maps', { keyPath: 'name' });
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
});
Game._mapStorePut = async (rec) => {
    const db = await Game._mapDB();
    return new Promise((res, rej) => {
        const tx = db.transaction('maps', 'readwrite');
        tx.objectStore('maps').put(rec);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
    });
};
Game._mapStoreGet = async (name) => {
    const db = await Game._mapDB();
    return new Promise((res, rej) => {
        const rq = db.transaction('maps').objectStore('maps').get(name);
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error);
    });
};
Game._mapStoreList = async () => {
    const db = await Game._mapDB();
    return new Promise((res, rej) => {
        const rq = db.transaction('maps').objectStore('maps').getAllKeys();
        rq.onsuccess = () => res(rq.result || []);
        rq.onerror = () => rej(rq.error);
    });
};
Game._mapStoreDelete = async (name) => {
    const db = await Game._mapDB();
    return new Promise((res, rej) => {
        const tx = db.transaction('maps', 'readwrite');
        tx.objectStore('maps').delete(name);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
    });
};

// ── Neural live mode: terrain via the trained ControlNet, models stay 3D ──
// Toggled from the debug panel. Each cycle renders ONE invisible reference-
// style frame (the conditioning the model was trained on), ships it to the
// 5090, and puts the generated terrain up as the scene background. The
// terrain mesh becomes an invisible depth+shadow catcher, so hills still
// occlude units and shadows still land, while units/trees/buildings render
// as normal 3D on top. Things the model paints INTO the terrain (water,
// walls/fences, bushes, ground decor) are hidden to avoid doubling.
// Start the server on the training box with:
//   cd ~/uf-train && .venv/bin/python infer_server.py
// Inference server: players run their own locally (scripts/infer_server.py).
// A personal override can be set once per browser via:
//   localStorage.setItem('uf_neural_url', 'http://your-server:8788')
Game.NEURAL_URL = localStorage.getItem('uf_neural_url') || 'http://127.0.0.1:8788';
Game.NEURAL_STEPS = 20;   // denoising steps for the live loop (speed vs quality)
Game.NEURAL_GUIDANCE = 5;  // guidance scale; lower (3-4) tames overtrained checkpoints
Game.NEURAL_SEED = 7;      // change for a different "take" on the same terrain
Game.NEURAL_CNSCALE = 1;   // how hard the reference layout steers (try 1.2-1.5 on pretty checkpoints)
Game.NEURAL_REFINE = 0.3;  // bake second-pass img2img strength (0 = off)
Game.NEURAL_UPSCALE = 2;   // bake Real-ESRGAN upscale factor (1 = off)
Game.NEURAL_DETAIL = 0.2;  // hi-res detail pass strength after upscale (0 = off)
Game.NEURAL_WATER = 0.30;  // water overlay opacity in bake mode (ripples + colour assist)
Game.NEURAL_STYLE = '';    // optional prompt suffix, e.g. 'lush summer, golden hour'
Game.NEURAL_PROMPT = '';   // FULL prompt override (empty = built-in trained caption)
Game.NEURAL_NEG = '';      // FULL negative override (empty = built-in default)
{
    const btn = document.getElementById('dbgNeuralBtn');
    const status = document.getElementById('dbgNeuralStatus');
    const say = (t) => { if (status) status.textContent = t; };
    const HIDE_NAMES = new Set(['water-surface', 'river-wash-stones', 'forest-undergrowth-blades']);
    const HIDE_RE = /^(divider-)/;   // bushes stay real 3D, like trees
    const N = Game._neural = { on: false, frame: 0, saved: null, ghost: null, mat: null, tex: null };

    const applyDisplay = () => {
        if (N.saved) return;
        N.saved = [];
        for (const o of Game.terrainGroup.children) {
            if (o.visible && (HIDE_NAMES.has(o.name) || HIDE_RE.test(o.name))) {
                o.visible = false;
                N.saved.push(o);
            }
        }
        if (Game.terrainMesh) {
            N.mat = Game.terrainMesh.material;
            if (!N.ghost) {
                N.ghost = new Game.THREE.ShadowMaterial({ opacity: 0.35 });
                N.ghost.depthWrite = true;
            }
            Game.terrainMesh.material = N.ghost;
        }
        if (N.tex) Game.scene.background = N.tex;
    };
    const restoreDisplay = () => {
        for (const o of N.saved || []) o.visible = true;
        N.saved = null;
        if (Game.terrainMesh && N.mat) { Game.terrainMesh.material = N.mat; N.mat = null; }
        Game.scene.background = null;
    };
    const captureConditioning = () => {
        // flip to reference visuals, render, snapshot, flip back and repaint —
        // all in one task, so the compositor never presents the reference frame
        restoreDisplay();
        Game._refCleanDamage = true;   // only real battle damage in conditioning
        Game.setReferenceMode(true);
        Game.renderScene();
        const p = new Promise((resolve, reject) => Game.renderer.domElement.toBlob(
            (b) => b ? resolve(b) : reject(new Error('capture failed')), 'image/jpeg', 0.92));
        Game.setReferenceMode(false);
        Game._refCleanDamage = false;
        applyDisplay();
        Game.renderScene();
        return p;
    };

    const loop = async () => {
        while (N.on) {
            try {
                N.frame++;
                // the model only knows the training ground scale
                Game.cam.zoom = Game.cam.targetZoom = Game.REF_CAP_ZOOM || 20;
                const t0 = performance.now();
                const blob = await captureConditioning();
                const res = await fetch(`${Game.NEURAL_URL}/render?mode=full&steps=${Game.NEURAL_STEPS}&guidance=${Game.NEURAL_GUIDANCE}&seed=${Game.NEURAL_SEED}&cnscale=${Game.NEURAL_CNSCALE}&prompt=${encodeURIComponent(Game.NEURAL_PROMPT || '')}&neg=${encodeURIComponent(Game.NEURAL_NEG || '')}`, {
                    method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob,
                });
                if (!res.ok) { say('server error ' + res.status); break; }
                const infer = +res.headers.get('X-Infer-Ms') || 0;
                const out = await res.blob();
                const img = new Image();
                const url = URL.createObjectURL(out);
                img.src = url;
                await img.decode();
                URL.revokeObjectURL(url);
                if (!N.on) break;
                const tex = new Game.THREE.Texture(img);
                tex.colorSpace = Game.THREE.SRGBColorSpace;
                tex.needsUpdate = true;
                const old = N.tex;
                N.tex = tex;
                Game.scene.background = tex;
                if (old) old.dispose();
                const total = Math.round(performance.now() - t0);
                say(`live · frame ${N.frame} · gpu ${infer}ms · ${total}ms/frame (${(1000 / total).toFixed(2)} fps)`);
            } catch (e) {
                say('failed: ' + e.message + ' (is infer_server.py running on vde?)');
                break;
            }
        }
        restoreDisplay();
        if (N.tex) { N.tex.dispose(); N.tex = null; }
        N.on = false;
        if (btn) btn.textContent = 'Neural Render';
    };

    btn?.addEventListener('click', () => {
        if (N.on) { N.on = false; say('stopping after this frame...'); return; }
        N.on = true;
        N.frame = 0;
        btn.textContent = 'Stop Neural';
        say('starting...');
        loop();
    });
}

// ── Neural map bake: the whole map through the model ONCE, applied as the
// terrain texture. Zero runtime lag, camera fully free, units/trees/buildings
// composite naturally because it IS the terrain material. The map is rendered
// top-down orthographic in reference style at the training pixel density,
// generated tile-by-tile on the 5090 (~1-2 min), stitched server-side, and
// swapped into terrainMesh.material.map. Second click restores the original.
Game.NEURAL_BAKE_PPU = 21.6;   // px per world unit ~= training pixel density
{
    const btn = document.getElementById('dbgBakeBtn');
    const status = document.getElementById('dbgBakeStatus');
    const say = (t) => { if (status) status.textContent = t; };
    const HIDE_NAMES = new Set(['river-wash-stones', 'forest-undergrowth-blades']);
    const HIDE_RE = /^(divider-)/;   // bushes stay real 3D, like trees
    // Water in bake mode: the model paints the water COLOUR into the texture,
    // but paint is dead still. Keep the water plane with a ripple-only
    // material: near-transparent, so the painted water shows through, with
    // the animated normal map for subtle moving glints. The baked colour+
    // alpha map is reused purely as the shoreline mask, and updateWaterFX
    // keeps scrolling the shared normal texture.
    const neuralWaterMat = (src) => {
        const m = new Game.THREE.MeshStandardMaterial({
            map: src.map,
            normalMap: src.normalMap,
            normalScale: new Game.THREE.Vector2(0.14, 0.1),
            transparent: true,
            depthWrite: false,
            opacity: Game.NEURAL_WATER ?? 0.30,
            roughness: 0.12,
            metalness: 0.05,
            emissive: 0xfff6d6,
            emissiveIntensity: (Game.WATER_SPARKLE && Game.WATER_SPARKLE.intensity) || 1.55,
        });
        if (Game._waterSparkleTex) {
            m.emissiveMap = Game._waterSparkleTex();
            const spScale = (Game.WATER_SPARKLE && Game.WATER_SPARKLE.scale) || 6;
            // the bake bounds match the water fx plane; reuse its world dims
            if (Game._waterFX && Game._waterFX.w) {
                m.emissiveMap.repeat.set(Game._waterFX.w / spScale, Game._waterFX.hSpan / spScale);
            } else {
                m.emissiveMap.repeat.set(300 / spScale, 300 / spScale);
            }
        }
        return m;
    };
    const B = Game._neuralBake = { applied: false, busy: false, oldMap: null, hidden: null, tex: null };

    // staged loading overlay ("...generating proceduals...")
    const showLoading = () => {
        let ov = document.getElementById('neuralBakeLoading');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'neuralBakeLoading';
            ov.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,12,.9);z-index:5000;'
                + 'display:flex;align-items:center;justify-content:center;flex-direction:column;gap:18px;';
            ov.innerHTML = '<div style="width:44px;height:44px;border:3px solid #2c343c;'
                + 'border-top-color:#d8ba7b;border-radius:50%;animation:nbspin 1s linear infinite"></div>'
                + '<div id="neuralBakeMsg" style="color:#cfd8df;font:13px monospace;letter-spacing:1px"></div>'
                + '<style>@keyframes nbspin{to{transform:rotate(360deg)}}</style>';
            document.body.appendChild(ov);
        }
        ov.style.display = 'flex';
        const msg = document.getElementById('neuralBakeMsg');
        const t0 = performance.now();
        const stages = ['Generating procedurals...', 'Loading models...'];
        let i = 0;
        msg.textContent = stages[0];
        const timer = setInterval(() => {
            i++;
            msg.textContent = i < stages.length ? stages[i]
                : `Rendering neural terrain... ${Math.round((performance.now() - t0) / 1000)}s`;
        }, 900);
        return () => { clearInterval(timer); ov.style.display = 'none'; };
    };

    // top-down orthographic reference render of the whole map, row 0 = north
    const captureMapImage = async () => {
        const THREE = Game.THREE;
        const W = Game.WORLD_W, H = Game.WORLD_H;
        const maxTex = Game.renderer.capabilities.maxTextureSize || 8192;
        const SW = Math.min(Math.round(W * Game.NEURAL_BAKE_PPU), maxTex, 8192);
        const SH = Math.min(Math.round(H * Game.NEURAL_BAKE_PPU), maxTex, 8192);
        const cam = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 1, 500);
        cam.position.set(W / 2, 250, H / 2);
        cam.up.set(0, 0, -1);
        cam.lookAt(W / 2, 0, H / 2);
        cam.updateMatrixWorld();
        const rt = new THREE.WebGLRenderTarget(SW, SH, { samples: 4, colorSpace: THREE.SRGBColorSpace });
        const fog = Game.scene.fog;
        const bg = Game.scene.background;
        Game.scene.fog = null;
        Game.scene.background = null;
        Game._refCleanDamage = true;   // pristine ground: damage only from battle
        Game.setReferenceMode(true);
        Game.renderer.setRenderTarget(rt);
        Game.renderer.render(Game.scene, cam);
        const px = new Uint8Array(SW * SH * 4);
        Game.renderer.readRenderTargetPixels(rt, 0, 0, SW, SH, px);
        Game.renderer.setRenderTarget(null);
        Game.setReferenceMode(false);
        Game._refCleanDamage = false;
        Game.scene.fog = fog;
        Game.scene.background = bg;
        rt.dispose();
        Game.renderScene();
        // GL rows are bottom-up; texture row 0 must be the north edge
        const c = document.createElement('canvas');
        c.width = SW; c.height = SH;
        const ctx = c.getContext('2d');
        const img = ctx.createImageData(SW, SH);
        for (let y = 0; y < SH; y++) {
            img.data.set(px.subarray((SH - 1 - y) * SW * 4, (SH - y) * SW * 4), y * SW * 4);
        }
        ctx.putImageData(img, 0, 0);
        return new Promise((resolve, reject) => c.toBlob(
            (b) => b ? resolve(b) : reject(new Error('map capture failed')), 'image/jpeg', 0.92));
    };

    const restore = () => {
        if (!B.applied) return;
        if (Game.terrainMesh && B.oldMap) {
            Game.terrainMesh.material.map = B.oldMap;
            Game.terrainMesh.material.needsUpdate = true;
        }
        if (B.waterSwap) {
            B.waterSwap.mesh.material.dispose();   // textures are shared, not disposed
            B.waterSwap.mesh.material = B.waterSwap.mat;
            B.waterSwap = null;
        }
        for (const o of B.hidden || []) o.visible = true;
        if (B.tex) B.tex.dispose();
        B.oldMap = null; B.hidden = null; B.tex = null; B.applied = false;
        if (btn) btn.textContent = 'Bake Neural Map';
        say('restored');
    };

    // apply a full-map texture image (fresh bake or a saved one) to the world
    const applyBakeImage = (img) => {
        const THREE = Game.THREE;
        // canvas-backed so battle-damage patches can be composited later
        B.canvas = document.createElement('canvas');
        B.canvas.width = img.width;
        B.canvas.height = img.height;
        B.ctx = B.canvas.getContext('2d');
        B.ctx.drawImage(img, 0, 0);
        const tex = new THREE.CanvasTexture(B.canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Game.renderer.capabilities.getMaxAnisotropy();
        B.oldMap = Game.terrainMesh.material.map;
        Game.terrainMesh.material.map = tex;
        Game.terrainMesh.material.needsUpdate = true;
        B.tex = tex;
        // hide the things the model painted INTO the texture; water
        // stays visible but swaps to the subtle ripple-only material
        B.hidden = [];
        B.waterSwap = null;
        for (const o of Game.terrainGroup.children) {
            if (o.name === 'water-surface' && o.visible) {
                B.waterSwap = { mesh: o, mat: o.material };
                o.material = neuralWaterMat(o.material);
                continue;
            }
            if (o.visible && (HIDE_NAMES.has(o.name) || HIDE_RE.test(o.name))) {
                o.visible = false;
                B.hidden.push(o);
            }
        }
        B.applied = true;
        if (btn) btn.textContent = 'Restore Terrain';
    };

    Game.neuralBakeMap = async () => {
        if (B.busy) return;
        if (Game._neural && Game._neural.on) { say('stop live neural mode first'); return; }
        if (B.applied) { restore(); return; }
        B.busy = true;
        const hideLoading = showLoading();
        try {
            const t0 = performance.now();
            const blob = await captureMapImage();
            say('generating on the 5090...');
            const res = await fetch(`${Game.NEURAL_URL}/render?mode=bake&steps=${Game.NEURAL_STEPS}&guidance=${Game.NEURAL_GUIDANCE}&seed=${Game.NEURAL_SEED}&cnscale=${Game.NEURAL_CNSCALE}&refine=${Game.NEURAL_REFINE}&upscale=${Game.NEURAL_UPSCALE}&detail=${Game.NEURAL_DETAIL}&style=${encodeURIComponent(Game.NEURAL_STYLE || '')}&prompt=${encodeURIComponent(Game.NEURAL_PROMPT || '')}&neg=${encodeURIComponent(Game.NEURAL_NEG || '')}`, {
                method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob,
            });
            if (!res.ok) throw new Error('server error ' + res.status);
            const out = await res.blob();
            const img = new Image();
            const url = URL.createObjectURL(out);
            img.src = url;
            await img.decode();
            URL.revokeObjectURL(url);
            applyBakeImage(img);
            say(`baked in ${Math.round((performance.now() - t0) / 1000)}s`);
        } catch (e) {
            say('failed: ' + e.message + ' (is infer_server.py running on vde?)');
        } finally {
            hideLoading();
            B.busy = false;
        }
    };

    btn?.addEventListener('click', () => { Game.neuralBakeMap(); });

    // ── Bake View: quick preview — only the camera's area, same pipeline ──
    // Captures a canonical-frame region (1718x915 at bake density) around the
    // camera, runs it through generate/refine/upscale/detail with the current
    // panel settings, and feathers the result into the terrain texture. With
    // no full bake active it patches a COPY of the original texture and keeps
    // every 3D object visible: a pure in-context texture preview.
    const captureRegion = async (cx, cz, W, H) => {
        // conditioning always wants the ORIGINAL procedural look
        let neuralMap = null;
        if (B.applied && Game.terrainMesh && B.oldMap) {
            neuralMap = Game.terrainMesh.material.map;
            Game.terrainMesh.material.map = B.oldMap;
            Game.terrainMesh.material.needsUpdate = true;
            for (const o of B.hidden || []) o.visible = true;
            if (B.waterSwap) B.waterSwap.mesh.material = B.waterSwap.mat;
        }
        Game._refCleanDamage = true;
        Game.setReferenceMode(true);
        const blobP = Game._refCapShotOrtho(cx, cz, W, H);
        Game.setReferenceMode(false);
        Game._refCleanDamage = false;
        if (neuralMap) {
            Game.terrainMesh.material.map = neuralMap;
            Game.terrainMesh.material.needsUpdate = true;
            for (const o of B.hidden || []) o.visible = false;
            if (B.waterSwap) B.waterSwap.mesh.material = neuralWaterMat(B.waterSwap.mat);
        }
        Game.renderScene();
        return blobP;
    };

    Game.neuralBakeView = async () => {
        if (B.busy) { say('busy with another bake'); return; }
        B.busy = true;
        const t0 = performance.now();
        const tick = setInterval(() => say(`baking view... ${Math.round((performance.now() - t0) / 1000)}s`), 1000);
        try {
            const THREE = Game.THREE;
            const PPU = Game.NEURAL_BAKE_PPU || 21.6;
            const W = 1718, H = 915;
            const hw = W / PPU / 2, hh = H / PPU / 2;
            const cx = Game.clamp(Game.cam.x, hw, Game.WORLD_W - hw);
            const cz = Game.clamp(Game.cam.z, hh, Game.WORLD_H - hh);
            const blob = await captureRegion(cx, cz, W, H);
            const res = await fetch(`${Game.NEURAL_URL}/render?mode=full&steps=${Game.NEURAL_STEPS}`
                + `&guidance=${Game.NEURAL_GUIDANCE}&seed=${Game.NEURAL_SEED}&cnscale=${Game.NEURAL_CNSCALE}`
                + `&refine=${Game.NEURAL_REFINE}&upscale=${Game.NEURAL_UPSCALE}&detail=${Game.NEURAL_DETAIL}`
                + `&style=${encodeURIComponent(Game.NEURAL_STYLE || '')}`
                + `&prompt=${encodeURIComponent(Game.NEURAL_PROMPT || '')}&neg=${encodeURIComponent(Game.NEURAL_NEG || '')}`, {
                method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob,
            });
            if (!res.ok) throw new Error('server error ' + res.status);
            const img = new Image();
            const url = URL.createObjectURL(await res.blob());
            img.src = url;
            await img.decode();
            URL.revokeObjectURL(url);
            if (!B.applied) {
                // patch a copy of the original texture; 3D stays untouched
                const cur = Game.terrainMesh.material.map;
                B.canvas = document.createElement('canvas');
                B.canvas.width = cur.image.width;
                B.canvas.height = cur.image.height;
                B.ctx = B.canvas.getContext('2d');
                B.ctx.drawImage(cur.image, 0, 0);
                const tex = new THREE.CanvasTexture(B.canvas);
                tex.colorSpace = THREE.SRGBColorSpace;
                tex.anisotropy = Game.renderer.capabilities.getMaxAnisotropy();
                B.oldMap = cur;
                Game.terrainMesh.material.map = tex;
                Game.terrainMesh.material.needsUpdate = true;
                B.tex = tex;
                B.hidden = [];
                B.waterSwap = null;
                B.applied = true;
                if (btn) btn.textContent = 'Restore Terrain';
            }
            // rectangular feather so the preview melts into its surroundings
            const pc = document.createElement('canvas');
            pc.width = img.width;
            pc.height = img.height;
            const pctx = pc.getContext('2d');
            pctx.drawImage(img, 0, 0);
            pctx.globalCompositeOperation = 'destination-in';
            const F = Math.max(8, Math.round(img.width * 0.03));
            const feather = (x0, y0, x1, y1) => {
                const g = pctx.createLinearGradient(x0, y0, x1, y1);
                g.addColorStop(0, 'rgba(0,0,0,0)');
                g.addColorStop(1, 'rgba(0,0,0,1)');
                pctx.fillStyle = g;
                pctx.fillRect(0, 0, pc.width, pc.height);
            };
            feather(0, 0, F, 0);
            feather(pc.width, 0, pc.width - F, 0);
            feather(0, 0, 0, F);
            feather(0, pc.height, 0, pc.height - F);
            const scale = B.canvas.width / Game.WORLD_W;
            B.ctx.drawImage(pc, (cx - hw) * scale, (cz - hh) * scale, hw * 2 * scale, hh * 2 * scale);
            B.tex.needsUpdate = true;
            say(`view baked in ${Math.round((performance.now() - t0) / 1000)}s`);
        } catch (e) {
            say('failed: ' + e.message);
        }
        clearInterval(tick);
        B.busy = false;
    };

    document.getElementById('dbgBakeViewBtn')?.addEventListener('click', () => { Game.neuralBakeView(); });

    // ── Named map saves: seed + baked texture + look settings ──
    const mapList = document.getElementById('dbgMapList');
    const refreshMapList = async () => {
        if (!mapList) return;
        try {
            const names = await Game._mapStoreList();
            mapList.innerHTML = '';
            for (const n of names) {
                const o = document.createElement('option');
                o.value = n;
                o.textContent = n;
                mapList.appendChild(o);
            }
        } catch (e) { /* store unavailable */ }
    };

    Game.saveCurrentMap = async (name) => {
        name = (name || '').trim();
        if (!name) { say('enter a map name first'); return; }
        const rec = {
            name,
            seed: Game.mapSeed >>> 0,
            when: Date.now(),
            water: Game.NEURAL_WATER,
            tints: JSON.parse(JSON.stringify(Game._foliageTint || {})),
            // Pond layout rides in the save so a reload replays these exact
            // ponds instead of re-rolling them from the (code-drift-sensitive)
            // seeded RNG stream — see the pond section in generateMap.
            ponds: JSON.parse(JSON.stringify(Game.ponds || [])),
            editor: Game.editorSerialize ? Game.editorSerialize() : null,
            bake: null,
        };
        if (B.applied && B.canvas) {
            rec.bake = await new Promise((r) => B.canvas.toBlob(r, 'image/jpeg', 0.92));
        }
        await Game._mapStorePut(rec);
        say(`saved "${name}"${rec.bake ? ' (with bake)' : ' (no bake yet)'}`);
        refreshMapList();
    };

    Game._applySavedMap = async (rec) => {
        try {
            if (rec.water != null) Game.NEURAL_WATER = rec.water;
            if (rec.tints) {
                Game._foliageTint = rec.tints;
                for (const k in rec.tints) Game.applyFoliageTint(k);
            }
            if (rec.bake || rec._bakeUrl) {
                const img = new Image();
                const url = rec.bake ? URL.createObjectURL(rec.bake) : Game.assetUrl(rec._bakeUrl);
                if (!rec.bake) img.crossOrigin = 'anonymous';
                img.src = url;
                await img.decode();
                if (rec.bake) URL.revokeObjectURL(url);
                applyBakeImage(img);
            }
            say(`loaded map "${rec.name}"`);
        } catch (e) {
            say('saved map apply failed: ' + e.message);
        }
    };

    document.getElementById('dbgMapSave')?.addEventListener('click', () => {
        Game.saveCurrentMap(document.getElementById('dbgMapName')?.value);
    });
    document.getElementById('dbgMapLoad')?.addEventListener('click', () => {
        if (!mapList || !mapList.value) { say('no saved map selected'); return; }
        localStorage.setItem('uf_loadMap', mapList.value);
        location.reload();
    });
    document.getElementById('dbgMapDel')?.addEventListener('click', async () => {
        if (!mapList || !mapList.value) return;
        await Game._mapStoreDelete(mapList.value);
        say('deleted ' + mapList.value);
        refreshMapList();
    });
    // Export the selected save as bundle files (maps/default/ in the repo):
    // map.json (seed + painted layers, base64) and bake.jpg (the texture)
    document.getElementById('dbgMapExport')?.addEventListener('click', async () => {
        if (!mapList || !mapList.value) { say('select a saved map first'); return; }
        const rec = await Game._mapStoreGet(mapList.value).catch(() => null);
        if (!rec) { say('could not read save'); return; }
        const enc = (u8) => {
            let out = '';
            const CH = 0x8000;
            for (let i = 0; i < u8.length; i += CH) {
                out += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CH, u8.length)));
            }
            return btoa(out);
        };
        const meta = {
            name: rec.name, seed: rec.seed, when: rec.when,
            water: rec.water, tints: rec.tints,
            ponds: rec.ponds || [],
        };
        if (rec.editor) {
            meta.editor = { blank: rec.editor.blank, types: rec.editor.types,
                ovW: rec.editor.ovW, ovH: rec.editor.ovH };
            if (rec.editor.tiles) meta.editor.tilesB64 = enc(rec.editor.tiles instanceof Uint8Array ? rec.editor.tiles : new Uint8Array(rec.editor.tiles));
            if (rec.editor.ov) meta.editor.ovB64 = enc(rec.editor.ov instanceof Uint8Array ? rec.editor.ov : new Uint8Array(rec.editor.ov));
        }
        if (rec.fluff || (rec.editor && rec.editor.fluff)) {
            const fl = rec.fluff || rec.editor.fluff;
            meta.fluff = { cfg: fl.cfg, masksB64: {} };
            for (const sp in fl.masks || {}) {
                const m = fl.masks[sp];
                meta.fluff.masksB64[sp] = enc(m instanceof Uint8Array ? m : new Uint8Array(m));
            }
        }
        const dl = (blob, fname) => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = fname;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        };
        dl(new Blob([JSON.stringify(meta)], { type: 'application/json' }), 'map.json');
        if (rec.bake) dl(rec.bake, 'bake.jpg');
        say('exported map.json' + (rec.bake ? ' + bake.jpg' : ' (no bake in this save)'));
    });
    // fresh procedural map on demand (the bundled map is the default now)
    document.getElementById('dbgNewProc')?.addEventListener('click', () => {
        localStorage.setItem('uf_forceProcedural', '1');
        location.reload();
    });
    refreshMapList();
}

// ── Neural debug controls: settings, prompt suffix, model hot-swap ──
// The inputs mirror the Game.NEURAL_* knobs (bake/live read those at click
// time); the model dropdown lists the server's checkpoints and swaps them
// in place without a restart.
{
    const $ = (id) => document.getElementById(id);
    const bind = (id, key, parse) => {
        const el = $(id);
        if (!el) return;
        el.value = Game[key];
        el.addEventListener('change', () => {
            const v = parse ? parse(el.value) : parseFloat(el.value);
            if (!Number.isNaN(v)) Game[key] = v;
        });
    };
    bind('dbgNeuSteps', 'NEURAL_STEPS', (v) => parseInt(v, 10));
    bind('dbgNeuGuidance', 'NEURAL_GUIDANCE');
    bind('dbgNeuCn', 'NEURAL_CNSCALE');
    bind('dbgNeuSeed', 'NEURAL_SEED', (v) => parseInt(v, 10));
    bind('dbgNeuRefine', 'NEURAL_REFINE');
    bind('dbgNeuDetail', 'NEURAL_DETAIL');
    const up = $('dbgNeuUpscale');
    if (up) {
        up.checked = (Game.NEURAL_UPSCALE | 0) === 2;
        up.addEventListener('change', () => { Game.NEURAL_UPSCALE = up.checked ? 2 : 1; });
    }
    const promptEl = $('dbgNeuPrompt');
    if (promptEl) {
        promptEl.value = Game.NEURAL_PROMPT || '';
        promptEl.addEventListener('change', () => { Game.NEURAL_PROMPT = promptEl.value.trim(); });
    }
    const negEl = $('dbgNeuNeg');
    if (negEl) {
        negEl.value = Game.NEURAL_NEG || '';
        negEl.addEventListener('change', () => { Game.NEURAL_NEG = negEl.value.trim(); });
    }

    const urlEl = $('dbgNeuUrl');
    if (urlEl) {
        urlEl.value = Game.NEURAL_URL;
        urlEl.addEventListener('change', () => {
            const v = urlEl.value.trim().replace(/\/$/, '');
            if (!v) return;
            Game.NEURAL_URL = v;
            localStorage.setItem('uf_neural_url', v);
            setTimeout(refresh, 100);
        });
    }
    const sel = $('dbgNeuModel');
    const st = $('dbgNeuModelStatus');
    const say = (t) => { if (st) st.textContent = t; };
    const short = (c) => c.replace('runs/', '');
    const refresh = async () => {
        try {
            const r = await (await fetch(Game.NEURAL_URL + '/checkpoints')).json();
            if (!sel) return;
            sel.innerHTML = '';
            for (const c of r.checkpoints) {
                const o = document.createElement('option');
                o.value = c;
                o.textContent = short(c);
                if (c === r.current) o.selected = true;
                sel.appendChild(o);
            }
            say('serving: ' + short(r.current));
        } catch (e) {
            say('inference server offline');
        }
    };
    $('dbgNeuModelLoad')?.addEventListener('click', async () => {
        if (!sel || !sel.value) return;
        say('loading ' + short(sel.value) + '...');
        try {
            const r = await fetch(Game.NEURAL_URL + '/checkpoint?path=' + encodeURIComponent(sel.value),
                { method: 'POST' });
            const j = await r.json();
            say(j.ok ? 'serving: ' + short(j.current) : 'failed: ' + (j.error || r.status));
        } catch (e) {
            say('failed: ' + e.message);
        }
    });
    setTimeout(refresh, 1500);

    // fog of war off: reveal everything, in full light, until re-enabled
    const fogCb = $('dbgFogOff');
    fogCb?.addEventListener('change', () => {
        Game._fogDisabled = fogCb.checked;
        Game._fogTimer = 0;
        // the update loop skips while paused (map maker pauses) — apply now
        if (Game.updateFogOfWar) Game.updateFogOfWar(0.02);
    });
}

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

// ── Foliage colour controls: per-species leaf tint (HSL over originals) ──
// Leaves are InstancedMeshes with per-instance colours; adjustments rebuild
// each instance colour from a saved copy of the originals, so sliders are
// non-destructive and revert cleanly at 0/1/1. Resets on map regeneration.
// Hand-tuned defaults (debug panel → Foliage Color, 2026-07): richer late-
// summer canopy. h shifts hue, s/l multiply the authored per-instance colours.
Game._foliageTint = {
    oak: { h: 0.27, s: 0.55, l: 0.65 },
    pine: { h: 0.50, s: 0.95, l: 1.80 },
    birch: { h: 0.35, s: 0.75, l: 1.05 },
    shrub: { h: 0.40, s: 0.95, l: 1.20 },
};
Game._foliagePrefix = {
    oak: 'tree-leaves',
    pine: 'tree-pine-leaves',
    birch: 'tree-birch-leaves',
    shrub: 'hedge-shrub-leaves',
};
Game.applyFoliageTint = (sp) => {
    const t = Game._foliageTint[sp];
    const pref = Game._foliagePrefix[sp];
    if (!t || !pref || !Game.terrainGroup) return;
    const c = new Game.THREE.Color();
    const hsl = { h: 0, s: 0, l: 0 };
    for (const o of Game.terrainGroup.children) {
        if (!o.name || !o.name.startsWith(pref) || !o.instanceColor) continue;
        if (!o.userData._origColors || o.userData._origColors.length !== o.instanceColor.array.length) {
            o.userData._origColors = o.instanceColor.array.slice();
        }
        const orig = o.userData._origColors;
        for (let i = 0; i < o.count; i++) {
            c.setRGB(orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2]);
            c.getHSL(hsl);
            c.setHSL((hsl.h + t.h + 1) % 1,
                Game.clamp(hsl.s * t.s, 0, 1),
                Game.clamp(hsl.l * t.l, 0, 1));
            o.instanceColor.setXYZ(i, c.r, c.g, c.b);
        }
        o.instanceColor.needsUpdate = true;
    }
};
{
    const sel = document.getElementById('dbgFolSpecies');
    const rows = [
        ['dbgFolHue', 'dbgFolHueVal', 'h', 2],
        ['dbgFolSat', 'dbgFolSatVal', 's', 2],
        ['dbgFolLight', 'dbgFolLightVal', 'l', 2],
    ];
    const load = () => {
        const t = Game._foliageTint[sel.value];
        for (const [id, vid, key, dp] of rows) {
            const el = document.getElementById(id);
            const val = document.getElementById(vid);
            if (el) el.value = t[key];
            if (val) val.textContent = (+t[key]).toFixed(dp);
        }
    };
    if (sel) {
        sel.addEventListener('change', load);
        for (const [id, vid, key, dp] of rows) {
            const el = document.getElementById(id);
            el?.addEventListener('input', () => {
                const v = parseFloat(el.value);
                const val = document.getElementById(vid);
                if (val) val.textContent = v.toFixed(dp);
                Game._foliageTint[sel.value][key] = v;
                Game.applyFoliageTint(sel.value);
            });
        }
        load();
    }
}

// ── HUD bar fold: chevron collapses the bottom bar to a corner button ──
{
    const bar = document.getElementById('hudBar');
    const down = document.getElementById('hudCollapse');
    const up = document.getElementById('hudExpand');
    const setFold = (folded) => {
        if (!bar || !up) return;
        bar.classList.toggle('hud-collapsed', folded);
        up.style.display = folded ? 'flex' : 'none';
    };
    down?.addEventListener('click', () => setFold(true));
    up?.addEventListener('click', () => setFold(false));
}

// ── Effects controls ──
_dbgSlider('dbgRippleSpeed', 'dbgRippleSpeedVal', v => {
    (Game.WATER_RIPPLE = Game.WATER_RIPPLE || {}).speed = v;
});
_dbgSlider('dbgRippleStr', 'dbgRippleStrVal', v => {
    (Game.WATER_RIPPLE = Game.WATER_RIPPLE || {}).strength = v;
});
_dbgSlider('dbgSparkle', 'dbgSparkleVal', v => {
    (Game.WATER_SPARKLE = Game.WATER_SPARKLE || {}).intensity = v;
    if (Game._waterFX && Game._waterFX.mat) Game._waterFX.mat.emissiveIntensity = v;
    const B = Game._neuralBake;
    if (B && B.waterSwap) B.waterSwap.mesh.material.emissiveIntensity = v;
});
_dbgSlider('dbgSparkleScale', 'dbgSparkleScaleVal', v => {
    (Game.WATER_SPARKLE = Game.WATER_SPARKLE || {}).scale = v;
    const fx = Game._waterFX;
    if (fx && fx.sparkle && fx.w) fx.sparkle.repeat.set(fx.w / v, fx.hSpan / v);
    const B = Game._neuralBake;
    if (B && B.waterSwap && B.waterSwap.mesh.material.emissiveMap && fx && fx.w) {
        B.waterSwap.mesh.material.emissiveMap.repeat.set(fx.w / v, fx.hSpan / v);
    }
});
_dbgSlider('dbgSparkleSpeed', 'dbgSparkleSpeedVal', v => {
    (Game.WATER_SPARKLE = Game.WATER_SPARKLE || {}).speed = v;
});
_dbgSlider('dbgWaterOpacity', 'dbgWaterOpacityVal', v => {
    Game.NEURAL_WATER = v;
    const B = Game._neuralBake;
    if (B && B.waterSwap) B.waterSwap.mesh.material.opacity = v;
});
Game.RUBBLE_DUST = { amount: 1, size: 1, opacity: 0.3 };
_dbgSlider('dbgRubbleAmt', 'dbgRubbleAmtVal', v => { Game.RUBBLE_DUST.amount = v; });
_dbgSlider('dbgRubbleSize', 'dbgRubbleSizeVal', v => { Game.RUBBLE_DUST.size = v; });
_dbgSlider('dbgRubbleOpacity', 'dbgRubbleOpacityVal', v => { Game.RUBBLE_DUST.opacity = v; });
_dbgSlider('dbgRubbleDark', 'dbgRubbleDarkVal', v => {
    (Game.RUBBLE_DECAL = Game.RUBBLE_DECAL || {}).dark = v;
    if (Game._refreshRubbleDecals) Game._refreshRubbleDecals();
});
_dbgSlider('dbgRubbleBlur', 'dbgRubbleBlurVal', v => {
    (Game.RUBBLE_DECAL = Game.RUBBLE_DECAL || {}).blur = v;
    if (Game._refreshRubbleDecals) Game._refreshRubbleDecals();
});

// ── Lighting controls ──
_dbgSlider('dbgSun', 'dbgSunVal', v => {
    Game._dbgSunBase = v;
    if (Game.sun) Game.sun.intensity = v;
});

_dbgSlider('dbgShadowDark', 'dbgShadowDarkVal', v => {
    // shadow.intensity scales how dark ALL cast shadows read (foliage dominates)
    if (Game.sun && Game.sun.shadow && Game.sun.shadow.intensity !== undefined) {
        Game.sun.shadow.intensity = v;
        if (Game.renderer) Game.renderer.shadowMap.needsUpdate = true;
    }
});

_dbgSlider('dbgShadowBlur', 'dbgShadowBlurVal', v => {
    if (Game.sun && Game.sun.shadow) {
        Game.sun.shadow.radius = v;
        if (Game.renderer) Game.renderer.shadowMap.needsUpdate = true;
    }
});

const _tiltApply = (key, v) => {
    Game.postfxState = Game.postfxState || {};
    Game.postfxState[key] = v;
    clearTimeout(Game._tiltDebounce);
    Game._tiltDebounce = setTimeout(() => { if (Game._applyTiltShift) Game._applyTiltShift(); }, 120);
};
_dbgSlider('dbgTiltFocus', 'dbgTiltFocusVal', v => _tiltApply('tiltFocusArea', v));
_dbgSlider('dbgTiltOffset', 'dbgTiltOffsetVal', v => _tiltApply('tiltOffset', v));
_dbgSlider('dbgTiltFeather', 'dbgTiltFeatherVal', v => _tiltApply('tiltFeather', v));

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
    const _t = e.target;
    if (_t && (_t.tagName === 'INPUT' || _t.tagName === 'TEXTAREA' || _t.tagName === 'SELECT' || _t.isContentEditable)) return;
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
        if (Game.updateBombers) Game.updateBombers(dt);
        if (Game.updateFighters) Game.updateFighters(dt);
        if (Game.updateThrownGrenades) Game.updateThrownGrenades(dt);
        if (Game.updateSmokeClouds) Game.updateSmokeClouds(dt);
        if (Game.updateTracers3D) Game.updateTracers3D(dt);
        if (Game.updateCraterDeformations) Game.updateCraterDeformations(dt);
        if (Game.updateWreckFx) Game.updateWreckFx(dt);
        if (Game.updateFires) Game.updateFires(dt);
        if (Game.updateBuildings) Game.updateBuildings(dt);
        if (Game.updateBuildingEntry) Game.updateBuildingEntry(dt);
        if (Game.updateCavalryHorseEntry) Game.updateCavalryHorseEntry(dt);
        if (Game.updateSmoke3D) Game.updateSmoke3D(dt);
        if (Game.updateScorch3D) Game.updateScorch3D(dt);
        if (Game.updateFoliageKnockdown) Game.updateFoliageKnockdown(dt);
        if (Game.updateWaterFX) Game.updateWaterFX(dt);
        if (Game.updateTracks3D) Game.updateTracks3D(dt);
        Game.updateMines(dt);
        Game.updateTowing(dt);
        Game.updateRecon(dt);
        Game.updateFogOfWar(dt);
        Game._camouflageTimer = (Game._camouflageTimer || 0) - dt;
        if (Game._camouflageTimer <= 0) {
            Game._camouflageTimer = 0.25;
            Game.updateCamouflage();
        }
        Game.updateBinoculars(dt);
        Game.updateEliteCrews();
        Game.updateMission(dt);
        Game.updateHover();
        Game.updateMessages(dt);
        Game.updateLighting(dt);
    } // end pause gate

    // Queued vehicle routes compute on a per-frame budget — also while paused,
    // so orders issued during a pause are ready the moment the game resumes.
    if (Game.processVehicleRouteQueue) Game.processVehicleRouteQueue();

    // Order markers animate even while paused (orders are issued during pause)
    if (Game.updateOrderMarkers) Game.updateOrderMarkers(dt);
    // Garrison labels + enter affordance (runs while paused so you can read/queue)
    if (Game.updateGarrisonUI) Game.updateGarrisonUI();
    if (Game.updateFoliage) Game.updateFoliage(dt);

    // Reference mode: keep hiding whatever async loaders attach late
    if (Game._refMode && Game._refEnforceSweep) Game._refEnforceSweep();

    // VALOR finishing pass: animate grain + sync haze tint (runs while paused too)
    if (Game.updateValor) Game.updateValor(dt);

    // Ambient + engine audio bed (runs regardless of pause)
    if (Game.Audio && Game.Audio.updateAmbient) Game.Audio.updateAmbient(dt);

    // Sync 3D meshes with game state
    Game.syncUnitMeshes(dt);

    // Targeting cursor: red reticle when attack-move stance is set or a one-shot
    // target mode (attack-ground, grenade, smoke, air strike, rotate) is armed.
    // Unload aims a destination, not a target: it gets its own troops-out
    // cursor instead of the attack reticle the other armed modes share.
    const wantUnloadCursor = Game._commandMode === 'unload';
    const wantAtkCursor = Game.orderStance === 'attack'
        || (!!Game._commandMode && !wantUnloadCursor);
    if (wantAtkCursor !== Game._lastAtkCursor || wantUnloadCursor !== Game._lastUnloadCursor) {
        Game._lastAtkCursor = wantAtkCursor;
        Game._lastUnloadCursor = wantUnloadCursor;
        const vp = document.getElementById('viewport');
        if (vp) {
            vp.classList.toggle('cmd-attack', wantAtkCursor);
            vp.classList.toggle('cmd-unload', wantUnloadCursor);
        }
    }

    // DOM reconstruction and the minimap canvas do not need render-rate updates.
    // Ten HUD refreshes and eight minimap refreshes per second remain visually
    // immediate while avoiding dozens of filters/innerHTML writes every frame.
    Game._hudRefreshTimer = (Game._hudRefreshTimer || 0) - dt;
    if (Game._hudRefreshTimer <= 0) {
        Game._hudRefreshTimer = 0.1;
        Game.updateHUD();
    }
    Game.updateSelectionBox();
    Game._minimapRefreshTimer = (Game._minimapRefreshTimer || 0) - dt;
    if (Game._minimapRefreshTimer <= 0) {
        Game._minimapRefreshTimer = 0.125;
        Game.updateMinimap();
    }

    // Render 3D scene
    Game.renderScene();

    requestAnimationFrame(Game.tick);
};

// ═══════════════════════════════════════════════════════
//  BOOT SEQUENCE (async for heightmap loading)
// ═══════════════════════════════════════════════════════

Game.setupHUD = () => {
    Game.hud.statusPill = document.getElementById('statusPill');
    Game.hud.missionPanel = document.getElementById('missionPanel');
    Game.hud.selectedPanel = document.getElementById('selectedPanel');
    Game.hud.messages = document.getElementById('gameMessages');
    Game.hud.selectionBox = document.getElementById('selectionBox');
    Game.hud.minimapCanvas = document.getElementById('minimapCanvas');
    Game.hud.mokraApproachCountdown = document.getElementById('mokraApproachCountdown');
};

Game.boot = async () => {
    // HUD refs
    Game.setupHUD();

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
        cmdStop: () => {
            const stoppedUnits = Game.selectedPlayerUnits();
            stoppedUnits.forEach(u => {
                if (Game.cancelTruckManeuver) Game.cancelTruckManeuver(u);
                if (Game.cancelHorseMountOrder) Game.cancelHorseMountOrder(u);
                if (Game.clearArrivalFacing) Game.clearArrivalFacing(u);
                u.path = []; u.moving = false; u.orderMode = 'hold';
                u.forcedTargetId = null; u.bombardX = null; u.bombardZ = null;
                u._bombarding = false;
            });
            if (stoppedUnits.some(u => Game.isTank(u.kind)) && Game.Audio) Game.Audio.voice('f_tank_stop');
            Game.pushMessage('Units stopped.', 1.0);
        },
        cmdHold: () => { Game.toggleHoldFire(); },
        cmdGrenade: () => { Game._commandMode = 'grenade'; Game.pushMessage('Grenade — right-click target.', 2.0); },
        cmdMove: () => { Game.setOrderStance('move'); },
        cmdSmoke: () => { Game._commandMode = 'smoke'; Game.pushMessage('Smoke — right-click target.', 2.0); },
        cmdAirStrike: () => { if (Game.airStrikesAvailable > 0) { Game._commandMode = 'airstrike'; Game.adjustAirStrikePlanes(0); Game.pushMessage(`Air strike: ${Game.airStrikePlanesToUse} of ${Game.airStrikesAvailable} plane(s). Wheel to adjust, right-click target.`, 3.5); } else { Game.pushMessage('No air strikes available!', 2.0); } },
        cmdFighter: () => { if (Game.fighterTotalAvailable && Game.fighterTotalAvailable() > 0) { Game.toggleFighterMenu(); } else { Game.pushMessage('No fighters available!', 2.0); } },
        cmdRotate: () => { Game._commandMode = 'rotate'; Game.pushMessage('Rotate — right-click direction.', 2.0); },
        cmdProne: () => { Game.toggleProneSelection(); },
        cmdCavalry: () => { Game.toggleSelectedCavalry(); },
        cmdTow: () => { Game.toggleSelectedTow(); },
        cmdCrew: () => {
            const gun = Game.selectedPlayerUnits().find(u =>
                Game.GUN_CREWS && Game.GUN_CREWS[u.kind] && !u._unmanned && !u._towed);
            if (gun) Game.dismountGunCrew(gun);
        },
        cmdCarrier: () => { Game.toggleSelectedCarrier(); },
        cmdUnload: () => {
            const carrier = Game.selectedPlayerUnits().find(u => u.supportType === 'transport');
            if (carrier && carrier._passengers && carrier._passengers.length) {
                Game._unloadCarrierId = carrier.id;
                Game._commandMode = 'unload';
                Game.pushMessage('Unload infantry — right-click the destination.', 2.0);
            }
        },
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

    // Named map loads: the debug Load button stores a name and reloads;
    // replaying that save's seed rebuilds the identical map.
    let pendingSave = null;
    const pendingName = localStorage.getItem('uf_loadMap');
    if (pendingName) {
        localStorage.removeItem('uf_loadMap');
        pendingSave = await Game._mapStoreGet(pendingName).catch(() => null);
    }
    // Default map: the bundled baked map (maps/default/) unless the player
    // explicitly asked for a fresh procedural one from the debug panel.
    const forceProc = localStorage.getItem('uf_forceProcedural');
    if (forceProc) localStorage.removeItem('uf_forceProcedural');
    if (!pendingSave && !forceProc && Game.currentScenario !== 'mokra') {
        try {
            const r = await fetch('maps/default/map.json');
            if (r.ok) {
                pendingSave = await r.json();
                const dec = (b64) => {
                    const bin = atob(b64);
                    const u = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
                    return u;
                };
                if (pendingSave && pendingSave.editor) {
                    const e = pendingSave.editor;
                    if (e.tilesB64) e.tiles = dec(e.tilesB64);
                    if (e.ovB64) e.ov = dec(e.ovB64);
                }
                if (pendingSave && pendingSave.fluff && pendingSave.fluff.masksB64) {
                    const masks = {};
                    for (const sp in pendingSave.fluff.masksB64) {
                        masks[sp] = dec(pendingSave.fluff.masksB64[sp]);
                    }
                    // fluff rides inside editor so _applyEditorTiles restores it
                    pendingSave.editor = pendingSave.editor || {};
                    pendingSave.editor.fluff = { cfg: pendingSave.fluff.cfg, masks };
                }
                if (pendingSave) pendingSave._bakeUrl = 'maps/default/bake.jpg';
            }
        } catch (e) { /* no bundled map: fall through to procedural */ }
    }
    Game._beginMapSeed(pendingSave ? pendingSave.seed : (Math.random() * 0xffffffff) >>> 0);

    // Load heightmap from depth image (async)
    await Game.loadHeightmap();

    // Pond plan: a saved map replays its recorded pond layout; a save without
    // pond metadata suppresses procedural ponds (their seeded positions drift
    // whenever generation code changes, digging water where the save's baked
    // ground texture shows dry field). Fresh procedural maps roll random ponds.
    Game._pondPlan = pendingSave ? (pendingSave.ponds || 'suppress') : null;

    // Generate tile-based map data (or an editor blank canvas), then lay any
    // painted tiles from the save over it before the world builds
    if (pendingSave && pendingSave.editor && pendingSave.editor.blank && Game.generateBlankMap) {
        Game.generateBlankMap();
    } else {
        Game.generateMap();
    }
    if (pendingSave && pendingSave.editor && Game._applyEditorTiles) {
        Game._applyEditorTiles(pendingSave.editor);
    }

    // Build 3D terrain meshes (uses heightmap)
    Game.buildTerrainMeshes();

    // Apply the default foliage tints to the freshly built canopy (a saved
    // map's own tints re-apply over these in _applySavedMap below).
    for (const sp in Game._foliageTint) Game.applyFoliageTint(sp);

    // Spawn scenario
    Game.spawnScenario();
    Game._endMapSeed();
    if (pendingSave && Game._applySavedMap) await Game._applySavedMap(pendingSave);



    // Initialize fog of war
    Game.initFogOfWar();

    // Set initial camera centered on largest concentration of player troops
    const playerUnits = Game.units.filter(u => u.team === Game.playerTeam && u.alive);
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

    // Black boot cover: ease from black only once async assets (models and
    // their textures stream in after boot) have gone quiet — revealing on the
    // first frame showed the world assembling piece by piece. Chained loads
    // (GLB then its textures) keep resetting the quiet timer; a hard cap
    // guarantees the cover never sticks on a failed download.
    {
        const bl = document.getElementById('bootLoader');
        if (bl) {
            const lm = Game.THREE && Game.THREE.DefaultLoadingManager;
            let busy = false;
            let quietAt = performance.now();
            if (lm) {
                const prevStart = lm.onStart;
                const prevLoad = lm.onLoad;
                lm.onStart = (...a) => { busy = true; if (prevStart) prevStart(...a); };
                lm.onLoad = (...a) => {
                    busy = false;
                    quietAt = performance.now();
                    if (prevLoad) prevLoad(...a);
                };
            }
            const t0 = performance.now();
            const tryFade = () => {
                const quiet = !busy && (performance.now() - quietAt > 900);
                if (quiet || performance.now() - t0 > 15000) {
                    if (window.ufStopBootLoaderMessages) window.ufStopBootLoaderMessages();
                    bl.style.opacity = '0';
                    setTimeout(() => { bl.style.display = 'none'; }, 1300);
                } else {
                    setTimeout(tryFade, 250);
                }
            };
            requestAnimationFrame(() => requestAnimationFrame(tryFade));
        }
    }
};

// ═══════════════════════════════════════════════════════
//  MENU → GAME START
// ═══════════════════════════════════════════════════════

Game.startFromMenu = () => {
    const menu = document.getElementById('mainMenu');
    const mission = document.querySelector('.mission-card.selected')?.dataset.mission || Game.currentScenario || 'dyle';
    const side = document.querySelector('.side-btn.selected')?.dataset.side || Game.playerTeam || 'french';

    // A scenario owns its terrain and force setup, which are built during boot.
    // Normally the card handler already reloaded; this guard keeps programmatic
    // menu changes honest too.
    if (mission !== Game.currentScenario) {
        try {
            localStorage.setItem('uf_mission', mission);
            sessionStorage.setItem('uf_return_menu', '1');
        } catch (e) { }
        location.reload();
        return;
    }
    if (mission === 'dyle' && side !== Game.playerTeam && Game.setPlayerSide) {
        Game.setPlayerSide(side);
    }

    Game.selectedMission = mission;
    Game.selectedSide = side;

    // Hide menu
    menu.classList.add('hidden');
    Game._paused = false;

    // Audio needs a user gesture to start (this click qualifies)
    if (Game.Audio) Game.Audio.init();

    // Center camera on largest troop concentration
    const playerUnits = Game.units.filter(u => u.team === Game.playerTeam && u.alive);
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
    if (mission === 'mokra' && Game.startMokraDeployment) Game.startMokraDeployment();
};

// Save/Load was removed for the single-session public build. A persistent
// campaign/save system is on the roadmap — see vision.md.

// Wire menu buttons (deferred until DOM ready)
const wireMenuButtons = () => {
    document.getElementById('btnStartMission')?.addEventListener('click', () => Game.startFromMenu());
};

const bootPage = async () => {
    // Confirm GLB CORS before any heavyweight asset request. A failed probe
    // switches the resolver back to underfire.io for this page load.
    await Game.prepareAssetCdn();
    wireMenuButtons();
    await Game.boot();
};

// Wait for DOM, then boot (game starts paused behind menu)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { bootPage(); });
} else {
    bootPage();
}

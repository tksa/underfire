/**
 * Under Fire — main.js (ES module)
 * Imports THREE, sets it globally, then boots the game.
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
window.THREE = THREE;
window.Game.THREE = THREE;
window.Game.FBXLoader = FBXLoader;
window.Game.PLYLoader = PLYLoader;
window.Game.GLTFLoader = GLTFLoader;
window.Game.SkeletonUtils = { clone: skeletonClone };  // proper clone for rigged/skinned models

// ═══════════════════════════════════════════════════════
//  UNIT COLLISION AVOIDANCE
// ═══════════════════════════════════════════════════════

/**
 * Apply separation steering so units don't overlap.
 * Tanks push harder; infantry yields to tanks.
 */
Game.applySeparation = (unit, dt) => {
    let sepX = 0, sepZ = 0;
    const isVeh = Game.isTank(unit.kind);
    const myRadius = isVeh ? unit.size * 2.5 : unit.size * 0.7;

    for (const other of Game.units) {
        if (!other.alive || other.id === unit.id) continue;

        const dx = unit.x - other.x;
        const dz = unit.z - other.z;
        const distSq = dx * dx + dz * dz;

        const otherVeh = Game.isTank(other.kind);
        const otherRadius = otherVeh ? other.size * 2.5 : other.size * 0.7;
        const minDist = myRadius + otherRadius + 0.3;
        const minDistSq = minDist * minDist;

        if (distSq < minDistSq && distSq > 0.001) {
            const dist = Math.sqrt(distSq);
            const overlap = minDist - dist;
            const nx = dx / dist;
            const nz = dz / dist;

            let strength = overlap * 3.0;

            // Infantry yields to tanks hard
            if (!isVeh && otherVeh) strength *= 4.0;
            // Tanks are immovable by infantry
            if (isVeh && !otherVeh) strength = 0;

            sepX += nx * strength;
            sepZ += nz * strength;
        }
    }

    if (isVeh) {
        // Vehicles: project separation onto forward axis only.
        // This prevents lateral sliding — the tank can only be
        // pushed forward or backward along its facing direction.
        const fwdX = Math.cos(unit.angle);
        const fwdZ = Math.sin(unit.angle);
        const dot = sepX * fwdX + sepZ * fwdZ;
        unit.x += fwdX * dot * dt;
        unit.z += fwdZ * dot * dt;
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
    }
};

// ═══════════════════════════════════════════════════════
//  PER-UNIT UPDATE
// ═══════════════════════════════════════════════════════

Game.updateUnit = (unit, dt) => {
    if (!unit.alive) return;
    const prevX = unit.x, prevZ = unit.z;
    unit.coverBonus = Game.computeCover(unit);
    unit.cooldownLeft = Math.max(0, unit.cooldownLeft - dt);
    unit.underFire = Math.max(0, unit.underFire - dt);
    unit.shaken = Math.max(0, unit.shaken - dt);
    unit.stopTimer = Math.max(0, unit.stopTimer - dt);
    unit.orderDelay = Math.max(0, (unit.orderDelay || 0) - dt);

    const recovery = unit.underFire > 0 ? 4 : 11;
    unit.suppressionValue = Math.max(0, unit.suppressionValue - recovery * dt);
    // Suppression escalates stance under fire and recovers when safe.
    // _autoStance marks a stance the AI imposed (so manual orders aren't overridden,
    // and the soldier stands back up once the suppression clears).
    if (!Game.isTank(unit.kind)) {
        if (unit.suppressionValue > 88) {
            if (unit.stance !== 'prone') { unit.stance = 'prone'; unit._autoStance = true; }
        } else if (unit.suppressionValue > 62) {
            if (unit.stance === 'stand' || unit.stance === 'run') { unit.stance = 'crouch'; unit._autoStance = true; }
        } else if (unit.suppressionValue < 30 && unit._autoStance) {
            unit.stance = 'stand';
            unit._autoStance = false;
        }
    }

    // Engine damage: HP drain 1/sec
    if (unit.engineDamaged && unit.alive) {
        unit.hp -= dt * 1.0;
        if (unit.hp <= 0) {
            unit.alive = false;
            unit.hp = 0;
            Game.pushMessage(`${unit.label} burned out!`, 2.0);
            if (unit.mesh) unit.mesh.visible = false;
        }
    }

    // ── HP Status System (Green/Yellow/Red) ──
    const hpPct = unit.hp / unit.maxHp;
    const base = Game.UNIT_STATS[unit.statKey];
    const isVeh = Game.isTank(unit.kind);

    if (hpPct > 0.5) {
        // GREEN — normal operation
        unit._hpStatus = 'green';
        // Restore vehicle speed if it was immobilized by yellow
        if (isVeh && unit._yellowDisabled && !unit.tracksDisabled) {
            unit.speed = base ? base.speed : unit.speed;
            unit._yellowDisabled = false;
        }
        // Restore infantry speed
        if (!isVeh && unit._yellowSlow) {
            unit.speed = base ? base.speed : unit.speed;
            unit._yellowSlow = false;
        }
    } else if (hpPct > 0.2) {
        // YELLOW — slow HP regen, vehicles immobilized, infantry half speed
        unit._hpStatus = 'yellow';
        unit.hp += dt / 3.0; // +1 HP per 3s
        if (unit.hp > unit.maxHp * 0.5) unit.hp = unit.maxHp * 0.5; // cap at green threshold
        if (isVeh && !unit._yellowDisabled) {
            unit._yellowDisabled = true;
            unit.speed = 0;
        }
        if (!isVeh && !unit._yellowSlow && base) {
            unit._yellowSlow = true;
            unit.speed = base.speed * 0.5;
        }
    } else if (unit.hp > 0) {
        // RED — HP bleeds, only fixable by medic/mechanic/shelter
        unit._hpStatus = 'red';
        unit.hp -= dt / 3.0; // -1 HP per 3s
        if (unit.hp <= 0) {
            unit.alive = false;
            unit.hp = 0;
            Game.pushMessage(`${unit.label} bled out.`, 2.0);
            if (unit.mesh) unit.mesh.visible = false;
        }
    }

    // Infantry ammo scavenging while moving (+1 per 8s)
    if (!isVeh && unit.moving && unit.ammo >= 0) {
        unit._scavengeTimer = (unit._scavengeTimer || 0) + dt;
        if (unit._scavengeTimer >= 8) {
            unit._scavengeTimer = 0;
            unit.ammo++;
        }
    }

    // ── Target resolution ──
    // Priority: player-forced target > auto-acquire nearest. A forced target
    // commits the unit until the target dies or it's manually re-ordered.
    let enemy = null;
    if (unit.forcedTargetId != null) {
        const ft = Game.getUnitById(unit.forcedTargetId);
        if (ft && ft.alive && ft.team !== unit.team) {
            enemy = ft;
        } else {
            // Target died or vanished — release the commitment and STOP. We were
            // chasing the unit, not a ground spot, so don't keep marching to where
            // it used to be; hold position (and fire at will if anything's in range).
            unit.forcedTargetId = null;
            unit.path = [];
            unit.moving = false;
            unit._pursueAnchor = null;
        }
    }
    if (!enemy && unit.orderMode !== 'hold') enemy = Game.nearestEnemy(unit);
    unit.fireTargetId = enemy ? enemy.id : null;

    // ── Indirect bombardment (mortars): fire on a commanded ground spot ──
    const weaponDef0 = Game.WEAPONS[unit.weaponKey];
    if (weaponDef0 && weaponDef0.fireType === 'indirect' && unit.bombardX != null) {
        Game.updateBombard(unit, dt, weaponDef0);
        // Bombarding units don't also direct-fire; skip the rest of combat/movement targeting
        if (unit._bombarding) {
            unit.coverBonus = Game.computeCover(unit);
            return;
        }
    }

    // ── Forced-target pursuit ──
    // A player-ordered attack means "engage that unit ASAP." If we can't see it
    // or it's out of range, keep closing toward it; the moment we have LOS and
    // range, stop and fire. Without this, an ordered unit that's already in
    // range but has a building/object blocking the shot would just stand still.
    if (enemy && unit.forcedTargetId === enemy.id
        && weaponDef0 && weaponDef0.fireType !== 'indirect') {
        const dft = Game.dist(unit.x, unit.z, enemy.x, enemy.z);
        const canHit = dft <= unit.range && Game.unitCanSee(unit, enemy);
        if (canHit) {
            // Clear shot — hold position and let the firing logic take over.
            unit.path = [];
            unit.moving = false;
            unit.stopTimer = 0;
        } else {
            // Re-path straight toward the target (throttled). Pathing routes
            // around obstacles, so the unit gains LOS as it closes in.
            unit._pursueTimer = (unit._pursueTimer || 0) - dt;
            const targetMoved = !unit._pursueAnchor
                || Game.distSq(unit._pursueAnchor.x, unit._pursueAnchor.z, enemy.x, enemy.z) > 9;
            if (!unit.moving || unit._pursueTimer <= 0 || targetMoved) {
                unit._pursueTimer = 0.5;
                unit._pursueAnchor = { x: enemy.x, z: enemy.z };
                // Aim for a point that is always CLOSER than we are right now, so
                // we move directly in and never retreat to a standoff ring. Capped
                // to settle within weapon range once we get there.
                const goalDist = Math.max(2, Math.min(unit.range * 0.85, dft * 0.6));
                const ang = Game.angleTo(enemy.x, enemy.z, unit.x, unit.z);
                const gx = Game.clamp(enemy.x + Math.cos(ang) * goalDist, 1, Game.WORLD_W - 1);
                const gz = Game.clamp(enemy.z + Math.sin(ang) * goalDist, 1, Game.WORLD_H - 1);
                unit.path = Game.findPath(unit, unit.x, unit.z, gx, gz);
                unit.moving = true;
                unit.stopTimer = 0;
            }
        }
    }

    // Assault move: stop to engage enemies, resume when clear
    if (unit.orderMode === 'assault' && enemy && unit.path && unit.path.length) {
        const d = Game.dist(unit.x, unit.z, enemy.x, enemy.z);
        if (d <= unit.range) {
            unit.moving = false;
            unit.stopTimer = 0.5;  // Brief pause to engage
        }
    }

    // AI (German units)
    if (unit.team === Game.TEAM.GERMAN) {
        Game.updateAI(unit, dt, enemy);
    }

    // ── Turret / weapon tracking ──────────────────────────
    const canFire = !(Game.isTank(unit.kind) && unit.turretDamaged);
    const hasTurret = isVeh && unit.hasTurret;
    const aimAngleToEnemy = enemy ? Game.angleTo(unit.x, unit.z, enemy.x, enemy.z) : null;

    if (canFire && enemy && Game.unitCanSee(unit, enemy)) {
        const d = Game.dist(unit.x, unit.z, enemy.x, enemy.z);

        // Fire whenever the target is in range + LOS. (stopTimer pauses MOVEMENT
        // during an assault-move engage; it must NOT also block firing, or units
        // ordered to attack-move would freeze next to an enemy without shooting.)
        if (d <= unit.range) {
            // Combat readiness: a unit relocating on a plain Move order travels with
            // weapons stowed and needs a moment to react to contact. Attack-move,
            // defending, and idle units (_combatReady !== false) engage on contact.
            // The turret/hull still tracks the threat during ready-up; only the shot
            // waits, so the player sees the unit "bring weapons to bear" first.
            let ready = unit._combatReady !== false;
            if (!ready) {
                unit._readyTimer = (unit._readyTimer || 0) + dt;
                if (unit._readyTimer >= (Game.isTank(unit.kind) ? 1.8 : 1.2)) {
                    unit._combatReady = true;
                    ready = true;
                }
            }
            if (hasTurret) {
                // ── Turreted vehicle: rotate turret toward enemy with inertia ──
                const tRot = Game.rotateWithInertia(
                    unit.turretAngle, unit.turretAngVel, aimAngleToEnemy,
                    unit.turretRotSpeed, unit.turretAccel, dt
                );
                unit.turretAngle = tRot.angle;
                unit.turretAngVel = tRot.angVel;
                const turretAligned = Math.abs(Game.angleDiff(unit.turretAngle, aimAngleToEnemy)) < 0.15;

                // Hull slowly rotates to present frontal armor when stationary
                if (!unit.moving) {
                    const hRot = Game.rotateWithInertia(
                        unit.angle, unit.hullAngVel, aimAngleToEnemy,
                        unit.rotationSpeed * 0.3, unit.hullTurnAccel * 0.3, dt
                    );
                    unit.angle = hRot.angle;
                    unit.hullAngVel = hRot.angVel;
                }

                if (turretAligned && ready && unit.cooldownLeft <= 0) {
                    Game.applyShot(unit, enemy);
                    const xpReloadMod = 1 - (unit.experience || 0) * 0.0015;
                    unit.cooldownLeft = unit.cooldown * Game.clamp(1 + unit.suppressionValue / 160, 0.6, 1.8) * xpReloadMod;
                }
            } else if (isVeh) {
                // ── Turretless vehicle: must rotate hull to fire ──
                const hRot = Game.rotateWithInertia(
                    unit.angle, unit.hullAngVel, aimAngleToEnemy,
                    unit.rotationSpeed * 0.5, unit.hullTurnAccel * 0.5, dt
                );
                unit.angle = hRot.angle;
                unit.hullAngVel = hRot.angVel;
                unit.turretAngle = unit.angle;
                const hullAligned = Math.abs(Game.angleDiff(unit.angle, aimAngleToEnemy)) < 0.15;

                if (hullAligned && ready && unit.cooldownLeft <= 0) {
                    Game.applyShot(unit, enemy);
                    const xpReloadMod = 1 - (unit.experience || 0) * 0.0015;
                    unit.cooldownLeft = unit.cooldown * Game.clamp(1 + unit.suppressionValue / 160, 0.6, 1.8) * xpReloadMod;
                }
            } else {
                // ── Infantry / support: instant snap (as before) ──
                unit.angle = aimAngleToEnemy;
                unit.turretAngle = unit.angle;
                if (ready && unit.cooldownLeft <= 0) {
                    Game.applyShot(unit, enemy);
                    const xpReloadMod = 1 - (unit.experience || 0) * 0.0015;
                    unit.cooldownLeft = unit.cooldown * Game.clamp(1 + unit.suppressionValue / 160, 0.6, 1.8) * xpReloadMod;
                }
            }
        }
    } else if (hasTurret && !unit.moving) {
        // No enemy visible — return turret to hull forward (half speed)
        const tRot = Game.rotateWithInertia(
            unit.turretAngle, unit.turretAngVel, unit.angle,
            unit.turretRotSpeed * 0.5, unit.turretAccel * 0.5, dt
        );
        unit.turretAngle = tRot.angle;
        unit.turretAngVel = tRot.angVel;
    }

    // Movement
    let maxSpeed = unit.speed;
    // isVeh already declared above

    // Speed modifiers (infantry only for now — vehicles run at base speed)
    if (!isVeh) {
        const speedFactor = Game.clamp(1 - unit.suppressionValue / 135, 0.3, 1);
        // Stance = movement mode: crawl / crouch-walk / walk / run
        const STANCE_SPEED = { prone: 0.28, crouch: 0.55, stand: 1.0, run: 1.5 };
        // Global infantry pace scale — foot soldiers shouldn't sprint everywhere
        maxSpeed *= 0.6 * speedFactor * (STANCE_SPEED[unit.stance] ?? 1.0);

        // Terrain speed modifier
        const tile = Game.getTileAtWorld(unit.x, unit.z);
        if (tile) {
            if (tile.type === 'road') maxSpeed *= 1.2;
            else if (tile.type === 'mud' || tile.type === 'forest') maxSpeed *= 0.7;
            else if (tile.type === 'wheat') maxSpeed *= 0.9;
            else if (tile.type === 'dense_forest') maxSpeed *= 0.3;
            else if (tile.type === 'swamp') maxSpeed *= 0.4;
        }

        // Weather speed modifier
        if (Game.getWeatherSpeedMod) maxSpeed *= Game.getWeatherSpeedMod();
    }

    // Immobilized: no fuel or tracks disabled
    if (isVeh && (unit.fuel === 0 || unit.tracksDisabled)) {
        maxSpeed = 0;
    }

    // Vehicles slow down on steep slopes
    if (isVeh && Game.getTerrainSlope) {
        const slope = Game.getTerrainSlope(unit.x, unit.z);
        maxSpeed *= Game.clamp(1 - slope * 1.5, 0.45, 1);
    }

    // Entrenched units don't move
    if (unit.entrenched) {
        maxSpeed = 0;
    }

    if (unit.path && unit.path.length && unit.stopTimer <= 0 && (unit.orderDelay || 0) <= 0) {
        let next = unit.path[0];
        let dx = next.x - unit.x;
        let dz = next.z - unit.z;
        let d = Math.hypot(dx, dz);

        // Waypoint arrival radius — wider for vehicles to prevent
        // jerky per-tile deceleration on closely spaced waypoints
        const arrivalDist = isVeh ? 1.5 : 0.4;

        // "Gobble up" all waypoints within arrival radius immediately.
        // Prevents jitter on tight curves where multiple waypoints are clustered.
        while (unit.path.length && d < arrivalDist) {
            unit.path.shift();
            
            // Lookahead: pop intermediate waypoints roughly in the same direction (straightening)
            if (isVeh) {
                while (unit.path.length > 1) {
                    const peek = unit.path[0];
                    const peekDx = peek.x - unit.x;
                    const peekDz = peek.z - unit.z;
                    const peekD = Math.hypot(peekDx, peekDz);
                    const peekAng = Math.atan2(peekDz, peekDx);
                    
                    const next2 = unit.path[1];
                    const n2Dx = next2.x - unit.x;
                    const n2Dz = next2.z - unit.z;
                    const n2Ang = Math.atan2(n2Dz, n2Dx);
                    
                    if (Math.abs(Game.angleDiff(peekAng, n2Ang)) < 0.4 && peekD < 6) {
                        unit.path.shift();
                    } else {
                        break;
                    }
                }
            }

            if (!unit.path.length) {
                unit.moving = false;
                // Gentle coast to stop (momentum)
                unit.currentSpeed = Math.max(0, unit.currentSpeed - maxSpeed * 0.8 * dt);
                break;
            }

            // Re-read next waypoint
            next = unit.path[0];
            dx = next.x - unit.x;
            dz = next.z - unit.z;
            d = Math.hypot(dx, dz);
        }

        if (unit.path.length) {
            const ang = Math.atan2(dz, dx);
            const isLastWaypoint = unit.path.length === 1;

            if (isVeh) {
                // ═══════════════════════════════════════════════
                // ═══════════════════════════════════════════════
                //  VEHICLE MOVEMENT — Realistic Differential Drive
                // ═══════════════════════════════════════════════
                const angleDelta = Game.angleDiff(unit.angle, ang);
                const absAngleDelta = Math.abs(angleDelta);

                // ── 1. ROTATION ──
                // Real tanks turn slower when moving fast due to forward momentum.
                // We scale turn speed inversely with current speed so the tank
                // makes wide arcs at top speed, and tight pivots at low speed.
                const speedRatio = unit.currentSpeed / (maxSpeed || 1);
                // At 100% speed, turn at 40% rate (wide arc). At 0% speed, turn at 100% rate (pivot)
                const turnMomentumFactor = Game.clamp(1.0 - (speedRatio * 0.6), 0.4, 1.0);
                
                // Track power boost: if doing a hard pivot (target way off, moving slow), rev tracks
                const pivotBoost = (absAngleDelta > 0.5 && speedRatio < 0.2) ? 1.3 : 1.0;
                
                const turnSpeed = unit.rotationSpeed * turnMomentumFactor * pivotBoost;

                unit.angle = Game.rotateTo(unit.angle, ang, turnSpeed * dt);

                // ── 2. FORWARD DRIVE ──
                // Speed scales with alignment, but using a very natural curve.
                // Also, heavy tanks cannot turn and drive at max speed simultaneously
                // because engine power is diverted to the tracks for turning.
                let targetSpeed = 0;
                
                if (absAngleDelta < Math.PI / 2) {
                    // Only drive forward if target is generally in front (< 90 deg)
                    // Use cos³ for a smooth, heavy drop-off as angle increases
                    const cosA = Math.cos(absAngleDelta);
                    const alignment = Math.max(0, Math.pow(cosA, 3));
                    targetSpeed = maxSpeed * alignment;
                } else {
                    // Target is behind us or hard to the side. 
                    // A real tank will bleed speed to zero and pivot.
                    targetSpeed = 0;
                }

                // Smooth acceleration/deceleration simulating heavy mass (10-50 tons)
                // Tanks take time to spool up engine RPM, and take time to brake.
                // Base this off 'maxSpeed' so faster light tanks accelerate quicker than heavies.
                const accelRate = maxSpeed * 0.5; // Takes ~2.0 seconds to reach top speed
                const brakeRate = maxSpeed * 1.2; // Brakes are stronger than engine

                if (unit.currentSpeed < targetSpeed) {
                    unit.currentSpeed = Math.min(targetSpeed, unit.currentSpeed + accelRate * dt);
                } else {
                    unit.currentSpeed = Math.max(targetSpeed, unit.currentSpeed - brakeRate * dt);
                }

                // Only decelerate at the FINAL waypoint, never intermediate ones
                if (isLastWaypoint && d < 3.0) {
                    unit.currentSpeed = Math.min(
                        unit.currentSpeed, maxSpeed * (d / 3.0));
                }

                // ── 3. POSITION UPDATE ──
                // Always move along the hull's forward direction
                const step = Math.min(unit.currentSpeed * dt, d);
                if (step > 0.001) {
                    unit.x += Math.cos(unit.angle) * step;
                    unit.z += Math.sin(unit.angle) * step;
                    
                    // Tank tracks trail marking
                    unit._trackDist = (unit._trackDist || 0) + step;
                    if (unit._trackDist > 1.2) {
                        unit._trackDist = 0;
                        Game.trackMarks = Game.trackMarks || [];
                        Game.trackMarks.push({
                            x: unit.x, z: unit.z,
                            angle: unit.angle,
                            size: unit.size,
                            life: 15.0, total: 15.0,
                            mesh: null
                        });
                    }
                }

                // ── 4. REVERSE for short distances behind ──
                // If target is behind (>115°) and very close (<5),
                // allow backward movement at reduced speed
                unit._reversing = false;
                if (absAngleDelta > 2.0 && d < 5 && step < 0.001) {
                    unit._reversing = true;
                    const revSpeed = maxSpeed * 0.25;
                    const revStep = Math.min(revSpeed * dt, d);
                    unit.x += Math.cos(ang) * revStep;
                    unit.z += Math.sin(ang) * revStep;
                    unit.currentSpeed = revSpeed;
                    
                    // Tank tracks trail marking (reverse)
                    unit._trackDist = (unit._trackDist || 0) + revStep;
                    if (unit._trackDist > 1.2) {
                        unit._trackDist = 0;
                        Game.trackMarks = Game.trackMarks || [];
                        Game.trackMarks.push({
                            x: unit.x, z: unit.z,
                            angle: unit.angle,
                            size: unit.size,
                            life: 15.0, total: 15.0,
                            mesh: null
                        });
                    }
                }

                // ── 5. TURRET ──
                if (hasTurret && enemy && aimAngleToEnemy !== null
                    && Game.unitCanSee(unit, enemy)) {
                    const enemyDist = Game.dist(
                        unit.x, unit.z, enemy.x, enemy.z);
                    const tTarget = enemyDist <= unit.range
                        ? aimAngleToEnemy : unit.angle;
                    const tSpeed = enemyDist <= unit.range
                        ? unit.turretRotSpeed
                        : unit.turretRotSpeed * 0.5;
                    const tAccel = enemyDist <= unit.range
                        ? unit.turretAccel
                        : unit.turretAccel * 0.5;
                    const tRot = Game.rotateWithInertia(
                        unit.turretAngle, unit.turretAngVel,
                        tTarget, tSpeed, tAccel, dt);
                    unit.turretAngle = tRot.angle;
                    unit.turretAngVel = tRot.angVel;
                } else if (hasTurret) {
                    // No enemy — turret returns to forward
                    const turretOff = Math.abs(Game.angleDiff(unit.turretAngle, unit.angle));
                    if (turretOff < 0.08) {
                        // Close enough — lock rigidly to hull
                        unit.turretAngle = unit.angle;
                        unit.turretAngVel = 0;
                    } else {
                        // Still returning from enemy tracking — smooth return
                        const tRot = Game.rotateWithInertia(
                            unit.turretAngle, unit.turretAngVel, unit.angle,
                            0.8, 0.4, dt);
                        unit.turretAngle = tRot.angle;
                        unit.turretAngVel = tRot.angVel;
                    }
                } else {
                    unit.turretAngle = unit.angle;
                }

                unit.moving = true;

            } else {
                // ── INFANTRY MOVEMENT (unchanged) ──
                const turnRate = unit.rotationSpeed;
                unit.angle = Game.lerpAngle(unit.angle, ang, Game.clamp(turnRate * dt, 0, 1));

                // Turret/weapon faces movement direction
                unit.turretAngle = unit.angle;

                unit.currentSpeed = maxSpeed;

                const step = Math.min(unit.currentSpeed * dt, d);
                unit.x += Math.cos(unit.angle) * step;
                unit.z += Math.sin(unit.angle) * step;
                unit.moving = true;
            }

            // Fuel drain (vehicles only)
            if (unit.fuel > 0 && unit.currentSpeed > 0) {
                const fuelUse = unit.currentSpeed * dt * 0.15;
                unit.fuel = Math.max(0, unit.fuel - fuelUse);
                if (unit.fuel === 0) {
                    Game.pushMessage(`${unit.label} out of fuel!`, 2.5);
                }
            }
        }
    } else {
        unit.moving = false;
        // Coast to stop with momentum — tank slides forward slightly
        if (unit.currentSpeed > 0.01) {
            const coastRate = isVeh ? maxSpeed * 0.8 : maxSpeed * 3.0;
            unit.currentSpeed = Math.max(0, unit.currentSpeed - coastRate * dt);
            // Continue sliding along facing direction during coast
            if (isVeh) {
                unit.x += Math.cos(unit.angle) * unit.currentSpeed * dt;
                unit.z += Math.sin(unit.angle) * unit.currentSpeed * dt;
            }
        } else {
            unit.currentSpeed = 0;
        }
    }

    // Collision avoidance — push apart from nearby units
    Game.applySeparation(unit, dt);

    // Clamp to world bounds
    unit.x = Game.clamp(unit.x, 0.5, Game.WORLD_W - 0.5);
    unit.z = Game.clamp(unit.z, 0.5, Game.WORLD_H - 0.5);

    // Solid obstacles: never enter blocked tiles (buildings, walls, water)
    const tileNow = Game.getTileAtWorld(unit.x, unit.z);
    if (tileNow && (tileNow.blocked || (isVeh && tileNow.vehicleBlocked))) {
        unit.x = prevX;
        unit.z = prevZ;
        unit.currentSpeed = 0;
    }

    // Follow terrain height (vehicles use footprint-averaged height for smooth traversal)
    if (isVeh && Game.getVehicleHeight) {
        unit.y = Game.getVehicleHeight(unit.x, unit.z, unit.size, unit.angle);
    } else {
        unit.y = Game.getHeight(unit.x, unit.z);
    }
};

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
Game.airStrikesAvailable = 1;  // Bonus charges

Game.callAirStrike = (x, z) => {
    if (Game.airStrikesAvailable <= 0) {
        Game.pushMessage('No air strikes available!', 2.0);
        return;
    }
    Game.airStrikesAvailable--;
    Game.pushMessage('Air strike called! Incoming in 3 seconds...', 3.0);
    Game.airStrikes.push({ x, z, delay: 3.0, shells: 10, done: false });
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
Game.addBlastFlash = (x, z, scale = 1) => {
    Game.muzzleFlashes = Game.muzzleFlashes || [];
    Game.muzzleFlashes.push({ x, z, r: 0.9 * scale, life: 0.2, total: 0.2, big: true, mesh: null });
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

Game.throwGrenade = (unit, x, z) => {
    if (!unit.alive || Game.isTank(unit.kind)) return;
    unit._grenades = unit._grenades ?? 3;
    if (unit._grenades <= 0) {
        Game.pushMessage('No grenades left!', 1.5);
        return;
    }
    const d = Game.dist(unit.x, unit.z, x, z);
    if (d > 8) {
        Game.pushMessage('Target too far for grenade!', 1.5);
        return;
    }
    unit._grenades--;
    // Blast after a brief delay
    setTimeout(() => {
        const blastR = 2.5;
        Game.units.forEach(u => {
            if (!u.alive) return;
            const bd = Game.dist(x, z, u.x, u.z);
            if (bd < blastR) {
                const falloff = 1 - bd / blastR;
                u.hp -= 25 * falloff;
                u.suppressionValue = Math.min(100, u.suppressionValue + 40 * falloff);
                u.shaken = 0.4;
                if (u.hp <= 0) {
                    u.alive = false;
                    u.hp = 0;
                    if (u.mesh) u.mesh.visible = false;
                }
            }
        });
        Game.smoke.push({
            x, z, r: 1.0, life: 0.8, total: 0.8,
            vx: Game.rand(-0.3, 0.3), vz: Game.rand(-0.8, -0.3),
            mesh: null,
        });
        Game.craters.push({ x, z, r: Game.rand(0.3, 0.6) });
        Game.cameraShake = Math.max(Game.cameraShake, 3);
        if (Game.Audio) Game.Audio.explosion(x, z);
        Game.addBlastFlash(x, z, 1.0);
    }, 600);
    Game.pushMessage('Grenade thrown!', 1.0);
};

// ═══════════════════════════════════════════════════════
//  SMOKE GRENADE SYSTEM
// ═══════════════════════════════════════════════════════

Game.smokeClouds = [];

Game.throwSmoke = (unit, x, z) => {
    if (!unit.alive || Game.isTank(unit.kind)) return;
    unit._smokeGrenades = unit._smokeGrenades ?? 2;
    if (unit._smokeGrenades <= 0) {
        Game.pushMessage('No smoke grenades left!', 1.5);
        return;
    }
    const d = Game.dist(unit.x, unit.z, x, z);
    if (d > 8) {
        Game.pushMessage('Target too far for smoke!', 1.5);
        return;
    }
    unit._smokeGrenades--;
    Game.smokeClouds.push({ x, z, radius: 4, life: 8.0 });
    Game.smoke.push({
        x, z, r: 2.5, life: 8.0, total: 8.0,
        vx: 0, vz: 0, mesh: null,
    });
    Game.pushMessage('Smoke deployed!', 1.5);
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
    Game.mines.push({ x: unit.x, z: unit.z, team: unit.team, armed: true });
    Game.pushMessage('Mine placed!', 1.0);
};

Game.updateMines = (dt) => {
    for (let i = Game.mines.length - 1; i >= 0; i--) {
        const mine = Game.mines[i];
        if (!mine.armed) continue;
        for (const u of Game.units) {
            if (!u.alive || u.team === mine.team || !Game.isTank(u.kind)) continue;
            const d = Game.dist(u.x, u.z, mine.x, mine.z);
            if (d < 1.5) {
                // Mine triggered!
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
                if (u.hp <= 0) {
                    u.alive = false;
                    u.hp = 0;
                    if (u.mesh) u.mesh.visible = false;
                }
                Game.mines.splice(i, 1);
                break;
            }
        }
    }
};

// ═══════════════════════════════════════════════════════
//  TOWING
// ═══════════════════════════════════════════════════════

Game.towUnit = (tower, target) => {
    if (!tower.alive || !target.alive) return;
    if (!Game.isTank(tower.kind)) return;
    if (target._towed) return;
    target._towed = true;
    target._towedBy = tower.id;
    target.path = [];
    target.moving = false;
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
};

Game.untowUnit = (target) => {
    if (!target._towed) return;
    target._towed = false;
    target._towedBy = null;
    Game.pushMessage(`${target.label} un-towed.`, 1.5);
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
    const tile = Game.getTileAtWorld(bx, bz);
    if (!tile || tile.type !== 'house') {
        Game.pushMessage('Must target a building!', 1.5);
        return;
    }
    unit._garrisoned = true;
    unit._garrisonPos = { x: bx, z: bz };
    unit.x = bx;
    unit.z = bz;
    unit.coverBonus = 0.9;
    unit.path = [];
    unit.moving = false;
    if (unit.mesh) unit.mesh.visible = false; // Hidden inside building
    Game.pushMessage(`${unit.label} garrisoned in building!`, 2.0);
};

Game.exitBuilding = (unit) => {
    if (!unit._garrisoned) return;
    unit._garrisoned = false;
    unit.coverBonus = 0;
    unit.x += Game.rand(-1.5, 1.5);
    unit.z += Game.rand(-1.5, 1.5);
    if (unit.mesh) unit.mesh.visible = true;
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

// ═══════════════════════════════════════════════════════
//  DOCTRINE / SKILL SYSTEM (SS4)
// ═══════════════════════════════════════════════════════

Game.DOCTRINES = {
    infantry: {
        name: 'Infantry',
        desc: '+20% infantry HP, +2 sight, +1 grenade',
        apply: () => {
            Game.units.forEach(u => {
                if (!u.alive || Game.isTank(u.kind)) return;
                u.maxHp = Math.round(u.maxHp * 1.2);
                u.hp = Math.min(u.hp, u.maxHp);
                u.sight += 2;
                u._grenades = (u._grenades || 3) + 1;
            });
        },
    },
    armor: {
        name: 'Armor',
        desc: '+15% vehicle HP, +10% speed, -20% fuel use',
        apply: () => {
            Game.units.forEach(u => {
                if (!u.alive || !Game.isTank(u.kind)) return;
                u.maxHp = Math.round(u.maxHp * 1.15);
                u.hp = Math.min(u.hp, u.maxHp);
                u.speed *= 1.1;
                u._fuelEfficiency = 0.8;
            });
        },
    },
    support: {
        name: 'Support',
        desc: '+1 air strike, +2 mines, +50% support range',
        apply: () => {
            Game.airStrikesAvailable = (Game.airStrikesAvailable || 1) + 1;
            Game.units.forEach(u => {
                if (!u.alive) return;
                if (u.supportType === 'sapper' || u.kind.includes('sapper')) {
                    u._mines = (u._mines || 2) + 2;
                }
                if (u.supportType) {
                    u.sight = Math.round(u.sight * 1.5);
                }
            });
        },
    },
};

Game.activeDoctrine = null;

Game.setDoctrine = (doctrineName) => {
    const doc = Game.DOCTRINES[doctrineName];
    if (!doc) return;
    Game.activeDoctrine = doctrineName;
    doc.apply();
    Game.pushMessage(`Doctrine activated: ${doc.name} — ${doc.desc}`, 5.0);
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
//  WATER ANIMATION
// ═══════════════════════════════════════════════════════

Game.updateWater = (dt) => {
    if (!Game.waterMesh) return;
    const t = Game.gameClock;
    const mat = Game.waterMesh.material;

    // Slow dual-direction normal map scrolling for organic surface
    if (mat.normalMap) {
        mat.normalMap.offset.x = t * 0.003;
        mat.normalMap.offset.y = t * 0.002;
    }
};

// ═══════════════════════════════════════════════════════
//  DYNAMIC LIGHTING & CLOUDS
// ═══════════════════════════════════════════════════════

Game.updateLighting = (dt) => {
    const t = Game.gameClock;
    const dynEnabled = document.getElementById('dbgDynLight')?.checked ?? true;

    const sunBase = Game._dbgSunBase ?? 2.4;
    const ambBase = Game._dbgAmbientBase ?? 1.4;
    const cloudBase = Game._dbgCloudBase ?? 0.18;

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

// Water level slider — updates water mesh Y position in real-time
const dbgWater = document.getElementById('dbgWater');
const dbgWaterVal = document.getElementById('dbgWaterVal');
if (dbgWater) {
    dbgWater.addEventListener('input', () => {
        const v = parseFloat(dbgWater.value);
        Game.WATER_LEVEL = v;
        dbgWaterVal.textContent = v.toFixed(2);
        if (Game.waterMesh) Game.waterMesh.position.y = v;
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

// ── Water controls ──
_dbgSlider('dbgWaterOpacity', 'dbgWaterOpacityVal', v => {
    if (Game.waterMesh) Game.waterMesh.material.opacity = v;
});

_dbgSlider('dbgWaterRough', 'dbgWaterRoughVal', v => {
    if (Game.waterMesh) Game.waterMesh.material.roughness = v;
});

_dbgSlider('dbgWaterNorm', 'dbgWaterNormVal', v => {
    if (Game.waterMesh) {
        Game.waterMesh.material.normalScale.set(v, v);
    }
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
            modelInner.position.y = v;
            wrapVal.textContent = v.toFixed(2);
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
        if (Game.waterMesh) Game.waterMesh.position.y = Game.WATER_LEVEL;
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
        Game.units.forEach(unit => Game.updateUnit(unit, dt));
        Game.updateSupportUnits(dt);
        if (Game.updateIndirectShells) Game.updateIndirectShells(dt);
        if (Game.updateAirStrikes) Game.updateAirStrikes(dt);
        if (Game.updateSmokeClouds) Game.updateSmokeClouds(dt);
        if (Game.updateTracers3D) Game.updateTracers3D(dt);
        if (Game.updateSmoke3D) Game.updateSmoke3D(dt);
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
        Game.updateWater(dt);
        Game.updateLighting(dt);
    } // end pause gate

    // Order markers animate even while paused (orders are issued during pause)
    if (Game.updateOrderMarkers) Game.updateOrderMarkers(dt);

    // Ambient + engine audio bed (runs regardless of pause)
    if (Game.Audio && Game.Audio.updateAmbient) Game.Audio.updateAmbient(dt);

    // Sync 3D meshes with game state
    Game.syncUnitMeshes(dt);

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
        cmdStop: () => { Game.selectedPlayerUnits().forEach(u => { u.path = []; u.moving = false; u.orderMode = 'hold'; u.forcedTargetId = null; u.bombardX = null; u.bombardZ = null; u._bombarding = false; }); Game.pushMessage('Units stopped.', 1.0); },
        cmdHold: () => { Game.selectedPlayerUnits().forEach(u => { u.orderMode = u.orderMode === 'hold' ? 'aggressive' : 'hold'; }); },
        cmdGrenade: () => { Game._commandMode = 'grenade'; Game.pushMessage('Grenade — right-click target.', 2.0); },
        cmdMove: () => { Game.setOrderStance('move'); },
        cmdSmoke: () => { Game._commandMode = 'smoke'; Game.pushMessage('Smoke — right-click target.', 2.0); },
        cmdAirStrike: () => { if (Game.airStrikesAvailable > 0) { Game._commandMode = 'airstrike'; Game.pushMessage('Click target for air strike...', 3.0); } else { Game.pushMessage('No air strikes available!', 2.0); } },
        cmdRotate: () => { Game._commandMode = 'rotate'; Game.pushMessage('Rotate — right-click direction.', 2.0); },
        cmdProne: () => { Game.toggleProneSelection(); },
    };
    Object.entries(cmdHandlers).forEach(([id, fn]) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    });

    // Init Three.js
    Game.initEngine();

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
    const doctrine = document.querySelector('.doc-btn.selected')?.dataset.doctrine || 'infantry';

    Game.selectedMission = mission;
    Game.selectedSide = side;
    Game.selectedDoctrine = doctrine;

    // Apply doctrine
    if (Game.setDoctrine) Game.setDoctrine(doctrine);

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

    Game.pushMessage(`Mission: ${mission.toUpperCase()} | Side: ${side.toUpperCase()} | Doctrine: ${doctrine.toUpperCase()}`, 5.0);
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

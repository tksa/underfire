/**
 * Under Fire — unit_modules.js
 * The per-unit update loop, factored into modules (mirrors the RWM engine's
 * unit-module split: frame / morale / health / supply / deploy / scan / fire /
 * move, with the AI "brain" living in ai.js). `Game.updateUnit` is a thin
 * orchestrator that runs a unit through these in order, passing a shared `ctx`.
 *
 * This is a behavior-preserving extraction of the former monolithic updateUnit:
 * each module is a verbatim block of that function. Adding a unit type is now a
 * matter of adding/overriding a module rather than editing one giant function.
 *
 * Loaded before main.js, which calls Game.updateUnit from the game loop.
 */

Game.uMod = {};

// Per-frame upkeep: cover value + decay the short-lived timers.
Game.uMod.frame = (unit, ctx) => {
    unit.coverBonus = unit._garrisoned ? (Game.GARRISON_COVER || 0.9) : Game.computeCover(unit);
    unit.cooldownLeft = Math.max(0, unit.cooldownLeft - ctx.dt);
    unit.underFire = Math.max(0, unit.underFire - ctx.dt);
    unit.shaken = Math.max(0, unit.shaken - ctx.dt);
    unit.stopTimer = Math.max(0, unit.stopTimer - ctx.dt);
    unit.orderDelay = Math.max(0, (unit.orderDelay || 0) - ctx.dt);
};

// Morale: a nearby friendly officer steadies the troops (RWM officerradius) —
// faster suppression recovery; suppression escalates stance under fire.
Game.uMod.morale = (unit, ctx) => {
    unit._steadied = Game.nearOfficer(unit);
    const recovery = (unit.underFire > 0 ? 4 : 11) * (unit._steadied ? 1.8 : 1);
    unit.suppressionValue = Math.max(0, unit.suppressionValue - recovery * ctx.dt);
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
};

// Health: engine-damage burn, and the green/yellow/red HP-status system with its
// speed effects. May set unit.alive=false (the orchestrator returns after).
Game.uMod.health = (unit, ctx) => {
    const dt = ctx.dt;
    const isVeh = ctx.isVeh;
    if (unit.engineDamaged && unit.alive) {
        unit.hp -= dt * 1.0;
        if (unit.hp <= 0) {
            unit.alive = false;
            unit.hp = 0;
            Game.pushMessage(`${unit.label} burned out!`, 2.0);
            if (unit.mesh) unit.mesh.visible = false;
        }
    }

    const hpPct = unit.hp / unit.maxHp;
    const base = Game.UNIT_STATS[unit.statKey];

    if (hpPct > 0.5) {
        unit._hpStatus = 'green';
        if (isVeh && unit._yellowDisabled && !unit.tracksDisabled) {
            unit.speed = base ? base.speed : unit.speed;
            unit._yellowDisabled = false;
        }
        if (!isVeh && unit._yellowSlow) {
            unit.speed = base ? base.speed : unit.speed;
            unit._yellowSlow = false;
        }
    } else if (hpPct > 0.2) {
        unit._hpStatus = 'yellow';
        unit.hp += dt / 3.0;
        if (unit.hp > unit.maxHp * 0.5) unit.hp = unit.maxHp * 0.5;
        if (isVeh && !unit._yellowDisabled) {
            unit._yellowDisabled = true;
            unit.speed = 0;
        }
        if (!isVeh && !unit._yellowSlow && base) {
            unit._yellowSlow = true;
            unit.speed = base.speed * 0.5;
        }
    } else if (unit.hp > 0) {
        unit._hpStatus = 'red';
        unit.hp -= dt / 3.0;
        if (unit.hp <= 0) {
            unit.alive = false;
            unit.hp = 0;
            Game.pushMessage(`${unit.label} bled out.`, 2.0);
            if (unit.mesh) unit.mesh.visible = false;
        }
    }
};

// Supply: infantry scavenge a little ammo while on the move.
Game.uMod.supply = (unit, ctx) => {
    if (!ctx.isVeh && unit.moving && unit.ammo >= 0) {
        unit._scavengeTimer = (unit._scavengeTimer || 0) + ctx.dt;
        if (unit._scavengeTimer >= 8) {
            unit._scavengeTimer = 0;
            unit.ammo++;
        }
    }
};

// Deploy / limber (RWM siege): crew-served guns set up to fire, pack up to move.
Game.uMod.deploy = (unit, ctx) => {
    if (!unit.deployable) return;
    unit._deployT = Math.max(0, (unit._deployT || 0) - ctx.dt);
    const wantsMove = !!(unit.path && unit.path.length > 0);
    if (wantsMove && unit.deployed && unit._deployT <= 0) {
        unit.deployed = false;
        unit._deployT = 1.0;
        if (Game.selection.has(unit.id)) Game.pushMessage(`${unit.label}: limbering up.`, 1.0);
    } else if (!wantsMove && !unit.deployed && unit._deployT <= 0) {
        unit.deployed = true;
        unit._deployT = 1.0;
    }
    unit._canMove = !unit.deployed && unit._deployT <= 0;
    unit._canFire = unit.deployed && unit._deployT <= 0;
};

// Scan: pick a target — player-forced first, else auto-acquire the nearest the
// team can see. A dead/gone forced target releases the commitment and halts.
// Sets ctx.enemy.
Game.uMod.scan = (unit, ctx) => {
    let enemy = null;
    // Manual "Rotate" facing in progress: hold the ordered bearing and don't let
    // an auto-acquired target spin the unit away from it.
    const facing = unit._faceAngle != null && (unit._faceUntil || 0) > Game.gameClock;
    if (unit.forcedTargetId != null) {
        const ft = Game.getUnitById(unit.forcedTargetId);
        if (ft && ft.alive && ft.team !== unit.team) {
            enemy = ft;
        } else {
            unit.forcedTargetId = null;
            unit.path = [];
            unit.moving = false;
            unit._pursueAnchor = null;
        }
    }
    // A holding or retreating unit (or one ordered to hold fire) doesn't go
    // looking for a fight.
    if (!enemy && !facing && !unit.holdFire && unit.orderMode !== 'hold' && unit.orderMode !== 'retreat') {
        const cand = Game.nearestEnemy(unit);
        // Target hysteresis: keep the current target through small distance
        // shuffles so the unit doesn't twitch back and forth between two roughly
        // equidistant enemies. Only switch when the current target is gone/unseen,
        // or a new one is clearly closer (>20%) AND we've held the current one for
        // a minimum dwell (kills the rapid retarget jitter).
        const cur = unit._engageId != null ? Game.getUnitById(unit._engageId) : null;
        const curValid = cur && cur.alive && cur.team !== unit.team && Game.unitCanSee(unit, cur)
            && Game.dist(unit.x, unit.z, cur.x, cur.z) <= unit.sight * 1.1;
        if (curValid && cand && cand.id !== cur.id) {
            const dCur = Game.distSq(unit.x, unit.z, cur.x, cur.z);
            const dCand = Game.distSq(unit.x, unit.z, cand.x, cand.z);
            const dwellOk = (Game.gameClock - (unit._targetSince || 0)) > 0.8;
            enemy = (dCand < dCur * 0.64 && dwellOk) ? cand : cur;  // 0.64 = 0.8² → ~20% closer
        } else {
            enemy = curValid ? cur : cand;
        }
    }
    // Sticky engagement: once a unit acquires a target it commits to it through a
    // brief sight/LOS flicker, instead of snapping to face it then spinning back
    // to neutral every frame at the edge of visibility (the "rotation jitter").
    // Firing is still line-of-sight gated in the fire module, so it won't shoot
    // blind — this only steadies facing/tracking.
    if (enemy) {
        if (unit._engageId !== enemy.id) unit._targetSince = Game.gameClock;  // stamp on real switch only
        unit._engageId = enemy.id;
        unit._engageTime = Game.gameClock;
    } else if (unit._engageId != null && unit.orderMode !== 'retreat' && !unit.holdFire && !facing
        && (Game.gameClock - (unit._engageTime || 0)) < 1.6) {
        const le = Game.getUnitById(unit._engageId);
        if (le && le.alive && le.team !== unit.team
            && Game.dist(unit.x, unit.z, le.x, le.z) <= unit.sight * 1.3) {
            enemy = le;
        } else {
            unit._engageId = null;
        }
    }
    unit.fireTargetId = enemy ? enemy.id : null;
    ctx.enemy = enemy;
};

// Attack-ground: fire on a commanded spot (mortars lob; direct-fire units take a
// firing position and suppress). Returns true when the unit is set and firing on
// the spot, so the orchestrator stops (no chasing/moving).
Game.uMod.bombard = (unit, ctx) => {
    const weaponDef0 = ctx.weaponDef0;
    if (weaponDef0 && unit.bombardX != null) {
        if (weaponDef0.fireType === 'indirect') Game.updateBombard(unit, ctx.dt, weaponDef0);
        else Game.updateGroundFire(unit, ctx.dt, weaponDef0);
        if (unit._bombarding) {
            unit.coverBonus = Game.computeCover(unit);
            return true;
        }
    }
    return false;
};

// Engage: close on a player-forced target until LOS+range (forced-target
// pursuit), and the assault-move "stop to engage, resume when clear" posture.
Game.uMod.engage = (unit, ctx) => {
    const enemy = ctx.enemy;
    const weaponDef0 = ctx.weaponDef0;
    const dt = ctx.dt;

    if (enemy && unit.forcedTargetId === enemy.id
        && weaponDef0 && weaponDef0.fireType !== 'indirect') {
        const dft = Game.dist(unit.x, unit.z, enemy.x, enemy.z);
        const sees = Game.unitCanSee(unit, enemy);
        const inRange = dft <= unit.range;
        // Hysteresis: once a firing position (in range + LOS) is reached, HOLD it
        // and only break to re-pursue if the target moves well outside range. This
        // kills the "twitch"/humping where an edge-of-range or flickering-LOS unit
        // toggled stop<->advance every frame.
        if (inRange && sees) unit._inFiringPos = true;
        else if (dft > unit.range * 1.18) unit._inFiringPos = false;

        if (unit._inFiringPos) {
            unit.path = [];
            unit.moving = false;
            unit.stopTimer = Math.max(unit.stopTimer || 0, 0.15);
        } else {
            unit._pursueTimer = (unit._pursueTimer || 0) - dt;
            // Require a meaningful target move (>5u) before re-pathing, and never
            // re-path faster than ~1.2s — removes the rapid re-plan jitter.
            const targetMoved = !unit._pursueAnchor
                || Game.distSq(unit._pursueAnchor.x, unit._pursueAnchor.z, enemy.x, enemy.z) > 25;
            if (!unit.moving || unit._pursueTimer <= 0 || targetMoved) {
                unit._pursueTimer = 1.2;
                unit._pursueAnchor = { x: enemy.x, z: enemy.z };
                const goalDist = Math.max(2, Math.min(unit.range * 0.85, dft * 0.6));
                const ang = Game.angleTo(enemy.x, enemy.z, unit.x, unit.z);
                const gx = Game.clamp(enemy.x + Math.cos(ang) * goalDist, 1, Game.WORLD_W - 1);
                const gz = Game.clamp(enemy.z + Math.sin(ang) * goalDist, 1, Game.WORLD_H - 1);
                unit.path = Game.findPath(unit, unit.x, unit.z, gx, gz);
                unit.moving = true;
                unit.stopTimer = 0;
            }
        }
    } else {
        unit._inFiringPos = false;
    }

    if (unit.orderMode === 'assault' && enemy && unit.path && unit.path.length) {
        const d = Game.dist(unit.x, unit.z, enemy.x, enemy.z);
        if (d <= unit.range * 0.95) {
            unit.path = [];               // clear the path so it doesn't keep stepping
            unit.moving = false;
            unit.stopTimer = Math.max(unit.stopTimer || 0, 0.6);
        }
    }

    // Attack-move RESUME: when the local fight is over (no target in view) and the
    // unit isn't already routed, push on to the ordered destination instead of
    // halting where the last enemy fell. This is what gets tanks + infantry all the
    // way to the red circle after they've cleared resistance on the way.
    if (unit.orderMode === 'assault' && unit._assaultGoal && !enemy
        && (unit.stopTimer || 0) <= 0 && (!unit.path || !unit.path.length)) {
        if (Game.dist(unit.x, unit.z, unit._assaultGoal.x, unit._assaultGoal.z) > 2.2) {
            unit.path = Game.findPath(unit, unit.x, unit.z, unit._assaultGoal.x, unit._assaultGoal.z);
            unit.moving = true;
        } else {
            unit._assaultGoal = null;     // arrived at the ordered spot
        }
    }
};

// Fire: turret/weapon tracking and shooting. Sets ctx.hasTurret /
// ctx.aimAngleToEnemy (the move module reads them for turret tracking on the go).
Game.uMod.fire = (unit, ctx) => {
    const enemy = ctx.enemy;
    const dt = ctx.dt;
    const isVeh = ctx.isVeh;
    const canFire = !unit.holdFire && !(Game.isTank(unit.kind) && unit.turretDamaged);
    const hasTurret = isVeh && unit.hasTurret;
    const aimAngleToEnemy = enemy ? Game.angleTo(unit.x, unit.z, enemy.x, enemy.z) : null;
    ctx.hasTurret = hasTurret;
    ctx.aimAngleToEnemy = aimAngleToEnemy;

    if (canFire && enemy && Game.unitCanSee(unit, enemy)) {
        const d = Game.dist(unit.x, unit.z, enemy.x, enemy.z);

        if (d <= unit.range) {
            let ready = unit._combatReady !== false;
            if (!ready) {
                unit._readyTimer = (unit._readyTimer || 0) + dt;
                if (unit._readyTimer >= (Game.isTank(unit.kind) ? 1.8 : 1.2)) {
                    unit._combatReady = true;
                    ready = true;
                }
            }
            if (unit.deployable && !unit._canFire) ready = false;
            if (hasTurret) {
                const tRot = Game.rotateWithInertia(
                    unit.turretAngle, unit.turretAngVel, aimAngleToEnemy,
                    unit.turretRotSpeed, unit.turretAccel, dt
                );
                unit.turretAngle = tRot.angle;
                unit.turretAngVel = tRot.angVel;
                const turretAligned = Math.abs(Game.angleDiff(unit.turretAngle, aimAngleToEnemy)) < 0.15;

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
                // Infantry: turn the body toward the target at a finite rate
                // instead of snapping instantly each frame. A hard snap is what
                // made riflemen visibly twitch when a target shifted or when two
                // enemies were near-equidistant. ~8 rad/s is quick but smooth.
                unit.angle = Game.rotateTo(unit.angle, aimAngleToEnemy, 8 * dt);
                unit.turretAngle = unit.angle;
                if (ready && unit.cooldownLeft <= 0) {
                    Game.applyShot(unit, enemy);
                    const xpReloadMod = 1 - (unit.experience || 0) * 0.0015;
                    unit.cooldownLeft = unit.cooldown * Game.clamp(1 + unit.suppressionValue / 160, 0.6, 1.8) * xpReloadMod;
                }
            }
        }
    } else if (hasTurret && !unit.moving) {
        const tRot = Game.rotateWithInertia(
            unit.turretAngle, unit.turretAngVel, unit.angle,
            unit.turretRotSpeed * 0.5, unit.turretAccel * 0.5, dt
        );
        unit.turretAngle = tRot.angle;
        unit.turretAngVel = tRot.angVel;
    }
};

// Move: speed modifiers, path-following, vehicle differential drive + reverse,
// infantry locomotion, fuel, separation, world clamp, blocked-tile revert, and
// terrain-height follow.
Game.uMod.move = (unit, ctx) => {
    const dt = ctx.dt;
    const isVeh = ctx.isVeh;
    const isTruck = unit.kind === 'fuel' || unit.kind === 'supply';   // wheeled, bicycle-model steering
    const enemy = ctx.enemy;
    const hasTurret = ctx.hasTurret;
    const aimAngleToEnemy = ctx.aimAngleToEnemy;
    const prevX = ctx.prevX, prevZ = ctx.prevZ;

    let maxSpeed = unit.speed;

    if (!isVeh && !isTruck) {
        const speedFactor = Game.clamp(1 - unit.suppressionValue / 135, 0.3, 1);
        const STANCE_SPEED = { prone: 0.28, crouch: 0.55, stand: 1.0, run: 1.5, ease: 1.0, rest: 0.0 };
        maxSpeed *= 0.6 * speedFactor * (STANCE_SPEED[unit.stance] ?? 1.0);

        const tile = Game.getTileAtWorld(unit.x, unit.z);
        if (tile) {
            if (tile.type === 'road') maxSpeed *= 1.2;
            else if (tile.type === 'mud' || tile.type === 'forest') maxSpeed *= 0.7;
            else if (tile.type === 'wheat') maxSpeed *= 0.9;
            else if (tile.type === 'dense_forest') maxSpeed *= 0.3;
            else if (tile.type === 'swamp') maxSpeed *= 0.4;
        }

        if (Game.getWeatherSpeedMod) maxSpeed *= Game.getWeatherSpeedMod();
    }

    if (isVeh && (unit.fuel === 0 || unit.tracksDisabled)) {
        maxSpeed = 0;
    }

    if ((isVeh || isTruck) && Game.getTerrainSlope) {
        const slope = Game.getTerrainSlope(unit.x, unit.z);
        maxSpeed *= Game.clamp(1 - slope * 1.5, 0.45, 1);
    }

    if (unit.entrenched) {
        maxSpeed = 0;
    }

    // Combined-movement: while moving as a group, hold the slowest member's pace so
    // armor and trucks don't outrun the infantry they set off with. Applied AFTER
    // the per-unit modifiers (infantry carry a hidden 0.6 foot factor that vehicles
    // don't), so _groupSpeed is an EFFECTIVE speed and the cap actually bites on the
    // fast units while leaving the slowest unit (already at that pace) untouched.
    if (unit._groupMoveActive && unit._groupSpeed && unit.path && unit.path.length && maxSpeed > 0) {
        maxSpeed = Math.min(maxSpeed, unit._groupSpeed);
    }

    // Yield to units crossing the lane: a tank eases off / halts for troops moving
    // across its nose, then resumes once they've passed (so it respects their path
    // instead of grinding through them). Standing men are scattered by make-way.
    if (isVeh && maxSpeed > 0 && Game._tankYield) maxSpeed *= Game._tankYield(unit);

    // Insert/refresh a side-step waypoint to route around any tank blocking the
    // lane ahead (dynamic obstacle avoidance) before we read the next waypoint.
    // Runs for tanks, trucks and infantry so foot troops walk AROUND a hull
    // instead of marching on the spot against it.
    if (Game._vehicleAvoid) Game._vehicleAvoid(unit);

    if (unit.path && unit.path.length && unit.stopTimer <= 0 && (unit.orderDelay || 0) <= 0
        && (!unit.deployable || unit._canMove)) {
        let next = unit.path[0];
        let dx = next.x - unit.x;
        let dz = next.z - unit.z;
        let d = Math.hypot(dx, dz);

        const arrivalDist = (isVeh || isTruck) ? 1.5 : 0.4;

        // SETTLE WHEN CROWDED: a foot soldier elbowed out of his exact formation slot
        // by friendlies can't reach the tight 0.4 arrival radius and would shuffle on
        // the spot forever (the clump-and-circle look). On his final leg, near the
        // slot, if he STOPS CLOSING the distance for a moment (blocked), call it
        // arrived. Progress-based so it ignores speed bouncing against neighbours; a
        // lone unit keeps closing the gap and arrives precisely as normal.
        if (!isVeh && !isTruck && unit.path.length === 1 && d < 3.2) {
            if (unit._lastGoalD != null && d > unit._lastGoalD - 0.05) {
                unit._settleT = (unit._settleT || 0) + dt;
                if (unit._settleT > 0.6) {
                    unit.path.length = 0; unit.moving = false;
                    unit._settleT = 0; unit._groupMoveActive = false;
                }
            } else {
                unit._settleT = 0;
            }
            unit._lastGoalD = d;
        } else {
            unit._settleT = 0; unit._lastGoalD = null;
        }

        while (unit.path.length && d < arrivalDist) {
            unit.path.shift();

            if (isVeh || isTruck) {
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
                unit._groupMoveActive = false;        // arrived — release the group pace cap
                if (unit._reverseMove) { unit.currentSpeed = 0; unit._reversing = false; }  // stop dead, no forward lurch
                unit._reverseMove = false;            // reverse-into-spot done
                unit.currentSpeed = Math.max(0, unit.currentSpeed - maxSpeed * 0.8 * dt);
                break;
            }

            next = unit.path[0];
            dx = next.x - unit.x;
            dz = next.z - unit.z;
            d = Math.hypot(dx, dz);
        }

        if (unit.path.length) {
            const ang = Math.atan2(dz, dx);
            const isLastWaypoint = unit.path.length === 1;

            if (isVeh) {
                // Reverse-retreat: a falling-back tank keeps its front toward the
                // threat and backs away toward the waypoint (only at close range;
                // farther out it just turns and drives normally).
                const reverseRetreat = unit.retreating && unit._retreatThreat
                    && Game.dist(unit.x, unit.z, unit._retreatThreat.x, unit._retreatThreat.z) < 45;
                if (reverseRetreat) {
                    const faceAng = Game.angleTo(unit.x, unit.z, unit._retreatThreat.x, unit._retreatThreat.z);
                    unit.angle = Game.rotateTo(unit.angle, faceAng, unit.rotationSpeed * dt);
                    const revSpeed = maxSpeed * 0.5;
                    const step = Math.min(revSpeed * dt, d);
                    unit.x += Math.cos(ang) * step;
                    unit.z += Math.sin(ang) * step;
                    unit.currentSpeed = revSpeed;
                    unit._reversing = true;
                    unit.turretAngle = hasTurret ? faceAng : unit.angle;
                    unit.moving = true;
                    unit._trackDist = (unit._trackDist || 0) + step;
                    if (unit._trackDist > 1.2) {
                        unit._trackDist = 0;
                        Game.trackMarks = Game.trackMarks || [];
                        Game.trackMarks.push({ x: unit.x, z: unit.z, angle: unit.angle, size: unit.size, team: unit.team, life: 15.0, total: 15.0, mesh: null });
                    }
                } else if (unit._reverseMove) {
                    // Short backward move: the destination is close and behind, so
                    // reverse straight into it instead of turning the hull around.
                    // Keep the nose roughly where it is (rear tracks toward the goal).
                    const revAng = ang + Math.PI;                         // heading that aims our REAR at the waypoint
                    unit.angle = Game.rotateTo(unit.angle, revAng, unit.rotationSpeed * 0.6 * dt);
                    const revSpeed = maxSpeed * 0.45;
                    unit.currentSpeed = Math.min(revSpeed, (unit.currentSpeed || 0) + maxSpeed * 0.5 * dt);
                    const step = Math.min(unit.currentSpeed * dt, d);
                    // Back straight up along the hull's OWN axis (rear-first). Translating
                    // toward the goal bearing instead lets the body slide sideways while it's
                    // still turning — that decoupled slide is the "not reversing properly"
                    // look. The hull steers so its rear lines up on the waypoint; the motion
                    // always follows the heading, matching the coast block below.
                    unit.x -= Math.cos(unit.angle) * step;
                    unit.z -= Math.sin(unit.angle) * step;
                    unit.turretAngle = (hasTurret && enemy && aimAngleToEnemy !== null) ? aimAngleToEnemy : unit.angle;
                    unit._reversing = true;
                    unit.moving = true;
                    unit._trackDist = (unit._trackDist || 0) + step;
                    if (unit._trackDist > 1.2) {
                        unit._trackDist = 0;
                        Game.trackMarks = Game.trackMarks || [];
                        Game.trackMarks.push({ x: unit.x, z: unit.z, angle: unit.angle, size: unit.size, team: unit.team, life: 15.0, total: 15.0, mesh: null });
                    }
                } else {
                const angleDelta = Game.angleDiff(unit.angle, ang);
                const absAngleDelta = Math.abs(angleDelta);

                const speedRatio = unit.currentSpeed / (maxSpeed || 1);
                const turnMomentumFactor = Game.clamp(1.0 - (speedRatio * 0.6), 0.4, 1.0);
                const pivotBoost = (absAngleDelta > 0.5 && speedRatio < 0.2) ? 1.3 : 1.0;
                const turnSpeed = unit.rotationSpeed * turnMomentumFactor * pivotBoost;

                unit.angle = Game.rotateTo(unit.angle, ang, turnSpeed * dt);

                let targetSpeed = 0;

                if (absAngleDelta < Math.PI / 2) {
                    const cosA = Math.cos(absAngleDelta);
                    const alignment = Math.max(0, Math.pow(cosA, 3));
                    targetSpeed = maxSpeed * alignment;
                } else {
                    targetSpeed = 0;
                }

                const accelRate = maxSpeed * 0.5;
                const brakeRate = maxSpeed * 1.2;

                if (unit.currentSpeed < targetSpeed) {
                    unit.currentSpeed = Math.min(targetSpeed, unit.currentSpeed + accelRate * dt);
                } else {
                    unit.currentSpeed = Math.max(targetSpeed, unit.currentSpeed - brakeRate * dt);
                }

                if (isLastWaypoint && d < 3.0) {
                    unit.currentSpeed = Math.min(
                        unit.currentSpeed, maxSpeed * (d / 3.0));
                }

                const step = Math.min(unit.currentSpeed * dt, d);
                if (step > 0.001) {
                    unit.x += Math.cos(unit.angle) * step;
                    unit.z += Math.sin(unit.angle) * step;

                    unit._trackDist = (unit._trackDist || 0) + step;
                    if (unit._trackDist > 1.2) {
                        unit._trackDist = 0;
                        Game.trackMarks = Game.trackMarks || [];
                        Game.trackMarks.push({
                            x: unit.x, z: unit.z,
                            angle: unit.angle,
                            size: unit.size,
                            team: unit.team,
                            life: 15.0, total: 15.0,
                            mesh: null
                        });
                    }
                }

                unit._reversing = false;
                if (absAngleDelta > 2.0 && d < 5 && step < 0.001) {
                    unit._reversing = true;
                    const revSpeed = maxSpeed * 0.25;
                    const revStep = Math.min(revSpeed * dt, d);
                    unit.x += Math.cos(ang) * revStep;
                    unit.z += Math.sin(ang) * revStep;
                    unit.currentSpeed = revSpeed;

                    unit._trackDist = (unit._trackDist || 0) + revStep;
                    if (unit._trackDist > 1.2) {
                        unit._trackDist = 0;
                        Game.trackMarks = Game.trackMarks || [];
                        Game.trackMarks.push({
                            x: unit.x, z: unit.z,
                            angle: unit.angle,
                            size: unit.size,
                            team: unit.team,
                            life: 15.0, total: 15.0,
                            mesh: null
                        });
                    }
                }

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
                    const turretOff = Math.abs(Game.angleDiff(unit.turretAngle, unit.angle));
                    if (turretOff < 0.08) {
                        unit.turretAngle = unit.angle;
                        unit.turretAngVel = 0;
                    } else {
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
                } // end normal differential drive (else of reverseRetreat)

            } else if (isTruck && unit._reverseMove) {
                // Short backward move: reverse the truck straight into a close spot
                // behind it rather than swinging the whole lorry around.
                const revAng = ang + Math.PI;
                unit.angle = Game.rotateTo(unit.angle, revAng, (unit.rotationSpeed || 2) * 0.4 * dt);
                const revSpeed = maxSpeed * 0.4;
                unit.currentSpeed = Math.min(revSpeed, (unit.currentSpeed || 0) + maxSpeed * 0.5 * dt);
                const step = Math.min(unit.currentSpeed * dt, d);
                // Back straight up along the hull's own axis (rear-first) so the lorry
                // reverses instead of sliding toward the spot while still turning.
                unit.x -= Math.cos(unit.angle) * step;
                unit.z -= Math.sin(unit.angle) * step;
                unit.turretAngle = unit.angle;
                unit._reversing = true;
                unit.moving = true;
                unit._trackDist = (unit._trackDist || 0) + step;
                if (unit._trackDist > 1.5) {
                    unit._trackDist = 0;
                    Game.trackMarks = Game.trackMarks || [];
                    Game.trackMarks.push({ x: unit.x, z: unit.z, angle: unit.angle, size: unit.size, team: unit.team, life: 15.0, total: 15.0, mesh: null });
                }
            } else if (isTruck) {
                // Wheeled steering (kinematic bicycle model). Heading only changes
                // while rolling, turn rate ∝ speed and capped steering angle, so the
                // truck arcs round like a real lorry — no spin-in-place, no instant
                // snap. dθ = (v / wheelbase) · tan(steer) · dt.
                const headErr = Game.angleDiff(unit.angle, ang);   // signed bearing error
                const MAX_STEER = Game.TRUCK_MAX_STEER ?? 0.5;     // ~29° max wheel angle
                // Wheelbase (turn radius) scales with the truck's VISUAL size: a
                // model drawn larger (the 2x fuel truck) then arcs on a
                // proportionally bigger radius, matching the supply truck's
                // turn-radius-per-length instead of pivoting tightly on the spot —
                // that tight pivot under a long body is what read as "drifting".
                const mScale = (Game.MODEL_SCALE && Game.MODEL_SCALE[unit.team + '_' + unit.kind]) || 1;
                const WHEELBASE = Math.max(0.8, (unit.size || 0.85) * (Game.TRUCK_WHEELBASE ?? 3.2) * mScale);
                const steer = Game.clamp(headErr, -MAX_STEER, MAX_STEER);

                // Smooth accel/brake; ease off for sharp turns and on approach, but
                // keep rolling (floor) so turns don't crawl.
                let targetSpeed = maxSpeed * Game.clamp(1 - Math.abs(headErr) / 1.8, 0.30, 1);
                if (isLastWaypoint && d < 4) targetSpeed = Math.min(targetSpeed, maxSpeed * (d / 4));
                const accelRate = maxSpeed * (Game.TRUCK_ACCEL ?? 0.6);
                const brakeRate = maxSpeed * 1.5;
                if (unit.currentSpeed < targetSpeed) unit.currentSpeed = Math.min(targetSpeed, unit.currentSpeed + accelRate * dt);
                else unit.currentSpeed = Math.max(targetSpeed, unit.currentSpeed - brakeRate * dt);

                unit.angle += (unit.currentSpeed / WHEELBASE) * Math.tan(steer) * dt;
                // Slow-turn assist: while easing through a sharp turn, add a little
                // reorientation so it doesn't crawl/orbit a target that's well off-axis.
                // Scaled down for long (large-model) trucks so it eases the wheel
                // rather than visibly pivoting the body in place.
                if (unit.currentSpeed < maxSpeed * 0.45 && Math.abs(headErr) > 0.9) {
                    unit.angle = Game.rotateTo(unit.angle, ang, unit.rotationSpeed * 0.5 / mScale * dt);
                }
                unit.turretAngle = unit.angle;

                const step = unit.currentSpeed * dt;
                if (step > 0.001) {
                    unit.x += Math.cos(unit.angle) * step;
                    unit.z += Math.sin(unit.angle) * step;
                    unit._trackDist = (unit._trackDist || 0) + step;
                    if (unit._trackDist > 1.5) {
                        unit._trackDist = 0;
                        Game.trackMarks = Game.trackMarks || [];
                        Game.trackMarks.push({ x: unit.x, z: unit.z, angle: unit.angle, size: unit.size, team: unit.team, life: 15.0, total: 15.0, mesh: null });
                    }
                }
                unit.moving = true;
            } else {
                const turnRate = unit.rotationSpeed;
                unit.angle = Game.lerpAngle(unit.angle, ang, Game.clamp(turnRate * dt, 0, 1));

                unit.turretAngle = unit.angle;

                unit.currentSpeed = maxSpeed;

                const step = Math.min(unit.currentSpeed * dt, d);
                unit.x += Math.cos(unit.angle) * step;
                unit.z += Math.sin(unit.angle) * step;
                unit.moving = true;
            }

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
        if (unit.currentSpeed > 0.01) {
            const coastRate = isVeh ? maxSpeed * 0.8 : maxSpeed * 3.0;
            unit.currentSpeed = Math.max(0, unit.currentSpeed - coastRate * dt);
            if (isVeh) {
                // Coast in the direction we were actually travelling — a reversing
                // tank must not lurch FORWARD on its residual momentum when it stops.
                const dir = unit._reversing ? -1 : 1;
                unit.x += Math.cos(unit.angle) * unit.currentSpeed * dt * dir;
                unit.z += Math.sin(unit.angle) * unit.currentSpeed * dt * dir;
            }
        } else {
            unit.currentSpeed = 0;
            unit._reversing = false;
        }

        // Manual "Rotate" order: turn in place toward the ordered bearing. Tanks
        // swing hull (and turret); infantry/guns pivot. Cleared once aligned.
        if (unit._faceAngle != null) {
            if (isVeh) {
                unit.angle = Game.rotateTo(unit.angle, unit._faceAngle, unit.rotationSpeed * dt);
                if (hasTurret) {
                    const tRot = Game.rotateWithInertia(
                        unit.turretAngle, unit.turretAngVel, unit._faceAngle,
                        unit.turretRotSpeed, unit.turretAccel, dt);
                    unit.turretAngle = tRot.angle;
                    unit.turretAngVel = tRot.angVel;
                } else {
                    unit.turretAngle = unit.angle;
                }
            } else {
                unit.angle = Game.lerpAngle(unit.angle, unit._faceAngle,
                    Game.clamp(unit.rotationSpeed * dt, 0, 1));
                unit.turretAngle = unit.angle;
            }
            const hullSet = Math.abs(Game.angleDiff(unit.angle, unit._faceAngle)) < 0.04;
            const turretSet = !hasTurret || Math.abs(Game.angleDiff(unit.turretAngle, unit._faceAngle)) < 0.06;
            if ((hullSet && turretSet) || (unit._faceUntil || 0) <= Game.gameClock) {
                unit._faceAngle = null;
                unit._faceUntil = 0;
            }
        }
    }

    Game.applySeparation(unit, dt);

    unit.x = Game.clamp(unit.x, 0.5, Game.WORLD_W - 0.5);
    unit.z = Game.clamp(unit.z, 0.5, Game.WORLD_H - 0.5);

    const tileNow = Game.getTileAtWorld(unit.x, unit.z);
    if (tileNow && (tileNow.blocked || (isVeh && tileNow.vehicleBlocked))) {
        unit.x = prevX;
        unit.z = prevZ;
        unit.currentSpeed = 0;
    }

    if (isVeh && Game.getVehicleHeight) {
        unit.y = Game.getVehicleHeight(unit.x, unit.z, unit.size, unit.angle);
    } else {
        unit.y = Game.getHeight(unit.x, unit.z);
    }

    // Retreat ends on arrival: drop the flag; a player retreat settles into hold.
    if (unit.retreating && (!unit.path || !unit.path.length)) {
        unit.retreating = false;
        unit._retreatThreat = null;
        if (unit.orderMode === 'retreat') unit.orderMode = 'hold';
    }
};

/**
 * Per-unit update — the orchestrator. Runs the modules in order through a shared
 * ctx. (Towed guns and passengers are driven by their tower/carrier, so skip.)
 */
Game.updateUnit = (unit, dt) => {
    if (!unit.alive) return;
    if (unit._towed || unit._inVehicle != null) return;

    const M = Game.uMod;
    const ctx = {
        dt,
        prevX: unit.x, prevZ: unit.z,
        isVeh: Game.isTank(unit.kind),
        enemy: null,
        weaponDef0: Game.WEAPONS[unit.weaponKey],
        hasTurret: false,
        aimAngleToEnemy: null,
    };

    M.frame(unit, ctx);
    M.morale(unit, ctx);
    M.health(unit, ctx);
    if (!unit.alive) return;

    // Garrisoned infantry hold their position and fire from the windows: they
    // acquire + shoot (longer sight/range, hard cover) but never move or pursue.
    if (unit._garrisoned) {
        unit.path = []; unit.moving = false;
        M.scan(unit, ctx);
        M.fire(unit, ctx);
        return;
    }

    // Ordered into a building: follow the order — march to it and do NOT peel off
    // to engage enemies on the way (no acquisition, no firing). They fight once
    // inside. updateBuildingEntry garrisons them on arrival.
    if (unit._enterRec) {
        unit.fireTargetId = null; unit._engageId = null; unit.forcedTargetId = null;
        if ((!unit.path || !unit.path.length) && Game._footprintDistSq
            && Game._footprintDistSq(unit._enterRec, unit.x, unit.z) > 6.25) {
            const rec = unit._enterRec;
            // Re-path to the nearest door (face midpoint) rather than the closest
            // arbitrary wall point, so they head for a real entrance.
            let np;
            if (Game.buildingDoors) {
                const doors = Game.buildingDoors(rec);
                np = doors.reduce((best, p) => {
                    const d = (p.x - unit.x) ** 2 + (p.z - unit.z) ** 2;
                    return (!best || d < best._d) ? { x: p.x, z: p.z, _d: d } : best;
                }, null);
            }
            if (!np) np = Game.buildingNearPoint ? Game.buildingNearPoint(rec, unit.x, unit.z) : { x: rec.cx, z: rec.cz };
            unit.path = Game.findPath(unit, unit.x, unit.z, np.x, np.z);
            unit.moving = true;
        }
        M.move(unit, ctx);
        return;
    }

    M.supply(unit, ctx);
    M.deploy(unit, ctx);
    M.scan(unit, ctx);
    if (M.bombard(unit, ctx)) return;
    M.engage(unit, ctx);
    if (unit.team === Game.TEAM.GERMAN) Game.updateAI(unit, dt, ctx.enemy);
    M.fire(unit, ctx);
    // Idle/ambient posture (rest, at-ease, ready). Runs just before move so a
    // roused soldier is on his feet before the move module reads his stance.
    if (M.ambient) M.ambient(unit, ctx);
    M.move(unit, ctx);
};

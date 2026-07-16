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

// Preserve every outstanding player waypoint through a truck's deliberate
// reverse. A recovery used to remember only path[last], silently skipping the
// first Shift-queued destination. `_orderStop` is attached by issueCommand; paths
// created by AI/legacy callers fall back to their final node.
Game._captureTruckRecovery = (unit, extras = null) => {
    const route = (unit.path || []).filter(p => !p._detour);
    const last = route[route.length - 1] || { x: unit.x, z: unit.z };
    const stops = route.filter(p => p._orderStop).map(p => ({
        ...p._orderStop,
        _pathAngle: p._pathAngle ?? p._orderStop._pathAngle,
    }));
    if (!stops.length) stops.push({ x: last.x, z: last.z });
    return {
        goal: { x: stops[stops.length - 1].x, z: stops[stops.length - 1].z },
        stops,
        ...(extras || {}),
    };
};

Game._restoreTruckRecovery = (unit, recovery) => {
    const stops = recovery && recovery.stops && recovery.stops.length
        ? recovery.stops
        : [recovery.goal];
    let fromX = unit.x, fromZ = unit.z, fromAngle = unit.angle || 0;
    const rebuilt = [];
    for (const stop of stops) {
        const leg = Game.findPath(unit, fromX, fromZ, stop.x, stop.z, fromAngle);
        if (!leg.length) {
            if (Game.dist(fromX, fromZ, stop.x, stop.z) <= 1.5) continue;
            return [];
        }
        leg[leg.length - 1]._orderStop = { ...stop };
        rebuilt.push(...leg);
        const end = leg[leg.length - 1];
        fromAngle = end._pathAngle ?? Math.atan2(end.z - fromZ, end.x - fromX);
        fromX = end.x; fromZ = end.z;
    }
    return rebuilt;
};

// German Mokra attackers own validated authored corridors, so their recovery
// rebuilds the forward remainder in milliseconds. Every other vehicle's
// recovery search goes through the route QUEUE with a reduced node budget:
// a jam of stuck hulls used to fire one full synchronous heading-A* each per
// stall tick — long frames made the stall timers fire faster, and the churn
// fed itself (the profiled ~600 ms frames after a mass order into a corner).
// Callers receive [] immediately and the route lands when computed; a failed
// search backs the unit off recovery for several seconds instead of retrying
// the same impossible goal every stall tick.
Game._vehicleRecoveryRoute = (unit, goal, reason) => {
    const isMokraAttacker = unit._mokraAuthoredAttacker
        && Game.currentScenario === 'mokra'
        && unit.team === Game.TEAM.GERMAN
        && Game._recoverMokraVehicleRoute;
    if (isMokraAttacker) {
        return Game._recoverMokraVehicleRoute(unit, goal.x, goal.z, reason);
    }
    if (Game.queueVehiclePath) {
        Game.queueVehiclePath(unit, goal.x, goal.z, (path) => {
            unit.path = path;
            unit.moving = path.length > 0;
            if (path.length) {
                unit._detour = null;
            } else {
                unit._recoveryBlockedUntil = (Game.gameClock || 0) + 4 + Game.rand(0, 4);
            }
        }, null, 9000);
        return [];
    }
    return Game.findPath(unit, unit.x, unit.z, goal.x, goal.z);
};

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
    if (!Game.isTank(unit.kind)
        && !(Game.isMountedCavalry && Game.isMountedCavalry(unit))) {
        if (unit.suppressionValue > 88) {
            if (unit.stance !== 'prone') { unit.stance = 'prone'; unit._autoStance = true; }
        } else if (unit.suppressionValue > 62) {
            if (unit.stance === 'stand' || unit.stance === 'run') { unit.stance = 'crouch'; unit._autoStance = true; }
        } else if (unit.suppressionValue < 30 && unit._autoStance
            && (unit.underFire || 0) <= 0
            && (Game.gameClock - (unit._threatTime || -1e9)) > 3) {
            // Recover to standing only once genuinely calm. Recovering on low
            // suppression alone fought the AI's deliberate combat crouch every
            // think tick — men flickered crouch->stand->crouch twice a second
            // (the "repeating animation" stutter) all through a firefight.
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
    const wantsMove = !!(unit.path && unit.path.length > 0)
        || unit._towApproachGunId != null;   // approaching a hook-up: stay limbered
    if (wantsMove && unit.deployed && unit._deployT <= 0) {
        unit.deployed = false;
        unit._deployT = 1.0;
        if (Game.selection.has(unit.id)) Game.pushMessage(`${unit.label}: limbering up.`, 1.0);
    } else if (!wantsMove && !unit.deployed && unit._deployT <= 0) {
        unit.deployed = true;
        unit._deployT = 1.0;
    }
    // An unmanned gun (crew dismounted as real infantry) neither moves nor
    // fires until soldiers re-man it.
    unit._canMove = !unit.deployed && unit._deployT <= 0 && !unit._unmanned;
    unit._canFire = unit.deployed && unit._deployT <= 0 && !unit._unmanned;
};

// Unforced perception is deliberately staggered. At 60 fps, asking every unit
// to search every enemy and ray-walk LOS every frame grows quadratically with a
// battle. A 0.14-0.20s cadence is still tactically immediate (5-7 scans/sec),
// while the id-derived phase prevents a freshly spawned wave scanning in lockstep.
Game._targetScanPhase = (unit) => {
    const id = Number(unit.id) || 0;
    return ((id * 0.6180339887498949) % 1 + 1) % 1;
};

Game._targetScanInterval = (unit) => 0.14 + Game._targetScanPhase(unit) * 0.06;

// Squad AI consumes this same sighting instead of independently running another
// nearest-enemy search. Object references are safe here: unit records persist for
// corpses/wrecks, and the alive/team checks invalidate them without an O(N) id scan.
Game.getCachedScanEnemy = (unit, maxAge = 0.45) => {
    const enemy = unit._scanEnemy;
    if (!enemy || !enemy.alive || enemy.team === unit.team) return null;
    const scannedAt = unit._targetScanTime;
    if (scannedAt == null || (Game.gameClock - scannedAt) > maxAge) return null;
    return enemy;
};

// Scan: pick a target — player-forced first, else auto-acquire the nearest the
// team can see. A dead/gone forced target releases the commitment and halts.
// Unforced searches/LOS validation run on the staggered cadence above; the chosen
// target is retained between scans, while firing still validates LOS every frame.
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
        const now = Game.gameClock;
        let cached = unit._scanEnemy;
        const cachedInvalid = cached && (!cached.alive || cached.team === unit.team);

        if (unit._nextTargetScanAt == null) {
            // Initial delay is the phase itself, not a full interval: the whole
            // force is covered within ~0.2s without a first-frame LOS spike.
            unit._nextTargetScanAt = now + Game._targetScanPhase(unit) * 0.20;
        }
        const scanDue = cachedInvalid || now >= unit._nextTargetScanAt;
        if (scanDue) {
            unit._nextTargetScanAt = now + Game._targetScanInterval(unit);
            let cand = Game.nearestEnemy(unit);
            // A weapon that cannot penetrate never auto-targets armor: rifles
            // and MGs must not plink at tanks. Remember the vehicle as a
            // threat so the take-cover reaction still responds to it.
            if (cand && Game.unitCanHurt && !Game.unitCanHurt(unit, cand)) {
                unit._armorThreat = cand;
                unit._armorThreatTime = now;
                cand = null;
            }
            // Target hysteresis: keep the current target through small distance
            // shuffles so the unit doesn't twitch back and forth between two roughly
            // equidistant enemies. Only switch when the current target is gone/unseen,
            // or a new one is clearly closer (>20%) AND we've held the current one for
            // a minimum dwell (kills the rapid retarget jitter).
            const cur = unit._engageId != null
                ? ((unit._engageTarget && unit._engageTarget.id === unit._engageId)
                    ? unit._engageTarget : Game.getUnitById(unit._engageId))
                : null;
            const curDistSq = cur && cur.alive && cur.team !== unit.team
                ? Game.distSq(unit.x, unit.z, cur.x, cur.z) : Infinity;
            // nearestEnemy already proved LOS when it returned the current target;
            // avoid immediately ray-walking that same pair a second time.
            const curVisible = cur && cand && cand.id === cur.id
                ? true
                : !!(cur && cur.alive && cur.team !== unit.team && Game.unitCanSee(unit, cur));
            const curValid = curVisible && curDistSq <= (unit.sight * 1.1) ** 2
                && (!Game.unitCanHurt || Game.unitCanHurt(unit, cur));
            if (curValid && cand && cand.id !== cur.id) {
                const dCand = Game.distSq(unit.x, unit.z, cand.x, cand.z);
                const dwellOk = (now - (unit._targetSince || 0)) > 0.8;
                enemy = (dCand < curDistSq * 0.64 && dwellOk) ? cand : cur;  // 0.64 = 0.8² → ~20% closer
            } else {
                enemy = curValid ? cur : cand;
            }
            unit._scanEnemy = enemy || null;
            unit._scanEnemyId = enemy ? enemy.id : null;
            unit._targetScanTime = now;
        } else if (!cachedInvalid) {
            // Only the cheap liveness/team validation happens between scan ticks.
            // Fire/engage remain authoritative for current-frame LOS and range.
            enemy = cached || null;
        } else {
            cached = null;
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
        unit._engageTarget = enemy;
        unit._engageTime = Game.gameClock;
    } else if (unit._engageId != null && unit.orderMode !== 'retreat' && !unit.holdFire && !facing
        && (Game.gameClock - (unit._engageTime || 0)) < 1.6) {
        const le = Game.getUnitById(unit._engageId);
        if (le && le.alive && le.team !== unit.team
            && Game.dist(unit.x, unit.z, le.x, le.z) <= unit.sight * 1.3) {
            enemy = le;
        } else {
            unit._engageId = null;
            unit._engageTarget = null;
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

    // CLOSE ASSAULT (double right-click on armor): run at the vehicle and lob
    // AT grenade bundles from short range instead of taking a rifle stand-off.
    if (unit._grenadeChargeId != null) {
        const target = enemy && enemy.id === unit._grenadeChargeId
            && unit.forcedTargetId === unit._grenadeChargeId ? enemy : null;
        if (!target) {
            unit._grenadeChargeId = null;   // target destroyed or countermanded
        } else {
            const dct = Game.dist(unit.x, unit.z, target.x, target.z);
            const THROW_RANGE = 6.0;
            if (dct > THROW_RANGE) {
                unit._pursueTimer = (unit._pursueTimer || 0) - dt;
                const targetMoved = !unit._pursueAnchor
                    || Game.distSq(unit._pursueAnchor.x, unit._pursueAnchor.z, target.x, target.z) > 9;
                if (!unit.moving || unit._pursueTimer <= 0 || targetMoved) {
                    unit._pursueTimer = 1.0;
                    unit._pursueAnchor = { x: target.x, z: target.z };
                    unit.path = Game.findPath(unit, unit.x, unit.z, target.x, target.z);
                    unit.moving = true;
                    unit.stopTimer = 0;
                }
            } else {
                unit.path = [];
                unit.moving = false;
                unit.stopTimer = Math.max(unit.stopTimer || 0, 0.15);
                const want = Game.angleTo(unit.x, unit.z, target.x, target.z);
                unit.angle = Game.rotateTo(unit.angle, want, 6 * dt);
                unit.turretAngle = unit.angle;
                unit._atGrenades = unit._atGrenades ?? 2;
                if (Math.abs(Game.angleDiff(unit.angle, want)) < 0.3
                    && (unit._atNext == null || Game.gameClock >= unit._atNext)
                    && Game.unitCanSee(unit, target) && Game.spawnThrownGrenade) {
                    unit._atGrenades--;
                    unit._atNext = Game.gameClock + Game.rand(2.5, 4.5);
                    Game.spawnThrownGrenade(unit.x, unit.z,
                        target.x + Game.rand(-0.6, 0.6), target.z + Game.rand(-0.6, 0.6),
                        { type: 'at', dmg: 45, blastR: 2.2, supp: 18, arc: 1.4 });
                    if (unit.team === Game.playerTeam) {
                        Game.pushMessage(`${unit.label} hurls a grenade bundle at ${target.label}!`, 1.6);
                    }
                    if (unit._atGrenades <= 0) {
                        // Pockets empty: break off; the cover reaction takes over.
                        unit._grenadeChargeId = null;
                        unit.forcedTargetId = null;
                        if (unit.team === Game.playerTeam) {
                            Game.pushMessage(`${unit.label} is out of grenade bundles!`, 1.8);
                        }
                    }
                }
            }
            return;
        }
    }

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
            // re-path faster than ~1.2s — removes the rapid re-plan jitter. A
            // route still pending in the vehicle queue is already on its way;
            // re-pathing synchronously here would defeat the queued order.
            const targetMoved = !unit._pursueAnchor
                || Game.distSq(unit._pursueAnchor.x, unit._pursueAnchor.z, enemy.x, enemy.z) > 25;
            if (!unit._routePending && (!unit.moving || unit._pursueTimer <= 0 || targetMoved)) {
                unit._pursueTimer = 1.2;
                unit._pursueAnchor = { x: enemy.x, z: enemy.z };
                // Armor advances to a scored FIRING POSITION (stand-off band, LOS,
                // own side of the target, spaced off friendly tanks) rather than
                // marching down the charge axis to point-blank.
                let gx, gz;
                const fp = ctx.isVeh && Game.findFiringPosition
                    ? Game.findFiringPosition(unit, enemy) : null;
                if (fp) {
                    gx = fp.x; gz = fp.z;
                } else {
                    const goalDist = Math.max(2, Math.min(unit.range * 0.85, dft * 0.6));
                    const ang = Game.angleTo(enemy.x, enemy.z, unit.x, unit.z);
                    gx = Game.clamp(enemy.x + Math.cos(ang) * goalDist, 1, Game.WORLD_W - 1);
                    gz = Game.clamp(enemy.z + Math.sin(ang) * goalDist, 1, Game.WORLD_H - 1);
                }
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
        const pendingFacing = unit._arrivalFacing
            && unit._lastMoveOrder?.id === unit._arrivalFacing.orderId;
        const assaultArrival = pendingFacing && Game.arrivalFacingRadius
            ? Game.arrivalFacingRadius(unit) : 2.2;
        if (Game.dist(unit.x, unit.z, unit._assaultGoal.x, unit._assaultGoal.z)
            > assaultArrival) {
            // Vehicles resume through the route queue: this branch re-fires on
            // every frame the path is empty, and a synchronous full-hull A*
            // per assault vehicle per frame was the town-fight slowdown. An
            // unreachable goal settles instead of retrying forever.
            const goal = unit._assaultGoal;
            if ((Game.isTank(unit.kind) || Game.isTruck(unit.kind)) && Game.queueVehiclePath) {
                if (!unit._routePending) {
                    Game.queueVehiclePath(unit, goal.x, goal.z, (path) => {
                        if (unit.orderMode !== 'assault' || unit._assaultGoal !== goal) return;
                        unit.path = path;
                        unit.moving = path.length > 0;
                        if (!path.length) unit._assaultGoal = null;
                    }, null, 16000);
                }
            } else {
                unit.path = Game.findPath(unit, unit.x, unit.z, goal.x, goal.z);
                if (!unit.path.length) unit._assaultGoal = null;   // unreachable: settle
            }
            unit.moving = true;
        } else {
            unit._assaultGoal = null;     // arrived at the ordered spot
        }
    }
};

// Take cover (player infantry): a man caught in the open — engaged or under
// fire — breaks for the nearest wall/hedge/bush and fights from there crouched,
// instead of standing upright trading shots in a field (he still shoots on the
// way; infantry fire isn't gated on being halted). Never overrides an active
// move order, a player-forced attack, or a hold/retreat order, and only ever
// dashes a short distance. The enemy AI has its own version of this in ai.js.
Game.uMod.takeCover = (unit, ctx) => {
    if (ctx.isVeh || unit.class !== 'infantry'
        || (Game.isMountedCavalry && Game.isMountedCavalry(unit))) return;
    if (unit.deployable || unit.entrenched || unit._garrisoned || unit._enterRec || unit._enterCarrierId != null) return;
    if (unit.forcedTargetId != null || unit.orderMode === 'retreat' || unit.retreating
        || unit.orderMode === 'hold') return;
    if (unit.path && unit.path.length) return;             // busy moving (order or dash)
    // A tank the rifleman cannot hurt never becomes ctx.enemy (scan filters
    // it out), but it is still a mortal threat: react as if under fire.
    let armorThreat = unit._armorThreat;
    if (!armorThreat || !armorThreat.alive || armorThreat.team === unit.team
        || (Game.gameClock - (unit._armorThreatTime || 0)) > 2.5
        || Game.distSq(unit.x, unit.z, armorThreat.x, armorThreat.z) > 20 * 20) {
        armorThreat = null;
    }
    const engaged = !!ctx.enemy || !!armorThreat
        || (unit.underFire || 0) > 0 || (unit.suppressionValue || 0) > 20;
    if (!engaged) return;
    // Already behind something decent: just keep low. (0.22 matches the minimum
    // cover findCoverPosition will pick, so an arrived man never re-dashes.)
    if ((unit.coverBonus || 0) > 0.22) {
        if (unit.stance === 'stand' || unit.stance === 'run') { unit.stance = 'crouch'; unit._autoStance = true; }
        return;
    }
    if ((unit._coverCd || 0) > Game.gameClock) return;     // don't re-plan every frame
    unit._coverCd = Game.gameClock + 3.0;
    const threat = ctx.enemy || armorThreat || unit._lastThreat;
    if (!threat) return;
    const cov = Game.findCoverPosition(unit, threat.x, threat.z);
    if (cov && Game.dist(unit.x, unit.z, cov.x, cov.z) > 1.2) {
        unit.path = Game.findPath(unit, unit.x, unit.z, cov.x, cov.z);
        unit.moving = unit.path.length > 0;
        if (unit.stance !== 'prone') { unit.stance = 'crouch'; unit._autoStance = true; }
    } else if (armorThreat
        && Game.dist(unit.x, unit.z, armorThreat.x, armorThreat.z) < 10) {
        // No cover and the armor keeps closing: give ground straight away
        // from it instead of kneeling in its path.
        const away = Game.angleTo(armorThreat.x, armorThreat.z, unit.x, unit.z);
        const fx = Game.clamp(unit.x + Math.cos(away) * 9, 1, Game.WORLD_W - 1);
        const fz = Game.clamp(unit.z + Math.sin(away) * 9, 1, Game.WORLD_H - 1);
        unit.path = Game.findPath(unit, unit.x, unit.z, fx, fz);
        unit.moving = unit.path.length > 0;
    } else if (unit.stance === 'stand') {
        // Nothing nearby — at least get low where he stands.
        unit.stance = 'crouch'; unit._autoStance = true;
    }
};

// Fire: turret/weapon tracking and shooting. Sets ctx.hasTurret /
// ctx.aimAngleToEnemy (the move module reads them for turret tracking on the go).
Game.uMod.fire = (unit, ctx) => {
    const enemy = ctx.enemy;
    const dt = ctx.dt;
    const isVeh = ctx.isVeh;
    const canFire = !unit.holdFire && !(Game.isTank(unit.kind) && unit.turretDamaged)
        // Never squeeze off rounds the target's armor shrugs off (rifle vs
        // tank). Forced or not, the man holds fire; grenade charges and the
        // take-cover reaction handle armor instead.
        && (!enemy || !Game.unitCanHurt || Game.unitCanHurt(unit, enemy));
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

                // TURRET-FIRST: the turret makes the quick layup; the hull only
                // comes around when the target sits well off the nose (bringing
                // the frontal armor to bear on a flank threat). Rotating the
                // hull for every engagement made tanks fidget through strings
                // of small alignment turns they never needed.
                if (!unit.moving
                    && Math.abs(Game.angleDiff(unit.angle, aimAngleToEnemy)) > 1.2) {
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
                const mounted = Game.isMountedCavalry && Game.isMountedCavalry(unit);
                // A rider can shoot across the saddle using the directional
                // authored clips. Do not snap the whole horse toward each target
                // while it is running; once nearly stopped it may turn naturally.
                if (mounted) {
                    if ((unit.currentSpeed || 0) < 0.6) {
                        unit.angle = Game.rotateTo(unit.angle, aimAngleToEnemy,
                            (unit.rotationSpeed || 2.2) * dt);
                    }
                    unit.turretAngle = aimAngleToEnemy;
                } else {
                    // Infantry: turn the body toward the target at a finite rate
                    // instead of snapping instantly each frame.
                    unit.angle = Game.rotateTo(unit.angle, aimAngleToEnemy, 8 * dt);
                    unit.turretAngle = unit.angle;
                }
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
    const isTruck = Game.isTruck(unit.kind);   // wheeled, bicycle-model steering
    const isMounted = Game.isMountedCavalry && Game.isMountedCavalry(unit);
    // A vehicle whose route is still in the queue holds in place: its empty
    // path must not read as "arrived" and silently cancel the order.
    if (unit._routePending && (!unit.path || !unit.path.length)) {
        unit.currentSpeed = 0;
        unit._dispSpeed = 0;
        return;
    }
    const enemy = ctx.enemy;
    const hasTurret = ctx.hasTurret;
    const aimAngleToEnemy = ctx.aimAngleToEnemy;
    const prevX = ctx.prevX, prevZ = ctx.prevZ;
    const prevAngle = ctx.prevAngle ?? unit.angle;

    let maxSpeed = unit.speed;

    if (isMounted) {
        const speedFactor = Game.clamp(1 - unit.suppressionValue / 150, 0.42, 1);
        maxSpeed *= speedFactor;
        const tile = Game.getTileAtWorld(unit.x, unit.z);
        if (tile) {
            if (tile.type === 'road') maxSpeed *= 1.10;
            else if (tile.type === 'mud' || tile.type === 'forest') maxSpeed *= 0.62;
            else if (tile.type === 'wheat') maxSpeed *= 0.82;
            else if (tile.type === 'dense_forest' || tile.type === 'swamp') maxSpeed *= 0.22;
            else if (tile.type === 'railway') maxSpeed *= 0.55;
        }
        if (Game.getWeatherSpeedMod) maxSpeed *= Game.getWeatherSpeedMod();
    } else if (!isVeh && !isTruck) {
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

    if ((isVeh || isTruck || isMounted) && Game.getTerrainSlope) {
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

    // Post-yield creep: after a contact stop for another hull, ease back up to
    // pace instead of gunning straight back into the same hull — the instant
    // re-acceleration re-triggered the yield several times a second (the
    // column stop-go stutter).
    if (isVeh && (unit._crawlT || 0) > 0) {
        unit._crawlT = Math.max(0, unit._crawlT - dt);
        maxSpeed *= 0.35 + 0.65 * (1 - unit._crawlT / 0.8);
    }

    // Car-following: vehicles moving the same way ease off behind a leader and form a
    // COLUMN instead of weaving around each other (stops the grouped-tank churn).
    if ((isVeh || isTruck) && maxSpeed > 0 && Game._vehicleFollow) maxSpeed *= Game._vehicleFollow(unit);

    // Predictive crossing yield (ORCA's time-projection idea, speed-only): the
    // lower-priority hull of a CONVERGING pair eases off seconds before contact
    // and passes behind, instead of both driving to the meet point and locking.
    if ((isVeh || isTruck) && maxSpeed > 0 && Game._vehicleCrossingYield) maxSpeed *= Game._vehicleCrossingYield(unit);

    // Foot-column pacing: ease off behind the man directly ahead so packed
    // files FLOW instead of accordion-stopping into each other's backs.
    if (!isVeh && !isTruck && !isMounted && unit._enterCarrierId == null && !unit._unloading
        && maxSpeed > 0 && unit.path && unit.path.length && Game._infantryFollow) {
        maxSpeed *= Game._infantryFollow(unit);
    }

    // DYNAMIC RE-ROUTE: tracked vehicles can replace a route while rolling when
    // a parked hull newly blocks it. Trucks deliberately keep the full-width A*
    // route issued at command time: replacing waypoints midway through a
    // bicycle-model turn can put the new first edge outside the lorry's reachable
    // curvature and cause a wide loop or steering reversal. Their pre-flight
    // predictor, swept hull gate and stopped recovery own changed-scene cases.
    if (!isTruck && unit.path && unit.path.length && (unit.stopTimer || 0) <= 0
        && !unit._reverseMove && !unit.retreating && !unit._garrisoned) {
        unit._rerouteT = (unit._rerouteT || 0) - dt;
        if (unit._rerouteT <= 0) {
            unit._rerouteT = 0.6;
            const blocker = Game._pathBlockedByVehicle ? Game._pathBlockedByVehicle(unit, 12) : null;
            const retryOk = !blocker || !unit._rerouteFor
                || unit._rerouteFor.id !== blocker.id
                || (Game.gameClock - unit._rerouteFor.t) > 4;
            if (blocker && retryOk) {
                const goal = unit.path[unit.path.length - 1];
                // A blocker squatting ON the destination is the arrival/settle
                // logic's case — re-routing would just churn.
                if (Game.distSq(goal.x, goal.z, blocker.x, blocker.z) > 16) {
                    unit._rerouteFor = { id: blocker.id, t: Game.gameClock };
                    const fresh = Game._vehicleRecoveryRoute(unit, goal, 'dynamic-blocker');
                    if (fresh.length) { unit.path = fresh; unit._detour = null; }
                }
            }
        }
    } else {
        unit._rerouteT = 0;
    }

    // PRE-FLIGHT a close first turn with the same bicycle kinematics the lorry
    // will actually use. If that arc reaches a parked hull, create steering room
    // with one deliberate reverse BEFORE accelerating toward the obstacle. This
    // replaces the visible drive→hard-stop→reverse jerk at close tank blockages.
    if (isTruck && !unit._reverseMove && unit.path && unit.path.length
        && (unit.currentSpeed || 0) < 0.08
        && (unit.stopTimer || 0) <= 0 && (unit.orderDelay || 0) <= 0
        && Game._predictTruckRouteBlock
        && unit._truckPreflightPath !== unit.path
        && (unit._truckPreflightBackups || 0) < 2) {
        unit._truckPreflightPath = unit.path;
        const risk = Game._predictTruckRouteBlock(unit, unit.path, 5.0);
        if (risk) {
            const goal = unit.path[unit.path.length - 1];
            const ext = Game._vehicleHalfExtents ? Game._vehicleHalfExtents(unit) : { hl: 1.8 };
            const reverseDistance = Game.clamp(ext.hl * 0.75, 1.1, 1.8);
            const reverseWp = {
                x: Game.clamp(unit.x - Math.cos(unit.angle) * reverseDistance, 1, Game.WORLD_W - 1),
                z: Game.clamp(unit.z - Math.sin(unit.angle) * reverseDistance, 1, Game.WORLD_H - 1),
                _endTruckReverse: true,
                _preflightReverse: true,
            };
            const rearClear = !Game.segmentPassable || Game.segmentPassable(
                unit, unit.x, unit.z, reverseWp.x, reverseWp.z, {
                    startAngle: unit.angle,
                    endAngle: unit.angle,
                    margin: 0.02,
                });
            if (rearClear) {
                unit._truckRecoveryGoal = Game._captureTruckRecovery(unit, { preflight: true });
                unit._truckPreflightBackups = (unit._truckPreflightBackups || 0) + 1;
                unit._preflightRiskId = risk.hit ? risk.hit.id : null;
                unit._detour = null; unit._drvCmd = null;
                unit._reverseMove = true; unit._reversing = true;
                unit.currentSpeed = 0;
                unit.path = [reverseWp];
                unit.moving = true;
            }
        }
    }

    // Insert/refresh a side-step waypoint to route around any tank blocking the
    // lane ahead (dynamic obstacle avoidance) before we read the next waypoint.
    // Runs for tanks, trucks and infantry so foot troops walk AROUND a hull
    // instead of marching on the spot against it.
    // ONE STEERING AUTHORITY AT A TIME: while the local planner holds an active
    // command, the detour logic keeps its hands off the path — the two taking
    // turns re-aiming the hull every few tenths was the left-right-left
    // "excessive turning" churn on wedged tanks.
    if (Game._vehicleAvoid && !unit._reverseMove
        && !(unit._drvCmd && unit._drvCmd.cmd)) Game._vehicleAvoid(unit);

    if (unit.path && unit.path.length && unit.stopTimer <= 0 && (unit.orderDelay || 0) <= 0
        && (!unit.deployable || unit._canMove)) {
        let next = unit.path[0];
        let dx = next.x - unit.x;
        let dz = next.z - unit.z;
        let d = Math.hypot(dx, dz);

        // Recovery back-ups are deliberately short (about 1.35u). They need a
        // tight completion radius; the normal 1.5u vehicle arrival radius would
        // consume the reverse waypoint immediately, before the wheels moved.
        let arrivalDist = next && next._endTruckReverse
            ? 0.18
            : (next && next._exactGoal && (isVeh || isTruck)
                ? (isTruck ? 1.15 : 0.65)
                : ((isVeh || isTruck) ? 1.5
                    : (isMounted ? Game.CAVALRY_MOVE.arrivalRadius : 0.4)));

        // SETTLE WHEN CROWDED: near its slot and no longer closing the gap (elbowed out
        // by friendlies), a unit calls it arrived instead of shuffling forever. Only
        // near the slot, so a unit still en route keeps trying for its exact circle
        // rather than giving up far away. Progress-based; a lone unit arrives precisely.
        const settleNear = (isVeh || isTruck || isMounted) ? 2.0 : 3.2;
        if (unit.path.length === 1 && d < settleNear && !unit._reverseMove && !unit._detour
            && (unit.currentSpeed || 0) < 0.20) {
            // Per-frame progress below 0.05u is normal while braking (at 30fps
            // that labelled anything under 1.5u/s as "stuck" and discarded the
            // goal up to four units early). Only settle on near-zero progress.
            if (unit._lastGoalD != null && d > unit._lastGoalD - 0.002) {
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

        const passedTruckWaypoint = () => {
            if (!isTruck || unit._reverseMove || unit.path.length < 2 || d >= 8) return false;
            // Generated A* nodes may be retired after the lorry crosses their
            // outgoing gate, but a player's Shift waypoint is a real checkpoint.
            // Enter its explicit capture radius before allowing the same smooth
            // gate transition, so a shallow corner cannot be cut several units wide.
            if (next && next._orderStop && d >= (Game.TRUCK_ORDER_STOP_RADIUS || 2.25)) return false;
            const after = unit.path[1];
            const outX = after.x - next.x, outZ = after.z - next.z;
            const outLen = Math.hypot(outX, outZ);
            if (outLen < 0.01) return true;
            // A wheeled lorry may cut a corner just outside the waypoint's small
            // arrival circle. Once its centre crosses the waypoint's outgoing
            // perpendicular gate, that corner is behind it; continuing to chase
            // the old point makes a non-pivoting truck orbit forever.
            const along = ((unit.x - next.x) * outX + (unit.z - next.z) * outZ) / outLen;
            const waypointBearing = Math.atan2(dz, dx);
            const behind = Math.abs(Game.angleDiff(unit.angle, waypointBearing)) > Math.PI / 2;
            return along > 0.05 && behind;
        };

        const commitTruckFinalStop = () => {
            if (isTruck && !unit._reverseMove && unit.path.length === 1
                && next && !next._endTruckReverse && d < arrivalDist) {
                // Keep braking once the lorry enters the final capture circle.
                // Without this latch, a tangential approach can leave the circle
                // before speed reaches zero, re-accelerate, and orbit the click.
                next._truckStopCommitted = true;
            }
        };
        commitTruckFinalStop();

        while (unit.path.length && (d < arrivalDist
            || (next && next._truckStopCommitted) || passedTruckWaypoint())) {
            // A final waypoint is a stopping line, not a trigger to delete the
            // route at road speed. Keep it alive until the vehicle has braked;
            // otherwise the lorry freezes for a frame at 0.7-1.2u/s and visibly
            // jerks. The driver branches below cap speed to zero at this radius.
            if ((unit.path.length === 1 || (next && next._endPlayerReverse))
                && (isVeh || isTruck || isMounted)
                && (unit.currentSpeed || 0) > 0.08) break;
            const arrivedWaypoint = unit.path[0];
            unit.path.shift();

            // A player-requested short reverse is only the first leg. Shift may
            // append forward waypoints while it is underway; switch back to the
            // normal forward driver as soon as that reverse checkpoint is reached.
            if (arrivedWaypoint && arrivedWaypoint._endPlayerReverse) {
                unit._reverseMove = false;
                unit._reversing = false;
                unit.currentSpeed = 0;
            }

            // End of a truck's deliberate back-up recovery. Stop reversing and
            // rebuild the player's original forward route from the new clearance.
            if (arrivedWaypoint && arrivedWaypoint._endTruckReverse && unit._truckRecoveryGoal) {
                const recovery = unit._truckRecoveryGoal;
                const goal = recovery.goal;
                unit._truckRecoveryGoal = null;
                unit._reverseMove = false; unit._reversing = false; unit.currentSpeed = 0;
                unit._detour = null; unit._drvCmd = null;
                // Replan from the pose the truck ACTUALLY reached. A fabricated
                // pre-reverse side point was not validated from this heading and
                // could turn a successful back-up into an empty/unsafe route.
                unit.path = Game._restoreTruckRecovery(unit, recovery);
                unit.moving = unit.path.length > 0;
                if (!unit.path.length && Game.dist(unit.x, unit.z, goal.x, goal.z) > 1.5) {
                    unit._moveBlockedGoal = { x: goal.x, z: goal.z };
                    if (Game.pushMessage) Game.pushMessage(`${unit.label}: no clear route to destination.`, 1.5);
                } else {
                    unit._moveBlockedGoal = null;
                }
            }

            if (isVeh || isTruck) {
                while (unit.path.length > 1) {
                    const peek = unit.path[0];
                    if (peek && peek._orderStop) break;
                    const peekDx = peek.x - unit.x;
                    const peekDz = peek.z - unit.z;
                    const peekD = Math.hypot(peekDx, peekDz);
                    const peekAng = Math.atan2(peekDz, peekDx);

                    const next2 = unit.path[1];
                    const n2Dx = next2.x - unit.x;
                    const n2Dz = next2.z - unit.z;
                    const n2Ang = Math.atan2(n2Dz, n2Dx);

                    // Only straighten if the shortcut segment is actually clear —
                    // merging waypoints blind let the straightened line clip
                    // through building corners the A* dogleg was avoiding.
                    if (Math.abs(Game.angleDiff(peekAng, n2Ang)) < 0.4 && peekD < 6
                        && (!Game.segmentPassable || Game.segmentPassable(
                            unit, unit.x, unit.z, next2.x, next2.z, {
                                startAngle: unit.angle,
                                endAngle: n2Ang,
                                margin: 0.20,
                            }))) {
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
                const arrivalBrake = isMounted ? Game.CAVALRY_MOVE.braking : maxSpeed * 0.8;
                unit.currentSpeed = Math.max(0, unit.currentSpeed - arrivalBrake * dt);
                break;
            }

            next = unit.path[0];
            dx = next.x - unit.x;
            dz = next.z - unit.z;
            d = Math.hypot(dx, dz);
            arrivalDist = next && next._endTruckReverse
                ? 0.18
                : (next && next._exactGoal && (isVeh || isTruck)
                    ? (isTruck ? 1.15 : 0.65)
                    : ((isVeh || isTruck) ? 1.5
                        : (isMounted ? Game.CAVALRY_MOVE.arrivalRadius : 0.4)));
            commitTruckFinalStop();
        }

        if (unit.path.length) {
            let ang = Math.atan2(dz, dx);
            if (isTruck && !unit._reverseMove && unit.path.length > 1) {
                // Pure-pursuit lookahead across the next corner. A lorry that
                // aims only at discrete waypoint centres begins steering after
                // reaching the corner, far too late for its wheelbase, then
                // loops back. Aim a speed-scaled distance down the next leg so
                // curvature develops continuously before the waypoint.
                const after = unit.path[1];
                const outX = after.x - next.x, outZ = after.z - next.z;
                const outLen = Math.hypot(outX, outZ);
                if (outLen > 0.01) {
                    const lookAhead = Game.clamp((unit.currentSpeed || 0) * 1.15 + 1.5, 2.5, 6.0);
                    if (d < lookAhead) {
                        const advance = Math.min(outLen, lookAhead - d);
                        const aimX = next.x + outX / outLen * advance;
                        const aimZ = next.z + outZ / outLen * advance;
                        ang = Math.atan2(aimZ - unit.z, aimX - unit.x);
                    }
                }
            }
            const isLastWaypoint = unit.path.length === 1;

            if (isVeh) {
                // Reverse-retreat: a falling-back tank keeps its front toward the
                // threat and backs away toward the waypoint (only at close range;
                // farther out it just turns and drives normally).
                const reverseRetreat = unit.retreating && unit._retreatThreat
                    && Game.dist(unit.x, unit.z, unit._retreatThreat.x, unit._retreatThreat.z) < 45;
                // Constrained local plan (ORCA idea through the tank driver):
                // non-null only while the dead-reckoned course conflicts with
                // another hull — then it commands one track-legal maneuver.
                const drvPlan = (!reverseRetreat && !unit._reverseMove && Game._tankDriverPlan)
                    ? Game._tankDriverPlan(unit, maxSpeed) : null;
                if (reverseRetreat) {
                    const faceAng = Game.angleTo(unit.x, unit.z, unit._retreatThreat.x, unit._retreatThreat.z);
                    unit.angle = Game.rotateTo(unit.angle, faceAng, unit.rotationSpeed * dt);
                    const revSpeed = maxSpeed * 0.5;
                    const step = Math.min(revSpeed * dt, d);
                    // Back out along the hull's OWN axis (rear-first). Stepping
                    // toward the waypoint bearing while the nose holds on the
                    // threat translated the hull sideways — tracks cannot do that.
                    unit.x -= Math.cos(unit.angle) * step;
                    unit.z -= Math.sin(unit.angle) * step;
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
                } else if (drvPlan && drvPlan.rev) {
                    // Planner commanded a back-out: reverse straight along the
                    // hull's own axis, nose held, until a re-plan finds the
                    // course clear (never a sidestep, never a spin-around).
                    const revSpeed = maxSpeed * 0.4;
                    unit.currentSpeed = Math.min(revSpeed, (unit.currentSpeed || 0) + maxSpeed * 0.5 * dt);
                    const step = unit.currentSpeed * dt;
                    unit.x -= Math.cos(unit.angle) * step;
                    unit.z -= Math.sin(unit.angle) * step;
                    unit._reversing = true;
                    unit.moving = true;
                    if (!hasTurret) unit.turretAngle = unit.angle;
                    unit._trackDist = (unit._trackDist || 0) + step;
                    if (unit._trackDist > 1.2) {
                        unit._trackDist = 0;
                        Game.trackMarks = Game.trackMarks || [];
                        Game.trackMarks.push({ x: unit.x, z: unit.z, angle: unit.angle, size: unit.size, team: unit.team, life: 15.0, total: 15.0, mesh: null });
                    }
                } else {
                // Steer command from the planner biases the bearing we drive at
                // (a committed swing off to one side); throttle caps come later.
                const steerAng = (drvPlan && drvPlan.steer)
                    ? unit.angle + drvPlan.steer * 1.2 : ang;
                const angleDelta = Game.angleDiff(unit.angle, steerAng);
                const absAngleDelta = Math.abs(angleDelta);

                const speedRatio = unit.currentSpeed / (maxSpeed || 1);
                const turnMomentumFactor = Game.clamp(1.0 - (speedRatio * 0.6), 0.4, 1.0);
                const pivotBoost = (absAngleDelta > 0.5 && speedRatio < 0.2) ? 1.3 : 1.0;
                const turnSpeed = unit.rotationSpeed * turnMomentumFactor * pivotBoost;

                unit.angle = Game.rotateTo(unit.angle, steerAng, turnSpeed * dt);

                let targetSpeed = 0;

                if (absAngleDelta < Math.PI / 2) {
                    // Carry speed through corners like a real driver: ease off
                    // with heading error but KEEP ROLLING through moderate turns
                    // (floor up to ~63°), and only brake right down beyond that.
                    // The old cos³ curve dropped to ~35% for a routine 45° grid
                    // dogleg — every unsmoothed waypoint read as a
                    // brake-pivot-lurch pulse instead of a driven arc.
                    const alignment = Math.max(0, Math.cos(absAngleDelta));
                    targetSpeed = maxSpeed * Game.clamp(alignment, absAngleDelta < 1.1 ? 0.55 : 0.15, 1);
                } else {
                    targetSpeed = 0;
                }
                // Planner throttle command (ease / hard slow / stop) caps the
                // alignment-based speed while the conflict is live.
                if (drvPlan) targetSpeed = Math.min(targetSpeed, maxSpeed * drvPlan.thr);

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
                    // Rear-first along the hull's own axis (the waypoint is
                    // behind us, so backing up closes on it) — stepping along
                    // the waypoint bearing directly was a sideways slide.
                    unit.x -= Math.cos(unit.angle) * revStep;
                    unit.z -= Math.sin(unit.angle) * revStep;
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
                unit._truckSteer = unit._truckSteer || 0;
                unit._truckSteer += Game.clamp(-unit._truckSteer, -1.35 * dt, 1.35 * dt);
                const revSpeed = maxSpeed * 0.4;
                const brakeRate = maxSpeed * 1.5;
                // Brake into the reverse waypoint using v²=2ad. Previously the
                // lorry reached it at full reverse speed and was snapped to zero
                // by the arrival handler—the visible jerk in a three-point turn.
                const stoppingSpeed = Math.sqrt(2 * brakeRate * Math.max(0, d - arrivalDist));
                const targetReverseSpeed = Math.min(revSpeed, stoppingSpeed);
                if ((unit.currentSpeed || 0) < targetReverseSpeed) {
                    unit.currentSpeed = Math.min(targetReverseSpeed,
                        (unit.currentSpeed || 0) + maxSpeed * 0.5 * dt);
                } else {
                    unit.currentSpeed = Math.max(targetReverseSpeed,
                        (unit.currentSpeed || 0) - brakeRate * dt);
                }
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
                // Match the axle span to the rendered lorry. The old 3.2 factor
                // produced a ~5.7u wheelbase on a ~3.4u model, making ordinary
                // avoidance turns geometrically impossible even after reversing.
                const WHEELBASE = Math.max(0.8, (unit.size || 0.85) * (Game.TRUCK_WHEELBASE ?? 1.7) * mScale);
                const desiredSteer = Game.clamp(headErr, -MAX_STEER, MAX_STEER);
                // Steering-wheel/wheel angle has inertia too. Rate-limit it so a
                // waypoint change cannot flip curvature left→right in one frame.
                const steerRate = 1.35; // rad/s at the road wheels
                unit._truckSteer = unit._truckSteer || 0;
                unit._truckSteer += Game.clamp(
                    desiredSteer - unit._truckSteer,
                    -steerRate * dt,
                    steerRate * dt);
                const steer = Game.clamp(unit._truckSteer, -MAX_STEER, MAX_STEER);

                // Smooth accel/brake; ease off for sharp turns and on approach, but
                // keep rolling (floor) so turns don't crawl.
                let targetSpeed = maxSpeed * Game.clamp(1 - Math.abs(headErr) / 1.8, 0.30, 1);
                const accelRate = maxSpeed * (Game.TRUCK_ACCEL ?? 0.6);
                const brakeRate = maxSpeed * 1.5;
                if (isLastWaypoint && (d < 4 || next._truckStopCommitted)) {
                    // Brake to zero AT the arrival radius (v²=2ad), rather than
                    // carrying speed through it and deleting the path abruptly.
                    const stopSpeed = next._truckStopCommitted
                        ? 0
                        : Math.sqrt(2 * brakeRate * Math.max(0, d - arrivalDist));
                    targetSpeed = Math.min(targetSpeed, stopSpeed);
                }
                if (unit.currentSpeed < targetSpeed) unit.currentSpeed = Math.min(targetSpeed, unit.currentSpeed + accelRate * dt);
                else unit.currentSpeed = Math.max(targetSpeed, unit.currentSpeed - brakeRate * dt);

                unit.angle += (unit.currentSpeed / WHEELBASE) * Math.tan(steer) * dt;
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
            } else if (isMounted) {
                // Horses build speed progressively, slow before tight turns and
                // brake to the final point using v²=2ad. Translation always
                // follows the horse's heading, so no infantry-style sideways snap
                // or instant full-speed start is possible.
                const cfg = Game.CAVALRY_MOVE;
                const headingError = Game.angleDiff(unit.angle, ang);
                const speedRatio = Game.clamp((unit.currentSpeed || 0) / Math.max(maxSpeed, 0.01), 0, 1);
                const turnRate = (unit.rotationSpeed || 2.2) * (1 - speedRatio * 0.58);
                unit.angle = Game.rotateTo(unit.angle, ang, turnRate * dt);
                unit.turretAngle = unit.angle;

                const alignment = Math.max(0, Math.cos(headingError));
                let targetSpeed = maxSpeed * (Math.abs(headingError) < Math.PI / 2
                    ? Game.clamp(alignment, 0.16, 1)
                    : 0);
                if (isLastWaypoint) {
                    const stopSpeed = Math.sqrt(2 * cfg.braking
                        * Math.max(0, d - arrivalDist));
                    targetSpeed = Math.min(targetSpeed, stopSpeed);
                }
                if ((unit.currentSpeed || 0) < targetSpeed) {
                    unit.currentSpeed = Math.min(targetSpeed,
                        (unit.currentSpeed || 0) + cfg.acceleration * dt);
                } else {
                    unit.currentSpeed = Math.max(targetSpeed,
                        (unit.currentSpeed || 0) - cfg.braking * dt);
                }

                const step = Math.min((unit.currentSpeed || 0) * dt, d);
                if (step > 0.001) {
                    unit.x += Math.cos(unit.angle) * step;
                    unit.z += Math.sin(unit.angle) * step;
                }
                unit._reversing = false;
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
        if (isTruck) {
            unit._truckSteer = unit._truckSteer || 0;
            unit._truckSteer += Game.clamp(-unit._truckSteer, -1.35 * dt, 1.35 * dt);
        }
        if (unit.currentSpeed > 0.01) {
            const coastRate = isMounted ? Game.CAVALRY_MOVE.braking
                : ((isVeh || isTruck) ? maxSpeed * 0.8 : maxSpeed * 3.0);
            unit.currentSpeed = Math.max(0, unit.currentSpeed - coastRate * dt);
            if (isVeh || isTruck || isMounted) {
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

        // A right-drag movement order stores its heading until the matching
        // destination is actually reached. Replans and attack-move pauses may
        // empty a path temporarily, so the helper also verifies order id and
        // distance before converting the intent into the normal rotate state.
        if (Game.tryActivateArrivalFacing) Game.tryActivateArrivalFacing(unit);

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
        } else if (unit._faceGoal != null) {
            // Soft facing goal from the AI (watch a threat bearing): turned at
            // the hull's own rate CONTINUOUSLY, every frame. The AI used to
            // rotate directly in its think tick — one discrete 0.35-0.55 rad
            // step every 0.25-0.5s, which read as a string of small jerky
            // turns. Unlike _faceAngle, this never blocks target acquisition.
            const rate = isVeh ? unit.rotationSpeed * 0.6 : (unit.rotationSpeed || 6);
            unit.angle = Game.rotateTo(unit.angle, unit._faceGoal, rate * dt);
            if (!isVeh || !unit.hasTurret) unit.turretAngle = unit.angle;
            if (Math.abs(Game.angleDiff(unit.angle, unit._faceGoal)) < 0.05) unit._faceGoal = null;
        }
    }

    Game.applySeparation(unit, dt);

    // Keep the COMPLETE oriented hull inside the world. Clamping only the centre
    // left the nose/corners outside the map for long trucks.
    if ((isVeh || isTruck) && Game._vehicleHalfExtents) {
        const { hl, hw } = Game._vehicleHalfExtents(unit);
        const c = Math.abs(Math.cos(unit.angle || 0));
        const s = Math.abs(Math.sin(unit.angle || 0));
        const rx = hl * c + hw * s;
        const rz = hl * s + hw * c;
        unit.x = Game.clamp(unit.x, rx, Game.WORLD_W - rx);
        unit.z = Game.clamp(unit.z, rz, Game.WORLD_H - rz);
    } else {
        const edge = isMounted ? unit.size : 0.5;
        unit.x = Game.clamp(unit.x, edge, Game.WORLD_W - edge);
        unit.z = Game.clamp(unit.z, edge, Game.WORLD_H - edge);
    }

    // Continuous full-hull collision. Checking only the final centre left two
    // holes: a long corner could rotate through a tank, and a fast step could
    // cross a narrow obstacle between frames. Sweep translation AND heading in
    // small increments and retain the last clear pose.
    let sweepBlock = null;
    if ((isVeh || isTruck) && Game._sweepVehicleMotion) {
        const sweep = Game._sweepVehicleMotion(
            unit, prevX, prevZ, prevAngle, unit.x, unit.z, unit.angle);
        unit.x = sweep.x; unit.z = sweep.z; unit.angle = sweep.angle;
        if (sweep.blocked) {
            sweepBlock = sweep;
            unit.currentSpeed = 0;
            unit._crawlT = Math.max(unit._crawlT || 0, 0.5);
        }
    }

    // Block movement onto solid terrain (walls/houses/water) and impassable vehicle
    // terrain — EXCEPT dense forest, which tanks crush through (so they don't bounce
    // off the tree line they were routed into). The unit's whole BODY footprint is
    // tested, not just its centre tile: a hull stops with its nose AT the wall face
    // instead of driving a half-length into the building before the centre notices.
    // A unit already overlapping a structure may still take a step that doesn't put
    // MORE of it inside (so it can extract itself rather than freeze).
    if (Game._bodySolidCount) {
        const solidNew = Game._bodySolidCount(unit, unit.x, unit.z, unit.angle);
        if (solidNew > 0 && solidNew > Game._bodySolidCount(unit, prevX, prevZ, prevAngle)) {
            unit.x = prevX;
            unit.z = prevZ;
            unit.angle = prevAngle;
            unit.currentSpeed = 0;
        }
    } else {
        const tileNow = Game.getTileAtWorld(unit.x, unit.z);
        if (tileNow && (tileNow.blocked
            || (isVeh && tileNow.vehicleBlocked && tileNow.type !== 'dense_forest'))) {
            unit.x = prevX;
            unit.z = prevZ;
            unit.currentSpeed = 0;
        }
    }

    // SOLID HULLS (vehicles): a vehicle may never end a frame deeper inside
    // another vehicle's footprint than it started, whatever moved it (drive,
    // reverse, coast). The whole frame's motion is refused and momentum killed
    // — hulls STOP at contact; there is no de-overlap shove anywhere any more,
    // so a vehicle physically cannot slide sideways. (Steps that REDUCE an
    // existing penetration stay allowed so legacy overlaps can back out.)
    if ((isVeh || isTruck) && Game._vehPenetration) {
        const posePen = Game._vehiclePosePenetration
            ? Game._vehiclePosePenetration(unit, unit.x, unit.z, unit.angle, 0.02, false)
            : { depth: Game._vehPenetration(unit, unit.x, unit.z, unit.angle), hit: null };
        const dNew = posePen.depth;
        const endOverlap = dNew > 0.001
            && dNew > Game._vehPenetration(unit, prevX, prevZ, prevAngle) + 1e-4;
        if (endOverlap) {
            unit.x = prevX;
            unit.z = prevZ;
            unit.angle = prevAngle;
            unit.currentSpeed = 0;
        }
        const hullBlocked = endOverlap || (sweepBlock && sweepBlock.type === 'vehicle');
        if (hullBlocked) {
            const contact = (sweepBlock && sweepBlock.hit) || posePen.hit || null;
            const contactKey = contact ? contact.id : 'unknown';
            if (unit._hullBlockFor !== contactKey) {
                unit._hullBlockFor = contactKey;
                unit._hullBlockT = 0;
            }
            unit._crawlT = Math.max(unit._crawlT || 0, 0.5);
            unit._hullBlockT = (unit._hullBlockT || 0) + dt;
            // Parked contact needs a prompt three-point correction; moving traffic
            // gets time to cross/yield instead of making the truck reverse on a
            // single transient touch.
            const recoveryAfter = contact && (contact.currentSpeed || 0) > 0.15 ? 0.75 : 0.12;
            if (isTruck && !unit._reverseMove && unit.path.length
                && (Game.gameClock || 0) >= (unit._recoveryBlockedUntil || 0)
                && unit._hullBlockT > recoveryAfter) {
                const goal = unit.path[unit.path.length - 1];
                const myExt = Game._vehicleHalfExtents ? Game._vehicleHalfExtents(unit) : { hl: 1.8 };
                const reverseDistance = Game.clamp(myExt.hl * 0.75, 1.1, 1.8);
                const reverseWp = {
                    x: Game.clamp(unit.x - Math.cos(unit.angle) * reverseDistance, 1, Game.WORLD_W - 1),
                    z: Game.clamp(unit.z - Math.sin(unit.angle) * reverseDistance, 1, Game.WORLD_H - 1),
                    _endTruckReverse: true,
                };
                const rearClear = !Game.segmentPassable || Game.segmentPassable(
                    unit, unit.x, unit.z, reverseWp.x, reverseWp.z, {
                        startAngle: unit.angle,
                        endAngle: unit.angle,
                        margin: 0.02,
                    });
                if (rearClear) {
                    unit._truckRecoveryGoal = Game._captureTruckRecovery(unit);
                    unit._detour = null; unit._drvCmd = null;
                    unit._reverseMove = true; unit._reversing = true;
                    unit.path = [reverseWp];
                    unit.moving = true;
                } else {
                    // Rear is blocked too: do not enter an endless reverse state.
                    unit.currentSpeed = 0;
                    unit._recoveryBlockedUntil = (Game.gameClock || 0) + 1.0;
                }
                unit._hullBlockT = 0;
                unit._hullBlockFor = null;
            }
        } else if (sweepBlock && sweepBlock.type === 'terrain') {
            unit._hullBlockT = 0;
            unit._hullBlockFor = null;
        } else {
            // Contact can flicker for one frame as the bicycle model rotates a
            // few hundredths clear, then touch again. Resetting to zero on every
            // flicker let a truck creep at the tank forever without reaching the
            // reverse-recovery threshold. Decay slowly so repeated contact counts
            // as one sustained blockage, while a genuinely clear route drains it.
            unit._hullBlockT = Math.max(0, (unit._hullBlockT || 0) - dt * 0.5);
            if (unit._hullBlockT <= 0) unit._hullBlockFor = null;
        }
    }

    // A reverse leg was clear when issued, but moving traffic can enter behind
    // it. Recovery is not allowed to become an unmonitored permanent state.
    if (isTruck && unit._reverseMove && unit._truckRecoveryGoal) {
        const reverseMoved = Math.hypot(unit.x - prevX, unit.z - prevZ);
        unit._reverseStallT = reverseMoved < 0.005
            ? (unit._reverseStallT || 0) + dt
            : 0;
        if (unit._reverseStallT > 1.0) {
            const recovery = unit._truckRecoveryGoal;
            const goal = recovery.goal;
            unit._reverseStallT = 0;
            unit._truckRecoveryGoal = null;
            unit._reverseMove = false; unit._reversing = false;
            unit.currentSpeed = 0;
            unit.path = Game._restoreTruckRecovery(unit, recovery);
            unit.moving = unit.path.length > 0;
            if (!unit.path.length) unit._moveBlockedGoal = { x: goal.x, z: goal.z };
        }
    } else {
        unit._reverseStallT = 0;
    }

    // Solid hulls for foot troops: end the frame OUTSIDE any vehicle box. The
    // rate-capped push in applySeparation keeps the approach smooth, but a man
    // wedged by a crowd could still finish a frame inside the hull and vibrate
    // there; this exact final resolve makes contact stable — he stands AT the
    // armor (net displacement ~0, so the legs don't treadmill either).
    if (!isVeh && !isTruck && Game._tankBoxPush) {
        for (const o of Game.units) {
            if (!o.alive || o.id === unit.id || !Game.isTank(o.kind)) continue;
            if (Game.distSq(unit.x, unit.z, o.x, o.z) > 49) continue;
            const p = Game._tankBoxPush(unit.x, unit.z, o,
                unit.size * (isMounted ? 1.0 : 0.7), 0.05);
            if (p) { unit.x += p.x; unit.z += p.z; }
        }
    }

    // STUCK -> REPLAN: a unit with a live path that has made no real headway for a
    // while (wedged on terrain/units) throws away the stale route and plots a fresh
    // one to its destination ("stop resisting, here's a new path"). After a few failed
    // replans it gives up so it isn't grinding forever. Intentional waits (stop timer,
    // order delay, yielding to a crossing unit -> maxSpeed 0) don't count as stuck.
    if (unit.path && unit.path.length && maxSpeed > 0
        && (unit.stopTimer || 0) <= 0 && (unit.orderDelay || 0) <= 0 && !unit._reverseMove) {
        const moved = Math.hypot(unit.x - prevX, unit.z - prevZ);
        if (moved < 0.03) {
            unit._stuckT = (unit._stuckT || 0) + dt;
            // A recent failed recovery search put this unit on backoff: retrying
            // the same impossible goal every stall tick is what churned frames.
            if (unit._stuckT > 1.3
                && (Game.gameClock || 0) >= (unit._recoveryBlockedUntil || 0)) {
                unit._stuckT = 0;
                unit._stuckReplans = (unit._stuckReplans || 0) + 1;
                if (unit._stuckReplans > 2) {
                    if (isTruck) {
                        // A lorry cannot pivot at contact. Back up along its own
                        // axis to create steering room, then the arrival block above
                        // restores the original goal for a fresh forward approach.
                        const goal = unit.path[unit.path.length - 1];
                        const ext = Game._vehicleHalfExtents ? Game._vehicleHalfExtents(unit) : { hl: 1.8 };
                        const reverseDistance = Game.clamp(ext.hl * 0.75, 1.1, 1.8);
                        const reverseWp = {
                            x: Game.clamp(unit.x - Math.cos(unit.angle) * reverseDistance, 1, Game.WORLD_W - 1),
                            z: Game.clamp(unit.z - Math.sin(unit.angle) * reverseDistance, 1, Game.WORLD_H - 1),
                            _endTruckReverse: true,
                        };
                        const rearClear = !Game.segmentPassable || Game.segmentPassable(
                            unit, unit.x, unit.z, reverseWp.x, reverseWp.z, {
                                startAngle: unit.angle,
                                endAngle: unit.angle,
                                margin: 0.02,
                            });
                        if (rearClear) {
                            unit._truckRecoveryGoal = Game._captureTruckRecovery(unit);
                            unit._detour = null; unit._drvCmd = null;
                            unit._reverseMove = true; unit._reversing = true;
                            unit.currentSpeed = 0;
                            unit.path = [reverseWp];
                            unit.moving = true;
                        } else {
                            unit.currentSpeed = 0;
                            unit._recoveryBlockedUntil = (Game.gameClock || 0) + 1.0;
                        }
                        unit._stuckReplans = 0;
                    } else if (isVeh) {
                        // A vehicle stopped against a hull has not "arrived". Keep
                        // the player's destination, discard the stale local maneuver,
                        // and rebuild the route so it gets another wider approach.
                        const goal = unit.path[unit.path.length - 1];
                        unit._detour = null; unit._drvCmd = null;
                        unit.path = Game._vehicleRecoveryRoute(unit, goal, 'repeated-stall');
                        unit.moving = unit.path.length > 0;
                        unit._crawlT = Math.max(unit._crawlT || 0, 0.5);
                        unit._stuckReplans = 0;
                    } else {
                        // Packed infantry at an objective settle instead of churning.
                        unit.path = []; unit.moving = false; unit._stuckReplans = 0;
                    }
                } else {
                    unit._detour = null;
                    if (isTruck) {
                        // Rebuild every outstanding Shift stop, not merely the
                        // final node. Losing the prefix here made a briefly stuck
                        // truck jump directly to the last clicked destination.
                        // The multi-leg rebuild runs on the route queue: several
                        // trucks jammed together used to fire one synchronous
                        // compound A* each per stall tick.
                        const recovery = Game._captureTruckRecovery(unit);
                        if (Game.queueRouteJob) {
                            unit.path = [];
                            Game.queueRouteJob(unit, () => {
                                unit.path = Game._restoreTruckRecovery(unit, recovery);
                                unit.moving = unit.path.length > 0;
                                if (!unit.path.length) {
                                    unit._recoveryBlockedUntil = (Game.gameClock || 0) + 4 + Game.rand(0, 4);
                                }
                            });
                        } else {
                            unit.path = Game._restoreTruckRecovery(unit, recovery);
                        }
                    } else {
                        const goal = unit.path[unit.path.length - 1];
                        unit.path = Game._vehicleRecoveryRoute(unit, goal, 'stuck');
                    }
                    unit.moving = unit.path.length > 0;
                }
            }
        } else {
            unit._stuckT = 0; unit._stuckReplans = 0;
        }
    } else {
        unit._stuckT = 0;
    }

    // STALL GUARD (foot troops): no PROGRESS toward the next waypoint for
    // ~0.5s while commanded to move. Progress — not raw headway — is what's
    // measured: a man oscillating against a hull or a crowd racks up plenty of
    // displacement while going nowhere, which fooled the old headway test into
    // letting him jog on the spot forever. On a stall: stop, and if a hull is
    // the blocker, step around it on the goal side and RE-CHAIN the original
    // destination so the order isn't lost.
    if (!isVeh && !isTruck && unit.path && unit.path.length
        && (unit.currentSpeed || 0) > 0.4 && (unit.stopTimer || 0) <= 0) {
        const wp0 = unit.path[0];
        const dWp = Game.dist(unit.x, unit.z, wp0.x, wp0.z);
        if (unit._progWp !== wp0) { unit._progWp = wp0; unit._progBest = dWp; unit._progT = 0; }
        if (dWp < unit._progBest - 0.06) {
            unit._progBest = dWp; unit._progT = 0; unit._progReplans = 0;
        } else {
            unit._progT = (unit._progT || 0) + dt;
            if (unit._progT > 0.5) {
                unit._progT = 0; unit._progWp = null;
                const goal = unit.path[unit.path.length - 1];
                let hull = null;
                for (const o of Game.units) {
                    if (!o.alive || !Game.isTank(o.kind)) continue;
                    if (Game._tankBoxPush && Game._tankBoxPush(unit.x, unit.z, o,
                        unit.size * (isMounted ? 1.0 : 0.7), 0.7)) { hull = o; break; }
                }
                unit.path = []; unit.moving = false; unit.currentSpeed = 0;
                unit._progReplans = (unit._progReplans || 0) + 1;
                if (unit._progReplans > 2) {
                    // Repeatedly stalled: settle here rather than churn forever.
                } else if (hull) {
                    // Around the hull on whichever side leads toward the goal,
                    // then onward to the original destination.
                    const toHull = Game.angleTo(unit.x, unit.z, hull.x, hull.z);
                    let px = -Math.sin(toHull), pz = Math.cos(toHull);
                    if (goal && (goal.x - unit.x) * px + (goal.z - unit.z) * pz < 0) { px = -px; pz = -pz; }
                    const cl = hull.size * (Game.TANK_BOX_LEN || 1.5) + 1.6;
                    const sx = Game.clamp(hull.x + px * cl, 1, Game.WORLD_W - 1);
                    const sz = Game.clamp(hull.z + pz * cl, 1, Game.WORLD_H - 1);
                    const leg1 = Game.findPath(unit, unit.x, unit.z, sx, sz);
                    const leg2 = goal ? Game.findPath(unit, sx, sz, goal.x, goal.z) : [];
                    unit.path = leg1.concat(leg2);
                    unit.moving = unit.path.length > 0;
                } else if (goal && Game.dist(unit.x, unit.z, goal.x, goal.z) > 2.5) {
                    unit.path = Game.findPath(unit, unit.x, unit.z, goal.x, goal.z);
                    unit.moving = unit.path.length > 0;
                }
            }
        }
    } else {
        unit._progT = 0; unit._progWp = null;
    }

    // Measured ground speed this frame (includes separation shoves). The renderer
    // drives the leg animation from THIS, not from currentSpeed/moving flags, so a
    // man can never glide without his legs moving — and never runs on the spot.
    unit._dispSpeed = dt > 0 ? Math.hypot(unit.x - prevX, unit.z - prevZ) / dt : 0;

    if ((isVeh || isTruck) && Game.getVehicleHeight) {
        unit.y = Game.getVehicleHeight(unit.x, unit.z, unit.size, unit.angle);
    } else {
        unit.y = Game.getHeight(unit.x, unit.z);
    }

    if (unit._unloading && (!unit.path || !unit.path.length)) unit._unloading = false;

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
    if (Game.updateCavalryTransition && Game.updateCavalryTransition(unit, dt)) return;

    const M = Game.uMod;
    const ctx = {
        dt,
        prevX: unit.x, prevZ: unit.z, prevAngle: unit.angle,
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

    // During the first phase of dismounting, only the mounted driver runs so
    // the horse decelerates along its current heading. It cannot acquire a new
    // target or peel off toward cover before the dismount clip begins.
    if (unit._cavalryTransition?.phase === 'braking') {
        M.move(unit, ctx);
        return;
    }

    // Garrisoned infantry hold their position and fire from the windows: they
    // acquire + shoot (longer sight/range, hard cover) but never move or pursue.
    if (unit._garrisoned) {
        unit.path = []; unit.moving = false;
        M.scan(unit, ctx);
        // CLOSE ASSAULT from the windows: a man upstairs drops his AT grenade
        // bundle on enemy armor/vehicles that roll up beside the building —
        // the classic reason tanks should never push into a held town without
        // infantry. Same 2-bundle pocket as the field tank-hunter; works for
        // BOTH sides' garrisons; respects hold-fire.
        if (Game.isFootInfantry(unit) && !unit.holdFire && Game.spawnThrownGrenade) {
            unit._atGrenades = unit._atGrenades ?? 2;
            if (unit._atGrenades > 0 && (unit._atNext == null || Game.gameClock >= unit._atNext)) {
                let veh = null, bd = 8.5 * 8.5;
                for (const e of Game.units) {
                    if (!e.alive || e.team === unit.team) continue;
                    if (!(Game.isTank(e.kind) || Game.isTruck(e.kind))) continue;
                    const ed = Game.distSq(unit.x, unit.z, e.x, e.z);
                    if (ed < bd) { bd = ed; veh = e; }
                }
                if (veh) {
                    unit._atGrenades--;
                    unit._atNext = Game.gameClock + Game.rand(3.0, 5.0);
                    // short, low arc — it's a DROP from a window, not a field lob
                    Game.spawnThrownGrenade(unit.x, unit.z,
                        veh.x + Game.rand(-0.5, 0.5), veh.z + Game.rand(-0.5, 0.5),
                        { type: 'at', dmg: 45, blastR: 2.2, supp: 18, arc: 0.9, dur: 0.55 });
                    if (unit.team === Game.playerTeam) {
                        Game.pushMessage(`${unit.label} drops a grenade bundle from the window!`, 1.6);
                    }
                }
            }
        }
        M.fire(unit, ctx);
        return;
    }

    // A dismounted reserve rider ordered back to a parked horse treats it like
    // an entry destination: follow the assigned approach path without peeling
    // off to acquire targets or seek cover. updateCavalryHorseEntry validates,
    // re-paths and begins the mount transition on arrival.
    if (unit._enterHorseId) {
        unit.fireTargetId = null;
        unit._engageId = null;
        unit.forcedTargetId = null;
        M.move(unit, ctx);
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

    // Claim a completed ordinary move's final heading before autonomous cover
    // or target logic can replace the now-empty route. Attack-move still waits
    // for M.engage below to certify `_assaultGoal` completion, then activates in
    // M.move through the same guarded helper.
    if ((!unit.path || !unit.path.length) && Game.tryActivateArrivalFacing) {
        Game.tryActivateArrivalFacing(unit);
    }

    M.supply(unit, ctx);
    M.deploy(unit, ctx);
    M.scan(unit, ctx);
    if (M.bombard(unit, ctx)) {
        // Attack-ground can rotate a hull before the normal move module runs.
        // Pass that early-return pose through the same swept OBB authority so a
        // long tank cannot snap a corner through a neighbouring vehicle.
        if ((ctx.isVeh || Game.isTruck(unit.kind)) && Game._sweepVehicleMotion) {
            const sweep = Game._sweepVehicleMotion(
                unit, ctx.prevX, ctx.prevZ, ctx.prevAngle,
                unit.x, unit.z, unit.angle);
            unit.x = sweep.x; unit.z = sweep.z; unit.angle = sweep.angle;
            if (sweep.blocked) unit.currentSpeed = 0;
        }
        return;
    }
    M.engage(unit, ctx);
    if (unit.team !== Game.playerTeam) Game.updateAI(unit, dt, ctx.enemy);
    else if (M.takeCover) M.takeCover(unit, ctx);
    M.fire(unit, ctx);
    // Idle/ambient posture (rest, at-ease, ready). Runs just before move so a
    // roused soldier is on his feet before the move module reads his stance.
    if (M.ambient) M.ambient(unit, ctx);
    M.move(unit, ctx);
};

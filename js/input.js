/**
 * Under Fire — input.js
 * Mouse and keyboard event handlers, selection, player commands.
 * Uses Three.js raycasting for 3D selection.
 */

Game.selectedPlayerUnits = () =>
    Game.units.filter(u => u.alive && u.team === Game.playerTeam && Game.selection.has(u.id));

// Any player order that replaces a lorry's route also owns its maneuver state.
// Leaving an interrupted collision/pre-flight recovery alive lets the reverse
// watchdog resurrect the OLD destination after the new order has been issued.
Game.cancelTruckManeuver = (unit, resetPreflight = true) => {
    if (!Game.isTruck(unit.kind)) return;
    const wasReversing = !!(unit._reverseMove || unit._reversing);
    unit._truckRecoveryGoal = null;
    unit._reverseMove = false;
    unit._reversing = false;
    unit._reverseStallT = 0;
    unit._recoveryBlockedUntil = 0;
    unit._hullBlockT = 0;
    unit._hullBlockFor = null;
    if (resetPreflight) {
        unit._truckPreflightPath = null;
        unit._truckPreflightBackups = 0;
        unit._preflightRiskId = null;
    }
    // Never reinterpret residual reverse velocity as immediate forward motion.
    if (wasReversing) unit.currentSpeed = 0;
};

// Compute exactly ONE destination slot per selected unit for a group move to (wx,wz).
// Returns [{ unit, x, z }] — one entry per unit, each a distinct formation slot. The
// SAME function drives the on-ground preview circles and the actual move orders, so
// the circles are precisely where the units go. Vehicles are spread EVENLY across the
// formation (not clumped at the front), and every unit is matched to its nearest slot
// of the right kind to keep paths from crossing.
Game.computeFormationTargets = (chosen, wx, wz, faceAngle = null) => {
    const n = chosen.length;
    if (!n) return [];
    let cx = 0, cz = 0;
    chosen.forEach(u => { cx += u.x; cz += u.z; });
    cx /= n; cz /= n;
    // A directional drag explicitly owns the formation heading. Offsets use
    // local -Z as "forward" (notably the wedge leader), hence +PI/2 converts
    // the world-facing angle into the offset rotation. Ordinary clicks retain
    // the established travel-direction layout.
    const angle = Number.isFinite(faceAngle)
        ? faceAngle + Math.PI / 2
        : Math.atan2(wz - cz, wx - cx);
    const cosA = Math.cos(angle), sinA = Math.sin(angle);

    // Spacing must clear the biggest footprint so slots never overlap.
    let spacing = 2.5;
    for (const u of chosen) {
        if (Game.isTank(u.kind)) spacing = Math.max(spacing, (u.size || 1) * (Game.TANK_BOX_LEN || 1.5) * 2 * 0.85 + 0.8);
        else if (Game.isTruck(u.kind)) spacing = Math.max(spacing, (u.size || 1) * 2.4);
    }
    spacing = Math.min(spacing, 5.0);

    const offsets = Game.formationOffsets(n, spacing);
    const slots = offsets.map(o => ({
        x: Game.clamp(wx + o.x * cosA - o.z * sinA, 1, Game.WORLD_W - 1),
        z: Game.clamp(wz + o.x * sinA + o.z * cosA, 1, Game.WORLD_H - 1),
    }));

    const isVeh = u => Game.isTank(u.kind) || Game.isTruck(u.kind);
    const vehicles = chosen.filter(isVeh);
    const others = chosen.filter(u => !isVeh(u));
    const taken = new Array(n).fill(false);
    const out = [];

    // Pick a set of slot indices spread EVENLY across the formation for the vehicles
    // (so armor fans out across the area instead of bunching in the lead row).
    const vehSlots = [];
    if (vehicles.length) {
        for (let k = 0; k < vehicles.length; k++) {
            let idx = vehicles.length > 1 ? Math.round(k * (n - 1) / (vehicles.length - 1)) : Math.floor(n / 2);
            idx = Math.max(0, Math.min(n - 1, idx));
            while (taken[idx]) idx = (idx + 1) % n;
            taken[idx] = true; vehSlots.push(idx);
        }
    }
    // OFFSET-PRESERVING assignment: match a unit's position RELATIVE TO THE GROUP to a
    // slot's position RELATIVE TO THE DESTINATION, so the man on the left of the group
    // takes a left slot and nobody crosses the formation to reach a far slot (crossing
    // = collisions = units settling off their circle). Units with the most extreme
    // offset pick first so the corners claim the corner slots.
    const matchByOffset = (units, slotIdxs) => {
        const pool = slotIdxs.slice();
        units.slice()
            .sort((a, b) => ((b.x - cx) ** 2 + (b.z - cz) ** 2) - ((a.x - cx) ** 2 + (a.z - cz) ** 2))
            .forEach(u => {
                const ox = u.x - cx, oz = u.z - cz;
                let best = -1, bestD = Infinity;
                for (let i = 0; i < pool.length; i++) {
                    const sx = slots[pool[i]].x - wx, sz = slots[pool[i]].z - wz;
                    const d = (sx - ox) ** 2 + (sz - oz) ** 2;
                    if (d < bestD) { bestD = d; best = i; }
                }
                const si = pool.splice(best, 1)[0];
                out.push({ unit: u, x: slots[si].x, z: slots[si].z });
            });
    };
    matchByOffset(vehicles, vehSlots);
    const restSlots = [];
    for (let i = 0; i < n; i++) if (!taken[i]) restSlots.push(i);
    matchByOffset(others, restSlots);
    return out;
};

// Pending passengers remain selected while they walk to a transport. If that
// transport is selected with them, a map click is a command for the truck: the
// passengers must keep chasing its live tailgate instead of receiving the same
// ground destination. A move issued to the infantry without their carrier still
// cancels boarding normally.
Game.moveOrderParticipants = (units, mode = 'move') => {
    const chosen = [...(units || [])];
    if (mode !== 'move') return chosen;
    const movingCarriers = new Set(chosen
        .filter(u => u.alive && u.supportType === 'transport')
        .map(u => u.id));
    if (!movingCarriers.size) return chosen;
    return chosen.filter(u => !(Game.isFootInfantry(u)
        && u._enterCarrierId != null
        && movingCarriers.has(u._enterCarrierId)));
};

Game.issueCommand = (wx, wz, mode = 'move', unitList = null, queue = false,
    gather = false, facing = null) => {
    let chosen = Game.moveOrderParticipants(unitList || Game.selectedPlayerUnits(), mode);
    if (!chosen.length) return;
    const faceAngle = facing && Number.isFinite(facing.angle) ? facing.angle : null;
    // Supply / fuel trucks can't fight, so an attack-move STOPS them where they are
    // (and cancels any move they were still finishing) — they only obey plain Move
    // orders. Halt them, then drop them so the rest of the group advances without them.
    if (mode === 'attack') {
        for (const u of chosen) {
            if (Game.isTruck(u.kind)) {
                Game.cancelTruckManeuver(u);
                u.path = []; u.moving = false; u.orderMode = 'hold';
                u._groupMoveActive = false;
                u._arrivalFacing = null;
            }
        }
        chosen = chosen.filter(u => !Game.isTruck(u.kind));
        if (!chosen.length) return;
    }
    // Waypoint queuing (Shift + move): append a leg to the existing route
    // instead of replacing it. Only sensible for plain moves on units that are
    // already routed somewhere; otherwise it behaves like a normal move.
    queue = queue && mode === 'move';

    // One distinct destination slot PER unit — the very same slots drawn as preview
    // circles — with vehicles spread evenly across the formation. This is what makes
    // each selected unit go to its own circle and keeps tanks from clumping.
    // GATHER (SS2 Ctrl+Move): everyone converges on the point itself — as tight
    // as separation allows — instead of taking spread formation slots.
    const targets = gather
        ? chosen.map(u => ({ unit: u, x: wx, z: wz }))
        : Game.computeFormationTargets(chosen, wx, wz, faceAngle);
    const targetFor = new Map(targets.map(t => [t.unit.id, t]));

    // Group pace = the slowest member's EFFECTIVE speed, so armor/trucks wait for the
    // infantry. Foot troops carry a hidden 0.6 base factor (+ stance) that vehicles
    // don't, so compare like-for-like here and let the move module cap to this.
    const effSpeed = (u) => {
        let s = u.speed || 0;
        if (!Game.isTank(u.kind) && !Game.isTruck(u.kind)) {
            const stanceF = ({ prone: 0.28, crouch: 0.55, stand: 1.0, run: 1.5 })[u.stance] ?? 1.0;
            s *= 0.6 * stanceF;
        }
        return s;
    };
    let groupSpeed = Infinity;
    if (chosen.length > 1 && !queue) for (const u of chosen) groupSpeed = Math.min(groupSpeed, effSpeed(u));
    // Opt-in only: by default every unit travels at its own speed. The pace cap is
    // applied solely when the player has toggled "march together" on.
    const groupMove = Game.groupSpeedMatch && chosen.length > 1 && !queue && groupSpeed < Infinity && groupSpeed > 0;
    const orderSerial = Game._moveOrderSerial = (Game._moveOrderSerial || 0) + 1;
    let queuedAdded = 0;
    let queuedRejected = 0;

    chosen.forEach((unit, i) => {
        // A ground move/waypoint replaces a pending walk-to-horse order. Let the
        // cavalry runtime release the horse reservation as well as rider state.
        if (Game.cancelHorseMountOrder) Game.cancelHorseMountOrder(unit);
        // A new order also supersedes any route still waiting in the queue.
        if (Game.cancelQueuedPath) Game.cancelQueuedPath(unit);
        const isQueued = queue && unit.path && unit.path.length > 0;
        const previousTargetX = unit.targetX;
        const previousTargetZ = unit.targetZ;
        const previousMoveOrder = unit._lastMoveOrder;
        const previousArrivalFacing = unit._arrivalFacing;
        if (!isQueued && Game.isTruck(unit.kind)) {
            Game.cancelTruckManeuver(unit);
        }
        // A move order cancels any standing attack/bombard/facing/enter commitment.
        // (A queued leg keeps the unit rolling, so don't yank these mid-route — but
        // it's still a relocate, so clearing them is harmless and consistent.)
        unit.forcedTargetId = null;
        unit.bombardX = null; unit.bombardZ = null;
        unit._bombarding = false;
        unit._faceAngle = null; unit._faceUntil = 0;
        unit._enterRec = null;
        unit._enterCarrierId = null;
        if (Game.AI && Game.AI.clearPosture) Game.AI.clearPosture(unit); // ends guard/at-ease
        // Group pace cap: armor/trucks wait for the slowest member (cleared on arrival).
        if (groupMove && !isQueued) { unit._groupSpeed = groupSpeed; unit._groupMoveActive = true; }
        // This unit's assigned formation slot (matches its preview circle exactly).
        const t = targetFor.get(unit.id);
        const tx = t ? t.x : Game.clamp(wx, 1, Game.WORLD_W - 1);
        const tz = t ? t.z : Game.clamp(wz, 1, Game.WORLD_H - 1);
        unit.targetX = tx;
        unit.targetZ = tz;
        // Recorder context: preserve both the raw mouse click and this unit's
        // assigned formation goal, plus the vehicle pose at the instant ordered.
        // Per-frame samples can then explain a seemingly indirect route without
        // guessing the intended destination from the remaining path.
        unit._lastMoveOrder = {
            id: orderSerial, t: Game.gameClock || 0, mode,
            queue: isQueued ? 1 : 0,
            clickX: wx, clickZ: wz,
            startX: unit.x, startZ: unit.z, startA: unit.angle || 0,
            goalX: tx, goalZ: tz,
            faceX: facing && Number.isFinite(facing.x) ? facing.x : null,
            faceZ: facing && Number.isFinite(facing.z) ? facing.z : null,
            faceA: faceAngle,
        };
        if (isQueued) {
            const queuedStop = { id: orderSerial, x: tx, z: tz };
            if (Game.isTruck(unit.kind) && unit._reverseMove && unit._truckRecoveryGoal) {
                // A collision/pre-flight reverse temporarily replaces the visible
                // path with one short backup node. Shift waypoints belong after the
                // saved player route, not after that temporary node; otherwise the
                // recovery restore silently discards them.
                const recovery = unit._truckRecoveryGoal;
                recovery.stops = recovery.stops || [];
                const from = recovery.stops[recovery.stops.length - 1]
                    || { x: unit.x, z: unit.z, _pathAngle: unit.angle || 0 };
                const before = recovery.stops.length > 1
                    ? recovery.stops[recovery.stops.length - 2] : null;
                const fromAngle = from._pathAngle ?? (before
                    ? Math.atan2(from.z - before.z, from.x - before.x)
                    : unit.angle || 0);
                const validationLeg = Game.findPath(
                    unit, from.x, from.z, tx, tz, fromAngle);
                if (!validationLeg.length) {
                    unit.targetX = previousTargetX;
                    unit.targetZ = previousTargetZ;
                    unit._lastMoveOrder = previousMoveOrder;
                    queuedRejected++;
                    return;
                }
                queuedStop._pathAngle = validationLeg[validationLeg.length - 1]._pathAngle
                    ?? Math.atan2(tz - from.z, tx - from.x);
                recovery.stops.push(queuedStop);
                recovery.goal = { x: tx, z: tz };
                queuedAdded++;
            } else {
                // Append a leg from the current end of the route (skip the live
                // detour waypoint if one is in front) so stops remain ordered.
                const route = unit.path.filter(p => !p._detour);
                const from = route.length ? route[route.length - 1] : { x: unit.x, z: unit.z };
                const before = route.length > 1 ? route[route.length - 2] : null;
                const fromAngle = from._pathAngle ?? (before
                    ? Math.atan2(from.z - before.z, from.x - before.x)
                    : unit.angle || 0);
                const leg = Game.findPath(unit, from.x, from.z, tx, tz, fromAngle);
                if (!leg.length) {
                    unit.targetX = previousTargetX;
                    unit.targetZ = previousTargetZ;
                    unit._lastMoveOrder = previousMoveOrder;
                    queuedRejected++;
                    return;
                }
                leg[leg.length - 1]._orderStop = queuedStop;
                unit.path = route.concat(leg);
                queuedAdded++;
            }
        } else {
            const crowFlies = Math.hypot(tx - unit.x, tz - unit.z);
            if ((Game.isTank(unit.kind) || Game.isTruck(unit.kind))
                && Game.queueVehiclePath && crowFlies > 20) {
                // Long vehicle hauls compute on the route queue's frame budget
                // instead of freezing the click (one synchronous full-hull A*
                // per selected vehicle was the mass-order stall). The unit
                // holds via _routePending until its route lands.
                unit.path = [];
                Game.queueVehiclePath(unit, tx, tz, (path) => {
                    if (unit._lastMoveOrder?.id !== orderSerial) return;   // superseded
                    unit.path = path;
                    if (path.length) {
                        path[path.length - 1]._orderStop = { id: orderSerial, x: tx, z: tz };
                        unit.stopTimer = 0;
                    }
                });
            } else {
                unit.path = Game.findPath(unit, unit.x, unit.z, tx, tz);
                if (unit.path.length) unit.path[unit.path.length - 1]._orderStop = {
                    id: orderSerial, x: tx, z: tz,
                };
            }
            if (queue) {
                if (unit.path.length || unit._routePending) queuedAdded++;
                else {
                    unit.targetX = previousTargetX;
                    unit.targetZ = previousTargetZ;
                    unit._lastMoveOrder = previousMoveOrder;
                    unit._arrivalFacing = previousArrivalFacing;
                    queuedRejected++;
                    return;
                }
            }
        }
        // Store the terminal heading separately from the live path. Infantry
        // and attack-move may rebuild their path without preserving waypoint
        // metadata; the order id + goal guard keeps this intent authoritative
        // until genuine arrival. A later accepted plain/queued click clears it.
        // A pathless command is accepted only when already at the normal stop
        // radius. The broader crowded-settle radius is for a route that really
        // ran and later had to settle around friendly bodies, not an initially
        // unreachable point on the far side of an obstacle.
        const facingRadius = Game.isTank(unit.kind) || Game.isTruck(unit.kind)
            ? 2.0 : (unit._cavalryMounted ? 1.0 : 0.8);
        const facingRouteAccepted = unit.path.length > 0 || unit._routePending
            || Game.dist(unit.x, unit.z, tx, tz) <= facingRadius;
        unit._arrivalFacing = faceAngle != null && facingRouteAccepted ? {
            orderId: orderSerial,
            goalX: tx,
            goalZ: tz,
            angle: faceAngle,
        } : null;
        // Attack-move: advance to the area but stop to engage any enemy that comes
        // into range, then push on. A plain move is a RELOCATE order: obey it and
        // get to the destination, do NOT stop to fight or chase (it can still
        // return fire on the move, but never halts/diverts). Hold = put-and-defend.
        if (mode === 'attack') {
            unit.orderMode = 'assault'; unit.holdFire = false;
            // Remember WHERE the attack-move is headed. The engage module clears the
            // path to stop and fight when an enemy comes into range; without this the
            // unit would just sit where the last enemy fell. With it, once the local
            // fight is over it resumes the advance to the ordered spot (the red circle).
            unit._assaultGoal = { x: tx, z: tz };
        }
        else if (mode === 'hold') { unit.orderMode = 'hold'; unit._assaultGoal = null; }
        else {
            // Plain move. Reset any standing 'assault'/forced-target lock so the
            // engage module can't halt the unit when an enemy is in range — this
            // is what made a tank under fire "not listen" and refuse to pull back.
            unit.orderMode = 'move';
            unit._assaultGoal = null;
            unit._engageId = null;
            unit._inFiringPos = false;
            unit._pursueAnchor = null;
            unit._pursueTimer = 0;
        }
        // Reverse-into-spot: a plain Move to a SHORT distance BEHIND a vehicle backs
        // it in rather than swinging the whole hull around. Tanks + trucks only.
        // A Shift click must not cancel a reverse already in progress. This is
        // especially important for a recovery backup, whose saved route will be
        // restored when the temporary reverse node completes.
        if (!isQueued) unit._reverseMove = false;
        if (mode === 'move' && !isQueued
            && (Game.isTank(unit.kind) || Game.isTruck(unit.kind))) {
            const gAng = Math.atan2(tz - unit.z, tx - unit.x);
            const gd = Math.hypot(tx - unit.x, tz - unit.z);
            // In contact with an enemy roughly ahead of the hull, prefer backing
            // out for longer and shallower rearward moves too — a real crew
            // reverses rather than swinging its side armor across the gun.
            let revDist = Game.REVERSE_MAX_DIST ?? 11, revAng = 1.9;
            const foe = unit.fireTargetId != null ? Game.getUnitById(unit.fireTargetId) : null;
            if (foe && foe.alive
                && Math.abs(Game.angleDiff(unit.angle, Game.angleTo(unit.x, unit.z, foe.x, foe.z))) < 0.9) {
                revDist = 18; revAng = 1.6;
            }
            if (gd < revDist && Math.abs(Game.angleDiff(unit.angle, gAng)) > revAng) {
                unit._reverseMove = true;
                // Back STRAIGHT into the spot: replace A*'s tile-snapped, slightly
                // curved short path with a single direct segment to the exact point.
                // The curve was making the lorry steer through extra lanes and never
                // cleanly settle on the goal. A short reverse is a clear, direct back-up.
                const reverseStop = unit.path[unit.path.length - 1]?._orderStop
                    || { id: orderSerial, x: tx, z: tz };
                unit.path = [{
                    x: tx, z: tz,
                    _pathAngle: unit.angle || 0,
                    _orderStop: reverseStop,
                    _endPlayerReverse: true,
                }];
            }
        }
        // Combat readiness: a plain Move travels "weapons stowed" — the unit needs
        // a moment to react to contact. Attack-move advances already ready. A
        // queued leg keeps whatever readiness it already had (no re-stow stall).
        if (mode === 'move' && !isQueued) { unit._combatReady = false; unit._readyTimer = 0; }
        else if (mode !== 'move') unit._combatReady = true;
        unit.moving = true;
        unit.stopTimer = 0;
        // Don't re-impose the command reaction delay on a queued leg — the unit is
        // already rolling and just gets another waypoint tacked on.
        if (!isQueued) unit.orderDelay = Game.commandDelay(unit);
        // Pulsing destination marker: red attack-move, green move, cyan queued waypoint.
        Game.spawnOrderMarker(tx, tz, mode === 'attack' ? 0xff5544 : (isQueued ? 0x55ccff : 0x88cc66));
    });
    if (queue) {
        if (queuedAdded && queuedRejected) {
            Game.pushMessage(`${queuedAdded} waypoint${queuedAdded === 1 ? '' : 's'} added; ${queuedRejected} had no clear route.`, 2.0);
        } else if (queuedAdded) {
            Game.pushMessage(queuedAdded === 1 ? 'Waypoint added.' : `${queuedAdded} waypoints added.`, 1.8);
        } else {
            Game.pushMessage('No clear route to that waypoint.', 1.8);
        }
    } else {
        Game.pushMessage(mode === 'attack' ? 'Attack-move ordered.' : 'Move ordered.', 1.8);
    }
    if (Game.Audio) {
        const anyTank = chosen.some(u => Game.isTank(u.kind));
        const voice = mode === 'attack'
            ? (anyTank ? 'f_tank_attack' : 'f_sold_attack')
            : (anyTank ? 'f_tank_move' : 'f_sold_move');
        Game.Audio.voice(voice);
    }

    // Clear preview markers
    Game._clearFormationPreview();
};

// Final-facing orders survive route replans, but activate only when the matching
// player order has genuinely reached its own destination.
Game.arrivalFacingRadius = (unit) => {
    if (Game.isTank(unit.kind) || Game.isTruck(unit.kind)) return 2.2;
    if (unit._cavalryMounted) return 2.2;
    // Matches uMod.move's accepted crowded-settle radius and also covers the
    // 2.2u attack-move completion threshold.
    return 3.2;
};

Game.clearArrivalFacing = (unit) => {
    if (unit) unit._arrivalFacing = null;
};

Game.tryActivateArrivalFacing = (unit) => {
    const facing = unit && unit._arrivalFacing;
    if (!facing) return false;
    const order = unit._lastMoveOrder;
    if (!order || order.id !== facing.orderId) {
        unit._arrivalFacing = null;
        return false;
    }
    if (unit.path && unit.path.length) return false;
    // Attack-move owns temporary pathless combat pauses. Its resume logic clears
    // _assaultGoal only after the objective itself is accepted as reached.
    if (unit.orderMode === 'assault' && unit._assaultGoal) return false;
    if (Game.dist(unit.x, unit.z, facing.goalX, facing.goalZ)
        > Game.arrivalFacingRadius(unit)) return false;

    unit._faceAngle = facing.angle;
    unit._faceUntil = (Game.gameClock || 0) + 4;
    unit._faceGoal = null;
    unit._arrivalFacing = null;
    unit._groupMoveActive = false;
    unit._engageId = null;
    unit._engageTarget = null;
    unit.moving = false;
    unit.stopTimer = Math.max(unit.stopTimer || 0, 0.1);
    return true;
};

Game.directionalOrderNearby = (chosen, wx, wz) => {
    if (!chosen || !chosen.length) return false;
    let cx = 0, cz = 0;
    chosen.forEach(unit => { cx += unit.x; cz += unit.z; });
    cx /= chosen.length;
    cz /= chosen.length;
    return Game.dist(cx, cz, wx, wz) <= 2.25;
};

Game.issueDirectionalCommand = (wx, wz, faceX, faceZ, options = {}) => {
    const units = (options.units || Game.selectedPlayerUnits())
        .filter(unit => unit.alive && unit.team === Game.playerTeam);
    const queue = !!options.queue;
    const gather = !!options.gather;
    const mode = queue || gather
        ? 'move' : (options.mode === 'attack' ? 'attack' : 'move');
    const chosen = Game.moveOrderParticipants(units, mode);
    const dx = faceX - wx, dz = faceZ - wz;
    if (!chosen.length || Math.hypot(dx, dz) < 0.35) return false;
    const angle = Math.atan2(dz, dx);

    // A drag anchored beside the current formation is a facing adjustment, not
    // an instruction to shuffle every unit into freshly generated slots.
    if (!queue && !gather && Game.directionalOrderNearby(chosen, wx, wz)) {
        Game.orderFaceAngle(angle, wx, wz, chosen, { x: faceX, z: faceZ });
        return true;
    }

    if (mode === 'attack') chosen.forEach(unit => {
        unit.bombardX = null;
        unit.bombardZ = null;
        unit._bombarding = false;
    });
    Game.issueCommand(wx, wz, mode, chosen, queue, gather, {
        x: faceX,
        z: faceZ,
        angle,
    });
    return true;
};

/**
 * Set the persistent right-click order stance ('move' or 'attack') and reflect
 * it in the HUD switch + the battlefield cursor.
 */
Game.setOrderStance = (stance) => {
    Game.orderStance = stance === 'attack' ? 'attack' : 'move';
    document.querySelectorAll('.stance-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.stance === Game.orderStance));
    // Cursor is synced each frame in the game loop (covers stance + targeting modes).
    Game.pushMessage(Game.orderStance === 'attack'
        ? 'Attack-move: units advance ready and engage.'
        : 'Move: units relocate without seeking combat.', 1.6);
};

// Toggle "march together" pace matching. OFF (default) = every unit moves at its
// own speed; ON = a mixed group holds the slowest member's pace.
Game.toggleGroupPace = () => {
    Game.groupSpeedMatch = !Game.groupSpeedMatch;
    const btn = document.getElementById('paceBtn');
    if (btn) btn.classList.toggle('active', Game.groupSpeedMatch);
    if (!Game.groupSpeedMatch) Game.units.forEach(u => { u._groupMoveActive = false; }); // release any active cap
    Game.pushMessage(Game.groupSpeedMatch
        ? 'March together: the group holds the slowest unit’s pace.'
        : 'March: each unit moves at its own speed.', 1.8);
};

/**
 * Attack-move to a ground spot: EVERY selected unit advances to the area and
 * engages enemies it meets along the way. Mortars move too (they do not bombard
 * the spot here — deliberate area fire is the separate "Attack Ground" order).
 */
Game.orderAttackMove = (x, z) => {
    const chosen = Game.selectedPlayerUnits();
    if (!chosen.length) return;
    chosen.forEach(u => { u.bombardX = null; u.bombardZ = null; u._bombarding = false; });
    Game.issueCommand(x, z, 'attack', chosen);
};

/**
 * Retreat: force the selected units to break off the fight and fall back to a
 * point. They stop acquiring targets (no firing), infantry sprint, and tanks
 * reverse out of contact keeping their front toward the threat.
 */
Game.orderRetreat = (x, z) => {
    const chosen = Game.selectedPlayerUnits();
    if (!chosen.length) return;
    const tx = Game.clamp(x, 1, Game.WORLD_W - 1), tz = Game.clamp(z, 1, Game.WORLD_H - 1);
    chosen.forEach(u => {
        if (Game.cancelHorseMountOrder) Game.cancelHorseMountOrder(u);
        Game.clearArrivalFacing(u);
        u.forcedTargetId = null;
        u.bombardX = null; u.bombardZ = null; u._bombarding = false;
        u._enterRec = null;
        u._enterCarrierId = null;
        u._assaultGoal = null;
        if (Game.AI && Game.AI.clearPosture) Game.AI.clearPosture(u);
        u.orderMode = 'retreat';
        u.retreating = true;
        const threat = (u._engageId != null ? Game.getUnitById(u._engageId) : null) || Game.nearestEnemy(u);
        u._retreatThreat = (threat && threat.alive) ? { x: threat.x, z: threat.z } : null;
        if (Game.isFootInfantry(u)) { u.stance = 'run'; u._autoStance = true; }
        if (Game.cancelQueuedPath) Game.cancelQueuedPath(u);
        if ((Game.isTank(u.kind) || Game.isTruck(u.kind)) && Game.queueVehiclePath
            && Game.dist(u.x, u.z, tx, tz) > 20) {
            // Long vehicle fallback routes go through the frame-budgeted queue
            // like ordinary moves; the hull holds until its route lands.
            u.path = [];
            Game.queueVehiclePath(u, tx, tz, (path) => {
                if (u.orderMode !== 'retreat' || !u.retreating) return;   // superseded
                u.path = path;
            });
        } else {
            u.path = Game.findPath(u, u.x, u.z, tx, tz);
        }
        u.moving = true;
        u.stopTimer = 0;
        u.orderDelay = 0;
    });
    Game.spawnOrderMarker(x, z, 0x44aaff); // blue = retreat
    Game.pushMessage('Retreat — break off and fall back!', 1.8);
    if (Game.Audio) Game.Audio.voice('f_sold_move');
    Game._clearFormationPreview();
};

/**
 * Attack Ground: each selected armed unit takes up a firing position within
 * range + line of sight of the spot and pours fire onto it. Mortars/indirect
 * lob shells; direct-fire units (tanks, MGs, rifles) suppress the area. They do
 * NOT walk onto the spot — they shoot AT it.
 */
Game.orderAttackGround = (x, z) => {
    const chosen = Game.selectedPlayerUnits();
    if (!chosen.length) return;
    let any = false;
    chosen.forEach(u => {
        const w = Game.WEAPONS[u.weaponKey];
        if (!w || w.fireType === 'none' || (w.gameRange || 0) <= 0) return; // unarmed
        any = true;
        if (Game.cancelHorseMountOrder) Game.cancelHorseMountOrder(u);
        Game.clearArrivalFacing(u);
        u._enterRec = null;
        u._enterCarrierId = null;
        if (Game.AI && Game.AI.clearPosture) Game.AI.clearPosture(u);
        u.bombardX = x; u.bombardZ = z;
        u.forcedTargetId = null;
        u.orderMode = 'aggressive';
        u.holdFire = false;
        u._bombarding = false;
        u._combatReady = true;
        u.stopTimer = 0;
        u.orderDelay = Game.commandDelay(u);
    });
    if (any) {
        Game.spawnOrderMarker(x, z, 0xff8844); // orange = fire on ground
        Game.pushMessage('Attack ground — suppressing the area.', 1.6);
        if (Game.Audio) {
            const anyTank = chosen.some(u => Game.isTank(u.kind));
            Game.Audio.voice(anyTank ? 'f_tank_attack' : 'f_sold_attack');
        }
    }
    Game._clearFormationPreview();
};

/**
 * Command-and-control delay (GDD): orders are immediate for usability but
 * low-cohesion units react slower. Suppression lengthens the delay; a nearby
 * officer almost eliminates it; French radio cohesion is slightly worse.
 */
Game.commandDelay = (unit) => {
    let base = Game.isTank(unit.kind) ? 0.18 : 0.1;
    const supp = (unit.suppressionValue || 0) / 100;
    let delay = base + supp * 0.6;
    const nearOfficer = Game.units.some(o => o.alive && o.team === unit.team
        && o.supportType === 'officer' && Game.dist(o.x, o.z, unit.x, unit.z) < 12);
    if (nearOfficer) delay *= 0.3;
    else if (unit.team === Game.TEAM.FRENCH) delay *= 1.15;
    return Game.clamp(delay, 0, 1.0);
};

// Nearest enemy (of the player) to a world point, within pick radius.
// Fog-gated: an enemy the player hasn't currently spotted can't be picked, so
// clicking blind into the fog issues a ground order instead of silently
// "homing" onto a hidden unit and giving its position away.
Game.enemyAtWorld = (x, z) => {
    let best = null, bestD = Infinity;
    for (const u of Game.units) {
        if (!u.alive || u.team === Game.playerTeam) continue;
        if (Game.isFogVisible && !Game.isFogVisible(u.x, u.z)) continue;
        const d = Game.distSq(x, z, u.x, u.z);
        const pick = Math.max((u.size + 0.9) * (u.size + 0.9), 3.5);
        if (d < pick && d < bestD) { bestD = d; best = u; }
    }
    return best;
};

/**
 * Force selected units to attack a specific enemy.
 * Direct-fire units commit to the target and close to weapon range;
 * mortars bombard the target's position. Unarmed units are ignored.
 */
Game.orderAttackTarget = (target) => {
    const chosen = Game.selectedPlayerUnits();
    if (!chosen.length || !target) return;
    let any = false;
    let futile = 0;
    chosen.forEach(u => {
        const w = Game.WEAPONS[u.weaponKey];
        if (!w || w.fireType === 'none' || (w.gameRange || 0) <= 0) return; // unarmed
        // Rifles cannot stop armor: foot infantry refuse a plain attack order
        // on a target their small arms cannot hurt. The deliberate close
        // assault is the double right-click order instead.
        if (w.fireType !== 'indirect'
            && Game.isFootInfantry && Game.isFootInfantry(u)
            && Game.unitCanHurt && !Game.unitCanHurt(u, target)) {
            futile++;
            return;
        }
        any = true;
        if (Game.cancelHorseMountOrder) Game.cancelHorseMountOrder(u);
        Game.clearArrivalFacing(u);
        u._enterRec = null;
        u._enterCarrierId = null;
        if (Game.AI && Game.AI.clearPosture) Game.AI.clearPosture(u);
        if (w.fireType === 'indirect') {
            u.bombardX = target.x; u.bombardZ = target.z;
            u.forcedTargetId = null;
            return;
        }
        u.forcedTargetId = target.id;
        u.bombardX = null; u.bombardZ = null;
        u.orderMode = 'aggressive';
        u.holdFire = false;
        u._combatReady = true; // explicit attack — engage on contact
        if (Game.cancelQueuedPath) Game.cancelQueuedPath(u);
        const d = Game.dist(u.x, u.z, target.x, target.z);
        if (d > u.range * 0.9) {
            // Close to within weapon range, approaching from our side
            const ang = Game.angleTo(target.x, target.z, u.x, u.z);
            const standoff = u.range * 0.75;
            const gx = Game.clamp(target.x + Math.cos(ang) * standoff, 1, Game.WORLD_W - 1);
            const gz = Game.clamp(target.z + Math.sin(ang) * standoff, 1, Game.WORLD_H - 1);
            if ((Game.isTank(u.kind) || Game.isTruck(u.kind)) && Game.queueVehiclePath
                && Game.dist(u.x, u.z, gx, gz) > 20) {
                // Long armored approaches queue like ordinary moves; the
                // engage module takes over pursuit once the route lands.
                u.path = [];
                // Prime the pursuit anchor so the engage module treats the
                // queued approach as fresh instead of instantly re-planning.
                u._pursueAnchor = { x: target.x, z: target.z };
                u._pursueTimer = 1.2;
                Game.queueVehiclePath(u, gx, gz, (path) => {
                    if (u.forcedTargetId !== target.id) return;   // superseded
                    u.path = path;
                });
            } else {
                u.path = Game.findPath(u, u.x, u.z, gx, gz);
            }
            u.moving = true;
            u.orderDelay = Game.commandDelay(u);
        } else {
            u.path = []; u.moving = false;
        }
        u.stopTimer = 0;
    });
    if (any) {
        Game.spawnOrderMarker(target.x, target.z, 0xff5544); // red = attack
        Game.pushMessage('Attacking target!', 1.5);
        if (Game.Audio) {
            const anyTank = chosen.some(u => Game.isTank(u.kind));
            Game.Audio.voice(anyTank ? 'f_tank_attack' : 'f_sold_attack');
        }
    }
    if (futile) {
        Game.pushMessage('Small arms cannot stop armor. Double right-click it to close assault with grenade bundles.', 2.6);
    }
    Game._clearFormationPreview();
};

// Double right-click on an armored vehicle: foot infantry charge it and lob
// AT grenade bundles from short range (the engage module runs the assault).
// Returns false when nothing armored/no infantry, so the caller falls back to
// the ordinary attack order.
Game.orderGrenadeCharge = (target) => {
    if (!target || !target.alive) return false;
    const stats = Game.UNIT_STATS[target.statKey] || {};
    if (!stats.armor) return false;   // soft target: a normal attack works
    const chargers = Game.selectedPlayerUnits().filter(u =>
        Game.isFootInfantry(u) && !u._garrisoned && u._inVehicle == null);
    if (!chargers.length) return false;
    chargers.forEach(u => {
        if (Game.cancelHorseMountOrder) Game.cancelHorseMountOrder(u);
        Game.clearArrivalFacing(u);
        u._enterRec = null;
        u._enterCarrierId = null;
        if (Game.AI && Game.AI.clearPosture) Game.AI.clearPosture(u);
        u.forcedTargetId = target.id;
        u._grenadeChargeId = target.id;
        u._atGrenades = u._atGrenades ?? 2;
        u.bombardX = null; u.bombardZ = null;
        u.orderMode = 'aggressive';
        u.holdFire = false;
        u._combatReady = true;
        u.path = Game.findPath(u, u.x, u.z, target.x, target.z);
        u.moving = true;
        u.orderDelay = Game.commandDelay(u);
        u.stopTimer = 0;
        u._pursueAnchor = { x: target.x, z: target.z };
        u._pursueTimer = 1.0;
    });
    Game.spawnOrderMarker(target.x, target.z, 0xff5544);
    Game.pushMessage(`Close assault! ${chargers.length} soldier${chargers.length === 1 ? '' : 's'} charging the armor with grenade bundles.`, 2.4);
    if (Game.Audio) Game.Audio.voice('f_sold_attack');
    Game._clearFormationPreview();
    return true;
};

// Right-clicking an enemy: a quick second click on the SAME armored target
// upgrades the order to a grenade close assault for the selected infantry.
Game._attackOrCharge = (target) => {
    const now = performance.now();
    const dbl = Game._lastAtkRC && Game._lastAtkRC.id === target.id
        && (now - Game._lastAtkRC.t) < 400;
    Game._lastAtkRC = { id: target.id, t: now };
    if (dbl && Game.orderGrenadeCharge && Game.orderGrenadeCharge(target)) return;
    Game.orderAttackTarget(target);
};

// ── Order Destination Markers (pulse where troops will move to) ──
Game._orderMarkers = [];

Game.spawnOrderMarker = (x, z, color = 0x88cc66) => {
    const THREE = Game.THREE;
    if (!THREE || !Game.scene) return;
    const y = (Game.getHeight ? Game.getHeight(x, z) : 0) + 0.12;

    const group = new THREE.Group();
    group.position.set(x, y, z);

    const ringGeo = new THREE.RingGeometry(0.3, 0.45, 20);
    const ringMat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.9,
        depthWrite: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);

    // Expanding pulse wave ring
    const pulseGeo = new THREE.RingGeometry(0.42, 0.52, 20);
    const pulseMat = ringMat.clone();
    pulseMat.opacity = 0.6;
    const pulse = new THREE.Mesh(pulseGeo, pulseMat);
    pulse.rotation.x = -Math.PI / 2;
    group.add(pulse);

    group.traverse(o => { o.raycast = () => { }; }); // don't block ground picking
    Game.scene.add(group);
    Game._orderMarkers.push({ group, ring, pulse, life: 1.1, total: 1.1 });
};

Game.updateOrderMarkers = (dt) => {
    for (let i = Game._orderMarkers.length - 1; i >= 0; i--) {
        const m = Game._orderMarkers[i];
        m.life -= dt;
        if (m.life <= 0) {
            Game.scene.remove(m.group);
            m.group.children.forEach(c => { c.geometry.dispose(); c.material.dispose(); });
            Game._orderMarkers.splice(i, 1);
            continue;
        }
        const t = m.total - m.life;
        const fade = Math.min(1, m.life / 0.5);   // fade out over the last 0.5s
        const pop = Math.min(1, t / 0.15);        // quick pop-in
        m.ring.scale.setScalar(0.7 + 0.3 * pop);
        m.ring.material.opacity = 0.9 * fade;

        // single pulse wave: expands once and fades out
        const wave = Math.min(1, t / 0.7);
        m.pulse.scale.setScalar(1 + wave * 1.6);
        m.pulse.material.opacity = (1 - wave) * 0.55 * fade;
    }
};

// ── Formation Preview Markers ──
Game._formationPreviews = [];
Game._rightOrderArrow = null;

Game._clearFormationPreview = () => {
    Game._formationPreviews.forEach(m => {
        if (m.parent) m.parent.remove(m);
        m.geometry.dispose();
        m.material.dispose();
    });
    Game._formationPreviews = [];
};

Game._clearRightOrderArrow = () => {
    if (Game._rightOrderArrow) Game._rightOrderArrow.visible = false;
};

Game._showRightOrderArrow = (origin, tip, stance = 'move') => {
    const THREE = Game.THREE;
    if (!THREE || !Game.scene || !origin || !tip) return;
    const startY = (Game.getHeight ? Game.getHeight(origin.x, origin.z) : 0) + 0.35;
    const endY = (Game.getHeight ? Game.getHeight(tip.x, tip.z) : 0) + 0.35;
    const delta = new THREE.Vector3(tip.x - origin.x, endY - startY, tip.z - origin.z);
    const length = delta.length();
    if (length < 0.01) {
        Game._clearRightOrderArrow();
        return;
    }
    const color = stance === 'attack' ? 0xff5544 : 0x88ff77;
    const direction = delta.normalize();
    const headLength = Math.min(1.2, Math.max(0.3, length * 0.28), length * 0.48);
    const headWidth = Math.min(0.75, Math.max(0.22, headLength * 0.58));
    let arrow = Game._rightOrderArrow;
    if (!arrow || !arrow.parent) {
        arrow = new THREE.ArrowHelper(direction,
            new THREE.Vector3(origin.x, startY, origin.z),
            length, color, headLength, headWidth);
        arrow.traverse(object => {
            object.raycast = () => { };
            object.renderOrder = 1000;
            if (object.material) {
                object.material.transparent = true;
                object.material.opacity = 0.95;
                object.material.depthTest = false;
                object.material.depthWrite = false;
            }
        });
        Game.scene.add(arrow);
        Game._rightOrderArrow = arrow;
    } else {
        arrow.position.set(origin.x, startY, origin.z);
        arrow.setDirection(direction);
        arrow.setLength(length, headLength, headWidth);
        arrow.setColor(color);
    }
    arrow.visible = true;
};

Game._showFormationPreview = (wx, wz, faceAngle = null, unitList = null,
    gather = false, stance = Game.orderStance, rotateOnly = false) => {
    Game._clearFormationPreview();
    const attackMode = stance === 'attack';
    const chosen = Game.moveOrderParticipants(
        unitList || Game.selectedPlayerUnits(), attackMode ? 'attack' : 'move');
    if (!chosen.length) return;

    const THREE = Game.THREE;
    // Red preview when attack-move is armed (advance + engage), green for a plain
    // move — matches the destination order-marker colours.
    const ringColor = attackMode ? 0xff5544 : 0x88cc66;

    // Draw one circle at EACH unit's actual assigned slot (same computation the move
    // uses), so what you see is exactly where each unit will go. Vehicle slots get a
    // bigger ring to read as armor positions.
    const targets = rotateOnly
        ? chosen.map(unit => ({ unit, x: unit.x, z: unit.z }))
        : gather
        ? chosen.map(unit => ({ unit, x: wx, z: wz }))
        : Game.computeFormationTargets(chosen, wx, wz, faceAngle);
    targets.forEach(t => {
        const px = t.x, pz = t.z;
        const py = Game.getHeight ? Game.getHeight(px, pz) : 0;
        const veh = Game.isTank(t.unit.kind) || Game.isTruck(t.unit.kind);
        const r = veh ? (t.unit.size || 1) * 0.7 : 0.4;
        const geo = new THREE.RingGeometry(r - 0.15, r, 16);
        const mat = new THREE.MeshBasicMaterial({
            color: ringColor,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        const marker = new THREE.Mesh(geo, mat);
        marker.rotation.x = -Math.PI / 2;
        marker.position.set(px, py + 0.15, pz);
        Game.scene.add(marker);
        Game._formationPreviews.push(marker);
    });
};

/**
 * Rotate: turn the selected units in place to face a point. Sets a persistent
 * desired facing (held briefly) so the turn is actually carried out by the move
 * module instead of being snapped and instantly overwritten by path/aim logic.
 * Tanks swing hull + turret; infantry/guns pivot to face.
 */
Game.orderFaceAngle = (angle, markerX, markerZ, unitList = null, facePoint = null) => {
    const chosen = (unitList || Game.selectedPlayerUnits())
        .filter(unit => unit.alive && unit.team === Game.playerTeam);
    if (!chosen.length || !Number.isFinite(angle)) return;
    const orderSerial = Game._moveOrderSerial = (Game._moveOrderSerial || 0) + 1;
    chosen.forEach(unit => {
        if (Game.cancelHorseMountOrder) Game.cancelHorseMountOrder(unit);
        Game.cancelTruckManeuver(unit);
        Game.clearArrivalFacing(unit);
        unit._faceAngle = angle;
        unit._faceUntil = (Game.gameClock || 0) + 4;
        unit._faceGoal = null;
        unit.path = [];
        unit.moving = false;
        unit.forcedTargetId = null;
        unit._engageId = null;
        unit._engageTarget = null;
        unit.bombardX = null;
        unit.bombardZ = null;
        unit._bombarding = false;
        unit.stopTimer = Math.max(unit.stopTimer || 0, 0.2);
        unit._lastMoveOrder = {
            id: orderSerial,
            t: Game.gameClock || 0,
            mode: 'face',
            queue: 0,
            clickX: markerX,
            clickZ: markerZ,
            startX: unit.x,
            startZ: unit.z,
            startA: unit.angle || 0,
            goalX: unit.x,
            goalZ: unit.z,
            faceX: facePoint && Number.isFinite(facePoint.x) ? facePoint.x : null,
            faceZ: facePoint && Number.isFinite(facePoint.z) ? facePoint.z : null,
            faceA: angle,
        };
    });
    Game.spawnOrderMarker(markerX, markerZ, 0xffd27a);
    Game.pushMessage('Facing set.', 1.2);
    if (Game.Audio) {
        const anyTank = chosen.some(unit => Game.isTank(unit.kind));
        Game.Audio.voice(anyTank ? 'f_tank_move' : 'f_sold_move');
    }
    Game._clearFormationPreview();
};

Game.orderFace = (x, z) => {
    const chosen = Game.selectedPlayerUnits();
    if (!chosen.length) return;
    chosen.forEach(u => {
        if (Game.cancelHorseMountOrder) Game.cancelHorseMountOrder(u);
        Game.cancelTruckManeuver(u);
        Game.clearArrivalFacing(u);
        u._faceAngle = Game.angleTo(u.x, u.z, x, z);
        u._faceUntil = Game.gameClock + 4;     // hold the manual facing while it turns
        u.path = [];
        u.moving = false;
        u.forcedTargetId = null;
        u._engageId = null;
        u.bombardX = null; u.bombardZ = null; u._bombarding = false;
        u.stopTimer = Math.max(u.stopTimer || 0, 0.2);
    });
    Game.spawnOrderMarker(x, z, 0xffd27a);     // amber = facing
    Game.pushMessage('Facing set.', 1.2);
    if (Game.Audio) {
        const anyTank = chosen.some(u => Game.isTank(u.kind));
        Game.Audio.voice(anyTank ? 'f_tank_move' : 'f_sold_move');
    }
    Game._clearFormationPreview();
};

Game.haltSelection = () => {
    Game.selectedPlayerUnits().forEach(u => {
        if (Game.cancelHorseMountOrder) Game.cancelHorseMountOrder(u);
        Game.cancelTruckManeuver(u);
        Game.clearArrivalFacing(u);
        u.path = [];
        u.targetX = u.x;
        u.targetZ = u.z;
        u.stopTimer = 0.4;
        u.moving = false;
        u.forcedTargetId = null;
        u.bombardX = null; u.bombardZ = null;
        u._bombarding = false;
    });
    Game.pushMessage('Selected units halted.', 1.5);
};

// Movement modes: run → walk → crouch-walk → crawl
Game.STANCE_ORDER = ['run', 'stand', 'crouch', 'prone'];
Game.STANCE_LABEL = { run: 'Run', stand: 'Walk', crouch: 'Crouch', prone: 'Crawl' };

Game.setStanceForSelection = () => {
    const selected = Game.selectedPlayerUnits().filter(Game.isFootInfantry);
    if (!selected.length) return;
    const idx = Game.STANCE_ORDER.indexOf(selected[0].stance);
    const next = Game.STANCE_ORDER[(idx + 1) % Game.STANCE_ORDER.length];
    selected.forEach(u => { u.stance = next; u._autoStance = false; });
    Game.pushMessage(`Movement mode: ${Game.STANCE_LABEL[next]}.`, 1.7);
};

// Toggle selected infantry between crawling (prone) and standing.
Game.toggleProneSelection = () => {
    const sel = Game.selectedPlayerUnits().filter(Game.isFootInfantry);
    if (!sel.length) return;
    const anyUp = sel.some(u => u.stance !== 'prone');
    sel.forEach(u => { u.stance = anyUp ? 'prone' : 'stand'; u._autoStance = false; });
    if (Game.Audio) Game.Audio.voice(anyUp ? 'f_sold_move' : 'f_sold_select');
    Game.pushMessage(anyUp ? 'Crawling (prone).' : 'Standing up.', 1.5);
};

// The selected foot soldier nearest a target point — used for grenade/smoke so
// the closest man (most likely in range) does the throwing, not just the first.
Game.nearestThrower = (x, z) => {
    let best = null, bd = Infinity;
    for (const u of Game.selectedPlayerUnits()) {
        if (!Game.isFootInfantry(u)) continue;
        const d = Game.distSq(u.x, u.z, x, z);
        if (d < bd) { bd = d; best = u; }
    }
    return best;
};

// Hold fire is a dedicated stand-down flag (separate from move/attack orders):
// the unit keeps its orders and still relocates, but will not open fire or seek
// targets until weapons are freed again.
Game.setHoldFire = (on) => {
    Game.selectedPlayerUnits().forEach(u => { u.holdFire = !!on; });
};

Game.toggleHoldFire = () => {
    const sel = Game.selectedPlayerUnits();
    if (!sel.length) { Game.pushMessage('No unit selected.', 1.2); return; }
    const turnOn = sel.some(u => !u.holdFire);   // any weapon free -> hold them all
    sel.forEach(u => { u.holdFire = turnOn; });
    Game.pushMessage(turnOn ? 'Holding fire — weapons safe.' : 'Weapons free — fire at will.', 1.6);
    if (Game.Audio) Game.Audio.voice('f_sold_select');
};

Game.handleMouseSelection = (e) => {
    const mouse = Game.mouse;
    // Additive selection comes from the EVENT's live modifier state, never the
    // keydown/keyup map: a missed Shift keyup (focus change mid-order) left the
    // map stuck true, so left-clicking empty ground could never deselect again.
    const additive = e ? !!e.shiftKey
        : !!(Game.keys['ShiftLeft'] || Game.keys['ShiftRight']);
    const dx = mouse.dragCurrentX - mouse.dragStartX;
    const dy = mouse.dragCurrentY - mouse.dragStartY;
    const boxW = Math.abs(dx);
    const boxH = Math.abs(dy);

    if (boxW < 4 && boxH < 4) {
        // Airborne fighter under the click: select it like any tank — its
        // patrol ring lights up and right-click re-tasks it.
        const fPick = Game.fighterAtScreen && Game.fighterAtScreen(mouse.dragCurrentX, mouse.dragCurrentY);
        if (fPick) {
            Game.selection.clear();
            Game.selectedBuilding = null;
            Game.selectedFighter = fPick;
            const lbl = (fPick.def && fPick.def.label) || 'Fighter';
            Game.pushMessage(`${lbl} selected — right-click to re-task its patrol area.`, 2.5);
            if (Game.Audio) Game.Audio.voice('f_tank_select');
            return;
        }
        Game.selectedFighter = null;

        // An empty horse is a persistent world prop, never a selectable unit. A
        // compatible dismounted reserve rider uses the same early click-to-enter
        // interception as buildings/transports and walks over to remount.
        const selectedUnits = Game.selectedPlayerUnits();
        const directlyPickedUnit = Game.unitAtScreen
            ? Game.unitAtScreen(mouse.dragCurrentX, mouse.dragCurrentY) : null;
        const horseGround = Game.screenToGround(mouse.dragCurrentX, mouse.dragCurrentY);
        const onHorse = (Game.horseAtScreen
            && Game.horseAtScreen(mouse.dragCurrentX, mouse.dragCurrentY))
            || (!directlyPickedUnit && horseGround && Game.horseAtWorld
                && Game.horseAtWorld(horseGround.x, horseGround.z));
        const mountRider = onHorse && Game.canMountHorse
            ? selectedUnits.find(u => Game.canMountHorse(u, onHorse))
            : null;
        if (mountRider && Game.orderMountHorse) {
            Game.orderMountHorse(onHorse);
            return;
        }

        // Enter-building: if infantry are selected and the click lands on a
        // building (and not on a friendly unit you meant to select instead),
        // send the selected infantry in rather than changing the selection.
        const enterInf = selectedUnits.filter(u => u.alive && Game.isFootInfantry(u)
            && !u._garrisoned && u._inVehicle == null);
        if (enterInf.length) {
            const picked0 = directlyPickedUnit;
            // Once every selected soldier is already queued for this truck, a
            // further left-click means "select the truck", not "enter" again.
            // This lets the player move it while the pending passengers retain
            // their carrier-relative order.
            const hasNewPassenger = picked0 && enterInf.some(u => u._enterCarrierId !== picked0.id);
            if (picked0 && picked0.team === Game.playerTeam
                && picked0.supportType === 'transport' && hasNewPassenger) {
                Game.orderEnterCarrier(picked0);
                return;
            }
            const onFriendly = picked0 && picked0.team === Game.playerTeam;
            if (!onFriendly) {
                const gp = Game.screenToGround(mouse.dragCurrentX, mouse.dragCurrentY);
                const rec = (Game.buildingAtScreen && Game.buildingAtScreen(mouse.dragCurrentX, mouse.dragCurrentY))
                    || (gp && Game.buildingAt && Game.buildingAt(gp.x, gp.z));
                if (rec && !rec.collapsed) { Game.orderEnterBuilding(rec); return; }
            }
        }

        // Click select — dual approach: world-space + screen-space
        let picked = null;
        let bestDist = Infinity;

        // Method 1: World-space raycast pick
        const groundPt = Game.screenToGround(mouse.dragCurrentX, mouse.dragCurrentY);
        if (groundPt) {
            for (const unit of Game.units) {
                if (!unit.alive || unit.team !== Game.playerTeam || unit._inVehicle != null) continue;
                const d = Game.distSq(groundPt.x, groundPt.z, unit.x, unit.z);
                // Tighter pick so clicking BETWEEN clustered soldiers deselects
                // (was ~1.7u, which re-grabbed a neighbour in dense formations).
                // Clicking on/near a unit still selects; the screen-space pass below
                // catches clicks on the visible model.
                const pickRange = Math.max((unit.size + 0.35) * (unit.size + 0.35), 1.3);
                if (d < pickRange && d < bestDist) {
                    bestDist = d;
                    picked = unit;
                }
            }
        }

        // Method 2: Screen-space fallback (if world pick missed). Kept tight so a
        // click on empty ground between units deselects instead of grabbing the
        // nearest one (left-click empty = deselect).
        if (!picked) {
            let bestScreenDist = 81; // 9px squared — clicks between men must deselect
            for (const unit of Game.units) {
                if (!unit.alive || unit.team !== Game.playerTeam || unit._inVehicle != null) continue;
                const sp = Game.worldToScreen(unit.x, unit.z);
                const sdx = sp.x - mouse.dragCurrentX;
                const sdy = sp.y - mouse.dragCurrentY;
                const sd = sdx * sdx + sdy * sdy;
                if (sd < bestScreenDist) {
                    bestScreenDist = sd;
                    picked = unit;
                }
            }
        }
        if (!additive) Game.selection.clear();
        if (picked) {
            Game.selectedBuilding = null;
            if (Game.Audio) Game.Audio.voice(Game.isTank(picked.kind) ? 'f_tank_select' : 'f_sold_select');
            const now = performance.now();
            // Double-click = two quick clicks on the SAME unit. Matching by
            // kind let two fast clicks on two different riflemen mass-select
            // the whole kind, and the selection then felt "stuck".
            if (Game._lastPickedId === picked.id && now - Game._lastPickedTime < 300) {
                // Double-click: select all visible units of same kind
                Game.units.forEach(u => {
                    if (u.alive && u.team === Game.playerTeam && u.kind === picked.kind && u._inVehicle == null) {
                        Game.selection.add(u.id);
                    }
                });
            } else {
                Game.selection.add(picked.id);
            }
            Game._lastPickedId = picked.id;
            Game._lastPickedTime = now;
        } else {
            Game._lastPickedId = null;
            Game._lastPickedTime = 0;
            // No unit under the click: a GARRISONED building can be selected
            // (Sudden Strike). Right-click terrain then sends the whole
            // garrison out to that point; right-click the building itself
            // releases one soldier at the door.
            const gp2 = Game.screenToGround(mouse.dragCurrentX, mouse.dragCurrentY);
            const bRec = (Game.buildingAtScreen && Game.buildingAtScreen(mouse.dragCurrentX, mouse.dragCurrentY))
                || (gp2 && Game.buildingAt && Game.buildingAt(gp2.x, gp2.z));
            const occupied = bRec && !bRec.collapsed && bRec.occupants && bRec.occupants.length
                && bRec.occupants.some(id => { const u = Game.getUnitById(id); return u && u.team === Game.playerTeam; });
            Game.selectedBuilding = occupied ? bRec : null;
            if (Game.selectedBuilding) {
                Game.pushMessage(`Building selected (${bRec.occupants.length}/${bRec.capacity} inside) — right-click terrain: all out · right-click the house: one out.`, 3.0);
                if (Game.Audio) Game.Audio.voice('f_sold_select');
            }
        }
    } else {
        Game.selectedBuilding = null;
        // Box select — project units to screen, check in box
        const sx = Math.min(mouse.dragStartX, mouse.dragCurrentX);
        const sy = Math.min(mouse.dragStartY, mouse.dragCurrentY);
        const ex = sx + boxW;
        const ey = sy + boxH;

        if (!additive) Game.selection.clear();
        const boxHits = [];
        Game.units.forEach(unit => {
            if (!unit.alive || unit.team !== Game.playerTeam || unit._inVehicle != null) return;
            // Catch a unit when the box touches its BODY, not only its ground anchor.
            // The model is drawn above its feet, so the old feet-point test forced you
            // to drag over the ground under each man. Project the body centre AND the
            // feet, and inflate the box by the unit's on-screen radius so any overlap
            // with the visible model selects it.
            const bodyY = (unit.y || 0) + (Game.isTank(unit.kind) ? (unit.size || 0.8) * 0.5 : (unit.size || 0.5) * 1.0);
            const body = Game.worldToScreen(unit.x, unit.z, bodyY);
            const feet = Game.worldToScreen(unit.x, unit.z, (unit.y || 0));
            const edge = Game.worldToScreen(unit.x + (unit.size || 0.5), unit.z, bodyY);
            const rad = Math.max(9, Math.hypot(edge.x - body.x, edge.y - body.y) + 5);
            const inBox = (p) => p.x >= sx - rad && p.x <= ex + rad && p.y >= sy - rad && p.y <= ey + rad;
            if (inBox(body) || inBox(feet)) {
                Game.selection.add(unit.id);
                boxHits.push(unit);
            }
        });
        // One acknowledgement per drag, chosen from the units hit by this box.
        // Calling inside the loop would make iteration order decide which of a
        // mixed infantry/armour selection gets past the global voice throttle.
        if (boxHits.length && Game.Audio) {
            const anyTank = boxHits.some(unit => Game.isTank(unit.kind));
            Game.Audio.voice(anyTank ? 'f_tank_select' : 'f_sold_select');
        }
    }

    // Update selection ring visibility
    Game.units.forEach(u => {
        if (u.mesh && u.mesh.userData.selectionRing) {
            u.mesh.userData.selectionRing.visible = Game.selection.has(u.id);
        }
    });

    // Deselecting must hide the green formation-preview rings right away — they
    // were only cleared on mousemove, so they lingered until the cursor moved.
    if (Game.selection.size === 0 && Game._clearFormationPreview) Game._clearFormationPreview();
};

Game.RIGHT_ORDER_DRAG_PIXELS = 8;
Game.RIGHT_ORDER_DRAG_WORLD = 0.35;

// Only ordinary open-terrain orders are deferred for drag detection. Armed
// abilities and contextual enemy/building/transport/horse clicks retain their
// existing immediate right-click behavior.
Game._canDeferTerrainRightOrder = (screenX, screenY, ground, modifiers = {}) => {
    if (!ground || Game._commandMode || Game.selectedFighter || Game.selectedBuilding) return false;
    const selectedUnits = Game.selectedPlayerUnits();
    if (!selectedUnits.length) return false;
    if (modifiers.shiftKey || modifiers.ctrlKey || modifiers.metaKey) return true;

    const picked = Game.unitAtScreen(screenX, screenY);
    const clickedEnemy = picked && picked.team !== Game.playerTeam ? picked : null;
    const onHorse = (Game.horseAtScreen && Game.horseAtScreen(screenX, screenY))
        || (!picked && Game.horseAtWorld && Game.horseAtWorld(ground.x, ground.z));
    const mountRider = onHorse && Game.canMountHorse
        ? selectedUnits.find(unit => Game.canMountHorse(unit, onHorse)) : null;
    const nearbyEnemy = !clickedEnemy && !mountRider
        ? Game.enemyAtWorld(ground.x, ground.z) : null;
    const onTransport = picked && picked.team === Game.playerTeam
        && picked.supportType === 'transport'
        && selectedUnits.some(Game.isFootInfantry);
    const onBuilding = (Game.buildingAtScreen && Game.buildingAtScreen(screenX, screenY))
        || (Game.buildingAt && Game.buildingAt(ground.x, ground.z));
    return !clickedEnemy && !mountRider && !nearbyEnemy && !onTransport
        && !(onBuilding && !onBuilding.collapsed);
};

Game._completeTerrainRightClick = (drag) => {
    const units = drag.unitIds.map(Game.getUnitById)
        .filter(unit => unit && unit.alive && unit.team === Game.playerTeam);
    if (!units.length) return;
    const now = performance.now();
    const dbl = Game._lastRC && (now - Game._lastRC.t) < 400
        && Math.abs(drag.startX - Game._lastRC.x) < 24
        && Math.abs(drag.startY - Game._lastRC.y) < 24;
    Game._lastRC = { t: now, x: drag.startX, y: drag.startY };
    if (dbl && !drag.shiftKey) {
        Game.orderRetreat(drag.origin.x, drag.origin.z);
    } else if (drag.shiftKey) {
        Game.issueCommand(drag.origin.x, drag.origin.z, 'move', units, true);
    } else if (drag.ctrlKey || drag.metaKey) {
        Game.issueCommand(drag.origin.x, drag.origin.z, 'move', units, false, true);
    } else {
        Game.issueCommand(drag.origin.x, drag.origin.z,
            drag.stance === 'attack' ? 'attack' : 'move', units);
    }
};

Game._cancelRightOrderDrag = () => {
    Game._rightOrderDrag = null;
    Game._clearRightOrderArrow();
    Game._clearFormationPreview();
};

Game.handleInputEvents = () => {
    const container = document.getElementById('viewport');

    container.addEventListener('contextmenu', e => e.preventDefault());

    container.addEventListener('mousedown', e => {
        Game.mouse.screenX = e.clientX;
        Game.mouse.screenY = e.clientY;

        if (e.button === 0) {
            // Left-click always disarms a pending command mode (grenade/smoke/
            // rotate/fighter/etc.) — a forgotten armed mode silently swallowed
            // every right-click, which read as "orders do nothing".
            if (Game._commandMode) {
                Game.pushMessage('Order mode cancelled.', 1.0);
                Game._commandMode = null;
            }
            Game.mouse.down = true;
            Game.mouse.dragStartX = Game.mouse.dragCurrentX = e.clientX;
            Game.mouse.dragStartY = Game.mouse.dragCurrentY = e.clientY;
        } else if (e.button === 2) {
            const ground = Game.screenToGround(e.clientX, e.clientY);
            if (ground && Game._canDeferTerrainRightOrder(e.clientX, e.clientY, ground, e)) {
                Game._rightOrderDrag = {
                    startX: e.clientX,
                    startY: e.clientY,
                    currentX: e.clientX,
                    currentY: e.clientY,
                    origin: { x: ground.x, z: ground.z },
                    tip: { x: ground.x, z: ground.z },
                    active: false,
                    shiftKey: !!e.shiftKey,
                    ctrlKey: !!e.ctrlKey,
                    metaKey: !!e.metaKey,
                    stance: Game.orderStance,
                    unitIds: Game.selectedPlayerUnits().map(unit => unit.id),
                };
                e.preventDefault();
                return;
            }
            if (ground) {
                // Selected fighter: right-click re-tasks its patrol circle —
                // the plane banks over and orbits the new area.
                if (Game.selectedFighter && !Game._commandMode && Game.selection.size === 0) {
                    const f = Game.selectedFighter;
                    if (f.dead || f.state === 'crash') {
                        Game.selectedFighter = null;
                    } else if (f.state === 'egress') {
                        Game.pushMessage('Fighter is out of ammunition and returning to base.', 2.0);
                        return;
                    } else {
                        f.cx = ground.x; f.cz = ground.z;
                        f.passX = null;   // plan a fresh attack pass over the new area
                        if (Game.dist(f.x, f.z, f.cx, f.cz) > (Game.FIGHTER.radius || 15) * 2) f.state = 'inbound';
                        Game._fighterZoneMark = { x: f.cx, z: f.cz, t: 6 };
                        Game.pushMessage('Fighter re-tasked to the marked area.', 2.0);
                        return;
                    }
                }

                // Selected garrisoned building (Sudden Strike): right-click ON
                // the building = one soldier steps out; right-click terrain =
                // the whole garrison files out and moves to the point.
                if (Game.selectedBuilding && !Game._commandMode && Game.selection.size === 0) {
                    const rec = Game.selectedBuilding;
                    if (rec.collapsed || !rec.occupants || !rec.occupants.length) {
                        Game.selectedBuilding = null;
                    } else {
                        const onB = (Game.buildingAtScreen && Game.buildingAtScreen(e.clientX, e.clientY))
                            || (Game.buildingAt && Game.buildingAt(ground.x, ground.z));
                        if (onB === rec) {
                            const n = Game.exitBuilding(rec, 1);
                            if (n) Game.pushMessage(`One soldier steps out (${rec.occupants.length}/${rec.capacity} still inside).`, 1.8);
                            if (!rec.occupants.length) Game.selectedBuilding = null;
                        } else {
                            const n = Game.exitBuilding(rec, Infinity, ground.x, ground.z);
                            if (n) Game.pushMessage(`Garrison moving out (${n} soldier${n === 1 ? '' : 's'}).`, 1.8);
                            if (Game.spawnOrderMarker) Game.spawnOrderMarker(ground.x, ground.z, 0x88cc66);
                            Game.selectedBuilding = null;
                        }
                        return;
                    }
                }
                // Double right-click = RETREAT: force selected units to break off
                // and fall back here (disengage; infantry sprint, tanks reverse).
                const now = performance.now();
                const dbl = Game._lastRC && (now - Game._lastRC.t) < 400
                    && Math.abs(e.clientX - Game._lastRC.x) < 24
                    && Math.abs(e.clientY - Game._lastRC.y) < 24;
                Game._lastRC = { t: now, x: e.clientX, y: e.clientY };
                if (dbl && !Game._commandMode && !e.shiftKey) {
                    Game.orderRetreat(ground.x, ground.z);
                } else if (Game._commandMode === 'airstrike') {
                    Game.callAirStrike(ground.x, ground.z);
                    Game._commandMode = null;
                } else if (Game._commandMode === 'fighter') {
                    Game.callFighter(ground.x, ground.z);
                    Game._commandMode = null;
                } else if (Game._commandMode === 'recon') {
                    Game.callRecon(ground.x, ground.z);
                    Game._commandMode = null;
                } else if (Game._commandMode === 'garrison') {
                    Game.selectedPlayerUnits().forEach(u => {
                        if (Game.isFootInfantry(u)) Game.enterBuilding(u, ground.x, ground.z);
                    });
                    Game._commandMode = null;
                } else if (Game._commandMode === 'tnt') {
                    const sapper = Game.selectedPlayerUnits().find(u => u.supportType === 'sapper');
                    if (sapper) Game.throwTNT(sapper, ground.x, ground.z);
                    Game._commandMode = null;
                } else if (Game._commandMode === 'grenade') {
                    const thrower = Game.nearestThrower(ground.x, ground.z);
                    if (thrower) Game.throwGrenade(thrower, ground.x, ground.z);
                    else Game.pushMessage('Select infantry to throw a grenade.', 1.5);
                    Game._commandMode = null;
                } else if (Game._commandMode === 'smoke') {
                    const thrower = Game.nearestThrower(ground.x, ground.z);
                    if (thrower) Game.throwSmoke(thrower, ground.x, ground.z);
                    else Game.pushMessage('Select infantry to throw smoke.', 1.5);
                    Game._commandMode = null;
                } else if (Game._commandMode === 'unload') {
                    const carrier = Game.getUnitById(Game._unloadCarrierId);
                    if (carrier && carrier.alive) Game.unloadCarrier(carrier, ground.x, ground.z);
                    Game._unloadCarrierId = null;
                    Game._commandMode = null;
                } else if (Game._commandMode === 'rotate') {
                    Game.orderFace(ground.x, ground.z);
                    Game._commandMode = null;
                } else if (Game._commandMode === 'attackground') {
                    Game.orderAttackGround(ground.x, ground.z);
                    Game._commandMode = null;
                } else if (Game._commandMode === 'guard') {
                    Game.AI.setGuard(ground.x, ground.z);
                    Game._commandMode = null;
                } else {
                    // Shift + right-click = queue a movement waypoint (SS2: Shift
                    // appends orders). Ctrl/Cmd + right-click = GATHER at the
                    // destination (SS2: Ctrl+Move) — converge on one point.
                    if (e.shiftKey) {
                        Game.issueCommand(ground.x, ground.z, 'move', null, true);
                    } else if (e.ctrlKey || e.metaKey) {
                        Game.issueCommand(ground.x, ground.z, 'move', null, false, true);
                    } else {
                        // Plain right-click. Clicking an enemy ALWAYS attacks it. On open
                        // ground, obey the current order stance: 'attack' = attack-move
                        // (advance + engage), otherwise a plain Move (relocate, stowed).
                        // Pick by the actual mesh first (parallax-proof), then fall back
                        // to a world-radius search around the ground hit.
                        const picked = Game.unitAtScreen(e.clientX, e.clientY);
                        const clickedEnemy = picked && picked.team !== Game.playerTeam
                            ? picked : null;
                        // A direct enemy-mesh click keeps attack priority. Otherwise
                        // a compatible empty horse wins over radius-based enemy,
                        // transport, building and terrain fallbacks.
                        const onHorse = (Game.horseAtScreen && Game.horseAtScreen(e.clientX, e.clientY))
                            || (!picked && Game.horseAtWorld && Game.horseAtWorld(ground.x, ground.z));
                        const selectedUnits = Game.selectedPlayerUnits();
                        const mountRider = onHorse && Game.canMountHorse
                            ? selectedUnits.find(u => Game.canMountHorse(u, onHorse))
                            : null;
                        const nearbyEnemy = !clickedEnemy && !mountRider
                            ? Game.enemyAtWorld(ground.x, ground.z) : null;
                        const onTransport = picked && picked.team === Game.playerTeam
                            && picked.supportType === 'transport' ? picked : null;
                        // Building under the cursor (click the house itself, not the
                        // ground behind it) or at the ground hit.
                        const onBuilding = (Game.buildingAtScreen && Game.buildingAtScreen(e.clientX, e.clientY))
                            || (Game.buildingAt && Game.buildingAt(ground.x, ground.z));
                        const haveArmed = selectedUnits.some(u => {
                            const w = Game.WEAPONS[u.weaponKey];
                            return w && w.fireType !== 'none' && (w.gameRange || 0) > 0;
                        });
                        if (clickedEnemy) {
                            Game._attackOrCharge(clickedEnemy);
                        } else if (mountRider && Game.orderMountHorse) {
                            Game.orderMountHorse(onHorse);
                        } else if (nearbyEnemy) {
                            Game._attackOrCharge(nearbyEnemy);
                        } else if (onTransport && selectedUnits.some(Game.isFootInfantry)) {
                            Game.orderEnterCarrier(onTransport);
                        } else if (onBuilding && !onBuilding.collapsed) {
                            // Right-click a building: selected infantry move in and
                            // garrison it; otherwise armed vehicles/AT shell it.
                            // NEVER silent — if neither applies, say why.
                            const inf = selectedUnits.filter(u => u.alive
                                && Game.isFootInfantry(u) && !u._garrisoned);
                            if (inf.length) Game.orderEnterBuilding(onBuilding);
                            else if (haveArmed) Game.orderAttackGround(onBuilding.cx, onBuilding.cz);
                            else Game.pushMessage('Select infantry to enter the building (or armed units to shell it).', 2.0);
                        } else if (Game.orderStance === 'attack') {
                            Game.orderAttackMove(ground.x, ground.z);
                        } else {
                            Game.issueCommand(ground.x, ground.z, 'move');
                        }
                    }
                }
            }
        }
    });

    window.addEventListener('mousemove', e => {
        Game.mouse.screenX = e.clientX;
        Game.mouse.screenY = e.clientY;
        if (Game.mouse.down) {
            Game.mouse.dragCurrentX = e.clientX;
            Game.mouse.dragCurrentY = e.clientY;
        }
        // Update world coords
        const ground = Game.screenToGround(e.clientX, e.clientY);
        if (ground) {
            Game.mouse.worldX = ground.x;
            Game.mouse.worldZ = ground.z;

            // Formation preview markers (throttled)
            const now = performance.now();
            const overHud = e.clientY > window.innerHeight - 110;
            const rightDrag = Game._rightOrderDrag;
            if (rightDrag) {
                rightDrag.currentX = e.clientX;
                rightDrag.currentY = e.clientY;
                rightDrag.tip = { x: ground.x, z: ground.z };
                const screenDistance = Math.hypot(
                    e.clientX - rightDrag.startX, e.clientY - rightDrag.startY);
                const worldDistance = Game.dist(
                    rightDrag.origin.x, rightDrag.origin.z, ground.x, ground.z);
                rightDrag.active = screenDistance >= Game.RIGHT_ORDER_DRAG_PIXELS
                    && worldDistance >= Game.RIGHT_ORDER_DRAG_WORLD;
                if (rightDrag.active) {
                    const previewStance = rightDrag.shiftKey
                        || rightDrag.ctrlKey || rightDrag.metaKey ? 'move' : rightDrag.stance;
                    const angle = Game.angleTo(
                        rightDrag.origin.x, rightDrag.origin.z, ground.x, ground.z);
                    Game._showRightOrderArrow(rightDrag.origin, ground, previewStance);
                    if (!Game._lastRightDragPreviewTime
                        || now - Game._lastRightDragPreviewTime > 80) {
                        Game._lastRightDragPreviewTime = now;
                        const units = rightDrag.unitIds.map(Game.getUnitById)
                            .filter(unit => unit && unit.alive && unit.team === Game.playerTeam);
                        const rotateOnly = !rightDrag.shiftKey
                            && !rightDrag.ctrlKey && !rightDrag.metaKey
                            && Game.directionalOrderNearby(units,
                                rightDrag.origin.x, rightDrag.origin.z);
                        Game._showFormationPreview(
                            rightDrag.origin.x, rightDrag.origin.z, angle, units,
                            rightDrag.ctrlKey || rightDrag.metaKey, previewStance,
                            rotateOnly);
                    }
                } else {
                    Game._clearRightOrderArrow();
                    Game._clearFormationPreview();
                }
            } else if (Game.selection.size > 0 && !overHud
                && (!Game._lastPreviewTime || now - Game._lastPreviewTime > 150)) {
                Game._lastPreviewTime = now;
                Game._showFormationPreview(ground.x, ground.z);
            } else if (Game.selection.size === 0) {
                Game._clearFormationPreview();
            }
        } else if (!Game._rightOrderDrag) {
            Game._clearFormationPreview();
        }
    });

    window.addEventListener('mouseup', e => {
        if (e.button === 0 && Game.mouse.down) {
            Game.mouse.down = false;
            Game.handleMouseSelection(e);
        } else if (e.button === 2 && Game._rightOrderDrag) {
            const drag = Game._rightOrderDrag;
            const releaseGround = Game.screenToGround(e.clientX, e.clientY);
            if (releaseGround) {
                drag.tip = { x: releaseGround.x, z: releaseGround.z };
                const screenDistance = Math.hypot(
                    e.clientX - drag.startX, e.clientY - drag.startY);
                const worldDistance = Game.dist(
                    drag.origin.x, drag.origin.z, releaseGround.x, releaseGround.z);
                drag.active = screenDistance >= Game.RIGHT_ORDER_DRAG_PIXELS
                    && worldDistance >= Game.RIGHT_ORDER_DRAG_WORLD;
            }
            Game._rightOrderDrag = null;
            Game._clearRightOrderArrow();
            Game._clearFormationPreview();
            if (drag.active && drag.tip) {
                // A completed drag is never one half of a retreat double-click.
                Game._lastRC = null;
                const units = drag.unitIds.map(Game.getUnitById)
                    .filter(unit => unit && unit.alive && unit.team === Game.playerTeam);
                Game.issueDirectionalCommand(
                    drag.origin.x, drag.origin.z, drag.tip.x, drag.tip.z, {
                        units,
                        queue: drag.shiftKey,
                        gather: drag.ctrlKey || drag.metaKey,
                        mode: drag.stance,
                    });
            } else {
                Game._completeTerrainRightClick(drag);
            }
            e.preventDefault();
        }
    });

    window.addEventListener('blur', Game._cancelRightOrderDrag);
    // A keyup that fires while the window is unfocused never reaches the map:
    // wipe held-key state on blur so no modifier can stick across a focus loss.
    window.addEventListener('blur', () => {
        for (const k in Game.keys) Game.keys[k] = false;
    });

    // Mouse wheel does NOT zoom — use the +/- keys. Swallow the event so the
    // page/trackpad never scrolls the canvas. While an air strike is armed, the
    // wheel sets how many planes to commit.
    container.addEventListener('wheel', e => {
        e.preventDefault();
        if (Game._commandMode === 'airstrike') {
            Game.adjustAirStrikePlanes(e.deltaY < 0 ? 1 : -1);
            Game.pushMessage(`Air strike: ${Game.airStrikePlanesToUse} of ${Game.airStrikesAvailable} plane(s) — right-click target.`, 2.0);
        }
    }, { passive: false });

    window.addEventListener('keydown', e => {
        // typing in a text field (debug prompts etc.) must not fire hotkeys
        const _t = e.target;
        if (_t && (_t.tagName === 'INPUT' || _t.tagName === 'TEXTAREA' || _t.tagName === 'SELECT' || _t.isContentEditable)) return;
        Game.keys[e.code] = true;
        if (e.repeat) return;

        // Alt — toggle all health bars
        if (e.code === 'AltLeft' || e.code === 'AltRight') {
            Game._showAllHealthBars = !Game._showAllHealthBars;
            e.preventDefault();
        }

        // Space — tactical pause: time stops, orders can still be issued.
        // (SS2 maps Space to "center on last event" — tried it, but Space-to-
        // pause is this game's muscle memory; L / the Pause key cover the rest.)
        if (e.code === 'Space') {
            e.preventDefault();
            const menuOpen = !document.getElementById('mainMenu')?.classList.contains('hidden');
            if (!menuOpen) {
                Game._paused = !Game._paused;
                Game.pushMessage(Game._paused
                    ? 'PAUSED — issue orders, Space to resume.'
                    : 'Resumed.', 2.0);
            }
        }

        // Pause key — pause mode on/off (SS2). P does the same.
        if (e.code === 'Pause') {
            Game._paused = !Game._paused;
            Game.pushMessage(Game._paused ? 'PAUSED — commands can still be issued' : 'UNPAUSED', 2.0);
        }

        // Tab — center view around the selected units (SS2)
        if (e.code === 'Tab') {
            e.preventDefault();
            const sel = Game.selectedPlayerUnits();
            if (sel.length) {
                Game.cam.x = sel.reduce((s, u) => s + u.x, 0) / sel.length;
                Game.cam.z = sel.reduce((s, u) => s + u.z, 0) / sel.length;
            }
        }

        // F9 — display mission objectives (SS2)
        if (e.code === 'F9') {
            e.preventDefault();
            const ms = Game.missionState || {};
            if (Game.currentScenario === 'mokra') {
                const secondary = ms.secondaryObjective ? ` Secondary: ${ms.secondaryObjective}` : '';
                Game.pushMessage(`Objective: ${ms.primaryObjective || 'Hold the central railway crossing.'}${secondary}`, 5.0);
            } else {
                Game.pushMessage('Objective: seize the crossroads (red marker). Losing the whole force fails the mission.', 5.0);
            }
        }

        // ; — reinforcement report (SS2: number of reinforcements on their way)
        if (e.code === 'Semicolon') {
            const ms = Game.missionState || {};
            Game.pushMessage(ms.reinforcementReport || (ms.reinforcementTriggered
                ? 'Enemy reserves already committed. No further waves expected.'
                : 'Intelligence: enemy reserve elements are expected from the east.'), 3.0);
        }

        // L — jump to last attack
        if (e.code === 'KeyL') {
            if (Game.lastAttackPos) {
                Game.cam.x = Game.lastAttackPos.x;
                Game.cam.z = Game.lastAttackPos.z;
            } else {
                Game.centerOnAction();
            }
        }

        // Unit groups: Ctrl+0-9 to assign, 0-9 to recall
        const numMatch = e.code.match(/^Digit(\d)$/);
        if (numMatch) {
            const n = parseInt(numMatch[1]);
            if (e.ctrlKey || e.metaKey) {
                // Assign group
                Game.groups = Game.groups || {};
                Game.groups[n] = [...Game.selection];
                Game.pushMessage(`Group ${n} assigned (${Game.selection.size} units).`, 1.5);
                e.preventDefault();
            } else {
                // Recall group
                Game.groups = Game.groups || {};
                const groupIds = Game.groups[n];
                if (groupIds && groupIds.length) {
                    const now = performance.now();
                    // Double-tap detection
                    if (Game._lastGroupKey === n && now - Game._lastGroupTime < 400) {
                        // Center camera on group
                        let gx = 0, gz = 0, count = 0;
                        Game.units.forEach(u => {
                            if (u.alive && groupIds.includes(u.id)) { gx += u.x; gz += u.z; count++; }
                        });
                        if (count) { Game.cam.x = gx / count; Game.cam.z = gz / count; }
                    }
                    Game._lastGroupKey = n;
                    Game._lastGroupTime = now;
                    // Select group
                    Game.selection.clear();
                    Game.selectedBuilding = null;
                    groupIds.forEach(id => {
                        if (Game.units.find(u => u.alive && u.id === id)) Game.selection.add(id);
                    });
                }
            }
        }

        // Camera save/recall (F1-F8, SS2: Ctrl+F1-F8 saves, F1-F8 recalls)
        const fMatch = e.code.match(/^F([1-8])$/);
        if (fMatch) {
            e.preventDefault();          // keep the browser off F1 (help) etc.
            const slot = parseInt(fMatch[1]);
            Game._camSlots = Game._camSlots || {};
            if (e.ctrlKey || e.metaKey) {
                Game._camSlots[slot] = { x: Game.cam.x, z: Game.cam.z, zoom: Game.cam.zoom };
                Game.pushMessage(`Camera position saved to F${slot}.`, 1.5);
            } else {
                const saved = Game._camSlots[slot];
                if (saved) {
                    Game.cam.x = saved.x;
                    Game.cam.z = saved.z;
                    Game.cam.targetZoom = saved.zoom;
                }
            }
        }

        // Behavior cycle (/ key)
        if (e.code === 'Slash') {
            const modes = ['defensive', 'aggressive', 'cautious'];
            Game.selectedPlayerUnits().forEach(u => {
                const idx = modes.indexOf(u.behavior || 'defensive');
                u.behavior = modes[(idx + 1) % modes.length];
            });
            const first = Game.selectedPlayerUnits()[0];
            if (first) Game.pushMessage(`Behavior: ${first.behavior}`, 1.5);
        }

        // Air strike (B key) — enter targeting mode
        if (e.code === 'KeyB') {
            if (Game.airStrikesAvailable > 0) {
                Game._commandMode = 'airstrike';
                Game.adjustAirStrikePlanes(0); // clamp selector to current stock
                Game.pushMessage(`Air strike: ${Game.airStrikePlanesToUse} of ${Game.airStrikesAvailable} plane(s). Wheel to adjust, right-click target.`, 3.5);
            } else {
                Game.pushMessage('No air strikes available!', 2.0);
            }
        }

        // Fighter cover (J key) — opens the squadron menu (plane types +
        // counts); pick one, then the green ring follows the cursor and
        // right-click sends it in (from the map edge nearest the click).
        if (e.code === 'KeyJ') {
            if (Game.fighterTotalAvailable && Game.fighterTotalAvailable() > 0) {
                Game.toggleFighterMenu();
            } else {
                Game.pushMessage('No fighters available!', 2.0);
            }
        }

        // Toggle Move / Attack-move stance (E key)
        if (e.code === 'KeyE') {
            Game.setOrderStance(Game.orderStance === 'attack' ? 'move' : 'attack');
        }

        // Attack ground — fire on a spot (F key)
        if (e.code === 'KeyF') {
            Game._commandMode = 'attackground';
            Game.pushMessage('Attack ground — right-click a spot to suppress.', 2.0);
        }

        // Rotate (R key)
        if (e.code === 'KeyR') {
            Game._commandMode = 'rotate';
            Game.pushMessage('Rotate — right-click direction.', 2.0);
        }

        // Cycle formation (Z key)
        if (e.code === 'KeyZ') {
            const idx = Game.FORMATIONS.indexOf(Game.currentFormation);
            Game.currentFormation = Game.FORMATIONS[(idx + 1) % Game.FORMATIONS.length];
            Game.pushMessage(`Formation: ${Game.currentFormation.toUpperCase()}`, 1.5);
            // Update HUD selector
            document.querySelectorAll('.fm-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.formation === Game.currentFormation);
            });
        }

        // Stand ground toggle (G key — SS2): hold this position; still fires.
        if (e.code === 'KeyG') {
            const sel = Game.selectedPlayerUnits();
            if (sel.length) {
                const on = sel.some(u => u.orderMode !== 'hold');
                sel.forEach(u => {
                    u.orderMode = on ? 'hold' : 'aggressive';
                    if (on) {
                        if (Game.cancelHorseMountOrder) Game.cancelHorseMountOrder(u);
                        Game.cancelTruckManeuver(u);
                        Game.clearArrivalFacing(u);
                        u.path = []; u.moving = false;
                    }
                });
                Game.pushMessage(on ? 'Standing ground.' : 'Free to maneuver.', 1.4);
            }
        }

        // Grenade (Q key; was G — G is Stand Ground per SS2)
        if (e.code === 'KeyQ') {
            Game._commandMode = 'grenade';
            Game.pushMessage('Grenade — right-click target.', 2.0);
        }

        // Hold fire (T key — SS2; H remains an alias)
        if (e.code === 'KeyT') {
            Game.toggleHoldFire();
        }

        // Smoke grenade (N key; was T — T is Hold Fire per SS2)
        if (e.code === 'KeyN') {
            Game._commandMode = 'smoke';
            Game.pushMessage('Smoke — right-click target.', 2.0);
        }

        // Posture cycle (X key): Attention -> At Ease -> Stand down (auto)
        if (e.code === 'KeyX') {
            Game.cyclePosture();
        }

        // Guard an area (C key) — enter placement mode, right-click sets the centre
        if (e.code === 'KeyC') {
            Game.AI.beginGuard();
        }

        // Stop / cancel orders (V key)
        if (e.code === 'KeyV') {
            const stoppedUnits = Game.selectedPlayerUnits();
            stoppedUnits.forEach(u => {
                if (Game.cancelHorseMountOrder) Game.cancelHorseMountOrder(u);
                Game.cancelTruckManeuver(u);
                Game.clearArrivalFacing(u);
                u.path = [];
                u.moving = false;
                u.orderMode = 'hold';
                u.forcedTargetId = null;
                u.bombardX = null; u.bombardZ = null;
                u._bombarding = false;
                u._assaultGoal = null;
                if (Game.AI && Game.AI.clearPosture) Game.AI.clearPosture(u);
            });
            if (stoppedUnits.some(u => Game.isTank(u.kind)) && Game.Audio) {
                Game.Audio.voice('f_tank_stop');
            }
            Game.pushMessage('Units stopped.', 1.0);
        }

        // Hold fire toggle (H key)
        if (e.code === 'KeyH') {
            Game.toggleHoldFire();
        }

        // Pause / unpause (P key)
        if (e.code === 'KeyP') {
            Game._paused = !Game._paused;
            Game.pushMessage(Game._paused ? 'PAUSED — commands can still be issued' : 'UNPAUSED', 2.0);
        }

        // Run toggle (S key) — infantry switches between run and walk
        if (e.code === 'KeyS') {
            const inf = Game.selectedPlayerUnits().filter(Game.isFootInfantry);
            if (inf.length) {
                const toRun = inf.some(u => u.stance !== 'run');
                inf.forEach(u => { u.stance = toRun ? 'run' : 'stand'; u._autoStance = false; });
                Game.pushMessage(toRun ? 'Running!' : 'Walking.', 1.0);
            }
        }

        // First aid (F key) — one-time self-heal for infantry
        if (e.code === 'KeyF') {
            Game.selectedPlayerUnits().forEach(u => {
                if (!Game.isTank(u.kind) && u.hp < u.maxHp) {
                    u._firstAidKits = u._firstAidKits ?? 1;
                    if (u._firstAidKits > 0) {
                        u._firstAidKits--;
                        u.hp = Math.min(u.maxHp, u.hp + 40);
                        Game.pushMessage(`${u.label} used first aid kit.`, 1.5);
                    } else {
                        Game.pushMessage('No first aid kits left!', 1.5);
                    }
                }
            });
        }
        // Mine laying (M key) — sappers only
        if (e.code === 'KeyM') {
            const sapper = Game.selectedPlayerUnits().find(u => u.supportType === 'sapper');
            if (sapper) Game.layMine(sapper);
            else Game.pushMessage('Select a sapper to lay mines.', 1.5);
        }

        // Entrench toggle (N key)
        if (e.code === 'KeyN') {
            Game.selectedPlayerUnits().filter(Game.isFootInfantry)
                .forEach(u => Game.entrenchUnit(u));
        }

        // Build sandbags (U key) — sappers only
        if (e.code === 'KeyU') {
            const sapper = Game.selectedPlayerUnits().find(u => u.supportType === 'sapper');
            if (sapper) Game.buildSandbag(sapper);
            else Game.pushMessage('Select a sapper to build sandbags.', 1.5);
        }

        // Tow / untow a gun (O key) — select a vehicle/truck
        if (e.code === 'KeyO') {
            const tower = Game.selectedPlayerUnits().find(u => Game.canTow(u));
            if (!tower) { Game.pushMessage('Select a vehicle or truck to tow with.', 1.5); }
            else {
                const towing = Game.towedBy(tower);
                if (towing) { Game.untowUnit(towing); }
                else {
                    const best = Game.nearTowTarget(tower);
                    if (best) Game.towUnit(tower, best);
                    else Game.pushMessage('Back the vehicle up to an anti-tank gun first.', 1.5);
                }
            }
        }

        // Load / unload troops (L key) — select a truck (+ infantry to load)
        if (e.code === 'KeyL') {
            const sel = Game.selectedPlayerUnits();
            const carrier = sel.find(u => Game.isCarrier(u));
            if (!carrier) { Game.pushMessage('Select a truck to carry troops.', 1.5); }
            else if (carrier._passengers && carrier._passengers.length) {
                Game.unloadCarrier(carrier);
            } else {
                let pool = sel.filter(u => Game.isFootInfantry(u)
                    && Game.distSq(u.x, u.z, carrier.x, carrier.z) < 12 * 12);
                if (!pool.length) {
                    pool = Game.units.filter(u => u.alive && u.team === carrier.team
                        && Game.isFootInfantry(u)
                        && Game.distSq(u.x, u.z, carrier.x, carrier.z) < 10 * 10);
                }
                let n = 0;
                pool.forEach(u => { if (Game.loadUnit(u, carrier)) n++; });
                Game.pushMessage(n ? `${carrier.label} loaded ${n} troops.` : 'No infantry nearby to load.', 1.6);
            }
        }

        // Recon plane (J key)
        if (e.code === 'KeyJ') {
            Game._commandMode = 'recon';
            Game.pushMessage('Recon — right-click target area.', 2.0);
        }

        // Exit vehicle (X key)
        if (e.code === 'KeyX') {
            Game.selectedPlayerUnits().forEach(u => {
                if (Game.isTank(u.kind)) Game.exitVehicle(u);
            });
        }

        // Building garrison (Q key)
        if (e.code === 'KeyQ') {
            const garrisoned = Game.selectedPlayerUnits().filter(u => u._garrisoned);
            if (garrisoned.length > 0) {
                garrisoned.forEach(u => Game.exitBuilding(u));
            } else if (Game.selectedPlayerUnits().some(Game.isFootInfantry)) {
                Game._commandMode = 'garrison';
                Game.pushMessage('Garrison — right-click a building.', 2.0);
            } else {
                Game.pushMessage('Select infantry on foot to enter a building.', 1.5);
            }
        }

        // C key: cycle movement mode (run / walk / crouch / crawl)
        if (e.code === 'KeyC') {
            Game.setStanceForSelection();
        }

        // K key: TNT / demolitions — sappers only
        if (e.code === 'KeyK') {
            const sapper = Game.selectedPlayerUnits().find(u => u.supportType === 'sapper');
            if (sapper) {
                Game._commandMode = 'tnt';
                Game.pushMessage('TNT — right-click target.', 2.0);
            } else {
                Game.pushMessage('Select a sapper to use TNT.', 1.5);
            }
        }

        // Binoculars (Y key)
        if (e.code === 'KeyY') {
            Game.selectedPlayerUnits().forEach(u => {
                if (!Game.isTank(u.kind)) Game.useBinoculars(u);
            });
        }

        // Escape — cancel command mode or show menu
        if (e.code === 'Escape') {
            if (Game._commandMode) {
                Game._commandMode = null;
            } else {
                // Show main menu
                const menu = document.getElementById('mainMenu');
                if (menu) { menu.classList.remove('hidden'); Game._paused = true; }
            }
        }
    });

    window.addEventListener('keyup', e => { Game.keys[e.code] = false; });
};

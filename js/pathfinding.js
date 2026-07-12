/**
 * Under Fire — pathfinding.js
 * A* pathfinding, line-of-sight, and cover systems.
 * Operates on tile grid, returns world coordinates (x, z).
 */

Game.heuristic = (a, b) => {
    const dx = Math.abs(a.tx - b.tx), dy = Math.abs(a.ty - b.ty);
    // Roads cost 0.75, so scale octile distance by the cheapest possible tile.
    // An overestimating heuristic was preferring early, awkward routes.
    return 0.75 * (Math.max(dx, dy) + 0.41421356 * Math.min(dx, dy));
};

Game.tileCost = (unit, tx, ty, angle = unit.angle || 0, obstacleCtx = null) => {
    const tile = Game.getTile(tx, ty);
    if (!tile || tile.blocked) return Infinity;
    // Dynamic obstacles: tiles under PARKED vehicles (baked per-search by
    // findPath) carry a heavy surcharge, so a re-plan routes AROUND a hull
    // sitting on the way. A surcharge, not Infinity: a boxed-in unit still
    // gets a best-effort path (local avoidance + solid hulls own the truth).
    const dyn = (obstacleCtx && obstacleCtx.tiles.has(tx + ',' + ty)) ? 14 : 0;
    const isVeh = Game.isTank(unit.kind) || Game.isTruck(unit.kind);
    if (isVeh) {
        // Tanks CRUSH through dense forest (clearing trees) rather than route around
        // it — a low cost so A* takes the direct line through the woods, and the
        // foliage knock-down flattens the saplings as the hull passes.
        const p = Game.worldFromTile(tx, ty);
        // Configuration-space test: the complete oriented body must fit at this
        // node, with clearance from terrain and every parked vehicle. A centre
        // point on a legal tile is not enough for a 3.6u-long truck.
        if (Game._bodySolidCount && Game._bodySolidCount(unit, p.x, p.z, angle) > 0) return Infinity;
        if (obstacleCtx && Game._vehicleOBB && Game._obbPenetration) {
            const bodies = Game._vehicleCollisionOBBs
                ? Game._vehicleCollisionOBBs(unit, p.x, p.z, angle)
                : [Game._vehicleOBB(unit, p.x, p.z, angle)];
            for (const other of obstacleCtx.vehicles) {
                const otherBodies = Game._vehicleCollisionOBBs
                    ? Game._vehicleCollisionOBBs(other)
                    : [Game._vehicleOBB(other)];
                for (const body of bodies) for (const otherBody of otherBodies) {
                    if (Game._obbPenetration(body, otherBody, 0.20)) return Infinity;
                }
            }
        }
        if (tile.type === 'dense_forest') return 1.8;
        if (tile.vehicleBlocked) return Infinity;     // any genuinely impassable veh terrain
        let cost = tile.move;
        if (tile.type === 'forest' || tile.type === 'hedge') cost += 0.8;
        if (tile.type === 'mud') cost += 0.9;
        // Keep a hull's clearance from building/wall faces: a tile touching a
        // structure is surcharged (not blocked) so routes prefer to stand off a
        // tile rather than scrape the hull along a wall — while a vehicle boxed
        // in beside a building can still path out when there's no other way.
        for (let k = 0; k < 4; k++) {
            const nt = Game.getTile(tx + (k === 0 ? 1 : k === 1 ? -1 : 0), ty + (k === 2 ? 1 : k === 3 ? -1 : 0));
            if (nt && nt.blocked && (nt.type === 'house' || nt.type === 'wall')) { cost += 6; break; }
        }
        return cost;
    }
    return tile.move + dyn;
};

/**
 * Snapshot the footprints of PARKED vehicles (everyone except the pathing unit)
 * for one synchronous A* search. The context is passed explicitly; leaking a
 * global snapshot caused later units to route with another unit's exclusions.
 * Moving vehicles are deliberately NOT baked — they'll be gone by the time the
 * route is walked, and the local layers (yield, crossing-prediction, planner,
 * solid hulls) handle live traffic.
 */
Game._buildDynObstacles = (unit) => {
    const set = new Set();
    const vehicles = [];
    const T = Game.TILE;
    for (const o of Game.units) {
        if (!o.alive || o.id === unit.id) continue;
        if (unit._enterCarrierId === o.id) continue; // the assigned tailgate is a destination, not an obstacle
        if (!(Game.isTank(o.kind) || Game.isTruck(o.kind))) continue;
        // A freshly ordered group-mate has not accelerated yet but is about to
        // leave; baking it as a wall makes later members route around the whole
        // formation. A genuinely stalled/pathless hull remains an obstacle.
        const leavingNow = o.moving && o.path && o.path.length
            && (o.stopTimer || 0) <= 0 && (o._stuckT || 0) < 0.4;
        if ((o.currentSpeed || 0) > 0.15 || leavingNow) continue;
        vehicles.push(o);
        const bodies = Game._vehicleCollisionOBBs
            ? Game._vehicleCollisionOBBs(o)
            : [Game._vehicleOBB(o)];
        for (const body of bodies) {
            const rx = Math.abs(body.fx) * body.hl + Math.abs(body.rx) * body.hw + 0.4;
            const rz = Math.abs(body.fz) * body.hl + Math.abs(body.rz) * body.hw + 0.4;
            const tx0 = Math.floor((body.x - rx) / T), tx1 = Math.floor((body.x + rx) / T);
            const ty0 = Math.floor((body.z - rz) / T), ty1 = Math.floor((body.z + rz) / T);
            for (let ty = ty0; ty <= ty1; ty++) {
                for (let tx = tx0; tx <= tx1; tx++) set.add(tx + ',' + ty);
            }
        }
    }
    return { tiles: set, vehicles };
};

Game.findPath = (unit, startX, startZ, endX, endZ, startAngle = unit.angle || 0) => {
    const obstacleCtx = Game._buildDynObstacles(unit);
    const start = Game.tileAtWorld(startX, startZ);
    const requestedEnd = Game.tileAtWorld(endX, endZ);
    const end = { tx: requestedEnd.tx, ty: requestedEnd.ty };
    const isVeh = Game.isTank(unit.kind) || Game.isTruck(unit.kind);
    const dirs = [
        { dx: 1, dy: 0, a: 0 },
        { dx: 1, dy: 1, a: Math.PI / 4 },
        { dx: 0, dy: 1, a: Math.PI / 2 },
        { dx: -1, dy: 1, a: Math.PI * 3 / 4 },
        { dx: -1, dy: 0, a: Math.PI },
        { dx: -1, dy: -1, a: -Math.PI * 3 / 4 },
        { dx: 0, dy: -1, a: -Math.PI / 2 },
        { dx: 1, dy: -1, a: -Math.PI / 4 },
    ];
    const nearestDir = (angle) => {
        let best = 0, bd = Infinity;
        for (let i = 0; i < dirs.length; i++) {
            const d = Math.abs(Game.angleDiff(angle, dirs[i].a));
            if (d < bd) { bd = d; best = i; }
        }
        return best;
    };
    const endFits = (tx, ty) => isVeh
        ? dirs.some(d => isFinite(Game.tileCost(unit, tx, ty, d.a, obstacleCtx)))
        : !Game.isBlocked(tx, ty);
    if (!endFits(end.tx, end.ty)) {
        let found = null, bestD = Infinity;
        for (let radius = 1; radius <= 6 && !found; radius++) {
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const tx = end.tx + dx, ty = end.ty + dy;
                    if (!endFits(tx, ty)) continue;
                    const d = dx * dx + dy * dy;
                    if (d < bestD) { bestD = d; found = { tx, ty }; }
                }
            }
        }
        if (!found) return [];
        end.tx = found.tx; end.ty = found.ty;
    }

    // Binary heap with lazy decrease-key. Vehicle states include incoming
    // heading: the same tile approached north/south is not the same physical
    // configuration for a long rectangular hull.
    const heap = [];
    const hpush = (n) => {
        heap.push(n); let i = heap.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (heap[p].f <= heap[i].f) break;
            [heap[p], heap[i]] = [heap[i], heap[p]]; i = p;
        }
    };
    const hpop = () => {
        const top = heap[0], last = heap.pop();
        if (heap.length) {
            heap[0] = last; let i = 0;
            for (;;) {
                let s = i, l = i * 2 + 1, r = l + 1;
                if (l < heap.length && heap[l].f < heap[s].f) s = l;
                if (r < heap.length && heap[r].f < heap[s].f) s = r;
                if (s === i) break;
                [heap[s], heap[i]] = [heap[i], heap[s]]; i = s;
            }
        }
        return top;
    };
    const keyFor = (tx, ty, dir) => isVeh ? `${tx},${ty},${dir}` : `${tx},${ty}`;
    const startDir = nearestDir(startAngle);
    const node = {
        tx: start.tx, ty: start.ty, dir: startDir, angle: startAngle,
        wx: startX, wz: startZ, g: 0, h: Game.heuristic(start, end), f: 0, parent: null,
    };
    node.f = node.h;
    const gScore = new Map([[keyFor(start.tx, start.ty, startDir), 0]]);
    const closed = new Set();
    hpush(node);

    let best = node, reached = null, expanded = 0;
    const maxNodes = Game.MAP_COLS * Game.MAP_ROWS * (isVeh ? 8 : 1);
    while (heap.length && expanded < maxNodes) {
        const current = hpop();
        const currentKey = keyFor(current.tx, current.ty, current.dir);
        if (closed.has(currentKey)) continue;
        closed.add(currentKey); expanded++;
        if (current.h < best.h) best = current;
        if (current.tx === end.tx && current.ty === end.ty) { reached = current; break; }

        for (let dir = 0; dir < dirs.length; dir++) {
            const { dx, dy, a: moveAngle } = dirs[dir];
            // A wheeled lorry cannot reverse its steering direction by 135-180°
            // inside one three-unit grid edge. Its first edge may face anywhere
            // (the short reverse/three-point-turn layer handles that), but later
            // path states must remain forward-feasible.
            if (Game.isTruck(unit.kind) && current.parent
                && Math.abs(Game.angleDiff(current.angle, moveAngle)) > Math.PI / 2 + 1e-4) continue;
            const ntx = current.tx + dx, nty = current.ty + dy;
            const nkey = keyFor(ntx, nty, dir);
            if (closed.has(nkey)) continue;
            const cost = Game.tileCost(unit, ntx, nty, moveAngle, obstacleCtx);
            if (!isFinite(cost)) continue;
            if (isVeh) {
                const from = current.parent
                    ? Game.worldFromTile(current.tx, current.ty)
                    : { x: startX, z: startZ };
                const to = Game.worldFromTile(ntx, nty);
                if (!Game.segmentPassable(unit, from.x, from.z, to.x, to.z, {
                    startAngle: current.angle,
                    endAngle: moveAngle,
                    obstacleCtx,
                    margin: 0.20,
                })) continue;
            } else if (dx !== 0 && dy !== 0
                && (Game.isBlocked(current.tx + dx, current.ty)
                    || Game.isBlocked(current.tx, current.ty + dy))) {
                continue;
            }
            const diag = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
            const turn = isVeh
                ? Math.abs(Game.angleDiff(current.angle, moveAngle)) / (Math.PI / 4) * 0.22
                : 0;
            const ng = current.g + cost * diag + turn;
            if (ng >= (gScore.get(nkey) ?? Infinity)) continue;
            gScore.set(nkey, ng);
            const h = Game.heuristic({ tx: ntx, ty: nty }, end);
            hpush({
                tx: ntx, ty: nty, dir, angle: moveAngle,
                g: ng, h, f: ng + h, parent: current,
            });
        }
    }

    // A partial vehicle route is unsafe: callers would treat it as successful
    // and drive/circle at an arbitrary closest tile. Infantry retain historical
    // best-effort behaviour for orders into inaccessible cover.
    const finish = reached || (!isVeh ? best : null);
    if (!finish) return [];
    const path = [];
    for (let cur = finish; cur && cur.parent; cur = cur.parent) {
        const wp = Game.worldFromTile(cur.tx, cur.ty);
        path.push({ x: wp.x, z: wp.z, _pathAngle: cur.angle });
    }
    path.reverse();

    if (isVeh) {
        // Preserve the precise click only when the complete hull and its heading
        // transition fit all the way from the last grid configuration.
        const last = path[path.length - 1] || { x: startX, z: startZ, _pathAngle: startAngle };
        const finalAngle = Math.atan2(endZ - last.z, endX - last.x);
        if (Game.segmentPassable(unit, last.x, last.z, endX, endZ, {
            startAngle: last._pathAngle ?? finalAngle,
            endAngle: finalAngle,
            obstacleCtx,
            margin: 0.20,
        })) {
            if (Game.dist(last.x, last.z, endX, endZ) > 0.05) {
                path.push({ x: endX, z: endZ, _exactGoal: true, _pathAngle: finalAngle });
            } else {
                last.x = endX; last.z = endZ; last._exactGoal = true;
            }
        }
        return Game.smoothVehiclePath(unit, startX, startZ, path, obstacleCtx, startAngle);
    }
    return path;
};

/**
 * True when the straight segment (ax,az)→(bx,bz) crosses only tiles this unit
 * can traverse. Used by path smoothing and any code that fabricates a shortcut
 * waypoint, so a straightened line never clips through a building or wall.
 */
Game.segmentPassable = (unit, ax, az, bx, bz, options = null) => {
    const isVeh = Game.isTank(unit.kind) || Game.isTruck(unit.kind);
    const length = Math.hypot(bx - ax, bz - az);
    const travelAngle = length > 0.001 ? Math.atan2(bz - az, bx - ax) : (unit.angle || 0);
    if (!isVeh) {
        const steps = Math.max(1, Math.ceil(length));
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const tile = Game.getTileAtWorld(ax + (bx - ax) * t, az + (bz - az) * t);
            if (!tile || tile.blocked) return false;
        }
        return true;
    }

    const opts = options || {};
    const obstacleCtx = opts.obstacleCtx || Game._buildDynObstacles(unit);
    const startAngle = opts.startAngle ?? travelAngle;
    const endAngle = opts.endAngle ?? travelAngle;
    const da = Game.angleDiff(startAngle, endAngle);
    const ext = Game._vehicleHalfExtents(unit);
    const sweptDistance = Math.max(length, Math.hypot(ext.hl, ext.hw) * Math.abs(da));
    const steps = Math.max(1, Math.ceil(sweptDistance / 0.25));
    let margin = opts.margin ?? 0.30;
    if (Game.isTruck(unit.kind) && Math.abs(da) > 0.01) {
        // A straight chord understates the space a bicycle-model lorry consumes
        // while steering onto it. Add the capped lateral sagitta of its minimum
        // turn circle around parked OBBs. Capping it keeps this realistic
        // without making ordinary rotated/gate routes needlessly impossible.
        const modelScale = (Game.MODEL_SCALE
            && Game.MODEL_SCALE[unit.team + '_' + unit.kind]) || 1;
        const wheelbase = Math.max(0.8,
            (unit.size || 0.85) * (Game.TRUCK_WHEELBASE ?? 1.7) * modelScale);
        const maxSteer = Game.TRUCK_MAX_STEER ?? 0.5;
        const turnRadius = wheelbase / Math.max(0.1, Math.tan(maxSteer));
        const turn = Math.min(Math.abs(da), Math.PI / 2);
        const turnEnvelope = Math.min(0.80, turnRadius * (1 - Math.cos(turn)));
        margin = Math.max(margin, 0.20 + turnEnvelope);
    }

    let lastSolid = Game._bodySolidCount(unit, ax, az, startAngle);
    let terrainCleared = lastSolid === 0;
    const lastPen = new Map(), cleared = new Set();
    const penetrationAgainst = (bodies, other) => {
        const otherBodies = Game._vehicleCollisionOBBs
            ? Game._vehicleCollisionOBBs(other)
            : [Game._vehicleOBB(other)];
        let deepest = null;
        for (const body of bodies) for (const otherBody of otherBodies) {
            const p = Game._obbPenetration(body, otherBody, margin);
            if (p && (!deepest || p.depth > deepest.depth)) deepest = p;
        }
        return deepest;
    };
    const startBodies = Game._vehicleCollisionOBBs
        ? Game._vehicleCollisionOBBs(unit, ax, az, startAngle)
        : [Game._vehicleOBB(unit, ax, az, startAngle)];
    for (const other of obstacleCtx.vehicles) {
        const p = penetrationAgainst(startBodies, other);
        if (p) lastPen.set(other.id, p.depth);
        else cleared.add(other.id);
    }

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const angle = startAngle + da * t;
        const solid = Game._bodySolidCount(unit, x, z, angle);
        if ((terrainCleared && solid > 0) || (!terrainCleared && solid > lastSolid)) return false;
        if (solid === 0) terrainCleared = true;
        lastSolid = solid;

        const bodies = Game._vehicleCollisionOBBs
            ? Game._vehicleCollisionOBBs(unit, x, z, angle)
            : [Game._vehicleOBB(unit, x, z, angle)];
        for (const other of obstacleCtx.vehicles) {
            const p = penetrationAgainst(bodies, other);
            if (!p) { cleared.add(other.id); lastPen.delete(other.id); continue; }
            if (i === 0) continue;
            const prev = lastPen.get(other.id);
            if (cleared.has(other.id) || prev == null || p.depth > prev + 1e-4) return false;
            lastPen.set(other.id, p.depth);
            if (p.depth <= 1e-4) cleared.add(other.id);
        }
    }
    return true;
};

// Farthest-visible string pulling where visibility means a swept, full-width
// oriented corridor. Every retained edge is independently valid; if even the
// immediate graph edge is no longer valid, return no route instead of silently
// reinstating the unsafe segment.
Game.smoothVehiclePath = (unit, startX, startZ, route, obstacleCtx = null, startAngle = unit.angle || 0) => {
    if (!route || !route.length) return [];
    const ctx = obstacleCtx || Game._buildDynObstacles(unit);
    // The heading-state A* chain was already validated edge by edge. Preserve an
    // untouched fallback: a greedy far shortcut can be clear itself yet leave an
    // impossible heading for the following edge; that must not erase the order.
    const fallback = route.map(wp => ({ ...wp }));
    const out = [];
    let ax = startX, az = startZ, heading = startAngle, i = 0;
    while (i < route.length) {
        let chosen = -1, chosenAngle = heading;
        for (let j = route.length - 1; j >= i; j--) {
            const angle = Math.atan2(route[j].z - az, route[j].x - ax);
            if (Game.segmentPassable(unit, ax, az, route[j].x, route[j].z, {
                startAngle: heading,
                endAngle: angle,
                obstacleCtx: ctx,
                margin: 0.20,
            })) {
                chosen = j; chosenAngle = angle; break;
            }
        }
        if (chosen < 0) return fallback;
        const wp = { ...route[chosen], _pathAngle: chosenAngle };
        out.push(wp);
        ax = wp.x; az = wp.z; heading = chosenAngle;
        i = chosen + 1;
    }
    return out;
};

Game.lineOfSight = (a, b) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.9);
    let vis = 1;
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const x = a.x + dx * t, z = a.z + dz * t;
        const tile = Game.getTileAtWorld(x, z);
        if (!tile) return false;
        if (tile.sightBlock) {
            // A garrisoned shooter fires from its windows — its OWN building must
            // not block its line out (other buildings/walls still do).
            const own = a && a._garrisonRec && Game._footprintDistSq
                && Game._footprintDistSq(a._garrisonRec, x, z) <= 1.0;
            if (!own) return false;          // walls + other buildings: hard block
        }
        // Foliage / objects progressively obscure the line; enough of it blocks.
        switch (tile.type) {
            case 'dense_forest': vis *= 0.80; break;
            case 'forest':       vis *= 0.88; break;
            case 'hedge':        vis *= 0.83; break;
            case 'orchard':      vis *= 0.93; break;
            case 'wheat':        vis *= 0.97; break;
            default: break;
        }
        if (vis < 0.18) return 0;            // too obscured to see/shoot through
    }
    return vis;
};

Game.unitCanSee = (a, b) => {
    if (!a.alive || !b.alive) return false;
    // NOTE: this is a UNIT's own perception (line-of-sight + its sight range),
    // used for target acquisition and firing. It must NOT be gated by the
    // player's fog-of-war grid — otherwise units refuse to engage enemies in
    // plain sight just because the shared map fog hasn't revealed them (and
    // would target farther revealed enemies over closer ones). The fog grid is
    // for the player's display only (see renderer's isFogVisible checks).
    const d = Game.dist(a.x, a.z, b.x, b.z);
    let visRange = a.sight;
    const targetTile = Game.getTileAtWorld(b.x, b.z);
    if (targetTile) visRange *= (1 - targetTile.concealment * 0.35);
    const los = Game.lineOfSight(a, b);
    if (!los) return false;
    visRange *= los;
    // Stance affects how far the target can be spotted
    if (b.stance === 'prone') visRange *= 0.8;
    else if (b.stance === 'crouch') visRange *= 0.92;
    else if (b.stance === 'run') visRange *= 1.15;
    if (b.orderMode === 'hold') visRange *= 0.97;
    // Camouflage: targets in forest/hedge are harder to see
    if (b._camouflaged) visRange *= 0.6;
    // Weather visibility modifier
    if (Game.getWeatherVisibilityMod) visRange *= Game.getWeatherVisibilityMod();
    // Smoke clouds block LOS
    if (Game.isInSmoke && (Game.isInSmoke(b.x, b.z) || Game.isInSmoke((a.x + b.x) / 2, (a.z + b.z) / 2))) {
        visRange *= 0.3;
    }
    // Recon plane reveals all
    if (Game.isReconRevealed && Game.isReconRevealed(b.x, b.z)) {
        visRange = Math.max(visRange, Game.dist(a.x, a.z, b.x, b.z) + 5);
    }
    return d <= visRange;
};

Game.computeCover = (unit) => {
    const t = Game.getTileAtWorld(unit.x, unit.z);
    if (!t) return 0;
    let cover = t.cover || 0;
    const around = [
        [0, -1], [1, 0], [0, 1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]
    ];
    const tilePos = Game.tileAtWorld(unit.x, unit.z);
    for (const [dx, dy] of around) {
        const n = Game.getTile(tilePos.tx + dx, tilePos.ty + dy);
        if (!n) continue;
        if (n.type === 'wall') cover = Math.max(cover, 0.58);
        if (n.type === 'hedge') cover = Math.max(cover, 0.42);
        if (n.type === 'house') cover = Math.max(cover, 0.65);
    }
    // Sapper-built sandbag emplacements protect anyone hunkered behind them.
    if (Game.defenses) {
        for (const d of Game.defenses) {
            if (Game.distSq(d.x, d.z, unit.x, unit.z) <= 2.4 * 2.4) { cover = Math.max(cover, d.cover); break; }
        }
    }
    // A dug-in unit keeps its entrenchment cover (was previously overwritten here).
    if (unit.entrenched) cover = Math.max(cover, 0.5);
    if (unit.stance === 'prone') cover += 0.15;
    else if (unit.stance === 'crouch') cover += 0.08;
    return Game.clamp(cover, 0, 0.82);
};

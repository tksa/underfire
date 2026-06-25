/**
 * Under Fire — pathfinding.js
 * A* pathfinding, line-of-sight, and cover systems.
 * Operates on tile grid, returns world coordinates (x, z).
 */

Game.heuristic = (a, b) => Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty);

Game.tileCost = (unit, tx, ty) => {
    const tile = Game.getTile(tx, ty);
    if (!tile || tile.blocked) return Infinity;
    const isVeh = Game.isTank(unit.kind);
    if (isVeh && tile.vehicleBlocked) return Infinity;
    let cost = tile.move;
    if (isVeh && (tile.type === 'forest' || tile.type === 'hedge')) cost += 0.8;
    if (isVeh && tile.type === 'mud') cost += 0.9;
    return cost;
};

Game.findPath = (unit, startX, startZ, endX, endZ) => {
    const start = Game.tileAtWorld(startX, startZ);
    const end = Game.tileAtWorld(endX, endZ);
    if (Game.isBlocked(end.tx, end.ty)) {
        let found = null;
        for (let radius = 1; radius <= 4 && !found; radius++) {
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const tx = end.tx + dx, ty = end.ty + dy;
                    if (!Game.isBlocked(tx, ty)) { found = { tx, ty }; break; }
                }
                if (found) break;
            }
        }
        if (found) { end.tx = found.tx; end.ty = found.ty; }
        else return [];
    }

    const open = [];
    const openMap = new Map();
    const closed = new Set();

    const startKey = `${start.tx},${start.ty}`;
    const node = { tx: start.tx, ty: start.ty, g: 0, h: Game.heuristic(start, end), f: 0, parent: null };
    node.f = node.g + node.h;
    open.push(node);
    openMap.set(startKey, node);

    const dirs = [
        [1, 0], [-1, 0], [0, 1], [0, -1],
        [1, 1], [1, -1], [-1, 1], [-1, -1]
    ];

    let best = node;
    let safety = 0;
    while (open.length && safety++ < 3000) {
        open.sort((a, b) => a.f - b.f);
        const current = open.shift();
        const currentKey = `${current.tx},${current.ty}`;
        openMap.delete(currentKey);
        if (current.h < best.h) best = current;
        if (current.tx === end.tx && current.ty === end.ty) { best = current; break; }
        closed.add(currentKey);

        for (const [dx, dy] of dirs) {
            const ntx = current.tx + dx, nty = current.ty + dy;
            const nkey = `${ntx},${nty}`;
            if (closed.has(nkey)) continue;
            const cost = Game.tileCost(unit, ntx, nty);
            if (!isFinite(cost)) continue;
            const diag = (dx !== 0 && dy !== 0) ? 1.4 : 1.0;
            const ng = current.g + cost * diag;
            let neighbor = openMap.get(nkey);
            if (!neighbor) {
                neighbor = { tx: ntx, ty: nty, g: ng, h: Game.heuristic({ tx: ntx, ty: nty }, end), f: 0, parent: current };
                neighbor.f = neighbor.g + neighbor.h;
                open.push(neighbor);
                openMap.set(nkey, neighbor);
            } else if (ng < neighbor.g) {
                neighbor.g = ng;
                neighbor.f = neighbor.g + neighbor.h;
                neighbor.parent = current;
            }
        }
    }

    const path = [];
    let cur = best;
    while (cur) {
        const wp = Game.worldFromTile(cur.tx, cur.ty);
        path.push({ x: wp.x, z: wp.z });
        cur = cur.parent;
    }
    path.reverse();
    if (path.length > 1) path.shift();
    return path;
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
        if (tile.sightBlock) return false;   // walls + buildings: hard block
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

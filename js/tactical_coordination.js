/** Fire lanes and short, alternating squad bounds. Orders and defensive
 * reactions stay authoritative; no bound is planned from an unseen target. */
Game.friendlyFireBlocker = (unit, target) => {
    const weapon = Game.WEAPONS[unit.weaponKey] || {};
    if (weapon.fireType === 'indirect') return null;
    const dx = target.x - unit.x, dz = target.z - unit.z, length2 = dx * dx + dz * dz;
    if (length2 < 1) return null;
    const y0 = (unit.y || 0) + (Game.isTank(unit.kind) ? 1.1 : unit.stance === 'prone' ? 0.3 : unit.stance === 'crouch' ? 0.65 : 1.0);
    const y1 = (target.y ?? Game.getHeight?.(target.x, target.z) ?? 0) + (target.stance === 'prone' ? 0.25 : 0.7);
    for (const ally of Game.units) {
        if (!ally.alive || ally === unit || ally.id === target.id || ally.team !== unit.team
            || ally._inVehicle != null || ally._garrisoned || ally._towed) continue;
        const t = ((ally.x - unit.x) * dx + (ally.z - unit.z) * dz) / length2;
        if (t <= 0.01 || t >= 0.99) continue;
        const radius = Game.isTank(ally.kind) || Game.isTruck(ally.kind) ? ally.size * 1.3 : Math.max(0.25, ally.size * 0.55);
        if (Game.distSq(ally.x, ally.z, unit.x + dx * t, unit.z + dz * t) > radius * radius) continue;
        const height = Game.isTank(ally.kind) || Game.isTruck(ally.kind) ? 2.0
            : ally.stance === 'prone' ? 0.38 : ally.stance === 'crouch' ? 0.9 : 1.3;
        const y = y0 + (y1 - y0) * t;
        if (y >= (ally.y || 0) + 0.04 && y <= (ally.y || 0) + height) return ally;
    }
    return null;
};

Game.rememberEnemyContact = (unit, enemy) => {
    const contacts = unit._contacts ||= new Map();
    contacts.set(enemy.id, { id: enemy.id, x: enemy.x, z: enemy.z, at: Game.gameClock, kind: enemy.kind });
    // Bounded history, with snapshots rather than live references into fog.
    for (const [id, contact] of contacts) if (Game.gameClock - contact.at > 12) contacts.delete(id);
    if (contacts.size > 8) contacts.delete([...contacts].sort((a, b) => a[1].at - b[1].at)[0][0]);
};
Game.enemyContact = (unit, id) => {
    const c = unit._contacts?.get(id);
    if (!c) return null;
    const age = Math.max(0, Game.gameClock - c.at);
    return age >= 12 ? null : { ...c, confidence: 1 - age / 12 };
};

Game._coverReservations = new Map();
Game.coverSlotAvailable = (unit, x, z) => {
    for (const [id, slot] of Game._coverReservations) {
        if (slot.until < Game.gameClock || !Game.getUnitById(id)?.alive) {
            Game._coverReservations.delete(id); continue;
        }
        if (id !== unit.id && slot.team === unit.team && Game.distSq(x, z, slot.x, slot.z) < 2.2 * 2.2) return false;
    }
    return true;
};

Game.updateSquadManeuver = (squad, members, sightings) => {
    const now = Game.gameClock, foot = members.filter(u => Game.isFootInfantry(u)
        && !Game.isMountedCavalry?.(u) && !u.deployable && u.aiState !== 'player');
    const cancel = () => {
        for (const u of members) {
            if (u._squadBound === squad.bound && u._squadBound) { u.path = []; u.moving = false; }
            u._squadBound = null; Game._coverReservations.delete(u.id);
        }
        squad.bound = null;
    };
    if (squad.posture !== 'attack' || foot.length < 4) { cancel(); return; }
    const enemy = [...sightings.values()].find(e => e?.alive);
    if (!enemy) { cancel(); return; }
    const canCover = u => !u.moving && !u.path?.length && !u.holdFire
        && Game.weaponCanDischarge(u) && (u.suppressionValue || 0) < 55
        && Game.distSq(u.x, u.z, enemy.x, enemy.z) <= u.range * u.range
        && Game.unitCanSee(u, enemy) && !Game.friendlyFireBlocker(u, enemy);
    let bound = squad.bound;
    if (bound) {
        const movers = foot.filter(u => u._squadBound === bound);
        const arrived = movers.length && movers.every(u => !u.path?.length && (u._dispSpeed || 0) < 0.2);
        const supportLost = !members.some(u => u._squadBound !== bound && canCover(u));
        if (supportLost) { cancel(); squad.nextBoundAt = now + 3; return; }
        if ((arrived && now - bound.started > 2) || now > bound.until) {
            for (const u of movers) { u._squadBound = null; u.path = []; u.moving = false; }
            squad.boundPhase = 1 - bound.phase; squad.nextBoundAt = now + 1.5;
            squad.bound = null;
        }
        for (const u of foot) u._role = u._squadBound ? 'maneuver' : 'fire';
        return;
    }
    if (now < (squad.nextBoundAt || 0)) { foot.forEach(u => u._role = 'fire'); return; }
    const phase = squad.boundPhase || 0;
    const mobile = foot.filter(u => !['lmg', 'hmg'].includes(Game.WEAPONS[u.weaponKey]?.type));
    const movers = mobile.filter(u => (u.id & 1) === phase && !u._reload && !u._infantryAction
        && (u.suppressionValue || 0) < 45 && !u.forcedTargetId && !u._enterRec && u._enterCarrierId == null);
    const support = members.filter(u => !movers.includes(u) && canCover(u));
    if (!support.length || !movers.length) {
        foot.forEach(u => u._role = 'fire'); squad.boundPhase = 1 - phase;
        squad.nextBoundAt = now + 2; return;
    }
    bound = { phase, started: now, until: now + 8, targets: {} };
    for (const u of movers) {
        const distance = Game.dist(u.x, u.z, enemy.x, enemy.z);
        if (distance < 12) continue;
        const bearing = Game.angleTo(u.x, u.z, enemy.x, enemy.z);
        let best = null, score = -Infinity;
        for (const step of [6, 9]) for (const side of [-3, 0, 3]) {
            const x = u.x + Math.cos(bearing) * step - Math.sin(bearing) * side;
            const z = u.z + Math.sin(bearing) * step + Math.cos(bearing) * side;
            const tile = Game.getTileAtWorld(x, z);
            if (!tile || tile.blocked || !Game.coverSlotAvailable(u, x, z)
                || !Game.segmentPassable(u, u.x, u.z, x, z)) continue;
            const value = Game.coverAt(x, z) * 30 - Math.abs(side) * 0.2 + step * 0.1;
            if (value > score) { score = value; best = { x, z }; }
        }
        if (!best) continue;
        const path = Game.findPath(u, u.x, u.z, best.x, best.z);
        if (!path.length) continue;
        bound.targets[u.id] = best;
        u._squadBound = bound; u.path = path; u.moving = true; u._role = 'maneuver';
        Game._coverReservations.set(u.id, { ...best, team: u.team, until: now + 10 });
    }
    if (Object.keys(bound.targets).length) squad.bound = bound;
    else squad.nextBoundAt = now + 3;
    for (const u of foot) if (!u._squadBound) u._role = 'fire';
};

Game.followSquadBound = unit => {
    const bound = unit._squadBound, goal = bound?.targets[unit.id];
    if (!goal || Game.gameClock > bound.until || unit.team === Game.playerTeam) return false;
    if (unit.forcedTargetId || unit.retreating || (unit.suppressionValue || 0) >= 65) {
        unit._squadBound = null; Game._coverReservations.delete(unit.id); return false;
    }
    if (Game.distSq(unit.x, unit.z, goal.x, goal.z) < 1.2 * 1.2) {
        unit.path = []; unit.moving = false; unit._ai = 'overwatch';
        Game.wantStance(unit, 'crouch', 'bound-arrival', 1.5);
    } else {
        unit._ai = 'advance';
        Game.wantStance(unit, (unit.suppressionValue || 0) > 25 ? 'crouch' : 'stand', 'bound', 1.5);
    }
    return true;
};

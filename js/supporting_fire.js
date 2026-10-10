/** Brief, uncertain supporting fire based on observed friendly muzzle direction. */
Game._friendlyFireCues = [];
Game.noteFriendlyFireDirection = unit => {
    if (!unit.alive || unit._garrisoned || unit._inVehicle != null) return;
    const now = Game.gameClock || 0;
    const bearing = unit.hasTurret ? unit.turretAngle : unit.angle;
    const cues = Game._friendlyFireCues;
    // A squad's ongoing volley is one cue with a limited number of responders.
    // Supporting rounds never call this function, so they cannot start a chain.
    let cue = cues.find(c => c.team === unit.team && c.started <= now && now - c.started < 8
        && Game.distSq(c.x, c.z, unit.x, unit.z) < 24 * 24
        && Math.abs(Game.angleDiff(c.bearing, bearing)) < 0.4);
    if (!cue) {
        cue = { team: unit.team, started: now, responders: 0, responseCells: {} };
        cues.push(cue); if (cues.length > 64) cues.shift();
    }
    Object.assign(cue, { sourceId: unit.id, x: unit.x, z: unit.z, bearing, at: now });
};

// A visible volley can be noticed farther away than a concealed individual can
// be identified. Observe only the firing position and bearing, never its target.
Game.supportResponseCell = unit => `${Math.floor(unit.x / 16)}:${Math.floor(unit.z / 16)}`;

Game.canObserveFriendlyFire = (unit, cue) => {
    const source = Game.getUnitById(cue.sourceId);
    if (!source?.alive || source.team !== unit.team || source._inVehicle != null || source._garrisoned) return false;
    const radius = 64 * Math.min(1, Game.getWeatherVisibilityMod?.() ?? 1);
    if (Game.distSq(unit.x, unit.z, cue.x, cue.z) > radius * radius) return false;
    if (Game.isInSmoke?.(unit.x, unit.z) || Game.isInSmoke?.(cue.x, cue.z)
        || Game.isInSmoke?.((unit.x + cue.x) / 2, (unit.z + cue.z) / 2)) return false;
    return !!Game.lineOfSight(unit, cue);
};

Game.isForwardSupportingCue = (unit, cue) => {
    const ahead = (cue.x - unit.x) * Math.cos(cue.bearing) + (cue.z - unit.z) * Math.sin(cue.bearing);
    return ahead > 2 && Math.abs(Game.angleDiff(unit.angle, cue.bearing)) < 0.35;
};

Game.fireSupportingRound = (unit, burst) => {
    if (!unit.alive || unit.ammo === 0 || unit.holdFire) return false;
    const muzzle = Game.getWeaponMuzzle(unit);
    // Deliberately broad angular and depth uncertainty. There is no target ID,
    // enemy coordinate, accuracy bonus or direct-hit roll in this shot path.
    const bearing = burst.bearing + Game.rand(-0.24, 0.24);
    const reach = Math.min(180, unit.range * Game.rand(1.35, 2.35));
    let x = muzzle.x, z = muzzle.z;
    for (let d = 0.75; d <= reach; d += 0.75) {
        const nx = muzzle.x + Math.cos(bearing) * d, nz = muzzle.z + Math.sin(bearing) * d;
        const tile = Game.getTileAtWorld(nx, nz);
        if (!tile) break;
        x = nx; z = nz;
        // Foliage may hide enemies, but masonry and rising terrain stop bullets.
        if (tile.sightBlock || (Game.getHeight?.(x, z) || 0) > muzzle.y - 0.08) break;
    }
    const distance = Game.dist(muzzle.x, muzzle.z, x, z);
    if (distance < 2) return false;
    if (Game.friendlyFireBlocker(unit, { x, z })) return false;
    if (!Game.consumeWeaponRound(unit)) return false;
    Game.noteWeaponShot(unit); Game.noteCombatAt(unit.x, unit.z);
    Game.addTracer({ x: muzzle.x, z: muzzle.z, y0: muzzle.y,
        tx: x, tz: z, y1: (Game.getHeight?.(x, z) || 0) + 0.1,
        life: 0.1 + distance / 90, total: 0.1 + distance / 90,
        team: unit.team, big: false, mesh: null, supporting: true, weaponType: Game.WEAPONS[unit.weaponKey]?.type });
    (Game.muzzleFlashes ||= []).push({ x: muzzle.x, z: muzzle.z, y: muzzle.y,
        r: 0.12, life: 0.07, total: 0.07, mesh: null });
    Game.smoke.push({ x: muzzle.x, z: muzzle.z, baseY: muzzle.y,
        r: 0.15, life: 0.22, total: 0.22, vx: 0, vz: -0.3, mesh: null });
    const weapon = Game.WEAPONS[unit.weaponKey] || {};
    if (['lmg', 'smg'].includes(weapon.type)) Game.Audio?.mg(muzzle.x, muzzle.z);
    else Game.Audio?.rifle(muzzle.x, muzzle.z);
    // Only a near impact can exert a small suppressive effect. Hidden units are
    // never acquired, tracked, revealed or guaranteed a hit by supporting fire.
    for (const other of Game.units) {
        if (!other.alive || other.team === unit.team || Game.distSq(x, z, other.x, other.z) > 2.25) continue;
        if (Game.lineOfSight({ x, z }, other) === false) continue;
        other.suppressionValue = Math.min(100, (other.suppressionValue || 0) + 2);
    }
    unit.cooldownLeft = Math.max(unit.cooldown || 0.5, 0.65) * Game.rand(1.0, 1.4);
    return true;
};

Game.updateSupportingFire = (unit, dt, hasAimedTarget) => {
    const now = Game.gameClock || 0, weapon = Game.WEAPONS[unit.weaponKey] || {};
    const facing = unit._faceAngle != null && (unit._faceUntil || 0) > now;
    const eligible = unit.alive && unit.class === 'infantry'
        && ['rifle', 'lmg', 'smg'].includes(weapon.type)
        && !Game.isMountedCavalry?.(unit) && !unit.holdFire && Game.weaponCanDischarge(unit)
        && !unit._garrisoned && unit._inVehicle == null && !unit._unmanned
        && !unit.moving && !unit.path?.length && (unit._dispSpeed || unit.currentSpeed || 0) < 0.2
        && unit.forcedTargetId == null && unit.bombardX == null && unit._grenadeChargeId == null
        && !unit.retreating && unit.orderMode !== 'retreat' && !unit._enterRec && unit._enterCarrierId == null
        && (unit._evadeUntil || 0) <= now
        && unit._combatReady !== false && (unit.suppressionValue || 0) < 45 && !hasAimedTarget;
    if (!eligible) { unit._supportFire = null; return; }
    if (facing && unit._supportFire) {
        if (Math.abs(Game.angleDiff(unit._faceAngle, unit._supportFire.bearing)) > 0.35) {
            unit._supportFire = null; return;
        }
        unit._supportFire.bearing = unit._faceAngle;
    }
    if (unit._supportCheckAt == null) unit._supportCheckAt = now + Game.rand(.35, 1.25);
    if (!unit._supportFire && now >= unit._supportCheckAt) {
        const cues = Game._friendlyFireCues.filter(c => {
            if (c.team !== unit.team || c.at > now || now - c.at > 6 || c.responders >= 6
                || (c.responseCells?.[Game.supportResponseCell(unit)] || 0) >= 2 || c.sourceId === unit.id
                || (facing && Math.abs(Game.angleDiff(unit._faceAngle, c.bearing)) > 0.35)) return false;
            return Game.canObserveFriendlyFire(unit, c);
        });
        const cue = cues.find(c => Game.isForwardSupportingCue(unit, c)) || cues[0];
        // Do not spend the long response cooldown while there is no volley:
        // troops should notice friendlies beginning to fire a moment later.
        if (!cue) { unit._supportCheckAt = now + Game.rand(.35, .8); return; }
        const forward = Game.isForwardSupportingCue(unit, cue);
        if (Math.random() > (forward ? .75 : .3)) {
            unit._supportCheckAt = now + Game.rand(1, 2.4); return;
        }
        unit._supportCheckAt = now + (forward ? Game.rand(8, 16) : Game.rand(14, 26));
        cue.responders++;
        const cell = Game.supportResponseCell(unit);
        cue.responseCells ||= {}; cue.responseCells[cell] = (cue.responseCells[cell] || 0) + 1;
        unit._supportFire = { bearing: facing ? unit._faceAngle : cue.bearing + Game.rand(-0.1, 0.1),
            remaining: Math.random() < 0.7 ? 2 : 1, until: now + 9,
            next: now + Game.rand(.2, .65), stable: 0 };
    }
    const burst = unit._supportFire;
    if (!burst) return;
    if (now > burst.until || burst.remaining <= 0) { unit._supportFire = null; return; }
    unit.angle = Game.rotateTo(unit.angle, burst.bearing, 3 * dt); unit.turretAngle = unit.angle;
    const aligned = Math.abs(Game.angleDiff(unit.angle, burst.bearing)) < 0.15;
    burst.stable = aligned ? burst.stable + dt : 0;
    unit.weaponState = 'supporting';
    if (burst.stable >= 0.22 && now >= burst.next && unit.cooldownLeft <= 0) {
        if (!Game.fireSupportingRound(unit, burst)) { unit._supportFire = null; return; }
        burst.remaining--; burst.next = now + unit.cooldownLeft + Game.rand(0.15, 0.6);
    }
};

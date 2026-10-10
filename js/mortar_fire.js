/** Area missions: an unobserved bombardment remains uncertain. Only an allied
 * observer seeing a round land can correct the shared range/bearing error. */
Game.groundFireRadius = 8;
Game.mortarDistanceLabel = distance => `${Math.round(distance / (Game.SCALE?.unitsPerMeter || 1))}m`;
Game.isMortar = unit => Game.WEAPONS[unit.weaponKey]?.type === 'mortar';
Game.mortarSkill = unit => Game.clamp((unit.experience || 0) / 125 + (unit.veterancy || 0) * .35, 0, 1);
Game.mortarObserver = (unit, x, z) => Game.units.find(ally => ally.alive && ally.team === unit.team
    && ally._inVehicle == null && !ally._unmanned
    && Game.distSq(ally.x, ally.z, x, z) <= ((ally.sight || 0) * (Game.getWeatherVisibilityMod?.() ?? 1)) ** 2
    && !Game.isInSmoke?.(x, z) && !Game.isInSmoke?.((ally.x + x) / 2, (ally.z + z) / 2)
    && Game.lineOfSight(ally, { x, z }));

Game.ensureMortarMission = (unit, x, z) => {
    let m = unit._mortarMission;
    const radius = Game.clamp(unit.bombardRadius ?? 8, 0, 24), mode = unit.mortarFireMode || 'ranged';
    if (!m || m.x !== x || m.z !== z || m.radius !== radius || Game.distSq(m.ux, m.uz, unit.x, unit.z) > 4) {
        const bearing = Game.rand(-Math.PI, Math.PI);
        m = unit._mortarMission = { x, z, radius, mode, ux: unit.x, uz: unit.z,
            serial: (unit._mortarSerial = (unit._mortarSerial || 0) + 1),
            prep: 0, correction: 0, rounds: 0, observedRounds: 0,
            biasX: Math.cos(bearing), biasZ: Math.sin(bearing), nextObserve: 0 };
    }
    if (m.mode !== mode) { m.mode = mode; m.prep = 0; }
    return m;
};
Game.mortarPreparationTime = unit => (unit.mortarFireMode === 'rapid' ? .6 : 5.5) * (1 - .5 * Game.mortarSkill(unit));
Game.prepareMortarFire = (unit, dt, x, z) => {
    const m = Game.ensureMortarMission(unit, x, z);
    if (unit.holdFire || unit._unmanned || unit._towed || unit._inVehicle != null || !Game.weaponCanDischarge(unit)) return false;
    if (unit.deployable && !unit._canFire) { unit.weaponState = 'deploying'; return false; }
    const now = Game.gameClock || 0;
    if (now >= m.nextObserve) {
        m.observed = !!Game.mortarObserver(unit, x, z); m.nextObserve = now + .8;
    }
    m.prep += dt / (1 + (unit.suppressionValue || 0) / 60);
    const ready = m.prep >= Game.mortarPreparationTime(unit);
    if (!ready) unit.weaponState = m.mode === 'rapid' ? 'laying' : 'ranging';
    return ready;
};
Game.mortarImpactPoint = (unit, x, z) => {
    const m = Game.ensureMortarMission(unit, x, z), skill = Game.mortarSkill(unit);
    const distance = Game.dist(unit.x, unit.z, x, z);
    const laid = m.mode === 'ranged' ? .2 : 0;
    const correction = Game.clamp(m.correction + laid, 0, .95);
    const error = (4 + distance * .025) * (1 - skill * .35) * (1 - correction * .87);
    const angle = Game.rand(-Math.PI, Math.PI), radius = Math.sqrt(Math.random()) * m.radius;
    const dispersion = (1.4 + distance * .003) * (1 - skill * .3);
    m.rounds++;
    return { x: Game.clamp(x + Math.cos(angle) * radius + m.biasX * error + Game.rand(-dispersion, dispersion), 0, Game.WORLD_W),
        z: Game.clamp(z + Math.sin(angle) * radius + m.biasZ * error + Game.rand(-dispersion, dispersion), 0, Game.WORLD_H),
        error, mission: m.serial };
};
Game.observeMortarImpact = shell => {
    if (shell.shooterId == null) return;
    const unit = Game.getUnitById(shell.shooterId), m = unit?._mortarMission;
    if (!unit?.alive || !m || m.serial !== shell.mission || unit.bombardX == null
        || Game.distSq(m.ux, m.uz, unit.x, unit.z) > 4) return;
    if (!Game.mortarObserver(unit, shell.sx, shell.sz)) return;
    m.observedRounds++;
    m.correction = Math.min(.9, m.correction + .14 + Game.mortarSkill(unit) * .23);
    unit.experience = Math.min(100, (unit.experience || 0) + .6);
};
Game.mortarStatus = unit => {
    const m = unit._mortarMission;
    if (unit.bombardX == null || !m) return '';
    if (unit.holdFire) return 'Bombardment on hold';
    if (unit.moving) return 'Moving into mortar range';
    if (unit._unmanned) return 'Mortar needs crew';
    if (unit.deployable && !unit._canFire) return 'Deploying mortar';
    const remaining = Math.max(0, Game.mortarPreparationTime(unit) - m.prep);
    if (remaining > 0) return `${m.mode === 'rapid' ? 'Laying' : 'Sighting'} ${remaining.toFixed(1)}s`;
    return `${m.mode === 'rapid' ? 'Rapid' : 'Ranged'} fire · ${Game.mortarDistanceLabel(m.radius)} radius · ${m.observed ? `correction ${Math.round(m.correction * 100)}%` : 'unobserved'}`;
};
Game.beginGroundFireCommand = () => {
    Game._commandMode = 'attackground';
    const mortars = Game.selectedPlayerUnits().filter(Game.isMortar);
    Game.pushMessage(mortars.length
        ? `Mortar area: ${Game.mortarDistanceLabel(Game.groundFireRadius)} radius. Wheel adjusts area; click terrain to fire. Use Ranged / Rapid to choose preparation.`
        : 'Attack ground: click a spot to suppress.', 4);
};
Game.setMortarFireMode = mode => {
    mode = mode === 'rapid' ? 'rapid' : 'ranged';
    for (const unit of Game.selectedPlayerUnits().filter(Game.isMortar)) unit.mortarFireMode = mode;
    Game.pushMessage(mode === 'rapid' ? 'Rapid mortar fire: short preparation, wider opening rounds.'
        : 'Ranged mortar fire: sight first, then correct observed impacts.', 3);
    Game.updateCommandDeck?.();
};
Game.toggleMortarFireMode = () => {
    const units = Game.selectedPlayerUnits().filter(Game.isMortar);
    Game.setMortarFireMode(units.every(u => u.mortarFireMode === 'rapid') ? 'ranged' : 'rapid');
};
Game.setGroundFireRadius = value => {
    Game.groundFireRadius = Game.clamp(value, 2, 24);
    if (Game._commandMode !== 'attackground') {
        for (const u of Game.selectedPlayerUnits().filter(Game.isMortar)) {
            if (u.bombardX != null) { u.bombardRadius = Game.groundFireRadius; Game.ensureMortarMission(u, u.bombardX, u.bombardZ); }
        }
    }
    Game.updateCommandDeck?.();
};

Game.updateMortarAreaMarkers = () => {
    const T = Game.THREE;
    if (!Game.scene) return;
    const mortars = Game.selectedPlayerUnits().filter(Game.isMortar);
    const areas = mortars.filter(u => u.bombardX != null).map(u => ({ x: u.bombardX, z: u.bombardZ, radius: u.bombardRadius ?? 8 }));
    if (mortars.length && Game._commandMode === 'attackground') areas.push({ x: Game.mouse.worldX, z: Game.mouse.worldZ, radius: Game.groundFireRadius,
        tooClose: mortars.every(u => Game.dist(u.x, u.z, Game.mouse.worldX, Game.mouse.worldZ) < (Game.WEAPONS[u.weaponKey].minRange || 0)) });
    const pool = Game._mortarAreaMarkers ||= [];
    for (let i = 0; i < Math.max(areas.length, pool.length); i++) {
        if (!areas[i]) { pool[i].visible = false; continue; }
        const a = areas[i];
        if (!pool[i]) {
            const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(65 * 3), 3));
            pool[i] = new T.Line(geometry, new T.LineBasicMaterial({ color: 0xe5a85f, transparent: true, opacity: .8, depthWrite: false }));
            pool[i].raycast = () => {}; Game.scene.add(pool[i]);
        }
        const line = pool[i], points = line.geometry.attributes.position;
        line.visible = Number.isFinite(a.x) && Number.isFinite(a.z);
        if (!line.visible) continue;
        if (line.parent !== Game.scene) Game.scene.add(line);
        line.material.color.setHex(a.tooClose ? 0xd45b47 : 0xe5a85f);
        for (let k = 0; k <= 64; k++) {
            const angle = k / 64 * Math.PI * 2, x = a.x + Math.cos(angle) * a.radius, z = a.z + Math.sin(angle) * a.radius;
            points.setXYZ(k, x, (Game.getHeight?.(x, z) || 0) + .09, z);
        }
        points.needsUpdate = true; line.geometry.computeBoundingSphere();
    }
};

/**
 * Under Fire — mission.js
 * Scenario setup using the expanded unit roster.
 * Coordinates are in 3D world space (tile * TILE).
 */

/**
 * Spawn a doctrinal infantry squad around (x, z) — vision doc compositions.
 * French Groupe de Combat: leader + FM 24/29 team + riflemen.
 * German Gruppe: SMG leader + MG34 team + riflemen.
 */
Game.spawnSquad = (team, x, z, group, opts = {}) => {
    const roster = team === Game.TEAM.FRENCH
        ? ['smg', 'fm24', 'fusilier', 'fusilier', 'fusilier', 'fusilier', 'fusilier']
        : ['smg', 'mg34', 'grenadier', 'grenadier', 'grenadier', 'grenadier', 'grenadier'];
    const made = [];
    roster.forEach((kind, i) => {
        const a = (i / roster.length) * Math.PI * 2;
        const r = i === 0 ? 0 : Game.rand(1.5, 3.2);
        const u = Game.makeUnit(team, kind,
            x + Math.cos(a) * r, z + Math.sin(a) * r,
            { group, ...opts });
        if (u) made.push(u);
    });
    return made;
};

Game.spawnScenario = () => {
    const { FRENCH, GERMAN } = Game.TEAM;
    const T = Game.TILE;

    // ═══════════════════════════════════════════════════
    //  FRENCH FORCES — Section (platoon): 3 squads + support + armor
    // ═══════════════════════════════════════════════════

    Game.spawnSquad(FRENCH, 4 * T, 6 * T, 'A', { aiState: 'player' });
    Game.spawnSquad(FRENCH, 4.5 * T, 10 * T, 'B', { aiState: 'player' });
    Game.spawnSquad(FRENCH, 7 * T, 8 * T, 'C', { aiState: 'player' });

    // Support section
    Game.makeUnit(FRENCH, 'sniper', 6 * T, 5 * T, { group: 'S', aiState: 'player' });
    Game.makeUnit(FRENCH, 'hmg', 5.5 * T, 12.5 * T, { group: 'S', aiState: 'player' });
    Game.makeUnit(FRENCH, 'mortar_60', 2 * T, 11 * T, { group: 'S', aiState: 'player' });
    Game.makeUnit(FRENCH, 'at_25mm', 3 * T, 12 * T, { group: 'S', aiState: 'player' });
    Game.makeUnit(FRENCH, 'at_47mm', 2 * T, 13.5 * T, { group: 'S', aiState: 'player' });

    // Armor — French tanks individually strong (vision doc)
    Game.makeUnit(FRENCH, 'h35', 2.6 * T, 10 * T, { group: 'Armor', aiState: 'player', veterancy: .12 });
    Game.makeUnit(FRENCH, 's35', 5 * T, 11 * T, { group: 'Armor', aiState: 'player', veterancy: .16 });
    Game.makeUnit(FRENCH, 'r35', 3.8 * T, 13 * T, { group: 'Armor', aiState: 'player', veterancy: .10 });
    Game.makeUnit(FRENCH, 'b1', 6.5 * T, 12.5 * T, { group: 'Armor', aiState: 'player', veterancy: .14 });
    Game.makeUnit(FRENCH, 'panhard', 8 * T, 6 * T, { group: 'Recon', aiState: 'player' });

    // Support units
    Game.makeUnit(FRENCH, 'medic', 3 * T, 8 * T, { group: 'S', aiState: 'player' });
    Game.makeUnit(FRENCH, 'mechanic', 3.5 * T, 11.5 * T, { group: 'S', aiState: 'player' });
    Game.makeUnit(FRENCH, 'supply_truck', 1.5 * T, 12 * T, { group: 'S', aiState: 'player' });
    Game.makeUnit(FRENCH, 'fuel_truck', 1.5 * T, 13.5 * T, { group: 'S', aiState: 'player' });
    Game.makeUnit(FRENCH, 'sapper', 5 * T, 13 * T, { group: 'S', aiState: 'player' });
    Game.makeUnit(FRENCH, 'officer', 4.5 * T, 8 * T, { group: 'A', aiState: 'player' });

    // ═══════════════════════════════════════════════════
    //  GERMAN DEFENDERS — Holding line with support
    // ═══════════════════════════════════════════════════

    const hold = (x, z) => ({ aiState: 'hold', holdPoint: { x: x * T, z: z * T } });

    // The hamlet's anchor wanders per map (generateMap picks Game.villageOfs);
    // the German garrison shifts with it. The forward outpost clamps its
    // westward drift so it never crowds the French staging corner.
    const vdx = (Game.villageOfs && Game.villageOfs.dx) || 0;
    const vdy = (Game.villageOfs && Game.villageOfs.dy) || 0;
    const odx = Math.max(-3, vdx);

    // Forward outpost squad at the hedgeline
    Game.spawnSquad(GERMAN, (21 + odx) * T, (6 + vdy) * T, 'out', hold(21 + odx, 6 + vdy));
    Game.makeUnit(GERMAN, 'mg34', (24.5 + odx) * T, (6.2 + vdy) * T, hold(24.5 + odx, 6.2 + vdy));

    // Village defense squad
    Game.spawnSquad(GERMAN, (28 + vdx) * T, (10.5 + vdy) * T, 'vil', hold(28 + vdx, 10.5 + vdy));
    Game.makeUnit(GERMAN, 'hmg', (27 + vdx) * T, (12 + vdy) * T, hold(27 + vdx, 12 + vdy));

    // Support
    Game.makeUnit(GERMAN, 'mortar_50', (33 + vdx) * T, (14 + vdy) * T, hold(33 + vdx, 14 + vdy));
    Game.makeUnit(GERMAN, 'mortar_81', (34 + vdx) * T, (15.5 + vdy) * T, hold(34 + vdx, 15.5 + vdy));
    Game.makeUnit(GERMAN, 'pak36', (30 + vdx) * T, (13 + vdy) * T, hold(30 + vdx, 13 + vdy));
    Game.makeUnit(GERMAN, 'sniper', (35 + vdx) * T, (10 + vdy) * T, hold(35 + vdx, 10 + vdy));

    // Armor — numerous, lighter (vision doc: German tempo)
    Game.makeUnit(GERMAN, 'sdkfz', (30.5 + vdx) * T, (8 + vdy) * T, {
        aiState: 'patrol', patrol: [
            { x: (30.5 + vdx) * T, z: (8 + vdy) * T }, { x: (34.7 + vdx) * T, z: (10.5 + vdy) * T }
        ]
    });
    Game.makeUnit(GERMAN, 'panzer1', (33 + vdx) * T, (9 + vdy) * T, hold(33 + vdx, 9 + vdy));
    Game.makeUnit(GERMAN, 'panzer2', (35.4 + vdx) * T, (12.5 + vdy) * T, { ...hold(35.4 + vdx, 12.5 + vdy), veterancy: .08 });
    Game.makeUnit(GERMAN, 'panzer3', (37 + vdx) * T, (13.5 + vdy) * T, { ...hold(37 + vdx, 13.5 + vdy), veterancy: .10 });

    // Crossroads garrison squad
    Game.spawnSquad(GERMAN, (37.5 + vdx) * T, (16 + vdy) * T, 'cross', hold(37.5 + vdx, 16 + vdy));
    Game.makeUnit(GERMAN, 'mg34', (36.9 + vdx) * T, (17 + vdy) * T, hold(36.9 + vdx, 17 + vdy));
    Game.makeUnit(GERMAN, 'grenadier', (32.5 + vdx) * T, (21 + vdy) * T, hold(32.5 + vdx, 21 + vdy));

    // Auto-select first French squad
    Game.selection.clear();
    Game.units.filter(u => u.team === Game.TEAM.FRENCH && u.group === 'A').forEach(u => Game.selection.add(u.id));
    Game.units.forEach(u => {
        if (u.mesh && u.mesh.userData.selectionRing) {
            u.mesh.userData.selectionRing.visible = Game.selection.has(u.id);
        }
    });

    Game.pushMessage('French vanguard deployed. Seize the crossroads.', 6);
};

Game.updateMission = (dt) => {
    if (Game.missionState.won || Game.missionState.lost) return;
    Game.missionState.timer += dt;

    const playerAlive = Game.getTeamUnits(Game.TEAM.FRENCH).length;
    const enemyAlive = Game.getTeamUnits(Game.TEAM.GERMAN).length;

    if (playerAlive === 0) {
        Game.missionState.lost = true;
        Game.pushMessage('French force destroyed. Mission failed.', 20);
    }

    const nearby = Game.units.some(u => u.alive && u.team === Game.TEAM.FRENCH &&
        Game.dist(u.x, u.z, Game.missionState.objectiveX, Game.missionState.objectiveY) < 7);
    if (nearby || enemyAlive === 0) {
        Game.missionState.won = true;
        Game.pushMessage('Crossroads secured. Mission accomplished.', 20);
    }

    // Reinforcement wave
    if (!Game.missionState.reinforcementTriggered && Game.missionState.timer > 55) {
        Game.missionState.reinforcementTriggered = true;
        const T = Game.TILE;
        const vdx = (Game.villageOfs && Game.villageOfs.dx) || 0;
        const vdy = (Game.villageOfs && Game.villageOfs.dy) || 0;
        Game.spawnSquad(Game.TEAM.GERMAN, (46 + vdx) * T, (9 + vdy) * T, 'reserve', { aiState: 'attack' });
        Game.makeUnit(Game.TEAM.GERMAN, 'panzer2', (47 + vdx) * T, (10 + vdy) * T, { aiState: 'attack', veterancy: .1 });
        Game.makeUnit(Game.TEAM.GERMAN, 'panzer4', (48 + vdx) * T, (11 + vdy) * T, { aiState: 'attack', veterancy: .1 });
        Game.pushMessage('Enemy reserve elements arriving from the east!', 6);
    }
};

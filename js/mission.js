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

    // Forward outpost squad at the hedgeline
    Game.spawnSquad(GERMAN, 21 * T, 6 * T, 'out', hold(21, 6));
    Game.makeUnit(GERMAN, 'mg34', 24.5 * T, 6.2 * T, hold(24.5, 6.2));

    // Village defense squad
    Game.spawnSquad(GERMAN, 28 * T, 10.5 * T, 'vil', hold(28, 10.5));
    Game.makeUnit(GERMAN, 'hmg', 27 * T, 12 * T, hold(27, 12));

    // Support
    Game.makeUnit(GERMAN, 'mortar_50', 33 * T, 14 * T, hold(33, 14));
    Game.makeUnit(GERMAN, 'mortar_81', 34 * T, 15.5 * T, hold(34, 15.5));
    Game.makeUnit(GERMAN, 'pak36', 30 * T, 13 * T, hold(30, 13));
    Game.makeUnit(GERMAN, 'sniper', 35 * T, 10 * T, hold(35, 10));

    // Armor — numerous, lighter (vision doc: German tempo)
    Game.makeUnit(GERMAN, 'sdkfz', 30.5 * T, 8 * T, {
        aiState: 'patrol', patrol: [
            { x: 30.5 * T, z: 8 * T }, { x: 34.7 * T, z: 10.5 * T }
        ]
    });
    Game.makeUnit(GERMAN, 'panzer1', 33 * T, 9 * T, hold(33, 9));
    Game.makeUnit(GERMAN, 'panzer2', 35.4 * T, 12.5 * T, { ...hold(35.4, 12.5), veterancy: .08 });
    Game.makeUnit(GERMAN, 'panzer3', 37 * T, 13.5 * T, { ...hold(37, 13.5), veterancy: .10 });

    // Crossroads garrison squad
    Game.spawnSquad(GERMAN, 37.5 * T, 16 * T, 'cross', hold(37.5, 16));
    Game.makeUnit(GERMAN, 'mg34', 36.9 * T, 17 * T, hold(36.9, 17));
    Game.makeUnit(GERMAN, 'grenadier', 32.5 * T, 21 * T, hold(32.5, 21));

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
        Game.spawnSquad(Game.TEAM.GERMAN, 46 * T, 9 * T, 'reserve', { aiState: 'attack' });
        Game.makeUnit(Game.TEAM.GERMAN, 'panzer2', 47 * T, 10 * T, { aiState: 'attack', veterancy: .1 });
        Game.makeUnit(Game.TEAM.GERMAN, 'panzer4', 48 * T, 11 * T, { aiState: 'attack', veterancy: .1 });
        Game.pushMessage('Enemy reserve elements arriving from the east!', 6);
    }
};

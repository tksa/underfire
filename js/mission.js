/**
 * Under Fire — mission.js
 * Scenario setup using the expanded unit roster.
 * Coordinates are in 3D world space (tile * TILE).
 *
 * SIDE-AWARE: Game.playerTeam picks who the human commands. The player's force
 * always stages in the west corner and attacks; the AI side garrisons the
 * village/crossroads (concealed spawns) and defends. Compositions mirror each
 * other doctrinally (vision doc): strong-individual French armor vs numerous
 * lighter German armor.
 */

// Tile types that hide a waiting soldier (tree lines, bushes, standing crops).
Game._CONCEAL_VEG = {
    dense_forest: 90, forest: 78, hedge: 72, vineyard: 55,
    wheat: 48, orchard: 46, garden: 40,
};

/**
 * Find a concealed position near (x, z) for a defender: a bush / tree line /
 * crop tile, or the tile on the FAR side of a wall or house from the attacker's
 * staging area (troops wait behind the wall, not in front of it). Real troops
 * don't stand around in open fields. Returns {x, z, type} or null when there's
 * nothing usable within the search radius.
 */
Game.findConcealedSpawn = (x, z, radiusTiles = 6, opts = {}) => {
    const T = Game.TILE;
    const tp = Game.tileAtWorld(x, z);
    const threat = opts.threat || Game.frenchStaging || { x: 5 * T, z: 9 * T };
    let best = null, bestScore = 8;
    for (let dy = -radiusTiles; dy <= radiusTiles; dy++) {
        for (let dx = -radiusTiles; dx <= radiusTiles; dx++) {
            const t = Game.getTile(tp.tx + dx, tp.ty + dy);
            if (!t || t.blocked) continue;
            const cx = (tp.tx + dx + 0.5) * T, cz = (tp.ty + dy + 0.5) * T;
            let score = Game._CONCEAL_VEG[t.type] || 0;
            if (!score) {
                // Behind hard cover: adjacent to a wall/house AND on the side facing
                // AWAY from the attacker (the masonry stands between them).
                for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const n = Game.getTile(tp.tx + dx + ax, tp.ty + dy + ay);
                    if (!n || (n.type !== 'wall' && n.type !== 'house')) continue;
                    const wx = (tp.tx + dx + ax + 0.5) * T, wz = (tp.ty + dy + ay + 0.5) * T;
                    if ((cx - wx) * (threat.x - wx) + (cz - wz) * (threat.z - wz) < 0) {
                        score = 66;
                        break;
                    }
                }
            }
            if (!score) continue;
            score -= Game.dist(x, z, cx, cz) * 1.4;   // stay near the assigned post
            score += Game.rand(0, 6);                 // spread a squad along the feature
            if (score > bestScore) { bestScore = score; best = { x: cx, z: cz, type: t.type }; }
        }
    }
    return best;
};

/**
 * Spawn a doctrinal infantry squad around (x, z) — vision doc compositions.
 * French Groupe de Combat: leader + FM 24/29 team + riflemen.
 * German Gruppe: SMG leader + MG34 team + riflemen.
 * opts.concealed: each man takes the nearest bush / tree line / behind-wall spot
 * to his slot (and kneels in vegetation) instead of standing in the open.
 */
Game.spawnSquad = (team, x, z, group, opts = {}) => {
    const roster = team === Game.TEAM.FRENCH
        ? ['smg', 'fm24', 'fusilier', 'fusilier', 'fusilier', 'fusilier', 'fusilier']
        : ['smg', 'mg34', 'grenadier', 'grenadier', 'grenadier', 'grenadier', 'grenadier'];
    const made = [];
    const { concealed, ...unitOpts } = opts;
    roster.forEach((kind, i) => {
        const a = (i / roster.length) * Math.PI * 2;
        const r = i === 0 ? 0 : Game.rand(1.5, 3.2);
        let px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        let spot = null;
        if (concealed && Game.findConcealedSpawn) {
            spot = Game.findConcealedSpawn(px, pz, 6);
            if (spot) { px = spot.x + Game.rand(-1.0, 1.0); pz = spot.z + Game.rand(-1.0, 1.0); }
        }
        const u = Game.makeUnit(team, kind, px, pz, { group, ...unitOpts });
        if (u) {
            // Kneel in the greenery (ambient idle leaves a deliberate crouch alone);
            // behind a wall they stand ready against the masonry.
            if (spot && Game._CONCEAL_VEG[spot.type]) u.stance = 'crouch';
            made.push(u);
        }
    });
    return made;
};

/**
 * Spawn a single defender concealed near (x, z) — see findConcealedSpawn.
 */
Game.makeUnitConcealed = (team, kind, x, z, opts = {}) => {
    const spot = Game.findConcealedSpawn ? Game.findConcealedSpawn(x, z, 6) : null;
    const u = Game.makeUnit(team, kind, spot ? spot.x : x, spot ? spot.z : z, opts);
    if (u && spot && Game._CONCEAL_VEG[spot.type]) u.stance = 'crouch';
    return u;
};

/**
 * Switch the player's side IN PLACE — no page reload: despawn every unit,
 * reset the mission/squad/fog state, and respawn the scenario with the new
 * side as the attacker. Safe to call from the menu at any time (including
 * mid-game, where it acts as a restart on the other side).
 */
Game.setPlayerSide = (side) => {
    side = side === Game.TEAM.GERMAN ? Game.TEAM.GERMAN : Game.TEAM.FRENCH;
    try { localStorage.setItem('uf_side', side); } catch (e) { }
    if (side === Game.playerTeam) return;
    Game.playerTeam = side;

    // World not built yet (menu clicked before boot finished): the flag alone
    // is enough — spawnScenario will read it when the boot reaches it.
    if (!Game.units || !Game.units.length) return;

    // Despawn everything (corpses and wrecks included) + dependent state.
    for (const u of Game.units) {
        if (u.kind === 'fieldgun75' && u.mesh && Game.detachFieldGunCrew) {
            Game.detachFieldGunCrew(u.mesh);
        }
        if (u.mesh && Game.unitsGroup) Game.unitsGroup.remove(u.mesh);
    }
    Game.units.length = 0;
    Game.selection.clear();
    Game.selectedBuilding = null;
    Game.selectedFighter = null;
    Game.groups = {};
    Game.squads = {};
    Game._cmd = {};
    (Game.buildingRecords || []).forEach(rec => { if (rec.occupants) rec.occupants.length = 0; });
    while (Game.fighters && Game.fighters.length) Game._removeFighter(0);
    if (Game.FIGHTER_TYPES) {
        for (const k in Game.FIGHTER_TYPES) {
            const t = Game.FIGHTER_TYPES[k];
            t.count = (side === Game.TEAM.GERMAN) ? 0 : (t.baseCount != null ? t.baseCount : 2);
        }
    }
    Game.missionState.won = false;
    Game.missionState.lost = false;
    Game.missionState.timer = 0;
    Game.missionState.reinforcementTriggered = false;
    if (Game.fogGrid) Game.fogGrid.fill(0);

    Game.spawnScenario();
};

Game.spawnScenario = () => {
    const { FRENCH, GERMAN } = Game.TEAM;
    const P = Game.playerTeam || FRENCH;                 // human side (attacks)
    const E = P === FRENCH ? GERMAN : FRENCH;            // AI side (defends)
    const T = Game.TILE;

    // Where the attacker sets off from — concealed defender spawns keep walls
    // between themselves and this point. (Historical name kept; it is simply
    // the ATTACKER's staging corner whichever side the player commands.)
    Game.frenchStaging = { x: 5 * T, z: 9.5 * T };

    // ═══════════════════════════════════════════════════
    //  ATTACKER (the player) — Section/Zug: 3 squads + support + armor,
    //  staged in the west corner.
    // ═══════════════════════════════════════════════════

    // Everyone stages facing the objective town, in clean rows with vehicle
    // clearance: infantry forward, armor in one line, the AT guns in their own
    // lane (they were spawning wedged between tank hulls), trucks at the rear.
    const townDir = (x, z) => Game.angleTo(x * T, z * T,
        (30 + (Game.villageOfs?.dx || 0)) * T, (13 + (Game.villageOfs?.dy || 0)) * T);
    const spawnP = (kind, x, z, group, extra = {}) =>
        Game.makeUnit(P, kind, x * T, z * T,
            { group, aiState: 'player', angle: townDir(x, z), ...extra });

    Game.spawnSquad(P, 4 * T, 6 * T, 'A', { aiState: 'player', angle: townDir(4, 6) });
    Game.spawnSquad(P, 4.5 * T, 10 * T, 'B', { aiState: 'player', angle: townDir(4.5, 10) });
    Game.spawnSquad(P, 7 * T, 8 * T, 'C', { aiState: 'player', angle: townDir(7, 8) });

    // Support section + armor differ by doctrine.
    if (P === FRENCH) {
        // Forward screen + command
        spawnP('sniper', 6, 5, 'S');
        spawnP('panhard', 8.5, 6, 'Recon');
        spawnP('officer', 4.5, 8, 'A');
        spawnP('medic', 3, 8, 'S');

        // Armor line: one rank, two tiles between hulls.
        spawnP('h35', 2, 10.5, 'Armor', { veterancy: .12 });
        spawnP('s35', 4, 10.8, 'Armor', { veterancy: .16 });
        spawnP('r35', 6, 11.1, 'Armor', { veterancy: .10 });
        spawnP('b1', 8, 11.4, 'Armor', { veterancy: .14 });

        // Gun lane: its own row south of the armor, nothing parked in front.
        spawnP('mortar_60', 1.5, 13, 'S');
        const gun25 = spawnP('at_25mm', 3.5, 13.3, 'S');
        const gun47 = spawnP('at_47mm', 5.5, 13.6, 'S');
        spawnP('hmg', 7.5, 13.3, 'S');
        spawnP('mechanic', 8.5, 14.5, 'S');
        spawnP('sapper', 6.8, 14.8, 'S');

        // Trucks at the rear; rears face away from the town, over open ground,
        // so the boarding tailgates stay reachable at spawn.
        spawnP('supply_truck', 1.5, 15, 'S');
        spawnP('fuel_truck', 3, 15.4, 'S');
        const tow1 = spawnP('transport_truck', 4.7, 15.6, 'Transport');
        const tow2 = spawnP('transport_truck', 6.4, 15.9, 'Transport');
        // The motorized battery starts LIMBERED: each AT gun hooked to a
        // transport with its crew riding aboard. Detach to bring it into
        // action (the crew hops off and mans the gun automatically).
        if (Game.towUnit && tow1 && gun25) Game.towUnit(tow1, gun25, true);
        if (Game.towUnit && tow2 && gun47) Game.towUnit(tow2, gun47, true);
    } else {
        // Same staging discipline as the French: forward screen, one armor
        // rank, a clear gun lane, trucks at the rear — all facing the town.
        spawnP('sniper', 6, 5, 'S');
        spawnP('sdkfz', 8.5, 6, 'Recon');
        spawnP('medic', 3, 8, 'S');

        spawnP('panzer1', 2, 10.5, 'Armor', { veterancy: .10 });
        spawnP('panzer2', 4, 10.8, 'Armor', { veterancy: .12 });
        spawnP('panzer3', 6, 11.1, 'Armor', { veterancy: .14 });
        spawnP('panzer4', 8, 11.4, 'Armor', { veterancy: .14 });

        spawnP('mortar_50', 1.5, 13, 'S');
        spawnP('pak36', 3.5, 13.3, 'S');
        spawnP('mortar_81', 5.5, 13.6, 'S');
        spawnP('hmg', 7.5, 13.3, 'S');
        spawnP('mechanic', 8.5, 14.5, 'S');

        spawnP('supply_truck', 1.5, 15, 'S');
        spawnP('fuel_truck', 3, 15.4, 'S');
        // (No German officer/sapper in the roster yet — the chain of command
        // field-promotes an acting leader, so the morale aura still appears.)
    }

    // ═══════════════════════════════════════════════════
    //  DEFENDER (AI) — holding the hamlet + crossroads, concealed.
    // ═══════════════════════════════════════════════════

    const hold = (x, z) => ({ aiState: 'hold', holdPoint: { x: x * T, z: z * T } });

    // The hamlet's anchor wanders per map (generateMap picks Game.villageOfs);
    // the garrison shifts with it. The forward outpost clamps its westward
    // drift so it never crowds the attacker's staging corner.
    const vdx = (Game.villageOfs && Game.villageOfs.dx) || 0;
    const vdy = (Game.villageOfs && Game.villageOfs.dy) || 0;
    const odx = Math.max(-3, vdx);

    if (E === GERMAN) {
        // Forward outpost squad at the hedgeline
        Game.spawnSquad(GERMAN, (21 + odx) * T, (6 + vdy) * T, 'out', { ...hold(21 + odx, 6 + vdy), concealed: true });
        Game.makeUnitConcealed(GERMAN, 'mg34', (24.5 + odx) * T, (6.2 + vdy) * T, hold(24.5 + odx, 6.2 + vdy));

        // Village defense squad
        Game.spawnSquad(GERMAN, (28 + vdx) * T, (10.5 + vdy) * T, 'vil', { ...hold(28 + vdx, 10.5 + vdy), concealed: true });
        Game.makeUnitConcealed(GERMAN, 'hmg', (27 + vdx) * T, (12 + vdy) * T, hold(27 + vdx, 12 + vdy));

        // Support
        Game.makeUnitConcealed(GERMAN, 'mortar_50', (33 + vdx) * T, (14 + vdy) * T, hold(33 + vdx, 14 + vdy));
        Game.makeUnitConcealed(GERMAN, 'mortar_81', (34 + vdx) * T, (15.5 + vdy) * T, hold(34 + vdx, 15.5 + vdy));
        Game.makeUnitConcealed(GERMAN, 'pak36', (30 + vdx) * T, (13 + vdy) * T, hold(30 + vdx, 13 + vdy));
        Game.makeUnitConcealed(GERMAN, 'sniper', (35 + vdx) * T, (10 + vdy) * T, hold(35 + vdx, 10 + vdy));

        // Armor
        Game.makeUnit(GERMAN, 'sdkfz', (30.5 + vdx) * T, (8 + vdy) * T, {
            aiState: 'patrol', patrol: [
                { x: (30.5 + vdx) * T, z: (8 + vdy) * T }, { x: (34.7 + vdx) * T, z: (10.5 + vdy) * T }
            ]
        });
        Game.makeUnit(GERMAN, 'panzer1', (33 + vdx) * T, (9 + vdy) * T, hold(33 + vdx, 9 + vdy));
        Game.makeUnit(GERMAN, 'panzer2', (35.4 + vdx) * T, (12.5 + vdy) * T, { ...hold(35.4 + vdx, 12.5 + vdy), veterancy: .08 });
        Game.makeUnit(GERMAN, 'panzer3', (37 + vdx) * T, (13.5 + vdy) * T, { ...hold(37 + vdx, 13.5 + vdy), veterancy: .10 });

        // Crossroads garrison squad
        Game.spawnSquad(GERMAN, (37.5 + vdx) * T, (16 + vdy) * T, 'cross', { ...hold(37.5 + vdx, 16 + vdy), concealed: true });
        Game.makeUnitConcealed(GERMAN, 'mg34', (36.9 + vdx) * T, (17 + vdy) * T, hold(36.9 + vdx, 17 + vdy));
        Game.makeUnitConcealed(GERMAN, 'grenadier', (32.5 + vdx) * T, (21 + vdy) * T, hold(32.5 + vdx, 21 + vdy));
    } else {
        // French garrison mirroring the German defense layout.
        Game.spawnSquad(FRENCH, (21 + odx) * T, (6 + vdy) * T, 'out', { ...hold(21 + odx, 6 + vdy), concealed: true });
        Game.makeUnitConcealed(FRENCH, 'fm24', (24.5 + odx) * T, (6.2 + vdy) * T, hold(24.5 + odx, 6.2 + vdy));

        Game.spawnSquad(FRENCH, (28 + vdx) * T, (10.5 + vdy) * T, 'vil', { ...hold(28 + vdx, 10.5 + vdy), concealed: true });
        Game.makeUnitConcealed(FRENCH, 'hmg', (27 + vdx) * T, (12 + vdy) * T, hold(27 + vdx, 12 + vdy));

        Game.makeUnitConcealed(FRENCH, 'mortar_60', (33 + vdx) * T, (14 + vdy) * T, hold(33 + vdx, 14 + vdy));
        Game.makeUnitConcealed(FRENCH, 'at_25mm', (30 + vdx) * T, (13 + vdy) * T, hold(30 + vdx, 13 + vdy));
        Game.makeUnitConcealed(FRENCH, 'at_47mm', (34 + vdx) * T, (15.5 + vdy) * T, hold(34 + vdx, 15.5 + vdy));
        Game.makeUnitConcealed(FRENCH, 'sniper', (35 + vdx) * T, (10 + vdy) * T, hold(35 + vdx, 10 + vdy));

        Game.makeUnit(FRENCH, 'panhard', (30.5 + vdx) * T, (8 + vdy) * T, {
            aiState: 'patrol', patrol: [
                { x: (30.5 + vdx) * T, z: (8 + vdy) * T }, { x: (34.7 + vdx) * T, z: (10.5 + vdy) * T }
            ]
        });
        Game.makeUnit(FRENCH, 'h35', (33 + vdx) * T, (9 + vdy) * T, hold(33 + vdx, 9 + vdy));
        Game.makeUnit(FRENCH, 'r35', (35.4 + vdx) * T, (12.5 + vdy) * T, { ...hold(35.4 + vdx, 12.5 + vdy), veterancy: .08 });
        Game.makeUnit(FRENCH, 's35', (37 + vdx) * T, (13.5 + vdy) * T, { ...hold(37 + vdx, 13.5 + vdy), veterancy: .12 });

        Game.spawnSquad(FRENCH, (37.5 + vdx) * T, (16 + vdy) * T, 'cross', { ...hold(37.5 + vdx, 16 + vdy), concealed: true });
        Game.makeUnitConcealed(FRENCH, 'fm24', (36.9 + vdx) * T, (17 + vdy) * T, hold(36.9 + vdx, 17 + vdy));
        Game.makeUnitConcealed(FRENCH, 'fusilier', (32.5 + vdx) * T, (21 + vdy) * T, hold(32.5 + vdx, 21 + vdy));
    }

    // Start with nothing selected — the player picks their own opening move
    Game.selection.clear();
    Game.units.forEach(u => {
        if (u.mesh && u.mesh.userData.selectionRing) {
            u.mesh.userData.selectionRing.visible = false;
        }
    });

    Game.pushMessage(P === FRENCH
        ? 'French vanguard deployed. Seize the crossroads.'
        : 'Kampfgruppe deployed. Seize the crossroads.', 6);
};

Game.updateMission = (dt) => {
    if (Game.missionState.won || Game.missionState.lost) return;
    Game.missionState.timer += dt;

    const P = Game.playerTeam || Game.TEAM.FRENCH;
    const E = P === Game.TEAM.FRENCH ? Game.TEAM.GERMAN : Game.TEAM.FRENCH;
    const playerAlive = Game.getTeamUnits(P).length;
    const enemyAlive = Game.getTeamUnits(E).length;

    if (playerAlive === 0) {
        Game.missionState.lost = true;
        Game.pushMessage('Your force has been destroyed. Mission failed.', 20);
    }

    const nearby = Game.units.some(u => u.alive && u.team === P &&
        Game.dist(u.x, u.z, Game.missionState.objectiveX, Game.missionState.objectiveY) < 7);
    if (nearby || enemyAlive === 0) {
        Game.missionState.won = true;
        Game.pushMessage('Crossroads secured. Mission accomplished.', 20);
    }

    // Defender reinforcement wave from the east.
    if (!Game.missionState.reinforcementTriggered && Game.missionState.timer > 55) {
        Game.missionState.reinforcementTriggered = true;
        const T = Game.TILE;
        const vdx = (Game.villageOfs && Game.villageOfs.dx) || 0;
        const vdy = (Game.villageOfs && Game.villageOfs.dy) || 0;
        Game.spawnSquad(E, (46 + vdx) * T, (9 + vdy) * T, 'reserve', { aiState: 'attack' });
        if (E === Game.TEAM.GERMAN) {
            // Shared group: the squad AI splits them into base-of-fire + maneuver
            // roles, so the pair bounds between firing positions covering each
            // other instead of both charging the same axis.
            Game.makeUnit(E, 'panzer2', (47 + vdx) * T, (10 + vdy) * T, { group: 'pzreserve', aiState: 'attack', veterancy: .1 });
            Game.makeUnit(E, 'panzer4', (48 + vdx) * T, (11 + vdy) * T, { group: 'pzreserve', aiState: 'attack', veterancy: .1 });
        } else {
            Game.makeUnit(E, 's35', (47 + vdx) * T, (10 + vdy) * T, { group: 'frreserve', aiState: 'attack', veterancy: .12 });
            Game.makeUnit(E, 'b1', (48 + vdx) * T, (11 + vdy) * T, { group: 'frreserve', aiState: 'attack', veterancy: .12 });
        }
        Game.pushMessage('Enemy reserve elements arriving from the east!', 6);
    }
};

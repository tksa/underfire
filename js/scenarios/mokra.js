/**
 * Under Fire — Battle of Mokra, 1 September 1939
 *
 * First playable Poland 1939 vertical slice. The map is generated from the
 * scenario rather than the legacy French-village generator so its railway,
 * three settlement strips, open western approaches and lack of broad water
 * are authoritative gameplay features.
 */

Game.SCENARIOS = Game.SCENARIOS || {};
Game.SCENARIOS.mokra = {
    id: 'mokra',
    year: 1939,
    title: 'Mokra: Hold the Railway',
    battle: 'Battle of Mokra',
    date: '1 September 1939',
    location: 'Mokra, near Kłobuck, Poland',
    teams: { player: Game.TEAM.POLISH, enemy: Game.TEAM.GERMAN },
    playerFormation: 'Wołyńska Brygada Kawalerii (reinforced)',
    enemyFormation: '4. Panzer-Division',
    briefing: 'Dawn has brought war to the Mokra line. The German armoured division is approaching from Wilkowiecko and the western roads. Our brigade cannot stop the entire invasion, but it can ruin the enemy timetable. Hold the fields and woods before the railway, conceal the Bofors guns, and strike the leading tanks at close range.',
    primaryObjective: 'Hold the central railway crossing for five minutes.',
    secondaryObjective: 'Preserve the command team and at least one Bofors anti-tank gun.',
    mapDir: 'maps/mokra',
};

// mission.js loaded immediately before this file; retain its Dyle handlers so
// the menu can dispatch either real scenario instead of showing cosmetic cards.
const _spawnLegacyScenario = Game.spawnScenario;
const _updateLegacyMission = Game.updateMission;
const _setLegacyPlayerSide = Game.setPlayerSide;

if (Game.currentScenario === 'mokra') {
    Game.currentMap = Game.SCENARIOS.mokra.mapDir;
    Game.playerTeam = Game.TEAM.POLISH;
}

// ── Scenario terrain ────────────────────────────────────────────────────────

Game.generateMokraMap = () => {
    const COLS = Game.MAP_COLS, ROWS = Game.MAP_ROWS, T = Game.TILE;

    Game.buildings = [];
    Game.walls = [];
    Game.craters = [];
    Game.foliageKD = [];
    Game.haystacks = [];
    Game.bridges = [];
    Game.church = null;
    Game.windmill = null;
    Game.river = { tiles: [], minZ: ROWS, maxZ: 0 };
    Game.ponds = [];
    Game.pondTiles = [];
    Game.bridgeTiles = [];
    Game.railwayTiles = [];
    Game.railwayCrossings = [];
    Game._waterRibbonCache = null;
    Game._waterD = null;
    Game._terrainPaint = null;
    Game._minimapCache = null;
    Game.villageOfs = { dx: 0, dy: 0 };

    for (let y = 0; y < ROWS; y++) {
        Game.terrain[y] = [];
        for (let x = 0; x < COLS; x++) Game.terrain[y][x] = Game.makeTile('pasture');
    }

    // Broad cultivated plots: open fire lanes dominate, with fewer and softer
    // boundaries than the legacy bocage map.
    const fieldBag = ['wheat', 'stubble', 'pasture', 'plowed', 'wheat', 'pasture', 'stubble'];
    let py = 0, row = 0;
    while (py < ROWS) {
        const ph = Math.min(ROWS - py, 9 + ((row * 5) % 7));
        let px = 0, col = 0;
        while (px < COLS) {
            const pw = Math.min(COLS - px, 11 + ((col * 7 + row * 3) % 10));
            const type = fieldBag[(row * 3 + col * 5) % fieldBag.length];
            Game.setPatch(px, py, pw, ph, type);
            px += pw;
            col++;
        }
        py += ph;
        row++;
    }

    const ellipse = (cx, cy, rx, ry, type) => {
        for (let y = Math.max(0, cy - ry); y <= Math.min(ROWS - 1, cy + ry); y++) {
            for (let x = Math.max(0, cx - rx); x <= Math.min(COLS - 1, cx + rx); x++) {
                const nx = (x - cx) / rx, ny = (y - cy) / ry;
                if (nx * nx + ny * ny <= 1 + Math.sin(x * 1.7 + y * 0.9) * 0.08) {
                    Game.terrain[y][x] = Game.makeTile(type);
                }
            }
        }
    };

    // Irregular woods and orchards form the historical ambush pockets without
    // turning the battlefield into an impassable forest maze.
    ellipse(34, 15, 13, 9, 'forest');
    ellipse(24, 70, 15, 12, 'forest');
    ellipse(78, 88, 12, 8, 'forest');
    ellipse(86, 34, 9, 12, 'forest');
    ellipse(33, 15, 6, 4, 'dense_forest');
    ellipse(24, 70, 7, 6, 'dense_forest');
    Game.setPatch(48, 17, 20, 7, 'orchard');
    Game.setPatch(46, 46, 27, 8, 'orchard');
    Game.setPatch(49, 75, 23, 7, 'orchard');

    // West-to-east farm roads reach the railway at only three usable vehicle
    // crossings. The centre route is the mission's defensive focal point.
    const crossings = [23, 50, 78];
    Game.carveRoadLine(0, 20, 63, 23, 1);
    Game.carveRoadLine(0, 54, 63, 50, 2);
    Game.carveRoadLine(3, 92, 63, 78, 1);
    Game.carveRoadLine(64, 23, 99, 18, 1);
    Game.carveRoadLine(64, 50, 99, 50, 2);
    Game.carveRoadLine(64, 78, 99, 88, 1);
    Game.carveRoadLine(52, 8, 54, 92, 1); // local lane linking Mokra I–III

    // North-south railway embankment. Two ballast tiles are vehicle-blocked;
    // road tiles at the three crossings remain passable.
    const railX = 63;
    for (let y = 0; y < ROWS; y++) {
        const atCrossing = crossings.some(c => Math.abs(y - c) <= (c === 50 ? 1 : 0));
        for (let x = railX; x <= railX + 1; x++) {
            if (!atCrossing) {
                Game.terrain[y][x] = Game.makeTile('railway');
                Game.railwayTiles.push({ tx: x, ty: y });
            } else {
                Game.terrain[y][x] = Game.makeTile('road');
            }
        }
        if (atCrossing) Game.railwayCrossings.push({ tx: railX, ty: y });
    }
    Game.railway = {
        tx: railX,
        centerX: (railX + 1) * T,
        crossings: crossings.map(ty => ({ tx: railX, ty })),
    };

    // Mokra I, II and III are separated, elongated settlement/orchard strips,
    // not one compact French-style village square.
    const villageStrips = [
        { name: 'Mokra I', y: 20, houses: [[45, 19, 2, 2], [49, 21, 2, 2], [55, 18, 3, 2], [69, 20, 2, 2], [74, 22, 3, 2]] },
        { name: 'Mokra II', y: 50, houses: [[43, 47, 3, 2], [48, 51, 2, 2], [54, 48, 3, 2], [69, 47, 2, 3], [74, 51, 3, 2], [79, 48, 2, 2]] },
        { name: 'Mokra III', y: 78, houses: [[44, 76, 2, 2], [50, 79, 3, 2], [56, 75, 2, 3], [69, 79, 2, 2], [75, 76, 3, 2]] },
    ];
    villageStrips.forEach(v => v.houses.forEach(([x, y, w, h]) => Game.addBuilding(x, y, w, h, { village: v.name })));
    Game.mokraVillages = villageStrips.map(v => ({ name: v.name, y: v.y }));

    // Sparse hedges, drainage cuts and field-edge cover. Deliberate gaps keep
    // the German approach paths broad enough for armoured formations.
    for (let y = 8; y < 96; y += 17) {
        for (let x = 8; x < 58; x++) {
            if (x % 11 !== 0 && Game.terrain[y][x].type !== 'road') Game.terrain[y][x] = Game.makeTile('hedge');
        }
    }
    for (let y = 10; y < 92; y++) {
        if (y % 13 !== 0 && Game.terrain[y][82].type !== 'road') Game.terrain[y][82] = Game.makeTile('hedge');
    }
    for (let x = 12; x < 58; x++) {
        if (x % 9 !== 0 && Game.terrain[61][x].type !== 'road') Game.terrain[61][x] = Game.makeTile('mud');
    }

    Game.runtimeDamageSpots = [];
    Game.missionState.objectiveX = (railX + 1) * T;
    Game.missionState.objectiveY = 50.5 * T;
    Game.mokraZones = {
        germanEntry: { x0: 0, x1: 16 * T },
        polishDefence: { x0: 54 * T, x1: 76 * T },
        polishReserve: { x0: 76 * T, x1: Game.WORLD_W },
    };

    Game.shapeHeightmap();
};

// Replace the obsolete always-French terrain generator for this sole/default
// scenario while retaining it for editor/debug code that explicitly changes
// currentScenario later.
const _generateLegacyMap = Game.generateMap;
Game.generateMap = () => Game.currentScenario === 'mokra'
    ? Game.generateMokraMap()
    : _generateLegacyMap();

Game.buildMokraRailwayMeshes = () => {
    if (Game.currentScenario !== 'mokra' || !Game.THREE || !Game.terrainGroup || !Game.railway) return;
    const THREE = Game.THREE, T = Game.TILE;
    const rows = Game.MAP_ROWS;
    const centerX = Game.railway.centerX;
    const sleeperGeo = new THREE.BoxGeometry(T * 0.92, 0.10, 0.24);
    const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x493326, roughness: 0.96 });
    const sleepers = new THREE.InstancedMesh(sleeperGeo, sleeperMat, rows);
    sleepers.name = 'mokra-railway-sleepers';
    const railGeo = new THREE.BoxGeometry(0.11, 0.13, T * 0.94);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x56595a, roughness: 0.48, metalness: 0.58 });
    const rails = new THREE.InstancedMesh(railGeo, railMat, rows * 2);
    rails.name = 'mokra-railway-rails';
    const dummy = new THREE.Object3D();
    for (let y = 0; y < rows; y++) {
        const z = (y + 0.5) * T;
        const gy = Game.getHeight(centerX, z);
        dummy.position.set(centerX, gy + 0.13, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        sleepers.setMatrixAt(y, dummy.matrix);
        [-0.62, 0.62].forEach((dx, side) => {
            dummy.position.set(centerX + dx, gy + 0.22, z);
            dummy.updateMatrix();
            rails.setMatrixAt(y * 2 + side, dummy.matrix);
        });
    }
    sleepers.receiveShadow = true;
    rails.castShadow = rails.receiveShadow = true;
    sleepers.instanceMatrix.needsUpdate = true;
    rails.instanceMatrix.needsUpdate = true;
    Game.terrainGroup.add(sleepers, rails);
};

const _buildLegacyTerrainMeshes = Game.buildTerrainMeshes;
Game.buildTerrainMeshes = () => {
    _buildLegacyTerrainMeshes();
    Game.buildMokraRailwayMeshes();
};

// ── Scenario forces ─────────────────────────────────────────────────────────

Game.spawnPolishSquad = (x, z, group) => {
    const roster = ['ulan', 'rkm_wz28', 'ulan', 'ulan', 'rifleman', 'ulan', 'rifleman', 'ulan'];
    return roster.map((kind, i) => {
        const a = (i / roster.length) * Math.PI * 2;
        const r = i ? 1.7 + (i % 3) * 0.55 : 0;
        return Game.makeUnit(Game.TEAM.POLISH, kind,
            x + Math.cos(a) * r, z + Math.sin(a) * r,
            { group, aiState: 'player', veterancy: 0.08 + (i % 3) * 0.025 });
    }).filter(Boolean);
};

// Five-man dismounted sections occupy the intervals between adjacent guns.
// Keeping these smaller than the reserve squad makes the opening deployment
// read as one continuous defended line instead of several circular blobs.
Game.spawnPolishLineSection = (x, z, group) => {
    const roster = ['ulan', 'rkm_wz28', 'ulan', 'rifleman', 'ulan'];
    const offsets = [[0, 0], [-1.2, -1.4], [1.2, -0.7], [-1.2, 0.7], [1.2, 1.4]];
    return roster.map((kind, i) => Game.makeUnit(Game.TEAM.POLISH, kind,
        x + offsets[i][0], z + offsets[i][1],
        { group, aiState: 'player', veterancy: 0.09 + (i % 3) * 0.025 })).filter(Boolean);
};

// Authored road corridors for German armour. Coordinates are continuous tile
// coordinates through the open western approach and south of Mokra II. They are
// shared by every vehicle in an echelon; only the spawn connector
// and final fan-out differ. This avoids running the full heading-state
// vehicle A* (up to 80,000 swept-OBB states) synchronously when a wave appears.
const MOKRA_VEHICLE_LANES = Object.freeze({
    // Keep the shared corridor south of Mokra II's model footprints. Building
    // models seal their exact overhang asynchronously after scenario spawn, so
    // the apparent road at y=53 can later become a house tile. These field lanes
    // are clear both before and after that final footprint sealing.
    southernField: Object.freeze([[20.5, 57.5], [57.5, 57.5]]),
    southernNear: Object.freeze([[20.5, 56.0], [57.5, 56.0]]),
    southernWide: Object.freeze([[14.5, 58.5], [38.5, 58.5], [57.5, 58.5]]),
    directApproach: Object.freeze([]),
});

Game._buildMokraVehicleRoute = (unit, goalX, goalZ, options = {}) => {
    // The southern field lane is valid for the north, centre and south entries.
    // Two nearby authored approaches cover unusual spawn headings; there is
    // deliberately no fallback to vehicle A* on the wave-spawn frame.
    const authored = ['southernField', 'southernNear', 'southernWide'];
    const laneOffset = ((options.laneOffset || 0) % authored.length + authored.length) % authored.length;
    const laneOrder = authored.map((_, i) => authored[(i + laneOffset) % authored.length]);
    laneOrder.push('directApproach');
    const staticCtx = { tiles: new Set(), vehicles: [] };
    const eastbound = goalX >= unit.x;

    for (const laneName of laneOrder) {
        let controls = MOKRA_VEHICLE_LANES[laneName].map(([tx, ty]) => ({
            x: tx * Game.TILE,
            z: ty * Game.TILE,
        }));
        // Resume in the requested direction using only corridor controls strictly
        // between the current pose and goal. Eastbound routes stay ascending;
        // retreats/rally moves reverse the same proven corridor westbound. This
        // prevents either direction from first U-turning to an already-passed node.
        if (!eastbound) controls.reverse();
        controls = controls.filter(point => eastbound
            ? point.x > unit.x + 0.35 * Game.TILE && point.x < goalX - 0.20 * Game.TILE
            : point.x < unit.x - 0.35 * Game.TILE && point.x > goalX + 0.20 * Game.TILE);
        controls.push({ x: goalX, z: goalZ, _exactGoal: true });

        const route = [];
        let fromX = unit.x, fromZ = unit.z, heading = unit.angle || 0;
        let valid = true;
        for (const point of controls) {
            if (Game.distSq(fromX, fromZ, point.x, point.z) < 0.25) continue;
            const angle = Math.atan2(point.z - fromZ, point.x - fromX);
            if (!Game.segmentPassable(unit, fromX, fromZ, point.x, point.z, {
                startAngle: heading,
                endAngle: angle,
                obstacleCtx: staticCtx,
                margin: 0.20,
            })) {
                valid = false;
                break;
            }
            route.push({ ...point, _pathAngle: angle, _mokraLane: laneName });
            fromX = point.x;
            fromZ = point.z;
            heading = angle;
        }
        if (valid && route.length) {
            if (laneName !== laneOrder[0]) Game._mokraRouteStats.vehicleLaneFallbacks++;
            return route;
        }
    }
    Game._mokraRouteStats.vehicleRouteFailures++;
    return [];
};

// Fast recovery for scenario-authored German armour. It rotates to the next
// parallel lane and rebuilds only the still-ahead portion; it never invokes the
// general heading-state vehicle A*. unit_modules.js calls this only for tagged
// Mokra AI attackers, so player orders and every other scenario retain full A*.
Game._recoverMokraVehicleRoute = (unit, goalX, goalZ, reason = 'stuck') => {
    const stats = Game._mokraRouteStats;
    stats.vehicleRecoveries++;
    unit._mokraRecoveryCount = (unit._mokraRecoveryCount || 0) + 1;
    const route = Game._buildMokraVehicleRoute(unit, goalX, goalZ, {
        laneOffset: (unit._mokraLaneSlot || 0) + unit._mokraRecoveryCount,
    });
    if (!route.length && Game.distSq(unit.x, unit.z, goalX, goalZ) > 2.25) {
        stats.vehicleRecoveryFailures++;
    }
    unit._mokraLastRecovery = { reason, at: Game.gameClock };
    return route;
};

// Infantry/support A* is much cheaper than vehicle A*, but launching twenty of
// them in one call still creates a visible frame spike. Dispatch at most one job
// from updateMokraMission per frame. The wave itself and its historical timer are
// unchanged; troops merely receive their preassigned destination over successive
// frames (normally the whole echelon is moving within a fraction of a second).
Game._queueMokraInfantryRoute = (unit, goalX, goalZ) => {
    unit.path = [];
    unit.moving = false;
    unit._mokraRoutePending = true;
    Game._mokraRouteQueue.push({ unit, goalX, goalZ });
    Game._mokraRouteStats.infantryQueued++;
    Game._mokraRouteStats.maxQueue = Math.max(
        Game._mokraRouteStats.maxQueue, Game._mokraRouteQueue.length);
};

Game._processMokraRouteQueue = () => {
    const job = Game._mokraRouteQueue && Game._mokraRouteQueue.shift();
    if (!job) return;
    const { unit, goalX, goalZ } = job;
    unit._mokraRoutePending = false;
    if (!unit.alive) return;
    unit.path = Game.findPath
        ? Game.findPath(unit, unit.x, unit.z, goalX, goalZ)
        : [{ x: goalX, z: goalZ }];
    unit.moving = !!unit.path.length;
    Game._mokraRouteStats.infantryRouted++;
    if (!unit.path.length) Game._mokraRouteStats.infantryRouteFailures++;
};

Game._sendMokraAttackers = (units) => {
    const tx = Game.missionState.objectiveX, tz = Game.missionState.objectiveY;
    let vehicleIndex = 0;
    units.filter(Boolean).forEach((u, i) => {
        const gx = tx - 8 - (i % 3) * 3;
        const gz = tz + ((i % 5) - 2) * 5;
        u.aiState = 'attack';
        u.orderMode = 'aggressive';
        u._mokraAttackGoal = { x: gx, z: gz };
        if (Game.isTank(u.kind) || Game.isTruck(u.kind)) {
            u._mokraAuthoredAttacker = true;
            u._mokraLaneSlot = vehicleIndex++ % 3;
            u.path = Game._buildMokraVehicleRoute(u, gx, gz, {
                laneOffset: u._mokraLaneSlot,
            });
            u.moving = !!u.path.length;
            Game._mokraRouteStats.vehicleAuthored++;
        } else {
            Game._queueMokraInfantryRoute(u, gx, gz);
        }
    });
    return units;
};

Game.spawnMokraGermanSquad = (x, z, group) => {
    // One limited-issue MP38 leader, one MG34 team, and six Kar98k riflemen.
    // This avoids importing the generic 1940 Sturmtrupp into a 1939 battle.
    const roster = ['mp38', 'mg34', 'grenadier', 'grenadier', 'grenadier', 'grenadier', 'grenadier', 'grenadier'];
    return roster.map((kind, i) => {
        const a = (i / roster.length) * Math.PI * 2;
        const r = i ? 1.7 + (i % 3) * 0.55 : 0;
        return Game.makeUnit(Game.TEAM.GERMAN, kind,
            x + Math.cos(a) * r, z + Math.sin(a) * r,
            { group, aiState: 'attack', veterancy: 0.07 + (i % 3) * 0.02 });
    }).filter(Boolean);
};

Game.spawnMokraGermanWave = (wave) => {
    const G = Game.TEAM.GERMAN, T = Game.TILE;
    const made = [];
    const squad = (x, y, tag) => made.push(...Game.spawnMokraGermanSquad(x * T, y * T, tag));
    const unit = (kind, x, y, tag, extra = {}) => {
        const u = Game.makeUnit(G, kind, x * T, y * T, { group: tag, aiState: 'attack', ...extra });
        if (u) made.push(u);
    };

    if (wave === 0) {
        squad(8, 42, 'de_vanguard_n');
        squad(7, 53, 'de_vanguard_s');
        unit('mg34', 11, 46, 'de_vanguard_n');
        unit('mortar_50', 6, 48, 'de_support');
        unit('panzer1', 5, 44, 'de_armor_1');
        unit('panzer1', 6, 49, 'de_armor_1');
        unit('panzer2', 4, 53, 'de_armor_1');
        unit('panzer2', 8, 57, 'de_armor_1');
        unit('sdkfz', 10, 37, 'de_recon');
    } else if (wave === 1) {
        squad(4, 19, 'de_wave_n');
        unit('panzer1', 3, 23, 'de_armor_n');
        unit('panzer2', 5, 27, 'de_armor_n');
        unit('panzer2', 2, 31, 'de_armor_n');
        unit('pak36', 7, 30, 'de_wave_support');
    } else if (wave === 2) {
        squad(3, 70, 'de_wave_s');
        squad(6, 79, 'de_wave_s2');
        unit('panzer1', 4, 72, 'de_armor_s');
        unit('panzer2', 3, 77, 'de_armor_s');
        unit('panzer2', 7, 82, 'de_armor_s');
        unit('mortar_81', 4, 86, 'de_wave_support');
    } else if (wave === 3) {
        squad(2, 48, 'de_final');
        unit('panzer1', 3, 45, 'de_final_armor');
        unit('panzer2', 2, 53, 'de_final_armor');
        // Panzer IV appears only as a rare support vehicle. No Panzer III is
        // fielded in the Mokra scenario.
        unit('panzer4', 4, 57, 'de_final_armor', { veterancy: 0.12 });
    }

    Game._sendMokraAttackers(made);
    Game.missionState.enemyCommitted = (Game.missionState.enemyCommitted || 0) + made.length;
    return made;
};

Game.spawnMokraScenario = () => {
    const P = Game.TEAM.POLISH, T = Game.TILE;
    Game.playerTeam = P;
    Game._mokraRouteQueue = [];
    // Intentionally simple/public enough for the headless mission profiler.
    Game._mokraRouteStats = {
        vehicleAuthored: 0, vehicleLaneFallbacks: 0, vehicleRouteFailures: 0,
        vehicleRecoveries: 0, vehicleRecoveryFailures: 0,
        infantryQueued: 0, infantryRouted: 0, infantryRouteFailures: 0,
        maxQueue: 0,
    };

    const player = (kind, x, y, group, extra = {}) =>
        Game.makeUnit(P, kind, x * T, y * T, { group, aiState: 'player', ...extra });

    // A continuous north-south gun line immediately west of the railway. The
    // six positions alternate Bofors AT guns and 75 mm horse-artillery pieces;
    // five dismounted sections occupy the gaps between them. This preserves a
    // readable infantry/artillery/infantry rhythm without inflating the opening
    // infantry strength beyond the previous four full squads.
    const gunLine = [
        { kind: 'bofors37', x: 58, y: 30 },
        { kind: 'fieldgun75', x: 59, y: 38 },
        { kind: 'bofors37', x: 58, y: 46 },
        { kind: 'fieldgun75', x: 59, y: 54 },
        { kind: 'bofors37', x: 58, y: 62 },
        { kind: 'fieldgun75', x: 59, y: 70 },
    ];
    const infantryLine = [34, 42, 50, 58, 66].map((y, i) => ({
        x: i === 2 ? 61 : 60.5,
        y,
        group: `pl_line_${i + 1}`,
    }));
    Game.mokraDeployment = {
        gunLine: gunLine.map(position => ({ ...position })),
        infantryLine: infantryLine.map(position => ({ ...position })),
    };
    gunLine.forEach(position => player(position.kind, position.x, position.y,
        'pl_gun_line', { angle: Math.PI }));
    infantryLine.forEach(position => Game.spawnPolishLineSection(
        position.x * T, position.y * T, position.group));
    Game.spawnPolishSquad(70 * T, 51 * T, 'pl_reserve');

    player('at_rifle_wz35', 55, 38, 'pl_at');
    player('at_rifle_wz35', 55, 61, 'pl_at');
    player('hmg', 60, 26, 'pl_support');
    player('hmg', 60, 74, 'pl_support');
    player('mortar46', 67, 43, 'pl_support');
    player('mortar81', 72, 57, 'pl_support');
    player('tks', 76, 46, 'pl_armor');
    player('tks', 78, 53, 'pl_armor');
    player('wz34', 79, 43, 'pl_recon');
    player('officer', 68, 50, 'pl_command');
    player('medic', 70, 53, 'pl_command');
    player('sapper', 65, 56, 'pl_engineers');
    player('mechanic', 77, 55, 'pl_armor');
    player('supply_truck', 82, 55, 'pl_logistics', { angle: Math.PI });
    player('transport_truck', 82, 45, 'pl_transport', { angle: Math.PI });
    player('transport_truck', 85, 48, 'pl_transport', { angle: Math.PI });

    const ms = Game.missionState;
    Object.assign(ms, {
        won: false, lost: false, timer: 0,
        title: Game.SCENARIOS.mokra.title,
        briefing: Game.SCENARIOS.mokra.briefing,
        primaryObjective: Game.SCENARIOS.mokra.primaryObjective,
        secondaryObjective: Game.SCENARIOS.mokra.secondaryObjective,
        tacticalHint: 'Conceal the 37 mm guns, use the woods, and force the armour into crossing lanes.',
        phase: 1, phaseName: 'Forward screen', holdDuration: 300,
        contestedTime: 0, enemyLosses: 0, enemyCommitted: 0,
        nextWave: 1, reinforcementTriggered: false,
        reinforcementReport: 'Intelligence: German armour is forming west of Mokra; several waves are expected.',
    });

    Game.spawnMokraGermanWave(0);
    ms.initialPolishStrength = Game.getTeamUnits(P).length;
    ms.initialBoforsIds = Game.getTeamUnits(P).filter(u => u.kind === 'bofors37').map(u => u.id);
    ms.commandIds = Game.getTeamUnits(P).filter(u => u.supportType === 'officer').map(u => u.id);

    Game.selection.clear();
    Game.units.forEach(u => {
        if (u.mesh && u.mesh.userData.selectionRing) u.mesh.userData.selectionRing.visible = false;
    });
    Game.pushMessage('Wołyńska Cavalry Brigade deployed. Hold the Mokra railway line.', 7);
};

Game.updateMokraMission = (dt) => {
    const ms = Game.missionState;
    if (ms.won || ms.lost) return;
    Game._processMokraRouteQueue();
    ms.timer += dt;

    const polishAlive = Game.getTeamUnits(Game.TEAM.POLISH).length;
    const germanAlive = Game.getTeamUnits(Game.TEAM.GERMAN).length;
    ms.enemyLosses = Math.max(0, (ms.enemyCommitted || 0) - germanAlive);

    if (polishAlive === 0) {
        ms.lost = true;
        Game.pushMessage('The brigade has been destroyed. Mission failed.', 20);
        return;
    }

    // Three timed attack echelons keep the battle operational rather than a
    // single destroy-all skirmish.
    const waveTimes = [55, 125, 205];
    while (ms.nextWave <= 3 && ms.timer >= waveTimes[ms.nextWave - 1]) {
        Game.spawnMokraGermanWave(ms.nextWave);
        ms.reinforcementTriggered = true;
        ms.reinforcementReport = ms.nextWave === 3
            ? 'The final German armoured echelon is committed.'
            : `German attack wave ${ms.nextWave + 1} is on the field.`;
        Game.pushMessage(ms.nextWave === 3
            ? 'Final German armoured echelon approaching the central line!'
            : 'German reserves are entering from the west!', 6);
        if (ms.nextWave === 3 && Game.Audio && Game.Audio.eventVoice) {
            Game.Audio.eventVoice('f_mokra_final');
        }
        ms.nextWave++;
    }

    if (ms.timer < 55) {
        ms.phase = 1; ms.phaseName = 'Forward screen';
    } else if (ms.timer < 205) {
        ms.phase = 2; ms.phaseName = 'Armoured assault';
    } else {
        ms.phase = 3; ms.phaseName = 'Hold the railway';
    }

    const radius = 12;
    const polishAtCrossing = Game.units.some(u => u.alive && u.team === Game.TEAM.POLISH
        && Game.dist(u.x, u.z, ms.objectiveX, ms.objectiveY) < radius);
    const germanAtCrossing = Game.units.some(u => u.alive && u.team === Game.TEAM.GERMAN
        && Game.dist(u.x, u.z, ms.objectiveX, ms.objectiveY) < radius);
    if (germanAtCrossing && !polishAtCrossing) ms.contestedTime += dt;
    else ms.contestedTime = Math.max(0, ms.contestedTime - dt * 1.5);

    if (ms.contestedTime >= 25) {
        ms.lost = true;
        Game.pushMessage('German armour has broken through the central railway crossing. Mission failed.', 20);
        return;
    }

    if (ms.timer >= ms.holdDuration) {
        ms.won = true;
        ms.phase = 4;
        ms.phaseName = 'Timetable disrupted';
        const boforsSurvives = ms.initialBoforsIds.some(id => {
            const u = Game.getUnitById(id); return u && u.alive;
        });
        const commandSurvives = ms.commandIds.some(id => {
            const u = Game.getUnitById(id); return u && u.alive;
        });
        const secondary = boforsSurvives && commandSurvives ? ' Secondary objective complete.' : '';
        Game.pushMessage(`The German timetable is broken. Mokra held.${secondary}`, 20);
    }
};

// Scenario dispatch. Mokra is intentionally Polish-only for its first mission
// flow; Dyle retains its existing French/German side switcher.
Game.setPlayerSide = (side) => {
    if (Game.currentScenario === 'mokra') {
        Game.playerTeam = Game.TEAM.POLISH;
        return;
    }
    return _setLegacyPlayerSide(side);
};
Game.spawnScenario = () => Game.currentScenario === 'mokra'
    ? Game.spawnMokraScenario()
    : _spawnLegacyScenario();
Game.updateMission = (dt) => Game.currentScenario === 'mokra'
    ? Game.updateMokraMission(dt)
    : _updateLegacyMission(dt);

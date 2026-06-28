/**
 * Under Fire — terrain.js
 * Procedural 3D terrain generated from the tile map, styled after a 1940
 * French village seen from the air:
 *  - warm late-summer patchwork of hedgerow-bordered fields
 *  - tight stone hamlet (terracotta gable roofs) around a central square + church
 *  - dirt lanes radiating from the square, a windmill, a farmstead with haystacks
 *  - a winding river crossed by a stone arch bridge
 */

Game.currentMap = 'maps/map_1';

// ── Tile colors (single source of truth: 3D texture + minimap) ──
// Warm late-summer French countryside palette.
Game.TILE_COLORS = {
    grass: 0x768a4a,        // generic meadow
    pasture: 0x8a9a52,      // lush grazing green
    wheat: 0xc2a85a,        // ripe golden wheat
    stubble: 0xc9b884,      // harvested pale field
    plowed: 0x8a6948,       // bare brown furrows
    vineyard: 0x76884a,     // green row crop
    garden: 0x88965a,       // kitchen garden rows
    orchard: 0x6e8046,      // green with fruit trees
    forest: 0x46582f,
    dense_forest: 0x36462a,
    road: 0xb09468,         // pale dirt track
    mud: 0x6e5a42,
    yard: 0xbcab84,         // village dust / square
    hedge: 0x4a5e34,
    wall: 0x9a8f80,
    house: 0x8a7560,
    water: 0x4a6e74,        // river
    swamp: 0x5a5e44,
};

// Field types eligible for hedgerow borders / treelines.
Game.FIELD_TYPES = ['grass', 'pasture', 'wheat', 'stubble', 'plowed', 'vineyard', 'garden', 'orchard'];
// Compact terrain material stack: 14px/tile keeps the generated color, roughness
// and AO maps detailed enough without carrying three large 2000px canvases.
Game.TERRAIN_TEXELS_PER_TILE = 14;
Game.TERRAIN_DETAIL_DENSITY = 0.58;

Game._isBridgeTile = (tx, ty) => !!(Game.bridgeTiles || []).some(b => b.tx === tx && b.ty === ty);

Game.getRoadAxis = (tx, ty) => {
    const isRoad = (x, y) => {
        const t = Game.getTile(x, y);
        return t && t.type === 'road';
    };
    const ew = isRoad(tx - 1, ty) || isRoad(tx + 1, ty);
    const ns = isRoad(tx, ty - 1) || isRoad(tx, ty + 1);
    if (ew && !ns) return 'x';
    if (ns && !ew) return 'z';
    if (ew && ns) return ((tx + ty) % 2 === 0) ? 'x' : 'z';
    return 'x';
};

// ── Tile factory ──────────────────────────────────────
Game.makeTile = (type = 'grass') => {
    const defaults = {
        grass: { move: 1, cover: 0.05, blocked: false, concealment: 0.03 },
        pasture: { move: 1, cover: 0.04, blocked: false, concealment: 0.03 },
        wheat: { move: 1.2, cover: 0.12, blocked: false, concealment: 0.20 },
        stubble: { move: 1.05, cover: 0.06, blocked: false, concealment: 0.06 },
        plowed: { move: 1.25, cover: 0.03, blocked: false, concealment: 0.02 },
        vineyard: { move: 1.3, cover: 0.20, blocked: false, concealment: 0.28 },
        garden: { move: 1.15, cover: 0.12, blocked: false, concealment: 0.14 },
        orchard: { move: 1.15, cover: 0.18, blocked: false, concealment: 0.18 },
        road: { move: 0.75, cover: 0.0, blocked: false, concealment: 0 },
        mud: { move: 1.4, cover: 0.05, blocked: false, concealment: 0.02 },
        forest: { move: 1.5, cover: 0.32, blocked: false, concealment: 0.32 },
        dense_forest: { move: 2.5, cover: 0.55, blocked: false, concealment: 0.50, vehicleBlocked: true },
        yard: { move: 1.0, cover: 0.06, blocked: false, concealment: 0.02 },
        hedge: { move: 3.2, cover: 0.42, blocked: false, concealment: 0.22, hedge: true },
        wall: { move: 999, cover: 0.6, blocked: true, concealment: 0.2, sightBlock: true },
        house: { move: 999, cover: 0.9, blocked: true, concealment: 0.4, sightBlock: true },
        water: { move: 999, cover: 0.0, blocked: true, concealment: 0 },
        swamp: { move: 3.0, cover: 0.05, blocked: false, concealment: 0.08, slowFactor: 0.4 },
    };
    return { type, ...(defaults[type] || defaults.grass) };
};

// ── Map-building helpers ──────────────────────────────
Game.setPatch = (x0, y0, w, h, type) => {
    for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) {
            if (Game.terrain[y] && Game.terrain[y][x]) Game.terrain[y][x] = Game.makeTile(type);
        }
    }
};

Game.addBuilding = (tx, ty, tw, th, opts = {}) => {
    Game.buildings.push({ tx, ty, tw, th, ...opts });
    Game.setPatch(tx, ty, tw, th, 'house');
};

Game.addWall = (tx, ty, tw, th) => {
    Game.walls.push({ tx, ty, tw, th });
    Game.setPatch(tx, ty, tw, th, 'wall');
};

Game.carveRoadVertical = (tx, width = 2) => {
    for (let y = 0; y < Game.MAP_ROWS; y++) {
        for (let x = tx; x < tx + width; x++) {
            if (Game.terrain[y] && Game.terrain[y][x]) Game.terrain[y][x] = Game.makeTile('road');
        }
    }
};

Game.carveRoadHorizontal = (ty, width = 2) => {
    for (let x = 0; x < Game.MAP_COLS; x++) {
        for (let y = ty; y < ty + width; y++) {
            if (Game.terrain[y] && Game.terrain[y][x]) Game.terrain[y][x] = Game.makeTile('road');
        }
    }
};

/** Carve a straight dirt lane between two tiles (used for radiating village roads). */
Game.carveRoadLine = (x0, y0, x1, y1, width = 1) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const cx = Math.round(x0 + (x1 - x0) * t);
        const cy = Math.round(y0 + (y1 - y0) * t);
        for (let dy = 0; dy < width; dy++) {
            for (let dx = 0; dx < width; dx++) {
                const tx = cx + dx, ty = cy + dy;
                if (Game.terrain[ty] && Game.terrain[ty][tx]) Game.terrain[ty][tx] = Game.makeTile('road');
            }
        }
    }
};

// ── Map generation ────────────────────────────────────
Game.generateMap = () => {
    const COLS = Game.MAP_COLS, ROWS = Game.MAP_ROWS, T = Game.TILE;

    // Reset prop registries (used by buildTerrainMeshes)
    Game.buildings = [];
    Game.walls = [];
    Game.craters = [];
    Game.haystacks = [];
    Game.bridges = [];
    Game.church = null;
    Game.windmill = null;
    Game.river = { tiles: [], minZ: ROWS, maxZ: 0 };
    Game.bridgeTiles = [];

    for (let y = 0; y < ROWS; y++) {
        Game.terrain[y] = [];
        for (let x = 0; x < COLS; x++) Game.terrain[y][x] = Game.makeTile('grass');
    }

    // ── Reserved zones ──
    // Village core (the hamlet around the square / church) and the French
    // deployment staging in the NW are kept free of hedgerow mazes.
    const VX0 = 33, VX1 = 45, VY0 = 9, VY1 = 21;
    const inVillage = (tx, ty) => tx >= VX0 && tx <= VX1 && ty >= VY0 && ty <= VY1;
    const inStaging = (tx, ty) => tx < 15 && ty < 17;

    // ═══════════════════════════════════════════════════
    //  1. PATCHWORK FIELDS (the aerial "quilt")
    // ═══════════════════════════════════════════════════
    // Random grid of plots; the grid lines themselves become hedgerows so
    // adjacent fields share a single border (classic bocage look).
    const vCuts = [0];
    for (let x = Game.randi(5, 8); x < COLS - 4; x += Game.randi(7, 13)) vCuts.push(x);
    vCuts.push(COLS);
    const hCuts = [0];
    for (let y = Game.randi(5, 8); y < ROWS - 4; y += Game.randi(6, 11)) hCuts.push(y);
    hCuts.push(ROWS);

    // Weighted field-type bag
    const bag = [];
    const addBag = (type, n) => { for (let i = 0; i < n; i++) bag.push(type); };
    addBag('wheat', 26); addBag('pasture', 16); addBag('stubble', 12);
    addBag('plowed', 12); addBag('vineyard', 8); addBag('garden', 6);
    addBag('orchard', 8); addBag('forest', 6); addBag('grass', 6);
    const pickField = () => bag[Game.randi(0, bag.length - 1)];

    for (let ci = 0; ci < vCuts.length - 1; ci++) {
        for (let ri = 0; ri < hCuts.length - 1; ri++) {
            let type = pickField();
            const x0 = vCuts[ci], x1 = vCuts[ci + 1];
            const y0 = hCuts[ri], y1 = hCuts[ri + 1];
            // Larger plots favor crops, the smallest become gardens near the edges
            if ((x1 - x0) * (y1 - y0) < 35 && Math.random() < 0.5) type = 'garden';
            const dense = type === 'forest' && Math.random() < 0.35;
            for (let y = y0; y < y1; y++) {
                for (let x = x0; x < x1; x++) {
                    if (inVillage(x, y)) continue;
                    Game.terrain[y][x] = Game.makeTile(dense ? 'dense_forest' : type);
                }
            }
        }
    }

    // Collect hedgerow candidates along interior grid lines (applied later so
    // roads / village / river overwrite them cleanly).
    const hedgeCandidates = [];
    for (let k = 1; k < vCuts.length - 1; k++) {
        const cx = vCuts[k];
        let gate = -1;
        for (let y = 0; y < ROWS; y++) {
            if (y === gate || Math.random() < 0.04) { gate = y + 1; continue; } // gateways
            hedgeCandidates.push({ tx: cx, ty: y });
        }
    }
    for (let k = 1; k < hCuts.length - 1; k++) {
        const cy = hCuts[k];
        let gate = -1;
        for (let x = 0; x < COLS; x++) {
            if (x === gate || Math.random() < 0.04) { gate = x + 1; continue; }
            hedgeCandidates.push({ tx: x, ty: cy });
        }
    }

    // ═══════════════════════════════════════════════════
    //  2. RIVER (winds across the south, away from the fight)
    // ═══════════════════════════════════════════════════
    for (let x = 0; x < COLS; x++) {
        const cz = Math.round(74 + Math.sin(x * 0.11) * 5 + Math.sin(x * 0.41 + 1.3) * 1.6);
        for (let dz = -1; dz <= 1; dz++) {
            const z = cz + dz;
            if (z >= 0 && z < ROWS) {
                Game.terrain[z][x] = Game.makeTile('water');
                Game.river.tiles.push({ tx: x, ty: z });
                Game.river.minZ = Math.min(Game.river.minZ, z);
                Game.river.maxZ = Math.max(Game.river.maxZ, z);
            }
        }
    }

    // ═══════════════════════════════════════════════════
    //  3. ROADS radiating from the village square (~38,15)
    // ═══════════════════════════════════════════════════
    const SQX = 38, SQY = 15;
    Game.carveRoadHorizontal(SQY, 2);     // main E-W high street
    Game.carveRoadVertical(SQX, 2);       // main N-S road (crosses the river)
    Game.carveRoadLine(36, 13, 17, 5, 1); // lane NW toward the French approach
    Game.carveRoadLine(42, 13, 60, 8, 1); // lane NE toward the windmill
    Game.carveRoadLine(43, 17, 57, 27, 1);// lane SE toward outlying fields
    Game.carveRoadLine(35, 18, 21, 29, 1);// lane SW
    Game.carveRoadLine(43, 16, 50, 21, 1);// short spur to the farmstead

    // Bridge deck: wherever the N-S road crosses the river, keep it as road and
    // record the span so a stone arch bridge can be built over the water.
    for (const { tx, ty } of Game.river.tiles) {
        if (tx >= SQX && tx < SQX + 2) {
            Game.terrain[ty][tx] = Game.makeTile('road');
            Game.bridgeTiles.push({ tx, ty });
        }
    }
    if (Game.bridgeTiles.length) {
        // Span = the LOCAL channel width at the crossing (not the whole meander)
        let minZ = ROWS, maxZ = 0, sz = 0;
        Game.bridgeTiles.forEach(b => { minZ = Math.min(minZ, b.ty); maxZ = Math.max(maxZ, b.ty); sz += b.ty; });
        Game.bridges.push({
            cx: (SQX + 1) * T,
            cz: (sz / Game.bridgeTiles.length + 0.5) * T,
            span: (maxZ - minZ + 2) * T,
        });
    }

    // ═══════════════════════════════════════════════════
    //  4. THE HAMLET — square, church, clustered stone houses
    // ═══════════════════════════════════════════════════
    Game.setPatch(35, 13, 8, 5, 'yard');  // the open village square ("place")

    // Church on the north side of the square, spire over the rooftops
    Game.setPatch(37, 10, 3, 4, 'house');
    Game.church = { tx: 37, ty: 10, tw: 3, th: 4 };

    // Houses ringing the square + along the high street (jumbled, tight)
    const houseSpots = [
        [33, 11, 2, 2], [35, 10, 2, 2], [41, 10, 2, 3], [44, 11, 2, 2],
        [33, 14, 2, 3], [44, 14, 2, 3], [33, 18, 2, 2], [36, 18, 3, 2],
        [40, 18, 2, 2], [43, 18, 2, 2], [30, 15, 2, 2], [46, 15, 2, 2],
        [35, 19, 2, 2], [39, 11, 2, 2],
    ];
    houseSpots.forEach(([x, y, w, h]) => { if (!(x === 37 && y === 10)) Game.addBuilding(x, y, w, h); });

    // Low stone garden walls around the square
    Game.addWall(34, 12, 1, 5);
    Game.addWall(43, 12, 1, 5);
    Game.addWall(35, 12, 3, 1);
    Game.addWall(40, 17, 4, 1);

    // ═══════════════════════════════════════════════════
    //  5. FARMSTEAD with haystacks (east of the village)
    // ═══════════════════════════════════════════════════
    Game.setPatch(49, 20, 9, 7, 'yard');
    Game.addBuilding(50, 21, 3, 2);          // long barn
    Game.addBuilding(54, 21, 2, 3);          // farmhouse
    Game.addBuilding(50, 25, 2, 2);          // shed
    Game.addWall(53, 24, 4, 1);
    for (let i = 0; i < 7; i++) {
        const hx = (51 + Game.rand(0, 4)) * T;
        const hz = (24 + Game.rand(0, 2)) * T;
        Game.haystacks.push({ x: hx, z: hz, r: Game.rand(1.0, 1.5), h: Game.rand(1.6, 2.3) });
    }

    // ═══════════════════════════════════════════════════
    //  6. WINDMILL landmark (open rise NE of the village)
    // ═══════════════════════════════════════════════════
    Game.setPatch(59, 8, 3, 3, 'yard');
    Game.windmill = { x: 60.5 * T, z: 9.5 * T };

    // ═══════════════════════════════════════════════════
    //  7. APPLY HEDGEROWS + a few treelined field corners
    // ═══════════════════════════════════════════════════
    for (const { tx, ty } of hedgeCandidates) {
        if (inVillage(tx, ty) || inStaging(tx, ty)) continue;
        const t = Game.terrain[ty] && Game.terrain[ty][tx];
        if (!t || !Game.FIELD_TYPES.includes(t.type)) continue; // skip roads/water/yards/forest
        Game.terrain[ty][tx] = Game.makeTile('hedge');
    }

    // ═══════════════════════════════════════════════════
    //  8. Battlefield craters (subtle)
    // ═══════════════════════════════════════════════════
    for (let i = 0; i < 5; i++) {
        Game.craters.push({
            x: Game.rand(4, Game.WORLD_W - 4),
            z: Game.rand(2, 60),
            r: Game.rand(0.5, 1.2)
        });
    }

    // Objective = the village square (German defenders hold the hamlet)
    Game.missionState.objectiveX = (SQX + 1) * T;
    Game.missionState.objectiveY = (SQY) * T;

    // Shape the procedural heightmap to the freshly-built tile map.
    Game.shapeHeightmap();
};

// ═══════════════════════════════════════════════════════
//  PROCEDURAL HEIGHTMAP
// ═══════════════════════════════════════════════════════

/**
 * Box-blur smoothing on the heightmap data.
 */
Game._smoothHeightmap = (passes = 4) => {
    const w = Game.heightW;
    const h = Game.heightH;
    const src = Game.heightData;
    const tmp = new Float32Array(w * h);

    for (let pass = 0; pass < passes; pass++) {
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let sum = 0, count = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = Game.clamp(x + dx, 0, w - 1);
                        const ny = Game.clamp(y + dy, 0, h - 1);
                        sum += src[ny * w + nx];
                        count++;
                    }
                }
                tmp[y * w + x] = sum / count;
            }
        }
        for (let i = 0; i < w * h; i++) src[i] = tmp[i];
    }
};

/**
 * Shape the existing heightmap to the tile map: carve the river channel,
 * flatten roads / yards / buildings, and raise the bridge deck. Safe to call
 * whenever both the heightmap and terrain exist.
 */
Game.shapeHeightmap = () => {
    if (!Game.heightData || !Game.terrain.length) return;
    const w = Game.heightW, h = Game.heightH;
    const tileOf = (px, py) => {
        const tx = Math.floor(px / w * Game.MAP_COLS);
        const ty = Math.floor(py / h * Game.MAP_ROWS);
        return Game.getTile(tx, ty);
    };

    // 1. Carve the river channel down to the valley floor
    for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
            const tile = tileOf(px, py);
            if (tile && tile.type === 'water') Game.heightData[py * w + px] = 0.0;
        }
    }

    // 2. Extra-smoothed baseline copy for flattening structures into
    const flat = new Float32Array(Game.heightData);
    const saved = Game.heightData;
    Game.heightData = flat;
    Game._smoothHeightmap(12);
    Game.heightData = saved;

    // 3. Flatten gameplay surfaces toward the baseline
    for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
            const tile = tileOf(px, py);
            if (!tile) continue;
            if (tile.type === 'road' || tile.type === 'yard'
                || tile.type === 'house' || tile.type === 'wall') {
                const i = py * w + px;
                Game.heightData[i] = Game.lerp(Game.heightData[i], flat[i], 0.82);
            }
        }
    }

    // 4. Smooth the blends, then raise the bridge deck above the water
    Game._smoothHeightmap(2);
    const BRIDGE_N = 0.26;
    if (Game.bridgeTiles) {
        for (let py = 0; py < h; py++) {
            for (let px = 0; px < w; px++) {
                const tx = Math.floor(px / w * Game.MAP_COLS);
                const ty = Math.floor(py / h * Game.MAP_ROWS);
                if (Game.bridgeTiles.some(b => b.tx === tx && b.ty === ty)) {
                    Game.heightData[py * w + px] = Math.max(Game.heightData[py * w + px], BRIDGE_N);
                }
            }
        }
    }

    Game.WATER_LEVEL = 0.55;
};

/**
 * Generate rolling hills from smoothed random noise. (Terrain-aware shaping
 * happens in shapeHeightmap, called from generateMap or here on regen.)
 */
Game.loadHeightmap = () => {
    const w = 128, h = 128;
    Game.heightW = w;
    Game.heightH = h;
    Game.heightData = new Float32Array(w * h);

    // Smoothed white noise → rolling hills
    for (let i = 0; i < w * h; i++) Game.heightData[i] = Math.random();
    Game._smoothHeightmap(Game._debugSmoothPasses || 14);

    // Normalize to 0..1
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < w * h; i++) {
        if (Game.heightData[i] < min) min = Game.heightData[i];
        if (Game.heightData[i] > max) max = Game.heightData[i];
    }
    const range = Math.max(0.0001, max - min);
    for (let i = 0; i < w * h; i++) {
        Game.heightData[i] = (Game.heightData[i] - min) / range;
    }

    // On regen (terrain already exists), reshape to it now. At first boot the
    // terrain is built afterwards and generateMap calls shapeHeightmap itself.
    if (Game.terrain.length) Game.shapeHeightmap();

    console.log(`Procedural heightmap generated: ${w}x${h}`);
    return Promise.resolve();
};

/**
 * Sample height at world position (x, z). Bilinear interpolation.
 */
Game.getHeight = (x, z) => {
    if (!Game.heightData) return 0;

    const u = Game.clamp(x / Game.WORLD_W, 0, 1) * (Game.heightW - 1);
    const v = Game.clamp(z / Game.WORLD_H, 0, 1) * (Game.heightH - 1);

    const x0 = Math.floor(u), x1 = Math.min(x0 + 1, Game.heightW - 1);
    const y0 = Math.floor(v), y1 = Math.min(y0 + 1, Game.heightH - 1);
    const fx = u - x0, fy = v - y0;

    const h00 = Game.heightData[y0 * Game.heightW + x0];
    const h10 = Game.heightData[y0 * Game.heightW + x1];
    const h01 = Game.heightData[y1 * Game.heightW + x0];
    const h11 = Game.heightData[y1 * Game.heightW + x1];

    const h = (h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) +
        h01 * (1 - fx) * fy + h11 * fx * fy);

    return h * Game.HEIGHT_SCALE;
};

/**
 * Sample averaged height for vehicles over their footprint (3x3 grid),
 * smoothing out bumps that would cause micro-jitter.
 */
Game.getVehicleHeight = (x, z, size, angle) => {
    if (!Game.heightData) return 0;

    const halfW = (size || 0.9) * 0.8;
    const halfD = (size || 0.9) * 1.2;

    const cosA = Math.cos(angle || 0);
    const sinA = Math.sin(angle || 0);

    let sum = 0;
    let count = 0;
    for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
            const localX = dx * halfW;
            const localZ = dz * halfD;
            const wx = x + localX * cosA - localZ * sinA;
            const wz = z + localX * sinA + localZ * cosA;
            sum += Game.getHeight(wx, wz);
            count++;
        }
    }

    return sum / count;
};

/**
 * Terrain slope magnitude at a position (0 = flat).
 */
Game.getTerrainSlope = (x, z) => {
    if (!Game.heightData) return 0;
    const sampleDist = 1.0;
    const hN = Game.getHeight(x, z - sampleDist);
    const hS = Game.getHeight(x, z + sampleDist);
    const hE = Game.getHeight(x + sampleDist, z);
    const hW = Game.getHeight(x - sampleDist, z);

    const gradX = (hE - hW) / (2 * sampleDist);
    const gradZ = (hS - hN) / (2 * sampleDist);

    return Math.sqrt(gradX * gradX + gradZ * gradZ);
};

Game._hash2 = (x, z) => {
    const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
    return n - Math.floor(n);
};

Game._valueNoise2 = (x, z) => {
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const fx = x - x0, fz = z - z0;
    const u = fx * fx * (3 - 2 * fx);
    const v = fz * fz * (3 - 2 * fz);
    const a = Game._hash2(x0, z0);
    const b = Game._hash2(x0 + 1, z0);
    const c = Game._hash2(x0, z0 + 1);
    const d = Game._hash2(x0 + 1, z0 + 1);
    return Game.lerp(Game.lerp(a, b, u), Game.lerp(c, d, u), v);
};

Game._fbm2 = (x, z) => {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < 4; i++) {
        sum += Game._valueNoise2(x * freq, z * freq) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2.15;
    }
    return sum / norm;
};

Game.getGroundDetailHeight = (wx, wz) => {
    const tile = Game.getTileAtWorld(wx, wz);
    if (!tile) return 0;
    const { tx, ty } = Game.tileAtWorld(wx, wz);
    const lx = (wx / Game.TILE) - tx;
    const lz = (wz / Game.TILE) - ty;
    const nFine = Game._fbm2(wx * 1.1, wz * 1.1) - 0.5;
    const nCoarse = Game._fbm2(wx * 0.26 + 31.7, wz * 0.26 - 12.3) - 0.5;
    let h = nCoarse * 0.035 + nFine * 0.028;

    if (tile.type === 'road' || tile.type === 'yard') {
        // Gentle crowned dirt track, no carved rut grooves (they read as
        // broken parallel lines, especially on the diagonal lanes).
        const axis = Game.getRoadAxis(tx, ty);
        const cross = axis === 'x' ? lz : lx;
        const crown = Math.exp(-Math.pow((cross - 0.5) / 0.30, 2));
        h += 0.02 * crown + nFine * 0.03;
    } else if (tile.type === 'mud' || tile.type === 'swamp') {
        const puddle = Math.max(0, Game._fbm2(wx * 0.55, wz * 0.55) - 0.58);
        h += nFine * 0.035 - puddle * 0.16;
    } else if (tile.type === 'plowed' || tile.type === 'vineyard' || tile.type === 'garden') {
        const rowsRunX = ((tx >> 2) + (ty >> 2)) % 2 === 0;
        const rowCoord = rowsRunX ? lz : lx;
        const furrow = Math.sin(rowCoord * Math.PI * 10);
        h += furrow * (tile.type === 'plowed' ? 0.07 : 0.045) + nFine * 0.022;
    } else if (tile.type === 'wheat' || tile.type === 'stubble') {
        const rowsRunX = ((tx >> 2) + (ty >> 2)) % 2 === 0;
        h += Math.sin((rowsRunX ? lz : lx) * Math.PI * 8) * 0.025 + nFine * 0.02;
    } else if (tile.type === 'forest' || tile.type === 'dense_forest' || tile.type === 'orchard') {
        h += nFine * 0.07 + nCoarse * 0.05;
    } else if (tile.type === 'water') {
        h -= 0.05;
    }

    return Game.clamp(h, -0.14, 0.14);
};

Game._attachFoliageWind = (material, options = {}) => {
    const strength = options.strength ?? 0.045;
    const speed = options.speed ?? 1.0;
    const flutter = options.flutter ?? 0.012;

    material.onBeforeCompile = (shader) => {
        shader.uniforms.foliageTime = { value: 0 };
        shader.uniforms.foliageWindStrength = { value: strength };
        shader.uniforms.foliageWindSpeed = { value: speed };
        shader.uniforms.foliageFlutter = { value: flutter };
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
             uniform float foliageTime;
             uniform float foliageWindStrength;
             uniform float foliageWindSpeed;
             uniform float foliageFlutter;`
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
             vec3 foliageHint = vec3(0.0);
             #ifdef USE_INSTANCING
                 foliageHint = vec3(instanceMatrix[3].x, instanceMatrix[3].y, instanceMatrix[3].z);
             #endif
             float foliageBend = 1.0;
             #ifdef USE_UV
                 foliageBend = smoothstep(0.12, 1.0, uv.y);
             #endif
             float foliagePhase = foliageTime * foliageWindSpeed + dot(foliageHint.xz, vec2(0.37, 0.23));
             float foliageGust = sin(foliagePhase) * 0.72 + sin(foliagePhase * 2.17 + 1.8) * 0.28;
             transformed.x += foliageGust * foliageWindStrength * foliageBend;
             transformed.z += cos(foliagePhase * 1.43) * foliageFlutter * foliageBend;`
        );

        // VALOR: optional tree/foliage blur — soften the leaf cards (live-tunable).
        if (options.blur && Game._valorTreeBlurInject) Game._valorTreeBlurInject(shader);

        material.userData.foliageShader = shader;
    };

    Game._foliageWindMaterials = Game._foliageWindMaterials || [];
    Game._foliageWindMaterials.push(material);
    return material;
};

Game.updateFoliage = () => {
    const time = Game.gameClock || 0;
    (Game._foliageWindMaterials || []).forEach(mat => {
        const shader = mat.userData && mat.userData.foliageShader;
        if (shader && shader.uniforms.foliageTime) shader.uniforms.foliageTime.value = time;
    });
};

Game._makeGrassBladeTexture = () => {
    const THREE = Game.THREE;
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);

    const blade = ctx.createLinearGradient(0, c.height, 0, 0);
    blade.addColorStop(0, 'rgba(55,67,34,0.92)');
    blade.addColorStop(0.55, 'rgba(87,112,55,0.96)');
    blade.addColorStop(1, 'rgba(154,166,94,0.78)');

    ctx.fillStyle = blade;
    ctx.beginPath();
    ctx.moveTo(31, 126);
    ctx.bezierCurveTo(16, 82, 20, 34, 33, 4);
    ctx.bezierCurveTo(47, 38, 48, 84, 35, 126);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(214,218,150,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(32, 124);
    ctx.bezierCurveTo(29, 84, 30, 37, 33, 8);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = Math.min(4, Game.renderer.capabilities.getMaxAnisotropy());
    return tex;
};

Game.isUnderwater = (x, z) => {
    return Game.getHeight(x, z) < Game.WATER_LEVEL;
};

// ═══════════════════════════════════════════════════════
//  TERRAIN COLOR TEXTURE (painted from the tile map)
// ═══════════════════════════════════════════════════════

Game.buildTerrainTexture = () => {
    const THREE = Game.THREE;
    const px = Game.TERRAIN_TEXELS_PER_TILE || 20;
    const W = Game.MAP_COLS * px;
    const H = Game.MAP_ROWS * px;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const colOf = (type) => Game.TILE_COLORS[type] ?? Game.TILE_COLORS.grass;
    const rgb = (hex, vary = 0) => {
        let r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
        if (vary) {
            const v = 1 + Game.rand(-vary, vary);
            r = Game.clamp(Math.round(r * v), 0, 255);
            g = Game.clamp(Math.round(g * v), 0, 255);
            b = Game.clamp(Math.round(b * v), 0, 255);
        }
        return `rgb(${r},${g},${b})`;
    };
    const fillCircle = (x, y, r, style) => {
        ctx.fillStyle = style;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    };

    // Hedge/wall/house tiles paint as their surroundings (the 3D meshes sit on top)
    const paintType = (t) => {
        if (t === 'hedge') return 'pasture';
        if (t === 'wall' || t === 'house') return 'yard';
        return t;
    };

    // 1. Base tile fill. Brightness varies with SMOOTH noise (not per-tile
    //    random) so the terrain no longer shows a hard tile grid; roads and
    //    yards get no per-tile variation at all (that grid was very visible on
    //    the roads). Texture for roads comes from the gravel speckle below.
    for (let ty = 0; ty < Game.MAP_ROWS; ty++) {
        for (let tx = 0; tx < Game.MAP_COLS; tx++) {
            const type = paintType(Game.terrain[ty][tx].type);
            const hex = colOf(type);
            let r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
            if (type !== 'road' && type !== 'yard') {
                const v = 1 + (Game._fbm2(tx * 0.4, ty * 0.4) - 0.5) * 0.12;
                r = Game.clamp(Math.round(r * v), 0, 255);
                g = Game.clamp(Math.round(g * v), 0, 255);
                b = Game.clamp(Math.round(b * v), 0, 255);
            }
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(tx * px, ty * px, px, px);
        }
    }

    // 2. Edge dithering — speckle this tile's color into differing neighbors
    for (let ty = 0; ty < Game.MAP_ROWS; ty++) {
        for (let tx = 0; tx < Game.MAP_COLS; tx++) {
            const type = paintType(Game.terrain[ty][tx].type);
            if (type === 'road') continue; // keep road edges crisp-ish
            const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [dx, dy] of neighbors) {
                const n = Game.getTile(tx + dx, ty + dy);
                if (!n || paintType(n.type) === type) continue;
                // draw a few blobs across the shared edge
                for (let k = 0; k < 5; k++) {
                    const ex = (tx + 0.5 + dx * 0.5) * px + Game.rand(-2, 2) + (dy !== 0 ? Game.rand(-px / 2, px / 2) : 0);
                    const ey = (ty + 0.5 + dy * 0.5) * px + Game.rand(-2, 2) + (dx !== 0 ? Game.rand(-px / 2, px / 2) : 0);
                    ctx.fillStyle = rgb(colOf(type), 0.1);
                    const sSize = Game.rand(1.5, 3.5);
                    ctx.fillRect(ex - sSize / 2, ey - sSize / 2, sSize, sSize);
                }
            }
        }
    }

    // 3. Per-type detail — cultivated rows, furrows, canopy mottling
    for (let ty = 0; ty < Game.MAP_ROWS; ty++) {
        for (let tx = 0; tx < Game.MAP_COLS; tx++) {
            const type = Game.terrain[ty][tx].type;
            const x0 = tx * px, y0 = ty * px;
            // Plot orientation alternates so neighboring fields read differently
            const horiz = ((tx >> 2) + (ty >> 2)) % 2 === 0;
            const rows = (color, gap) => {
                ctx.fillStyle = color;
                if (horiz) for (let r = 1; r < px; r += gap) ctx.fillRect(x0, y0 + r, px, 1);
                else for (let r = 1; r < px; r += gap) ctx.fillRect(x0 + r, y0, 1, px);
            };
            if (type === 'wheat' || type === 'stubble') {
                rows('rgba(70,56,24,0.16)', 4);
            } else if (type === 'plowed') {
                rows('rgba(40,28,18,0.30)', 3);
            } else if (type === 'vineyard') {
                rows('rgba(30,44,20,0.34)', 3);
            } else if (type === 'garden') {
                rows('rgba(45,55,28,0.26)', 3);
            } else if (type === 'forest' || type === 'dense_forest') {
                for (let k = 0; k < 4; k++) {
                    ctx.fillStyle = `rgba(20,30,14,${Game.rand(0.12, 0.3)})`;
                    const s = Game.rand(3, 7);
                    ctx.fillRect(x0 + Game.rand(0, px - s), y0 + Game.rand(0, px - s), s, s);
                }
            } else if (type === 'road') {
                // Clean dirt track: scattered gravel/dust speckle, no hard ruts
                // (the old per-tile rut lines broke up across diagonal lanes).
                for (let k = 0; k < 7; k++) {
                    const gx = x0 + Game.rand(1, px - 1);
                    const gy = y0 + Game.rand(1, px - 1);
                    fillCircle(gx, gy, Game.rand(0.35, 1.3), `rgba(96,82,58,${Game.rand(0.18, 0.36)})`);
                    if (Math.random() < 0.35) fillCircle(gx + Game.rand(-1, 1), gy + Game.rand(-1, 1), Game.rand(0.2, 0.6), 'rgba(225,210,170,0.22)');
                }
            } else if (type === 'mud') {
                for (let k = 0; k < 3; k++) {
                    ctx.fillStyle = `rgba(30,24,18,${Game.rand(0.08, 0.2)})`;
                    const s = Game.rand(2, 6);
                    ctx.fillRect(x0 + Game.rand(0, px - s), y0 + Game.rand(0, px - s), s, s);
                }
                for (let k = 0; k < 2; k++) {
                    fillCircle(x0 + Game.rand(2, px - 2), y0 + Game.rand(2, px - 2), Game.rand(1.6, 4.0), `rgba(42,38,31,${Game.rand(0.16, 0.28)})`);
                }
            } else if (type === 'water') {
                ctx.fillStyle = 'rgba(255,255,255,0.05)';
                ctx.fillRect(x0, y0 + Game.rand(2, px - 2), px, 1);
            } else if (type === 'yard') {
                for (let k = 0; k < 6; k++) {
                    fillCircle(x0 + Game.rand(1, px - 1), y0 + Game.rand(1, px - 1), Game.rand(0.3, 1.1), `rgba(88,76,56,${Game.rand(0.12, 0.28)})`);
                }
            } else if (type === 'plowed') {
                for (let k = 0; k < 3; k++) {
                    fillCircle(x0 + Game.rand(1, px - 1), y0 + Game.rand(1, px - 1), Game.rand(0.4, 1.2), `rgba(34,24,17,${Game.rand(0.12, 0.22)})`);
                }
            } else if (type === 'grass' || type === 'pasture' || type === 'orchard') {
                for (let k = 0; k < 3; k++) {
                    ctx.fillStyle = `rgba(35,55,22,${Game.rand(0.05, 0.14)})`;
                    ctx.fillRect(x0 + Game.rand(0, px), y0 + Game.rand(0, px), Game.rand(1, 4), 1);
                }
            }
        }
    }

    // 4. Large-scale tonal patches so fields don't look uniform
    for (let k = 0; k < 50; k++) {
        const cx = Game.rand(0, W), cy = Game.rand(0, H);
        const r = Game.rand(80, 280);
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        const darken = Math.random() < 0.5;
        grad.addColorStop(0, darken ? 'rgba(28,30,14,0.10)' : 'rgba(235,222,170,0.10)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }

    // 5. Per-pixel grain
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * 16;
        d[i] = Game.clamp(d[i] + n, 0, 255);
        d[i + 1] = Game.clamp(d[i + 1] + n, 0, 255);
        d[i + 2] = Game.clamp(d[i + 2] + n, 0, 255);
    }
    ctx.putImageData(img, 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.anisotropy = Game.renderer.capabilities.getMaxAnisotropy();
    return tex;
};

Game.buildTerrainMaterialMaps = () => {
    const THREE = Game.THREE;
    const px = Game.TERRAIN_TEXELS_PER_TILE || 20;
    const W = Game.MAP_COLS * px;
    const H = Game.MAP_ROWS * px;
    const roughCanvas = document.createElement('canvas');
    const aoCanvas = document.createElement('canvas');
    roughCanvas.width = aoCanvas.width = W;
    roughCanvas.height = aoCanvas.height = H;
    const rctx = roughCanvas.getContext('2d');
    const actx = aoCanvas.getContext('2d');

    const gray = (v, a = 1) => `rgba(${v},${v},${v},${a})`;
    const fillCircle = (ctx, x, y, r, style) => {
        ctx.fillStyle = style;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    };
    const mat = {
        grass: [230, 226], pasture: [232, 230], wheat: [238, 232], stubble: [226, 220],
        plowed: [214, 184], vineyard: [224, 204], garden: [222, 202], orchard: [228, 210],
        forest: [236, 178], dense_forest: [242, 154], road: [206, 202], mud: [128, 164],
        yard: [212, 214], hedge: [238, 172], wall: [220, 210], house: [220, 212],
        water: [72, 255], swamp: [136, 150],
    };

    for (let ty = 0; ty < Game.MAP_ROWS; ty++) {
        for (let tx = 0; tx < Game.MAP_COLS; tx++) {
            const type = Game.terrain[ty][tx].type;
            const [rough, ao] = mat[type] || mat.grass;
            const x0 = tx * px, y0 = ty * px;
            rctx.fillStyle = gray(rough);
            rctx.fillRect(x0, y0, px, px);
            actx.fillStyle = gray(ao);
            actx.fillRect(x0, y0, px, px);

            const rowsRunX = ((tx >> 2) + (ty >> 2)) % 2 === 0;
            if (type === 'plowed' || type === 'vineyard' || type === 'garden' || type === 'wheat' || type === 'stubble') {
                const gap = type === 'plowed' ? 3 : 4;
                actx.fillStyle = 'rgba(30,30,30,0.16)';
                rctx.fillStyle = 'rgba(255,255,255,0.08)';
                for (let p = 1; p < px; p += gap) {
                    if (rowsRunX) {
                        actx.fillRect(x0, y0 + p, px, 1);
                        rctx.fillRect(x0, y0 + p + 1, px, 1);
                    } else {
                        actx.fillRect(x0 + p, y0, 1, px);
                        rctx.fillRect(x0 + p + 1, y0, 1, px);
                    }
                }
            } else if (type === 'road' || type === 'yard') {
                // Soft, direction-free wear patches instead of hard rut lines.
                for (let k = 0; k < 4; k++) {
                    const cx = x0 + Game.rand(2, px - 2);
                    const cy = y0 + Game.rand(2, px - 2);
                    const rad = Game.rand(3, 7);
                    fillCircle(actx, cx, cy, rad, 'rgba(30,30,30,0.08)');
                    fillCircle(rctx, cx, cy, rad, 'rgba(20,20,20,0.05)');
                }
            } else if (type === 'mud' || type === 'swamp') {
                for (let k = 0; k < 3; k++) {
                    const cx = x0 + Game.rand(2, px - 2);
                    const cy = y0 + Game.rand(2, px - 2);
                    const rad = Game.rand(2, 5);
                    fillCircle(rctx, cx, cy, rad, 'rgba(20,20,20,0.22)');
                    fillCircle(actx, cx, cy, rad, 'rgba(40,40,40,0.18)');
                }
            } else if (type === 'forest' || type === 'dense_forest' || type === 'orchard') {
                for (let k = 0; k < 5; k++) {
                    fillCircle(actx, x0 + Game.rand(0, px), y0 + Game.rand(0, px), Game.rand(1.5, 4), 'rgba(28,28,28,0.16)');
                }
            }
        }
    }

    // Tile-border occlusion darkens seams/hedge bases so fields sit into the map.
    actx.strokeStyle = 'rgba(24,24,24,0.08)';
    actx.lineWidth = 1;
    for (let ty = 1; ty < Game.MAP_ROWS; ty++) {
        for (let tx = 1; tx < Game.MAP_COLS; tx++) {
            const type = Game.terrain[ty][tx].type;
            if (Game.terrain[ty][tx - 1].type !== type) {
                actx.beginPath(); actx.moveTo(tx * px, ty * px); actx.lineTo(tx * px, (ty + 1) * px); actx.stroke();
            }
            if (Game.terrain[ty - 1][tx].type !== type) {
                actx.beginPath(); actx.moveTo(tx * px, ty * px); actx.lineTo((tx + 1) * px, ty * px); actx.stroke();
            }
        }
    }

    [rctx, actx].forEach(ctx => {
        const img = ctx.getImageData(0, 0, W, H);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
            const n = (Math.random() - 0.5) * 14;
            d[i] = d[i + 1] = d[i + 2] = Game.clamp(d[i] + n, 0, 255);
        }
        ctx.putImageData(img, 0, 0);
    });

    const makeTex = (canvas) => {
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        tex.anisotropy = Math.min(4, Game.renderer.capabilities.getMaxAnisotropy());
        return tex;
    };

    return {
        roughnessMap: makeTex(roughCanvas),
        aoMap: makeTex(aoCanvas),
    };
};

// ═══════════════════════════════════════════════════════
//  BUILD 3D TERRAIN MESHES
// ═══════════════════════════════════════════════════════

/** Procedural clay roof-tile texture (rows of overlapping pantiles). */
Game._makeRoofTexture = () => {
    const THREE = Game.THREE;
    const S = 128;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#8a4633';
    ctx.fillRect(0, 0, S, S);
    const rows = 8, cols = 8, rh = S / rows, cw = S / cols;
    for (let r = 0; r < rows; r++) {
        for (let col = 0; col < cols; col++) {
            const x = col * cw + (r % 2) * cw * 0.5;
            const y = r * rh;
            const shade = 120 + Math.floor(Game.rand(-18, 18));
            ctx.fillStyle = `rgb(${shade + 48},${shade - 6},${shade - 40})`;
            ctx.beginPath();
            ctx.moveTo(x + 1, y + rh);
            ctx.quadraticCurveTo(x + cw / 2, y + rh * 0.2, x + cw - 1, y + rh);
            ctx.lineTo(x + cw - 1, y + rh);
            ctx.fill();
            // shadow groove between rows
            ctx.strokeStyle = 'rgba(40,20,14,0.4)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
};

/** Triangular-prism gabled roof geometry: width (x), height (y), depth (z). */
Game._makeGableGeo = (w, h, d) => {
    const THREE = Game.THREE;
    const hw = w / 2, hd = d / 2;
    // 6 vertices: 4 eaves corners + 2 ridge ends (ridge runs along z)
    const v = [
        [-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd],
        [0, h, -hd], [0, h, hd],
    ];
    const tris = [
        // left slope
        [0, 3, 5], [0, 5, 4],
        // right slope
        [2, 1, 4], [2, 4, 5],
        // gable ends
        [1, 0, 4], [3, 2, 5],
    ];
    const pos = [];
    tris.forEach(t => t.forEach(i => pos.push(...v[i])));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
};

Game._makeGroundDecalTexture = (kind) => {
    Game._groundDecalTextures = Game._groundDecalTextures || {};
    if (Game._groundDecalTextures[kind]) return Game._groundDecalTextures[kind];

    const THREE = Game.THREE;
    const S = 96;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    const cx = S / 2, cy = S / 2;
    const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, S * 0.48);
    if (kind === 'puddle') {
        g.addColorStop(0.0, 'rgba(28,35,35,0.58)');
        g.addColorStop(0.55, 'rgba(35,38,32,0.28)');
        g.addColorStop(1.0, 'rgba(35,32,26,0.0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, S, S);
        ctx.strokeStyle = 'rgba(230,220,185,0.16)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(cx - 6, cy - 4, S * 0.22, S * 0.08, -0.25, 0, Math.PI * 2);
        ctx.stroke();
    } else {
        g.addColorStop(0.0, 'rgba(45,34,23,0.46)');
        g.addColorStop(0.65, 'rgba(58,43,28,0.20)');
        g.addColorStop(1.0, 'rgba(58,43,28,0.0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, S, S);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    Game._groundDecalTextures[kind] = tex;
    return tex;
};

Game._addTerrainSurfaceDetails = () => {
    const THREE = Game.THREE;
    const T = Game.TILE;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const groundY = (x, z) => Game.getHeight(x, z) + Game.getGroundDetailHeight(x, z);
    const density = Game.TERRAIN_DETAIL_DENSITY || 1;
    const detailChance = (p) => Math.random() < p * density;

    // Dark wheel-track strips following road tiles.
    const rutTiles = [];
    for (let ty = 0; ty < Game.MAP_ROWS; ty++) {
        for (let tx = 0; tx < Game.MAP_COLS; tx++) {
            if (Game.terrain[ty][tx].type === 'road' && !Game._isBridgeTile(tx, ty)) rutTiles.push({ tx, ty });
        }
    }
    if (rutTiles.length) {
        const rutGeo = new THREE.BoxGeometry(1, 0.012, 1);
        const rutMat = new THREE.MeshBasicMaterial({
            color: 0x3b2d1f,
            transparent: true,
            opacity: 0.26,
            depthWrite: false,
        });
        rutMat.polygonOffset = true;
        rutMat.polygonOffsetFactor = -1;
        rutMat.polygonOffsetUnits = -1;
        const rutMesh = new THREE.InstancedMesh(rutGeo, rutMat, rutTiles.length * 2);
        let n = 0;
        rutTiles.forEach(({ tx, ty }) => {
            const axis = Game.getRoadAxis(tx, ty);
            const cx = tx * T + T / 2;
            const cz = ty * T + T / 2;
            [-0.19, 0.19].forEach(off => {
                const x = cx + (axis === 'z' ? off * T : 0);
                const z = cz + (axis === 'x' ? off * T : 0);
                dummy.position.set(x, groundY(x, z) + 0.035, z);
                dummy.rotation.set(0, 0, 0);
                dummy.scale.set(axis === 'x' ? T * 0.86 : 0.13, 1, axis === 'z' ? T * 0.86 : 0.13);
                dummy.updateMatrix();
                rutMesh.setMatrixAt(n++, dummy.matrix);
            });
        });
        rutMesh.instanceMatrix.needsUpdate = true;
        rutMesh.renderOrder = 2;
        Game.terrainGroup.add(rutMesh);
    }

    // Soft mud and puddle decals in the wet/compacted areas.
    const puddles = [];
    for (let ty = 0; ty < Game.MAP_ROWS; ty++) {
        for (let tx = 0; tx < Game.MAP_COLS; tx++) {
            if (Game._isBridgeTile(tx, ty)) continue;
            const type = Game.terrain[ty][tx].type;
            const p = type === 'mud' ? 0.38 : type === 'swamp' ? 0.28 : type === 'road' ? 0.045 : type === 'yard' ? 0.035 : 0;
            if (p && detailChance(p)) {
                puddles.push({
                    x: tx * T + Game.rand(0.45, T - 0.45),
                    z: ty * T + Game.rand(0.45, T - 0.45),
                    rx: Game.rand(0.35, type === 'road' ? 0.95 : 1.45),
                    rz: Game.rand(0.22, type === 'road' ? 0.55 : 1.05),
                    rot: Game.rand(0, Math.PI * 2),
                    wet: type === 'mud' || type === 'swamp',
                });
            }
        }
    }
    if (puddles.length) {
        const puddleGeo = new THREE.CircleGeometry(1, 20);
        const puddleMat = new THREE.MeshBasicMaterial({
            color: 0x4b4335,
            map: Game._makeGroundDecalTexture('puddle'),
            transparent: true,
            opacity: 0.82,
            depthWrite: false,
        });
        const puddleMesh = new THREE.InstancedMesh(puddleGeo, puddleMat, puddles.length);
        puddles.forEach((p, i) => {
            dummy.position.set(p.x, groundY(p.x, p.z) + 0.055, p.z);
            dummy.rotation.set(-Math.PI / 2, 0, p.rot);
            dummy.scale.set(p.rx, p.rz, 1);
            dummy.updateMatrix();
            puddleMesh.setMatrixAt(i, dummy.matrix);
        });
        puddleMesh.instanceMatrix.needsUpdate = true;
        puddleMesh.renderOrder = 3;
        Game.terrainGroup.add(puddleMesh);
    }

    // Small rocks/gravel on hard surfaces and plowed ground.
    const rocks = [];
    for (let ty = 0; ty < Game.MAP_ROWS; ty++) {
        for (let tx = 0; tx < Game.MAP_COLS; tx++) {
            const type = Game.terrain[ty][tx].type;
            const p = type === 'road' ? 0.42 : type === 'yard' ? 0.34 : type === 'plowed' ? 0.22
                : type === 'stubble' ? 0.12 : type === 'mud' ? 0.10 : 0;
            if (!p || !detailChance(p)) continue;
            const count = type === 'road' || type === 'yard' ? Game.randi(1, 2) : 1;
            for (let k = 0; k < count; k++) {
                rocks.push({
                    x: tx * T + Game.rand(0.25, T - 0.25),
                    z: ty * T + Game.rand(0.25, T - 0.25),
                    s: Game.rand(0.035, type === 'road' ? 0.12 : 0.18),
                    rot: Game.rand(0, Math.PI * 2),
                });
            }
        }
    }
    if (rocks.length) {
        const rockGeo = new THREE.DodecahedronGeometry(1, 0);
        const rockMat = new THREE.MeshStandardMaterial({ color: 0x8b806d, roughness: 0.98, flatShading: true });
        const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, rocks.length);
        rocks.forEach((r, i) => {
            dummy.position.set(r.x, groundY(r.x, r.z) + r.s * 0.42, r.z);
            dummy.rotation.set(Game.rand(-0.18, 0.18), r.rot, Game.rand(-0.18, 0.18));
            dummy.scale.set(r.s * Game.rand(0.8, 1.7), r.s * Game.rand(0.35, 0.9), r.s * Game.rand(0.8, 1.5));
            dummy.updateMatrix();
            rockMesh.setMatrixAt(i, dummy.matrix);
            color.setHSL(0.09 + Game.rand(-0.015, 0.015), 0.12, 0.42 + Game.rand(-0.08, 0.08));
            rockMesh.setColorAt(i, color);
        });
        rockMesh.receiveShadow = true;
        rockMesh.instanceMatrix.needsUpdate = true;
        if (rockMesh.instanceColor) rockMesh.instanceColor.needsUpdate = true;
        Game.terrainGroup.add(rockMesh);
    }

    // Twigs/leaves around hedges, woods and orchards.
    const litter = [];
    for (let ty = 0; ty < Game.MAP_ROWS; ty++) {
        for (let tx = 0; tx < Game.MAP_COLS; tx++) {
            const type = Game.terrain[ty][tx].type;
            const p = type === 'forest' || type === 'dense_forest' ? 0.42
                : type === 'hedge' || type === 'orchard' ? 0.24
                    : type === 'pasture' || type === 'grass' ? 0.035 : 0;
            if (!p || !detailChance(p)) continue;
            litter.push({
                x: tx * T + Game.rand(0.2, T - 0.2),
                z: ty * T + Game.rand(0.2, T - 0.2),
                len: Game.rand(0.18, 0.62),
                rot: Game.rand(0, Math.PI * 2),
                leaf: Math.random() < 0.45,
            });
        }
    }
    if (litter.length) {
        const twigGeo = new THREE.BoxGeometry(1, 0.022, 0.055);
        const twigMat = new THREE.MeshStandardMaterial({ color: 0x5d3f27, roughness: 1.0 });
        const twigMesh = new THREE.InstancedMesh(twigGeo, twigMat, litter.length);
        litter.forEach((l, i) => {
            dummy.position.set(l.x, groundY(l.x, l.z) + 0.045, l.z);
            dummy.rotation.set(0, l.rot, 0);
            dummy.scale.set(l.len, l.leaf ? 0.5 : 1, l.leaf ? 0.09 : 0.045);
            dummy.updateMatrix();
            twigMesh.setMatrixAt(i, dummy.matrix);
            if (l.leaf) color.setHSL(0.16 + Game.rand(-0.04, 0.04), 0.35, 0.34 + Game.rand(-0.08, 0.08));
            else color.setHSL(0.08, 0.42, 0.25 + Game.rand(-0.04, 0.06));
            twigMesh.setColorAt(i, color);
        });
        twigMesh.receiveShadow = true;
        twigMesh.instanceMatrix.needsUpdate = true;
        if (twigMesh.instanceColor) twigMesh.instanceColor.needsUpdate = true;
        Game.terrainGroup.add(twigMesh);
    }
};

Game.buildTerrainMeshes = () => {
    const THREE = Game.THREE;
    const T = Game.TILE;

    // Clear previous
    while (Game.terrainGroup.children.length) {
        Game.terrainGroup.remove(Game.terrainGroup.children[0]);
    }

    // ── Main terrain mesh (subdivided plane displaced by heightmap) ──
    const segX = Math.min(Game.MAP_COLS * 3, 256);
    const segZ = Math.min(Game.MAP_ROWS * 3, 256);
    const terrainGeo = new THREE.PlaneGeometry(Game.WORLD_W, Game.WORLD_H, segX, segZ);
    terrainGeo.rotateX(-Math.PI / 2);

    const pos = terrainGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const wx = pos.getX(i) + Game.WORLD_W / 2;
        const wz = pos.getZ(i) + Game.WORLD_H / 2;
        // Visual-only micro relief: ruts, furrows, gravel and rooty forest floor.
        const micro = Game.getGroundDetailHeight(wx, wz);
        pos.setY(i, Game.getHeight(wx, wz) + micro);
    }
    terrainGeo.computeVertexNormals();
    terrainGeo.setAttribute('uv2', terrainGeo.attributes.uv.clone());

    // Vertex colors start white — craters darken them at runtime
    const vertCount = pos.count;
    const colors = new Float32Array(vertCount * 3);
    for (let i = 0; i < vertCount * 3; i++) colors[i] = 1.0;
    terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Painted tile texture + tiled PBR detail maps
    const terrainTex = Game.buildTerrainTexture();
    const terrainMasks = Game.buildTerrainMaterialMaps();

    const texLoader = new THREE.TextureLoader();
    // Cache-bust asset URLs. Cloudflare can negatively-cache a 404 at an edge POP
    // during the brief window between a code deploy and its assets landing; bump
    // ASSET_V whenever a bundled texture is added/changed so the edge re-fetches.
    const ASSET_V = '7';
    const _texLoad = texLoader.load.bind(texLoader);
    texLoader.load = (url, ...rest) =>
        _texLoad(url + (url.indexOf('?') >= 0 ? '&' : '?') + 'v=' + ASSET_V, ...rest);
    const terrainDetailColor = texLoader.load('textures/oga/ground_detail_color.jpg');
    terrainDetailColor.wrapS = terrainDetailColor.wrapT = THREE.RepeatWrapping;
    terrainDetailColor.colorSpace = THREE.SRGBColorSpace;
    terrainDetailColor.anisotropy = Math.min(4, Game.renderer.capabilities.getMaxAnisotropy());

    // CC0 seamless ground detail normal (OpenGameArt — DirtyGrassSeamless)
    const terrainNormal = texLoader.load('textures/oga/ground_detail_nrm.jpg');
    terrainNormal.wrapS = THREE.RepeatWrapping;
    terrainNormal.wrapT = THREE.RepeatWrapping;
    terrainNormal.repeat.set(42, 42);
    terrainNormal.minFilter = THREE.LinearMipmapLinearFilter;
    terrainNormal.anisotropy = Math.min(4, Game.renderer.capabilities.getMaxAnisotropy());

    const terrainRough = texLoader.load('textures/terrain_roughness.jpg');
    terrainRough.wrapS = THREE.RepeatWrapping;
    terrainRough.wrapT = THREE.RepeatWrapping;
    terrainRough.repeat.set(42, 42);
    terrainRough.minFilter = THREE.LinearMipmapLinearFilter;

    // CC0 ground ambient-occlusion detail, subtly multiplied into the painted color
    const terrainAO = texLoader.load('textures/oga/ground_detail_ao.jpg');
    terrainAO.wrapS = THREE.RepeatWrapping;
    terrainAO.wrapT = THREE.RepeatWrapping;
    terrainAO.repeat.set(42, 42);

    const terrainMat = new THREE.MeshStandardMaterial({
        map: terrainTex,
        normalMap: terrainNormal,
        normalScale: new THREE.Vector2(0.68, 0.68),
        roughnessMap: terrainMasks.roughnessMap,
        aoMap: terrainMasks.aoMap,
        aoMapIntensity: 0.82,
        roughness: 1.0,
        metalness: 0.0,
        flatShading: false,
        vertexColors: true,
    });

    // High-frequency detail noise — breaks up repetition at close zoom
    terrainMat.onBeforeCompile = (shader) => {
        shader.uniforms.detailColorMap = { value: terrainDetailColor };
        shader.uniforms.detailRoughnessMap = { value: terrainRough };
        shader.uniforms.detailAoMap = { value: terrainAO };
        shader.fragmentShader = `
            uniform sampler2D detailColorMap;
            uniform sampler2D detailRoughnessMap;
            uniform sampler2D detailAoMap;
        ` + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            `#include <map_fragment>
             vec2 detailUv = vMapUv * 42.0;
             vec3 detailColor = texture2D(detailColorMap, detailUv).rgb;
             float detailAo = texture2D(detailAoMap, detailUv * 1.37).r;
             vec2 dnUv = vMapUv * 240.0;
             float detail = fract(sin(dot(floor(dnUv), vec2(12.9898, 78.233))) * 43758.5453);
             diffuseColor.rgb *= mix(vec3(1.0), detailColor * 1.22, 0.16);
             diffuseColor.rgb *= mix(0.93, 1.07, detail);
             diffuseColor.rgb *= mix(0.84, 1.0, detailAo);`
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
             float detailRough = texture2D(detailRoughnessMap, vMapUv * 42.0).g;
             roughnessFactor = clamp(roughnessFactor * mix(0.78, 1.12, detailRough), 0.38, 1.0);`
        );
        // VALOR Stage 3: ground grime / wetness / snow (no edge-wear on terrain).
        if (Game._valorWeatherInject) Game._valorWeatherInject(shader, { wear: false });
    };

    Game.terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    Game.terrainMesh.position.set(Game.WORLD_W / 2, 0, Game.WORLD_H / 2);
    Game.terrainMesh.receiveShadow = true;
    Game.terrainMesh.castShadow = false;
    Game.terrainGroup.add(Game.terrainMesh);

    // Ground plane is only a raycast fallback now
    if (Game.groundPlane) {
        Game.groundPlane.visible = false;
    }

    Game._addTerrainSurfaceDetails();

    // ── Shared structure textures (wall PBR set in repo + procedural roof tiles) ──
    const wallColorBase = texLoader.load('textures/wall_color.jpg');
    const wallNormalBase = texLoader.load('textures/wall_normal.jpg');
    [wallColorBase, wallNormalBase].forEach(t => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.minFilter = THREE.LinearMipmapLinearFilter;
    });
    wallColorBase.colorSpace = THREE.SRGBColorSpace;
    const roofTexBase = Game._makeRoofTexture();
    Game._sharedTextures = Game._sharedTextures || {};
    const leavesTex = Game._sharedTextures.leaves || (() => {
        const tex = texLoader.load('textures/leaves.png');
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.repeat.set(1, 1);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = Math.min(4, Game.renderer.capabilities.getMaxAnisotropy());
        Game._sharedTextures.leaves = tex;
        return tex;
    })();
    const grassBladeTex = Game._sharedTextures.grassBlade || (() => {
        const tex = Game._makeGrassBladeTexture();
        Game._sharedTextures.grassBlade = tex;
        return tex;
    })();
    const craterTex = texLoader.load('textures/crater.png');
    craterTex.wrapS = craterTex.wrapT = THREE.ClampToEdgeWrapping;
    craterTex.colorSpace = THREE.SRGBColorSpace;

    // Clone a base texture and set its tiling (so each surface tiles correctly)
    const tiled = (base, rx, ry) => {
        const t = base.clone();
        t.needsUpdate = true;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(rx, ry);
        return t;
    };

    const foliageCardGeo = new THREE.PlaneGeometry(1, 1);
    Game._foliageWindMaterials = [];

    const foliageCardMat = Game._attachFoliageWind(new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x12200c,
        emissiveIntensity: 0.08,
        map: leavesTex,
        alphaTest: 0.34,
        side: THREE.DoubleSide,
        roughness: 0.92,
        metalness: 0.0,
    }), { strength: 0.026, speed: 0.7, flutter: 0.008, blur: true });
    foliageCardMat.name = 'shared-foliage-leaf-cards';
    const foliageDepthMat = Game._attachFoliageWind(new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        map: leavesTex,
        alphaTest: 0.34,
        side: THREE.DoubleSide,
    }), { strength: 0.026, speed: 0.7, flutter: 0.008 });

    // ── Shared CC0 bark + EZ-Tree foliage helpers (trees and hedge shrubs) ──
    // Trees/bushes use EZ-Tree (MIT) GEOMETRY only, rendered with CC0 textures
    // (Poly Haven oak bark + our leaf card) so we stay within the CC0 asset rule.
    const barkColor = texLoader.load('textures/bark_color.jpg');
    barkColor.wrapS = barkColor.wrapT = THREE.RepeatWrapping;
    barkColor.colorSpace = THREE.SRGBColorSpace;
    barkColor.anisotropy = Math.min(4, Game.renderer.capabilities.getMaxAnisotropy());
    const barkNormal = texLoader.load('textures/bark_normal.jpg');
    barkNormal.wrapS = barkNormal.wrapT = THREE.RepeatWrapping;
    const barkMat = new THREE.MeshStandardMaterial({
        map: barkColor, normalMap: barkNormal, roughness: 0.76, metalness: 0.0,
    });
    barkMat.name = 'eztree-bark';
    // VALOR: blur the trunk/branches too, so the whole tree model softens with
    // the same Tree Blur slider (leaf cards are handled via _attachFoliageWind).
    barkMat.onBeforeCompile = (shader) => { if (Game._valorTreeBlurInject) Game._valorTreeBlurInject(shader); };

    // Generate one EZ-Tree prototype: returns baked branch + leaf geometry and
    // the natural height (for scale normalisation). Pure math, no GPU/DOM work.
    const makeFoliageProto = (seed, configure) => {
        const tree = new Game.EZTree.Tree();
        tree.options.seed = seed;
        configure(tree.options);
        tree.generate();
        tree.updateMatrixWorld(true);
        const bgeo = tree.branchesMesh.geometry.clone();
        bgeo.applyMatrix4(tree.branchesMesh.matrixWorld);
        const lgeo = tree.leavesMesh.geometry.clone();
        lgeo.applyMatrix4(tree.leavesMesh.matrixWorld);
        bgeo.computeBoundingBox();
        const nh = Math.max(0.001, bgeo.boundingBox.max.y - bgeo.boundingBox.min.y);
        [tree.branchesMesh, tree.leavesMesh].forEach(m => {   // free EZ-Tree's own maps
            const mt = m.material;
            if (!mt) return;
            if (mt.map) mt.map.dispose();
            if (mt.normalMap) mt.normalMap.dispose();
            mt.dispose();
        });
        return { bgeo, lgeo, nh };
    };

    // Instance prototypes across positions ({x, z, height, scale}). World height
    // of each instance ~= height * scale * scaleK. One draw call per prototype.
    const placeFoliage = (protos, positions, scaleK, namePrefix) => {
        if (!protos.length || !positions.length) return;
        const buckets = Array.from({ length: protos.length }, () => []);
        positions.forEach((t, i) => buckets[i % protos.length].push(t));
        const dummy = new THREE.Object3D();
        const color = new THREE.Color();
        protos.forEach((proto, p) => {
            const list = buckets[p];
            if (!list.length) return;
            const branches = new THREE.InstancedMesh(proto.bgeo, barkMat, list.length);
            const leaves = new THREE.InstancedMesh(proto.lgeo, foliageCardMat, list.length);
            branches.name = namePrefix + '-branches-' + p;
            leaves.name = namePrefix + '-leaves-' + p;
            branches.castShadow = true;
            branches.receiveShadow = true;
            leaves.castShadow = true;
            leaves.receiveShadow = true;
            leaves.customDepthMaterial = foliageDepthMat;
            for (let i = 0; i < list.length; i++) {
                const t = list[i];
                const baseY = Game.getHeight(t.x, t.z);
                const s = (t.height * t.scale * scaleK) / proto.nh;
                dummy.position.set(t.x, baseY - (t.sink || 0), t.z);
                dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
                dummy.scale.set(s, s, s);
                dummy.updateMatrix();
                branches.setMatrixAt(i, dummy.matrix);
                leaves.setMatrixAt(i, dummy.matrix);
                color.setHSL(0.26 + Game.rand(-0.03, 0.07), 0.42 + Game.rand(0, 0.18), 0.33 + Game.rand(0, 0.14));
                leaves.setColorAt(i, color);
            }
            branches.instanceMatrix.needsUpdate = true;
            leaves.instanceMatrix.needsUpdate = true;
            if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
            branches.computeBoundingSphere();
            leaves.computeBoundingSphere();
            Game.terrainGroup.add(branches);
            Game.terrainGroup.add(leaves);
        });
    };

    const grassBladeGeo = new THREE.PlaneGeometry(0.22, 0.92, 1, 3);
    grassBladeGeo.translate(0, 0.46, 0);
    const grassBladeMat = Game._attachFoliageWind(new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x101608,
        emissiveIntensity: 0.045,
        map: grassBladeTex,
        alphaTest: 0.22,
        side: THREE.DoubleSide,
        roughness: 0.96,
        metalness: 0,
    }), { strength: 0.075, speed: 1.15, flutter: 0.018 });
    grassBladeMat.name = 'shared-undergrowth-blades';
    const grassDepthMat = Game._attachFoliageWind(new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
        map: grassBladeTex,
        alphaTest: 0.22,
        side: THREE.DoubleSide,
    }), { strength: 0.075, speed: 1.15, flutter: 0.018 });

    // Warm stone/plaster wall tints + terracotta roof tints (reference palette)
    const PLASTER = [0xc8bca2, 0xbcae93, 0xd0c4ac, 0xb6ab93, 0xc2b8a0];
    const STONE = [0xb8b0a0, 0xa89c86, 0xc2b8a4];
    const ROOF = [0xa8573a, 0x9c5236, 0xb5673f, 0x8f4a32, 0xab5e3c];
    const roofMatFor = () => new THREE.MeshStandardMaterial({
        color: ROOF[Game.randi(0, ROOF.length - 1)],
        roughness: 0.9,
        map: tiled(roofTexBase, 2, 2),
    });

    // ── Buildings: textured plaster/stone walls + tiled gable roofs + chimneys ──
    Game.buildings.forEach(b => {
        const w = b.tw * T;
        const d = b.th * T;
        const cx = b.tx * T + w / 2;
        const cz = b.ty * T + d / 2;
        const baseY = Game.getHeight(cx, cz);

        const height = 2.2 + Game.rand(0, 0.8);
        const wallGeo = new THREE.BoxGeometry(w - 0.4, height, d - 0.4);
        const plaster = (Math.random() < 0.5 ? PLASTER : STONE)[Game.randi(0, 2)];
        const wallMat = new THREE.MeshStandardMaterial({
            color: plaster, roughness: 0.92,
            map: tiled(wallColorBase, Math.max(1, w / 3), Math.max(1, height / 3)),
            normalMap: tiled(wallNormalBase, Math.max(1, w / 3), Math.max(1, height / 3)),
            normalScale: new THREE.Vector2(0.7, 0.7),
        });
        const wallMesh = new THREE.Mesh(wallGeo, wallMat);
        // sink slightly so sloped ground never shows a gap
        wallMesh.position.set(cx, baseY + height / 2 - 0.15, cz);
        wallMesh.castShadow = true;
        wallMesh.receiveShadow = true;
        Game.terrainGroup.add(wallMesh);

        // Roof — ridge along the building's longer axis
        const roofH = Math.min(w, d) * 0.45;
        const along = w >= d ? 'x' : 'z';
        const roofGeo = along === 'z'
            ? Game._makeGableGeo(w + 0.5, roofH, d + 0.7)
            : Game._makeGableGeo(d + 0.5, roofH, w + 0.7);
        const roofMesh = new THREE.Mesh(roofGeo, roofMatFor());
        roofMesh.position.set(cx, baseY + height - 0.18, cz);
        if (along === 'x') roofMesh.rotation.y = Math.PI / 2;
        roofMesh.castShadow = true;
        Game.terrainGroup.add(roofMesh);

        // Chimney
        const chimGeo = new THREE.BoxGeometry(0.35, 0.9, 0.35);
        const chimMat = new THREE.MeshStandardMaterial({ color: 0x8a6e60, roughness: 0.95 });
        const chim = new THREE.Mesh(chimGeo, chimMat);
        chim.position.set(cx + w * 0.25, baseY + height + roofH * 0.5, cz - d * 0.2);
        chim.castShadow = true;
        Game.terrainGroup.add(chim);
    });

    // ── Church: stone nave + bell tower + steep slate spire ──
    if (Game.church) {
        const ch = Game.church;
        const w = ch.tw * T, d = ch.th * T;
        const cx = ch.tx * T + w / 2;
        const cz = ch.ty * T + d / 2;
        const baseY = Game.getHeight(cx, cz);
        const stoneMat = new THREE.MeshStandardMaterial({
            color: 0xc4baa4, roughness: 0.94,
            map: tiled(wallColorBase, w / 3, 2),
            normalMap: tiled(wallNormalBase, w / 3, 2),
            normalScale: new THREE.Vector2(0.6, 0.6),
        });

        // Nave
        const naveH = 3.4;
        const nave = new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, naveH, d - 0.3), stoneMat);
        nave.position.set(cx, baseY + naveH / 2 - 0.15, cz);
        nave.castShadow = true; nave.receiveShadow = true;
        Game.terrainGroup.add(nave);

        // Nave roof
        const naveRoof = new THREE.Mesh(Game._makeGableGeo(w + 0.3, 1.5, d + 0.4), roofMatFor());
        naveRoof.position.set(cx, baseY + naveH - 0.15, cz);
        naveRoof.castShadow = true;
        Game.terrainGroup.add(naveRoof);

        // Bell tower at the north (front) end
        const towerH = 6.5, tw = Math.min(w, d) * 0.7;
        const tower = new THREE.Mesh(new THREE.BoxGeometry(tw, towerH, tw), stoneMat);
        const towerZ = cz - d / 2 + tw / 2;
        tower.position.set(cx, baseY + towerH / 2 - 0.15, towerZ);
        tower.castShadow = true; tower.receiveShadow = true;
        Game.terrainGroup.add(tower);

        // Steep pyramidal spire (4-sided)
        const spire = new THREE.Mesh(
            new THREE.ConeGeometry(tw * 0.78, 4.2, 4),
            new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.7, metalness: 0.1 })
        );
        spire.rotation.y = Math.PI / 4;
        spire.position.set(cx, baseY + towerH + 2.0, towerZ);
        spire.castShadow = true;
        Game.terrainGroup.add(spire);
    }

    // ── Windmill: tapered stone tower + cap + sails ──
    if (Game.windmill) {
        const wx = Game.windmill.x, wz = Game.windmill.z;
        const baseY = Game.getHeight(wx, wz);
        const towerH = 5.5;
        const tower = new THREE.Mesh(
            new THREE.CylinderGeometry(0.95, 1.7, towerH, 14),
            new THREE.MeshStandardMaterial({
                color: 0xb8ab92, roughness: 0.95,
                map: tiled(wallColorBase, 3, 3), normalMap: tiled(wallNormalBase, 3, 3),
                normalScale: new THREE.Vector2(0.6, 0.6),
            })
        );
        tower.position.set(wx, baseY + towerH / 2 - 0.15, wz);
        tower.castShadow = true; tower.receiveShadow = true;
        Game.terrainGroup.add(tower);

        const cap = new THREE.Mesh(
            new THREE.ConeGeometry(1.15, 1.6, 14),
            new THREE.MeshStandardMaterial({ color: 0x6a4a38, roughness: 0.85 })
        );
        cap.position.set(wx, baseY + towerH + 0.5, wz);
        cap.castShadow = true;
        Game.terrainGroup.add(cap);

        // Sail assembly (4 lattice blades) — angled toward the camera
        const sails = new THREE.Group();
        const bladeMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 });
        for (let s = 0; s < 4; s++) {
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.6, 0.08), bladeMat);
            blade.position.y = 1.9;
            const arm = new THREE.Group();
            arm.add(blade);
            arm.rotation.z = s * Math.PI / 2;
            sails.add(arm);
        }
        sails.position.set(wx, baseY + towerH + 0.2, wz - 1.25);
        sails.rotation.x = Math.PI / 2 * 0.12;
        sails.castShadow = true;
        Game.terrainGroup.add(sails);
        Game.windmillSails = sails; // slowly rotated in the render loop if desired
    }

    // ── Haystacks: clustered conical hay piles ──
    if (Game.haystacks && Game.haystacks.length) {
        const hayGeo = new THREE.ConeGeometry(1, 1, 9);
        const hayMat = new THREE.MeshStandardMaterial({ color: 0xcaa85e, roughness: 1.0, flatShading: true });
        const inst = new THREE.InstancedMesh(hayGeo, hayMat, Game.haystacks.length);
        const dummy = new THREE.Object3D();
        const color = new THREE.Color();
        Game.haystacks.forEach((hs, i) => {
            const baseY = Game.getHeight(hs.x, hs.z);
            dummy.position.set(hs.x, baseY + hs.h / 2, hs.z);
            dummy.scale.set(hs.r, hs.h, hs.r);
            dummy.rotation.set(0, Game.rand(0, Math.PI), 0);
            dummy.updateMatrix();
            inst.setMatrixAt(i, dummy.matrix);
            color.setHSL(0.12, 0.5, 0.46 + Game.rand(-0.05, 0.05));
            inst.setColorAt(i, color);
        });
        inst.castShadow = true;
        inst.receiveShadow = true;
        inst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        Game.terrainGroup.add(inst);
    }

    // ── Stone walls (textured) ──
    Game.walls.forEach(wall => {
        const w = wall.tw * T;
        const d = wall.th * T;
        const cx = wall.tx * T + w / 2;
        const cz = wall.ty * T + d / 2;
        const baseY = Game.getHeight(cx, cz);

        const wallH = 1.1;
        const geo = new THREE.BoxGeometry(Math.max(w * 0.9, 0.6), wallH, Math.max(d * 0.9, 0.6));
        const span = Math.max(w, d);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x9a8f82, roughness: 0.96,
            map: tiled(wallColorBase, Math.max(1, span / 2), 1),
            normalMap: tiled(wallNormalBase, Math.max(1, span / 2), 1),
            normalScale: new THREE.Vector2(0.8, 0.8),
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(cx, baseY + wallH / 2 - 0.15, cz);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        Game.terrainGroup.add(mesh);
    });

    // ── Hedges: rows of squashed bushes on hedge tiles ──
    const hedgeTiles = [];
    for (let ty = 0; ty < Game.MAP_ROWS; ty++) {
        for (let tx = 0; tx < Game.MAP_COLS; tx++) {
            if (Game.terrain[ty][tx].type === 'hedge') hedgeTiles.push({ tx, ty });
        }
    }
    if (hedgeTiles.length && Game.EZTree && Game.EZTree.Tree) {
        // Hedgerow shrubs: short, bushy EZ-Tree prototypes instanced along hedges
        // (replaces the old faceted icosahedron blobs).
        const shrubProtos = [];
        for (let p = 0; p < 2; p++) {
            shrubProtos.push(makeFoliageProto(7001 + p * 97, (o) => {
                o.type = 'deciduous';
                o.branch.levels = 2;
                o.branch.children = { 0: 5, 1: 3, 2: 2 };
                o.branch.sections = { 0: 4, 1: 3, 2: 3, 3: 2 };
                o.branch.segments = { 0: 5, 1: 4, 2: 3, 3: 3 };
                o.branch.length = { 0: 9 + p * 2, 1: 7, 2: 4, 3: 3 };
                o.branch.radius = { 0: 0.9, 1: 0.5, 2: 0.3, 3: 0.2 };
                o.branch.angle = { 1: 62, 2: 60, 3: 60 };
                o.branch.gnarliness = { 0: 0.16, 1: 0.25, 2: 0.2, 3: 0.1 };
                o.leaves.type = 'oak';
                o.leaves.billboard = 'double';
                o.leaves.count = 8;
                o.leaves.size = 4.0;
                o.leaves.sizeVariance = 0.8;
                o.leaves.start = 0.0;
            }));
        }
        const perTile = 2;
        const shrubPositions = [];
        hedgeTiles.forEach(({ tx, ty }) => {
            for (let k = 0; k < perTile; k++) {
                shrubPositions.push({
                    x: tx * T + Game.rand(0.5, T - 0.5),
                    z: ty * T + Game.rand(0.5, T - 0.5),
                    height: 1.0,
                    scale: Game.rand(0.8, 1.25),
                    sink: 0.2,
                });
            }
        });
        placeFoliage(shrubProtos, shrubPositions, 2.4, 'hedge-shrub');
    }

    // ── Forest-style instanced undergrowth: one blade mesh, many varied instances ──
    {
        const maxBlades = Math.floor(9500 * (Game.TERRAIN_DETAIL_DENSITY || 1));
        const blades = [];
        const addBlade = (x, z, type, sizeMul = 1) => {
            if (blades.length >= maxBlades) return;
            const nearRoad =
                Game.getTileAtWorld(x + T, z)?.type === 'road' ||
                Game.getTileAtWorld(x - T, z)?.type === 'road' ||
                Game.getTileAtWorld(x, z + T)?.type === 'road' ||
                Game.getTileAtWorld(x, z - T)?.type === 'road';
            const baseH = type === 'dense_forest' ? Game.rand(0.88, 1.45)
                : type === 'forest' ? Game.rand(0.68, 1.18)
                    : type === 'hedge' ? Game.rand(0.46, 0.86)
                        : type === 'orchard' ? Game.rand(0.46, 0.78)
                            : Game.rand(0.34, 0.62);
            blades.push({
                x,
                z,
                type,
                height: baseH * sizeMul * (nearRoad ? 0.72 : 1),
                width: Game.rand(0.55, 1.25) * sizeMul,
                yaw: Game.rand(0, Math.PI * 2),
                lean: Game.rand(-0.22, 0.22),
            });
        };

        for (let ty = 0; ty < Game.MAP_ROWS; ty++) {
            for (let tx = 0; tx < Game.MAP_COLS; tx++) {
                const tile = Game.terrain[ty][tx];
                const type = tile.type;
                let count = 0;
                if (type === 'dense_forest') count = Game.randi(5, 8);
                else if (type === 'forest') count = Game.randi(3, 5);
                else if (type === 'orchard') count = Game.randi(1, 3);
                else if ((type === 'grass' || type === 'pasture') && Math.random() < 0.13) count = 1;
                else if (type === 'stubble' && Math.random() < 0.08) count = 1;

                for (let i = 0; i < count; i++) {
                    addBlade(
                        tx * T + Game.rand(0.18, T - 0.18),
                        ty * T + Game.rand(0.18, T - 0.18),
                        type,
                        type === 'dense_forest' || type === 'forest' ? 1.1 : 0.82
                    );
                }
            }
        }

        hedgeTiles.forEach(({ tx, ty }) => {
            const horizontal = Game.getTile(tx - 1, ty)?.type === 'hedge' || Game.getTile(tx + 1, ty)?.type === 'hedge';
            for (let i = 0; i < 4; i++) {
                addBlade(
                    tx * T + (horizontal ? Game.rand(0.1, T - 0.1) : Game.rand(T * 0.32, T * 0.68)),
                    ty * T + (horizontal ? Game.rand(T * 0.32, T * 0.68) : Game.rand(0.1, T - 0.1)),
                    'hedge',
                    0.95
                );
            }
        });

        if (blades.length) {
            const inst = new THREE.InstancedMesh(grassBladeGeo, grassBladeMat, blades.length);
            inst.name = 'forest-undergrowth-blades';
            inst.castShadow = true;
            inst.receiveShadow = true;
            inst.customDepthMaterial = grassDepthMat;
            const dummy = new THREE.Object3D();
            const color = new THREE.Color();

            blades.forEach((b, i) => {
                dummy.position.set(b.x, Game.getHeight(b.x, b.z) + 0.03, b.z);
                dummy.rotation.set(b.lean * 0.35, b.yaw, b.lean);
                dummy.scale.set(b.width, b.height, 1);
                dummy.updateMatrix();
                inst.setMatrixAt(i, dummy.matrix);

                if (b.type === 'dense_forest') color.setHSL(0.29 + Game.rand(-0.025, 0.035), 0.38 + Game.rand(0, 0.13), 0.24 + Game.rand(0, 0.1));
                else if (b.type === 'forest') color.setHSL(0.285 + Game.rand(-0.03, 0.04), 0.40 + Game.rand(0, 0.15), 0.27 + Game.rand(0, 0.12));
                else if (b.type === 'hedge') color.setHSL(0.28 + Game.rand(-0.035, 0.045), 0.44 + Game.rand(0, 0.17), 0.29 + Game.rand(0, 0.13));
                else if (b.type === 'stubble') color.setHSL(0.15 + Game.rand(-0.02, 0.03), 0.32 + Game.rand(0, 0.12), 0.31 + Game.rand(0, 0.11));
                else color.setHSL(0.23 + Game.rand(-0.04, 0.04), 0.34 + Game.rand(0, 0.14), 0.29 + Game.rand(0, 0.13));
                inst.setColorAt(i, color);
            });

            inst.instanceMatrix.needsUpdate = true;
            if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
            inst.computeBoundingSphere();
            Game.terrainGroup.add(inst);
        }
    }

    // ── Instanced trees: forests, orchards, hedgerow treelines, clusters ──
    {
        const treePositions = [];

        for (let ty = 0; ty < Game.MAP_ROWS; ty++) {
            for (let tx = 0; tx < Game.MAP_COLS; tx++) {
                const tile = Game.terrain[ty][tx];
                if (tile.type === 'forest' || tile.type === 'dense_forest') {
                    // Forest density: clusters read too thick, so dense cores are
                    // 1-2 and ordinary forest 0-2 (plus a global 30% thin below).
                    const count = tile.type === 'dense_forest' ? Game.randi(1, 2) : Game.randi(0, 2);
                    for (let i = 0; i < count; i++) {
                        treePositions.push({
                            x: tx * T + Game.rand(0.3, T - 0.3),
                            z: ty * T + Game.rand(0.3, T - 0.3),
                            height: Game.rand(2.6, 4.2),
                            scale: Game.rand(0.85, 1.4)
                        });
                    }
                } else if (tile.type === 'orchard') {
                    // orderly orchard rows: one tree per tile, near center
                    if ((tx + ty) % 2 === 0) {
                        treePositions.push({
                            x: tx * T + T / 2 + Game.rand(-0.4, 0.4),
                            z: ty * T + T / 2 + Game.rand(-0.4, 0.4),
                            height: Game.rand(1.8, 2.6),
                            scale: Game.rand(0.7, 1.0)
                        });
                    }
                }
            }
        }

        // Treelines: a tree on ~12% of hedgerow tiles (dotted field borders)
        hedgeTiles.forEach(({ tx, ty }) => {
            if (Math.random() < 0.12) {
                treePositions.push({
                    x: tx * T + Game.rand(0.3, T - 0.3),
                    z: ty * T + Game.rand(0.3, T - 0.3),
                    height: Game.rand(2.4, 3.8),
                    scale: Game.rand(0.8, 1.2)
                });
            }
        });

        // noise-clustered lone trees across open ground
        const treeNoise = (x, z) => {
            const n1 = Math.sin(x * 0.3 + z * 0.7) * Math.cos(z * 0.4 - x * 0.2);
            const n2 = Math.sin(x * 0.13 + 5.7) * Math.cos(z * 0.17 + 3.1);
            return (n1 + n2) * 0.5 + 0.5;
        };
        for (let i = 0; i < 180; i++) {
            const x = Game.rand(2, Game.WORLD_W - 2);
            const z = Game.rand(2, Game.WORLD_H - 2);
            if (treeNoise(x, z) < 0.62) continue;
            const tile = Game.getTileAtWorld(x, z);
            if (!tile || ['house', 'wall', 'road', 'yard', 'wheat', 'water', 'plowed'].includes(tile.type)) continue;
            treePositions.push({
                x, z,
                height: Game.rand(2.0, 3.6),
                scale: Game.rand(0.7, 1.2)
            });
        }

        // Global thinning: render ~30% fewer trees overall (forests, treelines,
        // orchards and lone trees alike) — the map read too wooded.
        for (let i = treePositions.length - 1; i >= 0; i--) {
            if (Math.random() < 0.30) treePositions.splice(i, 1);
        }

        const treeCount = treePositions.length;
        if (treeCount > 0 && Game.EZTree && Game.EZTree.Tree) {
            // A few prototype trees, generated once, then instanced across every
            // tree position. Geometry is EZ-Tree (MIT); rendered with CC0 textures
            // via the shared helpers above (oak bark + leaf cards).
            const treeProtos = [];
            for (let p = 0; p < 4; p++) {
                treeProtos.push(makeFoliageProto(1009 + p * 131, (o) => {
                    o.type = 'deciduous';
                    // 2 levels + a modest, large-leaf canopy keeps the triangle
                    // budget sane (leaves.count is PER branch, so it multiplies fast).
                    o.branch.levels = 2;
                    o.branch.children = { 0: 5 + (p % 2), 1: 4, 2: 2 };
                    o.branch.sections = { 0: 5, 1: 4, 2: 3, 3: 2 };
                    o.branch.segments = { 0: 6, 1: 4, 2: 3, 3: 3 };
                    o.branch.length = { 0: 32 + p * 4, 1: 20, 2: 9, 3: 4 };
                    o.branch.radius = { 0: 1.7, 1: 0.7, 2: 0.5, 3: 0.4 };
                    o.branch.gnarliness = { 0: 0.06 + p * 0.02, 1: 0.2, 2: 0.2, 3: 0.1 };
                    o.leaves.type = 'oak';
                    o.leaves.billboard = 'double';
                    o.leaves.count = 7;
                    o.leaves.size = 5.4;
                    o.leaves.sizeVariance = 0.85;
                    o.leaves.start = 0.1;
                }));
            }
            placeFoliage(treeProtos, treePositions, 1.7, 'tree');
        }
    }

    // ── River water surface (one quad per water tile — exact, no bleed) ──
    if (Game.river && Game.river.tiles.length) {
        const wgeo = new THREE.BufferGeometry();
        const verts = [];
        const y = Game.WATER_LEVEL;
        Game.river.tiles.forEach(({ tx, ty }) => {
            const x0 = tx * T, z0 = ty * T, x1 = x0 + T, z1 = z0 + T;
            verts.push(x0, y, z0, x1, y, z0, x1, y, z1);
            verts.push(x0, y, z0, x1, y, z1, x0, y, z1);
        });
        wgeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        wgeo.computeVertexNormals();
        const ripple = texLoader.load('textures/oga/ground_detail_nrm.jpg');
        ripple.wrapS = ripple.wrapT = THREE.RepeatWrapping;
        ripple.repeat.set(40, 40);
        const waterMat = new THREE.MeshStandardMaterial({
            color: 0x5d8a90, roughness: 0.16, metalness: 0.2,
            transparent: true, opacity: 0.82,
            normalMap: ripple, normalScale: new THREE.Vector2(0.2, 0.2),
        });
        Game.waterMesh = new THREE.Mesh(wgeo, waterMat);
        Game.waterMesh.receiveShadow = true;
        Game.waterMesh.renderOrder = 1;
        Game.terrainGroup.add(Game.waterMesh);
    }

    // ── Stone arch bridge over the river (on the N-S road) ──
    if (Game.bridges && Game.bridges.length) {
        const stoneMat = new THREE.MeshStandardMaterial({
            color: 0xb0a690, roughness: 0.95,
            map: tiled(wallColorBase, 3, 1), normalMap: tiled(wallNormalBase, 3, 1),
        });
        Game.bridges.forEach(br => {
            const deckW = 2 * T;                                  // road width (X)
            const span = br.span;                                 // channel width (Z)
            const deckY = Math.max(Game.getHeight(br.cx, br.cz), Game.WATER_LEVEL + 0.7);
            // Deck — a low stone causeway just above the water
            const deck = new THREE.Mesh(new THREE.BoxGeometry(deckW, 0.45, span + 1.0), stoneMat);
            deck.position.set(br.cx, deckY, br.cz);
            deck.castShadow = true; deck.receiveShadow = true;
            Game.terrainGroup.add(deck);
            // Parapets along both road edges
            [-1, 1].forEach(s => {
                const rail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.55, span + 1.0), stoneMat);
                rail.position.set(br.cx + s * (deckW / 2 - 0.18), deckY + 0.45, br.cz);
                rail.castShadow = true;
                Game.terrainGroup.add(rail);
            });
            // A small central arch springer + two abutment piers down to the water
            const archR = Math.min(span * 0.28, 1.3);
            const arch = new THREE.Mesh(
                new THREE.CylinderGeometry(archR, archR, deckW + 0.1, 14, 1, true, 0, Math.PI),
                stoneMat
            );
            arch.rotation.z = Math.PI / 2;
            arch.position.set(br.cx, Game.WATER_LEVEL + 0.05, br.cz);
            Game.terrainGroup.add(arch);
            [-1, 1].forEach(s => {
                const h = Math.max(0.4, deckY - Game.WATER_LEVEL);
                const pier = new THREE.Mesh(new THREE.BoxGeometry(deckW, h, 0.7), stoneMat);
                pier.position.set(br.cx, Game.WATER_LEVEL + h / 2, br.cz + s * (span / 2 - 0.1));
                pier.castShadow = true;
                Game.terrainGroup.add(pier);
            });
        });
    }

    // ── Static crater decals ──
    Game.craters.forEach(c => {
        const baseY = Game.getHeight(c.x, c.z);
        const geo = new THREE.CircleGeometry(c.r, 16);
        const mat = new THREE.MeshBasicMaterial({
            color: 0x5a4935,
            map: craterTex,
            transparent: true,
            opacity: 0.42,
            depthWrite: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.rotation.z = Game.rand(0, Math.PI * 2);
        mesh.position.set(c.x, baseY + 0.04, c.z);
        mesh.renderOrder = 3;
        Game.terrainGroup.add(mesh);
    });

    // ── Objective marker ──
    const ringGeo = new THREE.RingGeometry(1.5, 2.0, 32);
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0xdbb866,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.5
    });
    Game.objectiveRing = new THREE.Mesh(ringGeo, ringMat);
    Game.objectiveRing.rotation.x = -Math.PI / 2;
    const objY = Game.getHeight(Game.missionState.objectiveX, Game.missionState.objectiveY);
    Game.objectiveRing.position.set(Game.missionState.objectiveX, objY + 0.1, Game.missionState.objectiveY);
    Game.terrainGroup.add(Game.objectiveRing);
};

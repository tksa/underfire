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
    wash: 0x9b937d,         // river shingle / gravel wash (paint-only, not a tile type)
};

// Field types eligible for hedgerow borders / treelines.
Game.FIELD_TYPES = ['grass', 'pasture', 'wheat', 'stubble', 'plowed', 'vineyard', 'garden', 'orchard'];
// Compact terrain material stack: 14px/tile keeps the generated color, roughness
// and AO maps detailed enough without carrying three large 2000px canvases.
Game.TERRAIN_TEXELS_PER_TILE = 14;
Game.TERRAIN_DETAIL_DENSITY = 0.58;

// Debug: show/hide the 3D grass blades (undergrowth) live. OFF by default (the
// field tufts read poorly from the RTS camera); toggle on in the Terrain panel.
Game.SHOW_GRASS = false;
// Road gravel tiling: repeat every N tiles, and blend opacity. Live-tunable.
Game.ROAD_GRAVEL_TILES = 2.5;
Game.ROAD_GRAVEL_ALPHA = 0.92;
// Organic field joins: how far (in tiles) the painted boundary between two
// terrain types wanders off the tile grid, plus fine edge raggedness and the
// per-field tint spread that separates adjacent same-type plots.
Game.TERRAIN_EDGE_WARP = 0.45;
Game.TERRAIN_EDGE_WARP_FINE = 0.12;
Game.TERRAIN_FIELD_TINT = 0.07;
// Most real field boundaries are surveyed straight; only some wander. This is
// the share of the map where joins go rough/organic — everywhere else they
// stay nearly straight (and only straight zones get walls/fences).
Game.TERRAIN_EDGE_ROUGH_SHARE = 0.35;
Game.setGrassVisible = (v) => {
    Game.SHOW_GRASS = !!v;
    (Game._grassMeshes || []).forEach(m => { m.visible = !!v; });
};
// Terrain debug controls (merged into the shared panel via engine.js).
Game._terrainControlDefs = () => [
    { group: 'Terrain', key: 'showGrass', label: 'Grass blades (0/1)', min: 0, max: 1, step: 1, default: 0, apply: v => Game.setGrassVisible(v >= 1) },
    { group: 'Terrain', key: 'roadGravelTiles', label: 'Road gravel scale (tiles/repeat)', min: 0.5, max: 8, step: 0.25, default: 2.5, apply: v => { Game.ROAD_GRAVEL_TILES = v; if (Game.rebuildTerrainTexture) Game.rebuildTerrainTexture(); } },
    { group: 'Terrain', key: 'roadGravelAlpha', label: 'Road gravel opacity', min: 0, max: 1, step: 0.05, default: 0.92, apply: v => { Game.ROAD_GRAVEL_ALPHA = v; if (Game.rebuildTerrainTexture) Game.rebuildTerrainTexture(); } },
    { group: 'Terrain', key: 'fringeDens', label: 'Road grass fringe', min: 0, max: 4, step: 0.1, default: 1.6, apply: v => { Game.TERRAIN_FRINGE = v; if (Game.rebuildTerrainTexture) Game.rebuildTerrainTexture(); } },
    { group: 'Terrain', key: 'seamDepth', label: 'Seam depth', min: 0, max: 0.6, step: 0.02, default: 0.22, apply: v => { Game.TERRAIN_SEAM_DEPTH = v; if (Game.rebuildTerrainTexture) Game.rebuildTerrainTexture(); } },
    { group: 'Terrain', key: 'edgeWarp', label: 'Field edge wander (tiles)', min: 0, max: 1, step: 0.05, default: 0.45, apply: v => { Game.TERRAIN_EDGE_WARP = v; if (Game.rebuildTerrainTexture) Game.rebuildTerrainTexture(); } },
    { group: 'Terrain', key: 'roughShare', label: 'Rough edge share (0-1)', min: 0, max: 1, step: 0.05, default: 0.35, apply: v => { Game.TERRAIN_EDGE_ROUGH_SHARE = v; if (Game.rebuildTerrainTexture) Game.rebuildTerrainTexture(); } },
    { group: 'Terrain', key: 'fieldTint', label: 'Per-field tint spread', min: 0, max: 0.2, step: 0.01, default: 0.07, apply: v => { Game.TERRAIN_FIELD_TINT = v; if (Game.rebuildTerrainTexture) Game.rebuildTerrainTexture(); } },
];

Game._isBridgeTile = (tx, ty) => !!(Game.bridgeTiles || []).some(b => b.tx === tx && b.ty === ty);
Game._isWaterSurfaceTile = (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= Game.MAP_COLS || ty >= Game.MAP_ROWS) return false;
    if (Game._isBridgeTile(tx, ty)) return true;
    const row = Game.terrain[ty];
    const t = row && row[tx];
    return !!(t && t.type === 'water');
};

Game.getRoadAxis = (tx, ty) => {
    const isRoad = (x, y) => {
        const t = Game.getTile(x, y);
        return t && t.type === 'road';
    };
    const ew = isRoad(tx - 1, ty) || isRoad(tx + 1, ty);
    const ns = isRoad(tx, ty - 1) || isRoad(tx, ty + 1);
    if (ew && !ns) return 'x';
    if (ns && !ew) return 'z';
    if (ew && ns) {
        // Wide road / junction: run tracks consistently along whichever direction the
        // road extends farther, so a 2-tile-wide lane never checkerboards its axis into
        // a crossing grid. (The old (tx+ty)%2 tie-break produced exactly that grid.)
        let hx = 0, vz = 0;
        for (let d = 1; d <= 8 && isRoad(tx - d, ty); d++) hx++;
        for (let d = 1; d <= 8 && isRoad(tx + d, ty); d++) hx++;
        for (let d = 1; d <= 8 && isRoad(tx, ty - d); d++) vz++;
        for (let d = 1; d <= 8 && isRoad(tx, ty + d); d++) vz++;
        return hx >= vz ? 'x' : 'z';
    }
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
    Game.foliageKD = [];   // knock-down-able foliage instances (bushes + small trees)
    Game.haystacks = [];
    Game.bridges = [];
    Game.church = null;
    Game.windmill = null;
    Game.river = { tiles: [], minZ: ROWS, maxZ: 0 };
    Game.ponds = [];
    Game.pondTiles = [];
    Game.bridgeTiles = [];
    Game._waterRibbonCache = null;
    Game._waterD = null;   // depth field follows the new water tiles
    Game._terrainPaint = null;   // per-texel paint classification follows the new tiles

    for (let y = 0; y < ROWS; y++) {
        Game.terrain[y] = [];
        for (let x = 0; x < COLS; x++) Game.terrain[y][x] = Game.makeTile('grass');
    }

    // ── Reserved zones ──
    // Village core (the hamlet around the square / church) and the French
    // deployment staging in the NW are kept free of hedgerow mazes.
    // The hamlet's anchor wanders map to map (layout + dataset variety); every
    // village/farmstead/windmill coordinate below hangs off this one offset,
    // and mission.js shifts the German garrison to match.
    const vdx = Game.randi(-6, 14), vdy = Game.randi(-4, 16);
    Game.villageOfs = { dx: vdx, dy: vdy };
    const VX0 = 33 + vdx, VX1 = 45 + vdx, VY0 = 9 + vdy, VY1 = 21 + vdy;
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
    const riverCz = [];   // channel centre per column, for pond clearance below
    for (let x = 0; x < COLS; x++) {
        // Proper meander: primary bends near the classic 10-14x channel-width
        // wavelength, a slow drift, secondary wiggles and noise so no two bends
        // repeat. (The old two-sine course read as a near-straight band.)
        const cz = Math.round(74
            + Math.sin(x * 0.155) * 5.5
            + Math.sin(x * 0.052 + 0.7) * 3.5
            + Math.sin(x * 0.34 + 2.1) * 1.7
            + (Game._fbm2 ? (Game._fbm2(x * 0.09 + 11.1, 4.2) - 0.5) * 3 : 0));
        riverCz[x] = cz;
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
    //  3. ROADS radiating from the village square (base ~38,15 + offset)
    // ═══════════════════════════════════════════════════
    const SQX = 38 + vdx, SQY = 15 + vdy;
    Game.carveRoadHorizontal(SQY, 2);     // main E-W high street
    Game.carveRoadVertical(SQX, 2);       // main N-S road (crosses the river)
    Game.carveRoadLine(36 + vdx, 13 + vdy, 17 + vdx, 5 + vdy, 1); // lane NW toward the French approach
    Game.carveRoadLine(42 + vdx, 13 + vdy, 60 + vdx, 8 + vdy, 1); // lane NE toward the windmill
    Game.carveRoadLine(43 + vdx, 17 + vdy, 57 + vdx, 27 + vdy, 1);// lane SE toward outlying fields
    Game.carveRoadLine(35 + vdx, 18 + vdy, 21 + vdx, 29 + vdy, 1);// lane SW
    Game.carveRoadLine(43 + vdx, 16 + vdy, 50 + vdx, 21 + vdy, 1);// short spur to the farmstead

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
    Game.setPatch(35 + vdx, 13 + vdy, 8, 5, 'yard');  // the open village square ("place")

    // Church on the north side of the square, spire over the rooftops
    Game.setPatch(37 + vdx, 10 + vdy, 3, 4, 'house');
    Game.church = { tx: 37 + vdx, ty: 10 + vdy, tw: 3, th: 4 };

    // Houses ringing the square — thinned out so the deeper fr_house_2 model
    // breathes between plots instead of merging into one mass
    const houseSpots = [
        [33, 11, 2, 2], [41, 10, 2, 3], [44, 14, 2, 3],
        [33, 14, 2, 3], [36, 18, 3, 2], [43, 18, 2, 2],
        [30, 15, 2, 2],
    ];
    houseSpots.forEach(([x, y, w, h]) => { if (!(x === 37 && y === 10)) Game.addBuilding(x + vdx, y + vdy, w, h); });

    // ═══════════════════════════════════════════════════
    //  5. FARMSTEAD with haystacks (east of the village)
    // ═══════════════════════════════════════════════════
    Game.setPatch(49 + vdx, 20 + vdy, 9, 7, 'yard');
    Game.addBuilding(50 + vdx, 21 + vdy, 3, 2);          // long barn
    Game.addBuilding(54 + vdx, 21 + vdy, 2, 3);          // farmhouse
    Game.addBuilding(50 + vdx, 25 + vdy, 2, 2);          // shed

    // ═══════════════════════════════════════════════════
    //  6.5 PONDS — still-water mares dug into low fields
    // ═══════════════════════════════════════════════════
    // The water surface is one shared sheet at the absolute WATER_LEVEL, so
    // ponds go on the lowest ground available (candidates ranked by height)
    // and _applyWaterBedDepth pulls each bowl below the waterline.
    {
        const pondClear = (cx, cz, r) => {
            const R = Math.ceil(r * 1.6) + 2;   // stretched pond + 2-tile buffer
            if (cx - R < 4 || cx + R > COLS - 5 || cz - R < 4 || cz + R > ROWS - 5) return false;
            if (Math.abs(cz - riverCz[cx]) < r * 1.3 + 12) return false;   // stay off the river's ribbon
            for (let y = cz - R; y <= cz + R; y++) {
                for (let x = cx - R; x <= cx + R; x++) {
                    if (inVillage(x, y) || inStaging(x, y)) return false;
                    const t = Game.terrain[y][x];
                    if (!t || t.type === 'road' || t.type === 'water' || t.type === 'yard'
                        || t.type === 'house' || t.type === 'wall') return false;
                }
            }
            return true;
        };
        const want = Game.randi(1, 3);
        const cands = [];
        for (let i = 0; i < 90 && cands.length < want * 6; i++) {
            const r = Game.rand(2.0, 5.5);   // small mare up to a big field pond
            const cx = Game.randi(8, COLS - 9), cz = Game.randi(8, ROWS - 9);
            if (!pondClear(cx, cz, r)) continue;
            cands.push({ cx, cz, r, h: Game.getHeight((cx + 0.5) * T, (cz + 0.5) * T) });
        }
        cands.sort((a, b) => a.h - b.h);   // lowest ground first
        for (const c of cands) {
            if (Game.ponds.length >= want) break;
            if (Game.ponds.some(p => Math.hypot(p.tx - c.cx, p.tz - c.cz) < (p.r + c.r) * 1.3 + 8)) continue;
            // rough circle, not a perfect one: a random egg/squeeze stretch on
            // a random axis, on top of the fbm shore wobble below
            const asp = Game.rand(1.05, 1.55);
            const th = Game.rand(0, Math.PI);
            const ct = Math.cos(th), st = Math.sin(th);
            const sx = Math.sqrt(asp), sy = 1 / Math.sqrt(asp);
            const R = Math.ceil(c.r * sx) + 1;
            for (let y = c.cz - R; y <= c.cz + R; y++) {
                for (let x = c.cx - R; x <= c.cx + R; x++) {
                    // fbm wobble so the shore meanders instead of stamping an
                    // outline — low frequency, so it varies in lobes a few
                    // tiles wide rather than single-tile notches. _pondAt
                    // samples the SAME fields so the visual waterline agrees.
                    const wob = Game._fbm2 ? 0.72 + 0.55 * Game._fbm2(x * 0.19 + c.cx * 1.7, y * 0.19 - c.cz * 1.3) : 1;
                    const dx = x - c.cx, dy = y - c.cz;
                    const ex = (dx * ct + dy * st) / sx;
                    const ey = (-dx * st + dy * ct) / sy;
                    if (Math.hypot(ex, ey) >= c.r * wob) continue;
                    Game.terrain[y][x] = Game.makeTile('water');
                    Game.pondTiles.push({ tx: x, ty: y });
                }
            }
            Game.ponds.push({
                tx: c.cx, tz: c.cz, r: c.r, ct, st, sx, sy,
                wx: (c.cx + 0.5) * T, wz: (c.cz + 0.5) * T, wr: c.r * T,
            });
        }
    }

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
    // Only during dataset capture: normal games start on pristine ground and
    // ALL craters come from battle (the neural pipeline re-renders each one).
    if (Game._refCap) {
        for (let i = 0; i < 5; i++) {
            Game.craters.push({
                x: Game.rand(4, Game.WORLD_W - 4),
                z: Game.rand(2, 60),
                r: Game.rand(0.5, 1.2)
            });
        }
    }
    Game.runtimeDamageSpots = [];   // battle damage markers, fed by combat

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

// ── Water depth field ──────────────────────────────────────────────────────
// Distance (in tiles) from each water tile to the nearest shore, via a two-pass
// chamfer distance transform. Used to slope the riverbed (so the terrain sinks
// and water fills it) and to fade the water surface by depth.
Game.WATER_BANK_TILES = 4;   // tiles from shore until "full depth"

Game._computeWaterDepthField = () => {
    const C = Game.MAP_COLS, R = Game.MAP_ROWS, BIG = 1e6;
    const D = [];
    for (let y = 0; y < R; y++) {
        D[y] = new Float32Array(C);
        for (let x = 0; x < C; x++) {
            D[y][x] = Game._isWaterSurfaceTile(x, y) ? BIG : 0;
        }
    }
    const relax = (x, y, nx, ny, wgt) => {
        if (nx < 0 || ny < 0 || nx >= C || ny >= R) return;
        const v = D[ny][nx] + wgt;
        if (v < D[y][x]) D[y][x] = v;
    };
    for (let y = 0; y < R; y++) for (let x = 0; x < C; x++) {
        if (D[y][x] === 0) continue;
        relax(x, y, x - 1, y, 1); relax(x, y, x, y - 1, 1);
        relax(x, y, x - 1, y - 1, 1.414); relax(x, y, x + 1, y - 1, 1.414);
    }
    for (let y = R - 1; y >= 0; y--) for (let x = C - 1; x >= 0; x--) {
        if (D[y][x] === 0) continue;
        relax(x, y, x + 1, y, 1); relax(x, y, x, y + 1, 1);
        relax(x, y, x + 1, y + 1, 1.414); relax(x, y, x - 1, y + 1, 1.414);
    }
    Game._waterD = D;
    return D;
};

// Distance-to-shore (tiles) at a tile-grid CORNER. Corners touching land read 0
// (shoreline → shallow); fully-interior corners read the nearest water depth.
Game._waterCornerDist = (cx, cy) => {
    const D = Game._waterD; if (!D) return 0;
    const C = Game.MAP_COLS, R = Game.MAP_ROWS;
    let m = Infinity, anyLand = false, anyWater = false;
    for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        const tx = cx + dx, ty = cy + dy;
        if (tx < 0 || ty < 0 || tx >= C || ty >= R) { anyLand = true; continue; }
        const t = Game.getTile(tx, ty);
        if (Game._isWaterSurfaceTile(tx, ty)) { anyWater = true; m = Math.min(m, D[ty][tx]); }
        else anyLand = true;
    }
    if (!anyWater) return 0;
    return anyLand ? 0 : m;
};
Game._waterDepth01 = (dist) => Game.clamp(dist / (Game.WATER_BANK_TILES || 4), 0, 1);

Game._waterRectDistance = (wx, wz, tx, ty) => {
    const T = Game.TILE;
    const x0 = tx * T, z0 = ty * T;
    const x1 = x0 + T, z1 = z0 + T;
    const dx = wx < x0 ? x0 - wx : (wx > x1 ? wx - x1 : 0);
    const dz = wz < z0 ? z0 - wz : (wz > z1 ? wz - z1 : 0);
    return Math.hypot(dx, dz);
};

Game._waterSignedDistance = (wx, wz) => {
    const T = Game.TILE;
    const tx0 = Game.clamp(Math.floor(wx / T), 0, Game.MAP_COLS - 1);
    const ty0 = Game.clamp(Math.floor(wz / T), 0, Game.MAP_ROWS - 1);
    const inside = Game._isWaterSurfaceTile(tx0, ty0);
    const maxWorld = Math.max(T, (Game.WATER_BANK_TILES || 4) * T);
    const minTx = Game.clamp(Math.floor((wx - maxWorld) / T), 0, Game.MAP_COLS - 1);
    const maxTx = Game.clamp(Math.floor((wx + maxWorld) / T), 0, Game.MAP_COLS - 1);
    const minTy = Game.clamp(Math.floor((wz - maxWorld) / T), 0, Game.MAP_ROWS - 1);
    const maxTy = Game.clamp(Math.floor((wz + maxWorld) / T), 0, Game.MAP_ROWS - 1);

    if (inside) {
        let best = Math.min(wx, wz, Game.WORLD_W - wx, Game.WORLD_H - wz, maxWorld);
        for (let ty = minTy; ty <= maxTy; ty++) {
            for (let tx = minTx; tx <= maxTx; tx++) {
                if (Game._isWaterSurfaceTile(tx, ty)) continue;
                best = Math.min(best, Game._waterRectDistance(wx, wz, tx, ty));
            }
        }
        return Math.min(best, maxWorld);
    }

    const overflow = Game.WATER_SURFACE_OVERFLOW || 0.55;
    const searchWorld = Math.max(T, overflow + T);
    const wx0 = Game.clamp(Math.floor((wx - searchWorld) / T), 0, Game.MAP_COLS - 1);
    const wx1 = Game.clamp(Math.floor((wx + searchWorld) / T), 0, Game.MAP_COLS - 1);
    const wz0 = Game.clamp(Math.floor((wz - searchWorld) / T), 0, Game.MAP_ROWS - 1);
    const wz1 = Game.clamp(Math.floor((wz + searchWorld) / T), 0, Game.MAP_ROWS - 1);
    let best = Infinity;
    for (let ty = wz0; ty <= wz1; ty++) {
        for (let tx = wx0; tx <= wx1; tx++) {
            if (!Game._isWaterSurfaceTile(tx, ty)) continue;
            best = Math.min(best, Game._waterRectDistance(wx, wz, tx, ty));
        }
    }
    return Number.isFinite(best) ? -best : -Infinity;
};

Game._waterSmoothstep = (a, b, x) => {
    const t = Game.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
};

Game._waterShoreSoftness = () => {
    return Game.WATER_SHORE_SOFTNESS ?? 0.2;
};

Game._waterCoverage = (wx, wz) => {
    const T = Game.TILE;
    const radius = Game.WATER_SHORE_KERNEL_TILES || 1.55;
    const gx = wx / T - 0.5;
    const gz = wz / T - 0.5;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const reach = Math.ceil(radius);
    let clear = 1;

    for (let ty = iz - reach; ty <= iz + reach; ty++) {
        for (let tx = ix - reach; tx <= ix + reach; tx++) {
            if (!Game._isWaterSurfaceTile(tx, ty)) continue;
            const dx = gx - tx;
            const dz = gz - ty;
            const d = Math.hypot(dx, dz);
            if (d >= radius) continue;
            const t = 1 - d / radius;
            const k = t * t * (3 - 2 * t);
            clear *= (1 - k);
        }
    }
    return 1 - clear;
};

Game._waterRibbonProfile = () => {
    const tiles = (Game.river && Game.river.tiles) || [];
    if (Game._waterRibbonCache && Game._waterRibbonCache.count === tiles.length) return Game._waterRibbonCache;
    if (tiles.length < 8) return null;

    const columns = [];
    let minTx = Game.MAP_COLS, maxTx = -1;
    tiles.forEach(({ tx, ty }) => {
        if (tx < 0 || ty < 0 || tx >= Game.MAP_COLS || ty >= Game.MAP_ROWS) return;
        const c = columns[tx] || (columns[tx] = { count: 0, sum: 0, min: ty, max: ty });
        c.count++;
        c.sum += ty;
        c.min = Math.min(c.min, ty);
        c.max = Math.max(c.max, ty);
        minTx = Math.min(minTx, tx);
        maxTx = Math.max(maxTx, tx);
    });

    if (maxTx < minTx) return null;
    const T = Game.TILE;
    columns.forEach(c => {
        if (!c) return;
        c.cz = (c.sum / c.count + 0.5) * T;
        c.halfWidth = Math.max(T * 0.65, (c.max - c.min + 1) * T * 0.5);
    });

    // Smooth the per-column centreline and width (2 light passes) so bends
    // curve instead of notching where the tile path steps a row, and steep
    // sections don't spike the width.
    const n = maxTx - minTx + 1;
    if (n >= 3) {
        for (let pass = 0; pass < 2; pass++) {
            const cz = [], hw = [];
            for (let tx = minTx; tx <= maxTx; tx++) {
                const c = columns[tx];
                cz.push(c ? c.cz : null);
                hw.push(c ? c.halfWidth : null);
            }
            for (let k = 0; k < n; k++) {
                const c = columns[minTx + k];
                if (!c) continue;
                const a = cz[k - 1] ?? cz[k], b = cz[k + 1] ?? cz[k];
                const ha = hw[k - 1] ?? hw[k], hb = hw[k + 1] ?? hw[k];
                c.cz = cz[k] * 0.5 + (a + b) * 0.25;
                c.halfWidth = hw[k] * 0.5 + (ha + hb) * 0.25;
            }
        }
    }

    Game._waterRibbonCache = { count: tiles.length, columns, minTx, maxTx };
    return Game._waterRibbonCache;
};

Game._nearestWaterColumn = (columns, tx, minTx, maxTx) => {
    tx = Game.clamp(tx, minTx, maxTx);
    if (columns[tx]) return columns[tx];
    for (let d = 1; d <= Game.MAP_COLS; d++) {
        const l = tx - d, r = tx + d;
        if (l >= minTx && columns[l]) return columns[l];
        if (r <= maxTx && columns[r]) return columns[r];
    }
    return null;
};

Game._waterRibbonAt = (wx, wz, reachTiles) => {
    const profile = Game._waterRibbonProfile();
    if (!profile) return null;
    const T = Game.TILE;
    const txf = wx / T - 0.5;
    if (txf < profile.minTx - 0.75 || txf > profile.maxTx + 0.75) return null;

    const clamped = Game.clamp(txf, profile.minTx, profile.maxTx);
    const tx0 = Math.floor(clamped);
    const tx1 = Math.min(profile.maxTx, tx0 + 1);
    const f = Game.clamp(clamped - tx0, 0, 1);
    const fs = f * f * (3 - 2 * f);   // eased: no kink at column boundaries
    const a = Game._nearestWaterColumn(profile.columns, tx0, profile.minTx, profile.maxTx);
    const b = Game._nearestWaterColumn(profile.columns, tx1, profile.minTx, profile.maxTx) || a;
    if (!a || !b) return null;

    const centerZ = Game.lerp(a.cz, b.cz, fs);
    const halfWidth = Game.lerp(a.halfWidth, b.halfWidth, fs);
    // The ribbon models the RIVER only — far from the channel any water is a
    // pond, and those texels belong to the coverage-based fallbacks. Callers
    // probing the channel itself (wz=0 scans) pass Infinity.
    if (Math.abs(wz - centerZ) > halfWidth + (reachTiles ?? 8) * T) return null;
    return {
        centerZ,
        halfWidth,
        signed: halfWidth - Math.abs(wz - centerZ),
    };
};

// Analytic pond shoreline — the pond counterpart of the river's ribbon mask,
// so pond banks meander exactly like the riverbank instead of stair-stepping
// tile by tile. Returns { signed, wr } (world units, signed positive = in the
// water) for the nearest pond, or null. The rim wobble samples the SAME fbm
// field as the tile carve in generateMap, so the visual waterline tracks the
// water tiles the game logic uses.
Game._pondAt = (wx, wz) => {
    const ponds = Game.ponds;
    if (!ponds || !ponds.length) return null;
    const T = Game.TILE;
    const u = wx / T - 0.5, v = wz / T - 0.5;
    let best = null;
    for (const p of ponds) {
        const dx = u - p.tx, dz = v - p.tz;   // tile units, like the carve
        if (Math.hypot(dx, dz) > p.r * 1.7 + 6) continue;   // beyond any influence
        // same egg/squeeze metric + fbm wobble as the tile carve
        const ex = (dx * (p.ct ?? 1) + dz * (p.st ?? 0)) / (p.sx ?? 1);
        const ez = (-dx * (p.st ?? 0) + dz * (p.ct ?? 1)) / (p.sy ?? 1);
        const wob = Game._fbm2 ? 0.72 + 0.55 * Game._fbm2(u * 0.19 + p.tx * 1.7, v * 0.19 - p.tz * 1.3) : 1;
        const signed = (p.r * wob - Math.hypot(ex, ez)) * T;
        if (!best || signed > best.signed) best = { signed, wr: p.wr };
    }
    return best;
};

Game._waterDepth01At = (wx, wz) => {
    const ribbon = Game._waterRibbonAt(wx, wz);
    if (ribbon) {
        // cross-channel falloff scaled by the pool/riffle factor, so shallows
        // stay pale/translucent even mid-stream and pools go dark early
        const cross = Game.clamp(ribbon.signed / Math.max(0.001, ribbon.halfWidth * 0.78), 0, 1);
        const pool = Game._waterPool01 ? Game._waterPool01(wx, ribbon.centerZ) : 0.5;
        return Game.clamp(cross * (0.35 + 1.05 * pool), 0, 1);
    }

    const pool = Game._waterPool01 ? Game._waterPool01(wx, wz) : 0.5;
    const pond = Game._pondAt ? Game._pondAt(wx, wz) : null;
    if (pond) {
        // bowl profile with pool/riffle noise: depth varies across the pond
        const d = Game.clamp(pond.signed / Math.max(0.001, pond.wr * 0.6), 0, 1);
        return Game.clamp(d * (0.45 + 0.9 * pool), 0, 1);
    }

    const threshold = Game.WATER_SHORE_THRESHOLD ?? 0.24;
    const coverage = Game._waterCoverage ? Game._waterCoverage(wx, wz) : 1;
    const d = Game.clamp((coverage - threshold) / Math.max(0.001, 1 - threshold), 0, 1);
    return Game.clamp(d * (0.45 + 0.9 * pool), 0, 1);
};

Game._waterEdgeAlphaAt = (wx, wz) => {
    const overflow = Game.WATER_SURFACE_OVERFLOW || 0.7;
    const ribbon = Game._waterRibbonAt(wx, wz);
    if (ribbon) {
        const jitterAmp = (Game.WATER_SHORE_JITTER || 0) * Game.TILE * 2;
        const jitter = (Game._fbm2 ? Game._fbm2(wx * 0.055 + 19.3, wz * 0.055 - 7.1) - 0.5 : 0) * jitterAmp;
        const signed = ribbon.signed + jitter;
        if (signed < -overflow) return 0;
        const shoreSoft = Math.max(0.05, Game._waterShoreSoftness() * Game.TILE);
        return Game.clamp(Game._waterSmoothstep(-overflow, shoreSoft, signed), 0, 1);
    }

    const pond = Game._pondAt ? Game._pondAt(wx, wz) : null;
    if (pond) {
        // same jittered-signed-distance treatment as the riverbank, so pond
        // waterlines meander identically instead of stepping tile to tile
        const pj = Game._waterSignedJittered(wx, wz, pond);
        if (pj < -overflow) return 0;
        const shoreSoft = Math.max(0.05, Game._waterShoreSoftness() * Game.TILE);
        return Game.clamp(Game._waterSmoothstep(-overflow, shoreSoft, pj), 0, 1);
    }

    const signed = Game._waterSignedDistance(wx, wz);
    if (signed < -overflow) return 0;

    const threshold = Game.WATER_SHORE_THRESHOLD ?? 0.24;
    const softness = Game._waterShoreSoftness();
    const jitterAmp = Game.WATER_SHORE_JITTER || 0;
    const jitter = (Game._fbm2 ? Game._fbm2(wx * 0.075 + 19.3, wz * 0.075 - 7.1) - 0.5 : 0) * jitterAmp;
    const coverage = Game._waterCoverage(wx, wz) + jitter;
    const coverageFade = Game._waterSmoothstep(threshold - softness, threshold + softness, coverage);
    const overflowFade = signed >= 0 ? 1 : Game._waterSmoothstep(-overflow, 0, signed);
    return Game.clamp(coverageFade * overflowFade, 0, 1);
};

// Along-river pool/riffle factor: 0 = gravelly shallow riffle, 1 = deep pool.
// Sampled at (wx, centerZ) so one value holds across the whole channel section.
Game._waterPool01 = (wx, centerZ) => {
    if (!Game._fbm2) return 0.5;
    return Game.clamp((Game._fbm2(wx * 0.016 + 3.7, centerZ * 0.016 - 8.9) - 0.2) / 0.6, 0, 1);
};

// The shoreline's jittered signed distance — the ONE formula shared by the bed
// carve, the bank paint and the surface mask, so every layer agrees where the
// waterline meanders (positive = in the water).
Game._waterSignedJittered = (wx, wz, rib) => {
    const jitAmp = (Game.WATER_SHORE_JITTER || 0.25) * Game.TILE * 2;
    const j = Game._fbm2 ? (Game._fbm2(wx * 0.055 + 19.3, wz * 0.055 - 7.1) - 0.5) : 0;
    return rib.signed + j * jitAmp;
};

// Gravel-wash mask (0..1): shingle bars straddling the waterline — too high
// for water, too stony for grass. Concentrated on riffle stretches (point
// bars); occasional patches reach further up the bank (storm wash).
Game._waterWashAt = (wx, wz, rib, signed) => {
    const T = Game.TILE;
    if (signed > T * 0.22 || signed < -T * 1.9 || !Game._fbm2) return 0;
    const washN = Game._fbm2(wx * 0.03 + 91.2, wz * 0.03 + 37.8);
    const pool = Game._waterPool01(wx, rib.centerZ);
    const far = Game.clamp((-signed - T * 0.9) / T, 0, 1);   // rarer high up the bank
    const thr = 0.62 - (1 - pool) * 0.16 + far * 0.16;
    return washN > thr ? Game.clamp((washN - thr) / 0.08, 0, 1) : 0;
};

Game._captureWaterBedBaseHeightmap = () => {
    if (!Game.heightData || !Game.heightW || !Game.heightH) return;
    Game._waterBedBaseHeightData = new Float32Array(Game.heightData);
    Game._waterBedBaseW = Game.heightW;
    Game._waterBedBaseH = Game.heightH;
    Game._waterBedApplied = false;
};

Game._waterBaseHeightAt = (x, z) => {
    const data = Game._waterBedBaseHeightData;
    const w = Game._waterBedBaseW || Game.heightW;
    const h = Game._waterBedBaseH || Game.heightH;
    if (!data || !w || !h || data.length !== w * h) return Game.getHeight(x, z);

    const u = Game.clamp(x / Game.WORLD_W, 0, 1) * (w - 1);
    const v = Game.clamp(z / Game.WORLD_H, 0, 1) * (h - 1);
    const x0 = Math.floor(u), x1 = Math.min(x0 + 1, w - 1);
    const y0 = Math.floor(v), y1 = Math.min(y0 + 1, h - 1);
    const fx = u - x0, fy = v - y0;
    const h00 = data[y0 * w + x0];
    const h10 = data[y0 * w + x1];
    const h01 = data[y1 * w + x0];
    const h11 = data[y1 * w + x1];
    const n = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy)
        + h01 * (1 - fx) * fy + h11 * fx * fy;
    return n * Game.HEIGHT_SCALE;
};

Game._applyWaterBedDepth = () => {
    if (!Game.heightData || !Game.terrain.length) return;
    if (!Game._waterBedBaseHeightData
        || Game._waterBedBaseW !== Game.heightW
        || Game._waterBedBaseH !== Game.heightH
        || Game._waterBedBaseHeightData.length !== Game.heightData.length) {
        Game._captureWaterBedBaseHeightmap();
    }
    const base = Game._waterBedBaseHeightData;
    if (!base || base.length !== Game.heightData.length) return;

    Game.heightData.set(base);
    Game._waterBedApplied = false;
    if (!Game._waterD) Game._computeWaterDepthField();

    const T = Game.TILE;
    const WL = Game.WATER_LEVEL ?? 0.55;
    const maxSink = Math.max(0, Game.WATER_BED_DEPTH ?? 0.55);   // pool depth below the waterline
    const edgeSink = Math.max(0, Game.WATER_BED_EDGE ?? 0.18);   // depth right at the shore
    const slope = Game.clamp(Game.WATER_BED_SLOPE ?? 1.15, 0.2, 4);
    const floodW = Math.max(0.5, Game.WATER_FLOOD_TILES ?? 2.6) * T;
    if (maxSink <= 0 && edgeSink <= 0) return;

    const W = Game.heightW, H = Game.heightH;
    const HS = Game.HEIGHT_SCALE || 3.5;
    for (let py = 0; py < H; py++) {
        const wz = (py / Math.max(1, H - 1)) * Game.WORLD_H;
        for (let px = 0; px < W; px++) {
            const wx = (px / Math.max(1, W - 1)) * Game.WORLD_W;
            const i = py * W + px;
            const rib = Game._waterRibbonAt ? Game._waterRibbonAt(wx, wz) : null;
            if (!rib) {
                // No ribbon here: pond water. The shared surface plane sits at
                // the absolute WATER_LEVEL, so the bowl must be carved below it
                // (a relative sink would leave high-ground beds poking out) and
                // the meadow ramps down to a low rim, like the floodplain.
                // Same jittered signed distance as the waterline/bank paint, so
                // all pond layers agree where the shore meanders.
                const pond = Game._pondAt ? Game._pondAt(wx, wz) : null;
                if (pond) {
                    const signed = Game._waterSignedJittered(wx, wz, pond);
                    const rampW = floodW * 1.7;
                    if (signed <= -rampW) continue;
                    const tt = Game.getTile((wx / T) | 0, (wz / T) | 0);
                    if (tt && (tt.type === 'yard' || tt.type === 'house' || tt.type === 'wall')) continue;
                    const baseH = base[i] * HS;
                    const rim = WL + 0.16;
                    let target;
                    if (signed >= 0) {
                        const depth = Game.clamp(signed / Math.max(0.001, pond.wr * 0.6), 0, 1);
                        target = WL - (edgeSink + maxSink * Math.pow(depth, slope));
                    } else {
                        // approach ramp: ease the field down toward the rim
                        target = Game.lerp(rim, baseH, Math.pow(Game.clamp(-signed / rampW, 0, 1), 1.4));
                    }
                    if (target < baseH) Game.heightData[i] = target / HS;
                    continue;
                }
                // hand-painted water (map maker) or a degenerate river:
                // same absolute below-waterline bowl as ponds, keyed off the
                // tile-based shore mask
                const edge = Game._waterEdgeAlphaAt ? Game._waterEdgeAlphaAt(wx, wz) : 0;
                if (edge <= 0.001) continue;
                const tt2 = Game.getTile((wx / T) | 0, (wz / T) | 0);
                if (tt2 && (tt2.type === 'yard' || tt2.type === 'house' || tt2.type === 'wall')) continue;
                const baseH2 = base[i] * HS;
                const depth = Game._waterDepth01At ? Game._waterDepth01At(wx, wz) : edge;
                const sink2 = edgeSink + maxSink * Math.pow(depth, slope);
                const target2 = Game.lerp(WL + 0.16, WL - sink2, Game._waterSmoothstep(0.02, 0.85, edge));
                if (target2 < baseH2) Game.heightData[i] = target2 / HS;
                continue;
            }
            const signed = Game._waterSignedJittered(wx, wz, rib);
            if (signed <= -floodW * 1.5) continue;
            const baseH = base[i] * HS;
            if (signed >= 0) {
                // channel bed: ABSOLUTE depth below the waterline (the old
                // base-relative sink left the bed poking above the surface in
                // places), varied along the river — riffles shallow, pools deep
                const pool = Game._waterPool01(wx, rib.centerZ);
                const cross = Math.pow(Game.clamp(signed / Math.max(0.001, rib.halfWidth * 0.85), 0, 1), slope);
                const depth = edgeSink + maxSink * cross * (0.3 + 1.1 * pool);
                Game.heightData[i] = Math.min(baseH, WL - depth) / HS;
            } else {
                // floodplain: the meadow eases down to a low lip just above the
                // water instead of a trench wall; a noise-picked minority of
                // banks stays high (undercut banks). Structures keep their pad.
                const tt = Game.getTile((wx / T) | 0, (wz / T) | 0);
                if (tt && (tt.type === 'yard' || tt.type === 'house' || tt.type === 'wall')) continue;
                // slope steepness wanders: short steep cut banks alternate
                // with long gentle ramps
                const fw = floodW * (0.55 + 0.95 * Game._fbm2(wx * 0.031 + 41.5, wz * 0.031 + 9.2));
                if (signed <= -fw) continue;
                const lipN = Game._fbm2 ? Game._fbm2(wx * 0.021 + 77.7, wz * 0.021 - 31.4) : 0.5;
                const lipF = Game._fbm2 ? Game._fbm2(wx * 0.085 - 3.1, wz * 0.085 + 27.6) : 0.5;
                const lip = Math.max(0.06, 0.1 + lipN * lipN * 0.85 + (lipF - 0.5) * 0.3);
                const t = Math.pow(Game.clamp(-signed / fw, 0, 1), 1.5);
                let target = Game.lerp(WL + lip, baseH, t);
                // hummocks: low mounds and hollows mid-slope so the floodplain
                // isn't one uniform ramp (envelope is zero at both ends, so the
                // waterline lip and the field join stay put)
                const hum = Game._fbm2(wx * 0.062 + 15.9, wz * 0.062 - 58.4) - 0.45;
                target += hum * 1.1 * (t * (1 - t) * 4);
                if (target < baseH) Game.heightData[i] = target / HS;
            }
        }
    }
    Game._waterBedApplied = true;
};

// ── Animated water surface ─────────────────────────────────────────────────
// A translucent plane over the river at WATER_LEVEL: colour + alpha bake from
// the same smooth shoreline mask as the bed carve (so surface, bank and bed
// agree), and a tiling ripple normal map scrolls each frame for moving water.
Game._makeWaterNormalTex = () => {
    if (Game._waterNormalTex) return Game._waterNormalTex;
    const N = 128;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(N, N);
    const d = img.data;
    const TAU = Math.PI * 2;
    // sum of integer-frequency waves → tiles seamlessly under RepeatWrapping
    const h = (x, y) =>
        Math.sin((3 * x + 1 * y) / N * TAU) * 0.55 +
        Math.sin((1 * x - 4 * y) / N * TAU + 1.7) * 0.35 +
        Math.sin((6 * x + 5 * y) / N * TAU + 4.1) * 0.22 +
        Math.sin((9 * x - 2 * y) / N * TAU + 2.3) * 0.14;
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const dx = h(x + 1, y) - h(x - 1, y);
            const dy = h(x, y + 1) - h(x, y - 1);
            const inv = 1 / Math.hypot(dx, dy, 2);
            const i = (y * N + x) * 4;
            d[i] = 128 + (-dx * inv) * 127;
            d[i + 1] = 128 + (-dy * inv) * 127;
            d[i + 2] = 128 + (2 * inv) * 127;
            d[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    Game._waterNormalTex = tex;
    return tex;
};

// Soft sun-glint canvas: sparse bright blobs over black, tiled and drifted
// slowly across the water as an emissive layer — patches of light with the
// darker water reading between them.
Game._waterSparkleCanvas = () => {
    if (Game._sparkleCanvas) return Game._sparkleCanvas;
    const N = 256;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, N, N);
    const blob = (x, y, r, a) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,248,220,' + a + ')');
        g.addColorStop(0.4, 'rgba(255,246,214,' + (a * 0.5) + ')');
        g.addColorStop(1, 'rgba(255,246,214,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    // hundreds of tiny sharp glints (the "glitter"), a few medium ones
    for (let i = 0; i < 640; i++) {
        const x = Math.random() * N, y = Math.random() * N;
        const r = 0.6 + Math.random() * 1.8;
        const a = 0.35 + Math.random() * 0.55;
        for (const dx of [-N, 0, N]) {
            for (const dy of [-N, 0, N]) blob(x + dx, y + dy, r, a);
        }
    }
    for (let i = 0; i < 30; i++) {
        const x = Math.random() * N, y = Math.random() * N;
        const r = 2.5 + Math.random() * 3.5;
        const a = 0.2 + Math.random() * 0.3;
        for (const dx of [-N, 0, N]) {
            for (const dy of [-N, 0, N]) blob(x + dx, y + dy, r, a);
        }
    }
    Game._sparkleCanvas = c;
    return c;
};
Game._waterSparkleTex = () => {
    const THREE = Game.THREE;
    const tex = new THREE.CanvasTexture(Game._waterSparkleCanvas());
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
};
Game.WATER_SPARKLE = { intensity: 1.55, scale: 6, speed: 2.9 };

Game._buildWaterSurface = () => {
    Game._waterFX = null;
    // scan the tile map so hand-painted water (map maker) gets a surface too
    if (!Game._waterEdgeAlphaAt) return;
    const T = Game.TILE;
    const pad = 2 * T;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let ty = 0; ty < Game.MAP_ROWS; ty++) {
        for (let tx = 0; tx < Game.MAP_COLS; tx++) {
            if (!Game._isWaterSurfaceTile(tx, ty)) continue;
            minX = Math.min(minX, tx * T); maxX = Math.max(maxX, (tx + 1) * T);
            minZ = Math.min(minZ, ty * T); maxZ = Math.max(maxZ, (ty + 1) * T);
        }
    }
    if (!Number.isFinite(minX)) return;
    minX = Math.max(0, minX - pad); maxX = Math.min(Game.WORLD_W, maxX + pad);
    minZ = Math.max(0, minZ - pad); maxZ = Math.min(Game.WORLD_H, maxZ + pad);
    const w = maxX - minX, hSpan = maxZ - minZ;
    if (w <= 0 || hSpan <= 0) return;

    // Bake colour + alpha from the shoreline mask (organic, not tile-square)
    const res = 8;   // texels per tile
    const CW = Math.max(4, Math.round(w / T * res));
    const CH = Math.max(4, Math.round(hSpan / T * res));
    const c = document.createElement('canvas');
    c.width = CW; c.height = CH;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(CW, CH);
    const d = img.data;
    const shallow = [88, 126, 108], deep = [22, 50, 64];
    const foamC = [178, 192, 182];
    for (let y = 0; y < CH; y++) {
        const wz = minZ + (y + 0.5) / CH * hSpan;
        for (let x = 0; x < CW; x++) {
            const wx = minX + (x + 0.5) / CW * w;
            const a = Game._waterEdgeAlphaAt(wx, wz);
            const i = (y * CW + x) * 4;
            if (a <= 0.003) { d[i + 3] = 0; continue; }
            const depth = Game._waterDepth01At ? Game._waterDepth01At(wx, wz) : a;
            let r = shallow[0] + (deep[0] - shallow[0]) * depth;
            let g = shallow[1] + (deep[1] - shallow[1]) * depth;
            let b = shallow[2] + (deep[2] - shallow[2]) * depth;
            // faint waterline lap: a light fringe where the surface thins out
            const foam = Math.max(0, 1 - depth * 3.5) * Math.max(0, 1 - Math.abs(a - 0.45) * 2.6) * 0.5;
            r += (foamC[0] - r) * foam;
            g += (foamC[1] - g) * foam;
            b += (foamC[2] - b) * foam;
            d[i] = r; d[i + 1] = g; d[i + 2] = b;
            // riffles nearly see-through (gravel bed shows), pools near-opaque
            d[i + 3] = Math.round(a * (108 + 106 * depth));
        }
    }
    ctx.putImageData(img, 0, 0);
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;

    const normalMap = Game._makeWaterNormalTex();
    normalMap.repeat.set(w / 14, hSpan / 14);   // ripple wavelength a few metres

    const sparkle = Game._waterSparkleTex();
    const spScale = (Game.WATER_SPARKLE && Game.WATER_SPARKLE.scale) || 6;
    sparkle.repeat.set(w / spScale, hSpan / spScale);
    const mat = new THREE.MeshStandardMaterial({
        map, normalMap,
        normalScale: new THREE.Vector2(0.5, 0.35),
        transparent: true, depthWrite: false,
        roughness: 0.16, metalness: 0.05,
        emissive: 0xfff6d6,
        emissiveMap: sparkle,
        emissiveIntensity: (Game.WATER_SPARKLE && Game.WATER_SPARKLE.intensity) || 1.55,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, hSpan), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(minX + w / 2, (Game.WATER_LEVEL || 0.55) + 0.02, minZ + hSpan / 2);
    mesh.name = 'water-surface';
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    mesh.raycast = () => {};   // purely visual — never blocks picking
    Game.terrainGroup.add(mesh);
    Game._waterFX = { mat, sparkle, w, hSpan, t: Game.rand(0, 100) };
};

// Scroll the ripple normals along the river each frame (called from the loop).
Game.WATER_RIPPLE = { speed: 2.2, strength: 1 };   // debug-tunable

Game.updateWaterFX = (dt) => {
    const fx = Game._waterFX;
    if (!fx) return;
    const R = Game.WATER_RIPPLE || { speed: 1, strength: 1 };
    fx.t += dt * (R.speed != null ? R.speed : 1);
    const nm = fx.mat.normalMap;
    if (nm) {
        nm.offset.x = (fx.t * 0.020) % 1;   // flow along the river (E-W)
        nm.offset.y = (fx.t * 0.008) % 1;
    }
    // soft cross-chop so the glints keep moving
    const k = R.strength != null ? R.strength : 1;
    fx.mat.normalScale.set(
        (0.45 + 0.12 * Math.sin(fx.t * 0.9)) * k,
        (0.32 + 0.09 * Math.sin(fx.t * 1.3 + 1.0)) * k
    );
    // sun glints drift much slower than the chop, on their own speed control
    const SP = Game.WATER_SPARKLE || {};
    const spT = fx.t * (SP.speed != null ? SP.speed : 1);
    if (fx.sparkle) {
        fx.sparkle.offset.x = (spT * 0.0045) % 1;
        fx.sparkle.offset.y = (spT * 0.0028) % 1;
    }
    const BS = Game._neuralBake;
    if (BS && BS.waterSwap) {
        const em = BS.waterSwap.mesh.material.emissiveMap;
        if (em) {
            em.offset.x = (spT * 0.0045) % 1;
            em.offset.y = (spT * 0.0028) % 1;
        }
    }
    // the neural-bake water overlay shares the scrolling normal texture;
    // keep its (subtler) chop in step with the same controls
    const B = Game._neuralBake;
    if (B && B.waterSwap && B.waterSwap.mesh.material.normalScale) {
        B.waterSwap.mesh.material.normalScale.set(
            (0.14 + 0.05 * Math.sin(fx.t * 0.9)) * k,
            (0.10 + 0.04 * Math.sin(fx.t * 1.3 + 1.0)) * k
        );
    }
};

// Scattered cobbles on the gravel-wash bars (instanced, purely visual). Uses
// the same wash mask as the paint, so the stones sit on the shingle patches.
Game._addRiverWashStones = () => {
    const THREE = Game.THREE;
    const prof = Game._waterRibbonProfile && Game._waterRibbonProfile();
    if (!prof || !Game._waterWashAt) return;
    const T = Game.TILE;
    const pts = [];
    for (let txf = prof.minTx; txf <= prof.maxTx && pts.length < 420; txf += 0.34) {
        const wx = (txf + 0.5) * T;
        const rib = Game._waterRibbonAt(wx, 0, Infinity);   // wz only matters for .signed
        if (!rib) continue;
        for (let k = 0; k < 6; k++) {
            const wz = rib.centerZ + Game.rand(-(rib.halfWidth + 2.2 * T), rib.halfWidth + 2.2 * T);
            // rib.signed was measured at the probe wz — redo it for this sample
            const at = { signed: rib.halfWidth - Math.abs(wz - rib.centerZ) };
            const signed = Game._waterSignedJittered(wx, wz, at);
            const wash = Game._waterWashAt(wx, wz, rib, signed);
            if (wash <= 0 || Math.random() > wash * 0.55) continue;
            pts.push({ x: wx + Game.rand(-0.5, 0.5), z: wz });
        }
    }
    if (!pts.length) return;
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({
        map: Game._makeDarkStoneTexture ? Game._makeDarkStoneTexture() : null,
        roughness: 0.95, metalness: 0.0,
    });
    const inst = new THREE.InstancedMesh(geo, mat, pts.length);
    inst.name = 'river-wash-stones';
    inst.castShadow = true;
    inst.receiveShadow = true;
    const dummy = new THREE.Object3D();
    const icol = new THREE.Color();
    pts.forEach((p, i) => {
        const s = Game.rand(0.08, 0.26);
        dummy.position.set(p.x, Game.getHeight(p.x, p.z) + s * 0.3, p.z);
        dummy.rotation.set(Game.rand(0, Math.PI), Game.rand(0, Math.PI), Game.rand(0, Math.PI));
        dummy.scale.set(s, s * 0.65, s);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
        icol.setScalar(Game.rand(1.05, 1.6));   // river shingle reads paler than fieldstone
        inst.setColorAt(i, icol);
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.computeBoundingSphere();
    inst.raycast = () => {};   // purely visual — never blocks picking
    Game.terrainGroup.add(inst);
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

    // 1. Precompute the river distance field. The visible, tuneable bed carve is
    // applied later from a cached base heightmap, so debug rebuilds and sliders
    // do not keep digging the same riverbed deeper and deeper.
    Game._computeWaterDepthField();

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
    if (Game._captureWaterBedBaseHeightmap) Game._captureWaterBedBaseHeightmap();
};

/**
 * Generate rolling hills from smoothed random noise. (Terrain-aware shaping
 * happens in shapeHeightmap, called from generateMap or here on regen.)
 */
// Add smooth localized ditches (dips) and hills (bumps) to ~30% of the heightmap,
// centres on a golden-angle spiral (natural, even-but-not-gridded spread). Subtle
// by design; tunable via Game.TERRAIN_FEATURE_COUNT / _AMP. Operates on the
// normalised 0..1 heightData (before shapeHeightmap flattens roads/buildings).
Game._addTerrainFeatures = () => {
    const w = Game.heightW, h = Game.heightH, d = Game.heightData;
    if (!d) return;
    const GA = Math.PI * (3 - Math.sqrt(5));          // golden angle
    const count = Game.TERRAIN_FEATURE_COUNT != null ? Game.TERRAIN_FEATURE_COUNT : 18;
    const ampMax = Game.TERRAIN_FEATURE_AMP != null ? Game.TERRAIN_FEATURE_AMP : 0.16;   // normalised (×HEIGHT_SCALE)
    const cx0 = w / 2, cy0 = h / 2;
    for (let k = 0; k < count; k++) {
        const rr = Math.sqrt((k + 0.5) / count) * 0.52;                 // 0..~0.52 of the map radius
        const a = k * GA;
        const fx = cx0 + Math.cos(a) * rr * w + (Math.random() - 0.5) * w * 0.09;
        const fy = cy0 + Math.sin(a) * rr * h + (Math.random() - 0.5) * h * 0.09;
        const rad = 5 + Math.random() * 8;                              // cells (~12–30 world units wide)
        const amp = (Math.random() < 0.5 ? -1 : 1) * (0.05 + Math.random() * ampMax);   // dip or hill
        const y0 = Math.max(0, Math.floor(fy - rad)), y1 = Math.min(h, Math.ceil(fy + rad));
        const x0 = Math.max(0, Math.floor(fx - rad)), x1 = Math.min(w, Math.ceil(fx + rad));
        for (let py = y0; py < y1; py++) {
            for (let px = x0; px < x1; px++) {
                const dx = px - fx, dy = py - fy;
                const dd = Math.sqrt(dx * dx + dy * dy);
                if (dd > rad) continue;
                const fall = 0.5 + 0.5 * Math.cos((dd / rad) * Math.PI);   // smooth 1→0
                d[py * w + px] = Game.clamp(d[py * w + px] + amp * fall, 0, 1);
            }
        }
    }
};

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

    // Mid-scale rolling swell: the heavy smoothing above leaves little more
    // than one map-wide gradient, so whole stretches read dead flat. Layer a
    // gentle fbm undulation (wavelengths roughly 10-25 tiles) over it — subtle
    // rolling farmland, not hills. Roads/buildings are re-flattened later in
    // shapeHeightmap, and the river bed is carved to absolute depth, so
    // neither is disturbed.
    if (Game._fbm2) {
        const amp = Game.TERRAIN_SWELL_AMP != null ? Game.TERRAIN_SWELL_AMP : 0.11;
        for (let py = 0; py < h; py++) {
            const wz = py / h * Game.WORLD_H;
            for (let px = 0; px < w; px++) {
                const wx = px / w * Game.WORLD_W;
                const n = (Game._fbm2(wx * 0.013 + 3.3, wz * 0.013 - 6.6)
                    + 0.55 * Game._fbm2(wx * 0.031 - 14.2, wz * 0.031 + 8.4)) / 1.55;
                const i = py * w + px;
                Game.heightData[i] = Game.clamp(Game.heightData[i] + (n - 0.5) * amp * 2, 0, 1);
            }
        }
    }

    // Localized ditches/hills over ~30% of the map (the rest stays flat), placed on
    // a golden-angle spiral so they're naturally spread, not gridded or clumped.
    if (Game._addTerrainFeatures) Game._addTerrainFeatures();

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

        // VALOR: optional soft-blend — feather the leaf cards (live-tunable). The
        // blurUniform lets trees and hedges use independent softness values.
        if (options.blur && Game._valorTreeBlurInject) Game._valorTreeBlurInject(shader, options.blurUniform);

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

// Generated gravel texture (256²) for road surfaces: a compacted-dirt base with
// dense multi-tone pebbles + dust. Used as the default road texture; a supplied
// textures/dirt_gravel_road.jpg overrides it.
Game._makeGravelTexture = () => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#a48f6c'; g.fillRect(0, 0, 256, 256);
    const ri = (a, b) => (a + Math.random() * (b - a)) | 0;
    for (let i = 0; i < 3000; i++) {
        const x = Math.random() * 256, y = Math.random() * 256, r = 0.5 + Math.random() * 3.4;
        const t = Math.random();
        let col;
        if (t < 0.38) col = `rgba(${ri(78, 104)},${ri(68, 90)},${ri(50, 70)},${(0.35 + Math.random() * 0.3).toFixed(2)})`;
        else if (t < 0.72) col = `rgba(${ri(140, 170)},${ri(124, 150)},${ri(94, 118)},${(0.3 + Math.random() * 0.25).toFixed(2)})`;
        else col = `rgba(${ri(200, 232)},${ri(190, 216)},${ri(156, 182)},${(0.28 + Math.random() * 0.22).toFixed(2)})`;
        g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(232,220,186,${(0.1 + Math.random() * 0.18).toFixed(2)})`; g.fillRect(Math.random() * 256, Math.random() * 256, 1, 1); }
    return c;
};

// Turn a supplied road photo (dirt_gravel_road.jpg) into a TILEABLE, top-down
// gravel grain tile. A raw perspective photo tiled with `repeat` shows a grid:
// its top->bottom brightness gradient repeats into horizontal bands and its
// non-matching edges repeat into vertical lines. We (1) flatten the lighting so
// only the gravel colour + fine grain remain, then (2) heal the edges so the tile
// is seamless. Directional tyre tracks are added separately along the road axis.
Game._prepareRoadGravel = (img) => {
    const S = 256;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    // cover-fit into the square
    const iw = img.width || S, ih = img.height || S;
    const sc = Math.max(S / iw, S / ih);
    g.drawImage(img, (S - iw * sc) / 2, (S - ih * sc) / 2, iw * sc, ih * sc);

    // 1. Flatten lighting: divide out the low-frequency luminance so the
    //    perspective gradient (the horizontal-band cause) is gone; colour stays.
    const low = document.createElement('canvas'); low.width = low.height = S;
    const lg = low.getContext('2d');
    lg.filter = 'blur(22px)';
    lg.drawImage(c, 0, 0);
    lg.filter = 'none';
    const base = g.getImageData(0, 0, S, S), lo = lg.getImageData(0, 0, S, S);
    const d = base.data, l = lo.data;
    for (let i = 0; i < d.length; i += 4) {
        const lum = 0.299 * l[i] + 0.587 * l[i + 1] + 0.114 * l[i + 2];
        const f = lum > 4 ? Game.clamp(150 / lum, 0.5, 2.0) : 1;
        d[i] = Game.clamp(d[i] * f, 0, 255);
        d[i + 1] = Game.clamp(d[i + 1] * f, 0, 255);
        d[i + 2] = Game.clamp(d[i + 2] * f, 0, 255);
    }
    g.putImageData(base, 0, 0);

    // 2. Seamless heal: build a half-offset (wrap) copy whose edges are the
    //    original's continuous centre, then blend it over the original's edges
    //    (feathered) so the tile seams that formed the vertical/horizontal grid
    //    lines disappear.
    const off = document.createElement('canvas'); off.width = off.height = S;
    const og = off.getContext('2d');
    const h = S / 2;
    og.drawImage(c, h, h); og.drawImage(c, h - S, h);
    og.drawImage(c, h, h - S); og.drawImage(c, h - S, h - S);
    const grd = og.createRadialGradient(h, h, S * 0.16, h, h, S * 0.5);
    grd.addColorStop(0, 'rgba(0,0,0,0)');   // centre transparent -> keep original centre
    grd.addColorStop(1, 'rgba(0,0,0,1)');   // edges opaque       -> take seamless offset edges
    og.globalCompositeOperation = 'destination-in';
    og.fillStyle = grd; og.fillRect(0, 0, S, S);
    og.globalCompositeOperation = 'source-over';
    g.drawImage(off, 0, 0);

    return c;
};

// ── Per-texel paint classification (shared by the colour + material maps) ──
// The old painter filled each tile as a flat rect, so every field-to-field join
// was a dead-straight line along the tile grid — the single biggest "board
// game" tell. Here each texel is classified through a noise-WARPED tile lookup
// instead, so boundaries wander like real field edges. Each contiguous
// same-type region also gets its own tint and cultivation-row direction, so
// two adjacent wheat plots read as two different fields, not one blob.
Game._getTerrainPaint = () => {
    const px = Game.TERRAIN_TEXELS_PER_TILE || 20;
    const COLS = Game.MAP_COLS, ROWS = Game.MAP_ROWS;
    const W = COLS * px, H = ROWS * px;
    const warpAmp = Game.TERRAIN_EDGE_WARP != null ? Game.TERRAIN_EDGE_WARP : 0.45;
    const fineAmp = Game.TERRAIN_EDGE_WARP_FINE != null ? Game.TERRAIN_EDGE_WARP_FINE : 0.12;
    const tintAmp = Game.TERRAIN_FIELD_TINT != null ? Game.TERRAIN_FIELD_TINT : 0.07;
    const roughShare = Game.clamp(Game.TERRAIN_EDGE_ROUGH_SHARE != null ? Game.TERRAIN_EDGE_ROUGH_SHARE : 0.35, 0, 1);
    const cached = Game._terrainPaint;
    if (cached && cached.W === W && cached.H === H
        && cached.warpAmp === warpAmp && cached.fineAmp === fineAmp
        && cached.tintAmp === tintAmp && cached.roughShare === roughShare) return cached;

    const paintType = (t) => {
        if (t === 'hedge') return 'pasture';
        if (t === 'wall' || t === 'house') return 'yard';
        if (t === 'water') return 'mud';
        return t;
    };
    // Painted type per tile; road tiles take their surrounding field (the road
    // itself is stroked later as a smooth corridor over the finished ground).
    const typeNames = [];
    const typeIndexOf = {};
    const idxFor = (n) => (typeIndexOf[n] !== undefined ? typeIndexOf[n] : (typeIndexOf[n] = typeNames.push(n) - 1));
    const NEIGH8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
    const fieldUnderRoad = (tx, ty) => {
        for (const [dx, dy] of NEIGH8) {
            const n = Game.getTile(tx + dx, ty + dy);
            if (!n) continue;
            const nt = paintType(n.type);
            if (nt !== 'road' && nt !== 'yard') return nt;
        }
        return 'pasture';
    };
    const tileT = new Uint8Array(COLS * ROWS);
    for (let ty = 0; ty < ROWS; ty++) {
        for (let tx = 0; tx < COLS; tx++) {
            let t = paintType(Game.terrain[ty][tx].type);
            if (t === 'road') t = fieldUnderRoad(tx, ty);
            tileT[ty * COLS + tx] = idxFor(t);
        }
    }

    // Contiguous same-type regions (flood fill) → per-field tint + row layout.
    const regionTile = new Int32Array(COLS * ROWS).fill(-1);
    const regions = [];
    const queue = new Int32Array(COLS * ROWS);
    for (let seed = 0; seed < COLS * ROWS; seed++) {
        if (regionTile[seed] >= 0) continue;
        const id = regions.length;
        const t = tileT[seed];
        let head = 0, tail = 0;
        queue[tail++] = seed; regionTile[seed] = id;
        let x0 = COLS, x1 = 0, y0 = ROWS, y1 = 0;
        while (head < tail) {
            const cur = queue[head++];
            const cx = cur % COLS, cy = (cur / COLS) | 0;
            if (cx < x0) x0 = cx; if (cx > x1) x1 = cx;
            if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
            if (cx > 0 && regionTile[cur - 1] < 0 && tileT[cur - 1] === t) { regionTile[cur - 1] = id; queue[tail++] = cur - 1; }
            if (cx < COLS - 1 && regionTile[cur + 1] < 0 && tileT[cur + 1] === t) { regionTile[cur + 1] = id; queue[tail++] = cur + 1; }
            if (cy > 0 && regionTile[cur - COLS] < 0 && tileT[cur - COLS] === t) { regionTile[cur - COLS] = id; queue[tail++] = cur - COLS; }
            if (cy < ROWS - 1 && regionTile[cur + COLS] < 0 && tileT[cur + COLS] === t) { regionTile[cur + COLS] = id; queue[tail++] = cur + COLS; }
        }
        const name = typeNames[t];
        const flat = name === 'yard';
        const woods = name === 'forest' || name === 'dense_forest';
        // Rows run along the field's long axis, with a small organic skew.
        const angle = ((x1 - x0) >= (y1 - y0) ? 0 : Math.PI / 2) + Game.rand(-0.12, 0.12);
        const bAmp = flat ? 0 : tintAmp * (woods ? 0.5 : 1);
        const bright = 1 + Game.rand(-bAmp, bAmp);
        const warm = flat ? 0 : Game.rand(-0.05, 0.05) * (woods ? 0.5 : 1);
        regions.push({
            tr: bright * (1 + warm), tg: bright * (1 + warm * 0.35), tb: bright * (1 - warm),
            rx: -Math.sin(angle), ry: Math.cos(angle), phase: Game.rand(0, 64),
            area: tail,   // tiles in this region (dividers key wall styles off the enclosed plot)
        });
    }

    // Noise lattices sampled bilinearly per texel (full-res fbm would be slow):
    // two boundary-warp channels + a low/high-frequency detail pair, plus the
    // straight/rough mask that decides WHERE joins get to wander.
    const L = 4;
    const LW = ((W / L) | 0) + 2, LH = ((H / L) | 0) + 2;
    const latU = new Float32Array(LW * LH), latV = new Float32Array(LW * LH);
    const latLo = new Float32Array(LW * LH), latHi = new Float32Array(LW * LH);
    const latR = new Float32Array(LW * LH);
    for (let ly = 0; ly < LH; ly++) {
        const gy = ly * L / px;
        for (let lx = 0; lx < LW; lx++) {
            const gx = lx * L / px;
            const i = ly * LW + lx;
            latU[i] = (Game._fbm2(gx * 0.35 + 7.7, gy * 0.35 - 3.1) - 0.5) * 2;
            latV[i] = (Game._fbm2(gx * 0.35 - 15.3, gy * 0.35 + 11.9) - 0.5) * 2;
            latLo[i] = Game._fbm2(gx * 0.4, gy * 0.4);
            latHi[i] = Game._fbm2(gx * 0.9 + 31.7, gy * 0.9 - 12.3);
            // very-low-frequency zoning noise (~20+ tile patches)
            latR[i] = Game._fbm2(gx * 0.05 + 57.1, gy * 0.05 + 23.7);
        }
    }
    // Threshold the zoning noise at its (1 - roughShare) quantile, so exactly
    // ~roughShare of the map goes organic and the rest stays surveyed-straight
    // (with just a hint of fine raggedness so it isn't pixel-perfect).
    {
        const sorted = Float32Array.from(latR).sort();
        const thr = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * (1 - roughShare)))];
        const sm = (a, b, x) => { const t2 = Game.clamp((x - a) / (b - a), 0, 1); return t2 * t2 * (3 - 2 * t2); };
        for (let i = 0; i < LW * LH; i++) {
            const r01 = roughShare >= 1 ? 1 : roughShare <= 0 ? 0 : sm(thr - 0.035, thr + 0.035, latR[i]);
            latR[i] = r01;
            const big = warpAmp * (0.14 + 0.86 * r01);
            const fine = fineAmp * (0.4 + 0.6 * r01);
            latU[i] = latU[i] * big + (Game._fbm2((i % LW) * L / px * 1.9 - 13.7, ((i / LW) | 0) * L / px * 1.9 + 9.2) - 0.5) * 2 * fine;
            latV[i] = latV[i] * big + (Game._fbm2((i % LW) * L / px * 1.9 + 4.1, ((i / LW) | 0) * L / px * 1.9 - 6.6) - 0.5) * 2 * fine;
        }
    }
    const lat = (arr, x, y) => {
        const u = x / L, v = y / L;
        const ux = u | 0, vy = v | 0;
        const fx = u - ux, fy = v - vy;
        const i = vy * LW + ux;
        const a = arr[i], b = arr[i + 1], c = arr[i + LW], d = arr[i + LW + 1];
        return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
    };

    // Per-texel classification through the warped lookup.
    const typeIdx = new Uint8Array(W * H);
    const regionIdx = new Int32Array(W * H);
    // River shoreline: reclassify texels near the water off the smooth ribbon
    // mask (same jittered signed distance as the surface/bed) so the banks
    // meander instead of stair-stepping tile by tile.
    const TT = Game.TILE;
    const isWater = new Uint8Array(COLS * ROWS);
    let rivY0 = -1, rivY1 = -1;
    if (Game.river && Game.river.tiles.length >= 8 && Game._waterRibbonAt) {
        Game.river.tiles.forEach(({ tx, ty }) => {
            if (tx >= 0 && ty >= 0 && tx < COLS && ty < ROWS) isWater[ty * COLS + tx] = 1;
        });
        rivY0 = Math.max(0, (Game.river.minZ - 4) * px);
        rivY1 = Math.min(H, (Game.river.maxZ + 5) * px);
    }
    const mudIdx = typeIndexOf['mud'];
    const washIdx = idxFor('wash');   // paint-only: gravel shingle straddling the waterline
    const grassIdx = idxFor('grass');
    // row crops stop short of the bank — a riparian meadow strip runs along the
    // river (ploughing to the waterline loses the crop to every flood)
    const CROP_ROW = new Set(['wheat', 'stubble', 'plowed', 'vineyard', 'garden'].map(n => typeIndexOf[n]).filter(v => v !== undefined));
    Game._edOvMap = (Game.EDITOR_TYPES || []).map(t => typeIndexOf[t] ?? typeIndexOf.grass ?? 0);
    const bankW = TT * 0.55;   // muddy bank strip beyond the waterline (mean width, wanders)
    const jitAmp = (Game.WATER_SHORE_JITTER || 0.25) * TT * 2;
    for (let y = 0; y < H; y++) {
        const inBand = y >= rivY0 && y < rivY1;
        for (let x = 0; x < W; x++) {
            const i = y * W + x;
            // Map maker freeform brush: texel-resolution override wins over
            // tile classification (255 = untouched)
            if (Game._terrainPaintOverride && Game._terrainPaintOverride[i] !== 255 && Game._edOvMap) {
                let otx = ((x + 0.5) / px) | 0, oty = ((y + 0.5) / px) | 0;
                if (otx >= COLS) otx = COLS - 1;
                if (oty >= ROWS) oty = ROWS - 1;
                typeIdx[i] = Game._edOvMap[Game._terrainPaintOverride[i]];
                regionIdx[i] = regionTile[oty * COLS + otx];
                continue;
            }
            let tx = ((x + 0.5) / px + lat(latU, x, y)) | 0;
            let ty = ((y + 0.5) / px + lat(latV, x, y)) | 0;
            if (tx < 0) tx = 0; else if (tx >= COLS) tx = COLS - 1;
            if (ty < 0) ty = 0; else if (ty >= ROWS) ty = ROWS - 1;
            let tI = ty * COLS + tx;
            if (inBand && mudIdx !== undefined) {
                const wx = (x + 0.5) / px * TT, wz = (y + 0.5) / px * TT;
                const rib = Game._waterRibbonAt(wx, wz);
                if (rib) {
                    // same jitter as _waterEdgeAlphaAt so bed, bank and surface agree
                    const signed = rib.signed
                        + (Game._fbm2(wx * 0.055 + 19.3, wz * 0.055 - 7.1) - 0.5) * jitAmp;
                    // bank width wanders; gravel-wash bars replace mud in patches
                    const bankWv = bankW * (0.55 + 1.1 * Game._fbm2(wx * 0.024 - 55.1, wz * 0.024 + 12.9));
                    const wash = Game._waterWashAt ? Game._waterWashAt(wx, wz, rib, signed) : 0;
                    if (wash > 0 || signed > -bankWv) {
                        // dither the outer edge into the field so the bank
                        // feathers out instead of ending on a hard painted line
                        const edge01 = Game.clamp((signed + bankWv) / (bankWv * 0.5), 0, 1);
                        if (wash > 0 || edge01 >= 1 || Game._hash2(x * 1.31 + 7.7, y * 2.17 - 3.3) < edge01) {
                            // inside the meandering bed/bank: mud, or shingle where washed
                            const czTy = Game.clamp((rib.centerZ / TT) | 0, 0, ROWS - 1);
                            const cI = czTy * COLS + tx;
                            typeIdx[i] = (wash > 0 && signed < TT * 0.18) ? washIdx : mudIdx;
                            regionIdx[i] = regionTile[isWater[cI] ? cI : tI];
                            continue;
                        }
                        // dithered out: falls through as field (grass strip below)
                    }
                    if (isWater[tI]) {
                        // water tile beyond the smooth bank: hand the texel to
                        // the field on this side so crops run up to the bank
                        const dir = wz >= rib.centerZ ? 1 : -1;
                        for (let s = 1; s <= 6; s++) {
                            const nty = ty + dir * s;
                            if (nty < 0 || nty >= ROWS) break;
                            const nI = nty * COLS + tx;
                            if (!isWater[nI]) { tI = nI; break; }
                        }
                    }
                    // riparian meadow: row crops give way to grass on the
                    // floodplain strip. Width pinches and bulges (pow-skewed
                    // noise) and the outer edge dithers into the crop rows so
                    // the strip doesn't read as a uniform green ribbon.
                    const greenN = Game._fbm2(wx * 0.055 + 5.5, wz * 0.055 - 44.2);
                    const greenW = TT * (0.8 + 2.6 * Math.pow(greenN, 1.6));
                    if (signed > -greenW && CROP_ROW.has(tileT[tI])) {
                        const g01 = Game.clamp((signed + greenW) / (TT * 0.9), 0, 1);
                        if (g01 >= 1 || Game._hash2(x * 1.71 - 4.9, y * 1.13 + 8.8) < g01) {
                            typeIdx[i] = grassIdx;
                            regionIdx[i] = regionTile[tI];
                            continue;
                        }
                    }
                }
            }
            typeIdx[i] = tileT[tI];
            regionIdx[i] = regionTile[tI];
        }
    }

    Game._terrainPaint = {
        W, H, px, warpAmp, fineAmp, tintAmp, roughShare,
        typeNames, typeIdx, regionIdx, regions, regionTile,
        lo: (x, y) => lat(latLo, x, y),
        hi: (x, y) => lat(latHi, x, y),
        rough: (x, y) => lat(latR, x, y),   // 0 = straight zone, 1 = organic zone
    };
    return Game._terrainPaint;
};

// Rebuild the terrain colour texture and swap it onto the terrain material (used
// by the road-gravel debug sliders so scale/opacity changes apply live).
Game.rebuildTerrainTexture = () => {
    if (!Game.terrainMesh || !Game.terrainMesh.material) return;
    const t = Game.buildTerrainTexture();
    const mat = Game.terrainMesh.material;
    const old = mat.map;
    mat.map = t;
    mat.needsUpdate = true;
    if (old && old !== t) old.dispose();
};

Game.buildTerrainTexture = () => {
    const THREE = Game.THREE;
    const px = Game.TERRAIN_TEXELS_PER_TILE || 20;
    const W = Game.MAP_COLS * px;
    const H = Game.MAP_ROWS * px;
    Game._terrainPaintDims = { W, H, px };
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
        if (t === 'water') return 'mud';
        return t;
    };

    // 1. Base ground through the warped per-texel classification (see
    //    _getTerrainPaint): joins between field types wander organically
    //    instead of tracing the tile grid, each contiguous field gets its own
    //    tint, and cultivation rows run per-field (not per 4-tile block).
    //    Roads paint their surrounding field as base; the road itself is drawn
    //    afterwards as a smooth corridor so diagonals don't staircase.
    const paint = Game._getTerrainPaint();
    {
        const img0 = ctx.createImageData(W, H);
        const d0 = img0.data;
        const names = paint.typeNames;
        const lut = names.map(n => { const hex = colOf(n); return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]; });
        const GAP = { plowed: 3, vineyard: 3, garden: 3, wheat: 4, stubble: 4 };
        const AMP = { plowed: 0.30, vineyard: 0.34, garden: 0.26, wheat: 0.16, stubble: 0.14 };
        const rowGap = names.map(n => GAP[n] || 0);
        const rowAmp = names.map(n => AMP[n] || 0);
        const woods = names.map(n => n === 'forest' || n === 'dense_forest');
        const flat = names.map(n => n === 'yard');
        const washT = names.map(n => n === 'wash');
        const TAU = Math.PI * 2;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const i = y * W + x;
                const ti = paint.typeIdx[i];
                const reg = paint.regions[paint.regionIdx[i]];
                const c = lut[ti];
                let r = c[0] * reg.tr, g = c[1] * reg.tg, b = c[2] * reg.tb;
                let f = flat[ti] ? 1 : 1 + (paint.lo(x, y) - 0.5) * 0.12;
                const gap = rowGap[ti];
                if (gap) {
                    // Straight cultivation rows along the field's long axis; they
                    // stop at the warped field edge because the classification does.
                    const rc = (x * reg.rx + y * reg.ry + reg.phase) * TAU / gap;
                    const s = 0.5 + 0.5 * Math.sin(rc);
                    f *= (1 - rowAmp[ti] * s * s) * (1 + 0.045 * Math.sin(rc / 5.3));
                } else if (woods[ti]) {
                    // clumpy canopy mottling instead of random squares
                    f *= 1 - 0.26 * Math.max(0, paint.hi(x, y) - 0.45) * (1 / 0.55);
                } else if (washT[ti]) {
                    // coarse two-tone shingle contrast on gravel-wash bars
                    f *= 0.8 + 0.45 * paint.hi(x, y);
                }
                r *= f; g *= f; b *= f;
                const o = i * 4;
                d0[o] = r < 0 ? 0 : r > 255 ? 255 : r;
                d0[o + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
                d0[o + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
                d0[o + 3] = 255;
            }
        }

        // 2. Boundary seam: a soft dark groove + faint highlight lip along every
        //    join. The joins are wavy now, so the groove reads as a natural field
        //    margin instead of outlining the tile grid. Tunable via
        //    Game.TERRAIN_SEAM_DEPTH.
        const seamA = Game.TERRAIN_SEAM_DEPTH != null ? Game.TERRAIN_SEAM_DEPTH : 0.22;
        if (seamA > 0.001) {
            // no hard outline around the village square, and none along the
            // river bank (the mud/wash band feathers into the fields instead)
            const skip = names.map(n => n === 'yard' || n === 'mud' || n === 'wash');
            const darken = (o, a) => {
                d0[o] += (28 - d0[o]) * a;
                d0[o + 1] += (22 - d0[o + 1]) * a;
                d0[o + 2] += (15 - d0[o + 2]) * a;
            };
            const lighten = (o, a) => {
                d0[o] += (255 - d0[o]) * a;
                d0[o + 1] += (250 - d0[o + 1]) * a;
                d0[o + 2] += (235 - d0[o + 2]) * a;
            };
            const T = paint.typeIdx;
            for (let y = 1; y < H; y++) {
                for (let x = 1; x < W; x++) {
                    const i = y * W + x;
                    const t = T[i];
                    if (T[i - 1] !== t && !skip[t] && !skip[T[i - 1]]) {
                        darken(i * 4, seamA * 0.55); darken((i - 1) * 4, seamA * 0.5);
                        if (x + 1 < W) lighten((i + 1) * 4, seamA * 0.15);
                    }
                    if (T[i - W] !== t && !skip[t] && !skip[T[i - W]]) {
                        darken(i * 4, seamA * 0.55); darken((i - W) * 4, seamA * 0.5);
                        if (y + 1 < H) lighten((i + W) * 4, seamA * 0.15);
                    }
                }
            }
        }
        ctx.putImageData(img0, 0, 0);

        // 2.5 Pebble speckle on the gravel-wash bars: light/dark shingle dots so
        //     the bars read stony at close zoom, not just a pale strip.
        const washI = names.indexOf('wash');
        if (washI >= 0) {
            const pebbles = ['#b7ae95', '#8d8672', '#635c4d', '#a29a83'];
            for (let y = 0; y < H; y += 2) {
                for (let x = 0; x < W; x += 2) {
                    if (paint.typeIdx[y * W + x] !== washI || Math.random() > 0.16) continue;
                    ctx.fillStyle = pebbles[Game.randi(0, pebbles.length - 1)];
                    ctx.globalAlpha = Game.rand(0.35, 0.8);
                    const s = Game.rand(0.8, 2.0);
                    ctx.fillRect(x + Game.rand(-1, 1), y + Game.rand(-1, 1), s, s);
                }
            }
            ctx.globalAlpha = 1;
        }
    }

    // 3. Per-type interior detail (rows, furrows and canopy mottling moved into
    //    the per-texel pass above; what's left here are localized speckles).
    for (let ty = 0; ty < Game.MAP_ROWS; ty++) {
        for (let tx = 0; tx < Game.MAP_COLS; tx++) {
            const type = Game.terrain[ty][tx].type;
            const x0 = tx * px, y0 = ty * px;
            if (type === 'road') {
                // Road texture is drawn later as a smooth corridor (see below), not
                // per square tile — skip here so diagonals don't staircase.
                continue;
            } else if (type === 'mud') {
                for (let k = 0; k < 3; k++) {
                    ctx.fillStyle = `rgba(30,24,18,${Game.rand(0.08, 0.2)})`;
                    const s = Game.rand(2, 6);
                    ctx.fillRect(x0 + Game.rand(0, px - s), y0 + Game.rand(0, px - s), s, s);
                }
                for (let k = 0; k < 2; k++) {
                    fillCircle(x0 + Game.rand(2, px - 2), y0 + Game.rand(2, px - 2), Game.rand(1.6, 4.0), `rgba(42,38,31,${Game.rand(0.16, 0.28)})`);
                }
            } else if (type === 'yard' || type === 'house' || type === 'wall') {
                // Cobbled village ground: sett stones on a jittered grid
                // anchored to GLOBAL texel coords (not the tile), so the
                // pattern runs seamlessly across tile borders. Worn patches
                // (fbm mask) let the dust base show through, and the dust
                // also reads as the joints between stones. House footprints
                // cobble too — buildings sit on top in-game, and reference
                // captures need the whole town to read as paved.
                const pitch = px * 0.3;
                const i0 = Math.floor(x0 / pitch), i1 = Math.ceil((x0 + px) / pitch);
                const j0 = Math.floor(y0 / pitch), j1 = Math.ceil((y0 + px) / pitch);
                for (let j = j0; j <= j1; j++) {
                    for (let i = i0; i <= i1; i++) {
                        // deterministic per-stone hash: border stones come out
                        // identical when the neighbouring tile draws them again
                        const h1 = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
                        const r1 = h1 - Math.floor(h1);
                        const h2 = Math.sin(i * 269.5 + j * 183.3) * 28001.83;
                        const r2 = h2 - Math.floor(h2);
                        if (Game._fbm2(i * 0.5, j * 0.5) < 0.34) continue;   // worn to dust
                        const cx = (i + 0.5 + (r1 - 0.5) * 0.55) * pitch;
                        const cy = (j + 0.5 + (r2 - 0.5) * 0.55) * pitch;
                        if (cx < x0 - 1 || cx > x0 + px + 1 || cy < y0 - 1 || cy > y0 + px + 1) continue;
                        // grey granite setts with the odd limestone-beige one
                        const g = 116 + Math.round(r2 * 42);
                        const beige = r1 > 0.82;
                        fillCircle(cx, cy, pitch * (0.34 + r1 * 0.1),
                            beige ? `rgb(${g + 26},${g + 16},${g - 4})` : `rgb(${g},${g - 3},${g - 12})`);
                    }
                }
                for (let k = 0; k < 3; k++) {
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

    // 3.5 Grass fringe painted into the GROUND: a soft green grassy band over every
    //     road-edge seam so the shoulders read as grass-covered at any zoom (thin 3D
    //     blades alone look like sticks from the RTS camera). Biased onto the terrain
    //     side, spilling slightly onto the road. Density via Game.TERRAIN_FRINGE.
    {
        const SOFT = new Set(['grass', 'pasture', 'wheat', 'stubble', 'plowed', 'vineyard', 'garden', 'orchard', 'forest', 'dense_forest', 'hedge']);
        const greens = [[96, 120, 58], [74, 100, 46], [110, 132, 70], [60, 84, 38], [86, 112, 52]];
        const dens = Game.TERRAIN_FRINGE != null ? Game.TERRAIN_FRINGE : 1.6;
        for (let ty = 0; ty < Game.MAP_ROWS; ty++) {
            for (let tx = 0; tx < Game.MAP_COLS; tx++) {
                if (Game.terrain[ty][tx].type !== 'road') continue;
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nt = Game.getTile(tx + dx, ty + dy);
                    if (!nt || !SOFT.has(nt.type)) continue;
                    const vert = dx !== 0;
                    const edgePos = vert ? (tx + (dx > 0 ? 1 : 0)) * px : (ty + (dy > 0 ? 1 : 0)) * px;
                    const base = vert ? ty * px : tx * px;
                    const tufts = Math.max(4, Math.round(px * dens));
                    for (let k = 0; k < tufts; k++) {
                        const along = base + ((k + Game.rand(0, 1)) / tufts) * px;
                        const perp = edgePos + Game.rand(-0.16, 0.24) * px * (vert ? dx : dy);
                        const gx = vert ? perp : along;
                        const gy = vert ? along : perp;
                        const g = greens[Game.randi(0, greens.length - 1)];
                        const a = Game.rand(0.32, 0.6);
                        fillCircle(gx, gy, Game.rand(0.7, 1.7), `rgba(${g[0]},${g[1]},${g[2]},${a})`);
                        if (Math.random() < 0.3) fillCircle(gx + Game.rand(-1, 1), gy + Game.rand(-1, 1), Game.rand(0.3, 0.7), 'rgba(40,60,26,0.4)');
                    }
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

    // 5. Soft waterbed tint. The terrain texture underneath the transparent
    // surface uses the same rounded shoreline mask as the mesh, so tile corners
    // do not show through as square blue blocks.
    let minWaterTx = Game.MAP_COLS, minWaterTy = Game.MAP_ROWS;
    let maxWaterTx = -1, maxWaterTy = -1;
    for (let ty = 0; ty < Game.MAP_ROWS; ty++) {
        for (let tx = 0; tx < Game.MAP_COLS; tx++) {
            if (!Game._isWaterSurfaceTile(tx, ty)) continue;
            minWaterTx = Math.min(minWaterTx, tx);
            minWaterTy = Math.min(minWaterTy, ty);
            maxWaterTx = Math.max(maxWaterTx, tx);
            maxWaterTy = Math.max(maxWaterTy, ty);
        }
    }
    if (maxWaterTx >= minWaterTx && Game._waterEdgeAlphaAt) {
        const pad = 2;
        const ix0 = Math.max(0, (minWaterTx - pad) * px);
        const iy0 = Math.max(0, (minWaterTy - pad) * px);
        const ix1 = Math.min(W, (maxWaterTx + pad + 1) * px);
        const iy1 = Math.min(H, (maxWaterTy + pad + 1) * px);
        const waterImg = ctx.getImageData(ix0, iy0, ix1 - ix0, iy1 - iy0);
        const data = waterImg.data;
        const shallow = [80, 103, 101];
        const deep = [36, 65, 78];

        const wet = [70, 56, 40];   // saturated dark mud right at the waterline
        for (let py = 0; py < waterImg.height; py++) {
            for (let pxl = 0; pxl < waterImg.width; pxl++) {
                const wx = ((ix0 + pxl + 0.5) / px) * Game.TILE;
                const wz = ((iy0 + py + 0.5) / px) * Game.TILE;
                const edge = Game._waterEdgeAlphaAt(wx, wz);
                const i = (py * waterImg.width + pxl) * 4;
                if (edge <= 0.002) {
                    // above the waterline: a moisture gradient darkens the bank
                    // toward the water so mud, shingle and grass blend into one
                    // damp shore instead of meeting on painted lines
                    const rib = Game._waterRibbonAt ? Game._waterRibbonAt(wx, wz) : null;
                    let signed;
                    if (rib) {
                        signed = Game._waterSignedJittered(wx, wz, rib);
                    } else {
                        // pond banks get the same damp ring, off the pond mask;
                        // hand-painted water falls back to tile signed distance
                        const pond = Game._pondAt ? Game._pondAt(wx, wz) : null;
                        if (pond) {
                            signed = Game._waterSignedJittered(wx, wz, pond);
                        } else {
                            signed = Game._waterSignedDistance ? Game._waterSignedDistance(wx, wz) : -Infinity;
                            if (!Number.isFinite(signed)) continue;
                        }
                    }
                    const reach = Game.TILE * (1.05 + 0.85 * Game._fbm2(wx * 0.05 + 8.8, wz * 0.05 + 61.2));
                    if (signed <= -reach || signed > 0) continue;
                    const a = Math.pow(1 + signed / reach, 1.7) * 0.5;
                    data[i] = Game.clamp(Math.round(Game.lerp(data[i], wet[0], a)), 0, 255);
                    data[i + 1] = Game.clamp(Math.round(Game.lerp(data[i + 1], wet[1], a)), 0, 255);
                    data[i + 2] = Game.clamp(Math.round(Game.lerp(data[i + 2], wet[2], a)), 0, 255);
                    continue;
                }
                const depth = Game._waterDepth01At ? Game._waterDepth01At(wx, wz) : edge;
                const fleck = Game._fbm2 ? (Game._fbm2(wx * 0.32 + 5.1, wz * 0.32 - 2.4) - 0.5) * 16 : 0;
                const blend = edge * (0.58 + depth * 0.22);
                const tr = shallow[0] + (deep[0] - shallow[0]) * depth + fleck;
                const tg = shallow[1] + (deep[1] - shallow[1]) * depth + fleck * 0.6;
                const tb = shallow[2] + (deep[2] - shallow[2]) * depth + fleck * 0.45;
                data[i] = Game.clamp(Math.round(Game.lerp(data[i], tr, blend)), 0, 255);
                data[i + 1] = Game.clamp(Math.round(Game.lerp(data[i + 1], tg, blend)), 0, 255);
                data[i + 2] = Game.clamp(Math.round(Game.lerp(data[i + 2], tb, blend)), 0, 255);
            }
        }
        ctx.putImageData(waterImg, ix0, iy0);
    }

    // 6. Per-pixel grain
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

    // ── Road drawn as a smooth CORRIDOR, not square tiles ───────────────────────
    // Roads sit on the grid, so a diagonal run is a staircase of squares. Instead we
    // stroke the road GRAPH — each road tile centre linked to its 8-connected road
    // neighbours — with wide round joins, turning the staircase into a natural band.
    // Gravel + tyre tracks are clipped to that corridor with 'source-atop', and the
    // tracks follow each segment's direction (diagonals included).
    {
        const isRoad = (x, y) => { const t = Game.getTile(x, y); return t && paintType(t.type) === 'road'; };
        const CX = tx => tx * px + px / 2, CY = ty => ty * px + px / 2;
        const links = [];        // [x1,y1,x2,y2] centre-to-centre segments (each drawn once)
        const isolated = [];     // road tiles with no road neighbour at all
        for (let ty = 0; ty < Game.MAP_ROWS; ty++) {
            for (let tx = 0; tx < Game.MAP_COLS; tx++) {
                if (!isRoad(tx, ty)) continue;
                let neigh = 0;
                for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
                    if (isRoad(tx + dx, ty + dy)) { links.push([CX(tx), CY(ty), CX(tx + dx), CY(ty + dy)]); neigh++; }
                }
                for (const [dx, dy] of [[-1, 0], [0, -1], [-1, -1], [-1, 1]]) if (isRoad(tx + dx, ty + dy)) neigh++;
                if (neigh === 0) isolated.push([CX(tx), CY(ty)]);
            }
        }
        if (links.length || isolated.length) {
            const rcv = document.createElement('canvas'); rcv.width = W; rcv.height = H;
            const rc = rcv.getContext('2d');

            // 1. Base corridor in road colour (round joins smooth the diagonals).
            rc.strokeStyle = rgb(colOf('road'));
            rc.fillStyle = rc.strokeStyle;
            rc.lineWidth = px * 1.04;
            rc.lineCap = 'round';
            rc.lineJoin = 'round';
            rc.beginPath();
            for (const [x1, y1, x2, y2] of links) { rc.moveTo(x1, y1); rc.lineTo(x2, y2); }
            rc.stroke();
            for (const [x, y] of isolated) { rc.beginPath(); rc.arc(x, y, px * 0.52, 0, Math.PI * 2); rc.fill(); }

            // 2. Seamless gravel, clipped to the corridor via 'source-atop'.
            const gsrc = Game._roadGravelImg || (Game._makeGravelTexture ? Game._makeGravelTexture() : null);
            if (gsrc) {
                const pat = rc.createPattern(gsrc, 'repeat');
                if (pat) {
                    if (pat.setTransform) {
                        const s = (px * (Game.ROAD_GRAVEL_TILES || 2.5)) / (gsrc.width || 256);
                        try { const m = new DOMMatrix(); m.a = s; m.d = s; pat.setTransform(m); } catch (e) { /* native scale */ }
                    }
                    rc.save();
                    rc.globalCompositeOperation = 'source-atop';
                    rc.globalAlpha = Game._roadGravelImg ? (Game.ROAD_GRAVEL_ALPHA != null ? Game.ROAD_GRAVEL_ALPHA : 0.92) : 0.8;
                    rc.fillStyle = pat;
                    rc.fillRect(0, 0, W, H);
                    rc.restore();
                }
            }

            // 3. Tyre tracks: two wheel lanes + darker ruts, offset perpendicular to
            //    each segment so they follow the road direction (diagonals included).
            //    One stroke() per pass so overlapping segments don't compound alpha.
            const off = px * 0.22;
            const laneLines = () => {
                rc.beginPath();
                for (const [x1, y1, x2, y2] of links) {
                    let dx = x2 - x1, dy = y2 - y1; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
                    const nx = -dy * off, ny = dx * off;
                    rc.moveTo(x1 + nx, y1 + ny); rc.lineTo(x2 + nx, y2 + ny);
                    rc.moveTo(x1 - nx, y1 - ny); rc.lineTo(x2 - nx, y2 - ny);
                }
            };
            rc.save();
            rc.globalCompositeOperation = 'source-atop';
            rc.lineCap = 'round';
            laneLines(); rc.globalAlpha = 0.20; rc.lineWidth = px * 0.17; rc.strokeStyle = 'rgb(220,207,174)'; rc.stroke();  // compacted lighter lanes
            laneLines(); rc.globalAlpha = 0.24; rc.lineWidth = 2; rc.strokeStyle = 'rgb(64,50,34)'; rc.stroke();            // darker ruts
            rc.restore();

            ctx.drawImage(rcv, 0, 0);
        }

        // Ensure the seamless gravel photo is loaded + cached; rebuild once when ready.
        if (!Game._roadGravelImg && !Game._roadGravelLoading) {
            Game._roadGravelLoading = true;
            const gimg = new Image();
            gimg.onload = () => {
                Game._roadGravelImg = Game._prepareRoadGravel ? Game._prepareRoadGravel(gimg) : gimg;
                Game._roadGravelLoading = false;
                if (Game.rebuildTerrainTexture) Game.rebuildTerrainTexture();
                console.log('road gravel photo applied (seamless)');
            };
            gimg.onerror = () => { Game._roadGravelLoading = false; };
            gimg.src = 'textures/dirt_gravel_road.jpg?v=3';
        }
    }

    return tex;
};

Game.buildTerrainMaterialMaps = () => {
    const THREE = Game.THREE;
    const paint = Game._getTerrainPaint();
    const px = paint.px;
    const W = paint.W;
    const H = paint.H;
    const roughCanvas = document.createElement('canvas');
    const aoCanvas = document.createElement('canvas');
    roughCanvas.width = aoCanvas.width = W;
    roughCanvas.height = aoCanvas.height = H;
    const rctx = roughCanvas.getContext('2d');
    const actx = aoCanvas.getContext('2d');

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
        water: [72, 255], swamp: [136, 150], wash: [226, 208],
    };

    // Base roughness/AO follow the same warped classification as the colour map
    // (so the material transition lands on the same wavy join), EXCEPT hard or
    // structural surfaces, which keep their exact tile footprint: road roughness
    // under the painted corridor, dark hedge bases, water sheen, walls/houses.
    {
        const HARD = { road: 1, yard: 1, house: 1, wall: 1, hedge: 1, swamp: 1 };
        const matByIdx = paint.typeNames.map(n => mat[n] || mat.grass);
        const GAP = { plowed: 3, vineyard: 3, garden: 3, wheat: 4, stubble: 4 };
        const rowGap = paint.typeNames.map(n => GAP[n] || 0);
        const woods = paint.typeNames.map(n => n === 'forest' || n === 'dense_forest');
        const rImg = rctx.createImageData(W, H);
        const aImg = actx.createImageData(W, H);
        const rd = rImg.data, ad = aImg.data;
        const TAU = Math.PI * 2;
        // Water sheen follows the smooth shoreline mask, not the tile grid
        // (water is no longer in HARD — the raw footprint stair-stepped).
        const T = Game.TILE;
        let wY0 = -1, wY1 = -1;
        if (Game.river && Game.river.tiles.length && Game._waterEdgeAlphaAt) {
            wY0 = Math.max(0, (Game.river.minZ - 3) * px);
            wY1 = Math.min(H, (Game.river.maxZ + 4) * px);
        }
        for (let y = 0; y < H; y++) {
            const rty = (y / px) | 0;
            const row = Game.terrain[rty];
            const inWaterBand = y >= wY0 && y < wY1;
            for (let x = 0; x < W; x++) {
                const i = y * W + x;
                const raw = row[(x / px) | 0].type;
                const ti = paint.typeIdx[i];
                let rough, ao;
                if (HARD[raw]) {
                    const m = mat[raw] || mat.grass;
                    rough = m[0]; ao = m[1];
                } else {
                    const m = matByIdx[ti];
                    rough = m[0]; ao = m[1];
                    const gap = rowGap[ti];
                    if (gap) {
                        const reg = paint.regions[paint.regionIdx[i]];
                        const s = 0.5 + 0.5 * Math.sin((x * reg.rx + y * reg.ry + reg.phase) * TAU / gap);
                        ao -= 26 * s * s;
                        rough += 10 * (s * s - 0.5);
                    } else if (woods[ti]) {
                        ao -= 34 * Math.max(0, paint.hi(x, y) - 0.45) * (1 / 0.55);
                    }
                    // soft occlusion inside the boundary groove (matches the colour seam)
                    if ((x > 0 && paint.typeIdx[i - 1] !== ti) || (y > 0 && paint.typeIdx[i - W] !== ti)) ao -= 18;
                }
                if (inWaterBand) {
                    const a = Game._waterEdgeAlphaAt((x + 0.5) / px * T, (y + 0.5) / px * T);
                    if (a > 0.004) {
                        rough += (mat.water[0] - rough) * a;
                        ao += (mat.water[1] - ao) * a;
                    }
                }
                const o = i * 4;
                rd[o] = rd[o + 1] = rd[o + 2] = rough < 0 ? 0 : rough > 255 ? 255 : rough;
                rd[o + 3] = 255;
                ad[o] = ad[o + 1] = ad[o + 2] = ao < 0 ? 0 : ao > 255 ? 255 : ao;
                ad[o + 3] = 255;
            }
        }
        rctx.putImageData(rImg, 0, 0);
        actx.putImageData(aImg, 0, 0);
    }

    // Localized wear/pothole spots on hard and wet surfaces.
    for (let ty = 0; ty < Game.MAP_ROWS; ty++) {
        for (let tx = 0; tx < Game.MAP_COLS; tx++) {
            const type = Game.terrain[ty][tx].type;
            const x0 = tx * px, y0 = ty * px;
            if (type === 'road' || type === 'yard') {
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
            } else if (type === 'orchard') {
                for (let k = 0; k < 5; k++) {
                    fillCircle(actx, x0 + Game.rand(0, px), y0 + Game.rand(0, px), Game.rand(1.5, 4), 'rgba(28,28,28,0.16)');
                }
            }
        }
    }

    // (Boundary occlusion now follows the warped joins — painted in the
    // per-texel pass above — instead of stroking straight tile-grid lines.)

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
//  FIELD DIVIDERS — stone walls + wood farm fences on field joins
// ═══════════════════════════════════════════════════════
// Placement strategy (aerial-photo realism): dividers go only along
// straight-ish joins (the rough/organic zones of the edge mask get none —
// nobody builds a fence on a wandering boundary), stone walls cluster near the
// village and around garden/orchard/vineyard plots, wooden stock fences ring
// pasture and crops further out. Runs are partial with gateway gaps, and never
// duplicate an existing hedgerow (hedges occupy the border tile itself, so a
// hedge line simply breaks the field-field adjacency).
// Gameplay: cosmetic obstacles — infantry step/climb over freely; tanks crush
// them flat via the shared knock-down animator (Game.foliageKD).
Game.DIVIDER_MODELS = {
    wall: [
        'models/dividers/stone_wall_1.glb',
        'models/dividers/stone_wall_2.glb',
        'models/dividers/stone_wall_3.glb',
        'models/dividers/stone_wall_small.glb',
    ],
    fence: ['models/dividers/wood_fence.glb'],
};
Game.DIVIDER_RUN_CHANCE = 0.9;   // share of eligible boundary runs that get a divider

Game._addFieldDividers = () => {
    const THREE = Game.THREE;
    const T = Game.TILE;
    const COLS = Game.MAP_COLS, ROWS = Game.MAP_ROWS;
    if (!Game.gltfLoader) return;
    const paint = Game._getTerrainPaint ? Game._getTerrainPaint() : null;
    const FIELD = new Set(Game.FIELD_TYPES);
    const typeAt = (x, y) => { const r = Game.terrain[y]; return r && r[x] ? r[x].type : null; };
    // Two eligible boundary classes: field-to-field joins, and yard perimeters
    // (farmstead / village-square edges get deliberate stone walls).
    const eligible = (a, b) => {
        if (!a || !b) return null;
        if (a !== b && FIELD.has(a) && FIELD.has(b)) return 'field';
        if ((a === 'yard' && FIELD.has(b)) || (b === 'yard' && FIELD.has(a))) return 'yard';
        return null;
    };

    // 1. Boundary edges (hedges, roads, water and structures break the
    //    adjacency), grouped into straight runs.
    const runs = [];
    for (let k = 1; k < COLS; k++) {           // vertical grid lines (pieces run along z)
        let cur = null;
        for (let y = 0; y < ROWS; y++) {
            const a = typeAt(k - 1, y), b = typeAt(k, y);
            const cls = eligible(a, b);
            if (cls && cur && cur.cls !== cls) { runs.push(cur); cur = null; }
            if (cls) {
                if (!cur) cur = { vert: true, k, start: y, len: 0, a, b, cls };
                cur.len++;
            } else if (cur) { runs.push(cur); cur = null; }
        }
        if (cur) runs.push(cur);
    }
    for (let k = 1; k < ROWS; k++) {           // horizontal grid lines (pieces run along x)
        let cur = null;
        for (let x = 0; x < COLS; x++) {
            const a = typeAt(x, k - 1), b = typeAt(x, k);
            const cls = eligible(a, b);
            if (cls && cur && cur.cls !== cls) { runs.push(cur); cur = null; }
            if (cls) {
                if (!cur) cur = { vert: false, k, start: x, len: 0, a, b, cls };
                cur.len++;
            } else if (cur) { runs.push(cur); cur = null; }
        }
        if (cur) runs.push(cur);
    }

    // 2. Decide which runs get what.
    const px = paint ? paint.px : (Game.TERRAIN_TEXELS_PER_TILE || 14);
    const roughAt = (txf, tyf) => (paint && paint.rough) ? paint.rough(txf * px, tyf * px) : 0;
    const WALLY = new Set(['garden', 'orchard', 'vineyard']);
    // Walls belong to ENCLOSURES: every wall around one farm plot shares a
    // single style — same model variant and the same grey (whole enclosures
    // vary from lighter to darker stone). The enclosure is the smaller of the
    // two field regions a boundary separates (a walled garden inside a big
    // pasture belongs to the garden).
    const rt = paint ? paint.regionTile : null;
    const wallStyles = {};
    const styleFor = (rid) => wallStyles[rid] || (wallStyles[rid] = {
        variant: Game.randi(0, Game.DIVIDER_MODELS.wall.length - 1),
        tint: (() => {
            const r = Math.random();
            return r < 0.4 ? Game.rand(0.62, 0.82)     // darker grey
                : r < 0.75 ? Game.rand(0.95, 1.12)     // mid
                    : Game.rand(1.22, 1.45);           // lighter grey
        })(),
    });
    // Wetness (guide sec 6.3/16.2): closeness to the river suppresses stone
    // walls — wet meadow edges get rails/planks or stay open, not dry-stone
    // masonry. 1 at the shoreline, fading to 0 four tiles out.
    const wetAt = (wx, wz) => {
        if (!Game._waterRibbonAt) return 0;
        const rib = Game._waterRibbonAt(wx, wz);
        if (!rib) return 0;
        return Game.clamp(1 + rib.signed / (4 * T), 0, 1);
    };
    const LIVESTOCK = new Set(['pasture', 'grass']);
    const pieces = [];   // {x, z, rotY, kind, variant, tint, hMul, c1, c2}
    const piles = [];    // pierrier stone piles (guide sec 19.1) at corners/collapses
    for (const run of runs) {
        const yardRun = run.cls === 'yard';
        if (run.len < 2) continue;
        if (!yardRun && Math.random() > (Game.DIVIDER_RUN_CHANCE != null ? Game.DIVIDER_RUN_CHANCE : 0.9)) continue;
        if (yardRun && Math.random() > 0.9) continue;
        const midT = run.start + run.len / 2;
        const ctx = run.vert ? run.k : midT;
        const cty = run.vert ? midT : run.k;
        const wx = ctx * T, wz = cty * T;
        const rough = yardRun ? 0 : roughAt(ctx, cty);
        // Fully organic joins stay open — nobody walls a wandering boundary.
        if (rough > 0.85) continue;
        const wet = wetAt(wx, wz);
        const dVillage = Math.hypot(wx - Game.missionState.objectiveX, wz - Game.missionState.objectiveY);
        const farmNear = Game.clamp(1 - dVillage / 130, 0, 1);
        const cropProt = (WALLY.has(run.a) || WALLY.has(run.b)) ? 1 : 0;      // garden/orchard/vineyard
        const pastureEdge = (LIVESTOCK.has(run.a) || LIVESTOCK.has(run.b)) ? 1 : 0;

        // Boundary-type selection (guide sec 11): additive context scores and
        // a soft weighted pick — never a hard argmax, real landscapes are
        // inconsistent. 'open' = legal parcel edge with no physical barrier
        // (guide sec 3.9) — concentrated on remote/arable/wet/organic edges.
        const sWall = 0.15 + 1.15 * farmNear + 0.95 * cropProt + 0.5 * pastureEdge
            + (yardRun ? 2.6 : 0) - 1.7 * wet - 0.6 * rough;
        const sFence = 0.05 + 0.85 * farmNear + 0.75 * pastureEdge + 0.25 * cropProt
            - 0.25 * wet - 0.4 * rough;
        const sOpen = 0.1 + 1.3 * rough + 0.45 * (1 - farmNear) + 0.9 * wet
            - (yardRun ? 2.0 : 0) - 0.5 * cropProt;
        const temp = 0.55;
        const eW = Math.exp(sWall / temp), eF = Math.exp(sFence / temp), eO = Math.exp(sOpen / temp);
        const roll = Math.random() * (eW + eF + eO);
        if (roll >= eW + eF) continue;   // open boundary
        const kind = roll < eW ? 'wall' : 'fence';
        // Wall style comes from the ENCLOSURE (see styleFor above): same model
        // + same grey all the way around a plot, never mixed mid-run.
        let variant = 0, tint = 1, st = null;
        if (kind === 'wall') {
            const my = midT | 0;
            const aRid = rt ? rt[run.vert ? my * COLS + (run.k - 1) : (run.k - 1) * COLS + my] : 0;
            const bRid = rt ? rt[run.vert ? my * COLS + run.k : run.k * COLS + my] : 0;
            const areaOf = (rid) => (paint && paint.regions[rid]) ? paint.regions[rid].area || 1e9 : 1e9;
            st = styleFor(areaOf(aRid) <= areaOf(bRid) ? aRid : bRid);
            variant = st.variant;
            tint = st.tint;
        }
        // Condition (guide sec 12.4/18.3): maintenance falls with remoteness.
        // Worn walls lose height; low condition also drops pieces (collapses).
        const cond = (yardRun || kind === 'fence') ? 1
            : Game.clamp(0.45 + 0.75 * farmNear + Game.rand(-0.2, 0.2), 0, 1);
        // Partial coverage: trim the ends a little.
        let s = run.start + (Math.random() < 0.25 ? 1 : 0);
        let e = run.start + run.len - (Math.random() < 0.25 ? 1 : 0);
        // Fences come in SHORT working segments (guide sec 14.3), not endless
        // ranch lines — cap the span and let the rest of the edge go open.
        if (kind === 'fence' && (e - s) > 4) {
            const r = Math.random();
            const cap = r < 0.3 ? 3 : r < 0.65 ? 5 : r < 0.9 ? 8 : 13;
            if ((e - s) > cap) {
                const off = Game.randi(0, (e - s) - cap);
                s += off;
                e = s + cap;
            }
        }
        // Gates/access gaps (guide sec 15.3): long runs get a cart gap, and
        // every walled enclosure keeps at least one way in.
        let gapAt = -99;
        if ((e - s) >= 6 && Math.random() < 0.5) gapAt = Game.randi(s + 2, e - 3);
        else if (st && !st.hasGate && (e - s) >= 4) gapAt = Game.randi(s + 1, e - 2);
        if (gapAt >= 0 && st) st.hasGate = true;
        for (let i = s; i < e; i++) {
            if (i === gapAt || i === gapAt + 1) continue;
            const px2 = run.vert ? run.k * T : (i + 0.5) * T;
            const pz2 = run.vert ? (i + 0.5) * T : run.k * T;
            if (cond < 0.55 && Math.random() < (0.55 - cond) * 0.55) {
                // collapsed stretch: the stone spills as a low pierrier
                if (Math.random() < 0.35) piles.push({ x: px2, z: pz2, big: false });
                continue;
            }
            // Jitter only PERPENDICULAR to the run — along-axis jitter opened
            // visible gaps between pieces (they also overscale ~12%, below).
            const jp = Game.rand(-0.08, 0.08);
            pieces.push({
                x: run.vert ? run.k * T + jp : (i + 0.5) * T,
                z: run.vert ? (i + 0.5) * T : run.k * T + jp,
                rotY: (run.vert ? Math.PI / 2 : 0) + Game.rand(-0.02, 0.02),
                kind, variant, tint,
                // worn walls sag: reduced height, stronger dip at low condition
                hMul: cond < 0.55 ? Game.rand(0.62 + cond * 0.5, 1.0) : 1,
                // Edge endpoints on the tile-corner grid, for junction checks
                c1: run.vert ? (i * (COLS + 1) + run.k) : (run.k * (COLS + 1) + i),
                c2: run.vert ? ((i + 1) * (COLS + 1) + run.k) : (run.k * (COLS + 1) + i + 1),
            });
        }
        // Corner detail (guide sec 19.1): occasional clearance-stone pile at a
        // wall run's end, more likely on remote (low-condition) boundaries.
        if (kind === 'wall' && Math.random() < 0.35 - cond * 0.22) {
            const endI = Math.random() < 0.5 ? s : e;
            piles.push({
                x: run.vert ? run.k * T : endI * T,
                z: run.vert ? endI * T : run.k * T,
                big: true,
            });
        }
    }
    // Roadside dividers: walls/fences that FOLLOW the road contour. The road
    // is a graph of tile-centre segments — diagonals included, the same graph
    // the gravel corridor texture is stroked from — so pieces laid along the
    // segments bend with the road. Coherent noise picks contiguous stretches;
    // kind and style are keyed to the field region the divider fronts, so one
    // stretch never mixes wall/fence or stone styles.
    {
        const segs = [];
        for (let ty = 0; ty < ROWS; ty++) {
            for (let tx = 0; tx < COLS; tx++) {
                if (typeAt(tx, ty) !== 'road') continue;
                for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
                    if (typeAt(tx + dx, ty + dy) === 'road') {
                        segs.push({
                            x1: (tx + 0.5) * T, z1: (ty + 0.5) * T,
                            x2: (tx + dx + 0.5) * T, z2: (ty + dy + 0.5) * T,
                        });
                    }
                }
            }
        }
        const off = T * 0.68;   // just off the gravel corridor edge
        for (const sg of segs) {
            const mx = (sg.x1 + sg.x2) / 2, mz = (sg.z1 + sg.z2) / 2;
            const dx = sg.x2 - sg.x1, dz = sg.z2 - sg.z1;
            const len = Math.hypot(dx, dz);
            const nx = -dz / len, nz = dx / len;
            for (const side of [1, -1]) {
                const sx = mx + nx * off * side, sz = mz + nz * off * side;
                const st = Game.getTileAtWorld(sx, sz);
                if (!st || !FIELD.has(st.type)) continue;
                // coherent stretches (~45% of eligible roadside), not salt-and-pepper
                if (Game._fbm2(mx * 0.045 + side * 37.7, mz * 0.045 - side * 11.3) < 0.5) continue;
                // wet riverside verges stay clear; damp ones only get rails
                const wet = wetAt(sx, sz);
                if (wet > 0.6) continue;
                const tw = Game.tileAtWorld(sx, sz);
                const rid = rt ? rt[tw.ty * COLS + tw.tx] : 0;
                const dVillage = Math.hypot(mx - Game.missionState.objectiveX, mz - Game.missionState.objectiveY);
                // deterministic per (fronted region, side): one stretch, one look
                const wall = wet < 0.35
                    && Game._hash2(rid * 0.37 + side * 13.7, rid * 0.11) < (dVillage < 55 ? 0.7 : 0.3);
                const stl = wall ? styleFor(rid) : null;
                pieces.push({
                    x: sx, z: sz,
                    rotY: Math.atan2(-dz, dx),      // piece long axis along the segment
                    sMul: len / T,                   // diagonals are 1.41 tiles long
                    kind: wall ? 'wall' : 'fence',
                    variant: stl ? stl.variant : 0,
                    tint: stl ? stl.tint : 1,
                    c1: -1, c2: -1,                  // not part of the tile-corner junction logic
                });
            }
        }
    }
    if (!pieces.length) return;

    // Fence-to-wall junctions: a fence piece that meets a wall (shared
    // tile-corner endpoint) is pulled 6% toward the wall so its end tip is
    // buried INSIDE the masonry — firm contact, no gap, and nothing pokes out
    // of the far side (the wall is taller and thicker than the fence tip).
    {
        const wallCorners = new Set();
        pieces.forEach(p => { if (p.kind === 'wall') { wallCorners.add(p.c1); wallCorners.add(p.c2); } });
        for (const p of pieces) {
            if (p.kind !== 'fence') continue;
            const atC1 = wallCorners.has(p.c1), atC2 = wallCorners.has(p.c2);
            if (atC1 === atC2) continue;               // free-standing, or bridging two walls: leave centred
            const shift = T * 0.06 * (atC1 ? -1 : 1);  // c1 is the lower-coordinate end of the run axis
            if (p.rotY > 0.5) p.z += shift;            // vertical run: pieces lie along z
            else p.x += shift;                          // horizontal run: along x
        }
    }

    // 3. Load each model once and instance its share of the pieces (one
    //    InstancedMesh per variant, variants assigned per run). Degradable: a
    //    missing model just skips its runs.
    const byKind = { wall: [], fence: [] };
    pieces.forEach(p => byKind[p.kind].push(p));
    const place = (url, list, variant, kind) => {
        const mine = list.filter(p => p.variant === variant);
        if (!mine.length) return;
        Game.gltfLoader.load(url, (gltf) => {
            let src = null;
            gltf.scene.traverse(o => { if (!src && o.isMesh) src = o; });
            if (!src) return;
            const geo = src.geometry;
            if (!geo.attributes.normal) geo.computeVertexNormals();   // optimizer strips normals
            geo.computeBoundingBox();
            const bb = geo.boundingBox;
            // Each piece spans one tile edge PLUS ~12% overlap into its
            // neighbours, so consecutive pieces interpenetrate and the joins
            // between elements disappear. Walls keep that length but drop 20%
            // in height/thickness (they read oversized at full scale).
            const scale = (T * 1.12) / Math.max(0.001, bb.max.x - bb.min.x);
            const bulk = kind === 'wall' ? scale * 0.8 : scale;
            const mat = src.material;
            mat.roughness = 0.95; mat.metalness = 0.0;
            if (kind === 'wall') {
                // The baked source texture reads too light/beige on the terrain —
                // swap in the procedural dark fieldstone (normal map kept).
                mat.map = Game._makeDarkStoneTexture();
                if (mat.color) mat.color.setHex(0xffffff);
                mat.needsUpdate = true;
            }
            const inst = new THREE.InstancedMesh(geo, mat, mine.length);
            inst.name = 'divider-' + kind + '-' + (variant + 1);
            inst.castShadow = true;
            inst.receiveShadow = true;
            const dummy = new THREE.Object3D();
            const icol = new THREE.Color();
            mine.forEach((p, i) => {
                const hm = p.hMul || 1;                // worn walls sag (guide sec 18.3)
                const y = Game.getHeight(p.x, p.z) + (-bb.min.y * bulk * hm - 0.07);
                dummy.position.set(p.x, y, p.z);
                dummy.rotation.set(0, p.rotY, 0);
                dummy.scale.set(p.sMul ? scale * p.sMul : scale, bulk * hm, bulk);
                dummy.updateMatrix();
                inst.setMatrixAt(i, dummy.matrix);
                icol.setScalar(p.tint || 1);           // per-enclosure lighter/darker grey
                inst.setColorAt(i, icol);
                // Tanks crush dividers via the shared knock-down animator; the
                // tighter radius keeps a tank driving ALONGSIDE a wall from
                // flattening it — it has to actually hit it.
                if (Game.foliageKD) {
                    Game.foliageKD.push({
                        leaves: inst, branches: inst, idx: i,
                        x: p.x, y, z: p.z, rotY: p.rotY,
                        s: p.sMul ? scale * p.sMul : scale, sy: bulk * hm, sz: bulk,
                        rrMul: 0.8, rrAdd: 0.1,
                        stone: kind === 'wall',   // stone crumbles to rubble instead of tipping
                        wood: kind === 'fence',   // fences splinter into planks
                        dir: 0, fallT: 0, triggered: false,
                    });
                }
            });
            inst.instanceMatrix.needsUpdate = true;
            if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
            inst.computeBoundingSphere();
            Game.terrainGroup.add(inst);
        }, undefined, () => { /* optional asset missing — keep the map bare there */ });
    };
    Game.DIVIDER_MODELS.wall.forEach((u, i) => place(u, byKind.wall, i, 'wall'));
    Game.DIVIDER_MODELS.fence.forEach((u, i) => place(u, byKind.fence, i, 'fence'));

    // Pierriers (guide sec 3.3/19.1): low clearance-stone piles at wall-run
    // ends and where collapsed walls spilled. Procedural — squashed rock
    // instances in the same dark fieldstone as the walls.
    if (piles.length) {
        const rockGeo = new THREE.DodecahedronGeometry(1, 0);
        const rockMat = new THREE.MeshStandardMaterial({
            map: Game._makeDarkStoneTexture(),
            roughness: 1.0, metalness: 0.0,
        });
        let n = 0;
        piles.forEach(p => { n += p.big ? 4 : 3; });
        const inst = new THREE.InstancedMesh(rockGeo, rockMat, n);
        inst.name = 'divider-pierrier';
        inst.castShadow = true;
        inst.receiveShadow = true;
        const dummy = new THREE.Object3D();
        let i = 0;
        piles.forEach(p => {
            const count = p.big ? 4 : 3;
            const base = p.big ? 0.34 : 0.24;
            for (let k = 0; k < count; k++) {
                const rx = p.x + Game.rand(-0.55, 0.55);
                const rz = p.z + Game.rand(-0.55, 0.55);
                const sr = base * Game.rand(0.7, 1.3);
                dummy.position.set(rx, Game.getHeight(rx, rz) + sr * 0.35, rz);
                dummy.rotation.set(Game.rand(0, Math.PI), Game.rand(0, Math.PI), Game.rand(0, Math.PI));
                dummy.scale.set(sr, sr * 0.6, sr);   // squashed: settled heap, not boulders
                dummy.updateMatrix();
                inst.setMatrixAt(i++, dummy.matrix);
            }
        });
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        Game.terrainGroup.add(inst);
    }
};

// Procedural dark-grey fieldstone texture for the divider walls: irregular
// stones in cool greys over near-charcoal mortar. UV-agnostic by design (the
// generated models' bake atlas is arbitrary, so the pattern must read as stone
// from any mapping).
Game._makeDarkStoneTexture = () => {
    if (Game._darkStoneTex) return Game._darkStoneTex;
    const THREE = Game.THREE;
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = '#3d3d40';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 850; i++) {
        const v = 58 + Math.random() * 50;                 // 58..108 stone greys
        const r = (v + Game.rand(-4, 4)) | 0;
        const b = (v + Game.rand(0, 9)) | 0;               // faint cool cast
        g.fillStyle = `rgba(${r},${v | 0},${b},${Game.rand(0.55, 0.95).toFixed(2)})`;
        g.beginPath();
        g.ellipse(Math.random() * S, Math.random() * S, Game.rand(4, 13), Game.rand(3, 8), Game.rand(0, Math.PI), 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = 'rgba(16,16,18,0.4)';              // mortar shadow
        g.lineWidth = 1.4;
        g.stroke();
    }
    for (let i = 0; i < 2400; i++) {                       // grain
        const v = (36 + Math.random() * 76) | 0;
        g.fillStyle = `rgba(${v},${v},${v},0.15)`;
        g.fillRect(Math.random() * S, Math.random() * S, 1.4, 1.4);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    Game._darkStoneTex = tex;
    return tex;
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

    // Wheel-track ruts are now painted into the road corridor texture (they follow
    // the road direction, diagonals included) instead of axis-aligned 3D box strips,
    // which stepped along diagonal roads.

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
    Game.terrainMesh = null;

    if (Game._applyWaterBedDepth) Game._applyWaterBedDepth();

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
        alphaTest: 0.06,           // low cut: keep the feathered edge for soft-blend
        transparent: true,         // so the VALOR soft-blend alpha actually blends
        depthWrite: true,          // still occlude properly (limits sort artifacts)
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

    // Hedge-shrub leaf material — soft-blend like the trees, but driven by its
    // OWN hedge-blend uniform so bushes can be tuned separately from trees.
    const shrubLeafMat = Game._attachFoliageWind(new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x12200c,
        emissiveIntensity: 0.08,
        map: leavesTex,
        alphaTest: 0.06,
        transparent: true,
        depthWrite: true,
        side: THREE.DoubleSide,
        roughness: 0.92,
        metalness: 0.0,
    }), {
        strength: 0.03, speed: 0.9, flutter: 0.01, blur: true,
        blurUniform: Game._valorHedgeBlurUniform ? Game._valorHedgeBlurUniform() : null,
    });
    shrubLeafMat.name = 'shared-shrub-leaf-cards';

    // ── Shared CC0 bark + EZ-Tree foliage helpers (trees and hedge shrubs) ──
    // Trees/bushes use EZ-Tree (MIT) GEOMETRY only, rendered with CC0 textures
    // (Poly Haven oak bark + our leaf card) so we stay within the CC0 asset rule.
    const barkColor = texLoader.load('textures/bark_color.jpg');
    barkColor.wrapS = barkColor.wrapT = THREE.RepeatWrapping;
    barkColor.colorSpace = THREE.SRGBColorSpace;
    barkColor.anisotropy = Math.min(4, Game.renderer.capabilities.getMaxAnisotropy());
    const barkNormal = texLoader.load('textures/bark_normal.jpg');
    barkNormal.wrapS = barkNormal.wrapT = THREE.RepeatWrapping;
    // Shared CC0 bark, tinted per species (oak neutral, pine reddish, birch pale).
    // VALOR: soft-blend the trunk/branches too, so the whole tree model melds
    // into the scene with the same slider (leaf cards via _attachFoliageWind).
    const makeBarkMat = (tint, name) => {
        // Bark stays fully opaque: the soft-blend opacity ease is for leaf
        // card edges, and on solid trunks it just made them see-through.
        const m = new THREE.MeshStandardMaterial({
            map: barkColor, normalMap: barkNormal, roughness: 0.76, metalness: 0.0,
            color: tint,
        });
        m.name = name;
        return m;
    };
    const barkMat = makeBarkMat(0xffffff, 'eztree-bark');
    const pineBarkMat = makeBarkMat(0xc08a5e, 'eztree-bark-pine');    // Scots pine: warm red-brown
    const birchBarkMat = makeBarkMat(0xe9e5da, 'eztree-bark-birch');  // birch: pale silver

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
    const placeFoliage = (protos, positions, scaleK, namePrefix, leafMat, trunkMat) => {
        if (!protos.length || !positions.length) return;
        const lMat = leafMat || foliageCardMat;   // trees get the soft-blend leaf; shrubs pass a crisp one
        const bMat = trunkMat || barkMat;         // species bark tint (pine/birch)
        const buckets = Array.from({ length: protos.length }, () => []);
        positions.forEach((t, i) => buckets[i % protos.length].push(t));
        const dummy = new THREE.Object3D();
        const color = new THREE.Color();
        protos.forEach((proto, p) => {
            const list = buckets[p];
            if (!list.length) return;
            const branches = new THREE.InstancedMesh(proto.bgeo, bMat, list.length);
            const leaves = new THREE.InstancedMesh(proto.lgeo, lMat, list.length);
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
                const ry = Math.random() * Math.PI * 2;
                dummy.position.set(t.x, baseY - (t.sink || 0), t.z);
                dummy.rotation.set(0, ry, 0);
                dummy.scale.set(s, s, s);
                dummy.updateMatrix();
                branches.setMatrixAt(i, dummy.matrix);
                leaves.setMatrixAt(i, dummy.matrix);
                // Register small/medium trees + all bushes so a tank knocks them
                // flat (only the very largest trees resist).
                const worldH = t.height * t.scale * scaleK;
                if ((namePrefix === 'hedge-shrub' || worldH < 6.5) && Game.foliageKD) {
                    Game.foliageKD.push({
                        leaves, branches, idx: i,
                        x: t.x, y: baseY - (t.sink || 0), z: t.z,
                        rotY: ry, s, dir: 0, fallT: 0, triggered: false,
                    });
                }
                const lh = proto.leafHSL || { h: 0.26, s: 0.42, l: 0.33 };
                color.setHSL(lh.h + Game.rand(-0.03, 0.07), lh.s + Game.rand(0, 0.18), lh.l + Game.rand(0, 0.14));
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

    // Grass tuft: a CROSS of two wider planes so each instance reads as a clump
    // from the angled RTS camera (a single thin plane looked like a sliver/stick).
    const grassBladeGeo = (() => {
        const a = new THREE.PlaneGeometry(0.62, 0.66, 1, 2); a.translate(0, 0.33, 0);
        const b = new THREE.PlaneGeometry(0.62, 0.66, 1, 2); b.translate(0, 0.33, 0); b.rotateY(Math.PI / 2);
        // merge the two quads into one BufferGeometry (no addon dependency)
        const merge = (geos) => {
            const pos = [], uv = [], norm = [], idx = []; let off = 0;
            for (const g of geos) {
                const p = g.attributes.position, u = g.attributes.uv, nm = g.attributes.normal, id = g.index;
                for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); uv.push(u.getX(i), u.getY(i)); norm.push(nm.getX(i), nm.getY(i), nm.getZ(i)); }
                for (let i = 0; i < id.count; i++) idx.push(id.getX(i) + off);
                off += p.count; g.dispose();
            }
            const bg = new THREE.BufferGeometry();
            bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            bg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
            bg.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
            bg.setIndex(idx);
            return bg;
        };
        return merge([a, b]);
    })();
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

    // ── Buildings: a shared damage-state GLB model replaces the procedural
    //    plaster/stone house once it loads; the procedural wall+roof+chimney
    //    below is built first as the immediate (and fallback) visual. ──
    Game.buildingRecords = [];
    // The church footprint is treated as a building too — the only building model
    // right now is the shop house, so the church becomes house(s) like the rest.
    const allBuildings = Game.church ? Game.buildings.concat([Game.church]) : Game.buildings;
    allBuildings.forEach(b => {
        const w = b.tw * T;
        const d = b.th * T;
        const cx = b.tx * T + w / 2;
        const cz = b.ty * T + d / 2;
        const baseY = Game.getHeight(cx, cz);

        const bGroup = new THREE.Group();
        Game.terrainGroup.add(bGroup);

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
        bGroup.add(wallMesh);

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
        bGroup.add(roofMesh);

        // Chimney
        const chimGeo = new THREE.BoxGeometry(0.35, 0.9, 0.35);
        const chimMat = new THREE.MeshStandardMaterial({ color: 0x8a6e60, roughness: 0.95 });
        const chim = new THREE.Mesh(chimGeo, chimMat);
        chim.position.set(cx + w * 0.25, baseY + height + roofH * 0.5, cz - d * 0.2);
        chim.castShadow = true;
        bGroup.add(chim);

        if (Game.registerBuilding) {
            Game.registerBuilding(b, bGroup, { w, d, cx, cz, baseY }, [wallMesh, roofMesh, chim]);
        }
    });
    // Swap procedural houses for the GLB model (async; keeps procedural on fail).
    if (Game._loadBuildingModels) Game._loadBuildingModels();

    // Church is no longer built procedurally — its footprint is placed as
    // house(s) by the building loop above (shop house is the only model for now).

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

    // ── Field dividers: stone walls + farm fences along some field joins ──
    if (Game._addFieldDividers) Game._addFieldDividers();

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
        // Four distinct shrub species (shape + leaf colour vary) so bushes read as
        // a mix, not one repeated blob: rounded hazel, low sprawling bramble,
        // upright hawthorn, and a narrow twiggy broom.
        const shrubProtos = [];
        const SHRUB_SPECIES = [
            { hsl: { h: 0.26, s: 0.44, l: 0.33 }, cfg: (o) => {   // hazel — rounded medium
                o.branch.children = { 0: 6, 1: 3, 2: 2 }; o.branch.length = { 0: 11, 1: 8, 2: 4, 3: 3 };
                o.branch.radius = { 0: 0.9, 1: 0.5, 2: 0.3, 3: 0.2 }; o.branch.angle = { 1: 58, 2: 60, 3: 60 };
                o.branch.gnarliness = { 0: 0.18, 1: 0.28, 2: 0.2, 3: 0.1 }; o.leaves.type = 'oak'; o.leaves.count = 9; o.leaves.size = 4.2; } },
            { hsl: { h: 0.20, s: 0.38, l: 0.30 }, cfg: (o) => {   // bramble — low, wide, sprawling
                o.branch.children = { 0: 8, 1: 4, 2: 2 }; o.branch.length = { 0: 7, 1: 9, 2: 5, 3: 3 };
                o.branch.radius = { 0: 0.7, 1: 0.45, 2: 0.28, 3: 0.18 }; o.branch.angle = { 1: 78, 2: 80, 3: 70 };
                o.branch.gnarliness = { 0: 0.3, 1: 0.4, 2: 0.3, 3: 0.2 }; o.leaves.type = 'ash'; o.leaves.count = 7; o.leaves.size = 3.0; } },
            { hsl: { h: 0.28, s: 0.40, l: 0.31 }, cfg: (o) => {   // hawthorn — dense upright
                o.branch.children = { 0: 5, 1: 3, 2: 2 }; o.branch.length = { 0: 14, 1: 7, 2: 4, 3: 3 };
                o.branch.radius = { 0: 1.0, 1: 0.55, 2: 0.3, 3: 0.2 }; o.branch.angle = { 1: 50, 2: 55, 3: 58 };
                o.branch.gnarliness = { 0: 0.14, 1: 0.22, 2: 0.18, 3: 0.1 }; o.leaves.type = 'oak'; o.leaves.count = 10; o.leaves.size = 3.8; } },
            { hsl: { h: 0.23, s: 0.46, l: 0.35 }, cfg: (o) => {   // broom — narrow twiggy
                o.branch.children = { 0: 7, 1: 2, 2: 2 }; o.branch.length = { 0: 16, 1: 6, 2: 4, 3: 3 };
                o.branch.radius = { 0: 0.7, 1: 0.4, 2: 0.25, 3: 0.16 }; o.branch.angle = { 1: 34, 2: 40, 3: 45 };
                o.branch.gnarliness = { 0: 0.1, 1: 0.16, 2: 0.14, 3: 0.08 }; o.leaves.type = 'ash'; o.leaves.count = 6; o.leaves.size = 2.6; } },
        ];
        SHRUB_SPECIES.forEach((sp, p) => {
            const proto = makeFoliageProto(7001 + p * 97, (o) => {
                o.type = 'deciduous';
                o.branch.levels = 2;
                o.branch.sections = { 0: 4, 1: 3, 2: 3, 3: 2 };
                o.branch.segments = { 0: 5, 1: 4, 2: 3, 3: 3 };
                o.leaves.billboard = 'double';
                o.leaves.sizeVariance = 0.8;
                o.leaves.start = 0.0;
                sp.cfg(o);
            });
            proto.leafHSL = sp.hsl;   // read by placeFoliage for per-species leaf colour
            shrubProtos.push(proto);
        });
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
        // Sparse SMALL shrubs at road edges — 3D volume over the seam to complement
        // the grass fringe (bucketed across the four species for variety).
        const RD_SHRUB_ON = new Set(['grass', 'pasture', 'wheat', 'stubble', 'vineyard', 'garden', 'orchard', 'forest', 'dense_forest', 'hedge']);
        for (let ty = 0; ty < Game.MAP_ROWS; ty++) {
            for (let tx = 0; tx < Game.MAP_COLS; tx++) {
                if (Game.terrain[ty][tx].type !== 'road') continue;
                const cx = tx * T, cz = ty * T;
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nt = Game.getTile(tx + dx, ty + dy);
                    if (!nt || !RD_SHRUB_ON.has(nt.type)) continue;
                    if (Math.random() > 0.2) continue;                 // sparse
                    const f = Game.rand(0.2, 0.8), off = Game.rand(0.15, 0.6);
                    shrubPositions.push({
                        x: (dx !== 0) ? (cx + (dx > 0 ? T : 0) + dx * off) : (cx + f * T),
                        z: (dy !== 0) ? (cz + (dy > 0 ? T : 0) + dy * off) : (cz + f * T),
                        height: 0.7, scale: Game.rand(0.5, 0.8), sink: 0.25,   // small
                    });
                }
            }
        }
        // Riparian scrub: bushes clump along the river banks — the damp
        // floodplain strip never gets ploughed and fresh water is steps away,
        // so scrub flourishes. Two bands: dense SMALL bushes right at the
        // waterline, a looser band of full-size bushes up the floodplain.
        if (Game._waterRibbonAt && Game.river && Game.river.tiles.length >= 8) {
            const WLr = Game.WATER_LEVEL ?? -999;
            const nearBridge = (x, z) => (Game.bridges || []).some(b =>
                Math.abs(x - b.cx) < 4.5 * T && Math.abs(z - b.cz) < 4.5 * T);
            const BANK_OK = new Set(['grass', 'pasture', 'wheat', 'stubble', 'plowed', 'vineyard', 'garden', 'mud']);
            const tryBush = (x, z, hMin, hMax, sMin, sMax, minAboveWL) => {
                if (nearBridge(x, z)) return;
                const tile = Game.getTileAtWorld(x, z);
                if (!tile || !BANK_OK.has(tile.type)) return;
                if (Game.getHeight(x, z) < WLr + minAboveWL) return;   // not in the water
                shrubPositions.push({
                    x, z,
                    height: Game.rand(hMin, hMax),
                    scale: Game.rand(sMin, sMax),
                    sink: 0.22,
                });
            };
            for (let txf = 0; txf < Game.MAP_COLS; txf += 0.22) {
                const wx = (txf + 0.5) * T;
                const rib = Game._waterRibbonAt(wx, 0, Infinity);   // channel probe: bypass the pond cutoff
                if (!rib) continue;
                for (const side of [-1, 1]) {
                    // clumping noise: stretches of scrub alternate with open bank
                    const clump = Game._fbm2(wx * 0.05 + side * 31.7, side * 77.3 + 4.4);
                    if (clump < 0.42) continue;
                    // waterline band: small dense bushes with their feet nearly
                    // in the river (1-2 per sample in strong clumps)
                    if (Math.random() < 0.6) {
                        const n = clump > 0.6 ? 2 : 1;
                        for (let k = 0; k < n; k++) {
                            tryBush(
                                wx + Game.rand(-0.9, 0.9),
                                rib.centerZ + side * (rib.halfWidth + Game.rand(0.3, 1.5)),
                                0.32, 0.68, 0.55, 0.95, 0.06);
                        }
                    }
                    // floodplain band: full-size bushes, looser
                    if (Math.random() < 0.45) {
                        tryBush(
                            wx + Game.rand(-1.1, 1.1),
                            rib.centerZ + side * (rib.halfWidth + Game.rand(1.1, 3.6) * (0.6 + clump)),
                            0.55, 1.15, 0.7, 1.2, 0.12);
                    }
                }
            }

            // Pond fringe scrub: bushes ring the mares. The smaller the pond
            // the tighter the ring — big field ponds keep open, grazed banks.
            (Game.ponds || []).forEach(p => {
                const steps = Math.max(14, Math.round(p.r * 14));
                const dense = Game.clamp(1.35 - p.r * 0.14, 0.45, 1.0);
                for (let k = 0; k < steps; k++) {
                    const a = (k / steps) * Math.PI * 2 + Game.rand(-0.12, 0.12);
                    const ca = Math.cos(a), sa = Math.sin(a);
                    // rim distance along this direction (egg/squeeze metric)
                    const rimW = p.r * T / Math.hypot(
                        (ca * (p.ct ?? 1) + sa * (p.st ?? 0)) / (p.sx ?? 1),
                        (-ca * (p.st ?? 0) + sa * (p.ct ?? 1)) / (p.sy ?? 1));
                    const clump = Game._fbm2(ca * 2.1 + p.tx, sa * 2.1 + p.tz);
                    if (clump < 0.34) continue;   // open bank stretches
                    // waterline band: small dense bushes right at the rim
                    if (Math.random() < 0.75 * dense) {
                        const rr = rimW + Game.rand(0.4, 1.6);
                        tryBush(p.wx + ca * rr, p.wz + sa * rr,
                            0.32, 0.68, 0.55, 0.95, 0.06);
                    }
                    // outer band: full-size bushes, looser
                    if (Math.random() < 0.4 * dense) {
                        const rr = rimW + Game.rand(1.6, 4.0);
                        tryBush(p.wx + ca * rr, p.wz + sa * rr,
                            0.55, 1.15, 0.7, 1.2, 0.12);
                    }
                }
            });
        }
        placeFoliage(shrubProtos, shrubPositions, 2.4, 'hedge-shrub', shrubLeafMat);

        // Final bush positions (hedgerows + riparian scrub), kept for
        // reference mode's markers
        Game.shrubSpots = shrubPositions.map(p => ({ x: p.x, z: p.z }));
    }

    // ── Forest-style instanced undergrowth: one blade mesh, many varied instances ──
    {
        const maxBlades = Math.floor(42000 * (Game.TERRAIN_DETAIL_DENSITY || 1));
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
                if (type === 'dense_forest') count = Game.randi(6, 9);
                else if (type === 'forest') count = Game.randi(4, 6);
                else if (type === 'orchard') count = Game.randi(3, 5);
                else if (type === 'grass' || type === 'pasture') count = Game.randi(5, 9);   // fields are grassy now
                else if (type === 'stubble') count = Game.randi(2, 4);
                else if (type === 'garden' || type === 'vineyard') count = Game.randi(1, 3);

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
            inst.visible = Game.SHOW_GRASS !== false;   // debug toggle
            (Game._grassMeshes = Game._grassMeshes || []).push(inst);
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
                else color.setHSL(0.25 + Game.rand(-0.04, 0.05), 0.45 + Game.rand(0, 0.18), 0.40 + Game.rand(0, 0.14));   // brighter grass green
                inst.setColorAt(i, color);
            });

            inst.instanceMatrix.needsUpdate = true;
            if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
            inst.computeBoundingSphere();
            Game.terrainGroup.add(inst);
        }
    }

    // ── Instanced trees: species-mixed forests, orchards, treelines, clusters ──
    // Species per docs/foliage.md (France 1940): oak-mixed woodland is the
    // default, Scots PINE grows in coherent stands on "dry ground" (a smooth
    // noise mask, so stands read as stands rather than salt-and-pepper), and
    // BIRCH is the pioneer species, biased to forest edges.
    {
        const treeList = [];   // {x, z, height, scale, species}
        const pineStand = (x, z) => Game._fbm2(x * 0.021 + 3.3, z * 0.021 - 8.1) > 0.585;
        const forestEdge = (tx, ty) => {
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const n = Game.getTile(tx + dx, ty + dy);
                if (!n || (n.type !== 'forest' && n.type !== 'dense_forest')) return true;
            }
            return false;
        };
        const pickSpecies = (x, z, tx, ty) => {
            const edge = forestEdge(tx, ty);
            const r = Math.random();
            if (pineStand(x, z)) {
                if (r < (edge ? 0.6 : 0.8)) return 'pine';   // pine mass, birch on the fringe
                if (r < 0.92) return 'birch';
                return 'oak';
            }
            if (r < (edge ? 0.26 : 0.08)) return 'birch';
            if (r < (edge ? 0.32 : 0.16)) return 'pine';     // the odd lone pine in oak woods
            return 'oak';
        };
        const heightFor = (species) =>
            species === 'pine' ? Game.rand(3.0, 5.0)         // pines overtop the canopy
                : species === 'birch' ? Game.rand(2.0, 3.2)
                    : Game.rand(2.6, 4.2);

        for (let ty = 0; ty < Game.MAP_ROWS; ty++) {
            for (let tx = 0; tx < Game.MAP_COLS; tx++) {
                const tile = Game.terrain[ty][tx];
                if (tile.type === 'forest' || tile.type === 'dense_forest') {
                    // Forest density: clusters read too thick, so dense cores are
                    // 1-2 and ordinary forest 0-2 (plus a global 30% thin below).
                    const count = tile.type === 'dense_forest' ? Game.randi(1, 2) : Game.randi(0, 2);
                    for (let i = 0; i < count; i++) {
                        const x = tx * T + Game.rand(0.3, T - 0.3);
                        const z = ty * T + Game.rand(0.3, T - 0.3);
                        const species = pickSpecies(x, z, tx, ty);
                        treeList.push({ x, z, height: heightFor(species), scale: Game.rand(0.85, 1.4), species });
                    }
                } else if (tile.type === 'orchard') {
                    // orderly orchard rows: one tree per tile, near center
                    if ((tx + ty) % 2 === 0) {
                        treeList.push({
                            x: tx * T + T / 2 + Game.rand(-0.4, 0.4),
                            z: ty * T + T / 2 + Game.rand(-0.4, 0.4),
                            height: Game.rand(1.8, 2.6),
                            scale: Game.rand(0.7, 1.0),
                            species: 'oak',
                        });
                    }
                }
            }
        }

        // Treelines: a tree on ~12% of hedgerow tiles (dotted field borders)
        hedgeTiles.forEach(({ tx, ty }) => {
            if (Math.random() < 0.12) {
                treeList.push({
                    x: tx * T + Game.rand(0.3, T - 0.3),
                    z: ty * T + Game.rand(0.3, T - 0.3),
                    height: Game.rand(2.4, 3.8),
                    scale: Game.rand(0.8, 1.2),
                    species: 'oak',
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
            const r = Math.random();
            const species = r < 0.15 ? 'pine' : r < 0.27 ? 'birch' : 'oak';
            treeList.push({
                x, z,
                height: heightFor(species) * 0.85,
                scale: Game.rand(0.7, 1.2),
                species,
            });
        }

        // Riparian trees: lone trees dotted along the banks in small clusters
        // (oaks read as willows/alders at this scale, plus the odd birch),
        // set just back from the scrub line.
        if (Game._waterRibbonAt && Game.river && Game.river.tiles.length >= 8) {
            const WLr = Game.WATER_LEVEL ?? -999;
            const nearBridge = (x, z) => (Game.bridges || []).some(b =>
                Math.abs(x - b.cx) < 5 * T && Math.abs(z - b.cz) < 5 * T);
            for (let txf = 0; txf < Game.MAP_COLS; txf += 0.9) {
                const wx = (txf + 0.5) * T;
                const rib = Game._waterRibbonAt(wx, 0, Infinity);   // channel probe: bypass the pond cutoff
                if (!rib) continue;
                for (const side of [-1, 1]) {
                    const clump = Game._fbm2(wx * 0.043 + side * 12.9, side * 51.1 - 8.7);
                    // sparse enough that the canopy never closes over the water —
                    // the dense layer at the river is the scrub, not trees
                    if (clump < 0.52 || Math.random() > 0.38) continue;
                    const x = wx + Game.rand(-1.6, 1.6);
                    const z = rib.centerZ + side * (rib.halfWidth + Game.rand(1.4, 4.5));
                    if (nearBridge(x, z)) continue;
                    const tile = Game.getTileAtWorld(x, z);
                    if (!tile || ['house', 'wall', 'road', 'yard', 'water'].includes(tile.type)) continue;
                    if (Game.getHeight(x, z) < WLr + 0.15) continue;
                    // mostly small trees and saplings — a young waterside stand,
                    // not another oak wood
                    const sapling = Math.random() < 0.55;
                    treeList.push({
                        x, z,
                        height: sapling ? Game.rand(1.2, 1.8) : Game.rand(1.7, 2.6),
                        scale: sapling ? Game.rand(0.55, 0.85) : Game.rand(0.7, 1.05),
                        species: Math.random() < 0.22 ? 'birch' : 'oak',
                    });
                }
            }

            // Pond fringe trees: a waterside clump or two leans over each mare
            // (oaks read as willows/alders at this scale). Small ponds get the
            // denser fringe — stock can't graze those banks bare.
            (Game.ponds || []).forEach(p => {
                const steps = Math.max(8, Math.round(p.r * 6));
                const dense = Game.clamp(1.5 - p.r * 0.18, 0.4, 1.1);
                for (let k = 0; k < steps; k++) {
                    const a = (k / steps) * Math.PI * 2 + Game.rand(-0.2, 0.2);
                    const ca = Math.cos(a), sa = Math.sin(a);
                    const rimW = p.r * T / Math.hypot(
                        (ca * (p.ct ?? 1) + sa * (p.st ?? 0)) / (p.sx ?? 1),
                        (-ca * (p.st ?? 0) + sa * (p.ct ?? 1)) / (p.sy ?? 1));
                    const clump = Game._fbm2(ca * 1.7 - p.tx, sa * 1.7 + p.tz);
                    if (clump < 0.48 || Math.random() > 0.5 * dense) continue;
                    const rr = rimW + Game.rand(1.0, 3.6);
                    const x = p.wx + ca * rr, z = p.wz + sa * rr;
                    const tile = Game.getTileAtWorld(x, z);
                    if (!tile || ['house', 'wall', 'road', 'yard', 'water'].includes(tile.type)) continue;
                    if (Game.getHeight(x, z) < WLr + 0.15) continue;
                    const sapling = Math.random() < 0.5;
                    treeList.push({
                        x, z,
                        height: sapling ? Game.rand(1.2, 1.8) : Game.rand(1.8, 2.7),
                        scale: sapling ? Game.rand(0.55, 0.85) : Game.rand(0.75, 1.05),
                        species: Math.random() < 0.3 ? 'birch' : 'oak',
                    });
                }
            });
        }

        // Global thinning: render ~30% fewer trees overall (forests, treelines,
        // orchards and lone trees alike) — the map read too wooded.
        for (let i = treeList.length - 1; i >= 0; i--) {
            if (Math.random() < 0.30) treeList.splice(i, 1);
        }

        if (treeList.length > 0 && Game.EZTree && Game.EZTree.Tree) {
            // A few prototype trees per species, generated once, then instanced.
            // Geometry is EZ-Tree (MIT); rendered with CC0 textures via the
            // shared helpers above (tinted bark + leaf cards).
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

            // Scots pine, LARGE + MEDIUM. EZ-Tree's 'evergreen' type shortens the
            // whorl branches toward the top automatically → conical crown; a bare
            // lower trunk comes from branch.start, and a slight downward force
            // droops the mature boughs.
            const pineCfg = (tall) => (o) => {
                o.type = 'evergreen';
                o.branch.levels = 2;
                o.branch.children = { 0: tall ? 15 : 11, 1: 4, 2: 2 };
                o.branch.sections = { 0: 6, 1: 3, 2: 3, 3: 2 };
                o.branch.segments = { 0: 5, 1: 3, 2: 3, 3: 3 };
                o.branch.length = { 0: tall ? 44 : 32, 1: 13, 2: 6, 3: 3 };
                o.branch.radius = { 0: 1.3, 1: 0.55, 2: 0.35, 3: 0.25 };
                o.branch.angle = { 1: 84, 2: 62, 3: 58 };
                o.branch.start = { 1: tall ? 0.4 : 0.3, 2: 0.25, 3: 0 };
                o.branch.gnarliness = { 0: 0.04, 1: 0.1, 2: 0.12, 3: 0.08 };
                o.branch.force = { direction: { x: 0, y: 1, z: 0 }, strength: -0.008 };
                o.leaves.type = 'pine';
                o.leaves.billboard = 'double';
                o.leaves.count = 4;
                o.leaves.size = tall ? 4.4 : 3.8;
                o.leaves.sizeVariance = 0.5;
                o.leaves.start = 0.2;
            };
            const pineProtos = [
                makeFoliageProto(4021, pineCfg(true)),    // large
                makeFoliageProto(4153, pineCfg(false)),   // medium
            ];
            pineProtos.forEach(pr => { pr.leafHSL = { h: 0.34, s: 0.30, l: 0.20 }; });   // deep stable green

            // Silver birch: slender pale trunk, small light crown.
            const birchProto = makeFoliageProto(5077, (o) => {
                o.type = 'deciduous';
                o.branch.levels = 2;
                o.branch.children = { 0: 4, 1: 3, 2: 2 };
                o.branch.sections = { 0: 5, 1: 4, 2: 3, 3: 2 };
                o.branch.segments = { 0: 5, 1: 4, 2: 3, 3: 3 };
                o.branch.length = { 0: 30, 1: 12, 2: 6, 3: 3 };
                o.branch.radius = { 0: 0.8, 1: 0.35, 2: 0.22, 3: 0.15 };
                o.branch.angle = { 1: 42, 2: 48, 3: 50 };
                o.branch.gnarliness = { 0: 0.08, 1: 0.18, 2: 0.16, 3: 0.1 };
                o.leaves.type = 'ash';
                o.leaves.billboard = 'double';
                o.leaves.count = 5;
                o.leaves.size = 3.4;
                o.leaves.sizeVariance = 0.8;
                o.leaves.start = 0.25;
            });
            birchProto.leafHSL = { h: 0.23, s: 0.45, l: 0.42 };   // light fresh green

            const bySpecies = { oak: [], pine: [], birch: [] };
            treeList.forEach(t => bySpecies[t.species].push(t));
            placeFoliage(treeProtos, bySpecies.oak, 1.7, 'tree');
            placeFoliage(pineProtos, bySpecies.pine, 1.7, 'tree-pine', null, pineBarkMat);
            placeFoliage([birchProto], bySpecies.birch, 1.7, 'tree-birch', null, birchBarkMat);
        }

        // Final rendered tree positions, kept for reference mode's markers
        Game.treeSpots = treeList.map(t => ({ x: t.x, z: t.z }));
    }

    // ── Animated water surface over the river ──
    if (Game._buildWaterSurface) Game._buildWaterSurface();
    if (Game._addRiverWashStones) Game._addRiverWashStones();

    // ── Random terrain-damage spots for reference mode's markers ──
    // Red circles = craters (bigger dot = bigger crater), red triangles =
    // small sharp impacts (shell hits, tank rounds). Not gameplay craters,
    // just annotation: clustered "shelled patches" plus stray single hits.
    {
        const spots = [];
        // Only during dataset capture: annotation variety for training. Normal
        // games keep this empty so neural bakes condition on pristine ground.
        if (Game._refCap) {
            const add = (x, z, big) => {
                if (x < 3 || z < 3 || x > Game.WORLD_W - 3 || z > Game.WORLD_H - 3) return;
                const t = Game.getTileAtWorld(x, z);
                if (!t || t.type === 'water' || t.type === 'house' || t.type === 'wall') return;
                if (big) spots.push({ x, z, shape: 'circle', px: Game.randi(8, 14) });
                else if (Math.random() < 0.5) spots.push({ x, z, shape: 'triangle', px: Game.randi(4, 7) });
                else spots.push({ x, z, shape: 'circle', px: Game.randi(4, 7) });
            };
            const nClusters = Game.randi(12, 18);
            for (let c = 0; c < nClusters; c++) {
                const cx = Game.rand(0, Game.WORLD_W), cz = Game.rand(0, Game.WORLD_H);
                const n = Game.randi(3, 9), r = Game.rand(3, 8);
                for (let i = 0; i < n; i++) {
                    add(cx + Game.rand(-r, r), cz + Game.rand(-r, r), Math.random() < 0.3);
                }
            }
            for (let i = 0; i < 40; i++) {
                add(Game.rand(0, Game.WORLD_W), Game.rand(0, Game.WORLD_H), Math.random() < 0.25);
            }
        }
        Game.damageSpots = spots;
    }

    // ── Stone arch bridge over the river (on the N-S road) ──
    // The modeled stone bridge (models/bridge_stone.glb) replaces the
    // procedural causeway once it loads; the procedural build below stays as
    // the instant visual and the fallback if the model is missing.
    if (Game.bridges && Game.bridges.length) {
        const procBridges = new THREE.Group();
        procBridges.name = 'bridges-procedural';
        Game.terrainGroup.add(procBridges);
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
            procBridges.add(deck);
            // Parapets along both road edges
            [-1, 1].forEach(s => {
                const rail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.55, span + 1.0), stoneMat);
                rail.position.set(br.cx + s * (deckW / 2 - 0.18), deckY + 0.45, br.cz);
                rail.castShadow = true;
                procBridges.add(rail);
            });
            // A small central arch springer + two abutment piers down to the water
            const archR = Math.min(span * 0.28, 1.3);
            const arch = new THREE.Mesh(
                new THREE.CylinderGeometry(archR, archR, deckW + 0.1, 14, 1, true, 0, Math.PI),
                stoneMat
            );
            arch.rotation.z = Math.PI / 2;
            arch.position.set(br.cx, Game.WATER_LEVEL + 0.05, br.cz);
            procBridges.add(arch);
            [-1, 1].forEach(s => {
                const h = Math.max(0.4, deckY - Game.WATER_LEVEL);
                const pier = new THREE.Mesh(new THREE.BoxGeometry(deckW, h, 0.7), stoneMat);
                pier.position.set(br.cx, Game.WATER_LEVEL + h / 2, br.cz + s * (span / 2 - 0.1));
                pier.castShadow = true;
                procBridges.add(pier);
            });
        });

        if (Game.gltfLoader) {
            Game.gltfLoader.load('models/bridge_stone.glb', (gltf) => {
                let src = null;
                gltf.scene.traverse(o => { if (!src && o.isMesh) src = o; });
                if (!src) return;
                const geo = src.geometry;
                if (!geo.attributes.normal) geo.computeVertexNormals();
                geo.computeBoundingBox();
                const bb = geo.boundingBox;
                const len = Math.max(0.001, bb.max.x - bb.min.x);   // model long axis = span
                const wid = Math.max(0.001, bb.max.z - bb.min.z);
                src.material.roughness = 0.95;
                src.material.metalness = 0.0;
                const group = new THREE.Group();
                group.name = 'bridges-model';
                Game.bridges.forEach(br => {
                    const m = src.clone();
                    m.castShadow = true;
                    m.receiveShadow = true;
                    const sSpan = (br.span + 1.6) / len;            // reach past both banks
                    const sWide = (2 * T + 0.8) / wid;              // cover the 2-tile road
                    const sY = sSpan * 0.5;                         // low profile: deck near road level
                    // model X axis → world Z (the road crosses the river north-south)
                    m.rotation.y = Math.PI / 2;
                    m.scale.set(sSpan, sY, sWide);
                    // Bed the ends well into the banks so the deck meets the
                    // road with no step; the arch dips into the carved channel.
                    const bankY = Math.min(
                        Game.getHeight(br.cx, br.cz - br.span / 2 - 1),
                        Game.getHeight(br.cx, br.cz + br.span / 2 + 1)
                    );
                    m.position.set(br.cx, bankY - bb.min.y * sY - 0.55, br.cz);
                    group.add(m);
                });
                Game.terrainGroup.add(group);
                Game.terrainGroup.remove(procBridges);
            }, undefined, () => { /* keep the procedural bridge */ });
        }
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

    // Fluffy grass layers (editor.js): animated blade cover on grass/wheat
    if (Game.buildFluffyGrass) Game.buildFluffyGrass();
};

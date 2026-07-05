// ── Map Maker ──────────────────────────────────────────────────────────────
// Paint tile types onto the map (brush + line tool), rebuild the world in 3D,
// bake it through the neural pipeline, and save/load it by name. A blank map
// is all grass on gently rolling ground; painted field boundaries grow real
// fences/hedges/trees on "Rebuild World" because buildTerrainMeshes derives
// all of that from the tile grid.

// Paintable palette: real tile types only (paint-only classes like 'mud' are
// derived by the texture bake, not painted directly).
Game.EDITOR_TYPES = [
    'grass', 'pasture', 'wheat', 'stubble', 'plowed', 'vineyard', 'garden',
    'orchard', 'forest', 'dense_forest', 'hedge', 'water', 'road', 'yard', 'wall',
];

Game._editor = {
    active: false,      // paint mode on (input captured)
    used: false,        // any stroke happened (include tiles in saves)
    blank: false,       // current map started as a blank canvas
    type: 'wheat',
    size: 3,            // brush radius in tiles
    soft: false,        // dithered soft edges (opt-in)
    smooth: true,       // round the stroke's tile jaggies at stroke end
    shape: 'circle',    // 'circle' | 'square'
    mode: 'freeform',   // 'freeform' (texel brush) | 'tiles'
    tool: 'brush',      // 'brush' | 'line'
    undoFree: [],       // freeform undo: override snapshots (heavier, capped)
    lineStart: null,
    lastStamp: null,    // freeflow: stamps interpolate along the drag path
    undo: [],           // stack of stroke changesets [{i, prev}]
    stroke: null,       // changes of the stroke in progress
    overlay: null,      // preview mesh
    dirtyTex: false,
};

// ── Blank canvas map: all grass, no river/village/roads ──
Game.generateBlankMap = () => {
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
    Game._waterRibbonCache = null;
    Game._waterD = null;
    Game._terrainPaint = null;
    Game.runtimeDamageSpots = [];
    Game.damageSpots = [];
    Game.villageOfs = { dx: 0, dy: 0 };
    Game.terrain = [];
    for (let y = 0; y < ROWS; y++) {
        Game.terrain[y] = [];
        for (let x = 0; x < COLS; x++) Game.terrain[y][x] = Game.makeTile('grass');
    }
    Game.missionState.objectiveX = (COLS / 2) * T;
    Game.missionState.objectiveY = (ROWS / 2) * T;
    Game.shapeHeightmap();
    Game._editor.blank = true;
};

// ── Serialize / apply the painted tile grid (for named saves) ──
Game.editorSerialize = () => {
    if (!Game._editor.used && !Game._editor.blank) return null;
    const COLS = Game.MAP_COLS, ROWS = Game.MAP_ROWS;
    const types = [];
    const index = {};
    const tiles = new Uint8Array(COLS * ROWS);
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            const t = Game.terrain[y][x].type;
            if (index[t] === undefined) {
                index[t] = types.length;
                types.push(t);
            }
            tiles[y * COLS + x] = index[t];
        }
    }
    const d = Game._terrainPaintDims;
    return {
        blank: Game._editor.blank, types, tiles,
        ov: Game._terrainPaintOverride || null,
        ovW: d ? d.W : 0, ovH: d ? d.H : 0,
        fluff: { masks: Game._fluffMasks, cfg: JSON.parse(JSON.stringify(Game.FLUFF)) },
    };
};

Game._applyEditorTiles = (ed) => {
    if (!ed || !ed.tiles || !ed.types) return;
    const COLS = Game.MAP_COLS, ROWS = Game.MAP_ROWS;
    const tiles = ed.tiles instanceof Uint8Array ? ed.tiles : new Uint8Array(ed.tiles);
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            const t = ed.types[tiles[y * COLS + x]];
            if (t && Game.terrain[y][x].type !== t) Game.terrain[y][x] = Game.makeTile(t);
        }
    }
    if (ed.ov && ed.ov.length) {
        Game._terrainPaintOverride = ed.ov instanceof Uint8Array ? ed.ov : new Uint8Array(ed.ov);
        Game._terrainPaintDims = {
            W: ed.ovW || Game.MAP_COLS * 20, H: ed.ovH || Game.MAP_ROWS * 20,
            px: (ed.ovW || Game.MAP_COLS * 20) / Game.MAP_COLS,
        };
    }
    if (ed.fluff) {
        if (ed.fluff.cfg) Game.FLUFF = ed.fluff.cfg;
        if (ed.fluff.masks) {
            Game._fluffMasks = {};
            for (const sp in ed.fluff.masks) {
                const m = ed.fluff.masks[sp];
                Game._fluffMasks[sp] = m instanceof Uint8Array ? m : new Uint8Array(m);
            }
        }
    }
    // roads/water painted after generation need their height treatment
    Game.shapeHeightmap();
    Game._editor.used = true;
    Game._editor.blank = !!ed.blank;
};

// ── Painting internals ──
// fluff pseudo-types: 'fluff|<species>|<1/0>' paint the fluff mask instead
Game._edFluffTile = (tx, ty, sp, on) => {
    if (tx < 0 || ty < 0 || tx >= Game.MAP_COLS || ty >= Game.MAP_ROWS) return;
    Game._fluffMaskFor(sp)[ty * Game.MAP_COLS + tx] = on ? 1 : 0;
    Game._editor.dirtyFluff = true;
    Game._editor.used = true;
};

Game._edSetTile = (tx, ty, type) => {
    const E = Game._editor;
    if (type && type.startsWith('fluff|')) {
        const [, sp, on] = type.split('|');
        Game._edFluffTile(tx, ty, sp, on === '1');
        return;
    }
    if (tx < 0 || ty < 0 || tx >= Game.MAP_COLS || ty >= Game.MAP_ROWS) return;
    const cur = Game.terrain[ty][tx];
    if (cur.type === type) return;
    if (E.stroke) E.stroke.push({ i: ty * Game.MAP_COLS + tx, prev: cur.type });
    Game.terrain[ty][tx] = Game.makeTile(type);
    E.used = true;
    E.dirtyTex = true;
    Game._edOverlayMark(tx, ty, type);
};
Game._edPaintTile = (tx, ty) => Game._edSetTile(tx, ty, Game._editor.type);

// Corner rounding: a majority filter over the stroke's area melts the 90°
// tile staircase on curved strokes into diagonals. Runs while the stroke is
// still recording, so Undo reverts it together with the paint.
Game._edSmoothStroke = () => {
    const E = Game._editor;
    if (!E.smooth || E.shape === 'square' || !E.stroke || !E.stroke.length) return;
    const COLS = Game.MAP_COLS, ROWS = Game.MAP_ROWS;
    let x0 = COLS, x1 = 0, y0 = ROWS, y1 = 0;
    for (const ch of E.stroke) {
        const ty = (ch.i / COLS) | 0, tx = ch.i % COLS;
        if (tx < x0) x0 = tx;
        if (tx > x1) x1 = tx;
        if (ty < y0) y0 = ty;
        if (ty > y1) y1 = ty;
    }
    x0 = Math.max(1, x0 - 2);
    y0 = Math.max(1, y0 - 2);
    x1 = Math.min(COLS - 2, x1 + 2);
    y1 = Math.min(ROWS - 2, y1 + 2);
    for (let pass = 0; pass < 2; pass++) {
        const snap = {};
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) snap[y * COLS + x] = Game.terrain[y][x].type;
        }
        const at = (x, y) => snap[y * COLS + x] ?? Game.terrain[y][x].type;
        for (let y = y0 + 1; y < y1; y++) {
            for (let x = x0 + 1; x < x1; x++) {
                const counts = {};
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (!dx && !dy) continue;
                        const t = at(x + dx, y + dy);
                        counts[t] = (counts[t] || 0) + 1;
                    }
                }
                const cur = at(x, y);
                for (const t in counts) {
                    if (t !== cur && counts[t] >= 6) {
                        Game._edSetTile(x, y, t);
                        break;
                    }
                }
            }
        }
    }
};

Game._edStamp = (tx, ty) => {
    const E = Game._editor;
    const r = Math.max(1, E.size);
    for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
            if (E.shape === 'square') {
                if (Math.max(Math.abs(dx), Math.abs(dy)) > r - 1 && r > 1) continue;
            } else {
                const d = Math.hypot(dx, dy);
                if (d > r) continue;
                if (E.soft && r > 1) {
                    // dithered falloff: solid core, increasingly sparse rim
                    const edge = d / r;
                    if (edge > 0.55 && Math.random() < (edge - 0.55) / 0.45) continue;
                }
            }
            Game._edPaintTile(tx + dx, ty + dy);
        }
    }
};

Game._edLine = (x0, y0, x1, y1) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        Game._edStamp(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t));
    }
};

// screen → tile coords via a terrain raycast
Game._edPick = (e) => {
    if (!Game.terrainMesh || !Game.camera) return null;
    const THREE = Game.THREE;
    Game._edRay = Game._edRay || new THREE.Raycaster();
    const r = Game.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1);
    Game._edRay.setFromCamera(ndc, Game.camera);
    const hit = Game._edRay.intersectObject(Game.terrainMesh)[0];
    if (!hit) return null;
    return {
        tx: Math.floor(hit.point.x / Game.TILE),
        ty: Math.floor(hit.point.z / Game.TILE),
        wx: hit.point.x,
        wz: hit.point.z,
    };
};

// ── Live preview overlay (cheap 1px-per-tile canvas above the terrain) ──
Game._edOverlayInit = () => {
    const E = Game._editor;
    if (E.overlay) return;
    const THREE = Game.THREE;
    const c = document.createElement('canvas');
    c.width = Game.MAP_COLS;
    c.height = Game.MAP_ROWS;
    E.overlayCanvas = c;
    E.overlayCtx = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(Game.WORLD_W, Game.WORLD_H),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.4, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(Game.WORLD_W / 2, (Game.WATER_LEVEL || 0.55) + 3.2, Game.WORLD_H / 2);
    mesh.renderOrder = 500;
    mesh.raycast = () => { };
    mesh.visible = false;
    mesh.name = 'editor-overlay';
    Game.scene.add(mesh);
    E.overlay = mesh;
};

Game._edOverlayMark = (tx, ty, type) => {
    const E = Game._editor;
    if (!E.overlayCtx) return;
    const col = Game.TILE_COLORS[type || E.type] ?? 0xffffff;
    E.overlayCtx.fillStyle = '#' + col.toString(16).padStart(6, '0');
    E.overlayCtx.fillRect(tx, ty, 1, 1);
    if (E.overlay) E.overlay.material.map.needsUpdate = true;
};

Game._edOverlayClear = () => {
    const E = Game._editor;
    if (!E.overlayCtx) return;
    E.overlayCtx.clearRect(0, 0, Game.MAP_COLS, Game.MAP_ROWS);
    if (E.overlay) E.overlay.material.map.needsUpdate = true;
};

// ── Freeform brush: paints the texture's texel classification directly ──
Game._edEnsureOverride = () => {
    const d = Game._terrainPaintDims || {
        W: Game.MAP_COLS * (Game.TERRAIN_TEXELS_PER_TILE || 20),
        H: Game.MAP_ROWS * (Game.TERRAIN_TEXELS_PER_TILE || 20),
        px: Game.TERRAIN_TEXELS_PER_TILE || 20,
    };
    Game._terrainPaintDims = d;
    if (!Game._terrainPaintOverride || Game._terrainPaintOverride.length !== d.W * d.H) {
        Game._terrainPaintOverride = new Uint8Array(d.W * d.H).fill(255);
    }
    return d;
};

// stamp a brush dab at a WORLD position: organic (fbm-wobbled) or hard edge
Game._edStampFree = (wx, wz) => {
    const E = Game._editor;
    if (E.type.startsWith('fluff|')) {
        const [, sp, on] = E.type.split('|');
        const T = Game.TILE;
        const tR = Math.max(1, Math.round(E.size / 2));
        const tcx = Math.floor(wx / T), tcy = Math.floor(wz / T);
        for (let ty = tcy - tR; ty <= tcy + tR; ty++) {
            for (let tx = tcx - tR; tx <= tcx + tR; tx++) {
                if (Math.hypot(tx - tcx, ty - tcy) <= tR) Game._edFluffTile(tx, ty, sp, on === '1');
            }
        }
        return;
    }
    const d = Game._edEnsureOverride();
    const T = Game.TILE;
    const typeIdx = Math.max(0, Game.EDITOR_TYPES.indexOf(E.type));
    const cx = (wx / T) * d.px;
    const cy = (wz / T) * d.px;
    const r = Math.max(2, E.size * d.px * 0.5);   // size slider ~ diameter in tiles
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r - 3)), x1 = Math.min(d.W - 1, Math.ceil(cx + r + 3));
    const y0 = Math.max(0, Math.floor(cy - r - 3)), y1 = Math.min(d.H - 1, Math.ceil(cy + r + 3));
    const ov = Game._terrainPaintOverride;
    const organic = E.soft;
    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            const dx = x - cx, dy = y - cy;
            const dd = dx * dx + dy * dy;
            if (dd > r2 * 1.35) continue;
            let rr = r;
            if (organic && Game._fbm2) {
                rr = r * (0.82 + 0.36 * Game._fbm2(x * 0.045 + 7.3, y * 0.045 - 3.1));
            }
            if (dd > rr * rr) continue;
            ov[y * d.W + x] = typeIdx;
        }
    }
    // live preview: dab the flat type colour straight onto the current texture
    const map = Game.terrainMesh && Game.terrainMesh.material.map;
    if (map && map.image && map.image.getContext) {
        const ctx = map.image.getContext('2d');
        const col = Game.TILE_COLORS[E.type] ?? 0xffffff;
        ctx.fillStyle = '#' + col.toString(16).padStart(6, '0');
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        map.needsUpdate = true;
    }
    // the tile layer follows the brush core (gameplay, water, Rebuild World)
    const tR = Math.max(0, Math.round((r * 0.7) / d.px));
    const tcx = Math.floor(wx / T), tcy = Math.floor(wz / T);
    for (let ty = tcy - tR; ty <= tcy + tR; ty++) {
        for (let tx = tcx - tR; tx <= tcx + tR; tx++) {
            if (Math.hypot(tx - tcx, ty - tcy) <= tR) Game._edSetTile(tx, ty, E.type);
        }
    }
    E.used = true;
    E.dirtyTex = true;
};

Game._edLineFree = (a, b) => {
    const d = Game._edEnsureOverride();
    const step = Math.max(0.5, (Game._editor.size * Game.TILE * 0.5) / 2);
    const len = Math.hypot(b.wx - a.wx, b.wz - a.wz);
    const n = Math.max(1, Math.ceil(len / step));
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        Game._edStampFree(a.wx + (b.wx - a.wx) * t, a.wz + (b.wz - a.wz) * t);
    }
};

Game._edFreeUndoPush = () => {
    const E = Game._editor;
    if (!Game._terrainPaintOverride) return;
    E.undoFree.push({
        ov: Game._terrainPaintOverride.slice(),
        tiles: Game.editorSerialize(),
    });
    if (E.undoFree.length > 8) E.undoFree.shift();
};

// ── Hover cursor: outline of exactly where the brush will land ──
Game._edCursorInit = () => {
    const E = Game._editor;
    if (E.cursor) return;
    const THREE = Game.THREE;
    const mk = (pts) => {
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({
            color: 0xffe066, transparent: true, opacity: 0.9, depthTest: false,
        }));
        line.renderOrder = 900;
        line.raycast = () => { };
        line.visible = false;
        Game.scene.add(line);
        return line;
    };
    const circlePts = [];
    for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        circlePts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
    }
    const squarePts = [
        new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 0, -1),
        new THREE.Vector3(1, 0, 1), new THREE.Vector3(-1, 0, 1),
    ];
    E.cursor = { circle: mk(circlePts), square: mk(squarePts) };
};

Game._edCursorUpdate = (e) => {
    const E = Game._editor;
    if (!E.cursor) Game._edCursorInit();
    const both = [E.cursor.circle, E.cursor.square];
    if (!E.active) { both.forEach(m => m.visible = false); return; }
    const p = Game._edPick(e);
    if (!p) { both.forEach(m => m.visible = false); return; }
    const T = Game.TILE;
    const wx = (p.tx + 0.5) * T, wz = (p.ty + 0.5) * T;
    const y = (Game.getHeight ? Game.getHeight(wx, wz) : 0) + 0.5;
    const r = Math.max(1, E.size) * T;
    const active = E.shape === 'square' ? E.cursor.square : E.cursor.circle;
    const other = E.shape === 'square' ? E.cursor.circle : E.cursor.square;
    other.visible = false;
    active.visible = true;
    active.position.set(wx, y, wz);
    active.scale.set(r, 1, r);
};

// ── Texture refresh (stroke end): repaint the terrain texture from tiles ──
Game.editorRefreshTexture = () => {
    const E = Game._editor;
    if (E.dirtyFluff) {
        E.dirtyFluff = false;
        Game.buildFluffyGrass();
    }
    if (!E.dirtyTex || !Game.terrainMesh) return;
    E.dirtyTex = false;
    Game._terrainPaint = null;   // classification follows the edited tiles
    const old = Game.terrainMesh.material.map;
    Game.terrainMesh.material.map = Game.buildTerrainTexture();
    Game.terrainMesh.material.needsUpdate = true;
    if (old && old.dispose) old.dispose();
    Game._edOverlayClear();
};

// ── Full 3D rebuild on current tiles: fences/walls/trees/water plane ──
Game.editorRebuildWorld = () => {
    const seen = new Set();
    const disposeMat = (m) => {
        if (!m || seen.has(m)) return;
        seen.add(m);
        for (const k in m) {
            const v = m[k];
            if (v && v.isTexture && !seen.has(v)) { seen.add(v); v.dispose(); }
        }
        m.dispose();
    };
    Game.terrainGroup.traverse((o) => {
        if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(disposeMat);
    });
    Game._terrainPaint = null;
    Game._waterD = null;
    Game._waterRibbonCache = null;
    Game.shapeHeightmap();
    Game.buildTerrainMeshes();
    Game._editor.dirtyTex = false;
    Game._edOverlayClear();
    Game._editor.overlay = null;   // scene graph was rebuilt around it
    Game._edOverlayInit();
};

// ── Input capture (only while paint mode is on) ──
{
    const E = Game._editor;
    let painting = false;
    const canvasOf = () => Game.renderer && Game.renderer.domElement;

    const down = (e) => {
        if (!E.active || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const p = Game._edPick(e);
        if (!p) return;
        if (E.tool === 'line') {
            if (!E.lineStart) {
                E.lineStart = p;
                if (E.mode !== 'freeform') Game._edOverlayMark(p.tx, p.ty);
            } else {
                E.stroke = [];
                if (E.mode === 'freeform') {
                    Game._edFreeUndoPush();
                    Game._edLineFree(E.lineStart, p);
                } else {
                    Game._edLine(E.lineStart.tx, E.lineStart.ty, p.tx, p.ty);
                    if (E.stroke.length) E.undo.push(E.stroke);
                }
                E.stroke = null;
                E.lineStart = null;
                Game.editorRefreshTexture();
            }
            return;
        }
        painting = true;
        E.stroke = [];
        E.lastStamp = p;
        if (E.mode === 'freeform') {
            Game._edFreeUndoPush();
            Game._edStampFree(p.wx, p.wz);
        } else {
            Game._edStamp(p.tx, p.ty);
        }
    };
    const move = (e) => {
        if (E.active) Game._edCursorUpdate(e);
        if (!E.active || !painting) return;
        e.preventDefault();
        e.stopPropagation();
        const p = Game._edPick(e);
        if (!p) return;
        // freeflow: fill the whole path since the last event, so fast drags
        // paint smooth continuous curves instead of scattered stamps
        if (E.mode === 'freeform') {
            if (E.lastStamp) Game._edLineFree(E.lastStamp, p);
            else Game._edStampFree(p.wx, p.wz);
        } else if (E.lastStamp) {
            Game._edLine(E.lastStamp.tx, E.lastStamp.ty, p.tx, p.ty);
        } else {
            Game._edStamp(p.tx, p.ty);
        }
        E.lastStamp = p;
    };
    const up = (e) => {
        if (!E.active || !painting) return;
        e.preventDefault();
        e.stopPropagation();
        painting = false;
        E.lastStamp = null;
        if (E.mode !== 'freeform') Game._edSmoothStroke();
        if (E.stroke && E.stroke.length) {
            E.undo.push(E.stroke);
            if (E.undo.length > 25) E.undo.shift();
        }
        E.stroke = null;
        Game.editorRefreshTexture();
        if (E.type === 'water' || E.type === 'road' || E.type === 'forest'
            || E.type === 'dense_forest' || E.type === 'hedge' || E.type === 'wall') {
            const st = document.getElementById('dbgEdStatus');
            if (st) st.textContent = 'press Rebuild World to give ' + E.type + ' its full 3D shape';
        }
    };

    // capture phase, so game orders/selection never see painting clicks.
    // Attached lazily: the game canvas doesn't exist until the mission starts.
    let attached = false;
    Game._edAttachInput = () => {
        if (attached) return;
        const c = canvasOf();
        if (!c) return;
        attached = true;
        c.addEventListener('mousedown', down, true);
        c.addEventListener('mousemove', move, true);
        window.addEventListener('mouseup', up, true);
    };

    Game.editorUndo = () => {
        if (E.mode === 'freeform') {
            const snap = E.undoFree.pop();
            if (!snap) return;
            Game._terrainPaintOverride = snap.ov;
            if (snap.tiles) Game._applyEditorTiles(snap.tiles);
            E.dirtyTex = true;
            Game.editorRefreshTexture();
            return;
        }
        const changes = E.undo.pop();
        if (!changes) return;
        for (const ch of changes) {
            const ty = (ch.i / Game.MAP_COLS) | 0, tx = ch.i % Game.MAP_COLS;
            Game.terrain[ty][tx] = Game.makeTile(ch.prev);
        }
        E.dirtyTex = true;
        Game.editorRefreshTexture();
    };
}


// ── Fluffy grass ───────────────────────────────────────────────────────────
// Animated instanced blade cover, inspired by thebenezer/FluffyGrass but
// implemented from scratch (tapered crossed quads, vertex-shader sway, base
// to tip colour gradient). Species-based: each species auto-covers its tile
// types and can be painted on/off per tile via the Map Maker brush.
Game.FLUFF = {
    enabled: true,
    species: {
        grass: {
            tiles: ['grass', 'pasture'], geo: 'blade', density: 155, height: 0.34,
            heightVar: 0.45, width: 1.7, lean: 0.18, patch: 0.15, colorVar: 0.2,
            matchGround: true,
            wave: 0.32, swaySpeed: 1.2, swayAmp: 0.14, base: '#96a07f', tip: '#ffffff',
        },
        wheat: {
            tiles: ['wheat'], geo: 'stalk', density: 130, height: 0.6,
            heightVar: 0.2, width: 1.2, lean: 0.08, patch: 0.05, colorVar: 0.15,
            matchGround: true,
            wave: 0.24, swaySpeed: 0.9, swayAmp: 0.18, base: '#d6cfbe', tip: '#ffe9a8',
        },
    },
};
Game._fluffMasks = {};   // per species Uint8: 255 auto, 1 painted on, 0 painted off
Game._fluffMats = {};

Game._fluffMaskFor = (sp) => {
    const n = Game.MAP_COLS * Game.MAP_ROWS;
    if (!Game._fluffMasks[sp] || Game._fluffMasks[sp].length !== n) {
        Game._fluffMasks[sp] = new Uint8Array(n).fill(255);
    }
    return Game._fluffMasks[sp];
};

Game._fluffBladeGeo = (kind) => {
    Game._fluffGeos = Game._fluffGeos || {};
    if (Game._fluffGeos[kind]) return Game._fluffGeos[kind];
    const THREE = Game.THREE;
    // two crossed tapered quads, 3 vertex rows each; profile per species:
    // grass = thin blade tapering to a point, wheat = thin stalk that
    // widens into a seed head at the top
    const profiles = {
        blade: { half: 0.032, rows: [[0, 1.0], [0.55, 0.55], [1.0, 0.1]] },
        stalk: { half: 0.05, rows: [[0, 0.45], [0.72, 0.4], [1.0, 1.0]] },
    };
    const pr = profiles[kind] || profiles.blade;
    const pos = [], uv = [], idx = [];
    for (let plane = 0; plane < 2; plane++) {
        const b = plane * 6;
        for (const [y, w] of pr.rows) {
            const hw = pr.half * w;
            if (plane === 0) {
                pos.push(-hw, y, 0, hw, y, 0);
            } else {
                pos.push(0, y, -hw, 0, y, hw);
            }
            uv.push(0, y, 1, y);
        }
        idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3, b + 2, b + 3, b + 4, b + 4, b + 3, b + 5);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    Game._fluffGeos[kind] = g;
    return g;
};

Game._fluffMaterial = (sp) => {
    const THREE = Game.THREE;
    const cfg = Game.FLUFF.species[sp];
    const U = {
        uTime: { value: 0 },
        uSpeed: { value: cfg.swaySpeed },
        uAmp: { value: cfg.swayAmp },
        uWave: { value: cfg.wave != null ? cfg.wave : 0.32 },
        uBase: { value: new THREE.Color(cfg.base) },
        uTip: { value: new THREE.Color(cfg.tip) },
    };
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, U);
        sh.vertexShader = 'uniform float uTime;\nuniform float uSpeed;\nuniform float uAmp;\nuniform float uWave;\nvarying float vTip;\n'
            + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vTip = uv.y;
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float ph = ip.x * uWave + ip.z * uWave * 0.77;
        float tf = uv.y * uv.y;
        transformed.x += sin(uTime * uSpeed + ph) * uAmp * tf;
        transformed.z += cos(uTime * uSpeed * 0.83 + ph * 1.31) * uAmp * 0.6 * tf;`);
        sh.fragmentShader = 'uniform vec3 uBase;\nuniform vec3 uTip;\nvarying float vTip;\n'
            + sh.fragmentShader.replace('#include <color_fragment>',
                '#include <color_fragment>\n\tdiffuseColor.rgb *= mix(uBase, uTip, vTip);');
    };
    mat.userData.uniforms = U;
    Game._fluffMats[sp] = U;
    return mat;
};

Game.buildFluffyGrass = () => {
    const THREE = Game.THREE;
    if (!THREE || !Game.terrainGroup) return;
    // Fluffiness trick: blades TINT TO THE GROUND under them (then lighten
    // toward the tip via the gradient), so they merge into a shaggy volume
    // instead of reading as dark sprigs on a lighter texture.
    let ground = null, gw = 0, gh = 0;
    const mapTex = Game.terrainMesh && Game.terrainMesh.material.map;
    if (mapTex && mapTex.image && mapTex.image.getContext) {
        gw = mapTex.image.width;
        gh = mapTex.image.height;
        try {
            ground = mapTex.image.getContext('2d').getImageData(0, 0, gw, gh).data;
        } catch (e) { ground = null; }
    }
    for (const sp in Game.FLUFF.species) {
        const old = Game.terrainGroup.getObjectByName('fluffy-grass-' + sp);
        if (old) {
            // geometry is the shared blade prototype — dispose material only
            old.material.dispose();
            Game.terrainGroup.remove(old);
        }
        if (!Game.FLUFF.enabled) continue;
        const cfg = Game.FLUFF.species[sp];
        const mask = Game._fluffMaskFor(sp);
        const auto = new Set(cfg.tiles);
        const T = Game.TILE;
        // effective type at an exact world point: the freeform paint override
        // wins over the tile, so blades follow brushwork texel-accurately
        const dims = Game._terrainPaintDims;
        const ov = Game._terrainPaintOverride;
        const typeAt = (wx, wz, fallback) => {
            if (ov && dims) {
                const xi = Math.min(dims.W - 1, Math.max(0, ((wx / T) * dims.px) | 0));
                const yi = Math.min(dims.H - 1, Math.max(0, ((wz / T) * dims.px) | 0));
                const v = ov[yi * dims.W + xi];
                if (v !== 255) return Game.EDITOR_TYPES[v] || fallback;
            }
            return fallback;
        };
        // pre-count eligible tiles so dense settings thin per-tile up front
        // instead of building millions of spots and culling after (an O(n^2)
        // splice here froze the browser on all-grass blank maps)
        const CAP = 600000;
        let eligible = 0;
        for (let ty = 0; ty < Game.MAP_ROWS; ty++) {
            for (let tx = 0; tx < Game.MAP_COLS; tx++) {
                const st = mask[ty * Game.MAP_COLS + tx];
                if (st === 0) continue;
                if (st === 1 || auto.has(Game.terrain[ty][tx].type) || ov) eligible++;
            }
        }
        if (!eligible) continue;
        const density = Math.min(cfg.density, CAP / eligible);
        const spots = [];
        for (let ty = 0; ty < Game.MAP_ROWS; ty++) {
            for (let tx = 0; tx < Game.MAP_COLS; tx++) {
                const st = mask[ty * Game.MAP_COLS + tx];
                if (st === 0) continue;
                const tileType = Game.terrain[ty][tx].type;
                // fast path: tile can't match and no paint override exists
                if (st !== 1 && !auto.has(tileType) && !ov) continue;
                let n = Math.floor(density);
                if (Math.random() < density - n) n++;
                for (let k = 0; k < n; k++) {
                    const x = (tx + Math.random()) * T;
                    const z = (ty + Math.random()) * T;
                    if (st !== 1 && !auto.has(typeAt(x, z, tileType))) continue;
                    // patchiness: fbm-thinned clearings for natural meadows
                    if (cfg.patch > 0 && Game._fbm2
                        && Game._fbm2(x * 0.09 + 3.1, z * 0.09 - 8.7) < cfg.patch) continue;
                    spots.push({ x, z });
                }
            }
        }
        if (!spots.length) continue;
        const inst = new THREE.InstancedMesh(Game._fluffBladeGeo(cfg.geo || 'blade'), Game._fluffMaterial(sp), spots.length);
        inst.name = 'fluffy-grass-' + sp;
        inst.raycast = () => { };
        const dummy = new THREE.Object3D();
        const icol = new THREE.Color();
        const hv = cfg.heightVar != null ? cfg.heightVar : 0.45;
        const lean = cfg.lean || 0;
        const w = cfg.width || 1;
        const cv = cfg.colorVar || 0;
        const match = cfg.matchGround !== false && !!ground;
        const WW = Game.WORLD_W, WH = Game.WORLD_H;
        for (let i = 0; i < spots.length; i++) {
            const p = spots[i];
            const h = cfg.height * (1 - hv / 2 + Math.random() * hv);
            dummy.position.set(p.x, (Game.getHeight ? Game.getHeight(p.x, p.z) : 0) - 0.02, p.z);
            dummy.rotation.set((Math.random() - 0.5) * 2 * lean, Math.random() * Math.PI * 2,
                (Math.random() - 0.5) * 2 * lean);
            dummy.scale.set(w, h, w);
            dummy.updateMatrix();
            inst.setMatrixAt(i, dummy.matrix);
            let vr = 1;
            if (cv > 0) vr = 1 - cv / 2 + Math.random() * cv;
            if (match) {
                const gx = Math.min(gw - 1, Math.max(0, ((p.x / WW) * gw) | 0));
                const gy = Math.min(gh - 1, Math.max(0, ((p.z / WH) * gh) | 0));
                const gi = (gy * gw + gx) * 4;
                // slight lift so the shaggy layer reads above the flat paint
                icol.setRGB(
                    Math.min(1, (ground[gi] / 255) * 1.12 * vr),
                    Math.min(1, (ground[gi + 1] / 255) * 1.12 * vr),
                    Math.min(1, (ground[gi + 2] / 255) * 1.12 * vr));
                inst.setColorAt(i, icol);
            } else if (cv > 0) {
                icol.setScalar(vr);
                inst.setColorAt(i, icol);
            }
        }
        inst.instanceMatrix.needsUpdate = true;
        if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
        const U = Game._fluffMats[sp];
        inst.onBeforeRender = () => { U.uTime.value = performance.now() / 1000; };
        Game.terrainGroup.add(inst);
    }
};

// ── Panel wiring ──
{
    const E = Game._editor;
    const $ = (id) => document.getElementById(id);
    const say = (t) => { const el = $('dbgEdStatus'); if (el) el.textContent = t; };

    $('dbgEdPaint')?.addEventListener('click', () => {
        const B = Game._neuralBake;
        if (!E.active && B && B.applied) { say('Restore Terrain first, then paint'); return; }
        E.active = !E.active;
        $('dbgEdPaint').textContent = E.active ? 'Painting: ON' : 'Painting: OFF';
        if (E.active) {
            Game._edAttachInput();
            Game._paused = true;
            Game._edOverlayInit();
            if (E.overlay) E.overlay.visible = E.mode !== 'freeform';
            say('left-drag paints; camera keys still work');
        } else {
            E.lineStart = null;
            if (E.overlay) E.overlay.visible = false;
            if (E.cursor) { E.cursor.circle.visible = false; E.cursor.square.visible = false; }
            Game.editorRefreshTexture();
            say('');
        }
    });

    $('dbgEdType')?.addEventListener('change', (e) => { E.type = e.target.value; });
    $('dbgEdSize')?.addEventListener('input', (e) => {
        E.size = parseInt(e.target.value, 10);
        const v = $('dbgEdSizeVal');
        if (v) v.textContent = e.target.value;
    });
    $('dbgEdSoft')?.addEventListener('change', (e) => { E.soft = e.target.checked; });
    $('dbgEdShape')?.addEventListener('change', (e) => { E.shape = e.target.value; });
    $('dbgEdMode')?.addEventListener('change', (e) => { E.mode = e.target.value; });
    $('dbgEdSmooth')?.addEventListener('change', (e) => { E.smooth = e.target.checked; });
    $('dbgEdTool')?.addEventListener('change', (e) => {
        E.tool = e.target.value;
        E.lineStart = null;
        say(E.tool === 'line' ? 'line: click start, then click end' : '');
    });
    $('dbgEdUndo')?.addEventListener('click', () => { Game.editorUndo(); });
    $('dbgEdRebuild')?.addEventListener('click', () => {
        say('rebuilding world...');
        setTimeout(() => { Game.editorRebuildWorld(); say('world rebuilt'); }, 30);
    });
    $('dbgEdBlank')?.addEventListener('click', () => {
        const B = Game._neuralBake;
        if (B && B.applied) { say('Restore Terrain first'); return; }
        // guard against fat-fingering away the current map: explicit opt-in,
        // dismissing the dialog keeps everything
        if (!window.confirm('Replace the current map with a blank canvas?\nUnsaved painting will be lost.')) {
            say('kept the current map');
            return;
        }
        say('generating blank map...');
        setTimeout(() => {
            Game._beginMapSeed((Math.random() * 0xffffffff) >>> 0);
            Game.loadHeightmap();
            Game.generateBlankMap();
            Game._endMapSeed();
            Game.editorRebuildWorld();
            E.used = true;
            say('blank map ready — paint away');
        }, 30);
    });

    // fill the palette (+ fluff mask pseudo-brushes)
    const sel = $('dbgEdType');
    if (sel) {
        for (const t of Game.EDITOR_TYPES) {
            const o = document.createElement('option');
            o.value = t;
            o.textContent = t.replace('_', ' ');
            if (t === E.type) o.selected = true;
            sel.appendChild(o);
        }
        for (const sp of Object.keys(Game.FLUFF.species)) {
            for (const on of [1, 0]) {
                const o = document.createElement('option');
                o.value = 'fluff|' + sp + '|' + on;
                o.textContent = (on ? '+ ' : '- ') + sp + ' fluff';
                sel.appendChild(o);
            }
        }
    }

    // fluff controls: per-species settings, live where possible
    {
        const spSel = $('dbgFluffSpecies');
        const cfgOf = () => Game.FLUFF.species[spSel ? spSel.value : 'grass'];
        const num = (id, key, live) => {
            const el = $(id);
            if (!el) return;
            el.addEventListener('input', () => {
                const v = parseFloat(el.value);
                const vs = $(id + 'Val');
                if (vs) vs.textContent = el.value;
                cfgOf()[key] = v;
                if (live) {
                    const U = Game._fluffMats[spSel.value];
                    if (U) {
                        if (key === 'swaySpeed') U.uSpeed.value = v;
                        if (key === 'swayAmp') U.uAmp.value = v;
                        if (key === 'wave') U.uWave.value = v;
                    }
                } else {
                    clearTimeout(Game._fluffRebuildT);
                    Game._fluffRebuildT = setTimeout(() => Game.buildFluffyGrass(), 350);
                }
            });
        };
        const col = (id, key, uniform) => {
            const el = $(id);
            if (!el) return;
            el.addEventListener('input', () => {
                cfgOf()[key] = el.value;
                const U = Game._fluffMats[spSel.value];
                if (U) U[uniform].value.set(el.value);
            });
        };
        const load = () => {
            const c = cfgOf();
            const set = (id, v) => {
                const el = $(id);
                if (el) el.value = v;
                const vs = $(id + 'Val');
                if (vs) vs.textContent = v;
            };
            set('dbgFluffDensity', c.density);
            set('dbgFluffHeight', c.height);
            set('dbgFluffHVar', c.heightVar);
            set('dbgFluffWidth', c.width);
            set('dbgFluffLean', c.lean);
            set('dbgFluffPatch', c.patch);
            set('dbgFluffCVar', c.colorVar);
            set('dbgFluffSpeed', c.swaySpeed);
            set('dbgFluffAmp', c.swayAmp);
            set('dbgFluffWave', c.wave);
            set('dbgFluffBase', c.base);
            set('dbgFluffTip', c.tip);
            const m = $('dbgFluffMatch');
            if (m) m.checked = c.matchGround !== false;
        };
        spSel?.addEventListener('change', load);
        num('dbgFluffDensity', 'density', false);
        num('dbgFluffHeight', 'height', false);
        num('dbgFluffHVar', 'heightVar', false);
        num('dbgFluffWidth', 'width', false);
        num('dbgFluffLean', 'lean', false);
        num('dbgFluffPatch', 'patch', false);
        num('dbgFluffCVar', 'colorVar', false);
        num('dbgFluffSpeed', 'swaySpeed', true);
        num('dbgFluffAmp', 'swayAmp', true);
        num('dbgFluffWave', 'wave', true);
        col('dbgFluffBase', 'base', 'uBase');
        col('dbgFluffTip', 'tip', 'uTip');
        $('dbgFluffMatch')?.addEventListener('change', (e) => {
            cfgOf().matchGround = e.target.checked;
            clearTimeout(Game._fluffRebuildT);
            Game._fluffRebuildT = setTimeout(() => Game.buildFluffyGrass(), 200);
        });
        $('dbgFluffOn')?.addEventListener('change', (e) => {
            Game.FLUFF.enabled = e.target.checked;
            Game.buildFluffyGrass();
        });
        if (spSel) load();
    }
}

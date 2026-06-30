/**
 * Under Fire — buildings.js
 * Model-driven buildings with damage states.
 *
 * Each building in Game.buildings gets a record with HP and a damage level
 * (0 undamaged → 3 destroyed). A shared GLB (Draco-compressed) supplies the
 * visual; the damage states are separate named meshes inside it
 * (House_0_undam / House_1 / House_2 / House_3*) that we toggle by visibility.
 * Tanks, grenades, shells and air strikes damage a building through
 * Game.damageBuildingAt (hooked into the blast system); enough damage steps the
 * level and finally collapses it to rubble.
 *
 * The procedural wall+roof+chimney built in terrain.js stays as the fallback:
 * it is shown immediately, then replaced when the model finishes loading (and
 * kept if the load fails — keeps the game degradable per the golden rules).
 *
 * Drop a fuller export (with House_1/2/3 meshes) at the same path and the
 * intermediate states light up automatically — no code change needed.
 */

Game.BUILDING_MODEL = 'models/fr_shop_house_1_states.glb';
// State meshes are matched by name PREFIX, so suffix variants (House_3 vs
// House_3_heavy) and the "_undam" tag all resolve.
Game.BUILDING_STATES = ['House_0', 'House_1', 'House_2', 'House_3'];
// Tougher buildings: ~a few hits to crack to the first damage state, and a lot
// more to reach the wrecked state (HP/4 per band at 100/75/50/25%).
Game.BUILDING_MAX_HP = 460;
// Houses are placed at ONE fixed scale (no per-footprint resizing/stretching).
// The GLB is exported ~1 world-unit wide, so this is the in-world house size.
Game.BUILDING_SCALE = 8.58;   // houses +30% on the prior 6.6 (orig 5.5)
Game._buildingSmokeScale = 1;   // debug "Smoke ×" — scales hit/destruction smoke
Game._buildingDmgMult = 1;      // debug "Damage ×" — scales damage dealt to buildings
Game.buildingRecords = [];

// Register one building (called from the terrain build loop). procMeshes are the
// procedural fallback meshes already added to bGroup.
Game.registerBuilding = (b, bGroup, dims, procMeshes) => {
    // Garrison capacity scales with footprint: bigger building holds more troops.
    const area = (b.tw || 1) * (b.th || 1);
    const cap = Game.clamp ? Game.clamp(Math.round(area * 1.5), 2, 12) : Math.max(2, Math.min(12, Math.round(area * 1.5)));
    const rec = {
        b, group: bGroup,
        w: dims.w, d: dims.d, cx: dims.cx, cz: dims.cz, baseY: dims.baseY,
        hp: Game.BUILDING_MAX_HP, maxHp: Game.BUILDING_MAX_HP, level: 0,
        procMeshes: procMeshes || [], houses: [], collapsed: false,
        capacity: cap, occupants: [],   // garrison: unit ids currently inside
    };
    b._rec = rec;
    if (bGroup) bGroup.userData.buildingRec = rec;   // for click-to-target
    Game.buildingRecords.push(rec);
    return rec;
};

// Load the shared building GLB once, then swap each building's procedural mesh
// for a model instance. Falls back to the procedural houses on any failure.
Game._loadBuildingModels = () => {
    if (!Game.buildingRecords.length || !Game.loadModel) return;
    Game.loadModel(Game.BUILDING_MODEL).then(model => {
        Game.buildingRecords.forEach(rec => {
            try { Game._populateBuildingModel(rec, model); }
            catch (e) { console.warn('building model populate failed:', e); }
        });
    }).catch(err => {
        console.warn('Building model load failed — keeping procedural houses:', err);
    });
};

// Instance the model into a building. Elongated footprints get a ROW of houses
// (a little street) instead of one stretched house; each house gets rotation
// variety (front/back flips + slight yaw + size jitter) so you see different
// faces. Every house in the row collects its own damage-state meshes and they
// damage/collapse together (one HP pool per footprint).
Game._populateBuildingModel = (rec, srcModel) => {
    const THREE = Game.THREE;
    const collectStates = (model) => Game.BUILDING_STATES.map(prefix => {
        let found = null;
        model.traverse(o => { if (!found && o.name && o.name.indexOf(prefix) === 0) found = o; });
        return found;
    });

    // Measure the model's native footprint (frontage X, depth Z) once.
    const first = Game._cloneModel ? Game._cloneModel(srcModel) : srcModel.clone();
    first.scale.set(1, 1, 1); first.rotation.set(0, 0, 0); first.position.set(0, 0, 0);
    first.updateMatrixWorld(true);
    const nb = new THREE.Box3().setFromObject(first);
    const mw = Math.max(1e-3, nb.max.x - nb.min.x);
    const md = Math.max(1e-3, nb.max.z - nb.min.z);

    const longAxisIsX = rec.w >= rec.d;
    const longLen = Math.max(rec.w, rec.d);
    // Fixed house size (NO per-footprint resizing). Tile as many fixed-size
    // houses as the footprint's long side fits — a row/street for big footprints.
    const S = Game.BUILDING_SCALE;
    const houseW = Math.max(0.5, S * mw);           // frontage in world units
    // Only as many houses as FIT without overlapping (floor, not round) and place
    // them exactly one house-width apart. Overlapping houses z-fight on their
    // roofs/walls, which looks like phantom "damage" / a doubled building.
    const count = Math.max(1, Math.floor(longLen / houseW + 0.05));
    const cell = houseW;                             // edge-to-edge, never overlap

    rec.houses = [];
    for (let k = 0; k < count; k++) {
        const model = (k === 0) ? first : (Game._cloneModel ? Game._cloneModel(srcModel) : srcModel.clone());
        model.scale.set(1, 1, 1); model.rotation.set(0, 0, 0); model.position.set(0, 0, 0);

        // Frontage (model X) runs along the row; flip 180° at random for variety,
        // plus a little yaw jitter so the row isn't mechanical (rotation only).
        let rotY = longAxisIsX ? 0 : Math.PI / 2;
        if (Math.random() < 0.5) rotY += Math.PI;
        rotY += Game.rand(-0.08, 0.08);
        model.rotation.y = rotY;

        model.scale.setScalar(S);                   // one fixed size for every house

        // Recentre + ground-snap, then place at the building's WORLD centre and
        // slot into the cell along the long axis. (bGroup sits at the origin, so
        // model-local == world — we add the footprint centre + ground height.)
        model.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(model);
        model.position.x += rec.cx - (bb.min.x + bb.max.x) / 2;
        model.position.z += rec.cz - (bb.min.z + bb.max.z) / 2;
        model.position.y += rec.baseY - bb.min.y;
        const off = (k - (count - 1) / 2) * cell;
        const jit = Game.rand(-0.18, 0.18);
        if (longAxisIsX) { model.position.x += off; model.position.z += jit; }
        else { model.position.z += off; model.position.x += jit; }

        model.traverse(o => {
            // Cast onto the ground, but DON'T receive — self-shadowing the roof
            // produced acne that read as phantom damage on some orientations.
            if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; }
        });
        // (screenToGround only raycasts terrain, and units live in a separate
        // group, so leaving these pickable lets click-to-target the house work
        // without interfering with move/unit picking.)
        rec.group.add(model);
        rec.houses.push({ root: model, states: collectStates(model) });
    }

    // Clean the grime baked onto the UNDAMAGED roof texture (the "fake damage"
    // that showed on whichever slope faced the camera). Processed once, cached,
    // and shared across every house. Damage states keep their own textures.
    if (Game.BUILDING_ROOF_DECLEAN && Game._cleanRoofGrime) {
        rec.houses.forEach(h => {
            const node = h.states && h.states[0];
            if (!node) return;
            node.traverse(o => {
                if (!o.isMesh || !o.material) return;
                const ms = Array.isArray(o.material) ? o.material : [o.material];
                ms.forEach(m => {
                    if (!m.map) return;
                    if (!Game._roofTexClean) {
                        const cleaned = Game._cleanRoofGrime(m.map);
                        if (cleaned) Game._roofTexClean = cleaned;
                    }
                    if (Game._roofTexClean) { m.map = Game._roofTexClean; m.needsUpdate = true; }
                });
            });
        });
    }

    // Hide the procedural fallback now that the model row is in.
    rec.procMeshes.forEach(m => { m.visible = false; });
    Game.setBuildingDamage(rec, rec.level);
};

// The undamaged building texture has grime/AO baked onto the terracotta roof,
// which reads as fake "damage" on whichever slope faces the camera. Clean it:
// detect the reddish ROOF pixels (grey walls + dark windows are left alone) and
// lift the dark grimy ones toward the roof's median tone. Returns a CanvasTexture.
Game.BUILDING_ROOF_DECLEAN = 0.7;   // 0 = off (show baked grime), 1 = fully flatten
Game._cleanRoofGrime = (tex) => {
    const strength = Game.BUILDING_ROOF_DECLEAN;
    if (!tex || !tex.image || !strength) return null;
    const img = tex.image;
    const w = img.width || img.videoWidth, h = img.height || img.videoHeight;
    if (!w || !h) return null;
    try {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const cx = c.getContext('2d', { willReadFrequently: true });
        cx.drawImage(img, 0, 0, w, h);
        const id = cx.getImageData(0, 0, w, h), a = id.data;
        const isRoof = (r, g, b) => (r > g + 12 && r > b + 22 && r > 70);
        let sum = 0, n = 0;
        for (let i = 0; i < a.length; i += 4) {
            const r = a[i], g = a[i + 1], b = a[i + 2];
            if (isRoof(r, g, b)) { sum += 0.299 * r + 0.587 * g + 0.114 * b; n++; }
        }
        if (!n) return null;
        const target = sum / n;
        for (let i = 0; i < a.length; i += 4) {
            const r = a[i], g = a[i + 1], b = a[i + 2];
            if (!isRoof(r, g, b)) continue;
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            if (lum >= target) continue;
            const k = 1 + ((target - lum) / Math.max(20, lum)) * strength;
            a[i] = Math.min(255, r * k); a[i + 1] = Math.min(255, g * k); a[i + 2] = Math.min(255, b * k);
        }
        cx.putImageData(id, 0, 0);
        const t = new Game.THREE.CanvasTexture(c);
        t.wrapS = tex.wrapS; t.wrapT = tex.wrapT; t.flipY = tex.flipY;
        if ('colorSpace' in tex) t.colorSpace = tex.colorSpace;
        t.anisotropy = tex.anisotropy || 1; t.needsUpdate = true;
        return t;
    } catch (e) { console.warn('roof grime clean failed:', e); return null; }
};

// Show the right damage-state mesh for a level. With states missing, show the
// highest available state at or below the level (so a single-state model just
// stays undamaged until destroyed). Level 3 with no House_3 mesh collapses.
Game.setBuildingDamage = (rec, level) => {
    level = Game.clamp ? Game.clamp(Math.round(level), 0, 3) : Math.max(0, Math.min(3, Math.round(level)));
    rec.level = level;
    (rec.houses || []).forEach(h => {
        let shown = -1;
        for (let i = 0; i <= level; i++) if (h.states[i]) shown = i;
        h.states.forEach((m, i) => { if (m) m.visible = (i === shown); });
    });
    const noHeavyState = (rec.houses || []).every(h => !h.states[3]);
    if (level >= 3 && noHeavyState) {
        Game._scheduleCollapse(rec);
    } else if (level >= 3 && !rec._destroyedFx) {
        // Heavy-damage state mesh exists — show it, plus a one-time big burst.
        rec._destroyedFx = true;
        Game._buildingDestroyedSmoke(rec);
        Game.pushMessage('Building wrecked!', 1.6);
    }
};

// FX §11.3: a wrecked structure doesn't drop instantly. Stage the collapse —
// a structural groan + initial debris now, then the full collapse 0.5-2.5s
// later (driven by Game.updateBuildings). The building keeps blocking sight
// until it actually comes down.
Game._scheduleCollapse = (rec) => {
    if (rec.collapsed || rec._collapsePending != null) return;
    rec._collapsePending = 0.5 + Math.random() * 2.0;
    const sc = Game._buildingSmokeScale || 1;
    for (let i = 0; i < Math.max(2, Math.round(3 * sc)); i++) {
        Game.smoke.push({
            x: rec.cx + Game.rand(-rec.w * 0.4, rec.w * 0.4),
            z: rec.cz + Game.rand(-rec.d * 0.4, rec.d * 0.4),
            r: 1.2 * sc, life: 1.4, total: 1.4,
            vx: Game.rand(-0.2, 0.2), vz: Game.rand(-0.3, -0.1),
            rise: 1.6, maxOpacity: 0.5, mesh: null,
        });
    }
    if (Game.pushMessage) Game.pushMessage('Building collapsing!', 1.4);
};

// Tick pending collapses (called from the game loop).
Game.updateBuildings = (dt) => {
    const recs = Game.buildingRecords;
    if (!recs || !recs.length) return;
    for (const rec of recs) {
        if (rec._collapsePending != null && !rec.collapsed) {
            rec._collapsePending -= dt;
            if (rec._collapsePending <= 0) {
                rec._collapsePending = null;
                Game._collapseBuilding(rec);
            }
        }
    }
};

// Destroyed building with no dedicated rubble state: hide it, drop a low rubble
// pile + smoke/dust, and stop it blocking line of sight (still gives cover).
Game._collapseBuilding = (rec) => {
    if (rec.collapsed) return;
    rec.collapsed = true;
    const THREE = Game.THREE;
    (rec.houses || []).forEach(h => { if (h.root) h.root.visible = false; });
    rec.procMeshes.forEach(m => { m.visible = false; });

    // Low rubble blocks of broken masonry within the footprint.
    const rubbleMat = new THREE.MeshStandardMaterial({ color: 0x6a6258, roughness: 1.0 });
    const n = 5 + Math.floor((rec.w * rec.d) / 12);
    for (let i = 0; i < n; i++) {
        const rw = Game.rand(0.5, 1.4), rh = Game.rand(0.2, 0.7), rd = Game.rand(0.5, 1.4);
        const m = new THREE.Mesh(new THREE.BoxGeometry(rw, rh, rd), rubbleMat);
        const px = rec.cx + Game.rand(-rec.w * 0.4, rec.w * 0.4);
        const pz = rec.cz + Game.rand(-rec.d * 0.4, rec.d * 0.4);
        m.position.set(px, (Game.getHeight ? Game.getHeight(px, pz) : rec.baseY) + rh / 2, pz);
        m.rotation.y = Game.rand(0, Math.PI);
        m.castShadow = true; m.receiveShadow = true;
        rec.group.add(m);
    }
    // Big dust/smoke burst.
    Game._buildingDestroyedSmoke(rec);

    // Rubble no longer blocks sight (but the tile keeps cover for troops).
    const T = Game.TILE, b = rec.b;
    for (let ty = b.ty; ty < b.ty + b.th; ty++) {
        for (let tx = b.tx; tx < b.tx + b.tw; tx++) {
            const t = Game.getTile ? Game.getTile(tx, ty) : null;
            if (t) { t.sightBlock = false; t.cover = Math.min(t.cover ?? 0.4, 0.4); }
        }
    }

    // Anyone garrisoned inside when it comes down: random fate — most are buried,
    // a few scramble clear (badly shaken and wounded).
    (rec.occupants || []).slice().forEach(id => {
        const u = Game.getUnitById ? Game.getUnitById(id) : null;
        if (!u) return;
        Game.ungarrisonUnit(u);
        if (!u.alive) return;
        if (Math.random() < 0.7) {                 // killed in the collapse
            u.alive = false; u.hp = 0;
            if (u.mesh) u.mesh.visible = false;
            if (Game.selection.has(u.id)) Game.selection.delete(u.id);
        } else {                                    // escaped, hurt + shaken
            u.hp = Math.max(1, u.hp - Game.rand(30, 60));
            u.suppressionValue = 100; u.shaken = 1.6;
            u.stance = 'prone'; u._autoStance = true;
            u.x = rec.cx + Game.rand(-rec.w * 0.5 - 1, rec.w * 0.5 + 1);
            u.z = rec.cz + Game.rand(-rec.d * 0.5 - 1, rec.d * 0.5 + 1);
            if (u.mesh) u.mesh.visible = true;
        }
    });
    rec.occupants = [];

    // Stop anyone still shelling this spot — the building is gone.
    (Game.units || []).forEach(u => {
        if (u.bombardX != null && Game._footprintDistSq(rec, u.bombardX, u.bombardZ) <= 0.0001) {
            u.bombardX = null; u.bombardZ = null; u._bombarding = false;
        }
    });
    Game.pushMessage('Building collapsed!', 1.8);
};

// Nearest point on a building footprint to (x,z) → squared distance helper.
Game._footprintDistSq = (rec, x, z) => {
    const T = Game.TILE, b = rec.b;
    const x0 = b.tx * T, x1 = (b.tx + b.tw) * T, z0 = b.ty * T, z1 = (b.ty + b.th) * T;
    const cx = Math.max(x0, Math.min(x, x1));
    const cz = Math.max(z0, Math.min(z, z1));
    const dx = x - cx, dz = z - cz;
    return dx * dx + dz * dz;
};

// Nearest point on a building's footprint to (x,z) — its facing edge, used so
// units validate line-of-sight to the wall they're shelling, not the blocked
// centre.
Game.buildingNearPoint = (rec, x, z) => {
    const T = Game.TILE, b = rec.b;
    const x0 = b.tx * T, x1 = (b.tx + b.tw) * T, z0 = b.ty * T, z1 = (b.ty + b.th) * T;
    return { x: Math.max(x0, Math.min(x, x1)), z: Math.max(z0, Math.min(z, z1)) };
};

// Logical entry points (doors) for a building: the midpoint of each footprint
// face, nudged just outside the wall. Real houses have a front and usually a back
// door, so infantry approach a door rather than the nearest random wall point,
// and a squad can split across opposite faces ("both ends") instead of all
// funnelling onto one spot. Doors that open into a blocked tile are dropped.
Game.buildingDoors = (rec) => {
    const T = Game.TILE, b = rec.b;
    const x0 = b.tx * T, x1 = (b.tx + b.tw) * T, z0 = b.ty * T, z1 = (b.ty + b.th) * T;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const off = T * 0.6;                       // stand just outside the wall
    const cands = [
        { x: cx, z: z0 - off },                // front face (-Z)
        { x: cx, z: z1 + off },                // back face  (+Z)
        { x: x0 - off, z: cz },                // left face  (-X)
        { x: x1 + off, z: cz },                // right face (+X)
    ];
    const doors = cands.filter(p => {
        if (p.x < 1 || p.z < 1 || p.x > Game.WORLD_W - 1 || p.z > Game.WORLD_H - 1) return false;
        const t = Game.getTileAtWorld(p.x, p.z);
        return !t || !t.blocked;
    });
    return doors.length ? doors : [{ x: cx, z: cz }];
};

// Building whose footprint contains (x,z), or null.
Game.buildingAt = (x, z) => {
    for (const rec of Game.buildingRecords) {
        if (!rec.collapsed && Game._footprintDistSq(rec, x, z) <= 0.0001) return rec;
    }
    return null;
};

// Standing building whose 3D mesh is under the cursor — so clicking the tall
// house targets it (the ground point lands on terrain behind it via parallax).
Game.buildingAtScreen = (screenX, screenY) => {
    if (!Game.raycaster || !Game.camera || !Game.buildingRecords.length) return null;
    const THREE = Game.THREE;
    const ndc = new THREE.Vector2((screenX / Game.viewW) * 2 - 1, -(screenY / Game.viewH) * 2 + 1);
    Game.raycaster.setFromCamera(ndc, Game.camera);
    const groups = Game.buildingRecords.filter(r => !r.collapsed).map(r => r.group);
    const hits = Game.raycaster.intersectObjects(groups, true);
    for (const h of hits) {
        let o = h.object;
        while (o) { if (o.userData && o.userData.buildingRec) return o.userData.buildingRec; o = o.parent; }
    }
    return null;
};

// Apply blast/impact damage to any building within `radius` of (x,z). Called
// from the explosion system, so tanks (HE), grenades, mortars and air strikes
// all chip buildings down through their damage states.
// opts.maxLevel caps how far this hit can damage a building (e.g. small arms
// only ever scuff it to light damage — they can't wreck masonry). The four HP
// bands are 100-75-50-25-0%; a maxLevel of 1 floors HP just above the 50% line.
Game.damageBuildingAt = (x, z, amount, radius = 1.5, opts) => {
    if (!Game.buildingRecords.length) return false;
    const bandLow = [0.75, 0.5, 0.25, 0];
    let hit = false;
    const r2 = radius * radius;
    for (const rec of Game.buildingRecords) {
        if (rec.collapsed) continue;
        const dSq = Game._footprintDistSq(rec, x, z);
        if (dSq > r2) continue;
        const falloff = 1 - Math.sqrt(dSq) / (radius + 0.001);
        const oldHp = rec.hp;
        rec.hp -= amount * Math.max(0.35, falloff) * (Game._buildingDmgMult || 1);
        if (opts && opts.maxLevel != null) {
            const floor = rec.maxHp * bandLow[Math.max(0, Math.min(3, opts.maxLevel))] + 0.1;
            if (rec.hp < floor) rec.hp = floor;       // can't damage past the cap
        }
        // Troops inside take a share of the ACTUAL punishment (sheltered, reduced).
        Game._hurtOccupants(rec, (oldHp - rec.hp) * 0.2);
        Game._buildingHitFx(rec, x, z);
        // Map HP → level (4 bands: 100-75-50-25-0%).
        const pct = rec.hp / rec.maxHp;
        const level = pct > 0.75 ? 0 : pct > 0.5 ? 1 : pct > 0.25 ? 2 : 3;
        if (level !== rec.level || (level >= 3 && !rec.collapsed)) Game.setBuildingDamage(rec, level);
        hit = true;
    }
    return hit;
};

// Dust + smoke + a little broken masonry when a standing building is struck
// (throttled so rapid fire doesn't spam). This is the "being hit" feedback; the
// damage-state mesh swap is handled separately in setBuildingDamage.
Game._buildingHitFx = (rec, x, z) => {
    const now = Game.gameClock || 0;
    if (rec._fxT && now - rec._fxT < 0.1) return;
    rec._fxT = now;
    const sc = Game._buildingSmokeScale || 1;
    const n = Math.max(1, Math.round(3 * sc));
    for (let i = 0; i < n; i++) {
        Game.smoke.push({
            x: x + Game.rand(-0.8, 0.8), z: z + Game.rand(-0.8, 0.8),
            r: 1.5 * sc, life: 1.6, total: 1.6,
            vx: Game.rand(-0.3, 0.3), vz: Game.rand(-0.6, -0.15), mesh: null,
        });
    }
    if (Game.craters) Game.craters.push({ x, z, r: Game.rand(0.2, 0.4) });
    if (Game.addScorch && Math.random() < 0.5) Game.addScorch(x, z, 0.8);
    Game.cameraShake = Math.max(Game.cameraShake || 0, 2);
};

// Big dust/smoke burst when a building is wrecked — tall central column + a
// spread of debris dust across the footprint. Scaled by the debug Smoke ×.
Game._buildingDestroyedSmoke = (rec) => {
    const sc = Game._buildingSmokeScale || 1;
    const w = rec.w, d = rec.d;
    for (let i = 0; i < Math.round(5 * sc); i++) {       // central column
        Game.smoke.push({
            x: rec.cx + Game.rand(-0.7, 0.7), z: rec.cz + Game.rand(-0.7, 0.7),
            r: (3.0 + Game.rand(0, 1.4)) * sc, life: 5.5, total: 5.5,
            vx: Game.rand(-0.15, 0.15), vz: Game.rand(-0.3, -0.05), mesh: null,
        });
    }
    for (let i = 0; i < Math.round(10 * sc); i++) {      // footprint debris dust
        Game.smoke.push({
            x: rec.cx + Game.rand(-w * 0.5, w * 0.5), z: rec.cz + Game.rand(-d * 0.5, d * 0.5),
            r: (2.2 + Game.rand(0, 0.9)) * sc, life: 4.2, total: 4.2,
            vx: Game.rand(-0.4, 0.4), vz: Game.rand(-0.5, -0.1), mesh: null,
        });
    }
    if (Game.addScorch) Game.addScorch(rec.cx, rec.cz, Math.max(w, d) * 0.55);
    Game.cameraShake = Math.max(Game.cameraShake || 0, 10);
    if (Game.Audio) Game.Audio.explosion(rec.cx, rec.cz);
};

// Debug / testing: force a damage level on every building.
Game.setAllBuildingDamage = (level) => {
    Game.buildingRecords.forEach(rec => {
        rec.hp = rec.maxHp * (1 - Game.clamp(level, 0, 3) / 4) - 1;
        Game.setBuildingDamage(rec, level);
    });
    Game.pushMessage(`All buildings → damage ${level}.`, 1.5);
};

// ── Garrison capacity ──────────────────────────────────────────────────────
// Each building holds up to rec.capacity infantry (scaled with footprint in
// registerBuilding). Foundation for the future occupy-a-building gameplay.

// Building record whose footprint contains (x,z) — collapsed or not.
Game.buildingRecAt = (x, z) => {
    for (const rec of Game.buildingRecords) {
        if (Game._footprintDistSq(rec, x, z) <= 0.0001) return rec;
    }
    return null;
};

Game.buildingHasRoom = (rec) => !!rec && !rec.collapsed && rec.occupants.length < rec.capacity;

// Troops firing from a building: elevated vantage (longer sight), firing through
// windows with a clear field (longer range), and hard cover (very hard to hit).
Game.GARRISON_SIGHT_MULT = 1.35;
Game.GARRISON_RANGE_MULT = 1.25;
Game.GARRISON_COVER = 0.9;

// Put a unit inside a building (respecting capacity). Returns success.
Game.garrisonUnit = (unit, rec) => {
    if (!unit || !unit.alive || !rec || rec.collapsed) return false;
    if (rec.occupants.indexOf(unit.id) >= 0) return true;          // already inside
    if (rec.occupants.length >= rec.capacity) return false;        // full
    rec.occupants.push(unit.id);
    unit._garrisoned = true;
    unit._garrisonRec = rec;
    unit._enterRec = null;
    unit._garrisonPos = { x: rec.cx, z: rec.cz };
    unit.x = rec.cx + Game.rand(-rec.w * 0.3, rec.w * 0.3);
    unit.z = rec.cz + Game.rand(-rec.d * 0.3, rec.d * 0.3);
    // Combat bonuses (saved so they restore exactly on exit).
    if (unit._preGarrisonSight == null) unit._preGarrisonSight = unit.sight;
    if (unit._preGarrisonRange == null) unit._preGarrisonRange = unit.range;
    unit.sight = unit._preGarrisonSight * Game.GARRISON_SIGHT_MULT;
    unit.range = unit._preGarrisonRange * Game.GARRISON_RANGE_MULT;
    unit.coverBonus = Game.GARRISON_COVER;
    unit.path = []; unit.moving = false;
    if (unit.mesh) unit.mesh.visible = false;
    return true;
};

// Remove a unit from whatever building it occupies.
Game.ungarrisonUnit = (unit) => {
    if (!unit) return;
    const rec = unit._garrisonRec;
    if (rec) { const i = rec.occupants.indexOf(unit.id); if (i >= 0) rec.occupants.splice(i, 1); }
    unit._garrisoned = false;
    unit._garrisonRec = null;
    // Restore the unit's own sight/range.
    if (unit._preGarrisonSight != null) { unit.sight = unit._preGarrisonSight; unit._preGarrisonSight = null; }
    if (unit._preGarrisonRange != null) { unit.range = unit._preGarrisonRange; unit._preGarrisonRange = null; }
    unit.coverBonus = 0;
    if (unit.mesh) unit.mesh.visible = true;
};

// Occupancy summary for the HUD label: count, capacity, average health %.
Game.buildingOccupantStats = (rec) => {
    if (!rec || !rec.occupants || !rec.occupants.length) {
        return { count: 0, capacity: rec ? rec.capacity : 0, avgHealthPct: 0 };
    }
    let sum = 0, n = 0;
    for (const id of rec.occupants) {
        const u = Game.getUnitById ? Game.getUnitById(id) : null;
        if (!u) continue;
        sum += Game.clamp((u.hp / (u.maxHp || u.hp || 1)) * 100, 0, 100);
        n++;
    }
    return { count: n, capacity: rec.capacity, avgHealthPct: n ? Math.round(sum / n) : 0 };
};

// A building taking fire wounds the troops sheltering inside (reduced — they have
// cover). Killed occupants are removed from the garrison.
Game._hurtOccupants = (rec, amount) => {
    if (!rec || !rec.occupants || !rec.occupants.length || amount <= 0) return;
    rec.occupants.slice().forEach(id => {
        const u = Game.getUnitById ? Game.getUnitById(id) : null;
        if (!u || !u.alive) return;
        u.hp -= amount;
        u.suppressionValue = Game.clamp((u.suppressionValue || 0) + amount * 1.5, 0, 100);
        u.shaken = Math.max(u.shaken || 0, 0.4);
        if (u.hp <= 0) {
            u.hp = 0; u.alive = false;
            Game.ungarrisonUnit(u);
            if (u.mesh) u.mesh.visible = false;
            if (Game.selection.has(u.id)) Game.selection.delete(u.id);
        }
    });
};

// Order the selected infantry to move to a building and garrison on arrival.
// Tanks/crews are ignored. Capacity is enforced on arrival (latecomers stop).
Game.orderEnterBuilding = (rec) => {
    if (!rec || rec.collapsed) { Game.pushMessage('Must target a standing building!', 1.4); return; }
    const inf = Game.selectedPlayerUnits().filter(u => u.alive && !Game.isTank(u.kind) && !u._garrisoned);
    if (!inf.length) { Game.pushMessage('Select infantry to enter a building.', 1.4); return; }
    // Rank the building's doors by closeness to the squad's centre, then send the
    // squad in through the two nearest doors (alternating) so they use both
    // entrances/ends instead of all piling onto one wall point.
    const doors = Game.buildingDoors ? Game.buildingDoors(rec) : null;
    let ranked = null;
    if (doors && doors.length) {
        let sx = 0, sz = 0; inf.forEach(u => { sx += u.x; sz += u.z; });
        sx /= inf.length; sz /= inf.length;
        ranked = [...doors].sort((a, b) =>
            ((a.x - sx) ** 2 + (a.z - sz) ** 2) - ((b.x - sx) ** 2 + (b.z - sz) ** 2));
    }
    const nDoors = ranked ? Math.min(2, ranked.length) : 0;   // split across the 2 nearest
    inf.forEach((u, i) => {
        u.forcedTargetId = null;
        u.bombardX = null; u.bombardZ = null; u._bombarding = false;
        u._faceAngle = null; u._faceUntil = 0;
        u._enterRec = rec;
        const np = nDoors
            ? ranked[i % nDoors]
            : (Game.buildingNearPoint ? Game.buildingNearPoint(rec, u.x, u.z) : { x: rec.cx, z: rec.cz });
        u.targetX = np.x; u.targetZ = np.z;
        u.path = Game.findPath(u, u.x, u.z, np.x, np.z);
        u.moving = true; u.orderMode = 'move'; u._combatReady = false; u._readyTimer = 0;
        u.stopTimer = 0; u.orderDelay = Game.commandDelay ? Game.commandDelay(u) : 0;
    });
    if (Game.spawnOrderMarker) Game.spawnOrderMarker(rec.cx, rec.cz, 0x66ccff);
    Game.pushMessage(`Entering building (${rec.occupants.length}/${rec.capacity}).`, 1.6);
    if (Game.Audio) Game.Audio.voice('f_sold_move');
};

// Per-frame: units with an entry order garrison when they reach the building, or
// stop short if it filled up before they got there.
Game.updateBuildingEntry = (dt) => {
    const units = Game.units;
    if (!units) return;
    for (const u of units) {
        const rec = u._enterRec;
        if (!rec) continue;
        if (!u.alive || u._garrisoned) { u._enterRec = null; continue; }
        if (rec.collapsed) { u._enterRec = null; continue; }
        // Close enough to the footprint to step inside?
        const near = Game._footprintDistSq ? Game._footprintDistSq(rec, u.x, u.z) <= 6.25 : false;
        if (!near) continue;
        if (Game.buildingHasRoom(rec)) {
            Game.garrisonUnit(u, rec);                 // clears _enterRec, hides mesh
        } else {
            u._enterRec = null;
            u.path = []; u.moving = false;
            Game.pushMessage(`Building full (${rec.occupants.length}/${rec.capacity}).`, 1.4);
        }
    }
};

// ── Debug-panel controls (merged into the post-processing debug section) ────
// Run fn(material) over every building model material (live tweaks/diagnostics).
Game._eachBuildingMat = (fn) => {
    (Game.buildingRecords || []).forEach(rec => (rec.houses || []).forEach(h => {
        if (!h.root) return;
        h.root.traverse(o => {
            if (o.isMesh && o.material) {
                const ms = Array.isArray(o.material) ? o.material : [o.material];
                ms.forEach(fn);
            }
        });
    }));
};

Game.buildingDebugDefaults = {
    bldgDmgMult: 1, bldgSmokeScale: 1, bldgMaxHp: Game.BUILDING_MAX_HP,
    bldgBright: 0, bldgNormal: 1, bldgRough: 0.55, bldgRecvShadow: 0, bldgForceState: -1,
};
Game._buildingControlDefs = () => [
    { group: 'Buildings', key: 'bldgDmgMult', label: 'Damage × (shots to wreck)', min: 0.2, max: 4, step: 0.1, apply: v => { Game._buildingDmgMult = v; } },
    { group: 'Buildings', key: 'bldgSmokeScale', label: 'Smoke ×', min: 0.3, max: 4, step: 0.1, apply: v => { Game._buildingSmokeScale = v; } },
    // ── Roof/texture diagnostics (the baked grime on the model's texture) ──
    { group: 'Buildings', key: 'bldgBright', label: 'Brightness (wash grime)', min: 0, max: 0.5, step: 0.02, apply: v => { Game._eachBuildingMat(m => { if (m.emissive) { m.emissive.setScalar(v); m.emissiveIntensity = 1; m.needsUpdate = true; } }); } },
    { group: 'Buildings', key: 'bldgNormal', label: 'Normal Map Scale', min: 0, max: 2, step: 0.05, apply: v => { Game._eachBuildingMat(m => { if (m.normalScale) m.normalScale.set(v, v); }); } },
    { group: 'Buildings', key: 'bldgRough', label: 'Roughness', min: 0, max: 1, step: 0.02, apply: v => { Game._eachBuildingMat(m => { if ('roughness' in m) m.roughness = v; }); } },
    { group: 'Buildings', key: 'bldgRecvShadow', label: 'Receive Shadows (0/1)', min: 0, max: 1, step: 1, apply: v => { Game._eachBuildingMat(m => {}); (Game.buildingRecords || []).forEach(rec => (rec.houses || []).forEach(h => h.root && h.root.traverse(o => { if (o.isMesh) o.receiveShadow = v >= 1; }))); } },
    { group: 'Buildings', key: 'bldgForceState', label: 'Force State (-1=auto,0-3)', min: -1, max: 3, step: 1, apply: v => { Game._forceBuildingState = v; if (v >= 0) (Game.buildingRecords || []).forEach(rec => { if (!rec.collapsed) Game.setBuildingDamage(rec, v); }); } },
    {
        group: 'Buildings', key: 'bldgMaxHp', label: 'Max HP', min: 100, max: 1200, step: 20,
        apply: v => {
            Game.BUILDING_MAX_HP = Math.round(v);
            (Game.buildingRecords || []).forEach(r => {       // rescale existing buildings live
                const ratio = r.maxHp ? r.hp / r.maxHp : 1;
                r.maxHp = Math.round(v);
                r.hp = r.maxHp * ratio;
            });
        },
    },
];

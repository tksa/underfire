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
Game.BUILDING_MAX_HP = 220;
// Houses are placed at ONE fixed scale (no per-footprint resizing/stretching).
// The GLB is exported ~1 world-unit wide, so this is the in-world house size.
Game.BUILDING_SCALE = 5.5;
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
    const count = Math.max(1, Math.round(longLen / houseW));
    const cell = longLen / count;

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
            if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
            o.raycast = () => { };   // don't intercept unit/ground picking
        });
        rec.group.add(model);
        rec.houses.push({ root: model, states: collectStates(model) });
    }

    // Hide the procedural fallback now that the model row is in.
    rec.procMeshes.forEach(m => { m.visible = false; });
    Game.setBuildingDamage(rec, rec.level);
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
        Game._collapseBuilding(rec);
    } else if (level >= 3 && !rec._destroyedFx) {
        // Heavy-damage state mesh exists — show it, plus a one-time smoke/dust burst.
        rec._destroyedFx = true;
        for (let i = 0; i < 6; i++) {
            Game.smoke.push({
                x: rec.cx + Game.rand(-rec.w * 0.4, rec.w * 0.4),
                z: rec.cz + Game.rand(-rec.d * 0.4, rec.d * 0.4),
                r: 1.8, life: 3.0, total: 3.0,
                vx: Game.rand(-0.3, 0.3), vz: Game.rand(-0.4, -0.1), mesh: null,
            });
        }
        if (Game.addScorch) Game.addScorch(rec.cx, rec.cz, Math.max(rec.w, rec.d) * 0.4);
        Game.cameraShake = Math.max(Game.cameraShake || 0, 7);
        if (Game.Audio) Game.Audio.explosion(rec.cx, rec.cz);
        Game.pushMessage('Building wrecked!', 1.6);
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
    // Dust + smoke + scorch.
    for (let i = 0; i < 6; i++) {
        Game.smoke.push({
            x: rec.cx + Game.rand(-rec.w * 0.4, rec.w * 0.4),
            z: rec.cz + Game.rand(-rec.d * 0.4, rec.d * 0.4),
            r: 1.8, life: 3.5, total: 3.5,
            vx: Game.rand(-0.3, 0.3), vz: Game.rand(-0.4, -0.1), mesh: null,
        });
    }
    if (Game.addScorch) Game.addScorch(rec.cx, rec.cz, Math.max(rec.w, rec.d) * 0.4);
    Game.cameraShake = Math.max(Game.cameraShake || 0, 8);
    if (Game.Audio) Game.Audio.explosion(rec.cx, rec.cz);

    // Rubble no longer blocks sight (but the tile keeps cover for troops).
    const T = Game.TILE, b = rec.b;
    for (let ty = b.ty; ty < b.ty + b.th; ty++) {
        for (let tx = b.tx; tx < b.tx + b.tw; tx++) {
            const t = Game.getTile ? Game.getTile(tx, ty) : null;
            if (t) { t.sightBlock = false; t.cover = Math.min(t.cover ?? 0.4, 0.4); }
        }
    }

    // Anyone garrisoned inside is buried — eject survivors, heavily hurt/kill.
    (rec.occupants || []).slice().forEach(id => {
        const u = Game.getUnitById ? Game.getUnitById(id) : null;
        if (!u) return;
        Game.ungarrisonUnit(u);
        if (u.alive) {
            u.hp -= 70; u.suppressionValue = 100; u.shaken = 1.2;
            if (u.hp <= 0) {
                u.alive = false; u.hp = 0;
                if (u.mesh) u.mesh.visible = false;
                if (Game.selection.has(u.id)) Game.selection.delete(u.id);
            }
        }
    });
    rec.occupants = [];
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

// Building whose footprint contains (x,z), or null.
Game.buildingAt = (x, z) => {
    for (const rec of Game.buildingRecords) {
        if (!rec.collapsed && Game._footprintDistSq(rec, x, z) <= 0.0001) return rec;
    }
    return null;
};

// Apply blast/impact damage to any building within `radius` of (x,z). Called
// from the explosion system, so tanks (HE), grenades, mortars and air strikes
// all chip buildings down through their damage states.
Game.damageBuildingAt = (x, z, amount, radius = 1.5) => {
    if (!Game.buildingRecords.length) return false;
    let hit = false;
    const r2 = radius * radius;
    for (const rec of Game.buildingRecords) {
        if (rec.collapsed) continue;
        const dSq = Game._footprintDistSq(rec, x, z);
        if (dSq > r2) continue;
        const falloff = 1 - Math.sqrt(dSq) / (radius + 0.001);
        rec.hp -= amount * Math.max(0.35, falloff);
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
    if (rec._fxT && now - rec._fxT < 0.12) return;
    rec._fxT = now;
    for (let i = 0; i < 2; i++) {
        Game.smoke.push({
            x: x + Game.rand(-0.7, 0.7), z: z + Game.rand(-0.7, 0.7),
            r: 0.9, life: 1.2, total: 1.2,
            vx: Game.rand(-0.3, 0.3), vz: Game.rand(-0.5, -0.1), mesh: null,
        });
    }
    if (Game.craters) Game.craters.push({ x, z, r: Game.rand(0.15, 0.35) });
    if (Game.addScorch && Math.random() < 0.4) Game.addScorch(x, z, 0.7);
    Game.cameraShake = Math.max(Game.cameraShake || 0, 1.5);
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

// Put a unit inside a building (respecting capacity). Returns success.
Game.garrisonUnit = (unit, rec) => {
    if (!unit || !unit.alive || !rec || rec.collapsed) return false;
    if (rec.occupants.indexOf(unit.id) >= 0) return true;          // already inside
    if (rec.occupants.length >= rec.capacity) return false;        // full
    rec.occupants.push(unit.id);
    unit._garrisoned = true;
    unit._garrisonRec = rec;
    unit._garrisonPos = { x: rec.cx, z: rec.cz };
    unit.x = rec.cx + Game.rand(-rec.w * 0.3, rec.w * 0.3);
    unit.z = rec.cz + Game.rand(-rec.d * 0.3, rec.d * 0.3);
    unit.coverBonus = 0.9;
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
    unit.coverBonus = 0;
    if (unit.mesh) unit.mesh.visible = true;
};

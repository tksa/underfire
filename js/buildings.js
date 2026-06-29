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
Game.buildingRecords = [];

// Register one building (called from the terrain build loop). procMeshes are the
// procedural fallback meshes already added to bGroup.
Game.registerBuilding = (b, bGroup, dims, procMeshes) => {
    const rec = {
        b, group: bGroup,
        w: dims.w, d: dims.d, cx: dims.cx, cz: dims.cz, baseY: dims.baseY,
        hp: Game.BUILDING_MAX_HP, maxHp: Game.BUILDING_MAX_HP, level: 0,
        procMeshes: procMeshes || [], states: [null, null, null, null],
        modelRoot: null, collapsed: false,
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

// Instance the model into a building: fit to footprint, align long axis, ground
// it, collect damage-state meshes, hide the procedural fallback, show undamaged.
Game._populateBuildingModel = (rec, srcModel) => {
    const THREE = Game.THREE;
    const model = Game._cloneModel ? Game._cloneModel(srcModel) : srcModel.clone();

    // Measure native footprint to fit it to the building's tile footprint.
    model.scale.set(1, 1, 1);
    model.rotation.set(0, 0, 0);
    model.position.set(0, 0, 0);
    model.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(model);
    const mw = Math.max(1e-3, box.max.x - box.min.x);
    const md = Math.max(1e-3, box.max.z - box.min.z);

    // Align the model's longer horizontal axis with the building's longer side.
    const rotY = ((rec.w >= rec.d) !== (mw >= md)) ? Math.PI / 2 : 0;
    const fitW = rotY ? md : mw;
    const fitD = rotY ? mw : md;
    const s = Math.min((rec.w * 0.94) / fitW, (rec.d * 0.94) / fitD);
    model.scale.setScalar(s);
    model.rotation.y = rotY;

    // Recentre horizontally + ground-snap (group already sits at baseY).
    model.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(model);
    model.position.x -= (box.min.x + box.max.x) / 2;
    model.position.z -= (box.min.z + box.max.z) / 2;
    model.position.y -= box.min.y;

    model.traverse(o => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
        o.raycast = () => { };   // don't intercept unit/ground picking
    });
    rec.group.add(model);
    rec.modelRoot = model;

    // Collect damage-state meshes by name prefix (missing states stay null).
    rec.states = Game.BUILDING_STATES.map(prefix => {
        let found = null;
        model.traverse(o => { if (!found && o.name && o.name.indexOf(prefix) === 0) found = o; });
        return found;
    });

    // Hide the procedural fallback now that the model is in.
    rec.procMeshes.forEach(m => { m.visible = false; });
    Game.setBuildingDamage(rec, rec.level);
};

// Show the right damage-state mesh for a level. With states missing, show the
// highest available state at or below the level (so a single-state model just
// stays undamaged until destroyed). Level 3 with no House_3 mesh collapses.
Game.setBuildingDamage = (rec, level) => {
    level = Game.clamp ? Game.clamp(Math.round(level), 0, 3) : Math.max(0, Math.min(3, Math.round(level)));
    rec.level = level;
    let shown = -1;
    for (let i = 0; i <= level; i++) if (rec.states[i]) shown = i;
    rec.states.forEach((m, i) => { if (m) m.visible = (i === shown); });
    if (level >= 3 && !rec.states[3]) Game._collapseBuilding(rec);
};

// Destroyed building with no dedicated rubble state: hide it, drop a low rubble
// pile + smoke/dust, and stop it blocking line of sight (still gives cover).
Game._collapseBuilding = (rec) => {
    if (rec.collapsed) return;
    rec.collapsed = true;
    const THREE = Game.THREE;
    if (rec.modelRoot) rec.modelRoot.visible = false;
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
        // Map HP → level (4 bands: 100-75-50-25-0%).
        const pct = rec.hp / rec.maxHp;
        const level = pct > 0.75 ? 0 : pct > 0.5 ? 1 : pct > 0.25 ? 2 : 3;
        if (level !== rec.level || (level >= 3 && !rec.collapsed)) Game.setBuildingDamage(rec, level);
        hit = true;
    }
    return hit;
};

// Debug / testing: force a damage level on every building.
Game.setAllBuildingDamage = (level) => {
    Game.buildingRecords.forEach(rec => {
        rec.hp = rec.maxHp * (1 - Game.clamp(level, 0, 3) / 4) - 1;
        Game.setBuildingDamage(rec, level);
    });
    Game.pushMessage(`All buildings → damage ${level}.`, 1.5);
};

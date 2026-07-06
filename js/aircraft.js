/**
 * Under Fire — aircraft.js
 * Fighter air support, Sudden Strike style. Select the fighter from the HUD
 * (or press J): a large green circle rides the cursor; right-click and the
 * plane flies in FROM THE MAP EDGE NEAREST YOUR CLICK (the cursor chooses the
 * approach path), circles the marked area strafing ground targets, hugely
 * extends the fog-of-war reveal while airborne, then flies home. It is an
 * off-map support like the air strike — never a selectable unit.
 *
 * Audio: a synthesized positional prop drone (Game.Audio.fighterDrone) runs
 * from the moment the sortie is called — faint in the distance, louder as the
 * plane closes — plus MG bursts on every strafing pass.
 *
 * AA / FLAK (planned, hooks in place): each fighter carries hp; future AA
 * guns aim at Game.fighters entries and call Game.damageFighter(f, dmg).
 * At 0 hp the plane enters the 'crash' state — flame + smoke trail, banking
 * spiral into the ground, explosion, scorch and sound. Nothing else needed
 * on this side when AA lands.
 *
 * Model: models/dewoitine_d520.glb ("Dewoitine D.520" by helijah, CC-BY 4.0 —
 * see CREDITS.md). Degradable: a procedural silhouette flies if it's missing.
 */

// Shared flight profile (per-type stats live in FIGHTER_TYPES).
Game.FIGHTER = {
    alt: 34,            // patrol altitude (world units above smoothed terrain)
    radius: 15,         // patrol circle radius = the green targeting ring
    duration: 42,       // seconds on station before flying home
    burstMin: 0.8,      // seconds between strafing bursts
    burstMax: 1.5,
    hitChance: 0.45,
    reveal: 36,         // fog-of-war reveal radius around the plane
    scale: 7.0,         // target model length (world units) — SS planes read BIG
    yaw: 0,             // shared fallback; per-type yaw below is what matters
    hp: 60,             // future AA: shot down at 0
};

// The squadron: pick which fighter flies each sortie from the HUD menu.
// D.520 — fast, rifle-caliber battery. MB.152 — slower but hits harder
// (twin 20mm Hispano cannon).
// yaw = measured model-forward correction, verified against ASCII silhouettes
// rendered from the GLB vertex data: BOTH airframes run nose-toward −X (the
// D.520 shows its prop disc + inline nose at −X with the fin at +X; the
// MB.152 shows its dense radial cowling at −X with the sparse fin outline at
// +X). Nose −X → +PI/2 under the render convention. Live-tunable per plane in
// the debug panel (` key → Fighter group) if a model is ever swapped.
Game.FIGHTER_TYPES = {
    d520: {
        label: 'Dewoitine D.520', model: 'models/dewoitine_d520.glb',
        count: 2, speed: 26, rounds: 8, dmgSoft: 7, dmgHard: 0.8,
        yaw: Math.PI / 2,
    },
    mb152: {
        label: 'Bloch MB.152', model: 'models/bloch_mb152.glb',
        count: 2, speed: 21, rounds: 5, dmgSoft: 13, dmgHard: 2.4,
        yaw: Math.PI / 2,
    },
};
Game.fighterTotalAvailable = () => {
    let n = 0;
    for (const k in Game.FIGHTER_TYPES) n += Game.FIGHTER_TYPES[k].count;
    return n;
};
Game.fighters = [];
Game._fighterType = 'd520';       // type armed for the next sortie

// ── Model ────────────────────────────────────────────────────────────────────
Game._fighterProtos = {};        // type -> normalized wrapper, cloned per sortie
Game._fighterLoadTried = {};

Game._procFighterModel = () => {
    const THREE = Game.THREE;
    // Wrapped so it matches the GLB proto structure: wrap -> inner model. The
    // inner is where the model-forward yaw correction is applied; the proc
    // silhouette is authored nose +Z already, so it's flagged to skip it.
    const g = new THREE.Group();
    g.userData.procFallback = true;
    const mat = new THREE.MeshStandardMaterial({ color: 0x5a6a52, roughness: 0.6 });
    const fus = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.22, 5.4, 8), mat);
    fus.rotation.x = Math.PI / 2;
    g.add(fus);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(7.0, 0.12, 1.5), mat);
    wing.position.z = 0.4;
    g.add(wing);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 0.9), mat);
    tail.position.z = -2.4;
    g.add(tail);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.0, 0.9), mat);
    fin.position.set(0, 0.5, -2.4);
    g.add(fin);
    const wrap = new THREE.Group();
    wrap.userData.procFallback = true;
    wrap.add(g);
    return wrap;
};

Game._attachFighterMesh = (f) => {
    const THREE = Game.THREE;
    if (!THREE || !Game.scene) return;
    const type = f.type || 'd520';
    const def = Game.FIGHTER_TYPES[type];
    const attach = (proto) => {
        if (f.dead) return;
        const m = proto.clone(true);
        m.traverse(o => { o.raycast = () => { }; });   // never blocks unit picking
        f.mesh = m;
        Game.scene.add(m);
    };
    if (Game._fighterProtos[type]) { attach(Game._fighterProtos[type]); return; }
    // Procedural silhouette immediately; swap in the GLB when it arrives.
    attach(Game._procFighterModel());
    if (def && !Game._fighterLoadTried[type] && Game.loadModel) {
        Game._fighterLoadTried[type] = true;
        Game.loadModel(def.model).then(model => {
            // Normalize: scale so the longest dimension = FIGHTER.scale.
            const box = new THREE.Box3().setFromObject(model);
            const size = new THREE.Vector3();
            box.getSize(size);
            const maxDim = Math.max(size.x, size.y, size.z) || 1;
            const s = (Game.FIGHTER.scale || 7) / maxDim;
            model.scale.setScalar(s);
            // center on origin so it banks around its own body
            const c = new THREE.Vector3();
            box.getCenter(c);
            model.position.set(-c.x * s, -c.y * s, -c.z * s);
            // spin: the pivot for the model-forward yaw correction. It sits at
            // the geometry CENTRE (the model's own origin is arbitrary), so the
            // yaw spins the airframe in place instead of orbiting it around an
            // off-body pivot. Structure: wrap -> spin(yaw) -> model(scale+centre).
            const spin = new THREE.Group();
            spin.add(model);
            const wrap = new THREE.Group();
            wrap.add(spin);
            Game._fighterProtos[type] = wrap;
            // hot-swap on any airborne fighters of this type
            for (const ff of Game.fighters) {
                if ((ff.type || 'd520') !== type) continue;
                if (ff.mesh) { Game.scene.remove(ff.mesh); ff.mesh = null; }
                Game._attachFighterMesh(ff);
            }
        }).catch(() => { /* keep the procedural silhouette */ });
    }
};

// ── Call the sortie ──────────────────────────────────────────────────────────
Game.callFighter = (cx, cz, type) => {
    type = type || Game._fighterType || 'd520';
    let def = Game.FIGHTER_TYPES[type];
    if (!def || def.count <= 0) {
        // armed type spent — fall back to any type still in stock
        const alt = Object.keys(Game.FIGHTER_TYPES).find(k => Game.FIGHTER_TYPES[k].count > 0);
        if (!alt) { Game.pushMessage('No fighters available!', 2.0); return false; }
        type = alt; def = Game.FIGHTER_TYPES[alt];
    }
    def.count--;
    // Approach path: in from the map edge nearest the CLICK — clicking near
    // the west edge brings him in from the west.
    const W = Game.WORLD_W, H = Game.WORLD_H;
    const edges = [
        { x: -28, z: cz }, { x: W + 28, z: cz },
        { x: cx, z: -28 }, { x: cx, z: H + 28 },
    ];
    let entry = edges[0], bd = Infinity;
    for (const e of edges) {
        const d = Game.distSq(e.x, e.z, cx, cz);
        if (d < bd) { bd = d; entry = e; }
    }
    const f = {
        type, def,
        x: entry.x, z: entry.z,
        alt: Game.FIGHTER.alt + 12,
        angle: Game.angleTo(entry.x, entry.z, cx, cz),
        cx, cz,
        state: 'inbound', t: 0, onT: 0,
        hp: Game.FIGHTER.hp,
        burstT: 1.0, orbitA: 0, bank: 0, prevAngle: null,
        // organic orbit: random phases + direction, so every sortie flies its
        // own drifting, slightly irregular racetrack instead of a compass circle
        ph1: Game.rand(0, Math.PI * 2),
        ph2: Game.rand(0, Math.PI * 2),
        orbitDir: Math.random() < 0.5 ? 1 : -1,
        smokeT: 0, mesh: null, dead: false,
    };
    Game.fighters.push(f);
    Game._attachFighterMesh(f);
    if (Game.Audio && Game.Audio.fighterDrone) Game.Audio.fighterDrone.start();
    if (Game.Audio && Game.Audio.voice) Game.Audio.voice('f_sold_attack');
    Game.pushMessage(`${def.label} inbound — patrolling the marked area.`, 3.0);
    Game._fighterZoneMark = { x: cx, z: cz, t: 7 };
    return true;
};

// Future AA hook: flak calls this. At 0 hp the plane goes down in flames.
Game.damageFighter = (f, dmg) => {
    if (!f || f.dead || f.state === 'crash') return;
    f.hp -= dmg;
    // a hit puffs dark smoke off the airframe even when it survives
    Game.smoke.push({
        x: f.x, z: f.z, baseY: (Game.getHeight ? Game.getHeight(f.x, f.z) : 0) + f.alt,
        r: 0.7, life: 1.2, total: 1.2,
        vx: Game.rand(-0.4, 0.4), vz: Game.rand(-0.4, 0.4),
        rise: 0.4, maxOpacity: 0.5, tint: 0x2c2a26, mesh: null,
    });
    if (f.hp <= 0) {
        f.state = 'crash';
        f.crashT = 0;
        if (Game.Audio && Game.Audio.fighterDrone) Game.Audio.fighterDrone.setCrash(true);
        Game.pushMessage('Fighter hit — going down!', 3.0);
    }
};

// ── Strafing pass ────────────────────────────────────────────────────────────
Game._fighterStrafe = (f) => {
    const F = Game.FIGHTER;
    // Targets: living enemies inside the patrol circle AND in the plane's
    // forward cone — the guns are in the nose/wings, so fire only goes where
    // the aircraft is pointed. Off-axis enemies wait for the orbit to bring
    // the nose around (this is what makes the strafing read as real passes).
    const cands = [];
    for (const u of Game.units) {
        if (!u.alive || u.team === Game.TEAM.FRENCH || u._garrisoned) continue;
        if (Game.distSq(u.x, u.z, f.cx, f.cz) > (F.radius * 1.2) * (F.radius * 1.2)) continue;
        const bearing = Game.angleTo(f.x, f.z, u.x, u.z);
        if (Math.abs(Game.angleDiff(f.angle, bearing)) > 0.55) continue;   // not under the nose
        cands.push(u);
    }
    if (!cands.length) return;      // nothing ahead this pass — next orbit leg
    cands.sort((a, b) => (Game.isTank(a.kind) ? 1 : 0) - (Game.isTank(b.kind) ? 1 : 0));
    const target = cands[Math.floor(Game.rand(0, Math.min(4, cands.length)))] || cands[0];
    const hard = Game.isTank(target.kind);
    const def = f.def || Game.FIGHTER_TYPES[f.type] || Game.FIGHTER_TYPES.d520;
    // Rounds leave the NOSE, not the aircraft's centre.
    const nx = f.x + Math.cos(f.angle) * 3.4;
    const nz = f.z + Math.sin(f.angle) * 3.4;
    const y0 = (f.gy != null ? f.gy : 0) + f.alt - 0.6;
    f.diveT = 1.2;                  // nose down through the pass, then pull up slow
    for (let r = 0; r < def.rounds; r++) {
        const sx = target.x + Game.rand(-1.6, 1.6);
        const sz = target.z + Game.rand(-1.6, 1.6);
        Game.tracers.push({
            x: nx, z: nz, tx: sx, tz: sz,
            y0, y1: 0.5,
            life: 0.22, total: 0.22,
            team: Game.TEAM.FRENCH, big: false, mesh: null,
        });
        const hit = Math.random() < F.hitChance;
        if (!hit) continue;
        if (hard) {
            target.hp -= def.dmgHard;
            if (Game.Audio && Math.random() < 0.3) Game.Audio.ricochet(target.x, target.z);
        } else {
            target.hp -= def.dmgSoft * Game.rand(0.7, 1.2);
        }
        target.underFire = 0.9;
        target._lastThreat = { x: f.cx, z: f.cz };
        target._threatTime = Game.gameClock;
        target.suppressionValue = Game.clamp((target.suppressionValue || 0) + 6, 0, 100);
        if (target.hp <= 0 && target.alive) {
            target.alive = false; target.hp = 0;
            if (Game.selection.has(target.id)) Game.selection.delete(target.id);
            Game.pushMessage('Strafing run: enemy ' + target.label + ' destroyed.', 1.6);
        }
    }
    if (Game.alertAllies) Game.alertAllies(target, f.cx, f.cz);
    if (Game.Audio) Game.Audio.mg(f.x, f.z);
};

// ── Per-frame update (called from the game loop) ────────────────────────────
Game.updateFighters = (dt) => {
    Game._updateFighterPreview();
    const F = Game.FIGHTER;

    for (let i = Game.fighters.length - 1; i >= 0; i--) {
        const f = Game.fighters[i];
        f.t += dt;
        const def = f.def || Game.FIGHTER_TYPES[f.type] || Game.FIGHTER_TYPES.d520;
        let speed = def.speed;

        if (f.state === 'inbound') {
            const want = Game.angleTo(f.x, f.z, f.cx, f.cz);
            f.angle = Game.rotateTo(f.angle, want, 1.1 * dt);
            f.alt += (F.alt - f.alt) * Math.min(1, dt * 0.7);
            if (Game.dist(f.x, f.z, f.cx, f.cz) < F.radius) {
                f.state = 'onstation';
                f.onT = 0;
            }
        } else if (f.state === 'onstation') {
            f.onT += dt;
            f.ph1 += dt * 0.13;   // altitude wobble phase
            // ATTACK PASSES, not a carousel: each leg is a LONG run that
            // crosses the circle on a random chord and carries on well OUTSIDE
            // it (1.6-2.4 radii past the centre); reaching the far point, the
            // rate-limited steering brings the plane around in a wide natural
            // turn and lines up the next pass from a fresh angle. No two runs
            // repeat; strafing still only engages inside the marked ring, and
            // only when the run points the nose at somebody.
            const needNewPass = f.passX == null
                || Game.dist(f.x, f.z, f.passX, f.passZ) < 6;
            if (needNewPass) {
                const cross = Game.angleTo(f.x, f.z, f.cx, f.cz) + Game.rand(-0.55, 0.55);
                const out = F.radius * Game.rand(1.6, 2.4);
                const lat = Game.rand(-0.6, 0.6) * F.radius;
                const px = -Math.sin(cross), pz = Math.cos(cross);
                f.passX = Game.clamp(f.cx + Math.cos(cross) * out + px * lat, 2, Game.WORLD_W - 2);
                f.passZ = Game.clamp(f.cz + Math.sin(cross) * out + pz * lat, 2, Game.WORLD_H - 2);
            }
            f.angle = Game.rotateTo(f.angle, Game.angleTo(f.x, f.z, f.passX, f.passZ), 1.5 * dt);
            f.burstT -= dt;
            if (f.burstT <= 0) {
                f.burstT = Game.rand(F.burstMin, F.burstMax);
                Game._fighterStrafe(f);
            }
            if (f.onT > F.duration) {
                f.state = 'egress';
                Game.pushMessage('Fighter out of ammunition — returning to base.', 2.2);
            }
        } else if (f.state === 'egress') {
            f.alt += 4 * dt;   // climb out
            if (f.x < -32 || f.x > Game.WORLD_W + 32 || f.z < -32 || f.z > Game.WORLD_H + 32) {
                Game._removeFighter(i);
                continue;
            }
        } else if (f.state === 'crash') {
            // Banking death spiral with flame + smoke trail (see reference:
            // SS planes burn all the way in), then a fireball on the deck.
            f.crashT = (f.crashT || 0) + dt;
            f.angle += 2.2 * dt;
            f.alt -= (7 + f.crashT * 5) * dt;
            speed = def.speed * 0.75;
            f.smokeT -= dt;
            if (f.smokeT <= 0) {
                f.smokeT = 0.06;
                const y = (Game.getHeight ? Game.getHeight(f.x, f.z) : 0) + Math.max(0.5, f.alt);
                Game.smoke.push({
                    x: f.x, z: f.z, baseY: y, r: Game.rand(0.5, 0.9),
                    life: 1.6, total: 1.6, vx: Game.rand(-0.3, 0.3), vz: Game.rand(-0.3, 0.3),
                    rise: 0.5, maxOpacity: 0.55, tint: 0x25221e, mesh: null,
                });
                Game.muzzleFlashes = Game.muzzleFlashes || [];
                Game.muzzleFlashes.push({
                    x: f.x, z: f.z, r: 0.45, life: 0.3, total: 0.3,
                    flame: true, mesh: null,
                });
            }
            if (f.alt <= 0.6) {
                if (Game.addBlastFlash) Game.addBlastFlash(f.x, f.z, 1.7);
                if (Game.Audio) Game.Audio.explosion(f.x, f.z);
                Game.craters.push({ x: f.x, z: f.z, r: Game.rand(1.2, 1.8) });
                Game.cameraShake = Math.max(Game.cameraShake || 0, 6);
                Game.pushMessage('Fighter down.', 2.5);
                Game._removeFighter(i);
                continue;
            }
        }

        // integrate along the heading; bank into the turn
        const prevA = f.prevAngle == null ? f.angle : f.prevAngle;
        const turnRate = Game.angleDiff(prevA, f.angle) / Math.max(dt, 1e-4);
        f.prevAngle = f.angle;
        // Gentle banking: the old ±0.7 rad cap rolled the belly toward the
        // camera in the isometric view, which read as the plane "tilting up".
        const bankTarget = f.state === 'crash' ? -1.1 : Game.clamp(-turnRate * 0.4, -0.42, 0.42);
        f.bank += (bankTarget - f.bank) * Math.min(1, dt * 2.2);
        f.x += Math.cos(f.angle) * speed * dt;
        f.z += Math.sin(f.angle) * speed * dt;

        // Terrain clearance: SMOOTHED ground height sampled under the plane AND
        // ahead of it (samples clamped onto the map and filtered for finiteness
        // — an off-map sample used to poison the smoothing and sink the plane).
        const groundAt = (x, z) => {
            if (!Game.getHeight) return 0;
            const h = Game.getHeight(
                Game.clamp(x, 0.5, Game.WORLD_W - 0.5),
                Game.clamp(z, 0.5, Game.WORLD_H - 0.5));
            return Number.isFinite(h) ? h : 0;
        };
        const gUnder = groundAt(f.x, f.z);
        // Ahead AND to both sides (orbits turn, so hills come in from the flanks
        // too), plus the spot under the hull.
        const gyNow = Math.max(
            gUnder,
            groundAt(f.x + Math.cos(f.angle) * 8, f.z + Math.sin(f.angle) * 8),
            groundAt(f.x + Math.cos(f.angle) * 16, f.z + Math.sin(f.angle) * 16),
            groundAt(f.x + Math.cos(f.angle + 0.8) * 10, f.z + Math.sin(f.angle + 0.8) * 10),
            groundAt(f.x + Math.cos(f.angle - 0.8) * 10, f.z + Math.sin(f.angle - 0.8) * 10)
        );
        // Rise over approaching high ground QUICKLY; sink back over low ground
        // SLOWLY — asymmetric response means ridge lines can never catch it.
        const gyRate = gyNow > f.gy ? 6.0 : 1.0;
        f.gy = (f.gy == null || !Number.isFinite(f.gy))
            ? gyNow : f.gy + (gyNow - f.gy) * Math.min(1, dt * gyRate);

        // Firing dive: a strafing pass noses down and sheds a little height,
        // then pulls up SLOWLY back to patrol altitude (never below the hard
        // floor). f.diveT is set by _fighterStrafe.
        if (f.state !== 'crash') {
            f.diveT = Math.max(0, (f.diveT || 0) - dt);
            const diving = f.diveT > 0;
            const pitchTarget = diving ? 0.22 : 0;
            f.pitch = (f.pitch || 0) + (pitchTarget - (f.pitch || 0)) * Math.min(1, dt * (diving ? 4 : 1.2));
            const altTarget = (f.state === 'onstation')
                ? F.alt + Math.sin((f.ph1 || 0) * 1.31) * 1.2 - (diving ? 4 : 0)
                : null;
            if (altTarget != null) {
                // descend into the pass quickly, pull up slowly
                f.alt += (altTarget - f.alt) * Math.min(1, dt * (altTarget < f.alt ? 1.6 : 0.45));
            }
        }

        if (f.mesh) {
            // MODEL-FORWARD correction goes on the INNER model, not the outer
            // mesh: these GLBs' noses lie along local X, so adding the yaw to
            // the OUTER rotation left rotation.x rolling the airframe and
            // rotation.z pitching it — the orbit's constant bank then held a
            // constant pitch-up/-down (direction depending on the random orbit
            // sense): the "flies tilted up" bug. With the inner model yawed
            // nose→+Z, the outer axes are flight-true: X = pitch, Z = roll.
            const yaw = (def.yaw != null) ? def.yaw : (F.yaw || 0);
            const inner = f.mesh.children[0];
            if (inner) inner.rotation.y = f.mesh.userData.procFallback ? 0 : yaw;
            // HARD FLOOR: whatever the smoothing/dive produced, the airframe can
            // never be closer than 12u to the terrain directly beneath it. The
            // crash state is the one exception — that plane is going in.
            let y = f.gy + f.alt;
            if (f.state !== 'crash') y = Math.max(y, gUnder + 12);
            f.mesh.position.set(f.x, y, f.z);
            f.mesh.rotation.order = 'YXZ';
            f.mesh.rotation.y = -f.angle + Math.PI / 2;
            f.mesh.rotation.z = f.bank;
            // pitchFix: per-model trim (debug panel → Fighter) on top of the
            // flight pitch (dive / crash).
            f.mesh.rotation.x = (f.state === 'crash' ? 0.35 : (f.pitch || 0)) + (def.pitchFix || 0);
        }
        // Ground shadow: the visual anchor that makes altitude READ from the
        // tilted camera (without it the plane looks glued to the terrain).
        if (!f.shadowMesh && Game.THREE && Game.scene) {
            const geo = new Game.THREE.CircleGeometry(2.4, 20);
            const mat = new Game.THREE.MeshBasicMaterial({
                color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false,
            });
            f.shadowMesh = new Game.THREE.Mesh(geo, mat);
            f.shadowMesh.rotation.x = -Math.PI / 2;
            f.shadowMesh.renderOrder = 3;
            f.shadowMesh.raycast = () => { };
            Game.scene.add(f.shadowMesh);
        }
        if (f.shadowMesh) {
            const sy = Game.getHeight ? Game.getHeight(f.x, f.z) : 0;
            f.shadowMesh.position.set(f.x, sy + 0.18, f.z);
            f.shadowMesh.material.opacity = 0.3 * Game.clamp(1 - f.alt / 80, 0.35, 1);
        }
        if (Game.Audio && Game.Audio.fighterDrone) Game.Audio.fighterDrone.setPos(f.x, f.z);
    }

    // lingering green mark on the called patrol area; while a plane is
    // SELECTED its patrol circle stays marked (and right-click re-tasks it)
    const sel = Game.selectedFighter;
    const zm = Game._fighterZoneMark
        || (sel && !sel.dead && sel.state !== 'crash' ? { x: sel.cx, z: sel.cz, t: 3 } : null);
    if (Game._fighterZoneMark) {
        Game._fighterZoneMark.t -= dt;
        if (Game._fighterZoneMark.t <= 0) Game._fighterZoneMark = null;
    }
    Game._syncZoneRing(zm && zm.t > 0 ? zm : null);
};

Game._removeFighter = (i) => {
    const f = Game.fighters[i];
    f.dead = true;
    if (Game.selectedFighter === f) Game.selectedFighter = null;
    if (f.mesh) Game.scene.remove(f.mesh);
    if (f.shadowMesh) Game.scene.remove(f.shadowMesh);
    Game.fighters.splice(i, 1);
    if (!Game.fighters.length && Game.Audio && Game.Audio.fighterDrone) {
        Game.Audio.fighterDrone.stop();
    }
};

// ── Fighter squadron menu (HUD): press Fighter once (or J) to see the planes
//    available with counts; pick one to arm it, then right-click the map. ─────
Game.toggleFighterMenu = () => {
    let m = Game._fighterMenuEl;
    if (!m) {
        m = document.createElement('div');
        m.id = 'fighterMenu';
        m.style.cssText = 'position:absolute;z-index:60;background:rgba(18,22,16,0.94);'
            + 'border:1px solid #4a5545;border-radius:6px;padding:6px;display:none;'
            + 'font:600 12px system-ui,Segoe UI,sans-serif;color:#dfe7d8;min-width:180px;';
        (document.getElementById('viewport') || document.body).appendChild(m);
        Game._fighterMenuEl = m;
    }
    if (m.style.display === 'block') { m.style.display = 'none'; return; }
    m.innerHTML = '<div style="color:#9ab08a;font-size:10px;text-transform:uppercase;'
        + 'letter-spacing:1px;margin-bottom:4px">Fighter sorties</div>';
    for (const key in Game.FIGHTER_TYPES) {
        const t = Game.FIGHTER_TYPES[key];
        const row = document.createElement('div');
        const off = t.count <= 0;
        row.style.cssText = 'display:flex;justify-content:space-between;gap:10px;'
            + 'padding:4px 6px;border-radius:4px;cursor:' + (off ? 'default' : 'pointer')
            + ';opacity:' + (off ? 0.45 : 1) + ';';
        row.innerHTML = `<span>✈ ${t.label}</span><span style="color:#ffd24a">×${t.count}</span>`;
        if (!off) {
            row.addEventListener('mouseenter', () => { row.style.background = 'rgba(90,110,80,0.4)'; });
            row.addEventListener('mouseleave', () => { row.style.background = 'none'; });
            row.addEventListener('click', () => {
                Game._fighterType = key;
                Game._commandMode = 'fighter';
                m.style.display = 'none';
                Game.pushMessage(`${t.label} armed — right-click the patrol area.`, 2.5);
                if (Game.Audio) Game.Audio.click();
            });
        }
        m.appendChild(row);
    }
    const btn = document.getElementById('cmdFighter');
    const vp = document.getElementById('viewport');
    if (btn && vp) {
        const b = btn.getBoundingClientRect(), v = vp.getBoundingClientRect();
        m.style.left = Math.max(4, b.left - v.left) + 'px';
        m.style.bottom = (v.bottom - b.top + 6) + 'px';
        m.style.top = 'auto';
    }
    m.style.display = 'block';
};

// Airborne plane under a screen point (for click selection, like tanks).
Game.fighterAtScreen = (sx, sy) => {
    if (!Game.worldToScreen) return null;
    for (const f of Game.fighters) {
        if (f.dead || f.state === 'crash') continue;
        const gy = (f.gy != null) ? f.gy : (Game.getHeight ? Game.getHeight(f.x, f.z) : 0);
        const p = Game.worldToScreen(f.x, f.z, gy + f.alt);
        if (Math.hypot(p.x - sx, p.y - sy) < 30) return f;
    }
    return null;
};

// ── Green targeting ring (cursor preview + lingering call mark) ─────────────
Game._mkFighterRing = (opacity) => {
    const THREE = Game.THREE;
    const geo = new THREE.RingGeometry(Game.FIGHTER.radius - 0.7, Game.FIGHTER.radius, 48);
    const mat = new THREE.MeshBasicMaterial({
        color: 0x55dd66, transparent: true, opacity,
        side: THREE.DoubleSide, depthWrite: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 500;
    m.raycast = () => { };
    Game.scene.add(m);
    return m;
};

Game._updateFighterPreview = () => {
    if (!Game.THREE || !Game.scene) return;
    const active = Game._commandMode === 'fighter';
    if (active && !Game._fighterRing) Game._fighterRing = Game._mkFighterRing(0.5);
    if (Game._fighterRing) {
        Game._fighterRing.visible = active;
        if (active && Game.mouse && Game.mouse.worldX != null) {
            const y = (Game.getHeight ? Game.getHeight(Game.mouse.worldX, Game.mouse.worldZ) : 0) + 0.25;
            Game._fighterRing.position.set(Game.mouse.worldX, y, Game.mouse.worldZ);
        }
    }
};

Game._syncZoneRing = (zm) => {
    if (!Game.THREE || !Game.scene) return;
    if (zm) {
        if (!Game._fighterZoneRing) Game._fighterZoneRing = Game._mkFighterRing(0.4);
        const r = Game._fighterZoneRing;
        r.visible = true;
        const y = (Game.getHeight ? Game.getHeight(zm.x, zm.z) : 0) + 0.25;
        r.position.set(zm.x, y, zm.z);
        r.material.opacity = 0.4 * Game.clamp(zm.t / 3, 0, 1);
    } else if (Game._fighterZoneRing) {
        Game._fighterZoneRing.visible = false;
    }
};

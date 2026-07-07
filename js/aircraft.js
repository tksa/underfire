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
    duration: 42,       // no-targets loiter before flying home (seconds)
    minRuns: 5,         // attack runs to deliver before egress (targets present)
    maxOnStation: 90,   // hard cap on time over the ring
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
        count: 2, baseCount: 2, speed: 26, rounds: 8, dmgSoft: 13, dmgHard: 0.8,
        yaw: Math.PI / 2, propZ: 2.82,   // measured: nose tip 4.1 native × 7/10.19 scale
    },
    mb152: {
        label: 'Bloch MB.152', model: 'models/bloch_mb152.glb',
        count: 2, baseCount: 2, speed: 21, rounds: 5, dmgSoft: 20, dmgHard: 2.4,
        yaw: Math.PI / 2, propZ: 2.78,   // measured: prop plane 0.76 native × 7/1.91 scale
    },
};
// Strafing target priority: infantry first (a fighter MOWS men down), then
// light/soft vehicles, armor last (rifle-calibre guns barely scratch it).
Game._strafePriority = (u) => {
    if (u.class === 'infantry' || u.class === 'support') return 0;
    const arm = (typeof u.armor === 'number') ? u.armor : ((u.armor && u.armor.front) || 0);
    return arm <= 12 ? 1 : 2;
};

Game.fighterTotalAvailable = () => {
    let n = 0;
    for (const k in Game.FIGHTER_TYPES) n += Game.FIGHTER_TYPES[k].count;
    return n;
};

// Playing as Germany: no Luftwaffe airframes in the hangar yet — the D.520
// and MB.152 are French, so fighter support is grounded until a Bf 109 lands
// in models/. (The HUD badge reads 0 and the squadron menu greys out.)
if (Game.playerTeam === Game.TEAM.GERMAN) {
    for (const k in Game.FIGHTER_TYPES) Game.FIGHTER_TYPES[k].count = 0;
}
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

// ── Propeller-blur overlay ───────────────────────────────────────────────────
// Neither GLB has a cleanly animatable prop (the MB.152 is one fused mesh), so
// the sense of a spinning prop comes from an OVERLAY: a translucent blur disc
// with radial streaks at the nose, rotating fast. Reads exactly like the
// photographed prop-disc shimmer and works uniformly for any airframe.
Game._propBlurTex = () => {
    if (Game._propTexCache) return Game._propTexCache;
    const S = 128, c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    const cx = S / 2;
    // faint dark disc body
    let g = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
    g.addColorStop(0, 'rgba(30,30,30,0.30)');
    g.addColorStop(0.75, 'rgba(40,40,40,0.16)');
    g.addColorStop(1, 'rgba(40,40,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cx, cx, 0, Math.PI * 2); ctx.fill();
    // three lighter streak sectors (the "blades" smeared into arcs)
    ctx.translate(cx, cx);
    for (let b = 0; b < 3; b++) {
        ctx.rotate(Math.PI * 2 / 3);
        const sg = ctx.createRadialGradient(0, 0, S * 0.08, 0, 0, cx);
        sg.addColorStop(0, 'rgba(220,220,210,0.28)');
        sg.addColorStop(1, 'rgba(220,220,210,0)');
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, cx * 0.98, -0.16, 0.16);
        ctx.closePath();
        ctx.fill();
    }
    Game._propTexCache = new Game.THREE.CanvasTexture(c);
    return Game._propTexCache;
};

// ── Aircraft ground shadow: a BLURRED SILHOUETTE of the actual airframe ─────
// Splat the model's own vertices in top view (spin-space: nose up-canvas),
// blur, cache per type. The procedural fallback silhouette is used until the
// GLB proto arrives; the shadow swaps to the real outline automatically.
Game._planeShadowTex = (type) => {
    Game._shadowTexCache = Game._shadowTexCache || {};
    const proto = Game._fighterProtos[type];
    const key = type + (proto ? ':glb' : ':proc');
    if (Game._shadowTexCache[key]) return { tex: Game._shadowTexCache[key], key };
    const THREE = Game.THREE;
    const src = proto || Game._procFighterModel();
    src.updateMatrixWorld(true);
    const pts = [];
    src.traverse(o => {
        if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
        const pos = o.geometry.attributes.position;
        const v = new THREE.Vector3();
        const step = Math.max(1, Math.floor(pos.count / 6000));
        for (let i = 0; i < pos.count; i += step) {
            v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
            pts.push([v.x, v.z]);
        }
    });
    if (!pts.length) return null;
    // Rotate into spin space (nose → +Z) with the per-type yaw correction.
    const def = Game.FIGHTER_TYPES[type] || {};
    const yaw = (src.userData && src.userData.procFallback) ? 0 : (def.yaw != null ? def.yaw : 0);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const rot = pts.map(([x, z]) => [x * cy + z * sy, -x * sy + z * cy]);
    let m = 0;
    rot.forEach(p => { m = Math.max(m, Math.abs(p[0]), Math.abs(p[1])); });
    const S = 128, half = S / 2, k = (half - 8) / (m || 1);
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    rot.forEach(([x, z]) => {
        // u right = spin +X, v up-canvas = spin +Z (the nose)
        ctx.fillRect(half + x * k - 1.5, half - z * k - 1.5, 3, 3);
    });
    // blur pass: soft-edged shadow, no hard vertex speckle
    const out = document.createElement('canvas');
    out.width = out.height = S;
    const octx = out.getContext('2d');
    octx.filter = 'blur(3px)';
    octx.drawImage(cv, 0, 0);
    const tex = new THREE.CanvasTexture(out);
    Game._shadowTexCache[key] = tex;
    return { tex, key };
};

Game._attachPropBlur = (f) => {
    if (!Game.THREE || !f.mesh) return;
    const THREE = Game.THREE;
    const scale = Game.FIGHTER.scale || 7;
    const geo = new THREE.CircleGeometry(scale * 0.16, 24);
    const mat = new THREE.MeshBasicMaterial({
        map: Game._propBlurTex(),
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const disc = new THREE.Mesh(geo, mat);
    // Outer-mesh space: nose = +Z after the inner yaw correction; a
    // CircleGeometry already faces +Z, so it only needs pushing forward to
    // the PROP PLANE. Offsets are measured from each GLB's geometry (nose tip
    // × normalization scale ≈ 2.8-2.9 world units, NOT the 3.3 the first cut
    // used — that floated the disc ahead of the spinner).
    const def = (f.def || Game.FIGHTER_TYPES[f.type]) || {};
    disc.position.set(0, 0, def.propZ != null ? def.propZ : scale * 0.405);
    disc.raycast = () => { };
    f.mesh.add(disc);
    f.propMesh = disc;
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
        Game._attachPropBlur(f);                        // spinning-prop overlay
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
    // THE GUN FIRES WHERE THE NOSE POINTS — nothing else. A burst happens only
    // inside the FIRING WINDOW of the current attack run:
    //   - facing: the run target must sit within ±0.35 rad of the nose;
    //   - depression floor: a fighter cannot shoot straight down — no fire
    //     inside ~0.85× its own height above ground;
    //   - range ceiling: beyond ~2.6× height the guns just plough dirt.
    // Between "target enters the sight" and "target vanishes under the nose"
    // there are typically one or two bursts — then the plane must come around.
    const tgt = f.runTargetId != null ? Game.getUnitById(f.runTargetId) : null;
    if (!tgt || !tgt.alive) return;
    const d = Game.dist(f.x, f.z, tgt.x, tgt.z);
    const dMin = f.alt * 0.85;
    const dMax = Math.max(f.alt * 2.6, 60);
    if (d < dMin || d > dMax) return;
    const aimErr = Game.angleDiff(f.angle, Game.angleTo(f.x, f.z, tgt.x, tgt.z));
    if (Math.abs(aimErr) > 0.15) return;            // guns don't traverse: SIGHT ON, or no shot
    const def = f.def || Game.FIGHTER_TYPES[f.type] || Game.FIGHTER_TYPES.d520;
    const nx = f.x + Math.cos(f.angle) * 3.4;       // rounds leave the NOSE
    const nz = f.z + Math.sin(f.angle) * 3.4;
    const y0 = (f.gy != null ? f.gy : 0) + f.alt - 0.6;
    f.firedThisRun = true;
    for (let r = 0; r < def.rounds; r++) {
        // WALKING FIRE: the burst stitches a ROW of impacts along the facing
        // line, striding through the target's range — the classic strafe
        // pepper line, not a random cloud.
        const stride = 0.90 + (r / Math.max(1, def.rounds - 1)) * 0.22;
        const rd = d * stride + Game.rand(-0.5, 0.5);
        const ix = f.x + Math.cos(f.angle) * rd + Game.rand(-0.7, 0.7);
        const iz = f.z + Math.sin(f.angle) * rd + Game.rand(-0.7, 0.7);
        Game.tracers.push({
            x: nx, z: nz, tx: ix, tz: iz,
            y0, y1: 0.4,
            life: 0.22, total: 0.22,
            team: Game.playerTeam, big: false, mesh: null,
        });
        // Every round chips the ground: a small dust kick at the impact —
        // together they draw the row of gunfire across the terrain.
        Game.smoke.push({
            x: ix, z: iz, r: 0.3 + Math.random() * 0.22,
            life: 0.55, total: 0.55,
            vx: Game.rand(-0.4, 0.4), vz: Game.rand(-0.4, 0.4),
            rise: 1.1, maxOpacity: 0.5, dust: true, mesh: null,
        });
        // BEATEN ZONE: a round hurts whoever actually stands at its impact —
        // aimed man or his neighbours; a burst walks through a whole file.
        let victim = null, vd = 1.5 * 1.5;
        for (const u of Game.units) {
            if (!u.alive || u.team === Game.playerTeam || u._garrisoned) continue;
            const dd = Game.distSq(ix, iz, u.x, u.z);
            if (dd < vd) { vd = dd; victim = u; }
        }
        if (!victim) continue;
        const prox = 1 - Math.sqrt(vd) / 1.5;         // dead-on hits hurt most
        if (Game.isTank(victim.kind)) {
            victim.hp -= def.dmgHard * prox;
            if (Game.Audio && Math.random() < 0.3) Game.Audio.ricochet(victim.x, victim.z);
        } else {
            victim.hp -= def.dmgSoft * (0.5 + prox) * Game.rand(0.8, 1.2);
        }
        victim.underFire = 0.9;
        victim._lastThreat = { x: f.x, z: f.z };
        victim._threatTime = Game.gameClock;
        victim.suppressionValue = Game.clamp((victim.suppressionValue || 0) + 10, 0, 100);
        if (victim.hp <= 0 && victim.alive) {
            victim.alive = false; victim.hp = 0;
            if (Game.selection.has(victim.id)) Game.selection.delete(victim.id);
            Game.pushMessage('Strafing run: enemy ' + victim.label + ' cut down.', 1.6);
        }
    }
    if (Game.alertAllies) Game.alertAllies(tgt, f.x, f.z);
    if (Game.Audio) Game.Audio.mg(f.x, f.z);
};

// ── Per-frame update (called from the game loop) ────────────────────────────
Game.updateFighters = (dt) => {
    Game._updateFighterPreview();
    const F = Game.FIGHTER;
    let rumble = 0;   // engine rumble felt by the camera from planes overhead

    for (let i = Game.fighters.length - 1; i >= 0; i--) {
        const f = Game.fighters[i];
        f.t += dt;
        const def = f.def || Game.FIGHTER_TYPES[f.type] || Game.FIGHTER_TYPES.d520;
        let speed = def.speed;
        // Firing dive: bleed off horizontal speed with the nose-down pitch —
        // buys the guns more time in the window, and from the top-down camera
        // it reads exactly right: the plane seems to hang as it trades
        // forward motion for the descent. Driven off f.pitch (now a REAL
        // aiming angle up to ~50°), floored so steep dives never stall it.
        if (f.state !== 'crash') speed *= Game.clamp(1 - (f.pitch || 0) * 0.75, 0.55, 1);

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
                // Aim the next pass THROUGH a victim when one stands in the
                // ring — a real strafing run lines up out of the TURNAROUND,
                // not scrambling mid-approach. No targets: fly a random chord.
                let aim = null, ad = Infinity;
                for (const u of Game.units) {
                    if (!u.alive || u.team === Game.playerTeam || u._garrisoned) continue;
                    if (Game.distSq(u.x, u.z, f.cx, f.cz) > (F.radius * 1.2) * (F.radius * 1.2)) continue;
                    // soft targets first: priority dominates, distance breaks ties
                    const score = Game._strafePriority(u) * 1e9 + Game.distSq(f.x, f.z, u.x, u.z);
                    if (score < ad) { ad = score; aim = u; }
                }
                if (aim) f.lastAimT = f.onT;
                const baseX = aim ? aim.x : f.cx, baseZ = aim ? aim.z : f.cz;
                const cross = Game.angleTo(f.x, f.z, baseX, baseZ)
                    + (aim ? Game.rand(-0.12, 0.12) : Game.rand(-0.55, 0.55));
                // The green ring bounds the TARGETS, never the flying: runs
                // reach far outside it so every turn-in has full runway.
                const out = F.radius * Game.rand(2.6, 3.6);
                const lat = aim ? 0 : Game.rand(-0.6, 0.6) * F.radius;
                const px = -Math.sin(cross), pz = Math.cos(cross);
                f.passX = Game.clamp(baseX + Math.cos(cross) * out + px * lat, 2, Game.WORLD_W - 2);
                f.passZ = Game.clamp(baseZ + Math.sin(cross) * out + pz * lat, 2, Game.WORLD_H - 2);
                f.steerRate = Game.rand(1.2, 1.9);   // every turn is its own turn
            }
            // ATTACK RUN: while a live target sits ahead in the ring, the run
            // bends to FACE it — a moving target pulls the nose around with it
            // (the guns only ever shoot along the nose, so tracking IS aiming).
            // Once the target slips beneath the depression floor or too far
            // off the nose, it's overflown: release it and fly the pass out.
            let runTgt = f.runTargetId != null ? Game.getUnitById(f.runTargetId) : null;
            if (!runTgt || !runTgt.alive
                || Game.distSq(runTgt.x, runTgt.z, f.cx, f.cz) > (F.radius * 1.2) * (F.radius * 1.2)) {
                runTgt = null; f.runTargetId = null;
            }
            // Post-pass commitment: after overflying, DON'T look for the next
            // victim immediately — fly the pass out first. Re-acquiring while
            // still on top of the target left no runway to line the guns up,
            // so the plane carved tight circles without ever firing.
            f.noAcqT = Math.max(0, (f.noAcqT || 0) - dt);
            if (!runTgt && f.noAcqT <= 0) {
                let bd = Infinity;
                for (const u of Game.units) {
                    if (!u.alive || u.team === Game.playerTeam || u._garrisoned) continue;
                    if (Game.distSq(u.x, u.z, f.cx, f.cz) > (F.radius * 1.2) * (F.radius * 1.2)) continue;
                    const dU = Game.dist(f.x, f.z, u.x, u.z);
                    const err = Math.abs(Game.angleDiff(f.angle, Game.angleTo(f.x, f.z, u.x, u.z)));
                    // RUNWAY gate: only start a run with room to align AND a
                    // stretch of firing window before the depression floor.
                    // Matched to the pass reach (~2.2-3.2 radii out).
                    if (err > 1.0 || dU < f.alt * 1.2) continue;
                    // infantry first, then soft vehicles; armor only if alone
                    const score = Game._strafePriority(u) * 1e9 + dU;
                    if (score < bd) { bd = score; runTgt = u; }
                }
                if (runTgt) f.runTargetId = runTgt.id;
            }
            let steerX = f.passX, steerZ = f.passZ, attacking = false;
            if (runTgt) {
                const dT = Game.dist(f.x, f.z, runTgt.x, runTgt.z);
                const err = Math.abs(Game.angleDiff(f.angle, Game.angleTo(f.x, f.z, runTgt.x, runTgt.z)));
                if (dT < f.alt * 0.75 || err > 1.5) {
                    f.runTargetId = null;            // overflown — come around again
                    f.pullT = 1.1;                   // ...PULL UP smartly...
                    f.noAcqT = 1.4;                  // ...and fly OUT before rearming
                    if (f.firedThisRun) {            // that was one delivered attack run
                        f.runsDone = (f.runsDone || 0) + 1;
                        f.firedThisRun = false;
                    }
                } else {
                    steerX = runTgt.x; steerZ = runTgt.z;
                    attacking = true;
                }
            }
            // Attack runs steer firmly but CAPPED at what a banked turn can
            // plausibly deliver (~1.55 rad/s) — the old 1.7× multiplier hit
            // 3+ rad/s, a flat yaw-whip onto the target that no roll could
            // sell. Cruise legs stay lazy.
            const steer = attacking
                ? Math.min((f.steerRate || 1.5) * 1.4, 1.55)
                : (f.steerRate || 1.5);
            f.angle = Game.rotateTo(f.angle, Game.angleTo(f.x, f.z, steerX, steerZ), steer * dt);
            // Gunnery is EVENT-driven, not a slow dice-roll cadence: the moment
            // the sight settles inside the firing window, shoot (short spacing
            // between bursts) — the old random 0.8-1.5s timer kept missing the
            // brief aligned window entirely, so the guns never spoke.
            f.burstT -= dt;
            if (attacking) {
                const dT = Game.dist(f.x, f.z, runTgt.x, runTgt.z);
                const err = Math.abs(Game.angleDiff(f.angle, Game.angleTo(f.x, f.z, runTgt.x, runTgt.z)));
                const inWindow = dT >= f.alt * 0.85 && dT <= Math.max(f.alt * 2.6, 60);
                if (inWindow) f.diveT = Math.max(f.diveT || 0, 0.3);   // nose down through the window
                // FIRE DISCIPLINE: facing the target in BOTH planes — heading
                // within the cone AND the nose pitched onto the target's
                // depression angle (the prop centreline literally on the unit)
                // — with wings level. Turn → roll out → nose drops onto the
                // target → THEN guns.
                const needPitch = Math.atan2(f.alt, Math.max(3, dT));
                if (inWindow && err <= 0.15 && f.burstT <= 0
                    && Math.abs(f.bank) < 0.14
                    && Math.abs((f.pitch || 0) - needPitch) < 0.12) {
                    f.burstT = Game.rand(0.3, 0.5);
                    Game._fighterStrafe(f);
                }
            }
            // Egress: after delivering the promised attack runs — or loitering
            // dry (no targets seen for a while) — or the hard time cap.
            const dry = (f.onT - (f.lastAimT || 0)) > F.duration;
            if ((f.runsDone || 0) >= (F.minRuns || 5) || dry || f.onT > (F.maxOnStation || 90)) {
                f.state = 'egress';
                Game.pushMessage((f.runsDone || 0) >= (F.minRuns || 5)
                    ? 'Fighter out of ammunition — returning to base.'
                    : 'Fighter returning to base.', 2.2);
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

        // ORGANIC FLIGHT — planes are not trains on sky rails. Two blended
        // slow sine bands (random phases per airframe) wander the heading a
        // few degrees either way, and every 1.5-4s a small GUST kicks the nose
        // and decays over ~half a second. The bank is computed from the
        // MEASURED turn rate below, so wander and gusts visibly rock the
        // wings without any extra code.
        if (f.state !== 'crash') {
            // a pilot damps his inputs on a gun run — wander/gusts quiet down
            // while tracking a target so the sight can settle
            const damp = f.runTargetId != null ? 0.35 : 1;
            const wanderVel = (Math.sin(f.t * 0.7 + f.ph1) * 0.10
                + Math.sin(f.t * 1.9 + f.ph2) * 0.05) * damp;
            f.angle += wanderVel * dt;
            f.gustT = (f.gustT == null ? Game.rand(1, 3) : f.gustT) - dt;
            if (f.gustT <= 0) {
                f.gustT = Game.rand(1.5, 4);
                f.gustV = Game.rand(-0.5, 0.5);
            }
            if (f.gustV) {
                f.angle += f.gustV * dt;
                f.gustV *= Math.max(0, 1 - dt * 2.2);
                if (Math.abs(f.gustV) < 0.02) f.gustV = 0;
            }
        }

        // integrate along the heading; bank into the turn
        const prevA = f.prevAngle == null ? f.angle : f.prevAngle;
        const turnRate = Game.angleDiff(prevA, f.angle) / Math.max(dt, 1e-4);
        f.prevAngle = f.angle;
        // Gentle banking INTO the turn (sign verified in play: a right-hand
        // turn drops the right wing). Cap stays modest — a steep bank rolled
        // the belly toward the camera and read as the plane "tilting up".
        const bankTarget = f.state === 'crash' ? 1.1 : Game.clamp(turnRate * 0.4, -0.42, 0.42);
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
            // AIM PITCH: on an attack run the nose points AT the unit — the
            // prop centreline intersects the target (depression angle =
            // atan(height / distance), 20-50° through the window), not a
            // token cosmetic dip. No run: level, with a shallow dip while a
            // recent window is still cooling off.
            let pitchTarget = diving ? 0.22 : 0;
            const rt0 = (f.state === 'onstation' && f.runTargetId != null)
                ? Game.getUnitById(f.runTargetId) : null;
            if (rt0 && rt0.alive) {
                const dT0 = Game.dist(f.x, f.z, rt0.x, rt0.z);
                const hT0 = (f.gy + f.alt) - (Game.getHeight ? Game.getHeight(rt0.x, rt0.z) : 0);
                pitchTarget = Game.clamp(Math.atan2(Math.max(1, hT0), Math.max(3, dT0)), 0, 0.95);
            }
            // RATE-LIMITED pitch: the nose EASES over into the dive (≤0.55
            // rad/s — no instant slam onto the target when a run starts) and
            // recovers faster on the pull-up. An exponential lerp here snapped
            // ~35° of nose-down in a blink, which read as the plane "rotating"
            // onto the enemy instead of flying onto it.
            const dPitch = pitchTarget - (f.pitch || 0);
            const pitchRate = dPitch > 0 ? 0.55 : 1.4;
            f.pitch = (f.pitch || 0) + Game.clamp(dPitch, -pitchRate * dt, pitchRate * dt);
            const altTarget = (f.state === 'onstation')
                ? F.alt + Math.sin((f.ph1 || 0) * 1.31) * 1.2 - (diving ? 10 : 0)
                : null;
            if (altTarget != null) {
                // descend into the pass quickly; after the pass (pullT, set on
                // target release) climb out QUICKLY, otherwise drift up gently
                f.pullT = Math.max(0, (f.pullT || 0) - dt);
                const upRate = f.pullT > 0 ? 1.5 : 0.45;
                f.alt += (altTarget - f.alt) * Math.min(1, dt * (altTarget < f.alt ? 1.6 : upRate));
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
            // altitude micro-turbulence: a light bob on top of the flight path
            if (f.state !== 'crash') {
                y += Math.sin(f.t * 1.6 + f.ph2) * 0.35;
                y = Math.max(y, gUnder + 12);
            }
            f.mesh.position.set(f.x, y, f.z);
            f.mesh.rotation.order = 'YXZ';
            f.mesh.rotation.y = -f.angle + Math.PI / 2;
            f.mesh.rotation.z = f.bank;
            // pitchFix: per-model trim (debug panel → Fighter) on top of the
            // flight pitch (dive / crash).
            f.mesh.rotation.x = (f.state === 'crash' ? 0.35 : (f.pitch || 0)) + (def.pitchFix || 0);
        }
        // Ground shadow: a blurred SILHOUETTE of the airframe (not a blob) —
        // the visual anchor that makes altitude READ from the tilted camera.
        // Locked to the flight heading; swaps from the fallback outline to the
        // real model's outline the moment the GLB proto is available.
        if (!f.shadowMesh && Game.THREE && Game.scene) {
            const sh = Game._planeShadowTex(f.type || 'd520');
            const span = (F.scale || 7) * 1.15;
            const geo = new Game.THREE.PlaneGeometry(span, span);
            const mat = new Game.THREE.MeshBasicMaterial({
                map: sh ? sh.tex : null,
                transparent: true, opacity: 0.4, depthWrite: false,
                side: Game.THREE.DoubleSide,
            });
            f.shadowMesh = new Game.THREE.Mesh(geo, mat);
            f.shadowMesh.rotation.order = 'YXZ';
            f.shadowMesh.rotation.x = Math.PI / 2;
            f.shadowMesh.renderOrder = 3;
            f.shadowMesh.raycast = () => { };
            f.shadowMesh.userData.texKey = sh ? sh.key : null;
            Game.scene.add(f.shadowMesh);
        }
        if (f.shadowMesh) {
            // upgrade to the real outline once the model has loaded
            const sh = Game._planeShadowTex(f.type || 'd520');
            if (sh && f.shadowMesh.userData.texKey !== sh.key) {
                f.shadowMesh.material.map = sh.tex;
                f.shadowMesh.material.needsUpdate = true;
                f.shadowMesh.userData.texKey = sh.key;
            }
            const sy = Game.getHeight ? Game.getHeight(f.x, f.z) : 0;
            f.shadowMesh.position.set(f.x, sy + 0.18, f.z);
            f.shadowMesh.rotation.y = -f.angle + Math.PI / 2;   // follow the heading
            f.shadowMesh.material.opacity = 0.42 * Game.clamp(1 - f.alt / 80, 0.35, 1);
        }
        // Prop-blur spin: fast rotation + slight opacity shimmer sells the
        // running engine; a crashing plane's prop windmills down and fades.
        if (f.propMesh) {
            const spin = f.state === 'crash' ? 9 : 38;
            f.propMesh.rotation.z += spin * dt;
            f.propMesh.material.opacity = (f.state === 'crash' ? 0.55 : 0.9)
                + Math.sin(f.t * 47) * 0.1;
        }

        if (Game.Audio && Game.Audio.fighterDrone) Game.Audio.fighterDrone.setPos(f.x, f.z);

        // Low flyover rumble: strongest when the plane is close to the view
        // AND low (strafing dives shake more than high transit). Consumed by
        // the camera as a continuous micro-vibration — see updateCamera.
        if (Game.cam) {
            const camD = Math.hypot(f.x - Game.cam.x, f.z - Game.cam.z);
            const reach = (Game.cam.zoom || 20) * 2.2;
            if (camD < reach) {
                const altF = Game.clamp(1.5 - f.alt / (F.alt || 34), 0.35, 1.2);
                rumble = Math.max(rumble, (1 - camD / reach) * altF);
            }
        }
    }
    Game.planeRumble = rumble;

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

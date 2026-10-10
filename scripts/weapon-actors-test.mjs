/** Aircraft and scripted railway weapons use their visible moving mounts. */
import { chromium } from 'playwright';
import fs from 'node:fs';
const out = process.argv[2] || '/tmp/underfire-weapon-actors';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
    await page.goto(process.env.SMOKE_URL || 'http://localhost:8741', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Game.units?.length, null, { timeout: 120000, polling: 250 });
    await page.evaluate(() => {
        Game._paused = true; window.requestAnimationFrame = () => 0;
        Game.units = []; Game.selection.clear(); Game.fighters = [];
        for (const type of ['d520', 'mb152']) {
            const f = { type, def: Game.FIGHTER_TYPES[type], x: 200, z: 220, angle: 0,
                alt: 22, gy: 0, bank: 0.3, pitch: 0.2, t: 0, ph2: 0, state: 'onstation' };
            Game.fighters.push(f); Game._attachFighterMesh(f);
        }
        window._actorCavalry = Game.makeUnit('polish', 'mounted_ulan', 220, 230, { aiState: 'player', angle: 0 });
    });
    await page.waitForFunction(() => Game.fighters.every(f => Game._fighterProtos[f.type]
        && !f.mesh.userData.procFallback) && _actorCavalry.mesh.userData.isMountedCavalry,
    null, { timeout: 120000, polling: 250 });
    const result = await page.evaluate(() => {
        const T = Game.THREE, checks = [], poses = [];
        const check = (name, pass) => checks.push({ name, pass: !!pass });
        const target = Game.makeUnit('german', 'grenadier', 240, 220, { aiState: 'player' });
        target.hp = target.maxHp = 1e9;
        for (const f of Game.fighters) {
            f.runTargetId = target.id;
            Game.tracers.length = 0; Game._fighterStrafe(f);
            const mounts = f.mesh.userData.weaponMuzzles;
            check(`${f.type}: four wing mounts`, mounts.length === 4);
            check(`${f.type}: strafing produces rounds`, Game.tracers.length === f.def.rounds);
            Game.tracers.forEach((t, i) => {
                const p = mounts[i % mounts.length].anchor.getWorldPosition(new T.Vector3());
                check(`${f.type}: banked/diving round ${i} leaves barrel`, Math.hypot(p.x - t.x, p.y - t.y0, p.z - t.z) < 1e-5);
            });
            const a = mounts[0].anchor.getWorldPosition(new T.Vector3());
            const b = mounts[3].anchor.getWorldPosition(new T.Vector3());
            check(`${f.type}: bank changes left/right firing height`, Math.abs(a.y - b.y) > 0.2);
        }
        const c = _actorCavalry;
        c.fireTargetId = target.id; c.holdFire = false; c.ammo = 30;
        for (const [clip, bearing] of [['fire_forward', 0], ['fire_right', Math.PI / 2], ['fire_left', -Math.PI / 2], ['fire_backward', Math.PI]]) {
            target.x = c.x + Math.cos(bearing) * 30; target.z = c.z + Math.sin(bearing) * 30;
            Game.syncWeaponTransform(c);
            for (let i = 0; i < 45; i++) { Game.gameClock += 1 / 30; Game._updateModelAnimation(c, 1 / 30); }
            const p = Game.getWeaponMuzzle(c);
            const toTarget = new T.Vector3(target.x - p.x, (target.y || 0) + 0.7 - p.y, target.z - p.z).normalize();
            check(`mounted rifle aims ${clip}`, p.direction.dot(toTarget) > 0.995);
            check(`halted horse stays in an aiming pose ${clip}`, c.mesh.userData._activeClip === clip.replace('fire_', 'aim_'));
            poses.push({ clip, active: c.mesh.userData._activeClip,
                muzzle: [p.x - c.x, p.y - (c.y || 0), p.z - c.z], direction: p.direction.toArray() });
        }
        c.ammo = 0;
        check('empty mounted rifle does not choose a firing take', !/^(fire|aim)_/.test(Game.chooseCavalryClip(c, c.mesh.userData.clipNames)));
        c.ammo = 30; c.holdFire = true;
        check('mounted hold-fire does not choose a firing take', !/^(fire|aim)_/.test(Game.chooseCavalryClip(c, c.mesh.userData.clipNames)));
        c.holdFire = false;
        const mesh = Game._buildMokraTrainMesh();
        Game.scene.add(mesh); mesh.position.set(230, 0.15, 220);
        Game._mokraTrain = { mesh, x: 230, z: 220, state: 'firing', departAt: 10000 };
        const oldLOS = Game.lineOfSight; Game.lineOfSight = () => true;
        target.x = 195; target.z = 235;
        Game.tracers.length = 0;
        try {
            for (const w of mesh.userData.wagons) w.cooldown = 0;
            Game.updateMokraTrain(1 / 30);
            check('railway gun waits while traversing', Game.tracers.length === 0);
            for (let i = 0; i < 100 && !Game.tracers.length; i++) Game.updateMokraTrain(1 / 30);
            check('railway gun fires after traverse', Game.tracers.length > 0);
            const t = Game.tracers[0];
            check('railway round leaves a visible muzzle', t && mesh.userData.wagons.some(w => {
                const p = w.muzzle.getWorldPosition(new T.Vector3());
                return Math.hypot(p.x - t.x, p.y - t.y0, p.z - t.z) < 0.02;
            }));
        } finally { Game.lineOfSight = oldLOS; }
        return { checks, cavalry: poses };
    });
    fs.writeFileSync(`${out}/checks.json`, JSON.stringify(result, null, 2));
    await page.evaluate(() => {
        const T = Game.THREE, scene = new T.Scene(); scene.background = new T.Color(0x56615e);
        scene.add(new T.HemisphereLight(0xffffff, 0x777760, 2));
        const sun = new T.DirectionalLight(0xffffff, 3); sun.position.set(2, 8, 5); scene.add(sun);
        Game.fighters.forEach((f, i) => {
            scene.add(f.mesh); f.mesh.position.set(i ? 4 : -4, 0, 0); f.mesh.rotation.set(0, 0, 0);
            for (const b of f.mesh.userData.weaponMuzzles) {
                const dot = new T.Mesh(new T.SphereGeometry(0.06, 8, 6), new T.MeshBasicMaterial({ color: 0xff4444, depthTest: false }));
                b.anchor.add(dot);
            }
        });
        const camera = new T.OrthographicCamera(-8.5, 8.5, 6, -6, 0.1, 50);
        camera.position.set(1, 14, 5); camera.lookAt(0, 0, 0);
        const canvas = Game.renderer.domElement; document.body.replaceChildren(canvas);
        canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
        Game.renderer.setPixelRatio(1); Game.renderer.setSize(1200, 850); Game.renderer.render(scene, camera);
    });
    await page.screenshot({ path: `${out}/aircraft.png` });
    await page.evaluate(() => {
        const T = Game.THREE, scene = new T.Scene(); scene.background = new T.Color(0x59615a);
        scene.add(new T.HemisphereLight(0xffffff, 0x999070, 2));
        const sun = new T.DirectionalLight(0xffffff, 3); sun.position.set(2, 8, 5); scene.add(sun);
        const c = _actorCavalry; scene.add(c.mesh); c.x = c.z = c.y = 0;
        c.mesh.userData.selectionRing.visible = c.mesh.userData.healthBar.visible = false;
        const camera = new T.OrthographicCamera(-1.8, 1.8, 1.275, -1.275, 0.1, 30);
        camera.position.set(4, 3, 5); camera.lookAt(0, 0.85, 0);
        const marker = new T.Mesh(new T.SphereGeometry(0.035, 8, 6), new T.MeshBasicMaterial({ color: 0xff4444, depthTest: false }));
        scene.add(marker);
        window._renderRiderAim = bearing => {
            const target = Game.getUnitById(c.fireTargetId);
            target.x = Math.cos(bearing) * 30; target.y = 0; target.z = Math.sin(bearing) * 30;
            Game.syncWeaponTransform(c);
            for (let i = 0; i < 45; i++) { Game.gameClock += 1 / 30; Game._updateModelAnimation(c, 1 / 30); }
            const p = Game.getWeaponMuzzle(c); marker.position.set(p.x, p.y, p.z);
            Game.renderer.render(scene, camera);
        };
    });
    for (const [name, bearing] of [['forward', 0], ['right', Math.PI / 2], ['backward', Math.PI], ['left', -Math.PI / 2]]) {
        await page.evaluate(b => _renderRiderAim(b), bearing);
        await page.screenshot({ path: `${out}/cavalry-${name}.png` });
    }
    const failures = result.checks.filter(c => !c.pass);
    console.log(`${result.checks.length - failures.length}/${result.checks.length} actor weapon checks passed.`, result.cavalry);
    if (failures.length || errors.length) {
        console.error({ failures, errors }); process.exitCode = 1;
    }
} finally { await browser.close(); }

/** Render actual loaded infantry through movement, turns and camera-edge poses. */
import { chromium } from 'playwright';
import fs from 'node:fs';
const out = process.argv[2] || 'tmp/infantry-review';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8741', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Game.units?.length > 0);
    await page.evaluate(() => {
        Game._paused = true; window.requestAnimationFrame = () => 0;
        window.subjects = ['french', 'german', 'polish'].flatMap(team => {
            const kinds = { french: ['fusilier', 'fm24', 'medic'], german: ['grenadier', 'mg34', 'mp38'], polish: ['rifleman', 'rkm_wz28', 'medic'] }[team];
            return kinds.map(kind => Game.makeUnit(team, kind, 220, 230, { aiState: 'player' }));
        });
    });
    await page.waitForFunction(() => subjects.every(u => u.mesh.userData.isSoldier), null, { timeout: 120000 });
    const result = await page.evaluate(() => {
        const T = Game.THREE, failures = [], samples = [], checks = [];
        const check = (name, pass, detail) => { checks.push({ name, pass: !!pass, detail }); if (!pass) failures.push(name); };
        const scene = new T.Scene(); scene.background = new T.Color(0x000000);
        const renderer = new T.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true }); renderer.setSize(128, 128);
        const target = new T.WebGLRenderTarget(128, 128);
        const pixels = new Uint8Array(128 * 128 * 4);
        const camera = new T.OrthographicCamera(-1.2, 1.2, 1.5, -0.9, 0.01, 20);
        camera.position.set(0, 0.6, 5); camera.lookAt(0, 0.6, 0);
        scene.overrideMaterial = new T.MeshBasicMaterial({ color: 0xffffff });
        const states = [['walk', 'stand', 1.1], ['run', 'run', 4], ['crawl', 'prone', 0.5], ['crouch_walk', 'crouch', 1.2], ['aim_stand', 'stand', 0], ['aim_crouch', 'crouch', 0], ['prone_idle', 'prone', 0]];
        for (const unit of subjects) {
            const data = unit.mesh.userData, key = `${unit.team}_${unit.kind}`;
            check(`${key}: replacement rig`, Game.isMowSoldier(data.soldierModel));
            check(`${key}: complete actions`, ['idle', 'walk', 'run', 'crawl', 'crouch_walk', 'reload_stand', 'death'].every(n => data.actions[n]));
            const skins = []; data.soldierModel.traverse(o => { if (o.isSkinnedMesh) skins.push(o); });
            const rigidVisibility = [];
            data.soldierModel.traverse(o => {
                if (o.isMesh && !o.isSkinnedMesh) { rigidVisibility.push([o, o.visible]); o.visible = false; }
            });
            check(`${key}: independent skeleton`, skins.length > 0 && skins.every(s => s.skeleton.bones.every(b => data.soldierModel.getObjectById(b.id))));
            check(`${key}: attached weapon`, unit.kind === 'medic' ? data.weaponMuzzles.length === 0 : data.weaponMuzzles.length === 1);
            const wrapper = data.modelWrapper; scene.add(wrapper);
            for (let frame = 0; frame < 420; frame++) {
                const [clip, stance, speed] = states[Math.floor(frame / 60)];
                unit.stance = stance; unit._dispSpeed = unit.currentSpeed = speed;
                unit.fireTargetId = speed ? null : 999; unit.ammo = 30; unit.holdFire = false;
                Game.gameClock += 1 / 30; Game._updateModelAnimation(unit, 1 / 30);
                // Abrupt alternating turns exercise every model orientation,
                // while continuous time catches failures within each run loop.
                wrapper.rotation.y = frame * 0.23;
                wrapper.position.x = frame % 3 === 0 ? -1.0 : frame % 3 === 1 ? 1.0 : 0;
                scene.updateMatrixWorld(true);
                renderer.setRenderTarget(target); renderer.render(scene, camera);
                renderer.readRenderTargetPixels(target, 0, 0, 128, 128, pixels);
                let count = 0; for (let p = 0; p < pixels.length; p += 4) if (pixels[p] > 32) count++;
                if (count < 35) failures.push(`${key} vanishes at ${clip} frame ${frame}: ${count} pixels`);
                samples.push({ unit: key, frame, clip: data._activeClip, pixels: count });
                if (skins.some(s => s.skeleton.boneMatrices.some(v => !Number.isFinite(v)))) failures.push(`${key}: nonfinite skin matrices`);
            }
            wrapper.position.x = 0; wrapper.rotation.y = 0; unit.mesh.add(wrapper);
            for (const [mesh, visible] of rigidVisibility) mesh.visible = visible;
            if (unit.kind !== 'medic') {
                unit.angle = 0.7; unit.stance = 'stand'; unit._dispSpeed = unit.currentSpeed = 0;
                unit.fireTargetId = 999; Game.syncWeaponTransform(unit);
                for (let i = 0; i < 60; i++) { Game.gameClock += 1 / 30; Game._updateModelAnimation(unit, 1 / 30); }
                const muzzle = Game.getWeaponMuzzle(unit);
                const alignment = muzzle.direction.dot(new T.Vector3(Math.cos(unit.angle), 0, Math.sin(unit.angle)));
                check(`${key}: visible bore follows aim`, alignment > 0.97, alignment);
            }
        }
        // Visual contact sheet uses the actual materials and the runtime poses.
        scene.overrideMaterial = null; scene.background.setHex(0x29303a);
        scene.add(new T.HemisphereLight(0xeef3ff, 0x675846, 2));
        const sun = new T.DirectionalLight(0xffffff, 3); sun.position.set(3, 5, 4); scene.add(sun);
        renderer.setRenderTarget(null); renderer.setSize(1200, 900); renderer.setScissorTest(true);
        camera.position.set(2, 1.4, 3); camera.lookAt(0, 0.6, 0);
        for (let i = 0; i < subjects.length; i++) {
            const unit = subjects[i], data = unit.mesh.userData, wrapper = data.modelWrapper;
            unit.stance = 'stand'; unit._dispSpeed = unit.currentSpeed = 0;
            data.mixer.stopAllAction(); data._activeClip = null;
            Game._playClip(unit, unit.kind === 'medic' ? 'idle' : 'aim_stand', 0); data.mixer.update(0);
            scene.add(wrapper); scene.updateMatrixWorld(true);
            renderer.setViewport(i % 3 * 400, (2 - Math.floor(i / 3)) * 300, 400, 300);
            renderer.setScissor(i % 3 * 400, (2 - Math.floor(i / 3)) * 300, 400, 300); renderer.render(scene, camera);
            unit.mesh.add(wrapper);
        }
        return { checks, samples, failures, png: renderer.domElement.toDataURL('image/png') };
    });
    fs.writeFileSync(`${out}/infantry.png`, Buffer.from(result.png.split(',')[1], 'base64'));
    delete result.png; result.errors = errors;
    fs.writeFileSync(`${out}/visibility.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ checks: result.checks.length, renderedFrames: result.samples.length, minPixels: Math.min(...result.samples.map(s => s.pixels)), failures: result.failures.slice(0, 25), errors }, null, 2));
    if (result.failures.length || errors.length) process.exitCode = 1;
} finally { await browser.close(); }

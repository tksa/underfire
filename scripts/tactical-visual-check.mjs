/** Render a repeatable close view of the changed poses and gun carriages. */
import { chromium } from 'playwright';
import fs from 'node:fs';
const output = process.argv[2] || '/tmp/underfire-tactical-review';
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
    await page.goto(process.env.SMOKE_URL || 'http://localhost:8741', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.Game?.units?.length > 0, null, { timeout: 120000, polling: 250 });
    await page.evaluate(() => {
        Game._paused = true; window.requestAnimationFrame = () => 0;
        for (const u of Game.units) { u.alive = false; u.mesh.visible = false; }
        Game.units = [];
        const defs = [['french','fusilier'], ['german','grenadier'], ['polish','rifleman'],
            ['german','pak36'], ['polish','bofors37'], ['french','at_25mm']];
        window._showcase = defs.map(([team, kind], i) => {
            const u = Game.makeUnit(team, kind, 220 + i * 6, 250, { aiState: 'player' });
            u.stance = i === 1 ? 'crouch' : i === 2 ? 'prone' : 'stand';
            u._dispSpeed = i === 1 ? 1 : i === 2 ? 0.6 : 0;
            u.currentSpeed = u._dispSpeed; u.moving = u._dispSpeed > 0;
            u.holdFire = false; u.fireTargetId = i === 0 ? 1234 : null;
            return u;
        });
    });
    await page.waitForFunction(() => _showcase.slice(0, 3).every(u => u.mesh.userData.isSoldier)
        && _showcase[5].mesh.userData.modelWrapper
        && _showcase.slice(3).every(u => !Game.GUN_CREWS?.[u.kind]
            || u.mesh.userData.fieldGunCrew?.userData.crewMode === 'soldier'), null, { timeout: 120000, polling: 250 });
    await page.evaluate(() => {
        const T = Game.THREE;
        const scene = new T.Scene(); scene.background = new T.Color(0x222b29);
        scene.add(new T.HemisphereLight(0xe6efff, 0x8d8268, 2.3));
        const sun = new T.DirectionalLight(0xffedcb, 3); sun.position.set(-4, 8, 5); scene.add(sun);
        sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
        Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 0.1, far: 30 });
        sun.shadow.normalBias = 0.02;
        const camera = new T.OrthographicCamera(-5.2, 5.2, 3.25, -3.25, 0.1, 50);
        camera.position.set(4, 7, 11); camera.lookAt(0, 0.2, 0);
        const plane = new T.Mesh(new T.PlaneGeometry(30, 30), new T.MeshStandardMaterial({ color: 0x677062, roughness: 1 }));
        plane.rotation.x = -Math.PI / 2; plane.position.y = -0.015; plane.receiveShadow = true; scene.add(plane);
        _showcase.forEach((u, i) => {
            scene.add(u.mesh); u.mesh.visible = true;
            u.mesh.position.set((i % 3 - 1) * 2.8, 0, i < 3 ? -1.9 : 1.7);
            u.mesh.rotation.set(0, -0.35, 0);
            u.mesh.userData.selectionRing.visible = false;
            u.mesh.userData.healthBar.visible = false;
        });
        const canvas = Game.renderer.domElement;
        document.body.replaceChildren(canvas);
        canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
        const legend = document.createElement('div');
        legend.style.cssText = 'position:fixed;top:22px;left:28px;color:white;font:16px system-ui;line-height:1.7;pointer-events:none';
        legend.textContent = 'Under Fire | aim · crouch walk · crawl / PaK 36 · Bofors 37 · Hotchkiss 25';
        document.body.append(legend);
        Game.renderer.setPixelRatio(1); Game.renderer.setSize(1440, 900);
        Game.renderer.toneMapping = T.ACESFilmicToneMapping;
        Game.renderer.toneMappingExposure = 1;
        window._showcaseFrame = dt => {
            Game.gameClock += dt;
            _showcase.forEach(u => {
                Game._updateModelAnimation(u, dt);
                if (Game.GUN_CREWS?.[u.kind]) Game.updateFieldGunCrew(u, dt);
            });
            Game.renderer.render(scene, camera);
        };
        for (let i = 0; i < 60; i++) _showcaseFrame(1 / 30);
    });
    for (let i = 0; i < 3; i++) {
        await page.evaluate(() => { for (let j = 0; j < 8; j++) _showcaseFrame(1 / 30); });
        await page.screenshot({ path: `${output}/poses-${i}.png` });
    }
    console.log(`Visual samples: ${output}/poses-0.png through poses-2.png`);
} finally { await browser.close(); }

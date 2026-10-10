/** Combat sprites must preserve shared buffers and reuse bounded materials. */
import { chromium } from 'playwright';
const browser = await chromium.launch();
try {
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8741', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Game.units?.length, null, { timeout: 120000 });
    const report = await page.evaluate(() => {
        Game._paused = true; window.requestAnimationFrame = () => 0;
        Game.smoke = []; Game.muzzleFlashes = [];
        const checks = [], check = (name, pass) => checks.push({ name, pass: !!pass });
        const T = Game.THREE, probe = new T.Sprite(new T.SpriteMaterial());
        let disposed = 0; probe.geometry.addEventListener('dispose', () => disposed++);
        const spawn = (count) => {
            for (let i = 0; i < count; i++) {
                Game.smoke.push({ x: 80, z: 80, r: .5, life: 1, total: 1, tint: 0x123456, mesh: null });
                Game.muzzleFlashes.push({ x: 80, z: 80, y: 1.2, r: .25, life: 1, total: 1, mesh: null });
            }
            Game.updateSmoke3D(.05);
        };
        const objects = new Set(), materials = new Set();
        const start = performance.now();
        for (let cycle = 0; cycle < 100; cycle++) {
            spawn(32);
            for (const s of [...Game.smoke, ...Game.muzzleFlashes]) {
                objects.add(s.mesh); materials.add(s.mesh.material);
            }
            Game.updateSmoke3D(2);
        }
        const elapsedMs = performance.now() - start;
        check('expiry never disposes shared sprite geometry', disposed === 0);
        check('100 bursts reuse their sprites and materials', objects.size === 64 && materials.size === 64);
        spawn(2);
        const s = Game.smoke[0], f = Game.muzzleFlashes[0];
        check('simultaneous puffs keep independent material state', s.mesh.material !== Game.smoke[1].mesh.material);
        check('reused smoke retains tint, size and fade curve', s.mesh.material.color.getHex() === 0x123456
            && Math.abs(s.mesh.scale.x - .53 * 2.4) < .00001
            && Math.abs(s.mesh.material.opacity - .6 * (1 - .65 * (.05 / .35)) * (.05 / .08)) < .00001);
        check('flash reuse resets initial size, opacity and height', f.mesh.scale.x === 1
            && f.mesh.material.opacity === .95 && f.mesh.position.y === 1.2);
        Game.updateSmoke3D(2);
        spawn(600); Game.updateSmoke3D(2);
        check('idle pool is bounded without limiting active effects', Game._effectSpritePools
            && Game._effectSpritePools.smoke.length <= 256 && Game._effectSpritePools.flash.length <= 128);
        check('expired effects leave no attached sprites', !Game.effectsGroup.children.some(o => o.isSprite));
        return { checks, elapsedMs, spritesCreated: objects.size, materialsCreated: materials.size, sharedGeometryDisposals: disposed };
    });
    console.log(JSON.stringify({ ...report, errors }, null, 2));
    process.exitCode = report.checks.some(c => !c.pass) || errors.length ? 1 : 0;
} finally { await browser.close(); }

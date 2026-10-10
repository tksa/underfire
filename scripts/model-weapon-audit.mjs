/** Visual/model diagnostics for every shipped ground combat model and fallback. */
import { chromium } from 'playwright';
import fs from 'node:fs';
const args = process.argv.slice(2);
const out = args.find(a => !a.startsWith('--')) || '/tmp/underfire-model-weapons';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 750 } });
try {
    await page.goto(process.env.SMOKE_URL || 'http://localhost:8741', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.Game?.units?.length, null, { timeout: 120000, polling: 250 });
    const names = await page.evaluate(() => {
        Game._paused = true; window.requestAnimationFrame = () => 0;
        Game.units = []; Game.selection.clear();
        const defs = { french: ['b1', 'r35', 's35', 'h35', 'panhard', 'at_25mm', 'at_47mm', 'fusilier', 'hmg', 'mortar_60', 'mortar_81'],
            german: ['panzer1', 'panzer2', 'panzer3', 'panzer4', 'sdkfz', 'pak36', 'hmg', 'mortar_50', 'mortar_81'],
            polish: ['7tp', '7tp_dw', '7tp_dwr', 'tks', 'tks20', 'wz34', 'fieldgun75', 'bofors37', 'mounted_ulan', 'hmg', 'mortar46', 'mortar81'] };
        window._auditUnits = [];
        for (const [team, kinds] of Object.entries(defs)) for (const kind of kinds) {
            if (!Game.UNIT_STATS[`${team}_${kind}`]) continue;
            const u = Game.makeUnit(team, kind, 220, 230, { aiState: 'player', angle: Math.PI / 2 });
            u.stance = 'stand'; u.holdFire = false; u.fireTargetId = 12345;
            _auditUnits.push(u);
        }
        return _auditUnits.map(u => `${u.team}_${u.kind}`);
    });
    await page.waitForFunction(() => _auditUnits.every(u => u.mesh.userData.modelPath
        || Game._modelLoadFailed?.has(`${u.team}_${u.kind}`)), null, { timeout: 120000, polling: 250 });
    const checks = await page.evaluate(() => {
        const T = Game.THREE, results = [];
        const check = (name, pass) => results.push({ name, pass: !!pass });
        const target = Game.makeUnit('german', 'grenadier', 250, 230, { aiState: 'player' });
        target.hp = target.maxHp = 1e9; target.coverBonus = 0; target.armor = 0;
        const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 1e-5;
        for (const u of _auditUnits) {
            for (const other of _auditUnits) other.alive = other === u;
            const key = `${u.team}_${u.kind}`, ud = u.mesh.userData;
            check(`${key}: actual weapon anchor`, ud.weaponMuzzles?.length > 0);
            Game.syncWeaponTransform(u);
            // Independent spatial check: a wrong bind matrix can put an anchor
            // hundreds of units away while tracer/flash equality still passes.
            for (let i = 0; i < (ud.weaponMuzzles?.length || 0); i++) {
                const p = Game.getWeaponMuzzle(u, i);
                check(`${key}: muzzle lies on the unit`, Math.hypot(p.x - u.x, p.z - u.z) < 4
                    && p.y > (u.y || 0) && p.y < (u.y || 0) + 3);
            }
            for (const yaw of [0, 0.7, -2.1]) {
                u.angle = yaw; u.turretAngle = yaw + (u.hasTurret ? 1.1 : 0);
                u._shotSerial = 0; u.ammo = 50; u.recoilTime = 0;
                const origin = Game.getWeaponMuzzle(u, 0);
                const before = Game.tracers.length;
                Game.applyShot(u, target);
                const trace = Game.tracers[before];
                check(`${key}: shot origin at heading ${yaw}`, trace && !origin.fallback
                    && near(origin, { x: trace.x, y: trace.y0, z: trace.z }));
                if (Game.isTank(u.kind) || Game.GUN_CREWS?.[u.kind]) {
                    const flash = Game.muzzleFlashes.at(-1);
                    check(`${key}: flash follows muzzle at ${yaw}`, flash && near(origin, flash));
                    const direction = new T.Vector3(Math.cos(u.hasTurret ? u.turretAngle : yaw), 0,
                        Math.sin(u.hasTurret ? u.turretAngle : yaw));
                    const indirect = !!ud.mortarTube;
                    const bore = indirect ? new T.Vector3(origin.direction.x, 0, origin.direction.z).normalize() : origin.direction;
                    check(`${key}: bore follows laid bearing ${yaw}`, bore.dot(direction) > 0.999
                        && (!indirect || origin.direction.y > 0.75));
                }
                Game.tracers.length = 0; Game.muzzleFlashes.length = 0;
            }
            if (ud.weaponMuzzles?.length === 2) {
                const a = Game.getWeaponMuzzle(u, 0), b = Game.getWeaponMuzzle(u, 1);
                check(`${key}: twin bores are distinct`, Math.hypot(a.x - b.x, a.z - b.z) > 0.2);
                u._shotSerial = 1;
                Game.applyShot(u, target);
                check(`${key}: second shot uses second bore`, near(b,
                    { x: Game.tracers[0].x, y: Game.tracers[0].y0, z: Game.tracers[0].z }));
                Game.tracers.length = 0;
            }
            if (ud.weaponRecoil) {
                const mount = ud.weaponRecoil, before = Game.getWeaponMuzzle(u, 0);
                mount.node.position.copy(mount.base).addScaledVector(mount.direction, -0.1);
                const after = Game.getWeaponMuzzle(u, 0);
                const displacement = new T.Vector3(after.x - before.x, after.y - before.y, after.z - before.z);
                check(`${key}: recoil moves muzzle backward along bore`, Math.abs(displacement.length() - 0.1) < 1e-4
                    && displacement.normalize().dot(before.direction) < -0.999);
                mount.node.position.copy(mount.base);
            }
            u.angle = u.turretAngle = Math.PI / 2; u.recoilTime = 0; u._shotAge = 100;
        }
        _auditUnits.forEach(u => { u.alive = true; });
        target.alive = false; target.mesh.visible = false;
        return results;
    });
    fs.writeFileSync(`${out}/checks.json`, JSON.stringify(checks, null, 2));
    await page.evaluate(() => {
        const T = Game.THREE;
        const scene = new T.Scene(); scene.background = new T.Color(0x40483f);
        scene.add(new T.HemisphereLight(0xe6efff, 0x80765f, 2.2));
        const sun = new T.DirectionalLight(0xffedcb, 3); sun.position.set(-4, 8, 5); scene.add(sun);
        const camera = new T.OrthographicCamera(-3.5, 3.5, 2.625, -2.625, 0.1, 50);
        camera.position.set(4, 7, 10); camera.lookAt(0, 0.65, 0);
        const plane = new T.Mesh(new T.PlaneGeometry(30, 30), new T.MeshStandardMaterial({ color: 0x69715e, roughness: 1 }));
        plane.rotation.x = -Math.PI / 2; plane.position.y = -0.02; scene.add(plane);
        const canvas = Game.renderer.domElement; document.body.replaceChildren(canvas);
        canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
        const label = document.createElement('div'); label.id = 'audit-label';
        label.style.cssText = 'position:fixed;left:20px;top:20px;color:white;font:18px system-ui'; document.body.append(label);
        Game.renderer.setPixelRatio(1); Game.renderer.setSize(1000, 750);
        window._auditRender = (index, yaw) => {
            _auditUnits.forEach(u => { if (u.mesh.parent === scene) scene.remove(u.mesh); });
            const u = _auditUnits[index], ud = u.mesh.userData;
            scene.add(u.mesh); u.mesh.visible = true; u.mesh.position.set(0, 0, 0); u.mesh.rotation.set(0, 0, 0);
            ud.selectionRing.visible = ud.healthBar.visible = false;
            if (ud.turret) {
                const base = ud.turretBaseRot; ud.turret.rotation.set(base.x, base.y + yaw, base.z);
                for (const m of ud.turretMirrors || []) m.group.rotation.set(m.baseRot.x, m.baseRot.y + yaw, m.baseRot.z);
            }
            for (let i = 0; i < 20; i++) { Game.gameClock += 1 / 30; Game._updateModelAnimation(u, 1 / 30); }
            if (Game.GUN_CREWS?.[u.kind]) Game.updateFieldGunCrew(u, 0.1);
            u.mesh.updateMatrixWorld(true);
            for (const binding of ud.weaponMuzzles || []) {
                if (!binding.anchor.userData.marker) {
                    const dot = new T.Mesh(new T.SphereGeometry(0.035, 10, 6), new T.MeshBasicMaterial({ color: 0xff3333, depthTest: false }));
                    // World-size marker despite native GLB scales.
                    const scale = binding.anchor.getWorldScale(new T.Vector3());
                    dot.scale.set(1 / scale.x, 1 / scale.y, 1 / scale.z);
                    binding.anchor.add(dot); binding.anchor.userData.marker = dot;
                }
            }
            const meshes = [];
            const center = new T.Vector3(), size = new T.Vector3();
            u.mesh.traverse(o => {
                if (!o.isMesh || o.userData.isIndicator) return;
                const b = new T.Box3().setFromObject(o); b.getCenter(center); b.getSize(size);
                meshes.push({ name: o.name, center: center.toArray(), size: size.toArray() });
            });
            document.getElementById('audit-label').textContent = `${u.team} ${u.kind} | turret ${Math.round(yaw * 180 / Math.PI)}° | forward toward camera`;
            Game.renderer.render(scene, camera);
            return { name: `${u.team}_${u.kind}`, path: ud.modelPath || 'procedural',
                turret: ud.turret?.name, gun: ud.gunNode?.name,
                muzzles: (ud.weaponMuzzles || []).map(b => ({ source: b.source.name,
                    position: b.anchor.getWorldPosition(new T.Vector3()).toArray(),
                    direction: b.anchor.getWorldDirection(new T.Vector3()).toArray() })), meshes };
        };
    });
    const report = [];
    for (let i = 0; i < names.length; i++) {
        report.push(await page.evaluate(i => _auditRender(i, 0), i));
        if (!args.includes('--no-images')) await page.screenshot({ path: `${out}/${names[i]}-0.png` });
        await page.evaluate(i => _auditRender(i, Math.PI / 2), i);
        if (!args.includes('--no-images')) await page.screenshot({ path: `${out}/${names[i]}-90.png` });
    }
    fs.writeFileSync(`${out}/models.json`, JSON.stringify(report, null, 2));
    console.log(`Reviewed ${report.length} ground combat configurations: ${out}`);
    const failures = checks.filter(c => !c.pass);
    console.log(`${checks.length - failures.length}/${checks.length} weapon checks passed.`);
    if (failures.length) console.error(JSON.stringify(failures, null, 2));
    if (args.includes('--assert') && failures.length) process.exitCode = 1;
} finally { await browser.close(); }

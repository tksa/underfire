/** Core roster coverage plus articulated equipment/crew lifecycle regressions. */
import { chromium } from 'playwright';
import fs from 'node:fs';
const out = process.argv[2] || 'tmp/model-coverage';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 750 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
    await page.goto(process.env.SMOKE_URL || 'http://localhost:8741', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Game?.units?.length, null, { timeout: 120000 });
    await page.evaluate(() => {
        Game._paused = true; window.requestAnimationFrame = () => 0;
        for (const u of Game.units) u.mesh.removeFromParent();
        Game.units = []; Game.selection.clear();
        const keys = [...new Set([...Object.keys(Game._unitStatsBuiltin), 'polish_7tp', 'polish_7tp_dw', 'polish_7tp_dwr', 'polish_tks20'])];
        window.auditUnits = keys.map((key, i) => {
            const sep = key.indexOf('_');
            const u = Game.makeUnit(key.slice(0, sep), key.slice(sep + 1), 100 + i % 10 * 8, 100 + Math.floor(i / 10) * 8, { aiState: 'player', angle: 0 });
            u.holdFire = true; return u;
        });
    });
    await page.waitForFunction(() => auditUnits.every(u => u.mesh.userData.modelPath
        && (!Game.GUN_CREWS[u.kind] || u.mesh.userData.fieldGunCrew?.userData.crewMode === 'soldier')),
    null, { timeout: 120000, polling: 250 });
    const result = await page.evaluate(() => {
        const T = Game.THREE, checks = [], models = [];
        const check = (name, pass) => checks.push({ name, pass: !!pass });
        for (const u of auditUnits) {
            const ud = u.mesh.userData, key = u.statKey;
            models.push({ key, label: u.label, model: ud.modelPath, crew: ud.fieldGunCrew?.userData.crewMode || null });
            check(`${key}: loaded real model`, !!ud.modelWrapper && !Game._modelLoadFailed?.has(`${u.team}_${u.kind}`));
            if (u.weaponKey === 'none') {
                const cargo = u.supportType === 'supply' ? 30 : 0;
                check(`${key}: cargo without an invented weapon`, u.ammo === cargo && u.maxAmmo === cargo && u.range === 0 && u.damage === 0 && u.suppression === 0);
                const target = { alive: true, statKey: 'french_fusilier', x: u.x, z: u.z + 2 };
                check(`${key}: cannot damage or discharge`, !Game.unitCanHurt(u, target) && !Game.weaponCanDischarge(u));
                const angle = u.angle; u.holdFire = false;
                Game.uMod.fire(u, { dt: .2, enemy: target, isVeh: false });
                check(`${key}: no stationary combat pivot`, u.angle === angle);
                u.holdFire = true;
                if (cargo) {
                    const recipient = auditUnits.find(r => r.team === u.team && r.class === 'infantry' && r.maxAmmo > 0);
                    const saved = { x: recipient.x, z: recipient.z, ammo: recipient.ammo, units: Game.units };
                    recipient.x = u.x + 2; recipient.z = u.z; recipient.ammo = recipient.maxAmmo - 10;
                    u._supportTimer = 0; u._regenTimer = 0;
                    Game.units = [u, recipient];
                    Game.updateSupportUnits(2);
                    check(`${key}: cargo still resupplies infantry`, u.ammo === cargo - 5 && recipient.ammo === recipient.maxAmmo - 5);
                    Object.assign(recipient, { x: saved.x, z: saved.z, ammo: saved.ammo });
                    u.ammo = cargo; Game.units = saved.units;
                }
            }
            if (u.kind === 'medic') check(`${key}: unarmed medical presentation`, ud.soldierModel.userData.infantryWeapon === null);
            else if (u.weaponKey !== 'none' && (Game.isTank(u.kind) || Game.GUN_CREWS[u.kind] || ud.isSoldier)) {
                check(`${key}: actual weapon socket`, ud.weaponMuzzles?.length > 0 || u.ammo === 0);
            }
            if (ud.vehicleRig) {
                const rig = ud.vehicleRig;
                check(`${key}: authored wheels`, rig.wheels.length >= 2);
                const first = rig.wheels.map(w => w.node.rotation.x);
                u.x += 0.1; Game.updateVehicleModel(u, 1 / 30);
                check(`${key}: wheels roll with forward travel`, rig.wheels.every((w, i) => w.node.rotation.x > first[i]));
                u.x -= 0.1; Game.updateVehicleModel(u, 1 / 30);
                check(`${key}: reversing reverses wheels`, rig.wheels.every((w, i) => Math.abs(w.node.rotation.x - first[i]) < 1e-6));
                for (let i = 0; i < 10; i++) Game.updateVehicleModel(u, 1 / 30);
                check(`${key}: blocked wheels stay still`, rig.wheels.every((w, i) => Math.abs(w.node.rotation.x - first[i]) < 1e-6));
                if (rig.steering.length) {
                    u._truckSteer = 0.4; u.angle = 0.04; u.x += 0.1; Game.updateVehicleModel(u, .2);
                    check(`${key}: front wheels steer`, rig.steering.every(n => Math.abs(n.rotation.y) > 0.01));
                    u.angle = 0; u._truckSteer = 0;
                }
                if (rig.trails.length) {
                    const width = () => {
                        const pts = rig.trails.flatMap(n => Game.weaponGeometryPoints(n, u.mesh));
                        return Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x));
                    };
                    u.deployed = true;
                    for (let i = 0; i < 90; i++) Game.updateVehicleModel(u, 1 / 30);
                    const deployed = width(); u._towed = true;
                    for (let i = 0; i < 90; i++) Game.updateVehicleModel(u, 1 / 30);
                    check(`${key}: trails close for towing`, width() < deployed * .8);
                    u._towed = false;
                    u._shotAge = .1; Game.updateVehicleModel(u, .1);
                    const mount = ud.weaponRecoil;
                    check(`${key}: gun recoils`, mount && mount.node.position.distanceTo(mount.base) > .005);
                    u._shotAge = 100; Game.updateVehicleModel(u, 1);
                    check(`${key}: recoil returns to rest`, mount && mount.node.position.distanceTo(mount.base) < 1e-7);
                }
            }
            if (u.kind.startsWith('mortar')) {
                const m = ud.mortar, crew = ud.fieldGunCrew;
                check(`${key}: detailed articulated mortar`, m?.imported && !!m.pivot && !!m.bipod);
                check(`${key}: two skinned operators`, crew.userData.figures.length === 2
                    && crew.userData.figures.every(f => Game.isMowSoldier(f.userData.soldierModel)));
                u._dispSpeed = 0; u._lastShotAt = 0; u._shotAge = .25 + Game.crewLoadDuration(u) * .45;
                Game.updateFieldGunCrew(u, .1);
                check(`${key}: loading round visible`, m.shell.visible);
                const loader = crew.userData.figures.find(f => f.userData.fieldGunRole === 'mortar_loader');
                check(`${key}: authored loading action active`, loader.userData.actions.load?.getEffectiveWeight() > .5);
                check(`${key}: round follows tube axis`, m.shell.position.clone().sub(m.muzzle.position).normalize().dot(m.direction) > .999);
                const rest = m.root.position.y;
                u._dispSpeed = u.currentSpeed = 1.5;
                for (let i = 0; i < 90; i++) Game.updateFieldGunCrew(u, 1 / 30);
                check(`${key}: weapon carried above ground`, m.root.position.y > rest + .35);
                check(`${key}: no loading while moving`, !m.shell.visible);
                check(`${key}: both crew travel`, crew.userData.figures.every(f => f.userData._locoOn));
                const movingBounds = new T.Box3().setFromObject(u.mesh).getSize(new T.Vector3());
                check(`${key}: compact bounds while carrying`, movingBounds.toArray().every(v => Number.isFinite(v) && v < 5));
                u._dispSpeed = u.currentSpeed = 0; u._shotAge = 100;
                for (let i = 0; i < 90; i++) Game.updateFieldGunCrew(u, 1 / 30);
                check(`${key}: weapon settles on ground`, Math.abs(m.root.position.y - rest) < .002);
                u._shotAge = Infinity; Game.updateFieldGunCrew(u, 1 / 30);
                check(`${key}: idle round stays finite`, m.shell.position.toArray().every(Number.isFinite));
                u._unmanned = true; Game.updateFieldGunCrew(u, 0);
                check(`${key}: abandoned crew hides`, !crew.visible);
                u._unmanned = false; Game.updateFieldGunCrew(u, 0);
                check(`${key}: remanned crew visible`, crew.visible);
                u.angle = 1.2; const after = Game.getWeaponMuzzle(u, 0);
                const bearing = new T.Vector3(after.direction.x, 0, after.direction.z).normalize();
                check(`${key}: inclined muzzle follows heading`, bearing.dot(new T.Vector3(Math.cos(1.2), 0, Math.sin(1.2))) > .999 && after.direction.y > .8);
                u.angle = 0;
            }
        }
        return { models, checks };
    });
    fs.writeFileSync(`${out}/coverage.json`, JSON.stringify(result, null, 2));
    console.log(`${result.models.length} core roster configurations loaded; ${result.models.filter(m => m.crew).length} crewed weapons.`);
    const failures = result.checks.filter(c => !c.pass);
    console.log(`${result.checks.length - failures.length}/${result.checks.length} checks passed.`);
    if (failures.length || errors.length) { console.error(JSON.stringify({ failures, errors }, null, 2)); process.exitCode = 1; }
} finally { await browser.close(); }

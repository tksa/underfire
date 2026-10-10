/** Real move orders, carry poses and immediate aim-to-move transitions. */
import { chromium } from 'playwright';
import fs from 'node:fs';

const out = process.argv[2] || 'tmp/infantry-locomotion';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8741', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Game.units?.length > 0);
    await page.evaluate(() => {
        Game._paused = true; window.requestAnimationFrame = () => 0;
        for (const u of Game.units) { u.alive = false; u.mesh.visible = false; }
        Game.units = []; Game.selection.clear(); Game.gameClock = 100;
        Game.setPatch(55, 55, 42, 42, 'grass');
        window.subjects = ['french', 'german', 'polish'].flatMap(team => {
            const kinds = { french: ['fusilier', 'fm24', 'medic'], german: ['grenadier', 'mg34', 'mp38'], polish: ['rifleman', 'rkm_wz28', 'at_rifle_wz35'] }[team];
            return kinds.map(kind => Game.makeUnit(team, kind, 220, 230, { aiState: 'player', angle: 0 }));
        });
    });
    await page.waitForFunction(() => subjects.every(u => u.mesh.userData.isSoldier), null, { timeout: 120000 });
    const result = await page.evaluate(() => {
        const T = Game.THREE, checks = [], frames = [], stills = [];
        const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
        const animate = unit => {
            Game.gameClock += 1 / 30;
            Game.syncWeaponTransform(unit);
            Game._updateModelAnimation(unit, 1 / 30);
        };
        for (const unit of subjects) {
            Game.units = [unit];
            const data = unit.mesh.userData, key = `${unit.team}/${unit.kind}`;
            unit.holdFire = true; unit.stance = 'stand';
            Game.issueCommand(255, 230, 'move', [unit]);
            const travel = [];
            for (let i = 0; i < 240; i++) {
                if (i === 120) Game.issueCommand(unit.x, unit.z + 30, 'move', [unit]);
                Game.updateUnit(unit, 1 / 30); animate(unit);
                travel.push({ speed: unit._dispSpeed, clip: data._activeClip, stance: unit.stance });
            }
            const cruising = travel.slice(30);
            const runFraction = cruising.filter(f => f.clip === 'run').length / cruising.length;
            check(`${key}: ordinary move and turn use a run`, runFraction > 0.95
                && cruising.every(f => f.stance === 'stand'), { runFraction, minSpeed: Math.min(...cruising.map(f => f.speed)) });
            check(`${key}: move order makes ground progress`, Math.hypot(unit.x - 220, unit.z - 230) > 8);
            frames.push({ unit: key, travel });

            // Slow terrain/group pace must carry the weapon too. Exercise all
            // phases of both clips on the loaded skeleton, including turns.
            for (const [clip, speed] of [['walk', 0.9], ['run', 2.1]]) {
                unit._dispSpeed = unit.currentSpeed = speed;
                unit.stance = 'stand'; unit.fireTargetId = 999; unit.holdFire = false;
                for (let i = 0; i < 30; i++) animate(unit);
                let minGripDrop = Infinity, changes = 0, previous = data._activeClip;
                for (let i = 0; i < 90; i++) {
                    unit.angle += 0.07; animate(unit);
                    if (data._activeClip !== previous) changes++;
                    previous = data._activeClip;
                    if (unit.kind !== 'medic') {
                        unit.mesh.updateWorldMatrix(true, true);
                        const head = data.soldierModel.getObjectByName('head').getWorldPosition(new T.Vector3());
                        const grip = data.soldierModel.getObjectByName('right_hand').getWorldPosition(new T.Vector3());
                        minGripDrop = Math.min(minGripDrop, head.y - grip.y);
                    }
                }
                check(`${key}: stable ${clip} through turns`, data._activeClip === clip && changes === 0);
                if (unit.kind !== 'medic') check(`${key}: ${clip} keeps gun below the face`, minGripDrop > Game.SOLDIER_HEIGHT * 0.18, minGripDrop);
            }

            let formationRuns = 0;
            for (let i = 0; i < 90; i++) {
                unit.currentSpeed = unit._dispSpeed = 1.65 + Math.sin(i) * 0.07;
                animate(unit);
                if (data._activeClip === 'run') formationRuns++;
            }
            check(`${key}: formation pace variations keep a steady run`, formationRuns === 90);
            unit._dispSpeed = 0; unit.currentSpeed = 2.1;
            unit.fireTargetId = null; unit.holdFire = true;
            for (let i = 0; i < 3; i++) animate(unit);
            check(`${key}: blocked movement stops the stride`, data.actions[data._activeClip].getEffectiveTimeScale() === 0);
            for (let i = 0; i < 30; i++) animate(unit);
            check(`${key}: a sustained stop returns to idle`, data._activeClip === 'idle');

            unit.stance = 'crouch'; unit.moving = true; unit.path = [{ x: unit.x + 10, z: unit.z }];
            unit.fireTargetId = 999; unit.holdFire = false;
            unit._dispSpeed = unit.currentSpeed = .8;
            for (let i = 0; i < 30; i++) animate(unit);
            let pauseFlips = 0;
            for (let i = 0; i < 90; i++) {
                unit._dispSpeed = unit.currentSpeed = i % 18 < 8 ? 0 : .8;
                animate(unit);
                if (data._activeClip !== 'crouch_walk') pauseFlips++;
            }
            check(`${key}: brief traffic pauses do not alternate aim and crouch-walk`, pauseFlips === 0);

            unit.path = []; unit.moving = false; unit._dispSpeed = unit.currentSpeed = 0;
            unit.stance = 'stand'; unit.fireTargetId = unit.kind === 'medic' ? null : 999;
            unit.holdFire = false;
            for (let i = 0; i < 45; i++) animate(unit);
            if (unit.kind !== 'medic') {
                check(`${key}: halt still allows aimed fire`, data._activeClip === 'aim_stand' && data._weaponPoseBlend > 0.95);
                // Reproduce a target acquired just before a new move order.
                data._clipSince = data._fireSwitchT = Game.gameClock;
                unit.moving = true; unit.path = [{ x: unit.x + 20, z: unit.z }];
                unit.currentSpeed = unit._dispSpeed = 0.4; animate(unit);
                check(`${key}: fresh aim releases on the first moving frame`, data._activeClip === 'walk' && data._weaponPoseBlend === 0);
            }
            for (const [stance, clip, speed] of [['crouch', 'crouch_walk', 1], ['prone', 'crawl', 0.5]]) {
                unit.stance = stance; unit.currentSpeed = unit._dispSpeed = speed;
                for (let i = 0; i < 30; i++) animate(unit);
                check(`${key}: ${stance} orders retain their low gait`, data._activeClip === clip);
            }
            // Full-body output uses the runtime-selected ordinary travel pose.
            unit.stance = 'stand'; unit.currentSpeed = unit._dispSpeed = 2.1;
            unit.fireTargetId = null; unit.holdFire = true;
            for (let i = 0; i < 60; i++) animate(unit);
            stills.push(unit);
        }

        const scene = new T.Scene(); scene.background = new T.Color(0x29303a);
        scene.add(new T.HemisphereLight(0xeef3ff, 0x675846, 2));
        const sun = new T.DirectionalLight(0xffffff, 3); sun.position.set(3, 5, 4); scene.add(sun);
        const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setSize(1200, 900); renderer.setScissorTest(true);
        const camera = new T.PerspectiveCamera(32, 4 / 3, 0.01, 20);
        camera.position.set(1.9, 1.05, 2.6); camera.lookAt(0, 0.65, 0);
        for (let i = 0; i < stills.length; i++) {
            const unit = stills[i], wrapper = unit.mesh.userData.modelWrapper;
            wrapper.rotation.y = 0; scene.add(wrapper); scene.updateMatrixWorld(true);
            renderer.setViewport(i % 3 * 400, (2 - Math.floor(i / 3)) * 300, 400, 300);
            renderer.setScissor(i % 3 * 400, (2 - Math.floor(i / 3)) * 300, 400, 300);
            renderer.render(scene, camera); unit.mesh.add(wrapper);
        }
        return { checks, frames, png: renderer.domElement.toDataURL('image/png') };
    });
    fs.writeFileSync(`${out}/running.png`, Buffer.from(result.png.split(',')[1], 'base64'));
    delete result.png;
    fs.writeFileSync(`${out}/locomotion.json`, JSON.stringify({ ...result, errors }, null, 2));
    const failures = result.checks.filter(c => !c.pass);
    console.log(JSON.stringify({ checks: result.checks.length, failures, errors }, null, 2));
    if (failures.length || errors.length) process.exitCode = 1;
} finally { await browser.close(); }

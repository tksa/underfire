/** Resource ownership and incremental-order regressions; timings live in the profiler. */
import { chromium } from 'playwright';
const browser = await chromium.launch();
const errors = [];
try {
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8741', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Game.units?.length, null, { timeout: 120000 });
    await page.evaluate(() => { Game._paused = true; window.requestAnimationFrame = () => 0; });
    await page.waitForFunction(() => Game.units.every(u => u.mesh.userData.modelPath)
        && Game._neuralBake?.applied, null, { timeout: 120000 });
    const checks = await page.evaluate(() => {
        const checks = [], check = (name, pass) => checks.push({ name, pass: !!pass });
        const bake = Game._neuralBake;
        check('terrain GPU texture is capped while editable source retains full detail',
            bake.tex.image.width <= 4096 && bake.canvas.width === 8192 && bake.tex.image !== bake.canvas);
        const version = bake.tex.version;
        bake.refreshDisplay();
        check('terrain region edits refresh the existing GPU texture', bake.tex.version > version);
        check('all field cover fits one scenario budget', Game._fluffStats.total <= Game._fluffStats.budget);
        check('knockdown records retain valid local instance indices after spatial batching',
            Game.foliageKD.length > 100 && Game.foliageKD.every(k => k.idx >= 0
                && k.idx < k.leaves.count && k.idx < k.branches.count
                && k.leaves.parent && k.branches.parent));
        const soldier = Game.units.find(u => u.mesh.userData.isSoldier && u.team === 'german');
        const data = soldier.mesh.userData, equipment = [], meshes = [], sourceEquipment = [];
        data.soldierModel.traverse(o => { if (o.userData.equipment) equipment.push(o); if (o.isMesh) meshes.push(o); });
        Game.modelCache[data.modelPath].traverse(o => { if (o.userData.equipment) sourceEquipment.push(o); });
        check('soldier retains only its issued weapon and national helmet', equipment.length === 2
            && equipment.some(o => o.name === `equipment_${data.soldierModel.userData.infantryWeapon}`));
        check('cached source keeps equipment for later roles', sourceEquipment.length >= 12);
        check('animated infantry still bypasses stale bind-pose frustum bounds', meshes.every(o => !o.frustumCulled));
        check('issued weapon still has an actual muzzle socket', data.weaponMuzzles.length === 1);

        // Hover must not perform two identical full-scene triangle picks, or any
        // entry pick while attack mode owns the cursor.
        Game.playerTeam = 'german'; Game._commandMode = null;
        Game.selection.clear(); Game.selection.add(soldier.id);
        const pick = Game.unitAtScreen; let picks = 0;
        Game.unitAtScreen = (...args) => { picks++; return pick(...args); };
        Game.orderStance = 'attack'; Game.updateGarrisonUI();
        check('attack cursor does not raycast entry/tow targets every frame', picks === 0);
        Game.orderStance = 'move'; Game.updateGarrisonUI();
        check('entry and tow cursor reuse one unit pick', picks === 1);
        Game.updateGarrisonUI();
        check('stationary hover reuses its short-lived pick', picks === 1);
        Game.unitAtScreen = pick;
        check('Retina and 4K rendering stay within the pixel budget',
            [[1280, 800, 2], [1920, 1080, 2], [3840, 2160, 1]].every(([w, h, d]) =>
                w * h * Game.renderPixelRatio(w, h, d) ** 2 <= Game.RENDER_PIXEL_BUDGET + 1));

        for (const u of Game.units) u.mesh.visible = false;
        Game.units = []; Game.selection.clear(); Game._vehRouteQueue = [];
        Game.setPatch(15, 15, 80, 80, 'grass');
        Game.setPatch(50, 15, 1, 60, 'wall');
        const u = Game.makeUnit('german', 'grenadier', 91.5, 91.5, { aiState: 'player', angle: 0 });
        const goal = { x: 211.5, z: 91.5 };
        let result = null, superseded = 0;
        Game.queueVehiclePath(u, goal.x, goal.z, path => { result = path; superseded++; });
        const job = Game._vehRouteQueue[0];
        Game.runVehicleRouteJob(job, performance.now() - 1);
        check('complex route yields without exposing a partial path', u._routePending && result === null);
        Game.cancelQueuedPath(u);
        Game.processVehicleRouteQueue();
        check('cancelled incremental route cannot deliver a stale order', !u._routePending && superseded === 0);
        Game.queueVehiclePath(u, goal.x, goal.z, path => { result = path; });
        let frames = 0;
        while (Game._vehRouteQueue.length && frames++ < 2000) Game.processVehicleRouteQueue();
        check('paused-frame queue eventually completes the route', result?.length > 0 && !u._routePending);
        let from = { x: u.x, z: u.z };
        const clear = result.every(to => {
            const valid = Game.segmentPassable(u, from.x, from.z, to.x, to.z); from = to; return valid;
        });
        check('incremental smoothed path still goes around a solid wall', clear
            && Math.hypot(result.at(-1).x - goal.x, result.at(-1).z - goal.z) < 1);
        const sync = Game.findPath(u, u.x, u.z, goal.x, goal.z);
        check('sliced search produces the same route as a synchronous search', JSON.stringify(sync) === JSON.stringify(result));
        Game.queueVehiclePath(u, goal.x, goal.z, () => superseded++);
        let replacement = null;
        Game.queueVehiclePath(u, 100.5, 100.5, path => { replacement = path; });
        Game.finishQueuedPath(u);
        check('new destination replaces a pending route without reviving the old one', superseded === 0
            && replacement?.length && !u._routePending && !Game._vehRouteQueue.length);
        Game.queueVehiclePath(u, goal.x, goal.z, () => superseded++);
        u.alive = false; Game.processVehicleRouteQueue();
        check('dead units release pending searches without applying them', !u._routePending && superseded === 0);
        return checks;
    });
    for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}`);
    console.log(JSON.stringify({ checks: checks.length, errors }));
    if (errors.length || checks.some(c => !c.pass)) process.exitCode = 1;
} finally { await browser.close(); }

/** Unload/remanning orders must survive combat AI and advertise real entry. */
import { chromium } from 'playwright';
const browser = await chromium.launch();
const errors = [];
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8741', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Game.units?.length, null, { timeout: 120000 });
    const checks = await page.evaluate(() => {
        Game._paused = true; window.requestAnimationFrame = () => 0;
        for (const u of Game.units) if (u.mesh) u.mesh.visible = false;
        Game.units = []; Game.selection.clear(); Game.playerTeam = 'french';
        Game.setPatch(10, 10, 70, 70, 'grass'); Game.gameClock = 100;
        const checks = [], check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
        const truck = Game.makeUnit('french', 'transport_truck', 81, 81, { aiState: 'player', angle: 0 });
        const gun = Game.makeUnit('french', 'at_47mm', 78, 81, { aiState: 'player', angle: 0 });
        gun._crewAboard = 2; gun._unmanned = false;
        const foot = (x = 70, z = 81) => Game.makeUnit('french', 'fusilier', x, z, { aiState: 'player', angle: 0 });
        const step = (seconds) => {
            for (let i = 0; i < seconds * 30; i++) {
                Game.gameClock += 1 / 30;
                Game.processVehicleRouteQueue?.();
                for (const u of Game.units) if (u.alive) Game.updateUnit(u, 1 / 30);
                Game.updateTowing(1 / 30);
            }
        };
        // A gun's old attack-move must not resume after a transport trip.
        gun._assaultGoal = { x: 115, z: 81 }; gun.orderMode = 'assault';
        Game.towUnit(truck, gun, true);
        const crew = truck._passengers.map(Game.getUnitById);
        check('towing transfers two real crew to the truck', crew.length === 2 && gun._unmanned);
        Game.untowUnit(gun); const parked = { x: gun.x, z: gun.z };
        step(5);
        check('detached crew reman their gun', gun._crewAboard === 2 && crew.every(u => u._absorbed));
        check('unloaded gun holds its new position', Game.dist(parked.x, parked.z, gun.x, gun.z) < .5,
            { distance: Game.dist(parked.x, parked.z, gun.x, gun.z) });
        // Explicit entry replaces an old assault and wakes an at-rest soldier.
        gun._unmanned = true; gun._crewAboard = 0;
        truck.x = 130; truck.z = 130;
        const a = foot(), b = foot(70, 82), extra = foot(69, 82);
        a.stance = 'rest'; a.orderMode = 'assault'; a._assaultGoal = { x: 120, z: 120 };
        a._faceAngle = Math.PI; a._faceUntil = Game.gameClock + 100;
        Game.orderManGun(gun, [a, b], true);
        check('entry replaces previous orders and wakes the soldier', a.orderMode === 'move'
            && !a._assaultGoal && a.stance !== 'rest' && a._faceAngle == null);
        check('already reserved gun cannot accept a second full crew', !Game.orderManGun(gun, [extra], true));
        let coverCalls = 0; const cover = Game.uMod.takeCover;
        Game.uMod.takeCover = (...args) => { coverCalls++; return cover(...args); };
        Game.updateUnit(a, 1 / 30);
        check('remanning route bypasses autonomous cover orders', coverCalls === 0);
        Game.uMod.takeCover = cover;
        step(18);
        check('two ordered soldiers arrive and fully man gun', a._absorbed && b._absorbed && gun._crewAboard === 2);
        check('extra soldier is not consumed', extra.alive && !extra._absorbed);
        // Partly manned guns need the same affordance as empty ones.
        gun._crewAboard = 1; gun._unmanned = false;
        Game.selection.clear(); Game.selection.add(extra.id);
        Game.unitAtScreen = () => gun; Game.buildingAtScreen = () => null; Game.buildingAt = () => null;
        Game._commandMode = null; Game.orderStance = 'move'; Game._garrisonUI.pick = null;
        Game.updateGarrisonUI();
        check('partial crew shows enter cursor', document.getElementById('viewport').classList.contains('cmd-enter'));
        gun._crewAboard = 0; gun._unmanned = true; Game.updateGarrisonUI();
        check('empty gun shows enter cursor', document.getElementById('viewport').classList.contains('cmd-enter'));
        gun._towed = true; Game.updateGarrisonUI();
        check('hitched gun does not advertise remanning', !document.getElementById('viewport').classList.contains('cmd-enter'));
        gun._towed = false;
        Game.orderManGun(gun, [extra], true);
        Game.issueCommand(65, 85, 'move');
        check('new move order cancels remanning', extra._enterGunId == null);
        Game.orderManGun(gun, [extra], true);
        document.getElementById('cmdStop').click();
        check('Stop button cancels remanning', extra._enterGunId == null && !extra.path.length);
        Game.orderManGun(gun, [extra], true);
        Game.orderEnterCarrier(truck);
        check('transport entry replaces gun entry', extra._enterGunId == null && extra._enterCarrierId === truck.id);
        Game.issueCommand(65, 85, 'move');
        Game.orderManGun(gun, [extra], true); gun.alive = false;
        Game.updateGunManning();
        check('destroyed gun releases crew and cancels its route', extra._enterGunId == null && !extra.path.length);
        gun.alive = true;
        const enemy = Game.makeUnit('german', 'grenadier', 100, 100, { aiState: 'hold' });
        check('enemy infantry cannot fill a friendly crew reservation', !Game.orderManGun(gun, [enemy], true));
        enemy.alive = false;
        // Ordinary passengers must not resume old assault targets after unload.
        const rider = foot(130, 130);
        Game.loadUnit(rider, truck); rider.orderMode = 'assault'; rider._assaultGoal = { x: 50, z: 50 };
        Game.unloadCarrier(truck);
        const dropped = { x: rider.x, z: rider.z }; step(5);
        check('passenger unloaded without destination stays nearby', Game.dist(dropped.x, dropped.z, rider.x, rider.z) < 2
            && !rider._assaultGoal);
        return checks;
    });
    console.log(JSON.stringify({ checks, errors }, null, 2));
    process.exitCode = errors.length || checks.some(c => !c.pass) ? 1 : 0;
} finally { await browser.close(); }

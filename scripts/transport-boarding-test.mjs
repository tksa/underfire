import { chromium } from 'playwright';

const mode = process.argv[2] || 'eight';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
await page.goto(process.env.SMOKE_URL || 'http://localhost:8741/');
await page.waitForTimeout(2200);
await page.evaluate(() => document.querySelector('#btnEnterGame')?.click());
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#btnStartMission')?.click());
await page.waitForFunction(() => Game.units?.some(u => u.kind === 'transport'), undefined, { timeout: 60000 });
await page.waitForTimeout(2500);

const result = await page.evaluate((testMode) => {
    Game._paused = true;
    const transports = Game.units.filter(u => u.kind === 'transport');
    const carrier = testMode === 'spawn-second' ? transports[1] : transports[0];
    const allInfantry = Game.units.filter(u => u.team === carrier.team && u.class === 'infantry');
    const byDistance = [...allInfantry].sort((a, b) =>
        Game.distSq(a.x, a.z, carrier.x, carrier.z) - Game.distSq(b.x, b.z, carrier.x, carrier.z));
    const troops = testMode === 'spawn-near' ? byDistance.slice(0, 4)
        : testMode === 'spawn-far' ? byDistance.slice(-4)
            : (testMode === 'ten' || testMode === 'unload-target')
                ? allInfantry.slice(0, 10) : allInfantry.slice(0, 8);
    const atSpawn = ['spawn', 'spawn-second', 'spawn-near', 'spawn-far'].includes(testMode);
    // Controlled modes use a known-open area; spawn modes preserve the mission's
    // real positions, terrain, parked armor and congestion.
    if (!atSpawn) {
        carrier.x = 45; carrier.z = 45; carrier.y = Game.getHeight(45, 45);
        carrier.angle = 0;
    }
    carrier.path = []; carrier.moving = false; carrier.currentSpeed = 0;
    carrier._passengers = []; carrier._boardingQueue = [];
    troops.forEach((u, i) => {
        u._inVehicle = null; u._enterCarrierId = null; u.path = []; u.moving = false;
        if (!atSpawn) {
            u.x = testMode === 'crowded' ? 37 - Math.floor(i / 2) * 0.12 : 37 - Math.floor(i / 2) * 0.8;
            u.z = testMode === 'crowded' ? 44.8 + (i % 2) * 0.18 : 43.8 + (i % 2) * 2.2;
        }
        u.y = Game.getHeight(u.x, u.z);
        u.stance = (testMode === 'rest' || i % 2 === 0) ? 'rest' : 'stand';
        if (u.mesh) u.mesh.visible = true;
    });
    Game.selection.clear();
    const requested = testMode === 'single' || testMode === 'rest' ? troops.slice(0, 1) : troops;
    requested.forEach(u => Game.selection.add(u.id));
    Game.orderEnterCarrier(carrier);

    const dt = 1 / 30;
    let movedTruck = false;
    const stepLimit = atSpawn ? 1800 : 2400; // strict 60 simulated seconds at spawn
    let elapsed = 0;
    for (let step = 0; step < stepLimit; step++) {
        Game.gameClock += dt;
        elapsed += dt;
        if (testMode === 'moving' && !movedTruck && step === 180) {
            carrier.x += 3; carrier.z += 1.5; movedTruck = true;
        }
        requested.forEach(u => { if (u._inVehicle == null) Game.updateUnit(u, dt); });
        Game.updateTowing(dt);
        if ((carrier._passengers || []).length === requested.length) break;
    }
    const firstBoarded = (carrier._passengers || []).length;
    if (testMode === 'reboard' && firstBoarded === requested.length) {
        Game.unloadCarrier(carrier);
        Game.selection.clear(); requested.forEach(u => Game.selection.add(u.id));
        Game.orderEnterCarrier(carrier);
        for (let step = 0; step < 2400; step++) {
            Game.gameClock += dt;
            requested.forEach(u => { if (u._inVehicle == null) Game.updateUnit(u, dt); });
            Game.updateTowing(dt);
            if ((carrier._passengers || []).length === requested.length) break;
        }
    }
    let unloadReached = null;
    if (testMode === 'unload-target' && firstBoarded === requested.length) {
        const target = { x: 55, z: 52 };
        Game.unloadCarrier(carrier, target.x, target.z);
        for (let step = 0; step < 1800; step++) {
            Game.gameClock += dt;
            requested.forEach(u => { if (u._inVehicle == null) Game.updateUnit(u, dt); });
            Game.updateTowing(dt);
            if (requested.every(u => !u.path || !u.path.length)) break;
        }
        unloadReached = requested.filter(u => u._inVehicle == null
            && Game.dist(u.x, u.z, target.x, target.z) < 4).length;
    }
    const rear = Game.transportEntryPoint(carrier);
    Game.selection.clear(); Game.selection.add(carrier.id); Game.updateHUD();
    const unload = document.getElementById('cmdUnload');
    return {
        mode: testMode,
        elapsed: +elapsed.toFixed(2),
        requested: requested.length,
        firstBoarded,
        boarded: (carrier._passengers || []).length,
        unloadVisible: !!unload && getComputedStyle(unload).display !== 'none',
        unloadBadge: document.getElementById('unloadBadge')?.textContent || '',
        unloadReached,
        queue: [...(carrier._boardingQueue || [])],
        troops: requested.map(u => ({
            id: u.id, inVehicle: u._inVehicle, enterCarrier: u._enterCarrierId,
            x: +u.x.toFixed(2), z: +u.z.toFixed(2),
            rearDistance: +Math.hypot(u.x - rear.x, u.z - rear.z).toFixed(2),
            moving: u.moving, speed: +(u.currentSpeed || 0).toFixed(2),
            path: u.path?.length || 0, stance: u.stance,
            waypoint: u.path?.[0] ? { x: +u.path[0].x.toFixed(2), z: +u.path[0].z.toFixed(2) } : null,
            stopTimer: +(u.stopTimer || 0).toFixed(2), orderDelay: +(u.orderDelay || 0).toFixed(2),
            suppression: +(u.suppressionValue || 0).toFixed(1), fatigue: +(u.fatigue || 0).toFixed(1),
            stuckReplans: u._stuckReplans || 0, progressReplans: u._progReplans || 0,
            rerouteFor: u._rerouteFor?.id || null,
        })),
    };
}, mode);

console.log(JSON.stringify(result, null, 2));
await browser.close();
const unloadMode = result.mode === 'unload-target';
if (unloadMode ? result.unloadReached !== result.requested
    : (result.boarded !== result.requested || !result.unloadVisible
        || result.unloadBadge !== String(result.boarded))) process.exit(2);

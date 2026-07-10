import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
await page.goto(process.env.SMOKE_URL || 'http://localhost:8741/');
await page.waitForTimeout(2200);
await page.evaluate(() => document.querySelector('#btnEnterGame')?.click());
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#btnStartMission')?.click());
await page.waitForFunction(() => Game.units?.some(u => u.kind === 'transport'), undefined, { timeout: 60000 });
await page.waitForTimeout(2500);

const results = await page.evaluate(() => {
    Game._paused = true;
    const truck = Game.units.filter(u => u.kind === 'transport')[1];
    const tank = Game.units.find(u => u.kind === 'r35');
    const cases = [
        { name: 'head-on parked R35', start: [11.4, 45], angle: -Math.PI / 2, tank: [11.4, 39], goal: [11.4, 29] },
        { name: 'offset pass left', start: [8.8, 45], angle: -Math.PI / 2, tank: [11.4, 38.5], goal: [14, 29] },
        { name: 'offset pass right', start: [14, 45], angle: -Math.PI / 2, tank: [11.4, 38.5], goal: [8.5, 29] },
        { name: 'short close obstacle', start: [11.4, 44], angle: -Math.PI / 2, tank: [11.4, 39], goal: [17, 34] },
    ];
    const out = [];
    const dt = 1 / 30;
    for (const tc of cases) {
        let parkN = 0;
        for (const o of Game.units) {
            if (o.id === truck.id || o.id === tank.id) continue;
            if (!(Game.isTank(o.kind) || Game.isTruck(o.kind))) continue;
            o.x = 120 + (parkN % 8) * 4;
            o.z = 75 + Math.floor(parkN / 8) * 4;
            o.path = []; o.moving = false; o.currentSpeed = 0;
            parkN++;
        }
        truck.x = tc.start[0]; truck.z = tc.start[1]; truck.angle = tc.angle;
        truck.y = Game.getHeight(truck.x, truck.z);
        truck.path = []; truck.moving = false; truck.currentSpeed = 0;
        truck.stopTimer = 0; truck._detour = null; truck._drvCmd = null;
        truck._stuckT = 0; truck._stuckReplans = 0;
        tank.x = tc.tank[0]; tank.z = tc.tank[1]; tank.path = [];
        tank.moving = false; tank.currentSpeed = 0;
        Game.selection.clear(); Game.selection.add(truck.id);
        Game.issueCommand(tc.goal[0], tc.goal[1], 'move');
        let elapsed = 0, stalled = 0, maxStall = 0, minTankDist = Infinity;
        for (let step = 0; step < 1800; step++) { // 60 simulated seconds
            Game.gameClock += dt; elapsed += dt;
            Game.updateUnit(truck, dt);
            Game.updateTowing(dt);
            const dTank = Game.dist(truck.x, truck.z, tank.x, tank.z);
            minTankDist = Math.min(minTankDist, dTank);
            if (truck.path.length && (truck.currentSpeed || 0) < 0.1) stalled += dt;
            else stalled = 0;
            maxStall = Math.max(maxStall, stalled);
            if (Game.dist(truck.x, truck.z, tc.goal[0], tc.goal[1]) < 3.8) break;
        }
        out.push({
            name: tc.name,
            reached: Game.dist(truck.x, truck.z, tc.goal[0], tc.goal[1]) < 4.1,
            elapsed: +elapsed.toFixed(2),
            remaining: +Game.dist(truck.x, truck.z, tc.goal[0], tc.goal[1]).toFixed(2),
            maxStall: +maxStall.toFixed(2),
            minTankDist: +minTankDist.toFixed(2),
            path: truck.path.length,
            detour: !!truck._detour,
            position: [ +truck.x.toFixed(2), +truck.z.toFixed(2) ],
            angle: +truck.angle.toFixed(3), speed: +(truck.currentSpeed || 0).toFixed(2),
            stopTimer: +(truck.stopTimer || 0).toFixed(2),
            waypoint: truck.path[0] ? [ +truck.path[0].x.toFixed(2), +truck.path[0].z.toFixed(2) ] : null,
            detourFor: truck._detour?.forId || null,
            tile: Game.getTileAtWorld(truck.x, truck.z)?.type || null,
            penetration: +Game._vehPenetration(truck, truck.x, truck.z).toFixed(3),
            solid: Game._bodySolidCount(truck, truck.x, truck.z),
        });
    }
    return out;
});

console.log(JSON.stringify(results, null, 2));
await browser.close();
if (results.some(r => !r.reached || r.maxStall > 5)) process.exit(2);

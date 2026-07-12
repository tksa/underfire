import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
await page.goto(process.env.SMOKE_URL || 'http://localhost:8741/');
await page.waitForTimeout(2200);
await page.evaluate(() => document.querySelector('#btnEnterGame')?.click());
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('#btnStartMission')?.click());
await page.waitForFunction(() => Game.units?.some(u => u.kind === 'transport'), undefined, { timeout: 120000 });
await page.waitForTimeout(2500);

const repeatCount = Math.max(1, Number.parseInt(process.env.WAYPOINT_REPEATS || '1', 10) || 1);
const results = await page.evaluate((repeats) => {
    Game._paused = true;
    const truck = Game.units.find(u => u.kind === 'transport');
    const tank = Game.units.find(u => u.kind === 'r35')
        || Game.units.find(u => u.kind === 'panzer2');
    if (tank.kind !== 'r35') Object.assign(tank, {
        kind: 'r35', statKey: 'french_r35', size: Game.UNIT_STATS.french_r35.size,
        armor: Game.UNIT_STATS.french_r35.armor,
    });
    const troops = Game.units.filter(u => u.team === truck.team && u.class === 'infantry').slice(0, 4);
    Game.units = [truck, tank, ...troops];
    Game.playerTeam = truck.team;
    const dt = 1 / 30;
    const captureRadius = Game.TRUCK_ORDER_STOP_RADIUS || 2.25;

    const resetTruck = (x, z, angle) => {
        if (Game.cancelTruckManeuver) Game.cancelTruckManeuver(truck);
        for (const key of [
            '_detour', '_drvCmd', '_rerouteFor', '_truckRecoveryGoal', '_assaultGoal',
            '_pursueAnchor', '_engageId', '_faceAngle', '_faceGoal', '_moveBlockedGoal',
            '_hullBlockFor', '_truckPreflightPath', '_preflightRiskId',
        ]) truck[key] = null;
        Object.assign(truck, {
            x, z, angle, y: Game.getHeight(x, z),
            path: [], moving: false, currentSpeed: 0,
            stopTimer: 0, orderDelay: 0,
            _reverseMove: false, _reversing: false, _truckSteer: 0,
            _truckPreflightBackups: 0,
            _stuckT: 0, _stuckReplans: 0, _rerouteT: 0,
            _hullBlockT: 0, _crawlT: 0, _settleT: 0, _lastGoalD: null,
            _reverseStallT: 0, _recoveryBlockedUntil: 0,
            _passengers: [], _boardingQueue: [],
        });
    };

    const resetTroops = (x, z) => {
        troops.forEach((u, i) => {
            Object.assign(u, {
                x: x - Math.floor(i / 2) * 0.8,
                z: z + (i % 2 ? 1.0 : -1.0),
                path: [], moving: false, currentSpeed: 0,
                stopTimer: 0, orderDelay: 0, stance: 'stand',
                _inVehicle: null, _enterCarrierId: null,
                _lastMoveOrder: null,
            });
            u.y = Game.getHeight(u.x, u.z);
            if (u.mesh) u.mesh.visible = true;
        });
    };

    const activeOrderIds = () => {
        const route = truck._truckRecoveryGoal?.stops || truck.path || [];
        return route.map(p => p._orderStop?.id ?? p.id).filter(id => id != null);
    };

    const run = ({ name, start, angle, stops, tankPose = null, boarders = false,
        queueDuringRecovery = false, expectPlayerReverse = false }) => {
        resetTruck(start.x, start.z, angle);
        resetTroops(start.x - 8, start.z);
        if (tankPose) {
            tank.x = tankPose.x; tank.z = tankPose.z; tank.angle = tankPose.angle || 0;
        } else {
            tank.x = 130; tank.z = 90; tank.angle = 0;
        }
        tank.path = []; tank.moving = false; tank.currentSpeed = 0;
        Game._dynObs = null; Game._dynVehicles = null;
        Game.selection.clear();

        if (boarders) {
            troops.forEach(u => Game.selection.add(u.id));
            Game.orderEnterCarrier(truck);
            Game.selection.add(truck.id);
        } else {
            Game.selection.add(truck.id);
        }

        const ids = [];
        const issue = (stop, queued) => {
            Game.issueCommand(stop.x, stop.z, 'move', null, queued);
            ids.push(Game._moveOrderSerial);
            truck.orderDelay = 0;
        };
        issue(stops[0], false);

        let sawRecovery = false;
        let recoveryAppendOk = !queueDuringRecovery;
        let recoveryRejectOk = !queueDuringRecovery;
        if (queueDuringRecovery) {
            for (let i = 0; i < 90 && !truck._truckRecoveryGoal; i++) {
                Game.gameClock += dt;
                Game.updateUnit(truck, dt);
                Game.updateTowing(dt);
            }
            sawRecovery = !!truck._truckRecoveryGoal && !!truck._reverseMove;
            if (sawRecovery) {
                // Force the pathfinder's no-route result for one Shift click.
                // The recovery sequence and last accepted order must remain intact.
                const beforeStops = JSON.stringify(truck._truckRecoveryGoal.stops);
                const beforeOrder = truck._lastMoveOrder;
                const beforeTarget = [truck.targetX, truck.targetZ];
                const rejected = { x: 119.25, z: 119.25 };
                const realFindPath = Game.findPath;
                Game.findPath = (unit, sx, sz, ex, ez, startAngle) =>
                    (Math.abs(ex - rejected.x) < 0.01 && Math.abs(ez - rejected.z) < 0.01)
                        ? [] : realFindPath(unit, sx, sz, ex, ez, startAngle);
                Game.issueCommand(rejected.x, rejected.z, 'move', null, true);
                Game.findPath = realFindPath;
                recoveryRejectOk = JSON.stringify(truck._truckRecoveryGoal.stops) === beforeStops
                    && truck._lastMoveOrder === beforeOrder
                    && truck.targetX === beforeTarget[0] && truck.targetZ === beforeTarget[1];
            }
            for (let i = 1; i < stops.length; i++) issue(stops[i], true);
            recoveryAppendOk = sawRecovery
                && truck._truckRecoveryGoal.stops.map(s => s.id).join(',') === ids.join(',');
        } else {
            for (let i = 1; i < stops.length; i++) issue(stops[i], true);
        }

        const initialOrder = activeOrderIds();
        const initialOrderOk = initialOrder.join(',') === ids.join(',');
        const boarderIntentInitially = !boarders || troops.every(u =>
            u._enterCarrierId === truck.id && truck._boardingQueue.includes(u.id)
            && u._lastMoveOrder == null);
        const captured = truck._truckRecoveryGoal
            ? {
                goal: { ...truck._truckRecoveryGoal.goal },
                stops: truck._truckRecoveryGoal.stops.map(stop => ({ ...stop })),
            }
            : Game._captureTruckRecovery(truck);
        const rebuilt = Game._restoreTruckRecovery(truck, captured);
        const rebuildOrder = rebuilt.filter(p => p._orderStop).map(p => p._orderStop.id);
        const rebuildProbeOk = rebuildOrder.join(',') === ids.join(',');
        let stuckReplanProbeOk = true;
        if (name.startsWith('four-shift-corners')) {
            const realSweep = Game._sweepVehicleMotion;
            truck._stuckT = 1.31;
            truck._stuckReplans = 0;
            truck.orderDelay = 0;
            truck.currentSpeed = 0;
            Game._sweepVehicleMotion = (unit, ax, az, aa) => ({
                x: ax, z: az, angle: aa,
                blocked: true, type: 'terrain', hit: null,
            });
            Game.gameClock += dt;
            Game.updateUnit(truck, dt);
            Game._sweepVehicleMotion = realSweep;
            stuckReplanProbeOk = activeOrderIds().join(',') === ids.join(',');
            truck._stuckT = 0;
            truck._stuckReplans = 0;
            truck._crawlT = 0;
            truck.currentSpeed = 0;
        }

        const minDistance = stops.map(() => Infinity);
        const consumeDistance = stops.map(() => null);
        const consumeTime = stops.map(() => null);
        const consumeOrder = [];
        const pathEvents = [];
        const trajectory = [];
        let previousPathSignature = '';
        let previousActive = [...initialOrder];
        let boarderIntentHeld = boarderIntentInitially;
        let recoveryRestored = !queueDuringRecovery;
        let sawPlayerReverse = !!truck._reverseMove;
        let playerReverseReleased = !expectPlayerReverse;
        let stableFrames = 0;
        let elapsed = 0;
        let travel = 0;
        let prevX = truck.x, prevZ = truck.z;
        let previousSpeed = 0;
        let maxFrameSpeedDelta = 0;

        for (let step = 0; step < 3000; step++) {
            Game.gameClock += dt;
            elapsed += dt;
            Game.updateUnit(truck, dt);
            troops.forEach(u => { if (u._inVehicle == null) Game.updateUnit(u, dt); });
            Game.updateTowing(dt);

            travel += Game.dist(prevX, prevZ, truck.x, truck.z);
            prevX = truck.x; prevZ = truck.z;
            const reportedSpeed = Math.abs(truck.currentSpeed || 0);
            maxFrameSpeedDelta = Math.max(
                maxFrameSpeedDelta, Math.abs(reportedSpeed - previousSpeed));
            previousSpeed = reportedSpeed;
            stops.forEach((s, i) => {
                minDistance[i] = Math.min(minDistance[i], Game.dist(truck.x, truck.z, s.x, s.z));
            });
            if (boarders) {
                boarderIntentHeld &&= troops.every(u => u._inVehicle === truck.id
                    || (u._enterCarrierId === truck.id && truck._boardingQueue.includes(u.id)));
            }
            if (truck._truckRecoveryGoal) sawRecovery = true;
            if (sawRecovery && !truck._truckRecoveryGoal && !truck._reverseMove
                && truck.path.some(p => p._orderStop)) recoveryRestored = true;
            if (truck._reverseMove) sawPlayerReverse = true;
            if (expectPlayerReverse && sawPlayerReverse && !truck._reverseMove
                && truck.path.length) playerReverseReleased = true;

            const active = activeOrderIds();
            const pathSignature = `${active.join(',')}|${truck.path.map(p =>
                `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join(';')}|${truck._reverseMove ? 1 : 0}`;
            if (pathSignature !== previousPathSignature) {
                pathEvents.push({
                    t: +elapsed.toFixed(3), x: +truck.x.toFixed(3), z: +truck.z.toFixed(3),
                    angle: +truck.angle.toFixed(3), speed: +(truck.currentSpeed || 0).toFixed(3),
                    reverse: !!truck._reverseMove, active,
                    path: truck.path.slice(0, 6).map(p => [ +p.x.toFixed(2), +p.z.toFixed(2), !!p._orderStop, !!p._queueTurnLead ]),
                });
                previousPathSignature = pathSignature;
            }
            if (expectPlayerReverse && step % 150 === 0) {
                trajectory.push({
                    t: +elapsed.toFixed(1), x: +truck.x.toFixed(2), z: +truck.z.toFixed(2),
                    angle: +truck.angle.toFixed(2), speed: +(truck.currentSpeed || 0).toFixed(2),
                    reverse: !!truck._reverseMove,
                    next: truck.path[0] ? [ +truck.path[0].x.toFixed(2), +truck.path[0].z.toFixed(2) ] : null,
                });
            }
            for (const id of previousActive) {
                if (active.includes(id)) continue;
                const index = ids.indexOf(id);
                if (index >= 0 && consumeDistance[index] == null) {
                    consumeDistance[index] = Game.dist(
                        truck.x, truck.z, stops[index].x, stops[index].z);
                    consumeTime[index] = elapsed;
                    consumeOrder.push(id);
                }
            }
            previousActive = active;

            const settled = !truck.path.length && !truck._truckRecoveryGoal
                && (truck.currentSpeed || 0) <= 0.08;
            const loaded = !boarders || truck._passengers.length === troops.length;
            stableFrames = settled && loaded ? stableFrames + 1 : 0;
            if (stableFrames >= 15) break;
        }

        const final = stops[stops.length - 1];
        const failures = [];
        if (!initialOrderOk) failures.push(`initial order ${initialOrder} != ${ids}`);
        if (!rebuildProbeOk) failures.push(`rebuild order ${rebuildOrder} != ${ids}`);
        if (!recoveryAppendOk) failures.push('Shift stops were not appended to recovery');
        if (!recoveryRejectOk) failures.push('rejected recovery waypoint damaged accepted route');
        if (!recoveryRestored) failures.push('recovery did not restore queued stops');
        if (!stuckReplanProbeOk) failures.push('stuck replan changed Shift stop order');
        if (!boarderIntentInitially || !boarderIntentHeld) failures.push('pending passenger intent was lost');
        if (boarders && truck._passengers.length !== troops.length) failures.push('not all passengers boarded');
        if (expectPlayerReverse && (!sawPlayerReverse || !playerReverseReleased)) {
            failures.push('player reverse did not hand off to forward queued route');
        }
        if (consumeOrder.join(',') !== ids.join(',')) {
            failures.push(`consumed ${consumeOrder} instead of ${ids}`);
        }
        consumeDistance.forEach((d, i) => {
            if (d == null || d > captureRadius + 0.02) {
                failures.push(`stop ${i + 1} consumed at ${d == null ? 'never' : d.toFixed(3)}u`);
            }
        });
        if (stableFrames < 15) failures.push('truck did not settle for 15 frames');
        const remaining = Game.dist(truck.x, truck.z, final.x, final.z);
        if (remaining > 1.65) failures.push(`final remaining ${remaining.toFixed(3)}u`);
        let direct = Game.dist(start.x, start.z, stops[0].x, stops[0].z);
        for (let i = 1; i < stops.length; i++) {
            direct += Game.dist(stops[i - 1].x, stops[i - 1].z, stops[i].x, stops[i].z);
        }
        const travelRatio = travel / direct;
        if (travelRatio > 1.8) failures.push(`travel ratio ${travelRatio.toFixed(3)}`);
        if (elapsed > 45) failures.push(`elapsed ${elapsed.toFixed(3)}s`);
        if (maxFrameSpeedDelta > 0.75) {
            failures.push(`frame speed delta ${maxFrameSpeedDelta.toFixed(3)}`);
        }

        return {
            name,
            pass: failures.length === 0,
            failures,
            elapsed: +elapsed.toFixed(3),
            travel: +travel.toFixed(3),
            travelRatio: +travelRatio.toFixed(3),
            maxFrameSpeedDelta: +maxFrameSpeedDelta.toFixed(3),
            orderIds: ids,
            consumeOrder,
            minDistance: minDistance.map(d => +d.toFixed(3)),
            consumeDistance: consumeDistance.map(d => d == null ? null : +d.toFixed(3)),
            consumeTime: consumeTime.map(t => t == null ? null : +t.toFixed(3)),
            remaining: +remaining.toFixed(3),
            passengers: truck._passengers.length,
            sawRecovery,
            recoveryRestored,
            sawPlayerReverse,
            playerReverseReleased,
            ...(expectPlayerReverse && failures.length ? { pathEvents, trajectory } : {}),
        };
    };

    const scenarios = [
        {
            name: 'four-shift-corners-with-boarders',
            start: { x: 45, z: 45 }, angle: 0, boarders: true,
            stops: [
                { x: 55, z: 45 },
                { x: 55, z: 55 },
                { x: 67, z: 55 },
                { x: 67, z: 45 },
            ],
        },
        {
            name: 'shift-added-during-tank-recovery',
            start: { x: 65.9, z: 87.93 }, angle: 0, boarders: true,
            tankPose: { x: 72, z: 87.93, angle: 0 },
            queueDuringRecovery: true,
            stops: [
                { x: 81.9, z: 87.93 },
                { x: 85.9, z: 94.93 },
                { x: 94, z: 94.93 },
            ],
        },
        {
            name: 'shift-after-player-reverse',
            start: { x: 45, z: 45 }, angle: 0,
            expectPlayerReverse: true,
            stops: [
                { x: 40, z: 45 },
                { x: 50, z: 45 },
                { x: 58, z: 52 },
            ],
        },
    ];
    const out = [];
    for (let repeat = 1; repeat <= repeats; repeat++) {
        scenarios.forEach(spec => out.push(run({
            ...spec,
            name: repeats > 1 ? `${spec.name}#${repeat}` : spec.name,
        })));
    }
    return out;
}, repeatCount);

console.log(JSON.stringify(results, null, 2));
await browser.close();
if (results.some(result => !result.pass)) process.exit(2);

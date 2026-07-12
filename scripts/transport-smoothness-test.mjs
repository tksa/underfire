import { chromium } from 'playwright';

const url = process.env.SMOKE_URL || 'http://localhost:8741/';
const repeats = Math.max(1, Number.parseInt(process.env.SMOOTH_REPEATS || '3', 10));
const caseFilter = process.env.SMOOTH_CASE || '';
const browser = await chromium.launch();

try {
    const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => document.querySelector('#btnEnterGame'), undefined, { timeout: 120000 });
    await page.evaluate(() => document.querySelector('#btnEnterGame')?.click());
    await page.waitForFunction(() => document.querySelector('#btnStartMission'), undefined, { timeout: 120000 });
    await page.evaluate(() => document.querySelector('#btnStartMission')?.click());
    await page.waitForFunction(
        () => Game.units?.some(u => u.kind === 'transport')
            && Game.units?.some(u => u.kind === 'r35' || u.kind === 'panzer2'),
        undefined,
        { timeout: 120000 },
    );

    const results = await page.evaluate(({ runRepeats, wantedCase }) => {
        Game._paused = true;

        // Keep the oracle independent from the production footprint/SAT/sweep
        // helpers. Otherwise the same geometry bug could make both agree.
        const FOOTPRINTS = {
            transport: [3.60, 1.65],
            r35: [3.15, 1.85],
        };
        const DT = 1 / 30;
        const MAX_TIME = 55;
        const ARRIVAL_TOL = 1.65;
        const PEN_EPS = 0.001;
        const SWEEP_STEP = 0.04;
        const LIMITS = {
            frameTravel: 0.22,
            frameYaw: 0.060,
            acceleration: 18,
            jerk: 550,
            angularAcceleration: 6,
            angularJerk: 180,
            lateralSlip: 0.01,
            postArrivalDrift: 0.02,
            postArrivalYaw: 0.01,
            chatterFlips: 1,
            restarts: 1,
            reversals: 1,
            stall: 2.0,
            travelRatio: 1.90,
            totalYawTurns: 1.50,
        };

        const originalUnits = Game.units;
        const sourceTruck = originalUnits.filter(u => u.kind === 'transport')[1]
            || originalUnits.find(u => u.kind === 'transport');
        const sourceTank = originalUnits.find(u => u.kind === 'r35')
            || originalUnits.find(u => u.kind === 'panzer2');
        const truck = { ...sourceTruck, id: 880001, mesh: null, _passengers: [] };

        // The regression is about vehicle/vehicle routing, not a particular
        // generated map. Bounds and the real command, A*, avoidance and driver
        // code remain active; only terrain is made deterministic and open.
        const openTile = {
            type: 'grass', blocked: false, vehicleBlocked: false,
            sightBlock: false, move: 1, cover: 0, concealment: 0,
        };
        Game.getTile = (tx, ty) => (tx >= 0 && ty >= 0 && tx < Game.MAP_COLS && ty < Game.MAP_ROWS
            ? openTile : null);
        Game.getTileAtWorld = (x, z) => (x >= 0 && z >= 0 && x < Game.WORLD_W && z < Game.WORLD_H
            ? openTile : null);
        Game.isBlocked = (tx, ty) => !Game.getTile(tx, ty);
        Game.getHeight = () => 0;
        Game.getVehicleHeight = () => 0;
        Game.getTerrainSlope = () => 0;
        Game.getWeatherSpeedMod = () => 1;

        const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
        const round = (n, places = 3) => Number.isFinite(n) ? +n.toFixed(places) : n;
        const sign = (n, deadband) => n > deadband ? 1 : n < -deadband ? -1 : 0;
        const pose = (u) => ({ x: u.x, z: u.z, a: u.angle || 0, kind: u.kind, id: u.id });
        const dimensions = (p) => {
            const [length, width] = FOOTPRINTS[p.kind];
            return { hl: length * 0.5, hw: width * 0.5 };
        };
        const makeObb = (p) => {
            const { hl, hw } = dimensions(p);
            const c = Math.cos(p.a), s = Math.sin(p.a);
            return { ...p, hl, hw, fx: c, fz: s, rx: -s, rz: c };
        };

        // Independent four-axis oriented-rectangle SAT.
        const sat = (pa, pb) => {
            const a = makeObb(pa), b = makeObb(pb);
            const dx = b.x - a.x, dz = b.z - a.z;
            const axes = [[a.fx, a.fz], [a.rx, a.rz], [b.fx, b.fz], [b.rx, b.rz]];
            let depth = Infinity;
            let separated = false;
            let separation = 0;
            for (const [ax, az] of axes) {
                const ra = a.hl * Math.abs(ax * a.fx + az * a.fz)
                    + a.hw * Math.abs(ax * a.rx + az * a.rz);
                const rb = b.hl * Math.abs(ax * b.fx + az * b.fz)
                    + b.hw * Math.abs(ax * b.rx + az * b.rz);
                const overlap = ra + rb - Math.abs(dx * ax + dz * az);
                if (overlap <= 0) {
                    separated = true;
                    separation = Math.max(separation, -overlap);
                } else {
                    depth = Math.min(depth, overlap);
                }
            }
            return separated
                ? { hit: false, depth: 0, separation }
                : { hit: true, depth, separation: 0 };
        };

        const interpolatePose = (a, b, t) => ({
            x: a.x + (b.x - a.x) * t,
            z: a.z + (b.z - a.z) * t,
            a: a.a + angleDelta(a.a, b.a) * t,
            kind: a.kind,
            id: a.id,
        });

        const sweptSat = (from, to, obstacle) => {
            const { hl, hw } = dimensions(from);
            const cornerRadius = Math.hypot(hl, hw);
            const translation = Math.hypot(to.x - from.x, to.z - from.z);
            const cornerTravel = cornerRadius * Math.abs(angleDelta(from.a, to.a));
            const steps = Math.max(1, Math.ceil(Math.max(translation, cornerTravel) / SWEEP_STEP));
            let maxDepth = 0;
            let minSeparation = Infinity;
            let first = null;
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                const p = interpolatePose(from, to, t);
                const q = sat(p, obstacle);
                if (q.hit && q.depth > maxDepth) {
                    maxDepth = q.depth;
                    first ||= { t, truck: p, tank: obstacle, depth: q.depth };
                }
                if (!q.hit) minSeparation = Math.min(minSeparation, q.separation);
            }
            return { maxDepth, minSeparation, first };
        };

        const localToWorld = (origin, heading, along, lateral) => ({
            x: origin[0] + along * Math.cos(heading) - lateral * Math.sin(heading),
            z: origin[1] + along * Math.sin(heading) + lateral * Math.cos(heading),
        });

        // Every destination is beyond a tank placed directly in the transport's
        // lane. Angle, mirror, sub-tile phase and slight offset variants expose
        // route/steering assumptions that one perfectly aligned fixture misses.
        const caseSpec = (name, heading, options = {}) => ({
            name,
            heading,
            tankYaw: options.tankYaw || 0,
            truckYaw: options.truckYaw || 0,
            tankLateral: options.tankLateral || 0,
            startAlong: options.startAlong ?? -10,
            goalAlong: options.goalAlong ?? 11,
            queueGoalAlong: options.queueGoalAlong ?? null,
            queueGoalLateral: options.queueGoalLateral ?? 0,
            origin: options.origin || [72, 88],
        });
        const cases = [
            caseSpec('tank-ahead-close', 0, { startAlong: -6, goalAlong: 10 }),
            caseSpec('tank-ahead-queued-orders', 0, {
                startAlong: -6, goalAlong: 10,
                queueGoalAlong: 14, queueGoalLateral: 7,
            }),
            caseSpec('tank-ahead-east', 0),
            caseSpec('tank-ahead-west-mirror', Math.PI),
            caseSpec('tank-ahead-north', Math.PI / 2),
            caseSpec('tank-ahead-diagonal', Math.PI * 0.31),
            caseSpec('tank-angled-left', 0, { tankYaw: Math.PI / 7 }),
            caseSpec('tank-angled-right-mirror', Math.PI, { tankYaw: -Math.PI / 7 }),
            caseSpec('truck-start-yaw-left', 0, { truckYaw: Math.PI / 18 }),
            caseSpec('truck-start-yaw-right', 0, { truckYaw: -Math.PI / 18 }),
            caseSpec('tank-small-lateral-offset', Math.PI / 2, { tankLateral: 0.30 }),
        ].filter(tc => !wantedCase || tc.name.includes(wantedCase));

        const resetTruck = (tc, repeatIndex) => {
            // Shift the complete fixture by fractions of a tile on each repeat;
            // this keeps the physical setup identical but exercises different
            // A* grid phases.
            const phase = (repeatIndex - (runRepeats - 1) * 0.5) * 0.11;
            const lateralPhase = ((repeatIndex % 3) - 1) * 0.07;
            const origin = [
                tc.origin[0] + phase * Math.cos(tc.heading) - lateralPhase * Math.sin(tc.heading),
                tc.origin[1] + phase * Math.sin(tc.heading) + lateralPhase * Math.cos(tc.heading),
            ];
            const start = localToWorld(origin, tc.heading, tc.startAlong, 0);
            const tankAt = localToWorld(origin, tc.heading, 0, tc.tankLateral);
            const goal = localToWorld(origin, tc.heading, tc.goalAlong, 0);
            const queueGoal = tc.queueGoalAlong == null ? null
                : localToWorld(origin, tc.heading, tc.queueGoalAlong, tc.queueGoalLateral);

            for (const key of [
                '_detour', '_drvCmd', '_rerouteFor', '_truckRecoveryGoal', '_assaultGoal',
                '_pursueAnchor', '_engageId', '_faceAngle', '_faceGoal', '_moveBlockedGoal',
                '_hullBlockFor',
            ]) truck[key] = null;
            Object.assign(truck, {
                x: start.x, z: start.z, y: 0,
                angle: tc.heading + tc.truckYaw,
                turretAngle: tc.heading + tc.truckYaw,
                path: [], moving: false, currentSpeed: 0,
                stopTimer: 0, orderDelay: 0, orderMode: 'move',
                alive: true, hp: truck.maxHp, fuel: truck.maxFuel ?? truck.fuel,
                _reverseMove: false, _reversing: false,
                _truckSteer: 0,
                _stuckT: 0, _stuckReplans: 0, _rerouteT: 0,
                _hullBlockT: 0, _crawlT: 0, _settleT: 0, _lastGoalD: null,
                _reverseStallT: 0, _recoveryBlockedUntil: 0,
                _groupMoveActive: false, _groupSpeed: null,
                _trackDist: 0, _combatReady: false, _readyTimer: 0,
                forcedTargetId: null, fireTargetId: null,
                retreating: false, _retreatThreat: null,
                tracksDisabled: false, engineDamaged: false, entrenched: false,
            });
            const tank = {
                ...sourceTank,
                id: 880100, kind: 'r35', statKey: 'french_r35', class: 'vehicle',
                supportType: null, team: truck.team, label: 'Smoothness Test R35',
                x: tankAt.x, z: tankAt.z, y: 0,
                angle: tc.heading + tc.tankYaw,
                turretAngle: tc.heading + tc.tankYaw,
                mesh: null, alive: true, hp: sourceTank.maxHp,
                path: [], moving: false, currentSpeed: 0,
                stopTimer: 0, orderDelay: 0, orderMode: 'hold',
                aiState: 'hold', _ai: 'hold',
                _detour: null, _drvCmd: null,
                _reverseMove: false, _reversing: false,
            };
            return { tank, start, goal, queueGoal };
        };

        const traceExcerpt = (frames, indices) => {
            const wanted = new Set();
            for (const index of indices.filter(Number.isFinite)) {
                for (let d = -2; d <= 2; d++) {
                    if (index + d >= 0 && index + d < frames.length) wanted.add(index + d);
                }
            }
            if (!wanted.size) {
                for (let i = Math.max(0, frames.length - 6); i < frames.length; i++) wanted.add(i);
            }
            return [...wanted].sort((a, b) => a - b).slice(0, 16).map(i => frames[i]);
        };

        const runCase = (tc, caseIndex, repeatIndex) => {
            const { tank, start, goal, queueGoal } = resetTruck(tc, repeatIndex);
            const finalGoal = queueGoal || goal;
            Game.units = [truck, tank];
            Game.playerTeam = truck.team;
            Game.selection.clear();
            Game.selection.add(truck.id);
            Game._dynObs = null;
            Game._dynVehicles = null;
            Game._orderMarkers = [];
            Game.trackMarks = [];
            Game.gameClock = 2000 + caseIndex * 100 + repeatIndex;

            const tankPose = pose(tank);
            const initialSat = sat(pose(truck), tankPose);
            const directStart = { ...pose(truck), a: tc.heading };
            const directEnd = { ...directStart, x: goal.x, z: goal.z };
            const directBlocked = sweptSat(directStart, directEnd, tankPose).maxDepth > PEN_EPS;
            Game.issueCommand(goal.x, goal.z, 'move', [truck]);
            if (queueGoal) Game.issueCommand(queueGoal.x, queueGoal.z, 'move', [truck], true);
            truck.orderDelay = 0;
            const initialPathNodes = truck.path.length;
            const initialPath = truck.path.map(p => ({ x: round(p.x), z: round(p.z) }));

            let elapsed = 0;
            let travel = 0;
            let totalYaw = 0;
            let maxFrameTravel = 0;
            let maxFrameYaw = 0;
            let maxAcceleration = 0;
            let maxJerk = 0;
            let maxAngularAcceleration = 0;
            let maxAngularJerk = 0;
            let maxLateralSlip = 0;
            let maxPenetration = 0;
            let minSatSeparation = Infinity;
            let firstCollision = null;
            let maxStall = 0;
            let stall = 0;
            let stableFor = 0;
            let settled = false;
            let arrivalPose = null;
            let postArrivalDrift = 0;
            let postArrivalYaw = 0;
            let starts = 0;
            let movingPhase = false;
            let reversals = 0;
            let wasReversing = false;
            let snapStopsAway = 0;
            let checkpointDistance = Infinity;
            let yawSign = 0;
            let steerSign = 0;
            const yawFlipTimes = [];
            const steerFlipTimes = [];
            let maxYawFlipsWindow = 0;
            let maxSteerFlipsWindow = 0;
            let firstChatterFrame = null;
            let worstAccelFrame = null;
            let worstJerkFrame = null;
            const frames = [];
            const trajectory = [];
            let previous = pose(truck);
            let previousVelocity = { x: 0, z: 0 };
            let previousAcceleration = { x: 0, z: 0 };
            let previousYawRate = 0;
            let previousYawAcceleration = 0;
            let previousReportedSpeed = 0;
            let previousPathSig = '';
            const pathEvents = [];

            const pushFlip = (times, now) => {
                times.push(now);
                while (times.length && now - times[0] > 1.2) times.shift();
                return times.length;
            };

            const maxSteps = Math.ceil(MAX_TIME / DT);
            for (let step = 0; step < maxSteps; step++) {
                Game.gameClock += DT;
                elapsed += DT;
                Game.updateUnit(truck, DT);

                const current = pose(truck);
                const dx = current.x - previous.x;
                const dz = current.z - previous.z;
                const frameTravel = Math.hypot(dx, dz);
                const yawStep = angleDelta(previous.a, current.a);
                const yawRate = yawStep / DT;
                const yawAcceleration = (yawRate - previousYawRate) / DT;
                const yawJerk = (yawAcceleration - previousYawAcceleration) / DT;
                const travelHeading = previous.a + yawStep * 0.5
                    + (truck._reversing ? Math.PI : 0);
                const lateralSlip = Math.abs(-Math.sin(travelHeading) * dx
                    + Math.cos(travelHeading) * dz);
                const velocity = { x: dx / DT, z: dz / DT };
                const acceleration = {
                    x: (velocity.x - previousVelocity.x) / DT,
                    z: (velocity.z - previousVelocity.z) / DT,
                };
                const jerk = {
                    x: (acceleration.x - previousAcceleration.x) / DT,
                    z: (acceleration.z - previousAcceleration.z) / DT,
                };
                const accelerationMagnitude = Math.hypot(acceleration.x, acceleration.z);
                const jerkMagnitude = Math.hypot(jerk.x, jerk.z);

                travel += frameTravel;
                totalYaw += Math.abs(yawStep);
                maxFrameTravel = Math.max(maxFrameTravel, frameTravel);
                maxFrameYaw = Math.max(maxFrameYaw, Math.abs(yawStep));
                maxLateralSlip = Math.max(maxLateralSlip, lateralSlip);
                if (accelerationMagnitude > maxAcceleration) {
                    maxAcceleration = accelerationMagnitude;
                    worstAccelFrame = step;
                }
                if (jerkMagnitude > maxJerk) {
                    maxJerk = jerkMagnitude;
                    worstJerkFrame = step;
                }
                maxAngularAcceleration = Math.max(
                    maxAngularAcceleration, Math.abs(yawAcceleration));
                maxAngularJerk = Math.max(
                    maxAngularJerk, Math.abs(yawJerk));

                const swept = sweptSat(previous, current, tankPose);
                maxPenetration = Math.max(maxPenetration, swept.maxDepth);
                minSatSeparation = Math.min(minSatSeparation, swept.minSeparation);
                if (swept.maxDepth > PEN_EPS && !firstCollision) {
                    firstCollision = { frame: step, time: elapsed, ...swept.first };
                }

                const reportedSpeed = Math.abs(truck.currentSpeed || 0);
                const pathSig = (truck.path || []).map(p => `${round(p.x, 1)},${round(p.z, 1)}`).join('|');
                if (pathSig !== previousPathSig) {
                    pathEvents.push({
                        t: round(elapsed), sig: pathSig,
                        x: round(current.x), z: round(current.z), v: round(truck.currentSpeed || 0, 2),
                        rev: truck._reversing ? 1 : 0,
                        pre: truck._truckRecoveryGoal?.preflight ? 1 : 0,
                    });
                    previousPathSig = pathSig;
                }
                if (!movingPhase && reportedSpeed > 0.30) {
                    movingPhase = true;
                    starts++;
                } else if (movingPhase && reportedSpeed < 0.08) {
                    movingPhase = false;
                }
                if (truck._reversing && !wasReversing) reversals++;
                wasReversing = !!truck._reversing;

                const remaining = Math.hypot(current.x - finalGoal.x, current.z - finalGoal.z);
                checkpointDistance = Math.min(checkpointDistance,
                    Math.hypot(current.x - goal.x, current.z - goal.z));
                if (previousReportedSpeed > 0.65 && reportedSpeed < 0.08 && remaining > ARRIVAL_TOL + 1) {
                    snapStopsAway++;
                }
                if (truck.path.length && frameTravel < 0.004) stall += DT;
                else stall = 0;
                maxStall = Math.max(maxStall, stall);

                const nextYawSign = reportedSpeed > 0.15 ? sign(yawStep / DT, 0.06) : 0;
                if (nextYawSign && yawSign && nextYawSign !== yawSign) {
                    const n = pushFlip(yawFlipTimes, elapsed);
                    maxYawFlipsWindow = Math.max(maxYawFlipsWindow, n);
                    if (n > LIMITS.chatterFlips && firstChatterFrame == null) firstChatterFrame = step;
                }
                if (nextYawSign) yawSign = nextYawSign;
                // Audit the actual rate-limited road-wheel angle, not raw desired
                // bearing error (which may legitimately jump at a waypoint).
                const nextSteerSign = reportedSpeed > 0.15
                    ? sign(truck._truckSteer || 0, 0.035)
                    : 0;
                if (nextSteerSign && steerSign && nextSteerSign !== steerSign) {
                    const n = pushFlip(steerFlipTimes, elapsed);
                    maxSteerFlipsWindow = Math.max(maxSteerFlipsWindow, n);
                    if (n > LIMITS.chatterFlips && firstChatterFrame == null) firstChatterFrame = step;
                }
                if (nextSteerSign) steerSign = nextSteerSign;

                frames.push({
                    i: step, t: round(elapsed), x: round(current.x), z: round(current.z),
                    a: round(current.a), v: round(truck.currentSpeed || 0, 2),
                    ds: round(frameTravel, 4), da: round(yawStep, 4),
                    acc: round(accelerationMagnitude, 1), jerk: round(jerkMagnitude, 1),
                    aacc: round(yawAcceleration, 1), ajerk: round(yawJerk, 1),
                    slip: round(lateralSlip, 4),
                    path: truck.path.length, rev: truck._reversing ? 1 : 0,
                    det: truck._detour ? 1 : 0,
                });
                if (step % 30 === 0) {
                    trajectory.push({
                        t: round(elapsed), x: round(current.x), z: round(current.z),
                        a: round(current.a), v: round(truck.currentSpeed || 0, 2),
                        steer: round(truck._truckSteer || 0),
                        next: truck.path?.[0]
                            ? [round(truck.path[0].x, 1), round(truck.path[0].z, 1)]
                            : null,
                        path: truck.path?.length || 0,
                        rev: truck._reversing ? 1 : 0,
                    });
                }

                const stoppedAtGoal = remaining <= ARRIVAL_TOL
                    && truck.path.length === 0 && reportedSpeed <= 0.08;
                if (arrivalPose) {
                    postArrivalDrift = Math.max(postArrivalDrift,
                        Math.hypot(current.x - arrivalPose.x, current.z - arrivalPose.z));
                    postArrivalYaw = Math.max(postArrivalYaw,
                        Math.abs(angleDelta(arrivalPose.a, current.a)));
                }
                if (stoppedAtGoal) {
                    arrivalPose ||= current;
                    stableFor += DT;
                    if (stableFor >= 0.75) {
                        settled = true;
                        previous = current;
                        break;
                    }
                } else {
                    stableFor = 0;
                }

                previous = current;
                previousVelocity = velocity;
                previousAcceleration = acceleration;
                previousYawRate = yawRate;
                previousYawAcceleration = yawAcceleration;
                previousReportedSpeed = reportedSpeed;
            }

            const remaining = Math.hypot(truck.x - finalGoal.x, truck.z - finalGoal.z);
            const direct = Math.hypot(goal.x - start.x, goal.z - start.z)
                + (queueGoal ? Math.hypot(queueGoal.x - goal.x, queueGoal.z - goal.z) : 0);
            const travelRatio = travel / direct;
            const totalYawTurns = totalYaw / (Math.PI * 2);
            const restarts = Math.max(0, starts - 1);
            const failures = [];
            if (initialSat.hit) failures.push(`invalid fixture overlap ${round(initialSat.depth, 4)}`);
            if (!directBlocked) failures.push('invalid fixture: tank does not block direct corridor');
            if (!initialPathNodes) failures.push('no initial route');
            if (queueGoal && checkpointDistance > 2.0) failures.push(`queued checkpoint skipped by ${round(checkpointDistance)}u`);
            if (maxPenetration > PEN_EPS) failures.push(`swept SAT penetration ${round(maxPenetration, 4)}`);
            if (!settled) failures.push(`did not arrive and settle within ${MAX_TIME}s`);
            if (maxFrameTravel > LIMITS.frameTravel) failures.push(`frame travel ${round(maxFrameTravel, 4)} > ${LIMITS.frameTravel}`);
            if (maxFrameYaw > LIMITS.frameYaw) failures.push(`frame yaw ${round(maxFrameYaw, 4)} > ${LIMITS.frameYaw}`);
            if (maxAcceleration > LIMITS.acceleration) failures.push(`acceleration ${round(maxAcceleration, 1)} > ${LIMITS.acceleration}`);
            if (maxJerk > LIMITS.jerk) failures.push(`jerk ${round(maxJerk, 1)} > ${LIMITS.jerk}`);
            if (maxAngularAcceleration > LIMITS.angularAcceleration) failures.push(`angular acceleration ${round(maxAngularAcceleration, 1)} > ${LIMITS.angularAcceleration}`);
            if (maxAngularJerk > LIMITS.angularJerk) failures.push(`angular jerk ${round(maxAngularJerk, 1)} > ${LIMITS.angularJerk}`);
            if (maxLateralSlip > LIMITS.lateralSlip) failures.push(`lateral slip ${round(maxLateralSlip, 4)} > ${LIMITS.lateralSlip}`);
            if (postArrivalDrift > LIMITS.postArrivalDrift) failures.push(`post-arrival drift ${round(postArrivalDrift, 4)} > ${LIMITS.postArrivalDrift}`);
            if (postArrivalYaw > LIMITS.postArrivalYaw) failures.push(`post-arrival yaw ${round(postArrivalYaw, 4)} > ${LIMITS.postArrivalYaw}`);
            if (maxYawFlipsWindow > LIMITS.chatterFlips) failures.push(`yaw chatter ${maxYawFlipsWindow} flips/1.2s`);
            if (maxSteerFlipsWindow > LIMITS.chatterFlips) failures.push(`steer chatter ${maxSteerFlipsWindow} flips/1.2s`);
            if (restarts > LIMITS.restarts) failures.push(`stop-start cycles ${restarts} > ${LIMITS.restarts}`);
            if (reversals > LIMITS.reversals) failures.push(`reverse starts ${reversals} > ${LIMITS.reversals}`);
            if (snapStopsAway) failures.push(`${snapStopsAway} abrupt stop(s) away from goal`);
            if (maxStall > LIMITS.stall) failures.push(`stall ${round(maxStall)}s > ${LIMITS.stall}s`);
            if (travelRatio > LIMITS.travelRatio) failures.push(`travel ratio ${round(travelRatio, 2)} > ${LIMITS.travelRatio}`);
            if (totalYawTurns > LIMITS.totalYawTurns) failures.push(`total yaw ${round(totalYawTurns, 2)} turns > ${LIMITS.totalYawTurns}`);

            const eventIndices = [
                firstCollision?.frame,
                firstChatterFrame,
                worstAccelFrame,
                worstJerkFrame,
                frames.length - 1,
            ];
            return {
                name: `${tc.name}#${repeatIndex + 1}`,
                pass: failures.length === 0,
                elapsed: round(elapsed), remaining: round(remaining), settled,
                travel: round(travel), ratio: round(travelRatio, 2),
                yawTurns: round(totalYawTurns, 2),
                maxFrameTravel: round(maxFrameTravel, 4),
                maxFrameYawDeg: round(maxFrameYaw * 180 / Math.PI, 2),
                maxAcceleration: round(maxAcceleration, 1), maxJerk: round(maxJerk, 1),
                maxAngularAcceleration: round(maxAngularAcceleration, 1),
                maxAngularJerk: round(maxAngularJerk, 1),
                maxLateralSlip: round(maxLateralSlip, 4),
                postArrivalDrift: round(postArrivalDrift, 4),
                postArrivalYaw: round(postArrivalYaw, 4),
                maxPenetration: round(maxPenetration, 5),
                directBlocked,
                minSatSeparation: Number.isFinite(minSatSeparation) ? round(minSatSeparation) : null,
                maxYawFlipsWindow, maxSteerFlipsWindow,
                restarts, reversals, snapStopsAway, maxStall: round(maxStall),
                initialPathNodes, framesCaptured: frames.length,
                checkpointDistance: round(checkpointDistance),
                initialPath,
                pathEvents,
                trajectory,
                failures,
                failureTrace: failures.length ? traceExcerpt(frames, eventIndices) : null,
                firstCollision: firstCollision ? {
                    time: round(firstCollision.time), depth: round(firstCollision.depth, 5),
                    truck: {
                        x: round(firstCollision.truck.x), z: round(firstCollision.truck.z),
                        a: round(firstCollision.truck.a),
                    },
                } : null,
            };
        };

        const output = [];
        for (let repeatIndex = 0; repeatIndex < runRepeats; repeatIndex++) {
            for (let caseIndex = 0; caseIndex < cases.length; caseIndex++) {
                output.push(runCase(cases[caseIndex], caseIndex, repeatIndex));
            }
        }
        return { limits: LIMITS, results: output };
    }, { runRepeats: repeats, wantedCase: caseFilter });

    const compact = results.results.map(r => ({
        name: r.name, pass: r.pass, elapsed: r.elapsed, remaining: r.remaining,
        ratio: r.ratio, yawTurns: r.yawTurns,
        frameMove: r.maxFrameTravel, frameYawDeg: r.maxFrameYawDeg,
        accel: r.maxAcceleration, jerk: r.maxJerk,
        angularAccel: r.maxAngularAcceleration, angularJerk: r.maxAngularJerk,
        lateralSlip: r.maxLateralSlip,
        arrivalDrift: r.postArrivalDrift, arrivalYaw: r.postArrivalYaw,
        penetration: r.maxPenetration,
        yawFlips: r.maxYawFlipsWindow, steerFlips: r.maxSteerFlipsWindow,
        restarts: r.restarts, reversals: r.reversals, maxStall: r.maxStall,
        checkpoint: r.checkpointDistance,
    }));
    console.log(JSON.stringify({ limits: results.limits, runs: compact }, null, 2));

    const failed = results.results.filter(r => !r.pass);
    if (!results.results.length) {
        console.error('\nFAIL: no smoothness scenarios matched');
        process.exitCode = 2;
    } else if (failed.length) {
        console.error(`\nFAIL: ${failed.length}/${results.results.length} transport smoothness runs`);
        const traceLimit = Math.max(1, Number.parseInt(process.env.SMOOTH_TRACE_LIMIT || '5', 10));
        for (const result of failed.slice(0, traceLimit)) {
            console.error(JSON.stringify({
                name: result.name,
                failures: result.failures,
                initialPath: result.initialPath,
                pathEvents: result.pathEvents,
                trajectory: result.trajectory,
                firstCollision: result.firstCollision,
                trace: result.failureTrace,
            }));
        }
        if (failed.length > traceLimit) {
            console.error(`... ${failed.length - traceLimit} additional failure trace(s) omitted; set SMOOTH_TRACE_LIMIT to show more`);
        }
        process.exitCode = 2;
    } else {
        console.log(`\nPASS: ${results.results.length} tank-ahead transport smoothness runs`);
    }
} finally {
    await browser.close();
}

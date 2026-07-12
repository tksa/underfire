import { chromium } from 'playwright';

const url = process.env.SMOKE_URL || 'http://localhost:8741/';
const repeats = Math.max(1, Number.parseInt(process.env.CLEARANCE_REPEATS || '1', 10));
const caseFilter = process.env.CLEARANCE_CASE || '';
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

    const results = await page.evaluate(({ repeats: runRepeats, wantedCase }) => {
        Game._paused = true;

        // This table is deliberately independent of Game.VEHICLE_FOOTPRINTS and
        // the production collision helpers. A shared implementation error must
        // not make the test and the game agree on an invalid pose.
        const FOOTPRINTS = {
            transport: [3.60, 1.65],
            supply: [3.60, 1.65],
            fuel: [3.50, 1.65],
            h35: [3.15, 1.85],
            r35: [3.15, 1.85],
            s35: [3.80, 2.05],
            b1: [5.00, 2.45],
            panhard: [3.45, 1.70],
            panzer1: [3.10, 1.80],
            panzer2: [3.35, 1.90],
            panzer3: [4.15, 2.20],
            panzer4: [4.40, 2.30],
            sdkfz: [3.50, 1.75],
            trailer: [1.342, 1.440],
        };
        const DT = 1 / 30;
        const PEN_EPS = 0.001;
        const SWEEP_STEP = 0.05;
        const ARRIVAL_TOL = 1.65;
        const originalUnits = Game.units;
        const sourceTruck = originalUnits.filter(u => u.kind === 'transport')[1]
            || originalUnits.find(u => u.kind === 'transport');
        const sourceR35 = originalUnits.find(u => u.kind === 'r35')
            || originalUnits.find(u => u.kind === 'panzer2');
        const sourceAT = originalUnits.find(u => u.deployable && u.kind !== 'hmg');

        const openTile = {
            type: 'grass', blocked: false, vehicleBlocked: false, sightBlock: false,
            move: 1, cover: 0, concealment: 0,
        };
        // Vehicle-obstacle regressions should not depend on a random field or
        // weather roll. Bounds and the real A*/movement modules remain active.
        Game.getTile = (tx, ty) => (tx >= 0 && ty >= 0 && tx < Game.MAP_COLS && ty < Game.MAP_ROWS
            ? openTile : null);
        Game.getTileAtWorld = (x, z) => (x >= 0 && z >= 0 && x < Game.WORLD_W && z < Game.WORLD_H
            ? openTile : null);
        Game.isBlocked = (tx, ty) => !Game.getTile(tx, ty) || Game.getTile(tx, ty).blocked;
        Game.getHeight = () => 0;
        Game.getVehicleHeight = () => 0;
        Game.getTerrainSlope = () => 0;
        Game.getWeatherSpeedMod = () => 1;

        const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
        const round = (n, p = 3) => Number.isFinite(n) ? +n.toFixed(p) : n;
        const pose = (u) => ({ x: u.x, z: u.z, a: u.angle || 0, kind: u.kind, id: u.id });
        const dims = (p) => {
            const fp = FOOTPRINTS[p.kind];
            if (fp) return { hl: fp[0] * 0.5, hw: fp[1] * 0.5 };
            const size = p.size || 1;
            return { hl: size * 1.5, hw: size };
        };
        const obb = (p) => {
            const { hl, hw } = dims(p);
            const c = Math.cos(p.a || 0), s = Math.sin(p.a || 0);
            return { ...p, hl, hw, fx: c, fz: s, rx: -s, rz: c };
        };

        // Independent four-axis OBB SAT. `depth` is the minimum translation
        // needed to separate overlapping rectangles; `gap` is a separating-axis
        // clearance when they do not overlap.
        const sat = (pa, pb) => {
            const a = obb(pa), b = obb(pb);
            const dx = b.x - a.x, dz = b.z - a.z;
            const axes = [[a.fx, a.fz], [a.rx, a.rz], [b.fx, b.fz], [b.rx, b.rz]];
            let depth = Infinity, gap = 0, axis = [0, 0], separated = false;
            for (const [ax, az] of axes) {
                const ra = a.hl * Math.abs(ax * a.fx + az * a.fz)
                    + a.hw * Math.abs(ax * a.rx + az * a.rz);
                const rb = b.hl * Math.abs(ax * b.fx + az * b.fz)
                    + b.hw * Math.abs(ax * b.rx + az * b.rz);
                const overlap = ra + rb - Math.abs(dx * ax + dz * az);
                if (overlap <= 0) {
                    separated = true;
                    gap = Math.max(gap, -overlap);
                } else if (overlap < depth) {
                    depth = overlap;
                    axis = [ax, az];
                }
            }
            return separated ? { hit: false, depth: 0, gap } : { hit: true, depth, gap: 0, axis };
        };

        const lerpPose = (a, b, t) => ({
            x: a.x + (b.x - a.x) * t,
            z: a.z + (b.z - a.z) * t,
            a: a.a + angleDelta(a.a, b.a) * t,
            kind: a.kind,
            id: a.id,
        });

        const trailerPose = (truckPose) => ({
            x: truckPose.x - Math.cos(truckPose.a) * 2.371,
            z: truckPose.z - Math.sin(truckPose.a) * 2.371,
            a: truckPose.a, kind: 'trailer', id: `${truckPose.id}-trailer`,
        });
        const rigidPoses = (truckPose, towed) => towed
            ? [truckPose, trailerPose(truckPose)]
            : [truckPose];

        const sweptPairs = (prevTruck, nextTruck, prevObstacles, nextObstacles, towed = false) => {
            const cornerR = towed ? 3.13 : Math.hypot(dims(prevTruck).hl, dims(prevTruck).hw);
            const translation = Math.hypot(nextTruck.x - prevTruck.x, nextTruck.z - prevTruck.z);
            const rotationTravel = cornerR * Math.abs(angleDelta(prevTruck.a, nextTruck.a));
            const steps = Math.max(1, Math.ceil(Math.max(translation, rotationTravel) / SWEEP_STEP));
            let worst = { depth: 0, gap: Infinity, hit: null, t: 0 };
            for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                const tp = lerpPose(prevTruck, nextTruck, t);
                const bodies = rigidPoses(tp, towed);
                for (let j = 0; j < nextObstacles.length; j++) {
                    const op = lerpPose(prevObstacles[j], nextObstacles[j], t);
                    for (const body of bodies) {
                        const q = sat(body, op);
                        if (q.hit && q.depth > worst.depth) worst = { ...q, hit: op, truck: body, t };
                        if (!q.hit) worst.gap = Math.min(worst.gap, q.gap);
                    }
                }
            }
            return worst;
        };

        const auditPlannedPath = (truck, obstacles, towed = false) => {
            let from = pose(truck);
            let worst = null;
            for (let leg = 0; leg < truck.path.length; leg++) {
                const wp = truck.path[leg];
                const dx = wp.x - from.x, dz = wp.z - from.z;
                const length = Math.hypot(dx, dz);
                if (length < 1e-6) continue;
                const a = Math.atan2(dz, dx);
                const steps = Math.max(1, Math.ceil(length / 0.1));
                for (let i = 1; i <= steps; i++) {
                    const t = i / steps;
                    const p = {
                        x: from.x + dx * t, z: from.z + dz * t, a,
                        kind: truck.kind, id: truck.id,
                    };
                    for (const body of rigidPoses(p, towed)) {
                        for (const o of obstacles) {
                            const q = sat(body, pose(o));
                            if (q.hit && (!worst || q.depth > worst.depth)) {
                                worst = { depth: q.depth, leg, t, truck: body, hit: pose(o) };
                            }
                        }
                    }
                }
                from = { x: wp.x, z: wp.z, a, kind: truck.kind, id: truck.id };
            }
            return worst;
        };

        const transformCircles = (name, origin, turn, mirror = false) => {
            const tx = (x, z) => {
                const mx = mirror ? -x : x;
                return [origin[0] + mx * Math.cos(turn) - z * Math.sin(turn),
                    origin[1] + mx * Math.sin(turn) + z * Math.cos(turn)];
            };
            const heading = (a) => (mirror ? Math.PI - a : a) + turn;
            return {
                name,
                start: [...tx(0, 0), heading(-Math.PI / 2)],
                goal: tx(15.219, -3.908),
                obstacles: [{ ...Object.fromEntries([['x', tx(0, -6)[0]], ['z', tx(0, -6)[1]]]), a: heading(0.064) }],
                maxTime: 65,
                maxRatio: 2.2,
            };
        };

        const wallGate = (name, gap, expectCentral) => {
            const centerX = 60, centerZ = 169.5;
            const inner = 0.925 + gap * 0.5;
            const obstacles = [];
            for (const side of [-1, 1]) {
                for (let i = 0; i < 7; i++) {
                    obstacles.push({ x: centerX, z: centerZ + side * (inner + i * 1.8), a: 0 });
                }
            }
            return {
                name,
                start: [39, centerZ, 0], goal: [81, centerZ], obstacles,
                maxTime: 90, maxRatio: expectCentral ? 1.55 : 2.2,
                gate: { x: centerX, z: centerZ, halfGap: gap * 0.5, expectCentral },
            };
        };

        const scenarios = [
            {
                name: 'head-on-parked-r35',
                start: [11.4, 45, -Math.PI / 2], goal: [11.4, 29],
                obstacles: [{ x: 11.4, z: 39, a: 0 }],
                maxTime: 65, maxRatio: 2.2,
            },
            {
                name: 'circles-exact',
                start: [11.4, 45, -Math.PI / 2], goal: [26.619, 41.092],
                obstacles: [{ x: 11.4, z: 39, a: 0.064 }],
                maxTime: 65, maxRatio: 2.2,
            },
            transformCircles('circles-mirrored', [50, 65], 0, true),
            transformCircles('circles-rotated-45', [105, 60], Math.PI / 4),
            transformCircles('circles-rotated-90', [75, 75], Math.PI / 2),
            {
                name: 'corner-graze-left',
                start: [42, 105, 0], goal: [72, 105],
                obstacles: [{ x: 56, z: 106.55, a: Math.PI / 4 }],
                maxTime: 60, maxRatio: 2.0,
            },
            {
                name: 'corner-graze-right',
                start: [42, 105, 0], goal: [72, 105],
                obstacles: [{ x: 56, z: 103.45, a: -Math.PI / 4 }],
                maxTime: 60, maxRatio: 2.0,
            },
            {
                name: 'towed-gun-corner-clearance',
                start: [42, 145, 0], goal: [72, 145],
                obstacles: [{ x: 56, z: 144.5, a: -Math.PI / 4 }],
                maxTime: 70, maxRatio: 2.2, towed: true,
            },
            {
                name: 'three-tank-slalom',
                start: [39, 130.5, 0], goal: [81, 130.5],
                obstacles: [
                    { x: 51, z: 128.8, a: Math.PI / 4 },
                    { x: 62, z: 132.2, a: -Math.PI / 4 },
                    { x: 72, z: 128.8, a: Math.PI / 4 },
                ],
                maxTime: 85, maxRatio: 2.25,
            },
            wallGate('gate-feasible-full-width', 2.70, true),
            wallGate('gate-too-narrow-route-around', 1.40, false),
        ].filter(tc => !wantedCase || tc.name.includes(wantedCase));

        const resetTruck = (truck, tc) => {
            const fields = [
                '_detour', '_drvCmd', '_rerouteFor', '_truckRecoveryGoal', '_assaultGoal',
                '_pursueAnchor', '_engageId', '_inFiringPos', '_faceAngle', '_faceGoal',
                '_towedUnitId',
            ];
            for (const key of fields) truck[key] = null;
            Object.assign(truck, {
                x: tc.start[0], z: tc.start[1], y: 0,
                angle: tc.start[2], turretAngle: tc.start[2],
                path: [], moving: false, currentSpeed: 0,
                stopTimer: 0, orderDelay: 0, orderMode: 'move',
                alive: true, hp: truck.maxHp,
                _reverseMove: false, _reversing: false,
                _truckSteer: 0,
                _truckPreflightPath: null, _truckPreflightBackups: 0,
                _preflightRiskId: null, _truckRecoveryGoal: null,
                _stuckT: 0, _stuckReplans: 0, _rerouteT: 0,
                _hullBlockT: 0, _crawlT: 0, _settleT: 0, _lastGoalD: null,
                _hullBlockFor: null, _reverseStallT: 0, _recoveryBlockedUntil: 0,
                _groupMoveActive: false, _groupSpeed: null,
                _trackDist: 0, _combatReady: false, _readyTimer: 0,
                forcedTargetId: null, fireTargetId: null,
                retreating: false, _retreatThreat: null,
                tracksDisabled: false, engineDamaged: false, entrenched: false,
            });
        };

        const makeObstacle = (spec, index, run) => ({
            ...sourceR35,
            id: 900000 + run * 100 + index,
            kind: 'r35', statKey: 'french_r35', class: 'vehicle', supportType: null,
            team: sourceTruck.team, label: `Test R35 ${index + 1}`,
            x: spec.x, z: spec.z, y: 0, angle: spec.a || 0, turretAngle: spec.a || 0,
            mesh: null, alive: true, hp: sourceR35.maxHp, path: [], moving: false,
            currentSpeed: 0, stopTimer: 0, orderDelay: 0, orderMode: 'hold',
            aiState: 'hold', _ai: 'hold', _detour: null, _drvCmd: null,
            _reverseMove: false, _reversing: false,
        });

        const makeTrailer = (tower, run) => ({
            ...sourceAT,
            id: 910000 + run,
            mesh: null, alive: true, path: [], moving: false, currentSpeed: 0,
            x: tower.x - Math.cos(tower.angle) * 2,
            z: tower.z - Math.sin(tower.angle) * 2,
            angle: tower.angle, turretAngle: tower.angle,
            _towed: true, _towedBy: tower.id, deployed: false,
        });

        const runCase = (tc, scenarioIndex, repeatIndex) => {
            const truck = sourceTruck;
            resetTruck(truck, tc);
            const obstacles = tc.obstacles.map((s, i) => makeObstacle(s, i, scenarioIndex * runRepeats + repeatIndex));
            const trailer = tc.towed ? makeTrailer(truck, scenarioIndex * runRepeats + repeatIndex) : null;
            if (trailer) truck._towedUnitId = trailer.id;
            Game.units = trailer ? [truck, trailer, ...obstacles] : [truck, ...obstacles];
            Game.playerTeam = truck.team;
            Game.selection.clear();
            Game.selection.add(truck.id);
            Game._dynObs = null;
            Game._dynVehicles = null;
            Game._orderMarkers = [];
            Game.trackMarks = [];
            Game.gameClock = 1000 + scenarioIndex * 100 + repeatIndex;

            let initialCollision = null;
            for (const o of obstacles) {
                for (const body of rigidPoses(pose(truck), !!trailer)) {
                    const q = sat(body, pose(o));
                    if (q.hit) { initialCollision = { depth: q.depth, hit: pose(o) }; break; }
                }
                if (initialCollision) break;
            }

            // Independent geometry probe: at the end pose the truck body is clear
            // but the limbered gun overlaps the tank. Both the live pose query and
            // full-width segment validator must therefore reject it. This fails if
            // any future refactor silently drops the second OBB.
            let trailerProbeOk = true;
            if (trailer) {
                const liveUnits = Game.units;
                const probeTower = { ...truck, id: 920001, x: 50, z: 50, angle: 0 };
                const probeGun = { ...trailer, id: 920002, _towedBy: probeTower.id };
                probeTower._towedUnitId = probeGun.id;
                const probeTank = { ...obstacles[0], id: 920003, x: 44.8, z: 50, angle: 0 };
                Game.units = [probeTower, probeGun, probeTank];
                const endPose = { x: 49.4, z: 50, a: 0, kind: 'transport', id: probeTower.id };
                const tankPose = pose(probeTank);
                const primaryClear = !sat(endPose, tankPose).hit;
                const trailerHits = sat(trailerPose(endPose), tankPose).hit;
                const productionHits = Game._vehiclePosePenetration(
                    probeTower, endPose.x, endPose.z, 0, 0.02, false).depth > PEN_EPS;
                const segmentRejects = !Game.segmentPassable(
                    probeTower, 50, 50, endPose.x, endPose.z, {
                        startAngle: 0, endAngle: 0, margin: 0.02,
                    });
                trailerProbeOk = primaryClear && trailerHits && productionHits && segmentRejects;
                Game.units = liveUnits;
            }

            Game.issueCommand(tc.goal[0], tc.goal[1], 'move', [truck]);
            truck.orderDelay = 0;
            const plannedCollision = auditPlannedPath(truck, obstacles, !!trailer);
            const initialPathN = truck.path.length;
            const initialPath = truck.path.map(p => ({ x: round(p.x), z: round(p.z) }));

            let elapsed = 0;
            let travel = 0;
            let totalTurn = 0;
            let reverseDistance = 0;
            let maxPenetration = 0;
            let minClearance = Infinity;
            let firstCollision = null;
            let stall = 0;
            let maxStall = 0;
            let detours = 0;
            let reversals = 0;
            let wasDetouring = false;
            let wasReversing = false;
            let stableFor = 0;
            let settled = false;
            let settlePose = null;
            let postArrivalDrift = 0;
            let postArrivalTurn = 0;
            let minRemaining = Infinity;
            let closestPose = null;
            let gateCentralCross = false;
            const trace = [];
            const trajectory = [];
            const pathEvents = [];
            let previousPathSig = '';
            let prevTruck = pose(truck);
            let prevObstacles = obstacles.map(pose);
            const maxSteps = Math.ceil(tc.maxTime / DT);

            for (let step = 0; step < maxSteps; step++) {
                Game.gameClock += DT;
                elapsed += DT;
                Game.updateUnit(truck, DT);
                if (trailer) Game.updateTowing(DT);

                const nextTruck = pose(truck);
                const nextObstacles = obstacles.map(pose);
                const moved = Math.hypot(nextTruck.x - prevTruck.x, nextTruck.z - prevTruck.z);
                const turned = Math.abs(angleDelta(prevTruck.a, nextTruck.a));
                travel += moved;
                totalTurn += turned;
                if (truck._reversing) reverseDistance += moved;

                const swept = sweptPairs(prevTruck, nextTruck, prevObstacles, nextObstacles, !!trailer);
                if (swept.depth > maxPenetration) maxPenetration = swept.depth;
                if (Number.isFinite(swept.gap)) minClearance = Math.min(minClearance, swept.gap);
                if (swept.depth > PEN_EPS && !firstCollision) {
                    firstCollision = {
                        time: round(elapsed), depth: round(swept.depth, 5), sweepT: round(swept.t),
                        truck: { x: round(swept.truck.x), z: round(swept.truck.z), a: round(swept.truck.a) },
                        hit: { id: swept.hit.id, x: round(swept.hit.x), z: round(swept.hit.z), a: round(swept.hit.a) },
                    };
                }

                if (truck.path.length && moved < 0.015) stall += DT;
                else stall = 0;
                maxStall = Math.max(maxStall, stall);

                const detouring = !!truck._detour;
                if (detouring && !wasDetouring) detours++;
                wasDetouring = detouring;
                const reversing = !!truck._reversing;
                if (reversing && !wasReversing) reversals++;
                wasReversing = reversing;

                if (tc.gate && prevTruck.x < tc.gate.x && nextTruck.x >= tc.gate.x) {
                    const t = (tc.gate.x - prevTruck.x) / Math.max(1e-9, nextTruck.x - prevTruck.x);
                    const crossZ = prevTruck.z + (nextTruck.z - prevTruck.z) * t;
                    if (Math.abs(crossZ - tc.gate.z) <= tc.gate.halfGap) gateCentralCross = true;
                }

                const remaining = Math.hypot(truck.x - tc.goal[0], truck.z - tc.goal[1]);
                if (remaining < minRemaining) {
                    minRemaining = remaining;
                    closestPose = { x: round(truck.x), z: round(truck.z), a: round(truck.angle), v: round(truck.currentSpeed || 0) };
                }
                const stoppedAtGoal = remaining <= ARRIVAL_TOL
                    && truck.path.length === 0 && (truck.currentSpeed || 0) <= 0.05;
                if (stoppedAtGoal) {
                    if (!settlePose) settlePose = nextTruck;
                    stableFor += DT;
                    postArrivalDrift = Math.max(postArrivalDrift,
                        Math.hypot(nextTruck.x - settlePose.x, nextTruck.z - settlePose.z));
                    postArrivalTurn = Math.max(postArrivalTurn, Math.abs(angleDelta(settlePose.a, nextTruck.a)));
                    if (stableFor >= 1) { settled = true; break; }
                } else {
                    stableFor = 0;
                    settlePose = null;
                }

                if (step % 8 === 0) {
                    trace.push({
                        t: round(elapsed), x: round(truck.x), z: round(truck.z), a: round(truck.angle),
                        v: round(truck.currentSpeed || 0, 2), p: truck.path.length,
                        d: truck._detour ? 1 : 0, r: truck._reversing ? 1 : 0,
                    });
                    if (trace.length > 12) trace.shift();
                }
                if (step % 30 === 0) {
                    trajectory.push({
                        t: round(elapsed), x: round(truck.x), z: round(truck.z),
                        a: round(truck.angle), v: round(truck.currentSpeed || 0, 2),
                        steer: round(truck._truckSteer || 0),
                        next: truck.path?.[0]
                            ? [round(truck.path[0].x), round(truck.path[0].z)]
                            : null,
                        path: truck.path?.length || 0,
                    });
                }
                const pathSig = (truck.path || []).map(p => `${round(p.x, 1)},${round(p.z, 1)}`).join('|');
                if (pathSig !== previousPathSig) {
                    pathEvents.push({ t: round(elapsed), sig: pathSig, x: round(truck.x), z: round(truck.z), a: round(truck.angle) });
                    previousPathSig = pathSig;
                }
                prevTruck = nextTruck;
                prevObstacles = nextObstacles;
            }

            const remaining = Math.hypot(truck.x - tc.goal[0], truck.z - tc.goal[1]);
            const direct = Math.hypot(tc.goal[0] - tc.start[0], tc.goal[1] - tc.start[1]);
            const ratio = travel / Math.max(1e-6, direct);
            const failures = [];
            if (initialCollision) failures.push('invalid fixture starts overlapped');
            if (trailer && !trailerProbeOk) failures.push('truck/trailer two-body collision probe failed');
            if (plannedCollision && plannedCollision.depth > PEN_EPS) failures.push('planned path is not full-width clear');
            if (maxPenetration > PEN_EPS) failures.push(`swept OBB penetration ${round(maxPenetration, 4)}`);
            if (!settled) failures.push(`did not settle within ${tc.maxTime}s`);
            if (maxStall > 4) failures.push(`continuous stall ${round(maxStall)}s`);
            if (ratio > tc.maxRatio) failures.push(`travel ratio ${round(ratio, 2)} > ${tc.maxRatio}`);
            if (postArrivalDrift > 0.10) failures.push(`post-arrival drift ${round(postArrivalDrift)}`);
            if (postArrivalTurn > Math.PI / 90) failures.push(`post-arrival turn ${round(postArrivalTurn * 180 / Math.PI, 1)}deg`);
            if (tc.gate && gateCentralCross !== tc.gate.expectCentral) {
                failures.push(tc.gate.expectCentral ? 'did not use feasible full-width gate' : 'attempted too-narrow gate');
            }

            return {
                name: `${tc.name}${runRepeats > 1 ? `#${repeatIndex + 1}` : ''}`,
                pass: failures.length === 0,
                elapsed: round(elapsed), remaining: round(remaining), settled,
                travel: round(travel), ratio: round(ratio, 2), turns: round(totalTurn / (Math.PI * 2), 2),
                maxStall: round(maxStall), maxPen: round(maxPenetration, 5),
                minClear: Number.isFinite(minClearance) ? round(minClearance) : null,
                detours, reversals, reverseDistance: round(reverseDistance),
                pathN: initialPathN, gateCentralCross: tc.gate ? gateCentralCross : null,
                failures,
                failureTrace: failures.length ? {
                    plannedCollision: plannedCollision ? {
                        depth: round(plannedCollision.depth, 5), leg: plannedCollision.leg,
                        truck: plannedCollision.truck, hit: plannedCollision.hit,
                    } : null,
                    firstCollision,
                    initialPath,
                    trailerProbeOk,
                    minRemaining: round(minRemaining),
                    closestPose,
                    pathEvents,
                    trajectory,
                    final: { x: round(truck.x), z: round(truck.z), a: round(truck.angle), v: round(truck.currentSpeed || 0), path: truck.path.length },
                    tail: trace,
                } : null,
            };
        };

        const out = [];
        for (let repeatIndex = 0; repeatIndex < runRepeats; repeatIndex++) {
            for (let i = 0; i < scenarios.length; i++) out.push(runCase(scenarios[i], i, repeatIndex));
        }
        return out;
    }, { repeats, wantedCase: caseFilter });

    console.log(JSON.stringify(results.map(r => ({
        name: r.name, pass: r.pass, elapsed: r.elapsed, remaining: r.remaining,
        travel: r.travel, ratio: r.ratio, turns: r.turns, maxStall: r.maxStall,
        maxPen: r.maxPen, minClear: r.minClear, detours: r.detours,
        reversals: r.reversals, reverseDistance: r.reverseDistance,
        pathN: r.pathN, gateCentralCross: r.gateCentralCross,
    })), null, 2));

    const failed = results.filter(r => !r.pass);
    if (!results.length) {
        console.error('\nFAIL: no clearance scenarios matched');
        process.exitCode = 2;
    } else if (failed.length) {
        console.error('\nFAILURES');
        for (const r of failed) console.error(JSON.stringify({
            name: r.name, failures: r.failures, trace: r.failureTrace,
        }));
        process.exitCode = 2;
    } else {
        console.log(`\nPASS: ${results.length} deterministic transport-clearance scenarios`);
    }
} finally {
    await browser.close();
}

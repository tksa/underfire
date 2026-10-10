import { chromium } from 'playwright';
const browser = await chromium.launch();
try {
    const page = await browser.newPage();
    await page.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8741', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Game.units?.length);
    const results = await page.evaluate(() => {
        Game._paused = true; window.requestAnimationFrame = () => 0;
        Game.units = []; Game.selection.clear(); Game._friendlyFireCues = []; Game.tracers = [];
        Game.setPatch(25, 25, 120, 120, 'grass'); Game.gameClock = 100;
        Game.getHeight = () => 0; // flat ballistic range; hills are tested by the shot-path guard
        const checks = [], check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
        const random = Math.random; let seed = 12251;
        Math.random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
        try {
            const make = (x, z) => {
                const u = Game.makeUnit('german', 'grenadier', x, z, { aiState: 'player', angle: 0 });
                Object.assign(u, { stance: 'stand', moving: false, path: [], _dispSpeed: 0, currentSpeed: 0,
                    _combatReady: true, suppressionValue: 0, holdFire: false, cooldownLeft: 0, fireTargetId: null });
                return u;
            };
            const source = make(207, 200), men = Array.from({ length: 48 }, (_, i) => make(200 + i % 6 * 0.2, 199 + Math.floor(i / 6) * 0.2));
            Game.noteFriendlyFireDirection(source);
            const initialAmmo = men.map(u => u.ammo);
            for (let frame = 0; frame < 600; frame++) {
                Game.gameClock += 1 / 30;
                for (const u of men) { u.cooldownLeft = Math.max(0, u.cooldownLeft - 1 / 30); Game.updateSupportingFire(u, 1 / 30, false); }
            }
            const responders = men.filter(u => u._shotSerial > 0);
            check('only a small subset responds to one observed volley', responders.length > 0 && responders.length <= 2, responders.length);
            check('short bursts consume real ammunition', responders.every(u => u._shotSerial <= 2
                && initialAmmo[men.indexOf(u)] - u.ammo === u._shotSerial));
            check('supporting shots do not propagate new fire cues', Game._friendlyFireCues.length === 1);
            check('no invisible enemy is acquired', men.every(u => u.fireTargetId == null && !u.forcedTargetId));
            check('bursts stop and release the aiming state', men.every(u => !u._supportFire));
            check('shots can extend beyond normal effective range', Game.tracers.some(t => Game.dist(t.x, t.z, t.tx, t.tz) > men[0].range));
            check('bearing scatter is broad', Game.tracers.length > 1
                && Math.max(...Game.tracers.map(t => Math.atan2(t.tz - t.z, t.tx - t.x)))
                    - Math.min(...Game.tracers.map(t => Math.atan2(t.tz - t.z, t.tx - t.x))) > 0.03);
            const cases = [
                ['hold fire', { holdFire: true }], ['movement order', { moving: true, path: [{ x: 220, z: 200 }] }],
                ['empty weapon', { ammo: 0 }], ['heavy suppression', { suppressionValue: 60 }],
                ['explicit target order', { forcedTargetId: 999 }], ['inside transport', { _inVehicle: 99 }],
                ['retreat order', { retreating: true }], ['manual facing', { _faceAngle: 1, _faceUntil: Game.gameClock + 10 }],
            ];
            for (const [label, props] of cases) {
                const u = make(200, 200); Object.assign(u, props);
                u._supportFire = { bearing: 0, remaining: 2, until: Game.gameClock + 8, next: 0, stable: 1 };
                Game.updateSupportingFire(u, 1 / 30, false);
                check(`${label} cancels supporting fire`, !u._supportFire && !u._shotSerial);
            }
            const direct = make(200, 200); direct._supportFire = { remaining: 2 };
            Game.updateSupportingFire(direct, 1 / 30, true);
            check('a visible in-range target takes priority', !direct._supportFire);
            const blocked = make(200, 210); blocked._supportCheckAt = Game.gameClock;
            Game.noteFriendlyFireDirection(source);
            const before = Game.lineOfSight; Game.lineOfSight = () => 0;
            // Force the random eligibility branch so this tests perception, not chance.
            Math.random = () => 0.1; Game.updateSupportingFire(blocked, 1 / 30, false); Game.lineOfSight = before;
            check('an obstructed friendly shooter cannot cue a response', !blocked._supportFire);
            Game.setPatch(69, 65, 2, 10, 'wall');
            const wallShooter = make(203, 210); const start = Game.tracers.length;
            Game.fireSupportingRound(wallShooter, { bearing: 0 });
            const trace = Game.tracers[start];
            check('solid terrain stops the scattered round', trace && trace.tx < 210, trace?.tx);

            // Exercise the real firing module: front-line infantry engages a
            // spotted enemy while a rear rifleman faces it beyond weapon range.
            Game.setPatch(25, 25, 120, 120, 'grass');
            Game.units = []; Game._friendlyFireCues = []; Game.tracers = [];
            const rear = make(200, 250), front = make(255, 256);
            const enemy = Game.makeUnit('french', 'fusilier', 292, 250, { aiState: 'player' });
            enemy.hp = enemy.maxHp = 100000;
            const recon = Game.isReconRevealed;
            Game.isReconRevealed = (x, z) => x === enemy.x && z === enemy.z;
            try {
                front.angle = front.turretAngle = Game.angleTo(front.x, front.z, enemy.x, enemy.z);
                rear.angle = rear.turretAngle = 0; rear._supportCheckAt = Game.gameClock;
                const ctx = { dt: 1 / 30, enemy, isVeh: false };
                check('fixture enemy is beyond rear range and within front range',
                    Game.dist(rear.x, rear.z, enemy.x, enemy.z) > rear.range
                    && Game.dist(front.x, front.z, enemy.x, enemy.z) < front.range);
                for (let i = 0; i < 20; i++) {
                    Game.gameClock += ctx.dt; Game.uMod.frame(front, ctx); Game.uMod.fire(front, ctx);
                }
                check('closer friendly engages through the normal firing module', front._shotSerial > 0 && Game._friendlyFireCues.length === 1);
                const cue = Game._friendlyFireCues[0];
                check('visible forward gunfire can be observed beyond unit identification range',
                    !Game.unitCanSee(rear, front) && Game.canObserveFriendlyFire(rear, cue));
                check('already-facing rear infantry identifies the forward engagement', Game.isForwardSupportingCue(rear, cue));
                const ammo = rear.ammo;
                for (let i = 0; i < 240; i++) {
                    Game.gameClock += ctx.dt;
                    Game.uMod.frame(rear, ctx); Game.uMod.fire(rear, ctx);
                }
                check('out-of-range enemy does not prevent occasional support through the firing module',
                    rear._shotSerial > 0 && rear._shotSerial <= 2 && ammo - rear.ammo === rear._shotSerial);
                const rounds = Game.tracers.filter(t => t.supporting);
                check('rear shots travel beyond effective range in the engagement direction', rounds.length > 0
                    && rounds.every(t => Game.dist(t.x, t.z, t.tx, t.tz) > rear.range
                        && Math.abs(Game.angleDiff(0, Math.atan2(t.tz - t.z, t.tx - t.x))) < 0.5));
                check('support does not acquire or share a hidden target', rear.fireTargetId == null
                    && !rear.forcedTargetId && !('targetId' in cue));
                check('forward response still ends after its short burst', !rear._supportFire);

                Game.gameClock += 10; Game.noteFriendlyFireDirection(front);
                rear._supportCheckAt = Game.gameClock; rear._faceAngle = rear.angle = 0;
                rear._faceUntil = Game.gameClock + 5; rear.cooldownLeft = 0;
                Game.updateSupportingFire(rear, ctx.dt, false);
                check('matching manual facing permits support without turning off the order',
                    rear._supportFire?.bearing === 0 && rear.angle === 0);
                rear._supportFire = null; rear._faceAngle = Math.PI / 2; rear._supportCheckAt = Game.gameClock;
                Game.updateSupportingFire(rear, ctx.dt, false);
                check('an unrelated manual facing order is preserved', !rear._supportFire);

                const smoke = Game.isInSmoke; Game.isInSmoke = () => true;
                check('smoke still conceals distant friendly gunfire', !Game.canObserveFriendlyFire(rear, cue));
                Game.isInSmoke = smoke;
                const far = { ...cue, x: rear.x + 90, z: rear.z };
                check('firing observation remains local', !Game.canObserveFriendlyFire(rear, far));

                // Same random roll: facing an ongoing engagement should make
                // a response more likely than noticing one off to the side.
                Math.random = () => 0.4; rear._faceAngle = null;
                rear.angle = 0; rear._supportCheckAt = Game.gameClock;
                Game._friendlyFireCues = []; Game.noteFriendlyFireDirection(front);
                Game.updateSupportingFire(rear, ctx.dt, false);
                check('already-facing troops have a higher response chance', !!rear._supportFire);
                rear._supportFire = null; rear.angle = Math.PI; rear._supportCheckAt = Game.gameClock;
                Game._friendlyFireCues = []; Game.noteFriendlyFireDirection(front);
                Game.updateSupportingFire(rear, ctx.dt, false);
                check('the same roll does not make unrelated troops turn and fire', !rear._supportFire);
                Game._friendlyFireCues = []; rear._supportCheckAt = Game.gameClock;
                Game.updateSupportingFire(rear, ctx.dt, false);
                check('no firing cue does not spend the long response cooldown',
                    !rear._supportFire && rear._supportCheckAt - Game.gameClock <= 2.5);

                // Full unit ticks also run idle/soft-facing logic after fire.
                // That old look direction must not fight a supporting burst.
                Game.playerTeam = rear.team; Game.isReconRevealed = () => false;
                Math.random = () => 0.1; Game._friendlyFireCues = [];
                Game.noteFriendlyFireDirection(front);
                Object.assign(rear, { angle: 0, _faceGoal: Math.PI / 2, _supportCheckAt: Game.gameClock,
                    _scanEnemy: null, _engageId: null, _engageTime: -Infinity, _nextTargetScanAt: 0,
                    _lastThreat: null, _threatTime: -Infinity, fireTargetId: null, cooldownLeft: 0 });
                const shots = rear._shotSerial || 0;
                for (let i = 0; i < 180; i++) {
                    Game.gameClock += ctx.dt; Game.updateUnit(rear, ctx.dt);
                }
                check('full unit ticks permit support without seeing the distant enemy',
                    !Game.unitCanSee(rear, enemy) && rear._shotSerial > shots && rear.fireTargetId == null);
                check('supporting fire keeps the stationary rear unit in position',
                    Game.dist(rear.x, rear.z, 200, 250) < 0.01 && !rear.moving);
            } finally { Game.isReconRevealed = recon; }
            // Failed notice rolls should retry while the volley is still fresh.
            Game.units = []; Game._friendlyFireCues = []; Game.gameClock += 20;
            const cueSource = make(215, 240), retry = make(200, 245);
            retry._supportCheckAt = Game.gameClock; Game.noteFriendlyFireDirection(cueSource);
            Math.random = () => .9; Game.updateSupportingFire(retry, 1 / 30, false);
            check('a failed notice roll retries within the current volley', !retry._supportFire
                && retry._supportCheckAt - Game.gameClock <= 2.4);
            Math.random = () => .1;
            const locals = [make(200, 245), make(201, 245), make(200, 262), make(201, 262)];
            for (const u of locals) { u._supportCheckAt = Game.gameClock; Game.updateSupportingFire(u, 1 / 30, false); }
            check('separate nearby groups can respond to the same engagement', locals.every(u => u._supportFire));
            const crowded = make(202, 245); crowded._supportCheckAt = Game.gameClock;
            Game.updateSupportingFire(crowded, 1 / 30, false);
            check('each local group still limits simultaneous responders', !crowded._supportFire);

            Game.units = []; const watcher = make(200, 200);
            const firingEnemy = Game.makeUnit('french', 'fusilier', 200 + watcher.sight * 1.8, 200, { aiState: 'player' });
            firingEnemy.stance = 'stand';
            check('a quiet distant enemy remains unidentified', !Game.unitCanSee(watcher, firingEnemy));
            Game.noteWeaponShot(firingEnemy);
            check('a distant discharge is easier to spot', Game.unitCanSee(watcher, firingEnemy));
            const fog = Game.isFogVisible; Game.isFogVisible = () => false;
            check('an actually visible muzzle flash is not blocked by stale map fog', Game.nearestEnemy(watcher) === firingEnemy);
            Game.isFogVisible = fog;
            const los = Game.lineOfSight; Game.lineOfSight = () => false;
            check('firing does not reveal enemies through solid cover', !Game.unitCanSee(watcher, firingEnemy));
            Game.lineOfSight = los;
            Game.gameClock += 3;
            check('the firing visibility bonus expires', !Game.unitCanSee(watcher, firingEnemy));
        } finally { Math.random = random; }
        return checks;
    });
    for (const c of results) console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.detail != null ? ': ' + JSON.stringify(c.detail) : ''}`);
    if (results.some(c => !c.pass)) process.exitCode = 1;
} finally { await browser.close(); }

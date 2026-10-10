/** Controlled drills for weapon handling, infantry routes and missing animations.
 * Run against the local game: node scripts/tactical-behavior-test.mjs
 */
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
    await page.goto(process.env.SMOKE_URL || 'http://localhost:8741', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.Game?.units?.length > 0, null, { timeout: 120000, polling: 250 });
    await page.evaluate(() => {
        Game._paused = true;
        window.requestAnimationFrame = () => 0;
        for (const u of Game.units) { u.alive = false; u._noRemnant = true; u.mesh.visible = false; }
        Game.units = []; Game.selection.clear();
        Game.setPatch(55, 55, 42, 42, 'grass');
        Game.gameClock = 100;
    });
    const results = await page.evaluate(() => {
        const results = [];
        const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail });
        const make = (team, kind, x, z, angle = 0) => {
            const u = Game.makeUnit(team, kind, x, z, { aiState: 'player', angle });
            u.cooldownLeft = 0; u._combatReady = true; u._canFire = true;
            u.hp = u.maxHp = 100000; u.armor = 0; u.coverBonus = 0;
            return u;
        };
        const target = make('french', 'fusilier', 220, 200);
        target.holdFire = true;
        const gun = make('german', 'pak36', 205, 200, Math.PI);
        const rifle = make('german', 'grenadier', 207, 203, Math.PI);
        const stepFire = (u, n) => {
            for (let i = 0; i < n; i++) {
                Game.gameClock += 1 / 30;
                const ctx = { dt: 1 / 30, isVeh: Game.isTank(u.kind), enemy: target };
                Game.uMod.frame(u, ctx); Game.uMod.fire(u, ctx);
            }
        };
        stepFire(gun, 1); stepFire(rifle, 1);
        check('gun and rifle cannot fire backwards', !gun._shotSerial && !rifle._shotSerial);
        stepFire(gun, 180); stepFire(rifle, 60);
        check('aligned weapons settle and fire', gun._shotSerial > 0 && rifle._shotSerial > 0,
            { gun: gun._shotSerial, rifle: rifle._shotSerial });
        rifle.path = [{ x: 245, z: 203 }]; rifle.moving = true;
        rifle.currentSpeed = rifle._dispSpeed = 2.2; rifle.cooldownLeft = 0;
        const fired = rifle._shotSerial;
        stepFire(rifle, 90);
        check('relocating rifleman keeps his move without firing', rifle._shotSerial === fired && rifle.path.length === 1);
        const disturbed = rifle.weaponSteadiness;
        rifle.path = []; rifle.moving = false; rifle.currentSpeed = rifle._dispSpeed = 0;
        stepFire(rifle, 1);
        check('halting requires a new sight picture', rifle._shotSerial === fired);
        stepFire(rifle, 90);
        check('accuracy recovers gradually after a halt', disturbed < 0.8 && rifle.weaponSteadiness > 0.95,
            { disturbed, recovered: rifle.weaponSteadiness });
        rifle.ammo = 0; const emptySerial = rifle._shotSerial; stepFire(rifle, 90);
        check('empty weapon stays quiet', rifle._shotSerial === emptySerial && rifle.weaponState === 'empty');
        rifle.ammo = 30; rifle.holdFire = true; stepFire(rifle, 90);
        check('hold-fire stays authoritative', rifle._shotSerial === emptySerial);

        rifle.holdFire = false; rifle.stance = 'prone'; rifle._suppFloor = 'prone';
        Game.uMod.posture(rifle, { isVeh: false });
        rifle._suppFloor = null; Game.wantStance(rifle, 'crouch', 'cover', 2);
        Game.gameClock += 0.3; Game.uMod.posture(rifle, { isVeh: false });
        check('brief protective gaps do not lift a prone soldier', rifle.stance === 'prone');
        Game.gameClock += 1.1; Game.uMod.posture(rifle, { isVeh: false });
        check('settled posture request can raise the soldier', rifle.stance === 'crouch');
        Game.setManualStance(rifle, 'stand'); Game.uMod.posture(rifle, { isVeh: false });

        // Two alternating sight lines: a brief tree/foliage occlusion must not
        // make a defender keep swinging between otherwise similar targets.
        const observer = make('german', 'grenadier', 240, 230);
        const first = make('french', 'fusilier', 255, 230);
        const second = make('french', 'fusilier', 225, 230);
        const perception = { nearest: Game.nearestEnemy, sees: Game.unitCanSee };
        let firstVisible = true;
        try {
            Game.unitCanSee = (_unit, enemy) => enemy.alive && (enemy !== first || firstVisible);
            Game.nearestEnemy = (_unit, filter) => [first, second].find(u => Game.unitCanSee(_unit, u) && (!filter || filter(u))) || null;
            const scan = () => {
                Game.gameClock += 0.2; observer._nextTargetScanAt = 0;
                const ctx = { dt: 0.2 }; Game.uMod.scan(observer, ctx); return ctx.enemy;
            };
            scan();
            let stable = true;
            for (let i = 0; i < 12; i++) {
                firstVisible = i % 2 === 1;
                stable &&= scan()?.id === first.id;
            }
            check('brief alternating occlusion retains the laid target', stable);
            firstVisible = false;
            Game.uMod.fire(observer, { dt: 0.1, isVeh: false, enemy: first });
            check('target memory never authorizes blind fire', !observer._shotSerial);
            for (let i = 0; i < 8; i++) scan();
            check('persistent occlusion releases the target for a visible enemy', observer.fireTargetId === second.id);
            second.alive = false; firstVisible = true; scan();
            check('a dead target is released immediately', observer.fireTargetId === first.id);
        } finally {
            Game.nearestEnemy = perception.nearest; Game.unitCanSee = perception.sees;
        }

        gun.angle = gun.turretAngle = Math.PI; gun.cooldownLeft = 0;
        gun.bombardX = target.x; gun.bombardZ = target.z; gun._dispSpeed = 2;
        const groundSerial = gun._shotSerial;
        Game.updateGroundFire(gun, 1 / 30, Game.WEAPONS[gun.weaponKey]);
        check('attack-ground traverses instead of snapping and firing', gun._shotSerial === groundSerial
            && Math.abs(Game.angleDiff(Math.PI, gun.angle)) < 0.04);
        for (let i = 0; i < 180; i++) {
            Game.gameClock += 1 / 30;
            Game.uMod.frame(gun, { dt: 1 / 30 });
            Game.updateGroundFire(gun, 1 / 30, Game.WEAPONS[gun.weaponKey]);
        }
        check('attack-ground fires after traversing and settling', gun._shotSerial > groundSerial);
        gun.bombardX = gun.bombardZ = null;

        const tank = make('german', 'panzer2', 265, 260);
        tank.bombardX = tank.x; tank.bombardZ = tank.z + 20;
        for (let i = 0; i < 240 && !tank._shotSerial; i++) {
            Game.uMod.frame(tank, { dt: 1 / 30 });
            Game.updateGroundFire(tank, 1 / 30, Game.WEAPONS[tank.weaponKey]);
        }
        const tracer = Game.tracers.at(-1);
        check('tank attack-ground uses turret bearing with a stationary hull', tank._shotSerial === 1
            && Math.abs(tank.angle) < 0.01 && Math.abs(tank.turretAngle - Math.PI / 2) < 0.15
            && Math.abs(tracer.x - tank.x) < 0.3 && tracer.z > tank.z);
        tank.bombardX = tank.bombardZ = null;

        const walker = make('french', 'fusilier', 175.5, 235.5);
        walker.holdFire = true;
        const open = Game.findPath(walker, walker.x, walker.z, 205.8, 253.2);
        check('open infantry route has few turns and exact endpoint', open.length <= 4
            && Math.hypot(open.at(-1).x - 205.8, open.at(-1).z - 253.2) < 0.01, open.length);
        Game.setPatch(63, 73, 1, 10, 'wall');
        const route = Game.findPath(walker, walker.x, walker.z, 205.8, 253.2);
        let previous = walker, clear = true;
        for (const wp of route) {
            clear &&= Game.segmentPassable(walker, previous.x, previous.z, wp.x, wp.z);
            previous = wp;
        }
        check('infantry route clears wall corners with its body', route.length > 0 && clear, route.length);
        const ordered = [
            { x: 177, z: 240, _orderStop: { id: 1 } },
            { x: 180, z: 243 }, { x: 183, z: 246, _orderStop: { id: 2 } },
        ];
        const smooth = Game.smoothInfantryPath(walker, walker.x, walker.z, ordered);
        check('smoothing preserves every ordered stop', smooth.filter(p => p._orderStop).map(p => p._orderStop.id).join() === '1,2');

        // Exercise the actual order + movement pipeline around the wall.
        Game.issueCommand(205.8, 253.2, 'move', [walker]);
        let maxSolid = 0;
        for (let i = 0; i < 1800 && walker.path.length; i++) {
            Game.gameClock += 1 / 30;
            Game.updateUnit(walker, 1 / 30);
            maxSolid = Math.max(maxSolid, Game._bodySolidCount(walker, walker.x, walker.z, walker.angle));
        }
        check('ordered infantry walk around the wall and arrive', maxSolid === 0
            && Math.hypot(walker.x - 205.8, walker.z - 253.2) < 2,
            { x: walker.x, z: walker.z, maxSolid });

        // Losing LOS used to leave this latch true for the rest of the battle.
        rifle.holdFire = false; rifle.forcedTargetId = target.id;
        rifle._inFiringPos = true; rifle._firingPosSeenAt = Game.gameClock - 5;
        rifle._pursueTimer = 0; rifle.moving = false;
        Game.setPatch(71, 64, 1, 7, 'wall');
        Game.uMod.engage(rifle, { dt: 1 / 30, isVeh: false, enemy: target, weaponDef0: Game.WEAPONS[rifle.weaponKey] });
        check('sustained lost LOS releases the firing-position latch', !rifle._inFiringPos);

        const bofors = make('polish', 'bofors37', 232, 235);
        const medic = make('german', 'medic', 240, 235);
        window._tacticalSubjects = { rifle, gun, bofors, medic };
        return results;
    });
    await page.waitForFunction(() => {
        const { rifle, gun, bofors, medic } = window._tacticalSubjects;
        return rifle.mesh.userData.isSoldier && medic.mesh.userData.isSoldier
            && [gun, bofors].every(u => u.mesh.userData.fieldGunCrew?.userData.crewMode === 'soldier'
                && u.mesh.userData.vehicleRig && u.mesh.userData.weaponRecoil);
    }, null, { timeout: 120000, polling: 250 });
    results.push(...await page.evaluate(() => {
        const { rifle, gun, bofors } = window._tacticalSubjects;
        const results = [], check = (name, pass, detail) => results.push({ name, pass: !!pass, detail });
        const data = rifle.mesh.userData;
        rifle.path = []; rifle.moving = false; rifle.holdFire = false; rifle.ammo = 0;
        rifle.currentSpeed = rifle._dispSpeed = 0;
        rifle.stance = 'stand'; rifle.fireTargetId = 999;
        check('empty soldier does not play a fire loop', Game._chooseClip(rifle) === 'idle');
        rifle.stance = 'prone'; rifle._dispSpeed = 0.6;
        check('crawl has its own animation', Game._chooseClip(rifle) === 'crawl');
        Object.values(data.actions).forEach(a => a.stop()); data._activeClip = null;
        Game._playClip(rifle, 'crawl', 0);
        const bones = Game._soldierLegBones(rifle);
        const samples = [];
        for (let i = 0; i < 300; i++) {
            Game.gameClock += 1 / 30; Game._updateModelAnimation(rifle, 1 / 30);
            rifle.mesh.updateMatrixWorld(true);
            samples.push({ knee: bones.kneeL.quaternion.clone(), torso: bones.torso.getWorldPosition(new Game.THREE.Vector3()).y - rifle.mesh.position.y });
        }
        const kneeTravel = Math.max(...samples.map(s => s.knee.angleTo(samples[0].knee)));
        check('crawl articulates rather than sliding a frozen pose', kneeTravel > 0.1, kneeTravel);
        // Revisit an identical mixer time after many updates. This detects pose
        // accumulation without assuming which local axis an imported knee uses.
        data.actions.crawl.time = 0.4; Game._updateModelAnimation(rifle, 0);
        const referenceKnee = bones.kneeL.quaternion.clone();
        for (let i = 0; i < 120; i++) Game._updateModelAnimation(rifle, 1 / 30);
        data.actions.crawl.time = 0.4; Game._updateModelAnimation(rifle, 0);
        check('animation poses do not accumulate offsets', referenceKnee.angleTo(bones.kneeL.quaternion) < 1e-5);
        const crawlHeight = Math.max(...samples.map(s => s.torso));
        rifle.stance = 'crouch'; rifle._dispSpeed = 1.0;
        check('crouched movement selects a low locomotion pose', Game._chooseClip(rifle) === 'crouch_walk');
        Game._playClip(rifle, 'idle', 0); data.mixer.update(1);
        rifle.mesh.updateMatrixWorld(true);
        const standingHeight = bones.torso.getWorldPosition(new Game.THREE.Vector3()).y - rifle.mesh.position.y;
        check('crawl stays below standing torso height', crawlHeight < standingHeight * 0.65, { crawlHeight, standingHeight });
        for (const u of [gun, bofors]) {
            const ud = u.mesh.userData;
            const rig = ud.vehicleRig, recoil = ud.weaponRecoil;
            check(`${u.kind} has animated crew and articulated carriage`, ud.fieldGunCrew.userData.figures.length === 2
                && ud.fieldGunCrew.userData.crewMode === 'soldier' && rig.trails.length === 2 && rig.wheels.length >= 2);
            Game.noteWeaponShot(u); u._shotAge = 0.12; Game.updateVehicleModel(u, 0.1);
            const kick = recoil.node.position.clone().sub(recoil.base);
            check(`${u.kind} recoils backwards along its bore after a real shot`,
                kick.dot(recoil.direction.clone().normalize()) < -0.01
                && kick.clone().cross(recoil.direction).length() < 1e-7);
            u._shotAge = 10; Game.updateVehicleModel(u, 0.1);
            check(`${u.kind} barrel returns to battery`, recoil.node.position.distanceTo(recoil.base) < 1e-7);
            const loader = ud.fieldGunCrew.userData.figures.find(f => f.userData.fieldGunRole === 'loader');
            const arm = Game._soldierLegBones(loader.userData.animationUnit).armR;
            u._shotAge = 10; Game.updateFieldGunCrew(u, 0.1);
            const rest = arm.quaternion.clone();
            u._shotAge = 0.9; Game.updateFieldGunCrew(u, 0.1);
            const reachAngle = rest.angleTo(arm.quaternion);
            u._shotAge = 10;
            for (let i = 0; i < 180; i++) Game.updateFieldGunCrew(u, 1 / 30);
            check(`${u.kind} loader handles the breech and returns to rest`, reachAngle > 0.02
                && rest.angleTo(arm.quaternion) < 0.01, reachAngle);
            u.deployed = true;
            for (let i = 0; i < 90; i++) Game.updateVehicleModel(u, 1 / 30);
            const open = rig.trails.map(n => n.quaternion.clone());
            u._towed = true; Game.updateVehicleModel(u, 0.1); Game.updateFieldGunCrew(u, 0.1);
            check(`${u.kind} crew boards when towed`, !ud.fieldGunCrew.visible);
            check(`${u.kind} both trails fold for towing`, rig.trails.every((n, i) => n.quaternion.angleTo(open[i]) > 0.01));
        }
        rifle.team = gun.team = Game.playerTeam;
        rifle.stance = 'stand'; rifle._dispSpeed = rifle.currentSpeed = 0; rifle.ammo = 30;
        gun._towed = false;
        Game.noteWeaponShot(rifle); Game.noteWeaponShot(gun);
        rifle._shotAge = gun._shotAge = 0.12;
        Game._paused = false; Game.syncUnitMeshes(1 / 30);
        Game._paused = true;
        const frozen = { time: data.mixer.time, knee: bones.kneeL.quaternion.clone(),
            recoil: gun.mesh.userData.weaponRecoil.node.position.clone() };
        for (let i = 0; i < 90; i++) { Game.gameClock += 1 / 30; Game.syncUnitMeshes(1 / 30); }
        check('tactical pause freezes soldier and gun-crew action', data.mixer.time === frozen.time
            && bones.kneeL.quaternion.equals(frozen.knee)
            && gun.mesh.userData.weaponRecoil.node.position.equals(frozen.recoil)
            && rifle._shotAge === 0.12 && gun._shotAge === 0.12);
        Game._paused = false;
        Game.uMod.frame(rifle, { dt: 1 / 30 }); Game.syncUnitMeshes(1 / 30);
        check('animation and shot timing resume after tactical pause', data.mixer.time > frozen.time && rifle._shotAge > 0.12);
        Game._paused = true;
        return results;
    }));
    for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name}${result.detail === undefined ? '' : ': ' + JSON.stringify(result.detail)}`);
    if (errors.length) console.error(errors);
    if (errors.length || results.some(r => !r.pass)) process.exitCode = 1;
} finally {
    await browser.close();
}

/**
 * 47mm SA 37 towing contract: from SHORT distances all around the transport,
 * ordering the 47mm to the truck must end attached. The earlier suites only
 * exercised the 25mm; this one runs the heavier gun, plus the real spawn
 * cluster, with telemetry printed on any failure.
 * Run: server on 8741, then: node scripts/tow-at47-test.mjs
 */
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
await page.goto(process.env.SMOKE_URL || 'http://localhost:8741', { waitUntil: 'load' });
await page.waitForTimeout(2500);
const domClick = (sel) => page.waitForFunction((s) => {
  const b = document.querySelector(s); if (!b || b.offsetParent === null) return false;
  b.click(); return true;
}, sel, { timeout: 60000, polling: 500 });
if (await page.locator('#btnEnterGame').count()) await domClick('#btnEnterGame').catch(() => {});
await domClick('#btnStartMission');
await page.waitForFunction(() => window.Game && Game.units.length > 0 && !Game._paused, null, { timeout: 60000, polling: 500 });
await page.evaluate(() => { Game.renderScene = () => {}; });
await page.waitForTimeout(1500);

const results = [];
async function runCase(name, dx, dz, opts = {}) {
  const r = await page.evaluate(async ({ dx, dz, opts }) => {
    const gun = Game.units.find(u => u.kind === 'at47' && u.alive);
    const truck = Game.units.find(u => u.alive && u.supportType === 'transport');
    if (!gun || !truck) return { ok: false, error: 'at47 or transport missing' };
    if (gun._towed) Game.untowUnit(gun);
    // Spawn trucks come already towing: free this one. In the cluster cases
    // the freed gun stays parked AT the hitch (real-game clutter); in the
    // open-field cases it is parked out of the way.
    const rider = Game.towedBy(truck);
    if (rider) {
        Game.untowUnit(rider);
        if (!opts.spawnCluster) { rider.x = truck.x + 25; rider.z = truck.z + 25; }
    }
    for (const u of [gun, truck]) {
      u._towApproachGunId = null; u._towApproachTruckId = null; u._towProg = null;
      u.path = []; u.moving = false; u.orderMode = 'move';
      if (Game.cancelQueuedPath) Game.cancelQueuedPath(u);
    }
    gun._unmanned = false; gun._crewAboard = 2; gun._deployT = 0;
    gun.deployed = opts.deployed ?? true;   // a parked AT gun is normally deployed
    if (!opts.spawnCluster) {
      const bx = 30, bz = 60;
      truck.x = bx; truck.z = bz; truck.angle = opts.truckAngle ?? Math.PI / 3;
      truck.currentSpeed = 0;
      gun.x = bx + dx; gun.z = bz + dz; gun.angle = 0;
    } else {
      gun.x = Game.clamp(truck.x + dx, 2, Game.WORLD_W - 2);
      gun.z = Game.clamp(truck.z + dz, 2, Game.WORLD_H - 2);
    }
    Game.orderTowApproach({ mover: gun, truck, gun });
    const t0 = Game.gameClock, w0 = performance.now();
    const tl = [];
    return await new Promise(resolve => {
      let next = 0;
      const check = () => {
        try {
          const secs = Game.gameClock - t0;
          if (secs >= next) {
            next += 0.5;
            tl.push({
              t: +secs.toFixed(1),
              gap: +Game.dist(truck.x, truck.z, gun.x, gun.z).toFixed(1),
              pl: (gun.path || []).length, mv: !!gun.moving,
              st: +(gun.stopTimer || 0).toFixed(2),
              dep: !!gun.deployed, dT: +(gun._deployT || 0).toFixed(2),
              cm: !!gun._canMove, cpl: +(gun._towCoupleT || 0).toFixed(1),
              ap: gun._towApproachGunId != null,
            });
          }
          if (gun._towed && gun._towedBy === truck.id) {
            return resolve({ ok: true, secs: +secs.toFixed(1) });
          }
          if (secs > 30 || performance.now() - w0 > 45000) {
            return resolve({ ok: false, secs: +secs.toFixed(1), timeline: tl });
          }
        } catch (err) {
          return resolve({ ok: false, error: String(err && err.message || err), timeline: tl });
        }
        setTimeout(check, 200);
      };
      check();
    });
  }, { dx, dz, opts }).catch(err => ({ ok: false, error: 'evaluate: ' + err.message }));
  results.push({ name, ...r });
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${name.padEnd(26)} ${r.ok ? r.secs + 's' : (r.error || '')}`);
  if (!r.ok && r.timeline) for (const s of r.timeline) console.log('   ', JSON.stringify(s));
  await page.evaluate(() => {
    const gun = Game.units.find(u => u.kind === 'at47' && u.alive);
    if (gun && gun._towed) Game.untowUnit(gun);
  });
  await page.waitForTimeout(1800);
}

// Real spawn cluster FIRST (trucks still parked in their lanes).
await runCase('spawn short behind', 0, 6, { spawnCluster: true });
await runCase('spawn short side', 7, 2, { spawnCluster: true });
// Open field, gun DEPLOYED (the normal parked state), short distances all round.
await runCase('behind 5', 0, 5);
await runCase('behind 8', 0, 8);
await runCase('front 6', 0, -6);
await runCase('front 10', 0, -10);
await runCase('left 6', -6, 0);
await runCase('right 6', 6, 0);
await runCase('diag 8', 6, 6);
await runCase('far 14', -10, 10);

// Detach → immediate re-attach: right after untow the gun is briefly
// unmanned (crew walking back). The pair must still form via the click path
// and the approach must wait for the crew, then drive and couple.
const race = await page.evaluate(async () => {
  const gun = Game.units.find(u => u.kind === 'at47' && u.alive);
  const truck = Game.units.find(u => u.alive && u.supportType === 'transport');
  if (gun._towed) Game.untowUnit(gun);
  const rider = Game.towedBy(truck);
  if (rider) { Game.untowUnit(rider); rider.x = truck.x + 25; rider.z = truck.z + 25; }
  for (const u of [gun, truck]) {
    u._towApproachGunId = null; u._towApproachTruckId = null; u._towProg = null;
    u.path = []; u.moving = false;
  }
  gun._unmanned = false; gun._crewAboard = 2; gun.deployed = false; gun._deployT = 0;
  truck.x = 30; truck.z = 60; truck.angle = Math.PI / 3; truck.currentSpeed = 0;
  gun.x = 36; gun.z = 64;
  Game.towUnit(truck, gun, true);          // couple up…
  Game.untowUnit(gun);                     // …and detach: crew hops out, gun unmanned
  const unmannedAtClick = !!gun._unmanned;
  Game.selection.clear(); Game.selection.add(gun.id);
  const pair = Game.getTowHoverPair(truck, true);   // the click path, immediately
  if (!pair) return { ok: false, unmannedAtClick, error: 'pair refused during crew walk-back' };
  Game.orderTowApproach(pair);
  const t0 = Game.gameClock, w0 = performance.now();
  return await new Promise(resolve => {
    const check = () => {
      if (gun._towed && gun._towedBy === truck.id) {
        return resolve({ ok: true, unmannedAtClick, secs: +(Game.gameClock - t0).toFixed(1) });
      }
      if (Game.gameClock - t0 > 30 || performance.now() - w0 > 45000) {
        return resolve({ ok: false, unmannedAtClick, gap: +Game.dist(truck.x, truck.z, gun.x, gun.z).toFixed(1),
          unmanned: !!gun._unmanned, ap: gun._towApproachGunId != null });
      }
      setTimeout(check, 200);
    };
    check();
  });
}).catch(err => ({ ok: false, error: 'evaluate: ' + err.message }));
results.push({ name: 'detach re-attach race', ...race });
console.log(`${race.ok ? 'PASS' : 'FAIL'}  detach re-attach race      ${race.ok ? race.secs + 's' : JSON.stringify(race)}`);

await browser.close();
const fails = results.filter(r => !r.ok);
const real = errors.filter(e => !/Failed to load resource|404/i.test(e));
if (real.length) console.log('runtime errors:\n' + real.join('\n'));
console.log(`TOW AT47 TEST: ${fails.length === 0 && !real.length ? 'PASS' : 'FAIL'} (${results.length - fails.length}/${results.length})`);
process.exit(fails.length === 0 && !real.length ? 0 : 1);

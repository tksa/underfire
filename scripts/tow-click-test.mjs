/**
 * REAL-INPUT towing contract: everything the other suites verify by calling
 * Game functions, this one verifies with actual mouse events through the real
 * input handler — left-click selects the gun, right-click on the truck starts
 * the hook-up, and the pair couples. Also proves left-click never attaches,
 * and the detach -> immediate re-attach race works from the click path.
 * Run: server on 8741, then: node scripts/tow-click-test.mjs
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
// Skip the GPU draw but keep world matrices honest: THREE only refreshes
// matrixWorld during render, and stale matrices silently break every
// screen-space raycast (unit picking) — the exact thing this test exists
// to exercise.
await page.evaluate(() => {
  Game.renderScene = () => { Game.scene.updateMatrixWorld(true); };
});
await page.waitForTimeout(1500);

// Stage: free truck at (30,60), manned 47mm ~9 units away, camera overhead.
const stage = await page.evaluate(() => {
  const gun = Game.units.find(u => u.kind === 'at47' && u.alive);
  const truck = Game.units.find(u => u.alive && u.supportType === 'transport');
  if (!gun || !truck) return { error: 'units missing' };
  if (gun._towed) Game.untowUnit(gun);
  const rider = Game.towedBy(truck);
  if (rider) { Game.untowUnit(rider); rider.x = truck.x + 30; rider.z = truck.z + 30; }
  for (const u of [gun, truck]) {
    u._towApproachGunId = null; u._towApproachTruckId = null; u._towProg = null;
    u.path = []; u.moving = false;
  }
  gun._unmanned = false; gun._crewAboard = 2; gun.deployed = true; gun._deployT = 0;
  truck.x = 30; truck.z = 60; truck.angle = Math.PI / 3; truck.currentSpeed = 0;
  gun.x = 37; gun.z = 66; gun.angle = 0;
  Game.cam.x = 33.5; Game.cam.z = 63;
  Game.selection.clear();
  return { ok: true };
});
if (stage.error) { console.log('FAIL staging: ' + stage.error); process.exit(1); }
await page.waitForTimeout(700);   // camera + mesh sync settle

const screenOf = (which) => page.evaluate((w) => {
  const u = w === 'gun'
    ? Game.units.find(x => x.kind === 'at47' && x.alive)
    : Game.units.find(x => x.alive && x.supportType === 'transport');
  const p = Game.worldToScreen(u.x, u.z, (u.y || 0) + 0.8);
  return { x: p.x, y: p.y };
}, which);

const results = [];
const report = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} ${extra}`);
};

// 1) Left-click the gun: selects it.
let p = await screenOf('gun');
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(400);
const sel1 = await page.evaluate(() => {
  const gun = Game.units.find(u => u.kind === 'at47' && u.alive);
  return { selected: Game.selection.has(gun.id), size: Game.selection.size };
});
report('left-click selects the 47mm', sel1.selected, JSON.stringify(sel1));

// 2) Left-click the truck: ONLY re-selects (never attaches).
p = await screenOf('truck');
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(400);
const sel2 = await page.evaluate(() => {
  const gun = Game.units.find(u => u.kind === 'at47' && u.alive);
  const truck = Game.units.find(u => u.alive && u.supportType === 'transport');
  return {
    truckSelected: Game.selection.has(truck.id),
    noApproach: gun._towApproachGunId == null && truck._towApproachGunId == null,
    notTowed: !gun._towed,
  };
});
report('left-click truck only selects', sel2.truckSelected && sel2.noApproach && sel2.notTowed, JSON.stringify(sel2));

// 3) Select gun again, RIGHT-click the truck: approach starts, gun couples.
p = await screenOf('gun');
await page.mouse.click(p.x, p.y);
await page.waitForTimeout(300);
p = await screenOf('truck');
await page.mouse.click(p.x, p.y, { button: 'right' });
await page.waitForTimeout(600);
const started = await page.evaluate(() => {
  const gun = Game.units.find(u => u.kind === 'at47' && u.alive);
  return gun._towApproachGunId != null || gun._towed;
});
report('right-click starts the hook-up', started);
const attach1 = await page.evaluate(async () => {
  const gun = Game.units.find(u => u.kind === 'at47' && u.alive);
  const truck = Game.units.find(u => u.alive && u.supportType === 'transport');
  const t0 = Game.gameClock, w0 = performance.now();
  return await new Promise(resolve => {
    const check = () => {
      if (gun._towed && gun._towedBy === truck.id) {
        return resolve({
          ok: true, secs: +(Game.gameClock - t0).toFixed(1),
          gap: +Game.dist(truck.x, truck.z, gun.x, gun.z).toFixed(2),
          trailFirst: Math.abs(Game.angleDiff(gun.angle, truck.angle + Math.PI)) < 0.01,
          crewAboard: (truck._passengers || []).length,
        });
      }
      if (Game.gameClock - t0 > 30 || performance.now() - w0 > 45000) {
        return resolve({ ok: false, gap: +Game.dist(truck.x, truck.z, gun.x, gun.z).toFixed(1),
          ap: gun._towApproachGunId != null, moving: gun.moving });
      }
      setTimeout(check, 200);
    };
    check();
  });
});
report('gun drives, rotates and attaches', attach1.ok === true
  && attach1.trailFirst === true && attach1.crewAboard >= 2, JSON.stringify(attach1));

// 4) Detach, then IMMEDIATELY right-click the truck again (crew still walking
//    back). The click path must re-form the pair and the gun must re-couple.
await page.evaluate(() => {
  const gun = Game.units.find(u => u.kind === 'at47' && u.alive);
  Game.untowUnit(gun);
  Game.selection.clear();
  Game.selection.add(gun.id);
});
p = await screenOf('truck');
await page.mouse.click(p.x, p.y, { button: 'right' });
await page.waitForTimeout(600);
const raceStarted = await page.evaluate(() => {
  const gun = Game.units.find(u => u.kind === 'at47' && u.alive);
  return { ap: gun._towApproachGunId != null || gun._towed, unmannedNow: !!gun._unmanned };
});
report('re-attach click lands during crew walk-back', raceStarted.ap, JSON.stringify(raceStarted));
const attach2 = await page.evaluate(async () => {
  const gun = Game.units.find(u => u.kind === 'at47' && u.alive);
  const truck = Game.units.find(u => u.alive && u.supportType === 'transport');
  const t0 = Game.gameClock, w0 = performance.now();
  return await new Promise(resolve => {
    const check = () => {
      if (gun._towed && gun._towedBy === truck.id) {
        return resolve({ ok: true, secs: +(Game.gameClock - t0).toFixed(1),
          crewAboard: (truck._passengers || []).length });
      }
      if (Game.gameClock - t0 > 30 || performance.now() - w0 > 45000) {
        return resolve({ ok: false, gap: +Game.dist(truck.x, truck.z, gun.x, gun.z).toFixed(1),
          unmanned: !!gun._unmanned, ap: gun._towApproachGunId != null });
      }
      setTimeout(check, 200);
    };
    check();
  });
});
report('detach then instant re-attach couples', attach2.ok === true, JSON.stringify(attach2));

await browser.close();
const fails = results.filter(r => !r.ok);
const real = errors.filter(e => !/Failed to load resource|404/i.test(e));
if (real.length) console.log('runtime errors:\n' + real.join('\n'));
console.log(`TOW CLICK TEST: ${fails.length === 0 && !real.length ? 'PASS' : 'FAIL'} (${results.length - fails.length}/${results.length})`);
process.exit(fails.length === 0 && !real.length ? 0 : 1);

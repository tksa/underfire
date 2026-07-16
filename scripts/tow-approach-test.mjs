/**
 * Tow approach contract: from EVERY side and range, ordering an AT gun to a
 * truck (or a truck to a gun) must end attached within a time budget.
 * Run: server on 8741, then: node scripts/tow-approach-test.mjs
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
// Software-GL renders this scene at ~1 fps, starving the sim loop. This is a
// logic test: skip rendering entirely (same approach as the profilers).
await page.evaluate(() => { Game.renderScene = () => {}; });
await page.waitForTimeout(1500);

// Free the 25mm from its spawn tow so we can stage scenarios with it.
await page.evaluate(() => {
  const gun = Game.units.find(u => u.kind === 'at25');
  if (gun._towed) Game.untowUnit(gun);
});
await page.waitForTimeout(2500);   // crew re-mans

const CASES = [];
for (const [name, dx, dz] of [
  ['behind', 0, 8], ['front', 0, -8], ['left', -8, 0], ['right', 8, 0],
  ['diag-NE', 7, -7], ['diag-SW', -7, 7], ['close-behind', 0, 4], ['far', -16, 12],
]) {
  CASES.push({ name: `gun→truck ${name}`, mover: 'gun', dx, dz });
  CASES.push({ name: `truck→gun ${name}`, mover: 'truck', dx, dz });
}

const results = [];
for (const c of CASES) {
  const r = await page.evaluate(async (c) => {
    const gun = Game.units.find(u => u.kind === 'at25');
    const truck = Game.units.find(u => u.supportType === 'transport' && !Game.towedBy(u));
    // Reset state and stage the geometry on open ground.
    if (gun._towed) Game.untowUnit(gun);
    gun._towApproachGunId = truck._towApproachGunId = null;
    gun._towApproachTruckId = truck._towApproachTruckId = null;
    const bx = 30, bz = 60;   // open field, world units
    truck.x = bx; truck.z = bz; truck.angle = Math.random() * Math.PI * 2;
    truck.path = []; truck.moving = false;
    gun.x = bx + c.dx; gun.z = bz + c.dz; gun.angle = Math.random() * Math.PI * 2;
    gun.path = []; gun.moving = false;
    gun._unmanned = false; gun._crewAboard = 2; gun.deployed = false; gun._deployT = 0;
    const mover = c.mover === 'gun' ? gun : truck;
    const pair = { mover, truck, gun };
    Game.orderTowApproach(pair);
    const t0 = Game.gameClock;
    const w0 = performance.now();
    return await new Promise(resolve => {
      const check = () => {
        try {
          if (gun._towed) return resolve({ ok: true, secs: +(Game.gameClock - t0).toFixed(1) });
          // Wall-clock cap so this can NEVER hang, even if the sim clock stalls.
          if (Game.gameClock - t0 > 25 || performance.now() - w0 > 35000) return resolve({
            ok: false, secs: +(Game.gameClock - t0).toFixed(1),
            gap: +Game.dist(truck.x, truck.z, gun.x, gun.z).toFixed(1),
            gunMoving: gun.moving, truckMoving: truck.moving, paused: !!Game._paused,
            deployed: gun.deployed, approach: gun._towApproachGunId != null || truck._towApproachGunId != null,
          });
        } catch (err) {
          return resolve({ ok: false, error: String(err && err.message || err) });
        }
        setTimeout(check, 300);
      };
      check();
    });
  }, c).catch(err => ({ ok: false, error: 'evaluate: ' + err.message }));
  results.push({ name: c.name, ...r });
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(24)} ${r.ok ? r.secs + 's' : JSON.stringify(r)}`);
  // detach for the next case
  await page.evaluate(() => {
    const gun = Game.units.find(u => u.kind === 'at25');
    if (gun._towed) Game.untowUnit(gun);
  });
  await page.waitForTimeout(1800);
}
await browser.close();
const fails = results.filter(r => !r.ok);
const real = errors.filter(e => !/Failed to load resource|404/i.test(e));
if (real.length) console.log('runtime errors:\n' + real.join('\n'));
console.log(`TOW APPROACH TEST: ${fails.length === 0 && !real.length ? 'PASS' : 'FAIL'} (${results.length - fails.length}/${results.length})`);
process.exit(fails.length === 0 && !real.length ? 0 : 1);

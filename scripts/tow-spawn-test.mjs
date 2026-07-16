/**
 * Dyle spawn towing contract: both AT guns start limbered behind the two
 * transports with their crews riding as passengers; detaching returns the
 * crew to the gun automatically. Run: server on 8741, then this script.
 */
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:8741';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(2500);
const domClick = (sel) => page.waitForFunction((s) => {
  const b = document.querySelector(s);
  if (!b || b.offsetParent === null) return false;
  b.click(); return true;
}, sel, { timeout: 60000, polling: 500 });
if (await page.locator('#btnEnterGame').count()) await domClick('#btnEnterGame').catch(() => {});
await domClick('#btnStartMission');
await page.waitForFunction(() => window.Game && Game.units && Game.units.length > 0 && !Game._paused,
  null, { timeout: 60000, polling: 500 });
await page.waitForTimeout(1500);   // let updateTowing snap guns to hitches

const spawn = await page.evaluate(() => {
  const guns = Game.units.filter(u => u.alive === false && u._towed || u._towed);
  const g25 = Game.units.find(u => u.kind === 'at25');
  const g47 = Game.units.find(u => u.kind === 'at47');
  const report = (g) => {
    if (!g) return { missing: true };
    const tower = g._towedBy != null ? Game.getUnitById(g._towedBy) : null;
    return {
      towed: !!g._towed,
      towerKind: tower ? tower.kind : null,
      towerPassengers: tower && tower._passengers ? tower._passengers.length : 0,
      unmanned: !!g._unmanned,
      hitchGap: tower ? +Game.dist(tower.x, tower.z, g.x, g.z).toFixed(2) : null,
      trailFirst: tower ? Math.abs(Game.angleDiff(g.angle, tower.angle + Math.PI)) < 0.01 : null,
    };
  };
  return { g25: report(g25), g47: report(g47), towedCount: guns.length };
});
console.log('spawn state:', JSON.stringify(spawn, null, 1));

const detach = await page.evaluate(() => {
  const g25 = Game.units.find(u => u.kind === 'at25');
  Game.untowUnit(g25);
  return { detached: !g25._towed };
});
await page.waitForTimeout(2500);   // manning loop absorbs the crew
const after = await page.evaluate(() => {
  const g25 = Game.units.find(u => u.kind === 'at25');
  const tower = Game.units.find(u => u.supportType === 'transport' && u._towedUnitId == null && u._passengers);
  return {
    towed: !!g25._towed,
    manned: !g25._unmanned,
    crewAboardGun: g25._crewAboard || 0,
  };
});
console.log('after detach:', JSON.stringify(after));

await browser.close();
const ok = spawn.g25.towed && spawn.g47.towed
  && spawn.g25.towerKind === 'transport' && spawn.g47.towerKind === 'transport'
  && spawn.g25.towerPassengers >= 2 && spawn.g47.towerPassengers >= 2
  && spawn.g25.trailFirst && spawn.g47.trailFirst
  && detach.detached && !after.towed && after.manned && after.crewAboardGun >= 2;
const real = errors.filter(e => !/Failed to load resource|404/i.test(e));
if (real.length) console.log('runtime errors:\n' + real.join('\n'));
console.log(ok && !real.length ? 'TOW SPAWN TEST: PASS' : 'TOW SPAWN TEST: FAIL');
process.exit(ok && !real.length ? 0 : 1);

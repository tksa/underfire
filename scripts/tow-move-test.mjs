/**
 * Slow-unit movement contract, from the at_fked.json recording: the 47mm —
 * the slowest unit in the game — must COMPLETE plain move orders. A flat
 * per-frame "stuck" threshold used to brand it permanently stuck while
 * walking normally and silently deleted its path mid-map. Also proves a
 * stale tow approach can never couple a gun the player has ordered away.
 * Run: server on 8741, then: node scripts/tow-move-test.mjs
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
await page.evaluate(() => { Game.renderScene = () => { Game.scene.updateMatrixWorld(true); }; });
await page.waitForTimeout(1500);

const results = [];
const report = (name, r) => {
  results.push({ name, ok: r.ok });
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${name.padEnd(36)} ${r.ok ? r.secs + 's' : JSON.stringify(r)}`);
};

const run = (name, cfg) => page.evaluate(async (cfg) => {
  const gun = Game.units.find(u => u.kind === 'at47' && u.alive);
  const truck = Game.units.find(u => u.alive && u.supportType === 'transport');
  if (gun._towed) Game.untowUnit(gun);
  const rider = Game.towedBy(truck);
  if (rider) { Game.untowUnit(rider); rider.x = truck.x + 30; rider.z = truck.z + 30; }
  for (const u of [gun, truck]) {
    u._towApproachGunId = null; u._towApproachTruckId = null; u._towProg = null;
    u.path = []; u.moving = false; u._stuckT = 0; u._stuckReplans = 0;
  }
  gun._unmanned = false; gun._crewAboard = 2; gun.deployed = true; gun._deployT = 0;
  truck.x = 31.913; truck.z = 33.228; truck.angle = -1.754; truck.currentSpeed = 0;
  gun.x = 36.06; gun.z = 29.97; gun.angle = 0;
  if (cfg.staleApproach) {
    // An old hook-up order the player then overrides with a plain move.
    Game.orderTowApproach({ mover: gun, truck, gun });
    await new Promise(r => setTimeout(r, 200));
  }
  Game.selection.clear(); Game.selection.add(gun.id);
  Game.issueCommand(cfg.gx, cfg.gz, 'move');
  const t0 = Game.gameClock, w0 = performance.now();
  return await new Promise(resolve => {
    const check = () => {
      const dGoal = Game.dist(gun.x, gun.z, cfg.gx, cfg.gz);
      if (gun._towed) return resolve({ ok: false, error: 'gun got coupled during a move order' });
      if (dGoal < 2.5) return resolve({ ok: true, secs: +(Game.gameClock - t0).toFixed(1) });
      if (Game.gameClock - t0 > 45 || performance.now() - w0 > 60000) {
        return resolve({ ok: false, dGoal: +dGoal.toFixed(1),
          pathLen: (gun.path || []).length, moving: gun.moving,
          pos: [+gun.x.toFixed(1), +gun.z.toFixed(1)],
          replans: gun._stuckReplans || 0 });
      }
      setTimeout(check, 200);
    };
    check();
  });
}, cfg);

// The recording's exact order: move 14u north, route passing ~5 from the truck.
report('recording scenario: long move', await run('a', { gx: 33.985, gz: 43.973 }));
// Same but with a stale tow approach the move order must fully cancel.
report('long move overrides stale hook-up', await run('b', { gx: 33.985, gz: 43.973, staleApproach: true }));
// Long haul in the open — no truck involvement at all.
report('open-field 25u haul', await run('c', { gx: 60, gz: 45 }));
// Skim directly past the truck's flank.
report('move skimming the truck', await run('d', { gx: 27, gz: 36 }));

await browser.close();
const fails = results.filter(r => !r.ok);
const real = errors.filter(e => !/Failed to load resource|404/i.test(e));
if (real.length) console.log('runtime errors:\n' + real.join('\n'));
console.log(`TOW MOVE TEST: ${fails.length === 0 && !real.length ? 'PASS' : 'FAIL'} (${results.length - fails.length}/${results.length})`);
process.exit(fails.length === 0 && !real.length ? 0 : 1);

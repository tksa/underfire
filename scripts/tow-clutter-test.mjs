/**
 * Tow approach under CLUTTER: the open-field matrix (tow-approach-test.mjs)
 * misses what real maps do — parked hulls beside the hook-up point, vehicle
 * walls across the route, and the packed spawn lanes. Every case here must
 * still end attached; on failure the full telemetry timeline is printed so
 * the stall state is visible. Run: server on 8741, then this script.
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

// Case 3 runs FIRST against the untouched spawn cluster, so stage it before
// anything gets torn down. Cases are functions returning {gun, truck, movers}.
const results = [];

async function runCase(name, mover, stage) {
  const r = await page.evaluate(async ({ mover, stage }) => {
    const gun = Game.units.find(u => u.kind === 'at25' && u.alive);
    const trucks = Game.units.filter(u => u.alive && u.supportType === 'transport');
    const spare = Game.units.filter(u => u.alive && u.team === Game.playerTeam
      && (Game.isTank(u.kind) || Game.isTruck(u.kind))
      && u.supportType !== 'transport').slice(0, 3);
    if (!gun || trucks.length < 2) return { ok: false, error: 'staging units missing' };
    const [t1, t2] = trucks;
    // Reset all participants.
    if (gun._towed) Game.untowUnit(gun);
    for (const u of [gun, t1, t2, ...spare]) {
      u._towApproachGunId = null; u._towApproachTruckId = null; u._towProg = null;
      u.path = []; u.moving = false; u.forcedTargetId = null; u.orderMode = 'move';
      if (Game.cancelQueuedPath) Game.cancelQueuedPath(u);
    }
    gun._unmanned = false; gun._crewAboard = 2; gun.deployed = false; gun._deployT = 0;
    const put = (u, x, z, angle) => {
      u.x = x; u.z = z; u.angle = angle; u.currentSpeed = 0;
      if (u.turretAngle != null) u.turretAngle = angle;
    };
    // ── Stage the scene ──
    const bx = 30, bz = 60;
    if (stage === 'adjacent-pair') {
      // Second transport parked EXACTLY where the approach goal lands
      // (2.9 behind the target truck) — the Dyle spawn row in miniature.
      put(t1, bx, bz, Math.PI / 2);
      put(t2, bx - Math.cos(t1.angle) * 3.1, bz - Math.sin(t1.angle) * 3.1, Math.PI / 2);
      put(gun, bx + 10, bz + 6, 0);
    } else if (stage === 'tank-wall') {
      // A rank of parked hulls straight across the gun->truck line.
      put(t1, bx, bz, 0);
      spare.forEach((v, i) => put(v, bx + 7, bz - 3.5 + i * 3.5, Math.PI / 2));
      put(gun, bx + 14, bz, Math.PI);
    } else if (stage === 'column') {
      // Trucks nose-to-tail; the goal behind t1 sits at t2's bonnet.
      put(t1, bx, bz, 0);
      put(t2, bx - 5.5, bz, 0);
      put(gun, bx - 12, bz + 2, 0);
    } else if (stage === 'spawn-cluster') {
      // Real spawn lanes untouched: send the gun in from just outside them.
      put(gun, Game.clamp(t1.x + 13, 2, Game.WORLD_W - 2),
        Game.clamp(t1.z + 9, 2, Game.WORLD_H - 2), 0);
    }
    const pair = mover === 'gun' ? { mover: gun, truck: t1, gun } : { mover: t1, truck: t1, gun };
    Game.orderTowApproach(pair);
    const t0 = Game.gameClock, w0 = performance.now();
    const tl = [];
    return await new Promise(resolve => {
      let nextSample = 0;
      const check = () => {
        try {
          const secs = Game.gameClock - t0;
          if (secs >= nextSample) {
            nextSample += 0.5;
            const m = pair.mover;
            tl.push({
              t: +secs.toFixed(1),
              gap: +Game.dist(t1.x, t1.z, gun.x, gun.z).toFixed(1),
              pl: (m.path || []).length, mv: !!m.moving,
              st: +(m.stopTimer || 0).toFixed(2), od: +(m.orderDelay || 0).toFixed(2),
              dep: !!gun.deployed, dT: +(gun._deployT || 0).toFixed(2),
              ap: gun._towApproachGunId != null || t1._towApproachGunId != null,
            });
          }
          if (gun._towed && gun._towedBy === t1.id) {
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
  }, { mover, stage }).catch(err => ({ ok: false, error: 'evaluate: ' + err.message }));
  results.push({ name, ...r });
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${name.padEnd(28)} ${r.ok ? r.secs + 's' : (r.error || '')}`);
  if (!r.ok && r.timeline) {
    for (const s of r.timeline) console.log('   ', JSON.stringify(s));
  }
  await page.evaluate(() => {
    const gun = Game.units.find(u => u.kind === 'at25' && u.alive);
    if (gun && gun._towed) Game.untowUnit(gun);
  });
  await page.waitForTimeout(1800);   // crew re-mans before the next case
}

// Real cluster first (before staging teleports the trucks out of it), both
// directions; then the synthetic clutter shapes.
await runCase('spawn-cluster gun→truck', 'gun', 'spawn-cluster');
await runCase('spawn-cluster truck→gun', 'truck', 'spawn-cluster');
await runCase('adjacent-pair gun→truck', 'gun', 'adjacent-pair');
await runCase('adjacent-pair truck→gun', 'truck', 'adjacent-pair');
await runCase('tank-wall gun→truck', 'gun', 'tank-wall');
await runCase('tank-wall truck→gun', 'truck', 'tank-wall');
await runCase('column gun→truck', 'gun', 'column');
await runCase('column truck→gun', 'truck', 'column');

// Input-level pairing: with a MESSY selection (gun + infantry, or several
// trucks), hovering the counterpart must still produce a tow pair — this is
// the path real clicks take, and it used to require exactly one selected unit.
const pairing = await page.evaluate(() => {
  const gun = Game.units.find(u => u.kind === 'at25' && u.alive);
  const trucks = Game.units.filter(u => u.alive && u.supportType === 'transport' && !Game.towedBy(u));
  const inf = Game.units.filter(u => u.alive && u.team === Game.playerTeam
    && Game.isFootInfantry(u) && u._inVehicle == null).slice(0, 2);
  if (!gun || !trucks.length || inf.length < 2) return { error: 'staging units missing' };
  if (gun._towed) Game.untowUnit(gun);
  gun._unmanned = false; gun._crewAboard = 2;
  Game.selection.clear();
  [gun, ...inf].forEach(u => Game.selection.add(u.id));
  const p1 = Game.getTowHoverPair(trucks[0]);
  Game.selection.clear();
  trucks.forEach(u => Game.selection.add(u.id));
  inf.forEach(u => Game.selection.add(u.id));
  const p2 = Game.getTowHoverPair(gun);
  Game.selection.clear();
  return {
    gunPlusInf: !!(p1 && p1.mover === p1.gun && p1.gun.id === gun.id),
    trucksPlusInf: !!(p2 && p2.mover === p2.truck && p2.gun.id === gun.id),
  };
});
const pairingOk = pairing.gunPlusInf && pairing.trucksPlusInf;
console.log(`${pairingOk ? 'PASS' : 'FAIL'}  multi-select pairing        ${JSON.stringify(pairing)}`);
results.push({ name: 'multi-select pairing', ok: pairingOk });

await browser.close();
const fails = results.filter(r => !r.ok);
const real = errors.filter(e => !/Failed to load resource|404/i.test(e));
if (real.length) console.log('runtime errors:\n' + real.join('\n'));
console.log(`TOW CLUTTER TEST: ${fails.length === 0 && !real.length ? 'PASS' : 'FAIL'} (${results.length - fails.length}/${results.length})`);
process.exit(fails.length === 0 && !real.length ? 0 : 1);

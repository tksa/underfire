/**
 * Nonvisual Dyle (default map) performance sampler: French assault on the town.
 *
 * Boots the default mission headlessly, doubles the French force, orders every
 * French unit to attack-move into the village, and samples frame gaps + hot-
 * function timings through the approach and the town fight. A profiler, not a
 * correctness test: it never inspects rendered output.
 *
 * Run: python3 -m http.server 8741 & node scripts/dyle-assault-profile.mjs
 * Optional: PROFILE_MS=8000 SMOKE_URL=http://localhost:8741 PROFILE_RENDER=1
 */
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:8741';
const SAMPLE_MS = Number(process.env.PROFILE_MS || 8000);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForTimeout(2500);
const domClick = (sel) => page.waitForFunction((s) => {
  const b = document.querySelector(s);
  if (!b || b.offsetParent === null) return false;
  b.click();
  return true;
}, sel, { timeout: 60_000, polling: 500 });
if (await page.locator('#btnEnterGame').count()) {
  await domClick('#btnEnterGame').catch(() => {});
}
await domClick('#btnStartMission');
await page.waitForFunction(() => window.Game && Game.units && Game.units.length > 0 && !Game._paused,
  null, { timeout: 120_000, polling: 500 });

await page.evaluate(profileRender => {
  Game.Audio?.init?.();
  // SwiftShader can consume several CPU cores and drown out simulation timing.
  // Rendering is opt-in for this sampler; the default profiles game-loop CPU.
  if (!profileRender) Game.renderScene = () => {};
  const perf = Game._perfProfile = { stats: {}, frames: [], longTasks: [], lastFrame: null };
  const wrap = name => {
    const original = Game[name];
    if (typeof original !== 'function' || original._perfWrapped) return;
    const wrapped = function (...args) {
      const start = performance.now();
      try { return original.apply(this, args); }
      finally {
        const elapsed = performance.now() - start;
        const stat = perf.stats[name] || (perf.stats[name] = { calls: 0, total: 0, max: 0 });
        stat.calls++;
        stat.total += elapsed;
        if (elapsed > stat.max) stat.max = elapsed;
      }
    };
    wrapped._perfWrapped = true;
    wrapped._perfOriginal = original;
    Game[name] = wrapped;
  };
  [
    'updateUnit', 'nearestEnemy', 'unitCanSee', 'lineOfSight', 'findPath',
    'updateSquadAI', 'updateAI', 'updateFogOfWar', 'updateCamouflage',
    'updateSupportUnits', 'updateTracers3D', 'spawnCrater', 'updateTracks3D',
    'syncUnitMeshes', 'updateHUD', 'updateMinimap', 'renderScene',
    'applyShot', 'computeCover', 'findCoverPosition', 'updateFieldGunCrew',
    'updateCarrierPassengers', 'updateReinforcements', 'segmentPassable',
    'updateGrass', 'updateSmokeClouds', 'updateFires', 'updateMines',
  ].forEach(wrap);
  const frame = now => {
    if (perf.lastFrame != null) perf.frames.push(now - perf.lastFrame);
    perf.lastFrame = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  if (window.PerformanceObserver) {
    try {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) perf.longTasks.push(entry.duration);
      });
      observer.observe({ type: 'longtask', buffered: true });
      perf.observer = observer;
    } catch (error) { /* unsupported in some headless builds */ }
  }
}, process.env.PROFILE_RENDER === '1');

const client = await context.newCDPSession(page);
await client.send('Performance.enable');

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};

const sample = async (label) => {
  await page.evaluate(() => {
    const perf = Game._perfProfile;
    perf.stats = {};
    perf.frames.length = 0;
    perf.longTasks.length = 0;
    perf.lastFrame = null;
  });
  await page.waitForTimeout(SAMPLE_MS);
  const state = await page.evaluate(() => {
    const perf = Game._perfProfile;
    const stats = Object.fromEntries(Object.entries(perf.stats).map(([name, stat]) => [name, {
      calls: stat.calls,
      totalMs: Number(stat.total.toFixed(2)),
      meanMs: Number((stat.total / stat.calls).toFixed(4)),
      maxMs: Number(stat.max.toFixed(2)),
    }]));
    return {
      stats,
      frames: [...perf.frames],
      longTasks: [...perf.longTasks],
      units: Game.units.length,
      alive: Game.units.filter(unit => unit.alive).length,
      fighting: Game.units.filter(unit => unit.alive && unit.fireTargetId != null).length,
      tracers: Game.tracers?.length || 0,
      tracks: Game.trackMarks?.length || 0,
      smoke: Game.smokeClouds?.length || 0,
      craters: Game.craters?.length || 0,
    };
  });
  const metrics = await client.send('Performance.getMetrics');
  const byName = Object.fromEntries(metrics.metrics.map(metric => [metric.name, metric.value]));
  const frames = state.frames;
  const top = Object.entries(state.stats)
    .sort((a, b) => b[1].totalMs - a[1].totalMs)
    .slice(0, 12);
  return {
    label,
    sampleMs: SAMPLE_MS,
    units: state.units,
    alive: state.alive,
    fighting: state.fighting,
    effects: { tracers: state.tracers, tracks: state.tracks, smoke: state.smoke, craters: state.craters },
    frames: {
      count: frames.length,
      meanMs: frames.length ? Number((frames.reduce((a, b) => a + b, 0) / frames.length).toFixed(2)) : 0,
      p95Ms: Number(percentile(frames, 0.95).toFixed(2)),
      maxMs: frames.length ? Number(Math.max(...frames).toFixed(2)) : 0,
      over50ms: frames.filter(value => value > 50).length,
    },
    longTasks: {
      count: state.longTasks.length,
      maxMs: state.longTasks.length ? Number(Math.max(...state.longTasks).toFixed(2)) : 0,
    },
    heapMiB: Number(((byName.JSHeapUsedSize || 0) / 1048576).toFixed(2)),
    top,
  };
};

const report = [];

// Phase 1: quiet baseline, nobody ordered anywhere.
report.push(await sample('idle-baseline'));

// Double the French force (late-game unit counts) and send EVERYONE at the
// village center with attack-move.
const staged = await page.evaluate(() => {
  const team = Game.playerTeam;
  const mine = Game.units.filter(u => u.alive && u.team === team && !u._inVehicle);
  // Clone the existing force composition at jittered positions: no roster
  // knowledge needed and the mix stays representative.
  let spawned = 0;
  for (const u of mine) {
    if (!Game.makeUnit || u.kind === 'horse') continue;
    const nx = Game.clamp(u.x + Game.rand(-6, 6), 2, Game.WORLD_W - 2);
    const nz = Game.clamp(u.z + Game.rand(-6, 6), 2, Game.WORLD_H - 2);
    if (Game.makeUnit(team, u.kind, nx, nz)) spawned++;
  }
  // Village center: mean of building footprints in world units (buildings are
  // stored in tile coords: tx/ty/tw/th). Fallback: map center.
  const bs = Game.buildings || [];
  let cx = Game.WORLD_W / 2, cz = Game.WORLD_H / 2;
  if (bs.length) {
    cx = bs.reduce((a, b) => a + (b.tx + (b.tw || 1) / 2) * Game.TILE, 0) / bs.length;
    cz = bs.reduce((a, b) => a + (b.ty + (b.th || 1) / 2) * Game.TILE, 0) / bs.length;
  }
  Game.selection.clear();
  for (const u of Game.units) {
    if (u.alive && u.team === team && !u._inVehicle) Game.selection.add(u.id);
  }
  Game.orderAttackMove(cx, cz);
  return { spawned, target: { x: +cx.toFixed(1), z: +cz.toFixed(1) }, selected: Game.selection.size };
});
console.log('staged assault:', JSON.stringify(staged));

// Phase 2: the approach march (pathing + column movement + first contacts).
report.push(await sample('advance'));

// Phase 3+4: the town fight, sampled twice as it develops.
await page.waitForTimeout(20_000);
report.push(await sample('assault'));
await page.waitForTimeout(10_000);
report.push(await sample('assault-sustained'));

await browser.close();

for (const phase of report) {
  console.log(`\n=== ${phase.label} (${phase.sampleMs} ms) ===`);
  console.log(`units ${phase.alive}/${phase.units} alive, ${phase.fighting} in combat · heap ${phase.heapMiB} MiB`);
  console.log(`effects: ${JSON.stringify(phase.effects)}`);
  console.log(`frames: mean ${phase.frames.meanMs} ms · p95 ${phase.frames.p95Ms} ms · max ${phase.frames.maxMs} ms · >50ms: ${phase.frames.over50ms}/${phase.frames.count}`);
  console.log(`long tasks: ${phase.longTasks.count} (max ${phase.longTasks.maxMs} ms)`);
  for (const [name, s] of phase.top) {
    console.log(`  ${name.padEnd(24)} total ${String(s.totalMs).padStart(8)} ms · ${String(s.calls).padStart(6)} calls · max ${s.maxMs} ms`);
  }
}
const real = errors.filter(e => !/Failed to load resource|status of 404|404 \(/i.test(e));
if (real.length) console.log('\nruntime errors:\n' + real.join('\n'));

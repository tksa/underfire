/**
 * Nonvisual Mokra performance sampler.
 *
 * It boots the scenario headlessly, records frame gaps and hot-function timing,
 * then advances the mission to each reinforcement threshold. This is a profiler,
 * not a gameplay correctness test: it never inspects rendered output.
 *
 * Run: python3 -m http.server 8741 & node scripts/mokra-performance-profile.mjs
 * Optional: PROFILE_MS=8000 SMOKE_URL=http://localhost:8741 node ...
 */
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:8741';
const SAMPLE_MS = Number(process.env.PROFILE_MS || 5000);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.addInitScript(() => localStorage.setItem('uf_mission', 'mokra'));
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => window.Game && Game.units && Game.units.length > 0,
  null, { timeout: 120_000, polling: 500 });

await page.evaluate(profileRender => {
  Game.Audio?.init?.();
  Game._paused = false;
  // SwiftShader can consume several CPU cores and drown out simulation timing.
  // Rendering is opt-in for this sampler; the default profiles game-loop CPU.
  if (!profileRender) Game.renderScene = () => {};
  const perf = Game._perfProfile = {
    stats: {}, frames: [], longTasks: [], lastFrame: null,
  };
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
    'updateSquadAI', 'updateFogOfWar', 'updateCamouflage', 'updateSupportUnits',
    'updateTracers3D', 'spawnCrater', 'updateTracks3D', 'syncUnitMeshes',
    'updateHUD', 'updateMinimap', 'renderScene',
    'spawnMokraGermanWave', '_sendMokraAttackers', '_processMokraRouteQueue',
    '_buildMokraVehicleRoute', '_recoverMokraVehicleRoute',
    'segmentPassable', 'updateMokraMission',
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

const sample = async (label, timer = null) => {
  await page.evaluate(value => {
    const perf = Game._perfProfile;
    perf.stats = {};
    perf.frames.length = 0;
    perf.longTasks.length = 0;
    perf.lastFrame = null;
    if (value != null) Game.missionState.timer = value;
  }, timer);
  const metricsBefore = await client.send('Performance.getMetrics');
  const beforeByName = Object.fromEntries(
    metricsBefore.metrics.map(metric => [metric.name, metric.value]));
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
      missionTimer: Game.missionState.timer,
      nextWave: Game.missionState.nextWave,
      units: Game.units.length,
      alive: Game.units.filter(unit => unit.alive).length,
      tracers: Game.tracers?.length || 0,
      tracks: Game.trackMarks?.length || 0,
      smoke: Game.smoke?.length || 0,
      fires: Game.fires?.length || 0,
      craters: Game.craters?.length || 0,
      terrainVertices: Game.terrainMesh?.geometry?.attributes?.position?.count || 0,
      audio: Game.Audio?.resourceStats || null,
      routeStats: Game._mokraRouteStats ? { ...Game._mokraRouteStats } : null,
      fluffyGrass: Game._fluffStats ? JSON.parse(JSON.stringify(Game._fluffStats)) : null,
      trackPerf: Game._trackPerf ? { ...Game._trackPerf } : null,
      craterPerf: Game._craterPerf ? { ...Game._craterPerf } : null,
      pendingCraterDeformations: Game._craterQueue?.length || 0,
      pendingMokraRoutes: Game._mokraRouteQueue?.length || 0,
    };
  });
  const metrics = await client.send('Performance.getMetrics');
  const byName = Object.fromEntries(metrics.metrics.map(metric => [metric.name, metric.value]));
  const frames = state.frames;
  return {
    label,
    sampleMs: SAMPLE_MS,
    missionTimer: Number(state.missionTimer.toFixed(2)),
    nextWave: state.nextWave,
    units: state.units,
    alive: state.alive,
    effects: {
      tracers: state.tracers, tracks: state.tracks, smoke: state.smoke,
      fires: state.fires, craters: state.craters,
    },
    terrainVertices: state.terrainVertices,
    audio: state.audio,
    routeStats: state.routeStats,
    fluffyGrass: state.fluffyGrass,
    trackPerf: state.trackPerf,
    craterPerf: state.craterPerf,
    pendingCraterDeformations: state.pendingCraterDeformations,
    pendingMokraRoutes: state.pendingMokraRoutes,
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
    taskTimeSeconds: Number(((byName.TaskDuration || 0) - (beforeByName.TaskDuration || 0)).toFixed(3)),
    stats: state.stats,
  };
};

const results = [];
results.push(await sample('opening'));
results.push(await sample('wave-1', 54.95));
results.push(await sample('wave-2', 124.95));
results.push(await sample('final-wave', 204.95));

await browser.close();
const optionalResourceWarnings = errors.filter(message =>
  /Failed to load resource|THREE\.GLTFLoader: Couldn't load texture blob:/i.test(message));
const realErrors = errors.filter(message => !optionalResourceWarnings.includes(message));
const regressions = [];
const finalResult = results[results.length - 1];
if (finalResult.routeStats?.vehicleAuthored !== 14) regressions.push('expected 14 authored Mokra vehicles');
if (finalResult.routeStats?.vehicleRouteFailures) regressions.push('one or more authored vehicle routes failed');
if (finalResult.routeStats?.vehicleRecoveryFailures) regressions.push('one or more vehicle recoveries failed');
if (finalResult.routeStats?.infantryRouteFailures) regressions.push('one or more infantry routes failed');
if (finalResult.pendingMokraRoutes) regressions.push('the infantry route queue did not drain');
if (finalResult.fluffyGrass?.budget != null
  && finalResult.fluffyGrass.total > finalResult.fluffyGrass.budget) {
  regressions.push('grass allocation exceeded its Mokra budget');
}
if ((finalResult.trackPerf?.peak || 0) > 240) regressions.push('track marks exceeded the hard cap');
if ((results[0].audio?.audioElements || 0) > 80) regressions.push('audio startup exceeded 80 elements');
for (const result of results) {
  if ((result.stats?.spawnMokraGermanWave?.maxMs || 0) > 50) {
    regressions.push(`${result.label} wave commit exceeded 50 ms`);
  }
  if ((result.stats?.findPath?.maxMs || 0) > 50) {
    regressions.push(`${result.label} contained a synchronous path call over 50 ms`);
  }
}
console.log(JSON.stringify({
  url: URL,
  errors: realErrors,
  regressions,
  optionalResourceWarningCount: optionalResourceWarnings.length,
  results,
}, null, 2));
if (realErrors.length || regressions.length) process.exitCode = 1;

/**
 * Battle observation: boot the default scenario, send the whole player force on
 * an attack-move to the objective, let the game run in real time and take
 * screenshots at intervals so a reviewer (or an AI assistant) can LOOK at the
 * battle, then print the movement recorder's per-unit jitter summary.
 *
 * This is a development aid, not a pass/fail test. The simulation is stepped by
 * hand at 30 Hz (game time runs at simulation speed) and a real frame is
 * rendered only for each screenshot.
 *
 * Run: python3 -m http.server 8741 & node scripts/observe-battle.mjs
 * Flags: --out <dir> (default /tmp/uf-observe), --seconds N (default 90),
 *        --every N (screenshot interval, default 15), --mission dyle|mokra
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const URL = process.env.SMOKE_URL || 'http://localhost:8741';
const OUT = opt('--out', '/tmp/uf-observe');
const SECONDS = +opt('--seconds', 90);
const EVERY = +opt('--every', 15);
const MISSION = opt('--mission', 'dyle');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
if (MISSION === 'mokra') await context.addInitScript(() => localStorage.setItem('uf_mission', 'mokra'));
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(2500);
const domClick = (sel) => page.waitForFunction((s) => {
  const b = document.querySelector(s); if (!b || b.offsetParent === null) return false;
  b.click(); return true;
}, sel, { timeout: 60000, polling: 500 });
if (await page.locator('#btnEnterGame').count()) await domClick('#btnEnterGame').catch(() => {});
await domClick('#btnStartMission');
await page.waitForFunction(() => window.Game && Game.units.length > 0 && !Game._paused, null, { timeout: 90000, polling: 500 });
await page.waitForTimeout(3000);

// Software GL renders a frame in ~0.5 s, so real time would give ~2 fps and
// almost no game time. Instead: stop the RAF loop, step Game.tick by hand at
// 30 Hz with rendering stubbed, and render for real only when a screenshot is
// due. Game time then advances at simulation speed, not screen speed.
await page.evaluate(() => {
  Game._obsRealRender = Game.renderScene;
  Game.renderScene = () => { Game.scene.updateMatrixWorld(true); };
  window.requestAnimationFrame = () => 0;          // Game.tick re-arms itself; make that a no-op
  Game._obsNow = performance.now();
  Game._obsStep = async (seconds) => {
    const steps = Math.round(seconds * 30);
    for (let i = 0; i < steps; i++) {
      Game._obsNow += 1000 / 30;
      Game.tick(Game._obsNow);
      if (i % 90 === 89) await new Promise(r => setTimeout(r, 0));
    }
  };
  Game._obsFrame = () => { Game.renderScene = Game._obsRealRender; Game._obsNow += 1000 / 30; Game.tick(Game._obsNow); Game.renderScene = () => { Game.scene.updateMatrixWorld(true); }; };
});

// Order the attack and start recording.
const setup = await page.evaluate(() => {
  const mine = Game.units.filter(u => u.alive && u.team === Game.playerTeam
    && !Game.isTruck(u.kind) && !['supply', 'fuel', 'transport', 'medic', 'mechanic'].includes(u.supportType)
    && !u._towed);
  Game.selection.clear();
  mine.forEach(u => Game.selection.add(u.id));
  const ox = Game.missionState.objectiveX, oz = Game.missionState.objectiveY;
  Game.issueCommand(ox, oz, 'attack', mine);
  if (Game.startMoveRec) Game.startMoveRec();
  // Camera on the advancing force.
  Game.selection.clear();
  return { ordered: mine.length, objective: [ox, oz], units: Game.units.filter(u => u.alive).length };
});
console.log('ordered', setup.ordered, 'units toward', setup.objective.map(v => v.toFixed(0)).join(','));

// Under-fire posture accounting, sampled every simulated half second: what do
// men who were shot at in the last six seconds actually do? (stance, cover,
// cover available within 20 u but not used, moving speed by stance)
await page.evaluate(() => {
  Game._obsFire = { samples: 0, stance: {}, inCover: 0, coverWithin20: 0, moving: 0, speedByStance: {}, runIdle: 0, standIdleUnderFire: 0 };
  const acc = Game._obsFire;
  const orig = Game._obsStep;
  Game._obsStep = async (seconds) => {
    const steps = Math.round(seconds * 30);
    for (let i = 0; i < steps; i++) {
      Game._obsNow += 1000 / 30;
      Game.tick(Game._obsNow);
      if (i % 15 === 14) {
        const now = Game.gameClock;
        for (const u of Game.units) {
          if (!u.alive || !Game.isFootInfantry(u) || u._garrisoned || u._inVehicle != null) continue;
          const moving = (u._dispSpeed || 0) > 0.3;
          if (u.stance === 'run' && !moving && !(u._evadeUntil > now) && !u.retreating) acc.runIdle++;
          const shotAt = (now - (u._threatTime || -1e9)) < 6 || (u.underFire || 0) > 0;
          if (!shotAt) continue;
          acc.samples++;
          acc.stance[u.stance] = (acc.stance[u.stance] || 0) + 1;
          const covered = (u.coverBonus || 0) >= (Game.COVER_MIN || 0.3);
          if (covered) acc.inCover++;
          else if (!moving) {
            const c = Game.findCoverPosition(u, u._lastThreat ? u._lastThreat.x : u.x + 1, u._lastThreat ? u._lastThreat.z : u.z, { rings: 8, crowd: false });
            if (c && Game.dist(u.x, u.z, c.x, c.z) < 20) acc.coverWithin20++;
          }
          if (moving) { acc.moving++; const k = u.stance; acc.speedByStance[k] = acc.speedByStance[k] || { n: 0, sum: 0 }; acc.speedByStance[k].n++; acc.speedByStance[k].sum += u._dispSpeed; }
          if (u.stance === 'stand' && !moving) acc.standIdleUnderFire++;
        }
      }
      if (i % 90 === 89) await new Promise(r => setTimeout(r, 0));
    }
  };
});

const shots = [];
for (let t = 0; t < SECONDS; t += EVERY) {
  await page.evaluate(async (secs) => { await Game._obsStep(secs); }, EVERY);
  const state = await page.evaluate(() => {
    // Follow the fight: centre on the friendly foot soldier most recently shot
    // at (fallback: centre of mass), zoomed in enough to read stances.
    const mine = Game.units.filter(u => u.alive && u.team === Game.playerTeam && !Game.isTruck(u.kind));
    const hot = mine.filter(u => Game.isFootInfantry(u) && u._threatTime).sort((a, b) => b._threatTime - a._threatTime)[0];
    if (hot) { Game.cam.x = hot.x; Game.cam.z = hot.z; }
    else if (mine.length) {
      Game.cam.x = mine.reduce((a, u) => a + u.x, 0) / mine.length;
      Game.cam.z = mine.reduce((a, u) => a + u.z, 0) / mine.length;
    }
    Game.cam.zoom = Game.cam.targetZoom = 9;
    const enemy = Game.units.filter(u => u.alive && u.team !== Game.playerTeam);
    const ais = {};
    enemy.forEach(u => { const k = u._ai || u.aiState || '?'; ais[k] = (ais[k] || 0) + 1; });
    const stances = {};
    Game.units.filter(u => u.alive && Game.isFootInfantry(u)).forEach(u => { stances[u.stance] = (stances[u.stance] || 0) + 1; });
    Game._obsFrame();                              // one real render for the screenshot
    return { clock: +Game.gameClock.toFixed(1), mine: mine.length, enemy: enemy.length, enemyAi: ais, stances,
      msgs: (Game.messages || []).slice(-3).map(m => m.text) };
  });
  const file = `${OUT}/${MISSION}-t${String(Math.round(t + EVERY)).padStart(3, '0')}.png`;
  await page.screenshot({ path: file });
  shots.push(file);
  console.log(`t=${state.clock}s mine=${state.mine} enemy=${state.enemy} enemyAi=${JSON.stringify(state.enemyAi)} stances=${JSON.stringify(state.stances)} msgs=${JSON.stringify(state.msgs)}`);
}

const fire = await page.evaluate(() => {
  const a = Game._obsFire; const pct = (n) => a.samples ? Math.round(100 * n / a.samples) + '%' : 'n/a';
  const spd = Object.fromEntries(Object.entries(a.speedByStance).map(([k, v]) => [k, +(v.sum / v.n).toFixed(2)]));
  return { samples: a.samples, stance: a.stance, inCover: pct(a.inCover), standingStillUnderFire: pct(a.standIdleUnderFire),
    notInCoverButCoverWithin20u: pct(a.coverWithin20), movingShare: pct(a.moving), meanSpeedByStance: spd, idleRunStanceSamples: a.runIdle };
});
console.log('\nunder fire (men shot at in the last 6 s, sampled 2 Hz):', JSON.stringify(fire));

const summary = await page.evaluate(() => {
  const raw = Game._moveRec ? Game._moveRec.slice() : [];
  const s = Game.stopMoveRec ? Game.stopMoveRec() : null;
  if (!s) return null;
  const worst = s.filter(r => r.frames > 30).sort((a, b) => (b.spinTurns - a.spinTurns) || (b.clipPerSec - a.clipPerSec)).slice(0, 12);
  // Two-second timeline of the worst spinner so the cause can be read off.
  const w = worst[0];
  const rows = w ? raw.filter(x => x.id === w.id) : [];
  const timeline = rows.filter((x, i) => i % 30 === 0).map(x =>
    `t=${String(x.t.toFixed(0)).padStart(4)} ${String(x.ai).padEnd(9)} ${String(x.st).padEnd(6)} pos ${x.x.toFixed(1)},${x.z.toFixed(1)} ang ${(x.a * 57.3).toFixed(0).padStart(4)} spd ${x.spd} dsp ${x.dsp} mv ${x.mv} wp ${x.waypointX != null ? x.waypointX.toFixed(0) + ',' + x.waypointZ.toFixed(0) : '-'}`);
  return { worst, timeline, worstLabel: w ? `${w.team} ${w.kind} #${w.id}` : '' };
});
if (summary) {
  console.log('\nworst movers (spinTurns = 360s on the spot, clipPerSec = anim thrash, wiggle = path/net):');
  for (const r of summary.worst) console.log(`  ${r.team.padEnd(7)} ${r.kind.padEnd(10)} spin ${r.spinTurns} clip/s ${r.clipPerSec} headRev ${r.headingReversals} wiggle ${r.wiggle} net ${r.net}`);
  console.log(`\ntimeline of the worst spinner (${summary.worstLabel}), every 2 s:`);
  console.log(summary.timeline.join('\n'));
}
await browser.close();
const real = errors.filter(e => !/Failed to load resource|404/i.test(e));
if (real.length) console.log('runtime errors:\n' + real.join('\n'));
console.log('screenshots:', shots.join(' '));

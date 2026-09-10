/**
 * Tank-approach drill: deterministic, headless movement-realism contract for
 * infantry and towed AT guns when enemy armor closes on them.
 *
 * The game is paused and stepped by hand at 30 Hz with a seeded RNG. A flat
 * grass arena is painted in the south-east of the map so terrain never varies
 * between runs. Each case spawns a squad (or a gun) and drives a KINEMATIC
 * enemy tank straight through their position, firing on the way. Every unit is
 * sampled each step and the traces are reduced to chaos metrics:
 *
 *   stanceFlipsPerSec   stance writes per second (run/crouch/prone flicker)
 *   headRevPerSec       heading reversals per second (whipping)
 *   spinTurns           full turns made while standing still
 *   replansPerSec       new path arrays assigned per second (re-plan churn)
 *   laneFrac            share of samples spent inside the tank's lane (<25u ahead)
 *   axisFleeFrac        share of moving samples heading along the tank's axis
 *   proneSkateFrac      share of prone samples displaced faster than a crawl
 *   deployToggles       gun deploy/limber flips while the tank is within 40u
 *   crushed             men run over
 *
 * Run: python3 -m http.server 8741 & node scripts/tank-approach-test.mjs
 *      SMOKE_URL=http://localhost:8749 node scripts/tank-approach-test.mjs --assert
 * Flags: --assert (fail on thresholds), --json <file> (write raw metrics),
 *        --case <substring> (run a subset), --seconds N (default 40),
 *        --dump <case>:<unitIndex> (print one unit's half-second timeline)
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const URL = process.env.SMOKE_URL || 'http://localhost:8741';
const SECONDS = +opt('--seconds', 40);
const ONLY = opt('--case', '');
const JSON_OUT = opt('--json', '');
const ASSERT = flag('--assert');
const DUMP = opt('--dump', '');          // e.g. --dump ai_open:4  -> 0.5 s timeline of one unit

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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
await page.evaluate(() => { Game._paused = true; Game.renderScene = () => { Game.scene.updateMatrixWorld(true); }; });
await page.waitForTimeout(800);

const CASES = [
  // Open field, no cover within reach: men must leave the tank's axis, go to
  // ground and stay put, not sprint down the barrel or flicker stance.
  { name: 'ai_open', side: 'ai', hedge: false, gun: false },
  // Hedge 15u on the flank: men should break for it once and fight from it.
  { name: 'ai_hedge', side: 'ai', hedge: true, gun: false },
  // Deployed AT gun with two crewmen behind it: the gun holds and fires, never
  // limbers into the tank's path, is not shoved around by its own infantry.
  { name: 'ai_atgun', side: 'ai', hedge: false, gun: true },
  // Player-controlled squads use uMod.takeCover instead of updateAI.
  { name: 'player_open', side: 'player', hedge: false, gun: false },
  { name: 'player_hedge', side: 'player', hedge: true, gun: false },
].filter(c => !ONLY || c.name.includes(ONLY));

const results = [];
for (const c of CASES) {
  const r = await page.evaluate(async (cfg) => {
    const DT = 1 / 30;
    const steps = Math.round(cfg.seconds / DT);
    // Seeded RNG so every run replays the same fight.
    let seed = 0x9e3779b9 ^ (cfg.name.length * 7919);
    Math.random = () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const T = Game.TILE;
    // Wipe the scenario: hide every existing unit and start from an empty roster.
    for (const u of Game.units) { u.alive = false; u._deathHandled = true; u._noRemnant = true; if (u.mesh) u.mesh.visible = false; }
    Game.units.length = 0; Game._unitByIdSize = -1; Game.selection.clear();
    Game.squads = {}; Game.thrownGrenades.length = 0; Game.tracers.length = 0;
    Game.smoke.length = 0; Game.craters.length = 0; Game.messages.length = 0;
    // Flat grass arena, SE quadrant, big enough that cover search never leaves it.
    Game.setPatch(45, 62, 55, 38, 'grass');
    const cx = 80.5 * T, cz = 82.5 * T;
    if (cfg.hedge) Game.setPatch(73, 77, 16, 1, 'hedge');   // 15u north of the squad, across the axis

    const aiTeam = Game.playerTeam === Game.TEAM.FRENCH ? Game.TEAM.GERMAN : Game.TEAM.FRENCH;
    const footTeam = cfg.side === 'ai' ? aiTeam : Game.playerTeam;
    const tankTeam = footTeam === Game.playerTeam ? aiTeam : Game.playerTeam;
    const tankKind = tankTeam === Game.TEAM.GERMAN ? 'panzer3' : 's35';
    const gunKind = footTeam === Game.TEAM.GERMAN ? 'pak36' : 'at_25mm';
    const stateOpts = cfg.side === 'ai'
      ? { aiState: 'hold', holdPoint: { x: cx, z: cz } }
      : { aiState: 'player' };

    const subjects = [];
    let gun = null;
    if (cfg.gun) {
      gun = Game.makeUnit(footTeam, gunKind, cx, cz, { ...stateOpts, angle: Math.PI, group: 'gunline' });
      gun.deployed = true; gun._deployT = 0;
      for (let i = 0; i < 2; i++) {
        const m = Game.makeUnit(footTeam, footTeam === Game.TEAM.GERMAN ? 'grenadier' : 'fusilier',
          cx + 3.5, cz + (i ? 1.6 : -1.6), { ...stateOpts, angle: Math.PI, group: 'gunline' });
        subjects.push(m);
      }
      subjects.push(gun);
    } else {
      const squad = Game.spawnSquad(footTeam, cx, cz, 'drill', { ...stateOpts, angle: Math.PI });
      subjects.push(...squad);
    }
    // Kinematic tank: driven by the harness, never by updateUnit. Starts west,
    // rolls east straight through the position, shoots on the way.
    const tank = Game.makeUnit(tankTeam, tankKind, cx - 62, cz, { aiState: 'player', angle: 0 });
    tank.ammo = -1; tank.holdFire = false;
    // The tank works the infantry over with its coaxial MG (suppressive, not
    // one-shot lethal like the HE main gun) so the drill observes behaviour
    // under fire rather than a massacre.
    tank.weaponKey = tankTeam === Game.TEAM.GERMAN ? 'mg34_bipod' : 'fm2429';
    const goal = { x: cx + 26, z: cz };
    const SPEED = 4.2, FIRE_EVERY = 0.9, FIRE_RANGE = 55;
    let nextFire = 2.0;

    const traces = new Map(subjects.map(u => [u.id, []]));
    const tankTrace = [];
    const foot = (u) => !u.deployable;
    const t0 = Game.gameClock;
    for (let i = 0; i < steps; i++) {
      Game.gameClock += DT;
      const dGoal = Game.dist(tank.x, tank.z, goal.x, goal.z);
      if (dGoal > 0.6) {
        tank.angle = Game.angleTo(tank.x, tank.z, goal.x, goal.z);
        const step = Math.min(SPEED * DT, dGoal);
        tank.x += Math.cos(tank.angle) * step; tank.z += Math.sin(tank.angle) * step;
        tank.currentSpeed = SPEED; tank.moving = true;
      } else { tank.currentSpeed = 0; tank.moving = false; }
      tank.turretAngle = tank.angle; tank.y = Game.getHeight(tank.x, tank.z);
      if (Game.gameClock - t0 >= nextFire) {
        nextFire += FIRE_EVERY;
        let best = null, bd = FIRE_RANGE * FIRE_RANGE;
        for (const u of subjects) {
          if (!u.alive) continue;
          const d = Game.distSq(tank.x, tank.z, u.x, u.z);
          if (d < bd && Game.lineOfSight(tank, u)) { bd = d; best = u; }
        }
        if (best) { tank.cooldownLeft = 0; Game.applyShot(tank, best); }
      }
      if (Game.updateSquadAI) Game.updateSquadAI(DT);
      if (cfg.side === 'player' && Game.updateFogOfWar) Game.updateFogOfWar(DT);
      for (const u of Game.units) { if (u !== tank && u.alive) Game.updateUnit(u, DT); }
      if (Game.updateThrownGrenades) Game.updateThrownGrenades(DT);
      if (Game.updateGunManning) Game.updateGunManning();
      tankTrace.push({ x: tank.x, z: tank.z, a: tank.angle, mv: tank.moving ? 1 : 0 });
      for (const u of subjects) {
        traces.get(u.id).push({
          alive: u.alive ? 1 : 0, x: u.x, z: u.z, a: u.angle || 0, st: u.stance || '',
          dsp: u._dispSpeed || 0, path: u.path, plen: u.path ? u.path.length : 0,
          dep: u.deployable ? (u.deployed ? 1 : 0) : -1, ai: u._ai || '', cov: u.coverBonus || 0,
          crushed: u._crushed ? 1 : 0,
        });
      }
      if (i % 120 === 0) await new Promise(r => setTimeout(r, 0));
    }

    // Reduce traces to metrics.
    const per = [];
    for (const u of subjects) {
      const s = traces.get(u.id);
      let flips = 0, headRev = 0, lastDa = 0, spinRot = 0, replans = 0, lane = 0, laneN = 0;
      let axisFlee = 0, moveN = 0, proneSkate = 0, proneN = 0, depTog = 0, aliveSteps = 0;
      let lastPath = s[0].path, pathLen = 0;
      for (let i = 1; i < s.length; i++) {
        if (!s[i].alive) break;
        aliveSteps++;
        const p = s[i - 1], q = s[i], tk = tankTrace[i];
        if (q.st !== p.st) flips++;
        const da = Game.angleDiff(p.a, q.a);
        const step = Math.hypot(q.x - p.x, q.z - p.z);
        pathLen += step;
        if (step < 0.02) spinRot += Math.abs(da);
        if (Math.abs(da) > 0.01) { if (lastDa !== 0 && Math.sign(da) !== Math.sign(lastDa)) headRev++; lastDa = da; }
        if (q.path && q.path !== lastPath && q.plen) replans++;
        lastPath = q.path;
        const rx = q.x - tk.x, rz = q.z - tk.z;
        const dTank = Math.hypot(rx, rz);
        const fx = Math.cos(tk.a), fz = Math.sin(tk.a);
        const ahead = rx * fx + rz * fz, lateral = Math.abs(rx * -fz + rz * fx);
        if (tk.mv && dTank < 30) {
          laneN++;
          if (ahead > -tank.size && ahead < 25 && lateral < tank.size * 1.5 + 1.0) lane++;
          if (step > 0.5 * DT * 3) {        // moving at >1.5 u/s
            moveN++;
            const mvx = (q.x - p.x) / step, mvz = (q.z - p.z) / step;
            if (mvx * fx + mvz * fz > 0.87) axisFlee++;
          }
        }
        if (q.st === 'prone') { proneN++; if (q.dsp > 1.4) proneSkate++; }
        if (q.dep >= 0 && p.dep >= 0 && q.dep !== p.dep && dTank < 40) depTog++;
      }
      const dur = Math.max(0.001, aliveSteps * DT);
      const last = s[Math.min(aliveSteps, s.length - 1)];
      per.push({
        id: u.id, kind: u.kind, aliveSecs: +dur.toFixed(1), alive: !!u.alive, crushed: !!u._crushed,
        stanceFlipsPerSec: +(flips / dur).toFixed(2),
        headRevPerSec: +(headRev / dur).toFixed(2),
        spinTurns: +(spinRot / (2 * Math.PI)).toFixed(2),
        replansPerSec: +(replans / dur).toFixed(2),
        laneFrac: +(laneN ? lane / laneN : 0).toFixed(2),
        axisFleeFrac: +(moveN ? axisFlee / moveN : 0).toFixed(2),
        proneSkateFrac: +(proneN ? proneSkate / proneN : 0).toFixed(2),
        deployToggles: depTog,
        net: +Math.hypot(last.x - s[0].x, last.z - s[0].z).toFixed(1),
        pathLen: +pathLen.toFixed(1),
        finalCover: +last.cov.toFixed(2), finalStance: last.st, finalAi: last.ai,
      });
    }
    // Optional half-second timeline of one unit for eyeballing a behaviour.
    let timeline = null;
    if (cfg.dump && cfg.dump.startsWith(cfg.name + ':')) {
      const idx = +cfg.dump.split(':')[1];
      const u = subjects[idx];
      if (u) {
        timeline = [];
        const s = traces.get(u.id);
        for (let i = 0; i < s.length; i += 15) {
          const q = s[i], tk = tankTrace[i];
          const rx = q.x - tk.x, rz = q.z - tk.z;
          const fx = Math.cos(tk.a), fz = Math.sin(tk.a);
          timeline.push(`t=${(i * DT).toFixed(1).padStart(5)} ${q.ai.padEnd(9)} ${q.st.padEnd(6)} `
            + `pos ${q.x.toFixed(1)},${q.z.toFixed(1)} ang ${(q.a * 57.3).toFixed(0).padStart(4)} `
            + `plen ${q.plen} dsp ${q.dsp.toFixed(1)} dTank ${Math.hypot(rx, rz).toFixed(1).padStart(5)} `
            + `ahead ${(rx * fx + rz * fz).toFixed(1).padStart(6)} lat ${(rx * -fz + rz * fx).toFixed(1).padStart(5)} cov ${q.cov.toFixed(2)}`);
        }
      }
    }
    const footRows = per.filter(r => !subjects.find(u => u.id === r.id).deployable);
    const mean = (k) => footRows.length ? +(footRows.reduce((a, r) => a + r[k], 0) / footRows.length).toFixed(2) : 0;
    const aliveSecsMean = mean('aliveSecs');
    const max = (k) => footRows.length ? Math.max(...footRows.map(r => r[k])) : 0;
    const gunRow = per.find(r => subjects.find(u => u.id === r.id).deployable) || null;
    return {
      name: cfg.name, seconds: cfg.seconds, units: per.length,
      alive: per.filter(r => r.alive).length, crushed: per.filter(r => r.crushed).length,
      aliveSecsMean,
      foot: {
        stanceFlipsPerSec: { mean: mean('stanceFlipsPerSec'), max: max('stanceFlipsPerSec') },
        headRevPerSec: { mean: mean('headRevPerSec'), max: max('headRevPerSec') },
        spinTurns: { mean: mean('spinTurns'), max: max('spinTurns') },
        replansPerSec: { mean: mean('replansPerSec'), max: max('replansPerSec') },
        laneFrac: { mean: mean('laneFrac'), max: max('laneFrac') },
        axisFleeFrac: { mean: mean('axisFleeFrac'), max: max('axisFleeFrac') },
        proneSkateFrac: { mean: mean('proneSkateFrac'), max: max('proneSkateFrac') },
        inCoverAtEnd: footRows.filter(r => r.alive && r.finalCover > 0.32).length,
      },
      gun: gunRow ? {
        deployToggles: gunRow.deployToggles, net: gunRow.net, alive: gunRow.alive,
        stanceFlipsPerSec: gunRow.stanceFlipsPerSec, finalAi: gunRow.finalAi,
      } : null,
      per, timeline,
    };
  }, { ...c, seconds: SECONDS, dump: DUMP });
  if (r.timeline) console.log(`-- timeline ${DUMP} --\n` + r.timeline.join('\n'));
  results.push(r);
  const f = r.foot;
  console.log(`\n== ${r.name}  (${r.units} units, alive ${r.alive}, crushed ${r.crushed}, mean survival ${r.aliveSecsMean}s)`);
  console.log(`   stanceFlips/s mean ${f.stanceFlipsPerSec.mean} max ${f.stanceFlipsPerSec.max} | headRev/s mean ${f.headRevPerSec.mean} max ${f.headRevPerSec.max} | spinTurns max ${f.spinTurns.max}`);
  console.log(`   replans/s mean ${f.replansPerSec.mean} max ${f.replansPerSec.max} | laneFrac mean ${f.laneFrac.mean} | axisFlee mean ${f.axisFleeFrac.mean} | proneSkate mean ${f.proneSkateFrac.mean} | inCoverAtEnd ${f.inCoverAtEnd}`);
  if (r.gun) console.log(`   gun: deployToggles ${r.gun.deployToggles} net ${r.gun.net}u alive ${r.gun.alive} stanceFlips/s ${r.gun.stanceFlipsPerSec} ai ${r.gun.finalAi}`);
}

await browser.close();
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(results, null, 1));

// Thresholds: what "not chaotic" means for this drill. Tuned against the
// post-fix runs; the pre-fix baseline is recorded in docs/WIP_2026-09-10_movement_neural.md.
const LIMITS = {
  stanceFlipsMean: 0.45, stanceFlipsMax: 0.8,   // a two-man crew under direct MG fire legitimately changes posture every ~2.5 s
  headRevMean: 1.2, spinTurnsMax: 1.6,    // evade turn + tracking a passing tank + turning back can total 1.5 turns
  replansMean: 0.5, laneMean: 0.25, axisFleeMean: 0.35, proneSkateMean: 0.05,
  gunDeployToggles: 0, gunNet: 1.5,
};
let fails = [];
if (ASSERT) {
  for (const r of results) {
    const f = r.foot;
    const bad = (label, v, lim) => { if (v > lim) fails.push(`${r.name}: ${label} ${v} > ${lim}`); };
    bad('stanceFlips/s mean', f.stanceFlipsPerSec.mean, LIMITS.stanceFlipsMean);
    bad('stanceFlips/s max', f.stanceFlipsPerSec.max, LIMITS.stanceFlipsMax);
    bad('headRev/s mean', f.headRevPerSec.mean, LIMITS.headRevMean);
    bad('spinTurns max', f.spinTurns.max, LIMITS.spinTurnsMax);
    bad('replans/s mean', f.replansPerSec.mean, LIMITS.replansMean);
    bad('laneFrac mean', f.laneFrac.mean, LIMITS.laneMean);
    bad('axisFlee mean', f.axisFleeFrac.mean, LIMITS.axisFleeMean);
    bad('proneSkate mean', f.proneSkateFrac.mean, LIMITS.proneSkateMean);
    if (r.gun) {
      bad('gun deployToggles', r.gun.deployToggles, LIMITS.gunDeployToggles);
      bad('gun net displacement', r.gun.net, LIMITS.gunNet);
    }
    if (r.name.includes('hedge') && f.inCoverAtEnd < Math.max(1, Math.floor(r.alive * 0.4))) {
      fails.push(`${r.name}: only ${f.inCoverAtEnd}/${r.alive} survivors in cover`);
    }
  }
}
const real = errors.filter(e => !/Failed to load resource|404/i.test(e));
if (real.length) console.log('runtime errors:\n' + real.join('\n'));
if (fails.length) console.log('THRESHOLD FAILURES:\n  ' + fails.join('\n  '));
console.log(`\nTANK APPROACH TEST: ${fails.length === 0 && !real.length ? 'PASS' : 'FAIL'}${ASSERT ? '' : ' (baseline mode, no assertions)'}`);
process.exit(fails.length === 0 && !real.length ? 0 : 1);

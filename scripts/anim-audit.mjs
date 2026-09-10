/**
 * Infantry animation audit (development aid, prints a report; --assert makes it
 * a pass/fail contract). Boots the default battle, sends the player force on an
 * attack-move, steps the simulation at 30 Hz with rendering stubbed (the mixers
 * still run, so clip state is real) and records, per skinned soldier per frame,
 * the active clip, stance, alive flag and measured speed. Reports:
 *
 *   clipSwitchesPerSec  per living soldier (mean / max)
 *   pingPong            A->B->A alternations inside 1.5 s (the to/from jitter)
 *   standingCorpses     dead soldiers whose corpse pose is still upright: the
 *                       torso bone sits above 55% of its standing height, or the
 *                       active clip is not a death / lying clip
 *   deathClipEndHeights torso height at the END of each death clip variant, as a
 *                       fraction of the idle (standing) torso height, so a death
 *                       window that stops short of the ground is visible
 *   bones               the rig's bone names (once), for clip authoring
 *
 * Run: python3 -m http.server 8741 & node scripts/anim-audit.mjs [--seconds 120] [--assert]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const URL = process.env.SMOKE_URL || 'http://localhost:8741';
const SECONDS = +opt('--seconds', 120);
const ASSERT = args.includes('--assert');

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
// Wait for the shared soldier model on most infantry before measuring.
await page.waitForFunction(() => {
  const inf = Game.units.filter(u => u.alive && Game.isFootInfantry(u));
  const rigged = inf.filter(u => u.mesh && u.mesh.userData.isSoldier && u.mesh.userData.actions);
  return inf.length > 0 && rigged.length >= inf.length * 0.8;
}, null, { timeout: 120000, polling: 500 }).catch(() => {});
await page.waitForTimeout(1000);

const report = await page.evaluate(async (seconds) => {
  const DT = 1 / 30;
  // Stop the RAF loop; step Game.tick by hand (mixers are updated inside
  // syncUnitMeshes -> _updateModelAnimation, which runs even with render stubbed).
  Game.renderScene = () => { Game.scene.updateMatrixWorld(true); };
  window.requestAnimationFrame = () => 0;
  let now = performance.now();
  const step = () => { now += 1000 / 30; Game.tick(now); };

  // Rig introspection on one rigged soldier.
  const rigged = Game.units.find(u => u.alive && u.mesh && u.mesh.userData.isSoldier && u.mesh.userData.actions);
  const bones = [];
  let torsoName = null;
  if (rigged) {
    rigged.mesh.userData.soldierModel.traverse(o => { if (o.isBone) bones.push(o.name); });
    torsoName = bones.find(n => /torso/i.test(n)) || bones.find(n => /spine|chest/i.test(n)) || null;
  }
  const torsoHeight = (u) => {
    const ud = u.mesh && u.mesh.userData;
    if (!ud || !ud.soldierModel || !torsoName) return null;
    let bone = null; ud.soldierModel.traverse(o => { if (!bone && o.isBone && o.name === torsoName) bone = o; });
    if (!bone) return null;
    u.mesh.updateMatrixWorld(true);
    const p = new Game.THREE.Vector3(); bone.getWorldPosition(p);
    return p.y - (u.mesh.position.y || 0);
  };
  // Standing torso height reference: pose one rigged soldier in 'idle' at t=0.
  let standingTorso = null;
  const deathEnds = {};
  if (rigged && torsoName) {
    const ud = rigged.mesh.userData;
    const saveClip = ud._activeClip;
    const sample = (name, atEnd) => {
      Object.values(ud.actions).forEach(a => { a.stop(); a.enabled = false; });
      const a = ud.actions[name]; if (!a) return null;
      a.enabled = true; a.setEffectiveWeight(1); a.setEffectiveTimeScale(1); a.reset(); a.play();
      a.time = atEnd ? Math.max(0, a.getClip().duration - 0.001) : 0;
      ud.mixer.update(0);
      return torsoHeight(rigged);
    };
    standingTorso = sample('idle', false);
    for (const n of ['death', 'death2', 'death3', 'death4', 'fire_prone', 'crouch', 'fire_crouch', 'sit', 'fire_stand', 'walk']) {
      if (ud.actions[n]) deathEnds[n] = +((sample(n, true) || 0) / (standingTorso || 1)).toFixed(2);
    }
    // restore something sane
    Object.values(ud.actions).forEach(a => { a.stop(); a.enabled = false; });
    ud._activeClip = null;
    if (saveClip && ud.actions[saveClip]) Game._playClip(rigged, saveClip, 0);
  }

  // Order the attack so a fight develops.
  const mine = Game.units.filter(u => u.alive && u.team === Game.playerTeam && !Game.isTruck(u.kind)
    && !['supply', 'fuel', 'transport', 'medic', 'mechanic'].includes(u.supportType) && !u._towed);
  Game.selection.clear(); mine.forEach(u => Game.selection.add(u.id));
  Game.issueCommand(Game.missionState.objectiveX, Game.missionState.objectiveY, 'attack', mine);
  Game.selection.clear();

  const traces = new Map();   // id -> { clips: [[t, clip]], stance: [], dead: t|null }
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    step();
    const t = i * DT;
    for (const u of Game.units) {
      const ud = u.mesh && u.mesh.userData;
      if (!ud || !ud.isSoldier || !ud.actions) continue;
      let tr = traces.get(u.id);
      if (!tr) { tr = { kind: u.kind, team: u.team, clips: [], lastClip: undefined, deadAt: null, aliveFrames: 0 }; traces.set(u.id, tr); }
      if (!u.alive) { if (tr.deadAt == null) tr.deadAt = t; continue; }
      tr.aliveFrames++;
      const c = ud._activeClip || '';
      if (c !== tr.lastClip) { tr.clips.push([t, c]); tr.lastClip = c; }
    }
    if (i % 90 === 89) await new Promise(r => setTimeout(r, 0));
  }

  // Reduce.
  const perUnit = [];
  let pingPongTotal = 0, switchTotal = 0, aliveSecTotal = 0;
  const pairs = {};
  for (const [id, tr] of traces) {
    const aliveSec = tr.aliveFrames * DT;
    if (aliveSec < 5) continue;
    const sw = Math.max(0, tr.clips.length - 1);
    let pp = 0;
    for (let k = 2; k < tr.clips.length; k++) {
      const [tA, a] = tr.clips[k - 2], [, b] = tr.clips[k - 1], [tC, c] = tr.clips[k];
      if (a === c && a !== b && (tC - tA) < 1.5) { pp++; const key = [a, b].sort().join('<->'); pairs[key] = (pairs[key] || 0) + 1; }
    }
    switchTotal += sw; pingPongTotal += pp; aliveSecTotal += aliveSec;
    perUnit.push({ id, kind: tr.kind, team: tr.team, aliveSec: +aliveSec.toFixed(1), switchesPerSec: +(sw / aliveSec).toFixed(2), pingPong: pp,
      sequence: tr.clips.slice(-8).map(([t, c]) => `${t.toFixed(1)}:${c}`).join(' ') });
  }
  perUnit.sort((a, b) => b.pingPong - a.pingPong || b.switchesPerSec - a.switchesPerSec);

  // Corpses: pose check.
  const corpses = [];
  for (const u of Game.units) {
    const ud = u.mesh && u.mesh.userData;
    if (u.alive || !ud || !ud.isSoldier || !ud.actions || u._noRemnant) continue;
    const clip = ud._activeClip || '';
    const act = ud.actions[clip];
    const h = torsoHeight(u);
    const rel = (h != null && standingTorso) ? +(h / standingTorso).toFixed(2) : null;
    const lying = /^death|fire_prone|crawl|prone_idle/.test(clip);
    const finished = !act ? null : (act.paused || (act.getClip().duration - act.time) < 0.05);
    corpses.push({ id: u.id, kind: u.kind, clip, lying, finished, torsoRel: rel, rotZ: +(u.mesh.rotation.z || 0).toFixed(2),
      deathHandled: !!u._deathHandled, remaining: +(u._deathAnimRemaining || 0).toFixed(2) });
  }
  const standingCorpses = corpses.filter(c => !c.lying || (c.torsoRel != null && c.torsoRel > 0.55 && Math.abs(c.rotZ) < 1));
  return {
    soldiersTracked: traces.size, aliveSecTotal: +aliveSecTotal.toFixed(0),
    switchesPerSecMean: +(switchTotal / Math.max(1, aliveSecTotal)).toFixed(3),
    pingPongTotal, pingPongPairs: pairs,
    worst: perUnit.slice(0, 8),
    corpses: corpses.length, standingCorpses: standingCorpses.length, standingCorpseSamples: standingCorpses.slice(0, 6),
    corpseClips: corpses.reduce((m, c) => { m[c.clip] = (m[c.clip] || 0) + 1; return m; }, {}),
    standingTorso: standingTorso != null ? +standingTorso.toFixed(3) : null, deathClipEndHeights: deathEnds, torsoName, bones,
  };
}, SECONDS);
await browser.close();

const real = errors.filter(e => !/Failed to load resource|404/i.test(e));
const { bones, ...rest } = report;
console.log(JSON.stringify(rest, null, 1));
console.log('bones:', bones.join(', '));
const fails = [];
if (report.standingCorpses > 0) fails.push(`${report.standingCorpses}/${report.corpses} corpses still upright`);
if (report.pingPongTotal > report.soldiersTracked * 0.5) fails.push(`ping-pong alternations ${report.pingPongTotal} for ${report.soldiersTracked} soldiers`);
if (report.switchesPerSecMean > 0.25) fails.push(`clip switches ${report.switchesPerSecMean}/s mean`);
for (const [n, h] of Object.entries(report.deathClipEndHeights)) if (/^death/.test(n) && h > 0.55) fails.push(`${n} ends with torso at ${h} of standing height`);
if (real.length) fails.push('runtime errors: ' + real.join(' | '));
if (fails.length) console.log('FINDINGS:\n  ' + fails.join('\n  '));
console.log(`ANIM AUDIT: ${fails.length ? (ASSERT ? 'FAIL' : 'findings above') : 'PASS'}`);
if (ASSERT && fails.length) process.exit(1);

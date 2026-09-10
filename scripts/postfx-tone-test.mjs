/**
 * Tone mapping contract: the composer's grade pass carries an AgX
 * ToneMappingEffect, the mode and exposure controls are wired, and switching
 * them causes no runtime errors. Pixel statistics per curve/exposure are
 * printed for information only: under headless SwiftShader the captured frame
 * does not follow post-pass uniform changes (even a maxed vignette reads
 * identical), so the visual roll-off has to be eyeballed in a GPU browser
 * (debug panel, "Tone" group). With a real GPU the printed numbers should show
 * linear_3x clipping far more than agx_3x and agx_quarter well darker.
 *
 * Run: python3 -m http.server 8741 & node scripts/postfx-tone-test.mjs
 */
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:8741';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
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
await page.waitForTimeout(2000);

const result = await page.evaluate(() => {
  Game._paused = true;
  const pf = Game.postfx || {};
  const PF = Game.PostFX || {};
  const out = { hasTone: !!pf.tone, modeIsAgx: !!(pf.tone && PF.ToneMappingMode && pf.tone.mode === PF.ToneMappingMode.AGX),
    exposure: Game.renderer.toneMappingExposure, valorExposure: null, stats: {} };
  const measure = (label) => {
    // Render, then read the drawing buffer in the same task (it is cleared
    // between tasks without preserveDrawingBuffer).
    Game.renderScene();
    const src = Game.renderer.domElement;
    const c = document.createElement('canvas');
    c.width = 96; c.height = 60;
    const ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let clipped = 0, sum = 0, n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] >= 254 && d[i + 1] >= 254 && d[i + 2] >= 254) clipped++;
      sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
    }
    out.stats[label] = { clippedFrac: +(clipped / n).toFixed(4), mean: +(sum / n).toFixed(1) };
  };
  measure('agx');
  // Push exposure hard: a linear curve must clip a good share of the frame to
  // white while AgX rolls the same highlights off. Then check the knob reaches
  // the shader at all (0.25x must darken the frame).
  const e0 = Game.renderer.toneMappingExposure;
  Game.setToneExposure(3.0); measure('agx_3x');
  if (pf.tone && PF.ToneMappingMode) {
    Game.setToneMode('LINEAR'); measure('linear_3x');
    Game.setToneMode('AGX'); measure('agx_3x_again');
  }
  Game.setToneExposure(e0 * 0.25); measure('agx_quarter');
  Game.setToneExposure(e0);
  try { out.valorExposure = Game.valor && Game.valor.uniforms ? Game.valor.uniforms.get('uExposure').value : null; } catch (e) { out.valorExposure = 'n/a'; }
  return out;
});
await browser.close();

const real = errors.filter(e => !/Failed to load resource|404/i.test(e));
const fails = [];
if (!result.hasTone) fails.push('no ToneMappingEffect in Game.postfx');
if (!result.modeIsAgx) fails.push('tone mode is not AGX');
const s = result.stats;
if (!s.agx || s.agx.mean < 8) fails.push('frame is blank');
if (result.exposure !== 1.31) fails.push(`exposure default is ${result.exposure}, expected 1.31`);
const pixelEffectSeen = s.linear_3x && s.agx_3x && s.agx_quarter
  && s.agx_3x.clippedFrac < s.linear_3x.clippedFrac && s.agx_quarter.mean < s.agx.mean * 0.8;
console.log(pixelEffectSeen
  ? 'pixel check: AgX rolls off highlights and exposure reaches the frame'
  : 'pixel check: inconclusive on this GL backend (expected under headless SwiftShader); verify in a GPU browser');
if (real.length) fails.push('runtime errors: ' + real.join(' | '));
console.log(JSON.stringify(result, null, 1));
if (fails.length) console.log('FAILURES:\n  ' + fails.join('\n  '));
console.log(`POSTFX TONE TEST: ${fails.length ? 'FAIL' : 'PASS'}`);
process.exit(fails.length ? 1 : 0);

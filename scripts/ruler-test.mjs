/**
 * Smoke test for the debug ruler (js/ruler.js).
 * Boots the game, enables the ruler from the debug panel button, places a
 * measurement with two real mouse clicks, and asserts the pair, label text
 * and scene visuals. Run:
 *   python3 -m http.server 8741 & node scripts/ruler-test.mjs
 */
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:8741';
const browser = await chromium.launch();
const errors = [];

try {
  const context = await browser.newContext({ viewport: { width: 900, height: 600 } });
  await context.addInitScript(() => localStorage.setItem('uf_mission', 'mokra'));
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  // welcome gate -> main menu -> start mission (menu overlays swallow map clicks)
  await page.waitForSelector('#btnEnterGame', { timeout: 120_000 });
  await page.click('#btnEnterGame');
  await page.waitForSelector('#btnStartMission', { timeout: 120_000 });
  await page.click('#btnStartMission');
  await page.waitForFunction(() => window.Game
    && typeof Game.toggleRuler === 'function'
    && typeof Game.rulerClickAt === 'function'
    && typeof Game.updateRuler === 'function'
    && document.getElementById('mainMenu')?.classList.contains('hidden')
    && Game.units?.some(u => u.alive),
  undefined, { timeout: 120_000, polling: 250 });

  // debug panel button exists and toggles (panel is hidden until ` — click via JS)
  const btnText = await page.evaluate(() => {
    const btn = document.getElementById('dbgRuler');
    if (!btn) return null;
    btn.click();
    return btn.textContent;
  });
  if (btnText !== 'Ruler: ON') throw new Error(`toggle failed, button says: ${btnText}`);

  // two real left clicks on the map -> one measured span
  await page.mouse.click(400, 300);
  await page.waitForTimeout(120);
  const pending = await page.evaluate(() => !!Game._ruler.pending);
  if (!pending) throw new Error('first click did not set pending point');
  await page.mouse.click(560, 340);
  await page.waitForTimeout(120);

  const state = await page.evaluate(() => ({
    pairs: Game._ruler.pairs.length,
    pending: !!Game._ruler.pending,
    labels: [...document.querySelectorAll('.ruler-label')].map(el => el.textContent),
    group: !!Game.scene.getObjectByName('debug-ruler'),
    soldierHeight: Game.SOLDIER_HEIGHT,
  }));
  if (state.pairs !== 1) throw new Error(`expected 1 pair, got ${state.pairs}`);
  if (state.pending) throw new Error('pending not cleared after second click');
  if (!state.group) throw new Error('debug-ruler group missing from scene');
  if (!state.labels.some(t => / u · [\d.]+ soldiers · [\d.]+ tiles/.test(t))) {
    throw new Error(`label text wrong: ${JSON.stringify(state.labels)}`);
  }

  // span length sanity: pixel clicks must map to a positive world distance
  const len = await page.evaluate(() => {
    const [a, b] = Game._ruler.pairs[0];
    return Game.dist(a.x, a.z, b.x, b.z);
  });
  if (!(len > 0.5)) throw new Error(`suspicious span length: ${len}`);

  // Esc exits the ruler and wipes visuals
  await page.keyboard.press('Escape');
  await page.waitForTimeout(60);
  const off = await page.evaluate(() => !Game._ruler.on
    && !Game.scene.getObjectByName('debug-ruler')
    && document.querySelectorAll('.ruler-label').length === 0);
  if (!off) throw new Error('Esc did not exit/clean up the ruler');

  await page.screenshot({ path: 'scripts/ruler-test.png' });
  console.log('PASS', JSON.stringify({ len: +len.toFixed(2), label: state.labels[0], soldierHeight: state.soldierHeight }));
  if (errors.length) console.log('page errors (non-fatal):', errors.slice(0, 5));
} finally {
  await browser.close();
}

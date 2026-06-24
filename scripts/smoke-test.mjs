/**
 * Under Fire — headless boot smoke test (used by CI).
 * Loads the game, enters, starts the scenario, and fails if the page throws
 * real errors or no units spawn. Benign 404s for optional assets are ignored.
 *
 * Run locally:  python3 -m http.server 8741 &  node scripts/smoke-test.mjs
 */
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:8741';
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(2500); // let the scene/assets boot

await page.click('#btnEnterGame').catch(() => {});   // welcome gate (if present)
await page.click('#btnStartMission');
await page.waitForTimeout(2500);

const info = await page.evaluate(() => ({
  units: (window.Game && window.Game.units ? window.Game.units.length : 0),
  paused: window.Game ? window.Game._paused : true,
}));

await browser.close();

// Ignore optional-asset 404s; everything else is a real failure.
const real = errors.filter((e) => !/Failed to load resource|status of 404|404 \(/i.test(e));

let ok = true;
if (info.units < 1) { console.error('FAIL: no units spawned', info); ok = false; }
if (info.paused) { console.error('FAIL: game still paused after Start', info); ok = false; }
if (real.length) { console.error('FAIL: runtime errors:\n' + real.join('\n')); ok = false; }

if (!ok) process.exit(1);
console.log('Smoke OK:', info.units, 'units, running.');

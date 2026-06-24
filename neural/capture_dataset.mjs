/**
 * neural/capture_dataset.mjs
 * Headless dataset generator for the Neural Renderer pipeline.
 *
 * Loads Under Fire, starts the scenario, then roams the camera across the
 * battlefield (varying position, zoom and tilt) and saves the in-game
 * Game.NeuralExport channels for each view as a paired-data INPUT frame.
 *
 * Run (game served at :8741):
 *   node capture_dataset.mjs --out ./dataset/raw --count 500 --height 540 [--url http://localhost:8741]
 *
 * Output per frame NNNN: _rgb.png _depth.png _unit.png _team.png _id.png _terrain.png _meta.json
 * Targets (NNNN_target.png) are added separately — see README.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1]]);
  return a;
}, []));
const OUT = args.out || './dataset/raw';
const COUNT = parseInt(args.count || '300', 10);
const HEIGHT = parseInt(args.height || '540', 10);
const URL = args.url || 'http://localhost:8741';

fs.mkdirSync(OUT, { recursive: true });
const save = (dataUrl, file) => fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.click('#btnEnterGame').catch(() => {});
await page.click('#btnStartMission');
await page.waitForTimeout(1200);

const bounds = await page.evaluate(() => ({ w: Game.WORLD_W, h: Game.WORLD_H }));

for (let i = 0; i < COUNT; i++) {
  // Roam the camera to a varied view (deterministic-ish spread + jitter)
  const data = await page.evaluate(async ({ B, H, idx }) => {
    const r = (a, b) => a + Math.random() * (b - a);
    Game.cam.x = r(B.w * 0.08, B.w * 0.55);   // bias toward the populated NW/centre
    Game.cam.z = r(B.h * 0.05, B.h * 0.45);
    Game.cam.zoom = Game.cam.targetZoom = r(18, 48);
    Game.camTiltDeg = r(30, 45);
    await new Promise(res => setTimeout(res, 80)); // let camera + a frame settle
    return Game.NeuralExport.captureFrameData({ height: H });
  }, { B: bounds, H: HEIGHT, idx: i });

  if (!data) { console.error('capture failed at', i); break; }
  const id = String(i + 1).padStart(5, '0');
  for (const k of ['rgb', 'depth', 'unit', 'team', 'id', 'terrain']) save(data[k], path.join(OUT, `${id}_${k}.png`));
  fs.writeFileSync(path.join(OUT, `${id}_meta.json`), JSON.stringify(data.meta, null, 2));
  if ((i + 1) % 25 === 0) console.log(`captured ${i + 1}/${COUNT}`);
}

console.log(`Done. ${COUNT} input frames in ${OUT}. Add NNNN_target.png for each, then run pack_dataset.py.`);
await browser.close();

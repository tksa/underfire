---
name: run-and-test
description: Run Under Fire locally and verify a change works (serve the static site, syntax-check JS, and run the headless boot smoke test or take a screenshot). Use whenever you finish a change to the game and want to confirm it loads and runs without errors.
---

# Run and test Under Fire

Under Fire is a static site with no build step.

## Serve it
```bash
python3 -m http.server 8741   # from the repo root
# open http://localhost:8741
```

## Quick syntax check (catches the obvious breakage)
```bash
for f in js/*.js; do node --check "$f" || echo "FAIL: $f"; done
```

## Headless smoke test
Loads the game, enters, starts the scenario, and fails on real errors or zero units (benign asset 404s are ignored).
```bash
python3 -m http.server 8741 &
node scripts/smoke-test.mjs           # needs: npm install --no-save playwright && npx playwright install chromium
```
This is the same check CI runs (`.github/workflows/ci.yml`).

## Visual verification (screenshot)
For visual changes, drive the page with Playwright and screenshot it. Useful selectors / hooks:
- Welcome gate button: `#btnEnterGame`
- Start mission button: `#btnStartMission`
- Camera (after start): `Game.cam.x`, `Game.cam.z`, `Game.cam.zoom` / `Game.cam.targetZoom`
- State to assert: `Game.units.length`, `Game._paused`, `Game.bridges`, `Game.river`, etc.

Pattern: `goto` → wait → click `#btnEnterGame` → click `#btnStartMission` → set `Game.cam` to frame the area → wait → `page.screenshot(...)`.

## What "passing" means
- No red errors in the browser console / no `pageerror`.
- Units spawn (`Game.units.length > 0`) and the game is unpaused after Start.
- Visual change looks right in a screenshot (attach before/after to the PR).

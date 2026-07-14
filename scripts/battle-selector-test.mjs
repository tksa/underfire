/** Headless regression for the real Dyle/Mokra battle selector. */
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:8741';
const errors = [];
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
await context.addInitScript(() => {
  // Exercise the true first-visit contract once. The session guard lets later
  // scenario-selection reloads retain the value written by the menu.
  if (!sessionStorage.getItem('selector_test_seeded')) {
    localStorage.removeItem('uf_mission');
    localStorage.removeItem('uf_side');
    sessionStorage.setItem('selector_test_seeded', '1');
  }
});
const page = await context.newPage();
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const waitForWorld = async (mission) => {
  await page.waitForFunction(expected => window.Game
    && Game.currentScenario === expected
    && Game.units && Game.units.length > 0,
  mission, { timeout: 180_000, polling: 500 });
};

const snapshot = () => page.evaluate(() => {
  const alive = Game.units.filter(u => u.alive);
  const tiles = {};
  Game.terrain.flat().forEach(t => { tiles[t.type] = (tiles[t.type] || 0) + 1; });
  const mokraCard = document.querySelector('.mission-card[data-mission="mokra"]');
  const previewBadge = mokraCard?.querySelector('.mc-preview');
  const cardRect = mokraCard?.getBoundingClientRect();
  const badgeRect = previewBadge?.getBoundingClientRect();
  const nameRect = mokraCard?.querySelector('.mc-name')?.getBoundingClientRect();
  return {
    scenario: Game.currentScenario,
    playerTeam: Game.playerTeam,
    selectedCard: document.querySelector('.mission-card.selected')?.dataset.mission,
    cards: [...document.querySelectorAll('.mission-card')].map(c => c.dataset.mission),
    visibleSides: [...document.querySelectorAll('.side-btn')].filter(b => !b.hidden).map(b => b.dataset.side),
    selectedSide: document.querySelector('.side-btn.selected:not([hidden])')?.dataset.side,
    polish: alive.filter(u => u.team === 'polish').length,
    french: alive.filter(u => u.team === 'french').length,
    german: alive.filter(u => u.team === 'german').length,
    deploymentRemaining: Game.missionState.deploymentRemaining,
    combatStarted: Game.missionState.combatStarted,
    phaseName: Game.missionState.phaseName,
    railway: tiles.railway || 0,
    water: tiles.water || 0,
    storedMission: localStorage.getItem('uf_mission'),
    rememberedDyleSide: localStorage.getItem('uf_side'),
    welcomeHidden: document.getElementById('welcomeGate')?.classList.contains('hidden'),
    previewText: previewBadge?.textContent.trim() || '',
    previewVisible: !!previewBadge && getComputedStyle(previewBadge).display !== 'none'
      && getComputedStyle(previewBadge).visibility !== 'hidden',
    previewRightGap: cardRect && badgeRect ? Math.round(cardRect.right - badgeRect.right) : null,
    previewNameDeltaY: nameRect && badgeRect
      ? Math.round(Math.abs((nameRect.top + nameRect.bottom) / 2 - (badgeRect.top + badgeRect.bottom) / 2))
      : null,
  };
});

const selectBattle = async (mission) => {
  const navigation = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.evaluate(id => document.querySelector(`.mission-card[data-mission="${id}"]`)?.click(), mission);
  await navigation;
  await waitForWorld(mission);
};

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180_000 });
await waitForWorld('dyle');
const dyleDefault = await snapshot();

await selectBattle('mokra');
const mokra = await snapshot();

await selectBattle('dyle');
const dyleReturn = await snapshot();

const failures = [];
const expect = (v, msg) => { if (!v) failures.push(msg); };
expect(dyleDefault.scenario === 'dyle' && dyleDefault.selectedCard === 'dyle',
  'empty storage did not boot/select Dyle by default');
expect(dyleDefault.playerTeam === 'french' && dyleDefault.selectedSide === 'french',
  'empty storage did not choose the default French Dyle side');
expect(dyleDefault.polish === 0 && dyleDefault.french > 0 && dyleDefault.german > 0,
  'default Dyle force dispatch is wrong');
expect(dyleDefault.visibleSides.join('|') === 'french|german', 'Dyle side buttons are wrong');
expect(dyleDefault.cards.join('|') === 'dyle|mokra', 'Dyle is not the first battle card');
expect(dyleDefault.previewText === 'Preview' && dyleDefault.previewVisible,
  'Mokra does not have a visible Preview badge');
expect(dyleDefault.previewRightGap != null && dyleDefault.previewRightGap >= 0
  && dyleDefault.previewRightGap <= 28 && dyleDefault.previewNameDeltaY <= 12,
  'Mokra Preview badge is not aligned on the right of its title row');

expect(mokra.scenario === 'mokra' && mokra.selectedCard === 'mokra', 'Mokra selection did not reload the Mokra world');
expect(mokra.storedMission === 'mokra', 'selecting Mokra did not persist an explicit uf_mission=mokra');
expect(mokra.playerTeam === 'polish' && mokra.selectedSide === 'polish', 'Mokra is not Polish-first');
expect(mokra.polish > 0 && mokra.french === 0 && mokra.german === 0,
  'Mokra does not begin with the Polish-only deployment force');
expect(mokra.deploymentRemaining === 180 && !mokra.combatStarted && mokra.phaseName === 'Deployment',
  'Mokra is not waiting at its three-minute deployment phase in the mission menu');
expect(mokra.railway > 150 && mokra.water === 0, 'Mokra retained the Dyle map/bake');
expect(mokra.visibleSides.join('|') === 'polish', 'Mokra exposes the wrong side choices');
expect(mokra.welcomeHidden, 'battle reload returned to the welcome gate instead of the mission menu');

expect(dyleReturn.scenario === 'dyle' && dyleReturn.playerTeam === 'french', 'returning to Dyle lost its scenario/side');
expect(dyleReturn.polish === 0 && dyleReturn.french > 0 && dyleReturn.german > 0, 'returning to Dyle retained Mokra forces');
expect(dyleReturn.storedMission === 'dyle', 'returning to Dyle did not persist its mission selection');

// A scenario reload can tear down the old document while GLTFLoader is still
// resolving an object-URL texture. Those blob errors belong to the discarded
// page and do not indicate a failure in the newly booted battle.
const realErrors = errors.filter(e =>
  !/Failed to load resource|status of 404|404 \(|THREE\.GLTFLoader: Couldn't load texture blob:/i.test(e));
failures.push(...realErrors);
await browser.close();

if (failures.length) {
  console.error('Battle selector FAIL:\n- ' + failures.join('\n- '));
  console.error(JSON.stringify({ dyleDefault, mokra, dyleReturn }, null, 2));
  process.exit(1);
}
console.log('Battle selector OK:', JSON.stringify({ dyleDefault, mokra, dyleReturn }));

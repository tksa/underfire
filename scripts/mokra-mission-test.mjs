/**
 * Deterministic, headless contract test for the explicitly selected Mokra
 * preview scenario. Dyle remains the default battle for empty storage.
 * No visual inspection or player simulation is used.
 *
 * Run: python3 -m http.server 8741 & node scripts/mokra-mission-test.mjs
 */
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:8741';
const errors = [];
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.addInitScript(() => {
  localStorage.setItem('uf_mission', 'mokra');
});
const page = await context.newPage();
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => window.Game && Game.units && Game.units.length > 0,
  null, { timeout: 120_000, polling: 500 });

const state = await page.evaluate(async () => {
  const units = Game.units.filter(u => u.alive);
  const polish = units.filter(u => u.team === Game.TEAM.POLISH);
  const german = units.filter(u => u.team === Game.TEAM.GERMAN);
  const tileCounts = {};
  Game.terrain.flat().forEach(t => { tileCounts[t.type] = (tileCounts[t.type] || 0) + 1; });

  const testPanzer = german.find(u => u.kind === 'panzer1' || u.kind === 'panzer2');
  const crossingPath = testPanzer
    ? Game.findPath(testPanzer, testPanzer.x, testPanzer.z, 76 * Game.TILE, 50 * Game.TILE)
    : [];

  // Polish voice calls must be safe before recordings exist. The function is
  // intentionally silent; this assertion catches accidental cross-language or
  // missing-pool exceptions without inspecting or playing the game.
  let voiceSafe = true;
  try { Game.Audio.voice('f_sold_move'); } catch (e) { voiceSafe = false; }

  const dossier = await fetch('docs/POLAND_1939_CAMPAIGN.md').then(r => r.text());
  const missionDoc = await fetch('docs/scenarios/mokra.md').then(r => r.text());

  const polishDefendersAtCrossing = polish.filter(u =>
    Game.dist(u.x, u.z, Game.missionState.objectiveX, Game.missionState.objectiveY) < 12).length;

  // Advance the mission clock in one deterministic step while still paused;
  // the hold objective must resolve independently of a destroy-all condition.
  Game.updateMokraMission(301);
  const holdVictory = Game.missionState.won && Game.missionState.phaseName === 'Timetable disrupted';
  const postWaveGermanKinds = [...new Set(Game.getTeamUnits(Game.TEAM.GERMAN).map(u => u.kind))].sort();

  return {
    scenario: Game.currentScenario,
    selectedMission: Game.selectedMission,
    playerTeam: Game.playerTeam,
    enemyTeam: Game.enemyTeam(),
    polish: polish.length,
    german: german.length,
    french: units.filter(u => u.team === Game.TEAM.FRENCH).length,
    polishKinds: [...new Set(polish.map(u => u.kind))].sort(),
    germanKinds: [...new Set(german.map(u => u.kind))].sort(),
    postWaveGermanKinds,
    allWavesCommitted: Game.missionState.nextWave === 4 && Game.missionState.reinforcementTriggered,
    polishDefendersAtCrossing,
    allPolishDescribed: polish.every(u => typeof u.description === 'string' && u.description.length > 20),
    railwayTiles: tileCounts.railway || 0,
    waterTiles: tileCounts.water || 0,
    crossings: Game.railway && Game.railway.crossings ? Game.railway.crossings.length : 0,
    villages: (Game.mokraVillages || []).map(v => v.name),
    railMeshes: Game.terrainGroup.children.filter(o => /^mokra-railway-/.test(o.name)).length,
    crossingPath: crossingPath.length,
    fighters: Game.fighterTotalAvailable ? Game.fighterTotalAvailable() : -1,
    airStrikes: Game.airStrikesAvailable,
    objective: Game.missionState.primaryObjective,
    voiceSafe,
    dossierOk: dossier.includes('Poland 1939 RTS Battle Design Dossier') && dossier.includes('Battle of Mokra'),
    missionDocOk: missionDoc.includes('## Preview implementation status')
      && missionDoc.includes('Polish voice assets')
      && missionDoc.includes('Dyle remains the first/default battle'),
    holdVictory,
    menuMission: document.querySelector('.mission-card.selected')?.dataset.mission,
    menuSide: document.querySelector('.side-btn.selected')?.dataset.side,
    menuCards: [...document.querySelectorAll('.mission-card')].map(c => c.dataset.mission),
    visibleSides: [...document.querySelectorAll('.side-btn')].filter(b => !b.hidden).map(b => b.dataset.side),
    previewBadge: document.querySelector('.mission-card[data-mission="mokra"] .mc-preview')
      ?.textContent.trim() || '',
  };
});

const fail = [];
const expect = (condition, message) => { if (!condition) fail.push(message); };
expect(state.scenario === 'mokra' && state.selectedMission === 'mokra', 'Mokra is not the active scenario');
expect(state.playerTeam === 'polish' && state.enemyTeam === 'german', 'scenario teams are not Poland vs Germany');
expect(state.polish > 0 && state.german > 0 && state.french === 0, 'incorrect opening force teams');
expect(state.allPolishDescribed, 'one or more Polish units lacks an in-game description');
for (const required of ['ulan', 'rkm_wz28', 'at_rifle_wz35', 'hmg', 'mortar46', 'mortar81',
  'bofors37', 'fieldgun75', 'tks', 'wz34', 'officer', 'sapper', 'medic']) {
  expect(state.polishKinds.includes(required), `missing Polish unit kind: ${required}`);
}
expect(!state.germanKinds.includes('panzer3'), 'Panzer III must not be fielded at Mokra');
expect(!state.postWaveGermanKinds.includes('panzer3'), 'a reinforcement wave fielded a Panzer III');
for (const required of ['mp38', 'mortar50', 'mortar81', 'panzer1', 'panzer2', 'panzer4']) {
  expect(state.postWaveGermanKinds.includes(required), `missing German scenario unit kind: ${required}`);
}
expect(!state.postWaveGermanKinds.includes('smg'), 'generic 1940 Sturmtrupp is fielded at Mokra');
expect(!state.polishKinds.some(k => /7tp|20mm|tks20/i.test(k)), 'anachronistic Polish armour variant fielded');
expect(state.railwayTiles > 150 && state.crossings === 3 && state.railMeshes >= 2,
  'railway/crossing contract is incomplete');
expect(state.waterTiles === 0, 'Mokra must not contain a broad river/lake tile');
expect(state.villages.join('|') === 'Mokra I|Mokra II|Mokra III', 'Mokra I–III strips are missing');
expect(state.polishDefendersAtCrossing > 0, 'the central crossing starts outside Polish control');
expect(state.crossingPath > 0, 'a German tracked vehicle cannot path through the central crossing');
expect(state.fighters === 0 && state.airStrikes === 0, 'anachronistic player air support is enabled');
expect(/railway crossing/i.test(state.objective), 'mission objective is not railway defence');
expect(state.voiceSafe, 'empty Polish voice slots throw an exception');
expect(state.dossierOk && state.missionDocOk, 'campaign/mission documentation is missing');
expect(state.holdVictory, 'five-minute hold does not resolve as an operational victory');
expect(state.allWavesCommitted, 'the three timed German echelons were not all committed');
expect(state.menuMission === 'mokra' && state.menuSide === 'polish', 'explicit Mokra selection is not Poland-first');
expect(state.menuCards.join('|') === 'dyle|mokra', 'Dyle is not the first/default battle selection');
expect(state.previewBadge === 'Preview', 'Mokra selection is missing its Preview badge');
expect(state.visibleSides.join('|') === 'polish', 'Mokra exposes French/German side buttons');

const realErrors = errors.filter(e =>
  !/Failed to load resource|status of 404|404 \(|THREE\.GLTFLoader: Couldn't load texture blob:/i.test(e));
if (realErrors.length) fail.push(...realErrors);

await browser.close();

if (fail.length) {
  console.error('Mokra contract FAIL:\n- ' + fail.join('\n- '));
  console.error(JSON.stringify(state, null, 2));
  process.exit(1);
}

console.log('Mokra contract OK:', JSON.stringify(state));

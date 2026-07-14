/**
 * Deterministic, headless contract test for the explicitly selected Mokra
 * preview scenario. Dyle remains the default battle for empty storage.
 * No visual inspection or player simulation is used.
 *
 * Run: python3 -m http.server 8741 & node scripts/mokra-mission-test.mjs
 */
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:8741';
const CAVALRY_CLIPS = [
  'idle', 'walk', 'run',
  'fire_forward', 'fire_backward', 'fire_left', 'fire_right',
  'death', 'death2', 'death3', 'mount', 'dismount',
];
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

// Model loading is asynchronous. Wait for the mounted reserve's tagged model
// and canonical animation contract before taking the mission snapshot; this is
// still a data-only check and does not inspect the rendered canvas.
let cavalryModelWaitOk = true;
try {
  await page.waitForFunction(requiredClips => {
    const mounted = Game.units.filter(unit => unit.alive && unit.team === Game.TEAM.POLISH
      && unit.kind === 'mounted_ulan');
    return mounted.length === 4 && mounted.every(unit => {
      const data = unit.mesh && unit.mesh.userData;
      return !unit._cavalryTransition && !unit._cavalryAwaitingModel
        && data && data.isMountedCavalry === true
        && /polish_mounted_ulan\.glb$/.test(data.modelPath || '')
        && requiredClips.every(name => data.clipNames?.includes(name)
          && data.actions && data.actions[name]);
    });
  }, CAVALRY_CLIPS, { timeout: 120_000, polling: 250 });
} catch (error) {
  cavalryModelWaitOk = false;
}

// The authored railway is loaded after terrain construction. Wait for the
// data contract only; this test never samples or inspects the rendered canvas.
let railwayModelWaitOk = true;
try {
  await page.waitForFunction(() => {
    const railway = Game.terrainGroup?.getObjectByName('mokra-railway-model');
    const track = railway?.getObjectByName('mokra-railway-track');
    return railway?.userData?.modelReady === true
      && track?.isInstancedMesh === true
      && track.userData.moduleCount >= 37;
  }, null, { timeout: 120_000, polling: 250 });
} catch (error) {
  railwayModelWaitOk = false;
}

const state = await page.evaluate(async requiredCavalryClips => {
  const units = Game.units.filter(u => u.alive);
  const polish = units.filter(u => u.team === Game.TEAM.POLISH);
  const german = units.filter(u => u.team === Game.TEAM.GERMAN);
  const polishKindCounts = polish.reduce((counts, unit) => {
    counts[unit.kind] = (counts[unit.kind] || 0) + 1;
    return counts;
  }, {});
  const tileCounts = {};
  Game.terrain.flat().forEach(t => { tileCounts[t.type] = (tileCounts[t.type] || 0) + 1; });

  // Verify the Polish pools without playing or listening to the recordings.
  // Any unpopulated Polish semantic category must remain silent rather than
  // falling through to another faction.
  const polishVoiceSlots = Game.Audio.voiceSlots.polish;
  const polishVoiceCounts = Object.fromEntries(Object.entries(polishVoiceSlots)
    .map(([key, takes]) => [key, takes.length]));
  const activePolishVoices = [...new Set(Object.values(polishVoiceSlots).flat())];
  const polishVoiceAssetsOk = (await Promise.all(activePolishVoices.map(async name => {
    const response = await fetch(`sounds/voices/${name}.ogg`);
    return response.ok;
  }))).every(Boolean);
  let voiceSafe = true;
  try { Game.Audio.voice('f_sold_move'); } catch (e) { voiceSafe = false; }
  let firstSoldAttackTake = null;
  let firstTankAttackTake = null;
  try {
    Game.gameClock = (Game.gameClock || 0) + 1;
    firstSoldAttackTake = Game.Audio.voice('f_sold_attack');
    Game.gameClock += 1;
    firstTankAttackTake = Game.Audio.voice('f_tank_attack');
  } catch (e) { voiceSafe = false; }

  // Exercise the drag-box branch without listening to or visually inspecting
  // the game. It must emit one aggregate acknowledgement for all box hits.
  const boxVoices = [];
  const originalVoice = Game.Audio.voice;
  const boxUnits = polish.filter(unit => unit.group === 'pl_line_1');
  const boxPoints = boxUnits.map(unit => Game.worldToScreen(unit.x, unit.z,
    (unit.y || 0) + (unit.size || 0.5)));
  Game.selection.clear();
  Game.Audio.voice = semantic => { boxVoices.push(semantic); return semantic; };
  Game.mouse.dragStartX = Math.min(...boxPoints.map(point => point.x)) - 5;
  Game.mouse.dragStartY = Math.min(...boxPoints.map(point => point.y)) - 5;
  Game.mouse.dragCurrentX = Math.max(...boxPoints.map(point => point.x)) + 5;
  Game.mouse.dragCurrentY = Math.max(...boxPoints.map(point => point.y)) + 5;
  Game.handleMouseSelection();
  const boxSelectionSize = Game.selection.size;
  Game.Audio.voice = originalVoice;
  Game.selection.clear();

  const dossier = await fetch('docs/POLAND_1939_CAMPAIGN.md').then(r => r.text());
  const missionDoc = await fetch('docs/scenarios/mokra.md').then(r => r.text());

  const polishDefendersAtCrossing = polish.filter(u =>
    Game.dist(u.x, u.z, Game.missionState.objectiveX, Game.missionState.objectiveY) < 12).length;
  const deployment = Game.mokraDeployment || { gunLine: [], infantryLine: [] };
  const gunLine = [...deployment.gunLine].sort((a, b) => a.y - b.y);
  const infantryLine = [...deployment.infantryLine].sort((a, b) => a.y - b.y);
  const attentionUnitIds = deployment.attentionUnitIds || [];
  const attentionUnits = attentionUnitIds.map(id => Game.getUnitById(id)).filter(Boolean);
  const expectedAttentionUnits = polish.filter(unit => unit.group === 'pl_reserve'
    || /^pl_line_\d+$/.test(unit.group));
  const attentionIdsTracked = attentionUnitIds.length === expectedAttentionUnits.length
    && attentionUnits.length === attentionUnitIds.length
    && expectedAttentionUnits.every(unit => attentionUnitIds.includes(unit.id));
  const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const attentionStandingWest = attentionUnits.length > 0 && attentionUnits.every(unit =>
    unit.team === Game.TEAM.POLISH
    && Game.isFootInfantry(unit)
    && unit.stance === 'stand'
    && !unit.moving
    && unit.currentSpeed === 0
    && (!unit.path || unit.path.length === 0)
    && Game.dist(unit.x, unit.z, unit.targetX, unit.targetZ) <= 0.001
    && Math.abs(angleDelta(unit.angle, Math.PI)) <= 0.001);
  const deploymentInterleaved = infantryLine.length === gunLine.length - 1
    && infantryLine.every((position, index) => position.y > gunLine[index].y
      && position.y < gunLine[index + 1].y);
  const gunLineUnitList = polish.filter(u => u.group === 'pl_gun_line');
  const gunLineUnits = gunLineUnitList.length;
  const infantryLineGroups = new Set(infantryLine.map(position => position.group));
  const infantryLineUnits = polish.filter(u => infantryLineGroups.has(u.group)).length;
  const gunLineClear = gunLineUnitList.every(unit => {
    const tile = Game.getTileAtWorld(unit.x, unit.z);
    return tile && !tile.blocked && !tile.vehicleBlocked;
  });
  const wz34 = polish.find(unit => unit.kind === 'wz34');
  const wz34Tile = wz34 && Game.getTileAtWorld(wz34.x, wz34.z);
  const wz34Clear = !!wz34Tile && !wz34Tile.blocked && !wz34Tile.vehicleBlocked;
  const polishBodiesClear = polish.every(unit =>
    !Game._bodySolidCount || Game._bodySolidCount(unit, unit.x, unit.z, unit.angle) === 0);
  const polishBodyConflicts = polish.filter(unit => Game._bodySolidCount
    && Game._bodySolidCount(unit, unit.x, unit.z, unit.angle) > 0).map(unit => ({
    id: unit.id,
    kind: unit.kind,
    group: unit.group,
    x: unit.x,
    z: unit.z,
    tile: Game.getTileAtWorld(unit.x, unit.z)?.type || null,
    solidSamples: Game._bodySolidCount(unit, unit.x, unit.z, unit.angle),
  }));
  const polishVehiclesClear = polish
    .filter(unit => Game.isTank(unit.kind) || Game.isTruck(unit.kind))
    .every(unit => !Game._vehPenetration
      || Game._vehPenetration(unit, unit.x, unit.z, unit.angle) === 0);
  const medic = polish.find(unit => unit.kind === 'medic');
  const reserve = polish.filter(unit => unit.group === 'pl_reserve');
  const medicReserveDistance = medic && reserve.length
    ? Math.min(...reserve.map(unit => Game.dist(medic.x, medic.z, unit.x, unit.z)))
    : 0;
  const mountedUhlans = polish.filter(unit => unit.kind === 'mounted_ulan');
  const mountedReserve = mountedUhlans.filter(unit => unit.group === 'pl_12th_uhlans_reserve');
  const authoredCavalryReserve = deployment.cavalryReserve || [];
  const reserveCenter = reserve.length ? {
    x: reserve.reduce((sum, unit) => sum + unit.x, 0) / reserve.length,
    z: reserve.reduce((sum, unit) => sum + unit.z, 0) / reserve.length,
  } : null;
  const mountedEastOfRailway = mountedReserve.every(unit =>
    Game.railway && unit.x > Game.railway.centerX);
  const mountedInReserveZone = authoredCavalryReserve.length === 4
    && authoredCavalryReserve.every(position => mountedReserve.some(unit =>
      unit.group === position.group
      && Game.dist(unit.x, unit.z, position.x * Game.TILE, position.y * Game.TILE)
        <= 1.1 * Game.TILE));
  const mountedModelReady = mountedReserve.every(unit => {
    const data = unit.mesh && unit.mesh.userData;
    return data && data.isMountedCavalry === true
      && /polish_mounted_ulan\.glb$/.test(data.modelPath || '')
      && requiredCavalryClips.every(name => data.clipNames?.includes(name)
        && data.actions && data.actions[name]);
  });
  const mountedStateReady = mountedReserve.every(unit =>
    unit._cavalryCanMount === true && unit._cavalryMounted === true
      && Game.isMountedCavalry(unit) && !Game.isFootInfantry(unit)
      && !unit._cavalryTransition && !unit._cavalryAwaitingModel);

  // Exercise deployment while still paused. The dormant siren API is stubbed
  // to prove the current preview does not invoke it; this remains a data-only
  // contract check and the visible three-minute countdown stays active.
  const sirenCues = [];
  const originalSiren = Game.Audio.airRaidSiren;
  Game.Audio.airRaidSiren = () => { sirenCues.push('airRaidSiren'); return true; };
  const deploymentStarted = Game.startMokraDeployment();
  const duplicateDeploymentRejected = !Game.startMokraDeployment();
  const deploymentDuration = Game.missionState.deploymentDuration;
  Game.updateMokraMission(90);
  const germansAtHalfway = Game.getTeamUnits(Game.TEAM.GERMAN).length;
  const countdownAtHalfway = Math.ceil(Game.missionState.deploymentRemaining);
  Game.updateHUD();
  const approachCountdown = document.getElementById('mokraApproachCountdown');
  const approachStyle = approachCountdown ? getComputedStyle(approachCountdown) : null;
  const approachRect = approachCountdown ? approachCountdown.getBoundingClientRect() : null;
  const approachCountdownAtHalfway = {
    text: approachCountdown?.textContent || '',
    hidden: approachCountdown?.hidden ?? true,
    color: approachStyle?.color || '',
    position: approachStyle?.position || '',
    top: approachRect?.top ?? Infinity,
    centerOffset: approachRect
      ? Math.abs(approachRect.left + approachRect.width / 2 - window.innerWidth / 2)
      : Infinity,
  };
  Game.updateMokraMission(89);
  const germansBeforeAttack = Game.getTeamUnits(Game.TEAM.GERMAN).length;
  const countdownAtOneSecond = Math.ceil(Game.missionState.deploymentRemaining);
  Game.updateMokraMission(1);
  Game.updateHUD();
  const approachCountdownHiddenAfterCombat = approachCountdown?.hidden ?? false;
  Game.Audio.airRaidSiren = originalSiren;

  const initialGermans = Game.getTeamUnits(Game.TEAM.GERMAN);
  const combatStartedAtThreeMinutes = Game.missionState.combatStarted
    && Game.missionState.timer === 0;
  const initialEntryAtWestEdge = initialGermans.length > 0
    && initialGermans.every(unit => unit._mokraEntrySpawn
      && unit._mokraEntrySpawn.x >= Game.mokraZones.germanEntry.x0
      && unit._mokraEntrySpawn.x <= Game.mokraZones.germanEntry.x1);
  const testPanzer = initialGermans.find(u => u.kind === 'panzer1' || u.kind === 'panzer2');
  const crossingPath = testPanzer
    ? Game.findPath(testPanzer, testPanzer.x, testPanzer.z, 76 * Game.TILE, 50 * Game.TILE)
    : [];

  // Walk every absolute mission-time threshold without running the simulation:
  // vanguard 3:00, later echelons 3:55/5:05/6:25, victory 8:00. The combat
  // cadence remains 0/55/125/205 seconds followed by a 300-second hold.
  const eventVoices = [];
  const originalEventVoice = Game.Audio.eventVoice;
  Game.Audio.eventVoice = semantic => {
    eventVoices.push(semantic);
    return originalEventVoice(semantic);
  };
  const totalTimeline = [];
  const recordTimeline = totalElapsed => totalTimeline.push({
    totalElapsed,
    combatElapsed: Game.missionState.timer,
    waves: Game.mokraGermanEntryHistory.map(entry => entry.wave),
    won: Game.missionState.won,
  });
  recordTimeline(180);
  Game.updateMokraMission(54); recordTimeline(234);
  Game.updateMokraMission(1); recordTimeline(235);
  Game.updateMokraMission(69); recordTimeline(304);
  Game.updateMokraMission(1); recordTimeline(305);
  Game.updateMokraMission(79); recordTimeline(384);
  Game.updateMokraMission(1); recordTimeline(385);
  Game.updateMokraMission(94); recordTimeline(479);
  Game.updateMokraMission(1); recordTimeline(480);
  Game.Audio.eventVoice = originalEventVoice;
  const holdVictory = Game.missionState.won && Game.missionState.phaseName === 'Timetable disrupted';
  const postWaveGermanKinds = [...new Set(Game.getTeamUnits(Game.TEAM.GERMAN).map(u => u.kind))].sort();
  const allGermanEntriesAtWestEdge = Game.mokraGermanEntryHistory.length === 4
    && Game.mokraGermanEntryHistory.every(entry => entry.units.length > 0
      && entry.units.every(unit => unit.x >= Game.mokraZones.germanEntry.x0
        && unit.x <= Game.mokraZones.germanEntry.x1));

  const railwayModel = Game.terrainGroup.getObjectByName('mokra-railway-model');
  const railwayTrack = railwayModel?.getObjectByName('mokra-railway-track');
  const railTerrainStats = { ...(Game._mokraRailTerrainStats || {}) };
  const centralCrossing = Game.railway?.crossings?.find(crossing => crossing.ty === 50)
    || Game.railway?.crossings?.[0];
  const railCrossingDetail = centralCrossing
    ? Game.getGroundDetailHeight(Game.railway.centerX, (centralCrossing.ty + 0.5) * Game.TILE)
    : Infinity;

  return {
    scenario: Game.currentScenario,
    selectedMission: Game.selectedMission,
    playerTeam: Game.playerTeam,
    enemyTeam: Game.enemyTeam(),
    polish: polish.length,
    german: initialGermans.length,
    preDeploymentGerman: german.length,
    deploymentStarted,
    duplicateDeploymentRejected,
    deploymentDuration,
    germansAtHalfway,
    countdownAtHalfway,
    approachCountdownAtHalfway,
    approachCountdownHiddenAfterCombat,
    germansBeforeAttack,
    countdownAtOneSecond,
    combatStartedAtThreeMinutes,
    totalTimeline,
    sirenCues,
    initialEntryAtWestEdge,
    allGermanEntriesAtWestEdge,
    germanEntryWaves: Game.mokraGermanEntryHistory.map(entry => entry.wave),
    french: units.filter(u => u.team === Game.TEAM.FRENCH).length,
    polishKinds: [...new Set(polish.map(u => u.kind))].sort(),
    polishKindCounts,
    germanKinds: [...new Set(initialGermans.map(u => u.kind))].sort(),
    postWaveGermanKinds,
    allWavesCommitted: Game.missionState.nextWave === 4 && Game.missionState.reinforcementTriggered,
    polishDefendersAtCrossing,
    deploymentInterleaved,
    attentionUnitIds,
    attentionUnitCount: attentionUnits.length,
    attentionIdsTracked,
    attentionStandingWest,
    gunLinePattern: gunLine.map(position => position.kind),
    gunLineUnits,
    infantryLineUnits,
    gunLineClear,
    wz34Clear,
    polishBodiesClear,
    polishBodyConflicts,
    polishVehiclesClear,
    medicReserveDistance,
    mountedUhlans: mountedUhlans.length,
    mountedReserve: mountedReserve.length,
    mountedEastOfRailway,
    mountedInReserveZone,
    mountedModelReady,
    mountedStateReady,
    reserveCenter,
    cavalryReservePattern: authoredCavalryReserve,
    mountedPositions: mountedReserve.map(unit => ({ x: unit.x, z: unit.z, group: unit.group })),
    mountedClipNames: mountedReserve.map(unit => unit.mesh?.userData?.clipNames || []),
    mountedModelPaths: mountedReserve.map(unit => unit.mesh?.userData?.modelPath || null),
    initialBofors: Game.missionState.initialBoforsIds.length,
    initialPolishStrength: Game.missionState.initialPolishStrength,
    allPolishDescribed: polish.every(u => typeof u.description === 'string' && u.description.length > 20),
    railwayTiles: tileCounts.railway || 0,
    waterTiles: tileCounts.water || 0,
    crossings: Game.railway && Game.railway.crossings ? Game.railway.crossings.length : 0,
    villages: (Game.mokraVillages || []).map(v => v.name),
    railMeshes: railwayModel ? railwayModel.children.filter(o => /^mokra-railway-/.test(o.name)).length : 0,
    railModelReady: railwayModel?.userData?.modelReady === true,
    railModelSource: railwayModel?.userData?.sourceModel || null,
    railModuleCount: railwayTrack?.userData?.moduleCount || 0,
    railTerrainStats,
    railCrossingDetail,
    crossingPath: crossingPath.length,
    fighters: Game.fighterTotalAvailable ? Game.fighterTotalAvailable() : -1,
    airStrikes: Game.airStrikesAvailable,
    objective: Game.missionState.primaryObjective,
    voiceSafe,
    firstSoldAttackTake,
    firstTankAttackTake,
    boxVoices,
    boxSelectionSize,
    eventVoices,
    polishVoiceCounts,
    polishVoiceAssets: activePolishVoices.length,
    polishVoiceAssetsOk,
    dossierOk: dossier.includes('Poland 1939 RTS Battle Design Dossier') && dossier.includes('Battle of Mokra'),
    missionDocOk: missionDoc.includes('## Preview implementation status')
      && missionDoc.includes('Polish voice assets')
      && missionDoc.includes('Dyle remains the first/default battle')
      && missionDoc.includes('three-minute countdown')
      && missionDoc.includes('western map edge'),
    holdVictory,
    menuMission: document.querySelector('.mission-card.selected')?.dataset.mission,
    menuSide: document.querySelector('.side-btn.selected')?.dataset.side,
    menuCards: [...document.querySelectorAll('.mission-card')].map(c => c.dataset.mission),
    visibleSides: [...document.querySelectorAll('.side-btn')].filter(b => !b.hidden).map(b => b.dataset.side),
    previewBadge: document.querySelector('.mission-card[data-mission="mokra"] .mc-preview')
      ?.textContent.trim() || '',
  };
}, CAVALRY_CLIPS);

const fail = [];
const expect = (condition, message) => { if (!condition) fail.push(message); };
expect(state.scenario === 'mokra' && state.selectedMission === 'mokra', 'Mokra is not the active scenario');
expect(state.playerTeam === 'polish' && state.enemyTeam === 'german', 'scenario teams are not Poland vs Germany');
expect(state.polish > 0 && state.preDeploymentGerman === 0 && state.german > 0 && state.french === 0,
  'deployment does not begin with Poland alone before the German vanguard enters');
expect(state.deploymentStarted && state.duplicateDeploymentRejected
  && state.deploymentDuration === 180
  && state.germansAtHalfway === 0 && state.countdownAtHalfway === 90
  && state.germansBeforeAttack === 0 && state.countdownAtOneSecond === 1
  && state.combatStartedAtThreeMinutes,
  'the three-minute German attack delay is incomplete or can be started twice');
expect(state.approachCountdownAtHalfway.text
    === 'German forces approaching: 1 minute 30 seconds'
  && !state.approachCountdownAtHalfway.hidden
  && state.approachCountdownAtHalfway.color === 'rgb(255, 255, 255)'
  && state.approachCountdownAtHalfway.position === 'fixed'
  && state.approachCountdownAtHalfway.top <= 30
  && state.approachCountdownAtHalfway.centerOffset <= 1
  && state.approachCountdownHiddenAfterCombat,
  'the Mokra countdown is not white, top-centred, correctly worded, or hidden after arrival');
expect(JSON.stringify(state.totalTimeline) === JSON.stringify([
  { totalElapsed: 180, combatElapsed: 0, waves: [0], won: false },
  { totalElapsed: 234, combatElapsed: 54, waves: [0], won: false },
  { totalElapsed: 235, combatElapsed: 55, waves: [0, 1], won: false },
  { totalElapsed: 304, combatElapsed: 124, waves: [0, 1], won: false },
  { totalElapsed: 305, combatElapsed: 125, waves: [0, 1, 2], won: false },
  { totalElapsed: 384, combatElapsed: 204, waves: [0, 1, 2], won: false },
  { totalElapsed: 385, combatElapsed: 205, waves: [0, 1, 2, 3], won: false },
  { totalElapsed: 479, combatElapsed: 299, waves: [0, 1, 2, 3], won: false },
  { totalElapsed: 480, combatElapsed: 300, waves: [0, 1, 2, 3], won: true },
]), 'Mokra absolute timeline is not vanguard 3:00, waves 3:55/5:05/6:25, victory 8:00');
expect(state.sirenCues.length === 0,
  'the temporarily disabled Mokra deployment siren was triggered');
expect(state.initialEntryAtWestEdge && state.allGermanEntriesAtWestEdge
  && state.germanEntryWaves.join('|') === '0|1|2|3',
  'one or more German echelons does not enter through the western map edge');
expect(state.allPolishDescribed, 'one or more Polish units lacks an in-game description');
for (const required of ['ulan', 'mounted_ulan', 'rkm_wz28', 'at_rifle_wz35', 'hmg', 'mortar46', 'mortar81',
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
expect(state.railwayTiles > 150 && state.crossings === 3,
  'railway/crossing gameplay contract is incomplete');
expect(railwayModelWaitOk && state.railModelReady && state.railMeshes === 1
  && state.railModelSource === 'models/railway/train_track_straight.glb'
  && state.railModuleCount >= 37,
  'the modular Mokra railway model is not loaded and instanced across the map');
expect(state.railTerrainStats.applied === true
  && state.railTerrainStats.scenario === 'mokra'
  && state.railTerrainStats.coreSamples > 0
  && state.railTerrainStats.affectedSamples > state.railTerrainStats.coreSamples
  && state.railTerrainStats.maxObservedGrade
    <= state.railTerrainStats.maxConfiguredGrade + 0.0001
  && state.railCrossingDetail === 0,
  'the Mokra railway bed is not flattened, grade-limited, or free of crossing micro-relief');
expect(state.waterTiles === 0, 'Mokra must not contain a broad river/lake tile');
expect(state.villages.join('|') === 'Mokra I|Mokra II|Mokra III', 'Mokra I–III strips are missing');
expect(state.polishDefendersAtCrossing > 0, 'the central crossing starts outside Polish control');
expect(state.polishKindCounts.bofors37 === 3
  && state.polishKindCounts.fieldgun75 === 3
  && state.polishKindCounts.hmg === 2
  && state.polishKindCounts.mortar46 === 1
  && state.polishKindCounts.mortar81 === 1,
  'Polish support allocation does not match the compressed Mokra gun line');
expect(state.gunLinePattern.join('|')
  === 'bofors37|fieldgun75|bofors37|fieldgun75|bofors37|fieldgun75',
  'Mokra gun line does not alternate Bofors and 75 mm artillery');
expect(state.deploymentInterleaved && state.gunLineUnits === 6 && state.infantryLineUnits === 25,
  'infantry sections are not interleaved between every artillery position');
expect(state.attentionIdsTracked && state.attentionUnitCount === 33
  && state.attentionStandingWest,
  'the opening Polish line/reserve infantry are not tracked, standing still, and facing west');
expect(state.initialBofors === 3, 'secondary-objective Bofors tracking is incomplete');
expect(state.initialPolishStrength === 59, 'reinforced Polish opening strength is wrong');
expect(state.mountedUhlans === 4 && state.mountedReserve === 4,
  'the four mounted ułans are not assigned to pl_12th_uhlans_reserve');
expect(state.mountedEastOfRailway && state.mountedInReserveZone,
  'the mounted ułans are not deployed in the Polish reserve east of the railway');
expect(cavalryModelWaitOk && state.mountedModelReady,
  'the mounted ułan model or canonical animation clips did not become ready');
expect(state.mountedStateReady,
  'the opening mounted ułans are missing their mounted-state contract');
expect(state.gunLineClear && state.wz34Clear,
  'a Polish gun-line or reconnaissance unit starts on blocked terrain');
expect(state.polishBodiesClear && state.polishVehiclesClear,
  'a Polish unit starts inside solid terrain or another vehicle footprint');
expect(state.medicReserveDistance > 2.5,
  'the Polish medic starts overlapped with the reserve squad');
expect(state.crossingPath > 0, 'a German tracked vehicle cannot path through the central crossing');
expect(state.fighters === 0 && state.airStrikes === 0, 'anachronistic player air support is enabled');
expect(/railway crossing/i.test(state.objective), 'mission objective is not railway defence');
expect(state.voiceSafe, 'Polish voice playback throws an exception');
expect(state.boxSelectionSize > 1 && state.boxVoices.join('|') === 'f_sold_select',
  'drag-box selection does not emit one aggregate infantry acknowledgement');
expect(/pl\/(core-morale|patriotic)\//.test(state.firstSoldAttackTake || '')
  && /pl\/(core-morale|patriotic)\//.test(state.firstTankAttackTake || ''),
  'the first Polish infantry/tank attack orders do not use patriotic morale takes');
expect(state.polishVoiceCounts.f_sold_select === 16
  && state.polishVoiceCounts.f_sold_move === 30
  && state.polishVoiceCounts.f_sold_attack === 6
  && state.polishVoiceCounts.f_sold_morale === 18,
  'Polish infantry voice pool counts are wrong');
expect(state.polishVoiceCounts.f_tank_select === 15
  && state.polishVoiceCounts.f_tank_move === 17
  && state.polishVoiceCounts.f_tank_attack === 5
  && state.polishVoiceCounts.f_tank_morale === 18
  && state.polishVoiceCounts.f_tank_stop === 8,
  'Polish tank voice pool counts are wrong');
expect(state.polishVoiceCounts.f_mokra_final === 1,
  'the final-echelon Polish morale cue is missing');
expect(state.eventVoices.join('|') === 'f_mokra_final',
  'the final German echelon does not trigger exactly one Polish morale cue');
expect(state.polishVoiceAssets === 75 && state.polishVoiceAssetsOk,
  'one or more active Polish voice assets is missing');
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

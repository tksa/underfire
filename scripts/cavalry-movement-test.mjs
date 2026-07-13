/**
 * Deterministic, nonvisual contract test for mounted Polish cavalry.
 *
 * It drives the simulation at a fixed 30 Hz on open synthetic terrain, checks
 * the resulting numeric pose trace, and exercises the mounted/dismounted APIs.
 * It never reads pixels or inspects the rendered canvas.
 *
 * Run: python3 -m http.server 8741 & node scripts/cavalry-movement-test.mjs
 */
import { chromium } from 'playwright';

const URL = process.env.SMOKE_URL || 'http://localhost:8741';
const REQUIRED_CLIPS = [
  'idle', 'walk', 'run',
  'fire_forward', 'fire_backward', 'fire_left', 'fire_right',
  'death', 'death2', 'death3', 'mount', 'dismount',
];
const browser = await chromium.launch();
const errors = [];

try {
  const context = await browser.newContext({ viewport: { width: 900, height: 600 } });
  await context.addInitScript(() => localStorage.setItem('uf_mission', 'mokra'));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => window.Game
    && Game.units?.filter(unit => unit.alive && unit.kind === 'mounted_ulan').length === 4
    && Game.CAVALRY_MOVE
    && typeof Game.isMountedCavalry === 'function'
    && typeof Game.isFootInfantry === 'function'
    && typeof Game.setCavalryMounted === 'function'
    && typeof Game.toggleSelectedCavalry === 'function',
  undefined, { timeout: 120_000, polling: 250 });
  await page.waitForFunction(requiredClips => {
    const mounted = Game.units.filter(unit => unit.alive && unit.kind === 'mounted_ulan');
    return mounted.length === 4 && mounted.some(unit => {
      const data = unit.mesh?.userData;
      return !unit._cavalryTransition && !unit._cavalryAwaitingModel
        && data?.isMountedCavalry === true
        && /polish_mounted_ulan\.glb$/.test(data.modelPath || '')
        && requiredClips.every(name => data.clipNames?.includes(name) && data.actions?.[name]);
    });
  }, REQUIRED_CLIPS, { timeout: 120_000, polling: 100 });

  const result = await page.evaluate(async requiredClips => {
    Game._paused = true;
    const DT = 1 / 30;
    const round = (number, places = 4) => Number.isFinite(number)
      ? Number(number.toFixed(places)) : number;
    const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
    const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

    let cavalry = Game.units.find(unit => unit.alive && unit.kind === 'mounted_ulan'
      && !unit._cavalryTransition && !unit._cavalryAwaitingModel
      && requiredClips.every(name => unit.mesh?.userData?.actions?.[name]));
    const cavalryId = cavalry.id;
    const carrier = Game.units.find(unit => unit.alive && unit.team === Game.TEAM.POLISH
      && unit.supportType === 'transport');
    const building = (Game.buildingRecords || []).find(record => !record.collapsed
      && (record.occupants?.length || 0) < (record.capacity || 0));

    const currentCavalry = () => Game.units.find(unit => unit.id === cavalryId) || cavalry;
    const waitForState = async (mounted, timeoutMs = 20_000) => {
      const started = performance.now();
      while (performance.now() - started < timeoutMs) {
        let unit = currentCavalry();
        if (unit && unit._cavalryMounted === mounted
          && !unit._cavalryTransition && !unit._cavalryAwaitingModel) return unit;
        // State transitions are simulation-time driven while this harness keeps
        // the live game paused. Advance fixed 30 Hz ticks in batches so a long
        // authored one-shot does not make the test wait at playback speed; yield
        // to the browser between batches so asynchronous model loading can settle.
        if (unit && !unit._cavalryAwaitingModel) {
          for (let tick = 0; tick < 30; tick++) {
            Game.gameClock += DT;
            Game.updateUnit(unit, DT);
            unit = currentCavalry();
            if (!unit || unit._cavalryAwaitingModel
              || (unit._cavalryMounted === mounted && !unit._cavalryTransition)) break;
          }
        }
        await sleep(unit?._cavalryAwaitingModel ? 25 : 0);
      }
      return currentCavalry();
    };
    const stateSnapshot = unit => ({
      kind: unit?.kind || null,
      mountedFlag: unit?._cavalryMounted,
      canMount: unit?._cavalryCanMount,
      isMounted: !!unit && Game.isMountedCavalry(unit),
      isFoot: !!unit && Game.isFootInfantry(unit),
      transition: !!unit?._cavalryTransition,
      transitionPhase: unit?._cavalryTransition?.phase || null,
      transitionRemaining: unit?._cavalryTransition?.remaining ?? null,
      awaitingModel: !!unit?._cavalryAwaitingModel,
      modelPath: unit?.mesh?.userData?.modelPath || null,
      modelMountedTag: unit?.mesh?.userData?.isMountedCavalry ?? null,
      clipNames: unit?.mesh?.userData?.clipNames || [],
    });

    // Mounted horses must not enter either foot-infantry container. Use the
    // actual order entry points so this guards their selection filters rather
    // than merely re-testing Game.isFootInfantry in isolation.
    Game.units = [cavalry, carrier].filter(Boolean);
    Game._unitByIdSize = -1;
    Game.playerTeam = Game.TEAM.POLISH;
    Game.selection.clear();
    Game.selection.add(cavalry.id);
    cavalry._enterRec = null;
    cavalry._enterCarrierId = null;
    cavalry._garrisoned = false;
    if (building && Game.orderEnterBuilding) Game.orderEnterBuilding(building);
    const buildingOrderRejected = !building || (cavalry._enterRec == null
      && !building.occupants?.includes(cavalry.id));
    cavalry._enterRec = null;
    const directGarrisonAccepted = !!(building && Game.garrisonUnit
      && Game.garrisonUnit(cavalry, building));
    if (directGarrisonAccepted) {
      if (Game.ungarrisonUnit) Game.ungarrisonUnit(cavalry);
      else {
        building.occupants = (building.occupants || []).filter(id => id !== cavalry.id);
        cavalry._garrisoned = false;
        cavalry._garrisonRec = null;
        if (cavalry.mesh) cavalry.mesh.visible = true;
      }
    }
    const buildingRejected = buildingOrderRejected && !directGarrisonAccepted;
    if (carrier) {
      carrier._boardingQueue = [];
      carrier._passengers = [];
      if (Game.orderEnterCarrier) Game.orderEnterCarrier(carrier);
    }
    const transportOrderRejected = !carrier || (cavalry._enterCarrierId == null
      && !carrier._boardingQueue?.includes(cavalry.id)
      && !carrier._passengers?.includes(cavalry.id));
    const directLoadAccepted = !!(carrier && Game.loadUnit && Game.loadUnit(cavalry, carrier));
    if (directLoadAccepted) {
      carrier._passengers = (carrier._passengers || []).filter(id => id !== cavalry.id);
      carrier._boardingQueue = (carrier._boardingQueue || []).filter(id => id !== cavalry.id);
      cavalry._inVehicle = null;
      cavalry._enterCarrierId = null;
      if (cavalry.mesh) cavalry.mesh.visible = true;
    }
    const transportRejected = transportOrderRejected && !directLoadAccepted;

    // Exercise both the direct state API and the selected-unit HUD action.
    const directDismountResult = Game.setCavalryMounted(cavalry, false, { silent: true });
    if (directDismountResult?.then) await directDismountResult;
    cavalry = await waitForState(false);
    const directDismounted = stateSnapshot(cavalry);

    const directMountResult = Game.setCavalryMounted(cavalry, true, { silent: true });
    if (directMountResult?.then) await directMountResult;
    cavalry = await waitForState(true);
    const directMounted = stateSnapshot(cavalry);

    Game.selection.clear();
    Game.selection.add(cavalry.id);
    const toggleDismountResult = Game.toggleSelectedCavalry();
    if (toggleDismountResult?.then) await toggleDismountResult;
    cavalry = await waitForState(false);
    const toggleDismounted = stateSnapshot(cavalry);

    Game.selection.clear();
    Game.selection.add(cavalry.id);
    const toggleMountResult = Game.toggleSelectedCavalry();
    if (toggleMountResult?.then) await toggleMountResult;
    cavalry = await waitForState(true);
    const toggleMounted = stateSnapshot(cavalry);

    // Isolate locomotion from generated terrain and other actors while retaining
    // the production update loop and mounted driver. This makes the numeric trace
    // exactly reproducible and gives separation/avoidance no outside influence.
    Game.units = [cavalry];
    Game._unitByIdSize = -1;
    const openTile = {
      type: 'grass', blocked: false, vehicleBlocked: false,
      sightBlock: false, move: 1, cover: 0, concealment: 0,
    };
    Game.getTile = (tx, ty) => (tx >= 0 && ty >= 0
      && tx < Game.MAP_COLS && ty < Game.MAP_ROWS ? openTile : null);
    Game.getTileAtWorld = (x, z) => (x >= 0 && z >= 0
      && x < Game.WORLD_W && z < Game.WORLD_H ? openTile : null);
    Game.isBlocked = (tx, ty) => !Game.getTile(tx, ty);
    Game.getHeight = () => 0;
    Game.getVehicleHeight = () => 0;
    Game.getTerrainSlope = () => 0;
    Game.getWeatherSpeedMod = () => 1;
    Game._dynObs = null;
    Game._dynVehicles = null;

    const start = { x: 48, z: 48 };
    const target = { x: 78, z: 48 };
    for (const key of [
      '_detour', '_engageId', '_faceAngle', '_faceGoal', '_moveBlockedGoal',
      '_rerouteFor', '_assaultGoal', '_pursueAnchor', '_enterRec',
    ]) cavalry[key] = null;
    Object.assign(cavalry, {
      x: start.x, z: start.z, y: 0,
      angle: 0.85, turretAngle: 0.85,
      path: [{ x: target.x, z: target.z, _exactGoal: true }],
      moving: true, currentSpeed: 0, _dispSpeed: 0,
      stopTimer: 0, orderDelay: 0, orderMode: 'move',
      stance: 'stand', _autoStance: false,
      suppressionValue: 0, underFire: 0, shaken: 0,
      aiState: 'player', _ai: 'player', behavior: 'defensive',
      fireTargetId: null, forcedTargetId: null,
      retreating: false, entrenched: false,
      _groupMoveActive: false, _groupSpeed: null,
      _cavalryTransition: false, _cavalryAwaitingModel: false,
    });
    if (cavalry.mesh) {
      cavalry.mesh.position.set(cavalry.x, cavalry.y, cavalry.z);
      cavalry.mesh.rotation.y = -cavalry.angle;
    }

    const frames = [];
    let previous = { x: cavalry.x, z: cavalry.z, angle: cavalry.angle, speed: 0 };
    let elapsed = 0;
    let stableFor = 0;
    let arrivalPose = null;
    let postArrivalDrift = 0;
    let postArrivalYaw = 0;
    for (let step = 0; step < 1200; step++) {
      Game.gameClock += DT;
      elapsed += DT;
      Game.updateUnit(cavalry, DT);
      const dx = cavalry.x - previous.x;
      const dz = cavalry.z - previous.z;
      const travel = Math.hypot(dx, dz);
      const yaw = angleDelta(previous.angle, cavalry.angle);
      const midAngle = previous.angle + yaw * 0.5;
      const lateral = Math.abs(-Math.sin(midAngle) * dx + Math.cos(midAngle) * dz);
      const remaining = Game.dist(cavalry.x, cavalry.z, target.x, target.z);
      frames.push({
        step,
        t: elapsed,
        x: cavalry.x,
        z: cavalry.z,
        angle: cavalry.angle,
        speed: Math.abs(cavalry.currentSpeed || 0),
        dispSpeed: Math.abs(cavalry._dispSpeed || 0),
        travel,
        yaw: Math.abs(yaw),
        lateral,
        remaining,
        pathNodes: cavalry.path?.length || 0,
        moving: !!cavalry.moving,
      });

      const stopped = (cavalry.path?.length || 0) === 0
        && Math.abs(cavalry.currentSpeed || 0) <= 0.05;
      if (stopped && remaining <= 0.8) {
        stableFor += DT;
        arrivalPose ||= { x: cavalry.x, z: cavalry.z, angle: cavalry.angle };
        postArrivalDrift = Math.max(postArrivalDrift,
          Game.dist(cavalry.x, cavalry.z, arrivalPose.x, arrivalPose.z));
        postArrivalYaw = Math.max(postArrivalYaw,
          Math.abs(angleDelta(arrivalPose.angle, cavalry.angle)));
        if (stableFor >= 1.0) break;
      } else {
        stableFor = 0;
        arrivalPose = null;
      }
      previous = { x: cavalry.x, z: cavalry.z, angle: cavalry.angle,
        speed: Math.abs(cavalry.currentSpeed || 0) };
    }

    const movingFrames = frames.filter(frame => frame.travel > 0.0001 || frame.speed > 0.0001);
    const firstMovingIndex = frames.findIndex(frame => frame.travel > 0.0001 || frame.speed > 0.0001);
    const peakSpeed = frames.reduce((max, frame) => Math.max(max, frame.speed), 0);
    const peakIndex = frames.findIndex(frame => frame.speed === peakSpeed);
    const firstMovingSpeed = firstMovingIndex >= 0 ? frames[firstMovingIndex].speed : 0;
    let risingFrames = 0;
    let brakingFrames = 0;
    let maxPositiveAcceleration = 0;
    let maxBrakingDeceleration = 0;
    let maxFrameTravel = 0;
    let maxFrameYaw = 0;
    let totalYaw = 0;
    let maxLateralSlip = 0;
    for (let index = 0; index < frames.length; index++) {
      const frame = frames[index];
      maxFrameTravel = Math.max(maxFrameTravel, frame.travel);
      maxFrameYaw = Math.max(maxFrameYaw, frame.yaw);
      totalYaw += frame.yaw;
      maxLateralSlip = Math.max(maxLateralSlip, frame.lateral);
      if (index === 0) continue;
      const deltaSpeed = frame.speed - frames[index - 1].speed;
      maxPositiveAcceleration = Math.max(maxPositiveAcceleration, deltaSpeed / DT);
      maxBrakingDeceleration = Math.max(maxBrakingDeceleration, -deltaSpeed / DT);
      if (index <= peakIndex && deltaSpeed > 0.005) risingFrames++;
      if (index > peakIndex && deltaSpeed < -0.005) brakingFrames++;
    }
    const finalFrame = frames.at(-1);
    const finalModel = stateSnapshot(cavalry);
    const clipReady = requiredClips.every(name => finalModel.clipNames.includes(name));
    const motion = {
      elapsed: round(elapsed, 3),
      frameCount: frames.length,
      movingFrameCount: movingFrames.length,
      firstMovingSpeed: round(firstMovingSpeed),
      peakSpeed: round(peakSpeed),
      peakFrame: peakIndex,
      risingFrames,
      brakingFrames,
      maxPositiveAcceleration: round(maxPositiveAcceleration),
      maxBrakingDeceleration: round(maxBrakingDeceleration),
      maxFrameTravel: round(maxFrameTravel),
      maxFrameYaw: round(maxFrameYaw),
      totalYaw: round(totalYaw),
      maxLateralSlip: round(maxLateralSlip, 5),
      stableFor: round(stableFor),
      postArrivalDrift: round(postArrivalDrift, 5),
      postArrivalYaw: round(postArrivalYaw, 5),
      finalRemaining: round(finalFrame?.remaining ?? Infinity),
      finalSpeed: round(finalFrame?.speed ?? Infinity),
      finalPathNodes: finalFrame?.pathNodes ?? -1,
      rotationSpeed: cavalry.rotationSpeed,
      config: { ...Game.CAVALRY_MOVE },
      trace: frames.filter((frame, index) => index < 8
        || Math.abs(index - peakIndex) <= 2
        || index >= frames.length - 8).map(frame => ({
        step: frame.step,
        t: round(frame.t, 3),
        x: round(frame.x),
        z: round(frame.z),
        angle: round(frame.angle),
        speed: round(frame.speed),
        travel: round(frame.travel, 5),
        yaw: round(frame.yaw, 5),
        lateral: round(frame.lateral, 5),
        remaining: round(frame.remaining),
        pathNodes: frame.pathNodes,
      })),
    };

    return {
      footEligibility: {
        buildingAvailable: !!building,
        carrierAvailable: !!carrier,
        buildingOrderRejected,
        directGarrisonRejected: !directGarrisonAccepted,
        buildingRejected,
        transportOrderRejected,
        directLoadRejected: !directLoadAccepted,
        transportRejected,
      },
      swaps: {
        directDismounted,
        directMounted,
        toggleDismounted,
        toggleMounted,
        finalModel,
        clipReady,
      },
      motion,
    };
  }, REQUIRED_CLIPS);

  const failures = [];
  const expect = (condition, message) => { if (!condition) failures.push(message); };
  const { footEligibility, swaps, motion } = result;
  const dismountedOk = state => state.kind === 'ulan'
    && state.mountedFlag === false && state.canMount === true
    && state.isMounted === false && state.isFoot === true
    && !state.transition && !state.awaitingModel
    && state.modelMountedTag === false;
  const mountedOk = state => state.kind === 'mounted_ulan'
    && state.mountedFlag === true && state.canMount === true
    && state.isMounted === true && state.isFoot === false
    && !state.transition && !state.awaitingModel
    && state.modelMountedTag === true
    && /polish_mounted_ulan\.glb$/.test(state.modelPath || '');

  expect(footEligibility.carrierAvailable && footEligibility.transportRejected,
    'mounted cavalry was accepted by a troop transport');
  expect(!footEligibility.buildingAvailable || footEligibility.buildingRejected,
    'mounted cavalry was accepted by a building');
  expect(dismountedOk(swaps.directDismounted),
    'setCavalryMounted did not produce a ready foot-ułan state');
  expect(mountedOk(swaps.directMounted),
    'setCavalryMounted did not restore the mounted-ułan state');
  expect(dismountedOk(swaps.toggleDismounted),
    'toggleSelectedCavalry did not dismount the selected ułan');
  expect(mountedOk(swaps.toggleMounted) && mountedOk(swaps.finalModel) && swaps.clipReady,
    'toggleSelectedCavalry did not restore the tagged model and canonical clips');

  expect(motion.movingFrameCount > 20 && motion.peakSpeed > 1,
    'mounted cavalry did not travel under the production movement driver');
  expect(motion.firstMovingSpeed > 0
    && motion.firstMovingSpeed < motion.peakSpeed * 0.45
    && motion.risingFrames >= 3 && motion.peakFrame >= 4,
  'mounted cavalry snapped to speed instead of accelerating gradually');
  expect(motion.maxPositiveAcceleration <= motion.config.acceleration * 1.08 + 0.02,
    'mounted cavalry exceeded its configured acceleration bound');
  expect(motion.maxBrakingDeceleration <= motion.config.braking * 1.08 + 0.02,
    'mounted cavalry exceeded its configured braking bound');
  expect(motion.maxFrameYaw <= motion.rotationSpeed / 30 * 1.12 + 0.004
    && motion.totalYaw >= 0.45,
    'mounted cavalry turning was unbounded or did not execute the opening turn');
  expect(motion.brakingFrames >= 3 && motion.finalSpeed <= 0.05
    && motion.finalPathNodes === 0 && motion.finalRemaining <= 0.8
    && motion.stableFor >= 0.95,
  'mounted cavalry did not brake and settle near its target');
  expect(motion.maxFrameTravel <= motion.peakSpeed / 30 * 1.2 + 0.01,
    'mounted cavalry position snapped between fixed simulation frames');
  expect(motion.maxLateralSlip <= 0.025,
    'mounted cavalry slid sideways relative to its heading');
  expect(motion.postArrivalDrift <= 0.02 && motion.postArrivalYaw <= 0.02,
    'mounted cavalry drifted or pivoted after stopping');

  const realErrors = errors.filter(error =>
    !/Failed to load resource|status of 404|404 \(|THREE\.GLTFLoader: Couldn't load texture blob:/i.test(error));
  if (realErrors.length) failures.push(...realErrors);

  if (failures.length) {
    console.error(`Cavalry movement FAIL:\n- ${failures.join('\n- ')}`);
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } else {
    console.log(`Cavalry movement OK: ${JSON.stringify(result)}`);
  }
} finally {
  await browser.close();
}

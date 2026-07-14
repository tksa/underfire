/**
 * Under Fire — config.js
 * Global constants, shared state, and the Game namespace.
 * Adapted for Three.js 3D rendering.
 */
window.Game = {};
const Game = window.Game;

// Network paths remain logical repository paths throughout the simulation.
// Resolve them only at the load boundary so model-cache keys and unit identity
// checks stay stable. Production routes heavyweight assets through Bunny;
// localhost/CI and the automatic CDN fallback return the original paths.
Game.assetVersion = window.UF_REQUEST_VERSION || window.UF_ASSET_VERSION || 'dev';
Game.assetUrl = typeof window.ufAssetUrl === 'function'
  ? window.ufAssetUrl
  : (path => path);
Game.prepareAssetCdn = typeof window.ufPrepareAssetCdn === 'function'
  ? window.ufPrepareAssetCdn
  : (async () => false);

// Tile / map dimensions
Game.TILE = 3;          // 3D world units per tile
Game.MAP_COLS = 100;
Game.MAP_ROWS = 100;
Game.WORLD_W = Game.MAP_COLS * Game.TILE;
Game.WORLD_H = Game.MAP_ROWS * Game.TILE;

// ── Model scale rule (single source of truth) ──────────────────────────
// Anchored to infantry: a ~1.8 m soldier reads at ~2.45 world units tall, so
// 1 metre ≈ 1.35 world units (a 3-unit tile ≈ 2.2 m). The model pipeline exports
// every mesh at TRUE METRE scale; the loader applies this one factor, so all
// units are proportional with no per-model fudging. Vehicles are compressed for
// grid playability (infantry stay 1:1). See docs/MODEL_PIPELINE.md.
Game.SCALE = {
  unitsPerMeter: 1.35,
  vehicleCompression: 0.65,
};

// Teams and boot-time scenario selection. Dyle is the default/first battle;
// the menu persists a different choice before reloading the matching world.
Game.TEAM = { POLISH: 'polish', FRENCH: 'french', GERMAN: 'german' };
Game.currentScenario = (() => {
  try { return localStorage.getItem('uf_mission') === 'mokra' ? 'mokra' : 'dyle'; }
  catch (e) { return 'dyle'; }
})();
Game.selectedMission = Game.currentScenario;

// Which side the HUMAN plays (menu-selectable, persisted). Everything
// player-facing keys off these instead of hardcoding French: selection, fog
// reveal, orders, voices, mission logic. The other side runs the combat AI.
Game.playerTeam = (() => {
  if (Game.currentScenario === 'mokra') return Game.TEAM.POLISH;
  try { return localStorage.getItem('uf_side') === 'german' ? 'german' : 'french'; }
  catch (e) { return 'french'; }
})();
Game.enemyTeam = () => {
  const scenario = Game.SCENARIOS && Game.SCENARIOS[Game.currentScenario];
  if (scenario && scenario.teams) {
    return Game.playerTeam === scenario.teams.enemy ? scenario.teams.player : scenario.teams.enemy;
  }
  return Game.playerTeam === Game.TEAM.FRENCH ? Game.TEAM.GERMAN : Game.TEAM.FRENCH;
};

// Shared arrays
Game.terrain = [];
Game.buildings = [];
Game.walls = [];
Game.craters = [];
Game.defenses = [];     // sapper-built sandbag emplacements (cover objects)
Game.dynamicCraters = [];
Game.CRATER_Y_OFFSET = 0.12; // Live updatable via dev console!
Game.smoke = [];
Game.tracers = [];
Game.units = [];
Game.messages = [];

// 3D scene objects (populated by engine.js)
Game.scene = null;
Game.renderer = null;
Game.camera = null;
Game.cssRenderer = null;
Game.raycaster = null;
Game.groundPlane = null;
Game.terrainGroup = null;
Game.unitsGroup = null;
Game.effectsGroup = null;

// Camera state
Game.cam = { x: Game.WORLD_W / 2, z: Game.WORLD_H / 2, zoom: 20, targetZoom: 20 };
Game.zoomMin = 16;
Game.zoomMax = 80;

// Mouse / input state
Game.mouse = {
  x: 0, y: 0,           // screen coordinates (normalized -1 to 1)
  screenX: 0, screenY: 0, // pixel coordinates
  worldX: 0, worldZ: 0,   // world coordinates on ground plane
  down: false,
  dragStartX: 0, dragStartY: 0,
  dragCurrentX: 0, dragCurrentY: 0
};
Game.keys = {};
Game.selection = new Set();
Game.hoverUnit = null;

// Timing
Game.lastTime = performance.now();
Game.gameClock = 0;
Game.cameraShake = 0;
Game.nextUnitId = 1;

// HUD elements (set during boot)
Game.hud = {};

// Default right-click order stance: 'move' (relocate, weapons stowed) or
// 'attack' (attack-move: advance ready, stop to engage). Toggled from the
// Orders switch in the HUD. Right-clicking an enemy always attacks it.
Game.orderStance = 'move';

// Which status bars to draw above units (player-toggleable from the bottom bar).
// All off by default — a clean battlefield; the player opts in. Fuel only
// applies to vehicles; ammo only to units that carry ammo.
Game.overlay = { hp: false, ammo: false, fuel: false, units: false };

// Mission state
Game.missionState = {
  won: false, lost: false,
  objectiveX: (Game.MAP_COLS - 9) * Game.TILE,
  objectiveY: 7 * Game.TILE,
  timer: 0, reinforcementTriggered: false,
  phase: 1, phaseName: 'Deployment',
  primaryObjective: '', secondaryObjective: '', briefing: '',
  holdDuration: 0, contestedTime: 0, enemyLosses: 0, enemyCommitted: 0
};

// Viewport dimensions (set during boot)
Game.viewW = 0;
Game.viewH = 0;

// Model cache
Game.modelCache = {};

// References set by engine/terrain
Game.sun = null;
Game.objectiveRing = null;
Game.gltfLoader = null;
Game.THREE = null;

// Heightmap data (populated by terrain.js)
Game.heightData = null;    // Float32Array (procedurally generated)
Game.heightW = 0;
Game.heightH = 0;
Game.HEIGHT_SCALE = 3.5;   // world-unit height of the tallest hills
Game.WATER_LEVEL = -999;   // no water bodies on this map
Game.WATER_SURFACE_OVERFLOW = 0.7;   // soft terrain-bed influence beyond painted water
Game.WATER_SHORE_KERNEL_TILES = 1.55;
Game.WATER_SHORE_THRESHOLD = 0.24;
Game.WATER_SHORE_SOFTNESS = 0.2;
Game.WATER_SHORE_JITTER = 0.25;   // organic shoreline wiggle (break the tile grid)
Game.WATER_BED_DEPTH = 0.55;      // channel depth below the waterline in pools
Game.WATER_BED_EDGE = 0.18;       // depth right at the shore
Game.WATER_BED_SLOPE = 1.15;
Game.WATER_FLOOD_TILES = 2.6;     // floodplain: meadow eases down to the water over this many tiles
Game.terrainMesh = null;

// Game starts paused behind the main menu
Game._paused = true;

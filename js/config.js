/**
 * Under Fire — config.js
 * Global constants, shared state, and the Game namespace.
 * Adapted for Three.js 3D rendering.
 */
window.Game = {};
const Game = window.Game;

// Tile / map dimensions
Game.TILE = 3;          // 3D world units per tile
Game.MAP_COLS = 100;
Game.MAP_ROWS = 100;
Game.WORLD_W = Game.MAP_COLS * Game.TILE;
Game.WORLD_H = Game.MAP_ROWS * Game.TILE;

// Teams
Game.TEAM = { FRENCH: 'french', GERMAN: 'german' };

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
Game.overlay = { hp: false, ammo: false, fuel: false };

// Mission state
Game.missionState = {
  won: false, lost: false,
  objectiveX: (Game.MAP_COLS - 9) * Game.TILE,
  objectiveY: 7 * Game.TILE,
  timer: 0, reinforcementTriggered: false
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
Game.waterGroup = null;
Game.waterMesh = null;
Game.terrainMesh = null;

// Game starts paused behind the main menu
Game._paused = true;

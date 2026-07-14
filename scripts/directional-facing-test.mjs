#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.Game = {};
require('../js/input.js');

Object.assign(Game, {
  WORLD_W: 100,
  WORLD_H: 100,
  TEAM: { FRENCH: 'french' },
  playerTeam: 'french',
  gameClock: 12,
  clamp: (value, lo, hi) => Math.max(lo, Math.min(hi, value)),
  dist: (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az),
  angleTo: (ax, az, bx, bz) => Math.atan2(bz - az, bx - ax),
  isTank: () => false,
  isTruck: () => false,
  isFootInfantry: () => true,
  formationOffsets: () => [{ x: -1, z: 0 }, { x: 1, z: 0 }],
});

const formation = [
  { id: 1, kind: 'rifleman', team: 'french', alive: true, x: 40, z: 40 },
  { id: 2, kind: 'rifleman', team: 'french', alive: true, x: 42, z: 40 },
];
const eastFacing = Game.computeFormationTargets(formation, 60, 60, 0);
assert.equal(eastFacing.length, 2);
assert(eastFacing.every(target => Math.abs(target.x - 60) < 1e-9),
  'a line facing east must be laid north-south');
assert(Math.abs(eastFacing[0].z - eastFacing[1].z) > 1.9,
  'directional formation slots collapsed instead of spanning the frontage');

assert(Game.directionalOrderNearby(formation, 41, 41),
  'a drag beside the group should become an in-place facing order');
assert(!Game.directionalOrderNearby(formation, 55, 55),
  'a distant drag should remain a movement order');

const arriving = {
  kind: 'rifleman', x: 20.4, z: 20.1, path: [], moving: true,
  stopTimer: 0, _lastMoveOrder: { id: 7 },
  _arrivalFacing: { orderId: 7, goalX: 20, goalZ: 20, angle: 1.25 },
};
assert(Game.tryActivateArrivalFacing(arriving),
  'matching final-facing intent did not activate at its destination');
assert.equal(arriving._faceAngle, 1.25);
assert.equal(arriving._arrivalFacing, null);
assert.equal(arriving.moving, false);

const interrupted = {
  kind: 'rifleman', x: 5, z: 5, path: [],
  _lastMoveOrder: { id: 8 },
  _arrivalFacing: { orderId: 8, goalX: 40, goalZ: 40, angle: 0.5 },
};
assert(!Game.tryActivateArrivalFacing(interrupted),
  'a temporary path interruption activated final facing far from the goal');
assert(interrupted._arrivalFacing,
  'attack/replan interruption discarded the pending final heading');

const crowded = {
  kind: 'rifleman', x: 22, z: 20, path: [], moving: false,
  stopTimer: 0, orderMode: 'move', _lastMoveOrder: { id: 11 },
  _arrivalFacing: { orderId: 11, goalX: 20, goalZ: 20, angle: -0.75 },
};
assert(Game.tryActivateArrivalFacing(crowded),
  'accepted crowded infantry settle did not activate final facing');

const assaultPause = {
  kind: 'rifleman', x: 21.5, z: 20, path: [], moving: false,
  orderMode: 'assault', _assaultGoal: { x: 20, z: 20 },
  _lastMoveOrder: { id: 12 },
  _arrivalFacing: { orderId: 12, goalX: 20, goalZ: 20, angle: 0.9 },
};
assert(!Game.tryActivateArrivalFacing(assaultPause),
  'temporary attack-move pause activated facing before objective completion');
assaultPause._assaultGoal = null;
assert(Game.tryActivateArrivalFacing(assaultPause),
  'completed attack-move objective did not activate final facing');

const stale = {
  kind: 'rifleman', x: 20, z: 20, path: [],
  _lastMoveOrder: { id: 10 },
  _arrivalFacing: { orderId: 9, goalX: 20, goalZ: 20, angle: 0.5 },
};
assert(!Game.tryActivateArrivalFacing(stale));
assert.equal(stale._arrivalFacing, null,
  'a superseded movement order retained stale final-facing state');

Game.moveOrderParticipants = units => units;
let faceCall = null;
let moveCall = null;
Game.orderFaceAngle = (...args) => { faceCall = args; };
Game.issueCommand = (...args) => { moveCall = args; };

assert(Game.issueDirectionalCommand(41, 41, 45, 41, {
  units: formation,
  mode: 'move',
}));
assert(faceCall && Math.abs(faceCall[0]) < 1e-9,
  'nearby directional order did not rotate to the shared arrow angle');
assert.equal(moveCall, null);

faceCall = null;
assert(Game.issueDirectionalCommand(70, 70, 70, 75, {
  units: formation,
  mode: 'attack',
}));
assert(moveCall, 'distant directional order did not dispatch movement');
assert.equal(moveCall[2], 'attack');
assert(Math.abs(moveCall[6].angle - Math.PI / 2) < 1e-9,
  'movement order did not retain the arrow heading');

moveCall = null;
assert(Game.issueDirectionalCommand(70, 70, 75, 70, {
  units: formation,
  mode: 'attack',
  gather: true,
}));
assert.equal(moveCall[2], 'move',
  'Ctrl/Cmd gather drag incorrectly inherited attack-move stance');
assert.equal(moveCall[5], true,
  'Ctrl/Cmd gather flag was lost by the directional order');

faceCall = null;
moveCall = null;
assert(Game.issueDirectionalCommand(41, 41, 45, 41, {
  units: formation,
  mode: 'attack',
  gather: true,
}));
assert.equal(faceCall, null,
  'nearby Ctrl/Cmd drag incorrectly became rotate-only');
assert(moveCall && moveCall[2] === 'move' && moveCall[5] === true,
  'nearby Ctrl/Cmd drag did not preserve gather movement');

Object.assign(Game, {
  _commandMode: null,
  selectedFighter: null,
  selectedBuilding: null,
  selectedPlayerUnits: () => formation,
  unitAtScreen: () => null,
  horseAtScreen: () => null,
  horseAtWorld: () => null,
  enemyAtWorld: () => null,
  buildingAtScreen: () => null,
  buildingAt: () => null,
});
assert(Game._canDeferTerrainRightOrder(100, 100, { x: 30, z: 30 }),
  'open terrain was not eligible for right-drag detection');
Game.enemyAtWorld = () => ({ id: 99, team: 'german' });
assert(!Game._canDeferTerrainRightOrder(100, 100, { x: 30, z: 30 }),
  'contextual enemy click was incorrectly deferred as a terrain drag');

// Exercise the real registered pointer callbacks with a minimal DOM/event shim.
const containerListeners = {};
const windowListeners = {};
const container = {
  addEventListener: (type, handler) => { containerListeners[type] = handler; },
};
globalThis.document = { getElementById: () => container };
globalThis.window = {
  innerHeight: 800,
  addEventListener: (type, handler) => { windowListeners[type] = handler; },
};
Game.mouse = {
  screenX: 0, screenY: 0, worldX: 0, worldZ: 0, down: false,
  dragStartX: 0, dragStartY: 0, dragCurrentX: 0, dragCurrentY: 0,
};
Game.selection = new Set(formation.map(unit => unit.id));
Game.orderStance = 'move';
Game.getUnitById = id => formation.find(unit => unit.id === id) || null;
Game.screenToGround = (x, y) => ({ x: x / 10, z: y / 10 });
Game.enemyAtWorld = () => null;
Game._showRightOrderArrow = () => {};
Game._clearRightOrderArrow = () => {};
Game._showFormationPreview = () => {};
Game._clearFormationPreview = () => {};
Game.handleInputEvents();

const pointer = (button, x, y) => ({
  button, clientX: x, clientY: y,
  shiftKey: false, ctrlKey: false, metaKey: false,
  preventDefault: () => {},
});
let dispatchedDrag = null;
Game.issueDirectionalCommand = (...args) => { dispatchedDrag = args; return true; };
containerListeners.mousedown(pointer(2, 100, 100));
assert(Game._rightOrderDrag, 'open-terrain right-down did not begin drag detection');
windowListeners.mousemove(pointer(2, 150, 100));
windowListeners.mouseup(pointer(2, 150, 100));
assert(dispatchedDrag, 'right-drag release did not dispatch a directional order');
assert.deepEqual(dispatchedDrag.slice(0, 4), [10, 10, 15, 10],
  'the destination/arrow endpoint were not retained from press/release');
assert.equal(Game._rightOrderDrag, null, 'right-drag state survived mouse release');

Game._lastRC = null;
let dispatchedClick = null;
Game.issueCommand = (...args) => { dispatchedClick = args; };
containerListeners.mousedown(pointer(2, 200, 200));
windowListeners.mouseup(pointer(2, 200, 200));
assert(dispatchedClick, 'click-only right order was lost while adding drag detection');
assert.deepEqual(dispatchedClick.slice(0, 3), [20, 20, 'move']);

console.log('Directional facing order checks passed.');

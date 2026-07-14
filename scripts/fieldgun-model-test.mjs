#!/usr/bin/env node

/**
 * Pure-Node contract check for the Polish 75 mm Armata presentation.
 *
 * It inspects the shipped GLB axis, evaluates the real placement configuration,
 * checks the shared soldier rig/weapon hierarchy, and exercises async two-man
 * crew replacement/recoil with small Three.js stand-ins. It does not start a
 * server, browser, renderer, or game session.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as RealTHREE from '../vendor/three-0.180.0.module.min.js';

const require = createRequire(import.meta.url);

const readGlb = path => {
  const bytes = fs.readFileSync(path);
  let cursor = 12;
  let json = null;
  let binary = null;
  while (cursor < bytes.length) {
    const length = bytes.readUInt32LE(cursor);
    const type = bytes.toString('ascii', cursor + 4, cursor + 8);
    const chunk = bytes.subarray(cursor + 8, cursor + 8 + length);
    if (type === 'JSON') json = JSON.parse(chunk.toString('utf8').replace(/[\0 ]+$/, ''));
    if (type.startsWith('BIN')) binary = chunk;
    cursor += 8 + length;
  }
  return { json, binary };
};

const { json, binary } = readGlb(new URL('../models/polish_fieldgun75.glb', import.meta.url));
assert(json && binary, 'Armata GLB is missing its JSON or binary chunk');
const primitive = json.meshes[0].primitives[0];
const accessor = json.accessors[primitive.attributes.POSITION];
const view = json.bufferViews[accessor.bufferView];
const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
const stride = view.byteStride || 12;
const vertices = [];
for (let index = 0; index < accessor.count; index++) {
  const at = offset + index * stride;
  vertices.push({
    x: binary.readFloatLE(at),
    y: binary.readFloatLE(at + 4),
    z: binary.readFloatLE(at + 8),
  });
}

const farNegative = vertices.filter(vertex => vertex.x < -0.4);
const farPositive = vertices.filter(vertex => vertex.x > 0.4);
const meanY = points => points.reduce((sum, point) => sum + point.y, 0) / points.length;
assert(farNegative.length && farPositive.length, 'could not sample both ends of the Armata mesh');
assert(meanY(farNegative) > meanY(farPositive) + 0.12,
  'asset-axis contract changed: the elevated muzzle is no longer on authored local -X');

globalThis.Game = {
  TEAM: { FRENCH: 'french', GERMAN: 'german', POLISH: 'polish' },
  WEAPONS: {},
};
require('../js/units.js');
assert.equal(Game.MODEL_YAW.polish_fieldgun75, Math.PI,
  'Armata is missing the half-turn that maps its authored -X muzzle to +Z forward');

const rotateXZ = ({ x, z }, yaw) => ({
  x: x * Math.cos(yaw) + z * Math.sin(yaw),
  z: -x * Math.sin(yaw) + z * Math.cos(yaw),
});
const normalizedMuzzle = rotateXZ({ x: -1, z: 0 }, -Math.PI / 2);
const correctedMuzzle = rotateXZ(normalizedMuzzle, Game.MODEL_YAW.polish_fieldgun75);
assert(correctedMuzzle.z > 0.999,
  'corrected Armata muzzle does not point along engine-local +Z');

const soldierGlb = readGlb(new URL('../models/soldier.glb', import.meta.url)).json;
assert(soldierGlb, 'shared soldier GLB has no JSON chunk');
const soldierNodes = soldierGlb.nodes || [];
const nodeNames = new Set(soldierNodes.map(node => node.name));
const requiredRigNodes = [
  'weapon_slot_018', 'torso_010',
  'hip_left_06', 'knee_left_07', 'hip_right_02', 'knee_right_03',
  'shoulder_left_011', 'arm_left_012', 'shoulder_right_014', 'arm_right_015',
];
for (const name of requiredRigNodes) {
  assert(nodeNames.has(name), `shared soldier rig is missing ${name}`);
}
assert(soldierGlb.animations?.some(animation => animation.name === 'Take 001'),
  'shared soldier rig lost its animation timeline');
const skinnedJointNames = new Set((soldierGlb.skins?.[0]?.joints || [])
  .map(index => soldierNodes[index]?.name));
for (const name of requiredRigNodes.filter(name => name !== 'weapon_slot_018')) {
  assert(skinnedJointNames.has(name), `shared soldier skin no longer includes ${name}`);
}
const weaponSlot = soldierNodes.find(node => node.name === 'weapon_slot_018');
assert(weaponSlot?.children?.length, 'shared soldier rifle slot has no weapon subtree');

class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}
class Euler extends Vector3 {}
class Group {
  constructor() {
    this.children = [];
    this.position = new Vector3();
    this.rotation = new Euler();
    this.userData = {};
    this.visible = true;
    this.isMesh = false;
  }
  add(child) { this.children.push(child); child.parent = this; }
  remove(child) { this.children = this.children.filter(candidate => candidate !== child); }
  traverse(visitor) {
    visitor(this);
    this.children.forEach(child => child.traverse ? child.traverse(visitor) : visitor(child));
  }
}
class Geometry {
  constructor(...args) { this.args = args; }
  dispose() { this.disposed = true; }
}
class Mesh extends Group {
  constructor(geometry, material) {
    super(); this.geometry = geometry; this.material = material; this.isMesh = true;
  }
}
class Color {
  constructor(hex) {
    this.setHex(hex);
  }
  clone() {
    const color = Object.create(Color.prototype);
    color.r = this.r; color.g = this.g; color.b = this.b;
    return color;
  }
  multiplyScalar(value) {
    this.r *= value; this.g *= value; this.b *= value;
    return this;
  }
  setHex(hex) {
    this.r = ((hex >> 16) & 0xff) / 255;
    this.g = ((hex >> 8) & 0xff) / 255;
    this.b = (hex & 0xff) / 255;
    return this;
  }
  setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
  getHex() {
    const byte = value => Math.max(0, Math.min(255, Math.round(value * 255)));
    return (byte(this.r) << 16) | (byte(this.g) << 8) | byte(this.b);
  }
}
class Material {
  constructor(options) {
    Object.assign(this, options);
    this.color = options.color instanceof Color ? options.color : new Color(options.color);
  }
  clone() {
    const clone = new Material({ ...this, color: this.color.clone() });
    clone.name = this.name;
    return clone;
  }
  dispose() { this.disposed = true; }
}

const MockTHREE = {
  Group,
  Mesh,
  Color,
  MeshStandardMaterial: Material,
  CylinderGeometry: Geometry,
  BoxGeometry: Geometry,
  SphereGeometry: Geometry,
};
Game.THREE = MockTHREE;
Game.units = [];
Game.assetUrl = path => path;
Game.lerp = (a, b, amount) => a + (b - a) * amount;
Game.clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
require('../js/soldier_model.js');

// Exercise the real skin helper: the body receives the Polish tint while the
// complete rifle slot and its meshes disappear for a field-gun crewman.
const skinModel = new Group();
const skinBody = new Mesh(new Geometry(), new Material({ color: 0xffffff }));
skinBody.name = 'wwi_german_soldier_lambert2_0';
skinBody.material.name = 'lambert2';
const skinWeaponSlot = new Group();
skinWeaponSlot.name = 'weapon_slot_018';
const skinRifle = new Mesh(new Geometry(), new Material({ color: 0xffffff }));
skinRifle.name = 'mauser_k98_lambert1_0_0';
skinRifle.material.name = 'lambert1';
skinWeaponSlot.add(skinRifle);
skinModel.add(skinBody);
skinModel.add(skinWeaponSlot);
Game.applySoldierSkin(skinModel, Game.TEAM.POLISH, 'fieldgun_crew');
assert.equal(skinBody.visible, true, 'field-gun skin helper hid the soldier body');
assert.equal(skinBody.material.color.getHex(), Game.SOLDIER_SKIN_TINT.polish,
  'field-gun soldier body did not receive the Polish infantry tint');
assert.equal(skinWeaponSlot.visible, false, 'field-gun soldier rifle slot remains visible');
assert.equal(skinRifle.visible, false, 'field-gun soldier rifle mesh remains visible');

require('../js/fieldgun_model.js');

// Exercise the production crew builder against real vendored Three.js objects
// and a synthetic copy of the required rig. This catches Box3, mixer, action,
// transform and bone-rest assumptions without loading WebGL or the game.
const productionCrewBuilder = Game._makeFieldGunSoldierCrewman;
Game.THREE = RealTHREE;
const rigModel = new RealTHREE.Group();
const rigBody = new RealTHREE.Mesh(
  new RealTHREE.BoxGeometry(0.45, 1.8, 0.35),
  new RealTHREE.MeshBasicMaterial({ color: 0xffffff }),
);
rigBody.position.y = 0.9;
rigModel.add(rigBody);
for (const name of requiredRigNodes.filter(name => name !== 'weapon_slot_018')) {
  const bone = new RealTHREE.Bone();
  bone.name = name;
  rigModel.add(bone);
}
Game._fieldGunSoldierClips = ['idle', 'walk', 'crouch']
  .map(name => new RealTHREE.AnimationClip(name, 1, []));
const builtCrewman = productionCrewBuilder(
  rigModel, Game.FIELDGUN75_CREW_PLACEMENTS[0], 0,
);
assert.equal(builtCrewman.userData.isFieldGunCrewman, true,
  'production builder did not tag the real soldier crewman');
assert.deepEqual(builtCrewman.userData.clipNames, ['idle', 'walk', 'crouch'],
  'production builder did not limit crew actions to idle/walk/crouch');
assert(Object.keys(builtCrewman.userData.soldierLegRest).includes('torso_010'),
  'production builder did not capture the crew rig rest pose');
assert(Number.isFinite(builtCrewman.userData.modelWrapper.position.y),
  'production builder did not ground the shared soldier clone');
builtCrewman.userData.mixer.stopAllAction();
rigBody.geometry.dispose();
rigBody.material.dispose();
Game.THREE = MockTHREE;
Game._fieldGunSoldierClips = null;

const loadPaths = [];
const skinCalls = [];
const realApplySoldierSkin = Game.applySoldierSkin;
Game.loadModel = async path => {
  loadPaths.push(path);
  return new Group();
};
Game.applySoldierSkin = (model, team, kind) => {
  skinCalls.push({ team, kind });
  realApplySoldierSkin(model, team, kind);
};
let animationUpdates = 0;
Game._updateModelAnimation = () => { animationUpdates++; };
// The production builder is covered by asset/skeleton contracts above. This
// stand-in isolates the async attachment and placement lifecycle from WebGL.
Game._makeFieldGunSoldierCrewman = (model, placement, index) => {
  const figure = new Group();
  figure.name = `fieldGunSoldierCrewman_${index + 1}`;
  figure.position.set(placement.x, 0.01, placement.z);
  figure.rotation.y = Math.PI;
  Object.assign(figure.userData, {
    isSoldier: true,
    isFieldGunCrewman: true,
    phaseOffset: placement.phase,
    fieldGunRestStance: placement.restStance,
    animationUnit: { mesh: figure, stance: placement.restStance, currentSpeed: 0, _dispSpeed: 0 },
  });
  return figure;
};

const wrapper = new Group();
const mesh = new Group();
mesh.userData.modelWrapper = wrapper;
const unit = {
  kind: 'fieldgun75',
  mesh,
  currentSpeed: 0,
  recoilTime: 0,
  _canMove: true,
};
assert(Game.attachFieldGunCrew(unit, mesh), 'Armata crew did not attach');
const crew = mesh.userData.fieldGunCrew;
assert.equal(crew.rotation.y, Math.PI, 'crew did not inherit the Armata yaw correction');
assert.equal(crew.userData.skinTeam, 'polish', 'crew is tagged with the wrong faction skin');
assert.equal(crew.userData.uniformTint, Game.SOLDIER_SKIN_TINT.polish,
  'crew coat does not use the shared Polish infantry tint');
assert.equal(crew.userData.materials.helmet.color.getHex(), Game.FIELDGUN75_CREW_SKIN.helmet,
  'crew helmet does not use the Polish helmet colour');
assert.equal(crew.userData.crewMode, 'fallback',
  'fallback crew was not present during the asynchronous soldier load');

for (const figure of crew.userData.figures) {
  const position = rotateXZ(figure.position, crew.rotation.y);
  assert(position.z < 0, 'an Armata crewman is no longer behind the +Z-facing gun');
  const facing = figure.rotation.y + crew.rotation.y;
  assert(Math.cos(facing) > 0.999,
    'an Armata crewman is not facing toward the +Z breech after correction');
}

unit.recoilTime = 0.05;
Game.updateFieldGunCrew(unit, 1 / 60);
assert(wrapper.position.z < 0, 'Armata carriage recoil moved toward its +Z muzzle');
assert(crew.position.z < 0, 'Armata crew flinch moved toward the muzzle');

// Allow the mocked shared-model promises and guarded replacement to settle.
unit.recoilTime = 0;
await new Promise(resolve => setImmediate(resolve));
assert.equal(crew.userData.crewMode, 'soldier',
  'lightweight fallback was not replaced by proper soldier crew');
assert.equal(crew.userData.figures.length, Game.FIELDGUN75_CREW_COUNT,
  'Armata does not cap its visible crew at two men');
assert.equal(loadPaths.length, Game.FIELDGUN75_CREW_COUNT,
  'shared soldier model was not cloned once per crew member');
assert(loadPaths.every(path => path === Game.SOLDIER_MODEL_PATH),
  'Armata crew loaded a model other than the shared soldier rig');
assert.equal(skinCalls.length, Game.FIELDGUN75_CREW_COUNT,
  'Polish skin was not applied to every Armata crew member');
assert(skinCalls.every(call => call.team === Game.TEAM.POLISH && call.kind === 'fieldgun_crew'),
  'an Armata crew member received the wrong faction/role skin');
assert.equal(crew.userData.skinSource, Game.SOLDIER_MODEL_PATH,
  'crew does not record the real shared soldier model as its skin source');

for (const figure of crew.userData.figures) {
  const position = rotateXZ(figure.position, crew.rotation.y);
  assert(position.z < 0, 'a proper Armata crewman is not behind the +Z-facing gun');
  assert(Math.cos(figure.rotation.y + crew.rotation.y) > 0.999,
    'a proper Armata crewman is not facing the breech/movement direction');
}
const updatesBeforeMove = animationUpdates;
unit._dispSpeed = 1;
Game.updateFieldGunCrew(unit, 1 / 60);
assert.equal(animationUpdates - updatesBeforeMove, Game.FIELDGUN75_CREW_COUNT,
  'proper Armata crew did not use the shared soldier movement pipeline');

unit.recoilTime = 0.05;
Game.updateFieldGunCrew(unit, 1 / 60);
assert(wrapper.position.z < 0 && crew.position.z < 0,
  'proper Armata crew/carriage recoil no longer moves opposite the bore');

console.log('Polish 75 mm Armata model/crew checks passed.');

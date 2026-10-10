/** Compare collision results with the released implementation, without GPU noise. */
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const ref = process.env.COLLISION_BASE_REF || '3c238a7';
const baseline = execFileSync('git', ['show', `${ref}:js/main.js`], { encoding: 'utf8' });
const current = fs.readFileSync('js/main.js', 'utf8');
const assignment = (source, name) => {
    const start = source.indexOf(`Game.${name} =`);
    assert(start >= 0, name);
    return source.slice(start, source.indexOf('\n};', start) + 3);
};
const setup = source => {
    const Game = {
        gameClock: 100, TANK_SEP_RADIUS: 1.3, TANK_SEP_STRENGTH: 3, TANK_BOX_LEN: 1.5, TANK_BOX_WID: 1,
        isTank: kind => ['r35', 's35', 'panzer4'].includes(kind),
        isTruck: kind => kind === 'transport', isMountedCavalry: u => u.kind === 'horse',
        crushUnit: (_tank, u) => { u.alive = false; u.hp = 0; },
    };
    const context = vm.createContext({ Game, Math });
    // Keep the SAME footprints in both runs; only the two optimized algorithms differ.
    for (const name of ['VEHICLE_FOOTPRINTS', '_vehicleHalfExtents', '_vehicleOBB', '_obbPenetration']) {
        vm.runInContext(assignment(current, name), context);
    }
    for (const name of ['_tankBoxPush', 'applySeparation']) vm.runInContext(assignment(source, name), context);
    return Game;
};
const old = setup(baseline), next = setup(current);
let seed = 5173;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const kinds = ['r35', 's35', 'panzer4', 'transport', 'fusilier', 'horse'];
const unit = id => ({ id, kind: kinds[Math.floor(random() * kinds.length)], size: .3 + random() * 3,
    x: random() * 50, z: random() * 50, angle: random() * Math.PI * 2, alive: true, hp: 100,
    team: random() < .5 ? 'french' : 'german', currentSpeed: random() < .25 ? 0 : random() * 20,
    _reversing: random() < .3, stance: 'stand', path: random() < .5 ? [{ x: 0, z: 0 }] : [],
    _bailSides: random() < .1 ? { 1: -1, 2: 1 } : {},
});
for (let i = 0; i < 10000; i++) {
    const units = [unit(1), unit(2), unit(3)];
    old.units = structuredClone(units); next.units = structuredClone(units);
    for (const u of old.units) old.applySeparation(u, 1 / 30);
    for (const u of next.units) next.applySeparation(u, 1 / 30);
    assert.equal(JSON.stringify(next.units), JSON.stringify(old.units), `collision output differs in case ${i}`);
}
// Independent contact points on rotated hull corners and edges, including
// offsets just inside/outside the expanded footprint.
for (let i = 0; i < 10000; i++) {
    const tank = unit(1), r = random(), margin = random() * .4;
    tank.kind = 'transport';
    const ext = next._vehicleHalfExtents(tank), a = tank.angle;
    const lx = (ext.hl + r + margin) * (random() * .002 + .999) * (random() < .5 ? -1 : 1);
    const lz = (ext.hw + r + margin) * (random() * .002 + .999) * (random() < .5 ? -1 : 1);
    const x = tank.x + lx * Math.cos(a) - lz * Math.sin(a);
    const z = tank.z + lx * Math.sin(a) + lz * Math.cos(a);
    assert.equal(JSON.stringify(next._tankBoxPush(x, z, tank, r, margin)),
        JSON.stringify(old._tankBoxPush(x, z, tank, r, margin)), `corner contact differs: ${i}`);
}
const spread = Array.from({ length: 48 }, (_, i) => ({ ...unit(i), kind: 'transport',
    x: (i % 8) * 55, z: Math.floor(i / 8) * 55, currentSpeed: i % 3 ? 4 : 0, team: 'french' }));
const measure = game => {
    game.units = structuredClone(spread);
    let exactTests = 0; const original = game._obbPenetration;
    game._obbPenetration = (...args) => { exactTests++; return original(...args); };
    const start = performance.now();
    for (let f = 0; f < 120; f++) for (const u of game.units) game.applySeparation(u, 1 / 60);
    const elapsedMs = performance.now() - start;
    game._obbPenetration = original;
    return { elapsedMs, exactTests, msPerFrame: elapsedMs / 120 };
};
measure(old); measure(next); // Warm both implementations before measuring.
console.log(JSON.stringify({ reference: ref, equivalentCases: 20000, vehicles: 48,
    before: measure(old), after: measure(next) }, null, 2));

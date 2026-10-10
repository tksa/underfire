import assert from 'node:assert/strict';
import fs from 'node:fs';
let clipsChecked = 0, verticesChecked = 0;
for (const name of ['mow-soldier', 'mow-french', 'mow-polish']) {
    const bytes = fs.readFileSync(new URL(`../models/infantry/${name}.glb`, import.meta.url));
    const length = bytes.readUInt32LE(12), gltf = JSON.parse(bytes.subarray(20, 20 + length));
    const bin = bytes.subarray(28 + length);
    const values = index => {
        const a = gltf.accessors[index], v = gltf.bufferViews[a.bufferView];
        const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
        const size = { 5126: 4, 5125: 4, 5123: 2 }[a.componentType];
        const read = { 5126: 'readFloatLE', 5125: 'readUInt32LE', 5123: 'readUInt16LE' }[a.componentType];
        return Array.from({ length: a.count * width }, (_, i) => bin[read]((v.byteOffset || 0) + (a.byteOffset || 0) + i * size));
    };
    const names = new Set(gltf.animations.map(a => a.name));
    for (const n of ['idle', 'walk', 'run', 'crawl', 'crouch_walk', 'aim_stand', 'reload_stand', 'death', 'death2', 'death3', 'crew_push', 'hmg_idle']) assert(names.has(n), `${name}: missing ${n}`);
    for (const node of gltf.nodes.filter(n => n.skin != null)) {
        const skin = gltf.skins[node.skin];
        for (const p of gltf.meshes[node.mesh].primitives) {
            const joints = values(p.attributes.JOINTS_0), weights = values(p.attributes.WEIGHTS_0);
            assert.equal(joints.length, weights.length);
            for (let i = 0; i < weights.length; i += 4) {
                assert(Math.abs(weights.slice(i, i + 4).reduce((a, b) => a + b, 0) - 1) < 1e-5, `${name}: weights lose volume`);
                for (let j = i; j < i + 4; j++) assert(joints[j] < skin.joints.length && weights[j] >= 0 && weights[j] <= 1, `${name}: invalid skin palette`);
                verticesChecked++;
            }
        }
    }
    const parity = new Map();
    for (const clip of gltf.animations) {
        clipsChecked++;
        for (const channel of clip.channels) {
            const track = values(clip.samplers[channel.sampler].output);
            assert(track.every(Number.isFinite), `${name}/${clip.name}: nonfinite pose`);
            if (channel.target.path !== 'scale') continue;
            for (let i = 0; i < track.length; i += 3) {
                const scale = track.slice(i, i + 3);
                assert(scale.every(v => Math.abs(v) > 0.9), `${name}/${clip.name}: collapsing joint`);
                const key = channel.target.node, signs = scale.map(Math.sign).join();
                if (!parity.has(key)) parity.set(key, signs);
                assert.equal(signs, parity.get(key), `${name}/${clip.name}: reflection changes during crossfade`);
            }
        }
    }
    assert(gltf.images.every(i => i.bufferView != null && !i.uri), `${name}: external texture dependency`);
}
console.log(`Infantry assets passed: ${clipsChecked} clips; ${verticesChecked} weighted vertices; stable crossfade reflections.`);

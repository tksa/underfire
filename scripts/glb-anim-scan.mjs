// Scan a GLB's animation tracks and print a motion-energy timeline, so clip
// window boundaries (Game.SOLDIER_CLIP_RANGES) can be chosen from data instead
// of guesswork. Baked takes contain hard jump-cuts between performances — they
// show up as a huge single-sample spike; a window must never straddle one.
//
//   node scripts/glb-anim-scan.mjs <file.glb> [t0] [t1] [step]
//   e.g. node scripts/glb-anim-scan.mjs models/soldier.glb 33 41 0.1
import { readFileSync } from 'node:fs';

const path = process.argv[2];
const t0 = parseFloat(process.argv[3] ?? '0');
const t1 = parseFloat(process.argv[4] ?? '1e9');
const step = parseFloat(process.argv[5] ?? '0.1');

const buf = readFileSync(path);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
let off = 20 + jsonLen;
let bin = null;
while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    if (type === 0x004e4942) { bin = buf.subarray(off + 8, off + 8 + len); break; }
    off += 8 + len;
}

const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function readAccessor(i) {
    const a = json.accessors[i];
    const bv = json.bufferViews[a.bufferView];
    const T = COMP[a.componentType];
    const n = NCOMP[a.type];
    const start = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const arr = new T(bin.buffer, bin.byteOffset + start, a.count * n);
    return { arr: Float32Array.from(arr), n };
}

const nodeName = (i) => (json.nodes[i] && json.nodes[i].name) || `node${i}`;

for (const anim of json.animations || []) {
    console.log(`\n=== animation "${anim.name}" ===`);
    // Build per-channel interpolants (linear)
    const chans = anim.channels.map(ch => {
        const s = anim.samplers[ch.sampler];
        const inp = readAccessor(s.input);
        const out = readAccessor(s.output);
        return { path: ch.target.path, node: nodeName(ch.target.node), times: inp.arr, vals: out.arr, n: out.n };
    });
    const dur = Math.max(...chans.map(c => c.times[c.times.length - 1]));
    console.log(`duration ${dur.toFixed(2)}s, ${chans.length} channels`);
    const sample = (c, t) => {
        const times = c.times;
        let lo = 0, hi = times.length - 1;
        if (t <= times[0]) lo = hi = 0;
        else if (t >= times[hi]) lo = hi;
        else { while (hi - lo > 1) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m; else hi = m; } }
        const out = new Array(c.n);
        if (lo === hi) { for (let k = 0; k < c.n; k++) out[k] = c.vals[lo * c.n + k]; return out; }
        const f = (t - times[lo]) / (times[hi] - times[lo]);
        for (let k = 0; k < c.n; k++) out[k] = c.vals[lo * c.n + k] * (1 - f) + c.vals[hi * c.n + k] * f;
        return out;
    };
    // Motion energy per step: sum of |delta| across all rotation (quat angle)
    // and translation channels between consecutive samples.
    const a = Math.max(0, t0), b = Math.min(dur, t1);
    const rows = [];
    let prev = null;
    for (let t = a; t <= b + 1e-6; t += step) {
        let rotE = 0, posE = 0;
        const snap = chans.map(c => sample(c, Math.min(t, dur)));
        if (prev) {
            for (let i = 0; i < chans.length; i++) {
                const c = chans[i], p = prev[i], q = snap[i];
                if (c.path === 'rotation') {
                    let dot = 0; for (let k = 0; k < 4; k++) dot += p[k] * q[k];
                    rotE += 2 * Math.acos(Math.min(1, Math.abs(dot)));
                } else if (c.path === 'translation') {
                    let d = 0; for (let k = 0; k < 3; k++) d += (p[k] - q[k]) ** 2;
                    posE += Math.sqrt(d);
                }
            }
        }
        rows.push({ t, rotE, posE });
        prev = snap;
    }
    const maxR = Math.max(...rows.map(r => r.rotE), 1e-9);
    for (const r of rows.slice(1)) {
        const bar = '#'.repeat(Math.round(40 * r.rotE / maxR));
        console.log(`${r.t.toFixed(2).padStart(7)}  rot ${r.rotE.toFixed(3).padStart(8)}  pos ${r.posE.toFixed(3).padStart(7)}  ${bar}`);
    }
}

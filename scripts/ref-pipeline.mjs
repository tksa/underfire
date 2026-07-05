#!/usr/bin/env node
// Reference-dataset pipeline sidecar (stage 2: reference -> realistic).
//
// The game's capture mode (debug panel) writes annotated reference JPEGs to
// dataset/reference/. This script turns each one into a photorealistic
// counterpart via the OpenAI images/edits API and saves it under the SAME
// basename (as .png) in dataset/realistic/, so pairs match by stem.
//
// It runs OUTSIDE the browser on purpose: the API key stays in .env on disk
// and never reaches the page, devtools, or the repo. The game's debug panel
// talks to this process over localhost to trigger runs and show progress.
//
// Usage:
//   node scripts/ref-pipeline.mjs                # start the local server (port 8742)
//   node scripts/ref-pipeline.mjs --once --limit 1   # one batch from the CLI, then exit
//   Flags: --ref <dir> --out <dir> --model <id> --size <s> --quality <q>
//          --concurrency <n> --limit <n> --port <n> --dry --once
//
// --dry copies inputs instead of calling the API (free end-to-end flow test).
// Already-generated stems are skipped, so re-running resumes where it stopped.
// Note: OpenAI's discounted Batch API does not cover the images endpoints, so
// "batch" here means concurrent requests with backoff plus resumability.

import { createServer } from 'node:http';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, dflt) => {
    const i = args.indexOf('--' + name);
    return i >= 0 && args[i + 1] != null ? args[i + 1] : dflt;
};
const has = (name) => args.includes('--' + name);

const REF_DIR = path.resolve(ROOT, flag('ref', 'dataset/reference'));
const OUT_DIR = path.resolve(ROOT, flag('out', 'dataset/realistic'));
const MODEL = flag('model', 'gpt-image-2');
const SIZE = flag('size', 'auto');
const QUALITY = flag('quality', 'auto');
// input_fidelity nudges edits to stick closer to the input's layout, but the
// default model (gpt-image-2) does not accept it, so it is off by default.
// Pass --fidelity high together with --model gpt-image-1 to experiment; if a
// model rejects the param we drop it and carry on.
const FIDELITY = flag('fidelity', 'off');
let sendFidelity = FIDELITY !== 'off';
const CONCURRENCY = Math.max(1, parseInt(flag('concurrency', '10'), 10));
const LIMIT = parseInt(flag('limit', '0'), 10);
const PORT = parseInt(flag('port', '8742'), 10);
const DRY = has('dry');

// Tiny .env loader (KEY=value lines, repo root) — no npm deps, ever.
const env = {};
try {
    for (const line of readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (m) env[m[1]] = m[2];
    }
} catch { /* no .env; fall through to process.env */ }
const KEY = process.env.OPENAI_API_KEY || env.OPENAI_API_KEY;
if (!KEY && !DRY) {
    console.error('No OPENAI_API_KEY found in .env or the environment. Aborting.');
    process.exit(1);
}
const PROMPT = readFileSync(path.join(ROOT, 'scripts', 'ref-prompt.txt'), 'utf8').trim();

const state = {
    running: false, total: 0, done: 0, failed: 0, pending: 0,
    current: '', errors: [], dry: DRY, model: DRY ? 'dry-run' : MODEL,
};

const stem = (f) => f.replace(/\.(jpe?g|png)$/i, '');

async function pendingList() {
    await mkdir(OUT_DIR, { recursive: true });
    const refs = (await readdir(REF_DIR).catch(() => []))
        .filter((f) => /\.jpe?g$/i.test(f)).sort();
    const haveOut = new Set((await readdir(OUT_DIR).catch(() => [])).map(stem));
    return refs.filter((f) => !haveOut.has(stem(f)));
}

async function genOne(file) {
    const outPath = path.join(OUT_DIR, stem(file) + '.png');
    const bytes = await readFile(path.join(REF_DIR, file));
    if (DRY) {
        // flow test: the "realistic" output is just a copy of the input
        await writeFile(outPath, bytes);
        return;
    }
    for (let attempt = 0; ; attempt++) {
        // rebuild the form each attempt — a consumed body can't be resent
        const form = new FormData();
        form.append('image', new Blob([bytes], { type: 'image/jpeg' }), file);
        form.append('prompt', PROMPT);
        form.append('model', MODEL);
        form.append('n', '1');
        form.append('size', SIZE);
        form.append('quality', QUALITY);
        if (sendFidelity) form.append('input_fidelity', FIDELITY);
        const res = await fetch('https://api.openai.com/v1/images/edits', {
            method: 'POST',
            headers: { Authorization: `Bearer ${KEY}` },
            body: form,
        });
        if (res.status === 429 || res.status >= 500) {
            if (attempt >= 4) throw new Error(`HTTP ${res.status} after ${attempt + 1} tries`);
            const ra = parseFloat(res.headers.get('retry-after')) || 2 ** attempt * 5;
            await new Promise((r) => setTimeout(r, ra * 1000));
            continue;
        }
        if (!res.ok) {
            const body = await res.text();
            if (res.status === 400 && sendFidelity && body.includes('input_fidelity')) {
                sendFidelity = false;   // model doesn't take it — drop and retry
                console.log(`note: ${MODEL} rejected input_fidelity, continuing without it`);
                continue;
            }
            throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
        }
        const json = await res.json();
        const b64 = json.data && json.data[0] && json.data[0].b64_json;
        if (!b64) throw new Error('response had no b64_json image');
        await writeFile(outPath, Buffer.from(b64, 'base64'));
        return;
    }
}

async function runBatch(limit) {
    if (state.running) return;
    state.running = true;
    state.errors = [];
    let files = await pendingList();
    if (limit > 0) files = files.slice(0, limit);
    state.total = files.length;
    state.done = 0;
    state.failed = 0;
    console.log(`Batch start: ${files.length} image(s), model ${state.model}, concurrency ${CONCURRENCY}.`);
    let i = 0;
    const worker = async () => {
        while (i < files.length) {
            const f = files[i++];
            state.current = f;
            try {
                await genOne(f);
                state.done++;
                console.log(`ok   ${f} (${state.done}/${state.total})`);
            } catch (e) {
                state.failed++;
                state.errors.push(`${f}: ${e.message}`);
                if (state.errors.length > 20) state.errors.shift();
                console.error(`FAIL ${f}: ${e.message}`);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
    state.running = false;
    state.current = '';
    console.log(`Batch finished: ${state.done} ok, ${state.failed} failed.`);
}

if (has('once')) {
    await runBatch(LIMIT);
    process.exit(state.failed ? 1 : 0);
}

createServer(async (req, res) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',   // page on :8741 talks to us; localhost bind only
        'Content-Type': 'application/json',
    };
    try {
        if (req.method === 'POST' && req.url.startsWith('/generate')) {
            const limit = parseInt(new URL(req.url, 'http://x').searchParams.get('limit') || '0', 10) || LIMIT;
            const started = !state.running;
            if (started) runBatch(limit);   // fire and forget; /status reports progress
            res.writeHead(200, headers);
            res.end(JSON.stringify({ started, alreadyRunning: !started }));
        } else if (req.url.startsWith('/status')) {
            if (!state.running) state.pending = (await pendingList()).length;
            res.writeHead(200, headers);
            res.end(JSON.stringify(state));
        } else {
            res.writeHead(404, headers);
            res.end('{}');
        }
    } catch (e) {
        res.writeHead(500, headers);
        res.end(JSON.stringify({ error: e.message }));
    }
}).listen(PORT, '127.0.0.1', () => {
    console.log(`ref-pipeline listening on http://127.0.0.1:${PORT}` + (DRY ? ' (DRY RUN)' : ''));
    console.log(`reference: ${REF_DIR}`);
    console.log(`realistic: ${OUT_DIR}`);
});

#!/usr/bin/env node

/**
 * Upload the public heavyweight asset set to Bunny Edge Storage.
 *
 * Examples:
 *   node scripts/sync-bunny-storage.mjs --dry-run --all
 *   node scripts/sync-bunny-storage.mjs --all
 *   node scripts/sync-bunny-storage.mjs --since v0.14.0
 *   node scripts/sync-bunny-storage.mjs models/new-unit.glb sounds/new.ogg
 *
 * The write-capable Storage Zone password is read from the environment only.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const all = argv.includes('--all');
const verbose = argv.includes('--verbose');
const sinceAt = argv.indexOf('--since');
const since = sinceAt >= 0 ? argv[sinceAt + 1] : '';
const positional = argv.filter((arg, index) => {
  if (arg === '--dry-run' || arg === '--all' || arg === '--verbose') return false;
  if (arg === '--since' || index === sinceAt + 1) return false;
  return true;
});

if ((sinceAt >= 0 && !since) || [all, Boolean(since), positional.length > 0].filter(Boolean).length !== 1) {
  console.error('Choose exactly one input: --all, --since <git-ref>, or one or more asset paths.');
  process.exit(2);
}

const zone = (process.env.BUNNY_STORAGE_ZONE || 'under').trim();
const endpoint = (process.env.BUNNY_STORAGE_ENDPOINT || 'https://storage.bunnycdn.com').replace(/\/$/, '');
const password = (process.env.BUNNY_STORAGE_PASSWORD || '').trim();
const requestedConcurrency = Number(process.env.BUNNY_UPLOAD_CONCURRENCY || 4);
const concurrency = Number.isInteger(requestedConcurrency)
  ? Math.max(1, Math.min(12, requestedConcurrency))
  : 4;

if (!/^[a-z0-9-]+$/i.test(zone)) {
  console.error('BUNNY_STORAGE_ZONE must contain only letters, numbers or dashes.');
  process.exit(2);
}
const endpointUrl = new URL(endpoint);
if (endpointUrl.protocol !== 'https:' || !/(^|\.)storage\.bunnycdn\.com$/i.test(endpointUrl.hostname)) {
  console.error('BUNNY_STORAGE_ENDPOINT must be an official HTTPS Bunny Storage endpoint.');
  process.exit(2);
}
if (!dryRun && !password) {
  console.error('Set BUNNY_STORAGE_PASSWORD to the write-capable Storage Zone password.');
  process.exit(2);
}

const splitZero = buffer => buffer.toString('utf8').split('\0').filter(Boolean);
const tracked = new Set(splitZero(execFileSync('git', ['ls-files', '-z'])));
const isCdnAsset = file => /^(?:models|textures|sounds|icons)\//i.test(file)
  || /^maps\/.*\.(?:avif|gif|jpe?g|png|webp)$/i.test(file)
  || /^(?:splash\.png|uf_logo\.png|under_vid\.mp4)$/i.test(file);

let candidates;
if (all) {
  candidates = [...tracked];
} else if (since) {
  if (!/^[A-Za-z0-9_./~^:@{}+-]+$/.test(since)) {
    console.error('Invalid --since git reference.');
    process.exit(2);
  }
  candidates = splitZero(execFileSync('git', [
    'diff', '--name-only', '-z', '--diff-filter=ACMRT', since, 'HEAD', '--',
  ]));
} else {
  candidates = positional;
}

const files = [...new Set(candidates)]
  .filter(file => tracked.has(file) && isCdnAsset(file))
  .sort();

const sizes = await Promise.all(files.map(async file => (await stat(file)).size));
const totalBytes = sizes.reduce((sum, size) => sum + size, 0);
console.log(`${dryRun ? 'Would upload' : 'Uploading'} ${files.length} tracked CDN assets (${totalBytes} bytes) to Storage Zone ${zone}.`);

if (dryRun) {
  if (verbose) files.forEach((file, index) => console.log(`${file} (${sizes[index]} bytes)`));
  process.exit(0);
}
if (!files.length) process.exit(0);

const MIME = {
  '.avif': 'image/avif', '.fbx': 'application/octet-stream', '.gif': 'image/gif',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg', '.ply': 'application/octet-stream', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.webp': 'image/webp',
};
const mimeFor = file => MIME[file.slice(file.lastIndexOf('.')).toLowerCase()] || 'application/octet-stream';
const remotePath = file => file.split('/').map(encodeURIComponent).join('/');
const failures = [];
let next = 0;
let uploadedBytes = 0;

const upload = async (file, size) => {
  const body = await readFile(file);
  const checksum = createHash('sha256').update(body).digest('hex').toUpperCase();
  const url = `${endpoint}/${encodeURIComponent(zone)}/${remotePath(file)}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      AccessKey: password,
      Checksum: checksum,
      'Content-Type': mimeFor(file),
      'Content-Length': String(body.length),
    },
    body,
  });
  if (response.status !== 201) {
    const detail = (await response.text()).trim();
    throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  uploadedBytes += size;
  if (verbose) console.log(`uploaded ${file} (${size} bytes)`);
};

const worker = async () => {
  while (true) {
    const index = next++;
    if (index >= files.length) return;
    try {
      await upload(files[index], sizes[index]);
    } catch (error) {
      failures.push(`${files[index]}: ${error.message}`);
    }
  }
};

await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));

if (failures.length) {
  console.error(`Upload failed for ${failures.length} asset(s):`);
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Uploaded ${files.length} assets (${uploadedBytes} bytes) with SHA-256 verification.`);

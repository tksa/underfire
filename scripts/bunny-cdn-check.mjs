#!/usr/bin/env node

/**
 * Verify that Bunny can safely serve every heavyweight browser asset class.
 * This is deliberately independent of the game smoke tests: procedural model
 * fallbacks can make those tests green even when a CDN request is CORS-blocked.
 */

const origin = (process.env.UNDERFIRE_ORIGIN || 'https://underfire.io').replace(/\/$/, '');
const cdn = (process.env.UNDERFIRE_CDN || 'https://underfire.b-cdn.net').replace(/\/$/, '');
const browserOrigin = new URL(origin).origin;
const release = process.env.UNDERFIRE_VERSION || 'cdn-contract';

const assets = [
  { path: 'models/soldier.glb', type: /model\/gltf-binary|application\/octet-stream/i, range: true },
  { path: 'textures/terrain_roughness.jpg', type: /image\/jpeg/i },
  { path: 'sounds/rwm/rifle1.ogg', type: /audio\/ogg|application\/ogg|application\/octet-stream/i, range: true },
  { path: 'maps/default/bake.jpg', type: /image\/jpeg/i },
  { path: 'under_vid.mp4', type: /video\/mp4|application\/octet-stream/i, range: true },
];

const failures = [];
const results = [];
const corsAllows = value => value === '*' || value === browserOrigin;

for (const asset of assets) {
  const suffix = `?v=${encodeURIComponent(release)}`;
  const originUrl = `${origin}/${asset.path}${suffix}`;
  const cdnUrl = `${cdn}/${asset.path}${suffix}`;
  const headers = { Origin: browserOrigin };

  let originHead;
  let cdnHead;
  try {
    [originHead, cdnHead] = await Promise.all([
      fetch(originUrl, { method: 'HEAD' }),
      fetch(cdnUrl, { method: 'HEAD', headers }),
    ]);
  } catch (error) {
    failures.push(`${asset.path}: request failed (${error.message})`);
    continue;
  }

  const contentType = cdnHead.headers.get('content-type') || '';
  const cors = cdnHead.headers.get('access-control-allow-origin') || '';
  const originLength = Number(originHead.headers.get('content-length') || 0);
  const cdnLength = Number(cdnHead.headers.get('content-length') || 0);
  const cache = cdnHead.headers.get('cdn-cache') || cdnHead.headers.get('cdn-cache-status') || '-';

  if (!originHead.ok) failures.push(`${asset.path}: origin returned ${originHead.status}`);
  if (!cdnHead.ok) failures.push(`${asset.path}: CDN returned ${cdnHead.status}`);
  if (!corsAllows(cors)) failures.push(`${asset.path}: missing usable Access-Control-Allow-Origin`);
  if (!asset.type.test(contentType)) failures.push(`${asset.path}: unexpected Content-Type ${contentType || '(missing)'}`);
  if (originLength && cdnLength && originLength !== cdnLength) {
    failures.push(`${asset.path}: stale/partial length (origin ${originLength}, CDN ${cdnLength})`);
  }

  if (asset.range && cdnHead.ok) {
    const ranged = await fetch(cdnUrl, { headers: { ...headers, Range: 'bytes=0-31' } });
    if (ranged.status !== 206) failures.push(`${asset.path}: byte range returned ${ranged.status}, expected 206`);
    if (ranged.body) await ranged.body.cancel();
  }

  results.push({ path: asset.path, status: cdnHead.status, bytes: cdnLength || '?', cors: cors || '-', cache });
}

for (const result of results) {
  console.log(`${result.path}: ${result.status}, ${result.bytes} bytes, CORS ${result.cors}, cache ${result.cache}`);
}

if (failures.length) {
  console.error('\nBunny CDN contract FAILED:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('\nBunny CDN contract OK.');

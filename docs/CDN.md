# Bunny CDN Operations

Production keeps `index.html`, game JavaScript, CSV and JSON on `underfire.io` and routes heavyweight public assets through the Bunny Pull Zone at `https://underfire.b-cdn.net`:

- `models/`
- `textures/`
- `sounds/`
- `icons/`
- baked map images
- `splash.png`, `uf_logo.png` and `under_vid.mp4`

This split keeps frequently changed boot code easy to refresh while moving the large GLB, image, audio and video payloads to the edge. Localhost, CI and preview hosts remain same-origin and do not depend on Bunny. Production can temporarily bypass Bunny with `?cdn=0`; local development can exercise it with `?cdn=1`.

The central resolver is `window.ufAssetUrl` in `index.html`, exposed to game code as `Game.assetUrl`. Keep logical paths such as `models/soldier.glb` in unit definitions and resolve them only at the network-loading boundary. Model cache keys and unit identity checks rely on those logical paths.

The Three.js loading manager also passes GLTF sidecars through this resolver. External buffers and shared textures, including `models/railway/textures/`, therefore receive the same CDN hostname and release-version query as their parent GLB.

## Required Pull Zone settings

Do these in the Bunny dashboard before deploying the CDN-enabled code:

1. In the Pull Zone's Origin settings, choose **Bunny Storage Zone** and connect the `under` Storage Zone. The game shell still comes from `underfire.io`; only the asset paths listed above are uploaded to Storage. See Bunny's [Storage quickstart](https://docs.bunny.net/storage/quickstart).
2. Enable `Access-Control-Allow-Origin` for public assets. `*` is appropriate because these files are public and no cookies or credentials are used. Include at least: `js`, `css`, `json`, `csv`, `glb`, `gltf`, `bin`, `fbx`, `ply`, `wasm`, `ogg`, `mp3`, `wav`, `png`, `jpg`, `jpeg`, `webp`, `gif`, `svg`, `mp4`, `webm`, `woff`, `woff2` and `ttf`. The native CORS toggle/extension list or an all-path response-header Edge Rule can provide this. See the [Pull Zone settings API](https://docs.bunny.net/api-reference/core/pull-zone/update-pull-zone) and [Edge Rules](https://docs.bunny.net/cdn/edge-rules).
3. Under Vary Cache, enable URL query-string variation and restrict it to the stable `v` parameter if possible. Bunny ignores query strings by default; without this setting, `?v=v0.14.0` and a later release can resolve to the same cached object. See [Vary Cache](https://docs.bunny.net/cdn/vary-cache).
4. Keep `index.html` uncached/short-lived. Give release-versioned models, textures, sounds, images and video a long edge/browser lifetime. Keep cached error responses short so a model requested just before it is uploaded does not remain a long-lived 404. See [Smart Cache](https://docs.bunny.net/cdn/smart-cache) and [custom cache times](https://docs.bunny.net/cdn/edge-rules/custom-cache-time).
5. If Bunny Optimizer is enabled, exclude `textures/` and baked maps. Normal, roughness and AO channels are data, not ordinary photographs; format conversion or colour/quality processing can corrupt the material.
6. Hotlink protection is optional. If enabled, allow `underfire.io`, `www.underfire.io` and every preview hostname. Initially leave direct-file blocking disabled because privacy tools can omit `Referer`. See [hotlink protection](https://docs.bunny.net/cdn/security/hotlink-protection).

The runtime performs a CORS `HEAD` probe against `models/soldier.glb` before game boot. If that check fails, the resolver falls back to the origin for the current page instead of booting with missing models.

## Release and cache-refresh order

Every production deployment must use this order:

1. Update `UF_ASSET_VERSION` in `index.html` to the new release version. It must change whenever a same-name static asset changes.
2. Commit, tag and push the release.
3. Upload all Git-tracked files to the origin server. Keeping the assets there provides the runtime's safe fallback.
4. Upload the changed heavyweight assets to the `under` Storage Zone.
5. Purge the Pull Zone only **after** both uploads succeed.
6. Run the CDN contract check and pre-warm the most-used large files.
7. Verify any replaced asset has the same checksum at the origin and CDN.

Bunny does not automatically invalidate an edge object when its Storage copy changes. Purging before the upload can make an edge immediately re-cache the old file. The release-version query prevents an old object in a player's browser cache from being reused, while the purge prevents stale edge objects and clears negative-cache entries. See Bunny's [purge documentation](https://docs.bunny.net/cdn/purge-cache).

### Upload to Edge Storage

The Storage upload needs the zone's **write-capable password**. A read-only password cannot upload or replace files. Keep the write password in a password manager or deployment/CI secret and expose it to the process only as `BUNNY_STORAGE_PASSWORD`.

Initial population:

```bash
export BUNNY_STORAGE_PASSWORD='...'
node scripts/sync-bunny-storage.mjs --dry-run --all
node scripts/sync-bunny-storage.mjs --all
```

Normal release, uploading only CDN assets changed since the previous tag:

```bash
export BUNNY_STORAGE_PASSWORD='...'
node scripts/sync-bunny-storage.mjs --since v0.14.0
```

The script defaults to Storage Zone `under` and the Frankfurt/global endpoint `https://storage.bunnycdn.com`. Override those only if the Bunny Access page specifies something else:

```bash
export BUNNY_STORAGE_ZONE='under'
export BUNNY_STORAGE_ENDPOINT='https://storage.bunnycdn.com'
```

Each upload includes an uppercase SHA-256 `Checksum` header, so Bunny rejects a corrupted body. See Bunny's [Storage HTTP API](https://docs.bunny.net/storage/http) and [upload endpoint](https://docs.bunny.net/api-reference/storage/manage-files/upload-file).

### Purge

Keep both values in a password manager or CI/deployment secrets. Never put them in the repository, frontend JavaScript, shell history, screenshots or logs.

```bash
export BUNNY_API_KEY='...'
export BUNNY_PULL_ZONE_ID='...'
node scripts/purge-bunny-cache.mjs
```

The script performs a full Pull Zone purge and prints only the zone ID and result, never the API key.

### Validate CORS, MIME types, lengths and byte ranges

```bash
UNDERFIRE_VERSION=v0.14.0 node scripts/bunny-cdn-check.mjs
```

The check covers a GLB, texture, OGG, baked map and MP4. It fails on missing CORS, wrong MIME types, origin/CDN length mismatches, or missing byte-range support. Run it once before enabling the code and after every production purge.

### Pre-warm and verify a replaced file

```bash
curl -fsS -o /dev/null 'https://underfire.b-cdn.net/models/soldier.glb?v=v0.14.0'
curl -fsS -o /dev/null 'https://underfire.b-cdn.net/maps/default/bake.jpg?v=v0.14.0'

curl -fsS 'https://underfire.io/models/soldier.glb' | shasum -a 256
curl -fsS 'https://underfire.b-cdn.net/models/soldier.glb?v=v0.14.0' | shasum -a 256
```

The two hashes must match. Repeat this for each same-name model, texture, sound or map image replaced in the release.

## Troubleshooting

- Missing models plus a console fallback warning: fix the Pull Zone CORS rule, purge, then reload without `?cdn=0`.
- Old asset after deploy: confirm `UF_ASSET_VERSION` changed, purge Bunny, then compare origin/CDN checksums.
- CDN has the right object but a browser still shows the old one: the release version was reused or query-string variation is disabled.
- Texture looks colour-shifted or has broken normals: disable Bunny Optimizer for game textures and purge the transformed object.
- New asset returns a cached 404: purge and reduce the Pull Zone's cached-error lifetime.
- Storage upload returns 401: confirm the regional endpoint and use the write-capable Storage Zone password, not the read-only password or global account API key.

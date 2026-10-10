/** Release routing must never depend on an absent CDN copy of a new model. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html = fs.readFileSync('index.html', 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const setup = (origin, search = '') => {
    const window = {};
    vm.runInNewContext(source, { window, location: { origin, hostname: new URL(origin).hostname, search },
        URL, URLSearchParams, Set, Date, console,
        document: { documentElement: { style: { setProperty() {} } }, getElementById: () => null,
            querySelectorAll: () => [] } });
    return window;
};
const prod = setup('https://underfire.io');
const assets = prod.UF_ASSET_CDN.originOnlyAssets;
assert(assets.length > 0);
for (const path of assets) {
    assert(fs.existsSync(path), `Missing release asset: ${path}`);
    const resolved = new URL(prod.ufAssetUrl(path));
    assert.equal(resolved.origin, 'https://underfire.io');
    assert.equal(resolved.pathname, '/' + path);
    assert.equal(resolved.searchParams.get('v'), prod.UF_ASSET_VERSION);
    assert.equal(prod.ufAssetUrl(resolved.href), resolved.href, 'LoadingManager must not re-route the origin asset');
    assert.equal(new URL(prod.ufAssetUrl('https://underfire.b-cdn.net/' + path)).origin, 'https://underfire.io');
}
for (const path of ['models/soldier.glb', 'sounds/rwm/rifle1.ogg', 'textures/grass.jpg', 'maps/default/bake.jpg', 'under_vid.mp4']) {
    const resolved = new URL(prod.ufAssetUrl(path));
    assert.equal(resolved.origin, 'https://underfire.io');
    assert.equal(resolved.searchParams.get('v'), prod.UF_ASSET_VERSION);
}
assert.equal(prod.UF_ASSET_CDN.enabled, false);
assert.equal(await prod.ufPrepareAssetCdn(), false, 'Normal boot must not probe the broken CDN');
const diagnostic = setup('https://underfire.io', '?cdn=1');
assert.equal(new URL(diagnostic.ufAssetUrl('models/soldier.glb')).origin, 'https://underfire.b-cdn.net');
for (const path of assets) assert.equal(new URL(diagnostic.ufAssetUrl(path)).origin, 'https://underfire.io');
diagnostic.UF_ASSET_CDN.enabled = false;
const fallback = new URL(diagnostic.ufAssetUrl('https://underfire.b-cdn.net/models/soldier.glb?v=old'));
assert.equal(fallback.origin, 'https://underfire.io');
assert.equal(fallback.searchParams.get('v'), prod.UF_ASSET_VERSION);
const query = new URL(prod.ufAssetUrl(assets[0] + '?test=1#mesh'));
assert.equal(query.searchParams.get('test'), '1'); assert.equal(query.hash, '#mesh');
for (const raw of ['blob:https://underfire.io/example', 'data:image/png;base64,AAAA', 'https://example.com/model.glb', 'js/main.js']) {
    assert.equal(prod.ufAssetUrl(raw), raw);
}
const local = setup('http://127.0.0.1:8752');
for (const path of assets) assert.equal(local.ufAssetUrl(path), path);
const bypass = setup('https://underfire.io', '?cdn=0');
assert.equal(bypass.ufAssetUrl('models/soldier.glb'), 'models/soldier.glb');
console.log(`PASS: ${assets.length} new model routes, versioned origin delivery, CDN diagnostics/fallback, loader idempotence and local bypass`);

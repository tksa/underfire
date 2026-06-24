/**
 * Under Fire — neural_export.js
 * Multi-channel G-buffer / mask exporter for the Neural Renderer pipeline.
 *
 * For the current camera view it renders the channels a conditional
 * image-to-image model (Pix2PixHD / SPADE) needs as INPUT, all perfectly
 * aligned to the same camera:
 *
 *   rgb      — the normal low-poly render (also the "abstract" input)
 *   depth    — linear-ish depth, near = bright
 *   unit     — unit-TYPE semantic mask (infantry / support / vehicle / ...)
 *   team     — team/faction mask (french / german)
 *   id       — per-unit instance id mask (unique colour per unit)
 *   terrain  — ground class mask (grass/road/wheat/forest/water/...) + structures
 *
 * The realistic TARGET image (channel B) is NOT produced here — see
 * docs/neural-renderer/README.md for how to generate targets. This module
 * only produces the layout-true conditioning that makes a small model work.
 *
 * Usage:
 *   Game.NeuralExport.captureFrameData({height: 540})  -> { rgb, depth, ... , meta }  (data URLs)
 *   Game.NeuralExport.downloadFrame('000001')          -> downloads the 6 PNGs + meta.json
 * Headless dataset generation drives captureFrameData() from Playwright — see
 * neural/capture_dataset.mjs.
 */
Game.NeuralExport = (() => {
    const C = (r, g, b) => [r, g, b];

    // ── Semantic palettes (flat, well-separated colours) ──
    const TEAM_COLORS = { french: C(40, 90, 220), german: C(220, 50, 50), neutral: C(150, 150, 150) };
    const CLASS_COLORS = {
        infantry: C(60, 200, 90),
        support: C(240, 210, 50),
        vehicle: C(210, 70, 200),
        recon: C(60, 200, 200),
        default: C(180, 180, 180),
    };
    // Ground / structure classes for the terrain mask
    const TERRAIN_MASK_COLORS = {
        grass: C(70, 140, 70), pasture: C(90, 160, 80), wheat: C(210, 190, 90),
        stubble: C(200, 195, 130), plowed: C(120, 80, 50), vineyard: C(90, 150, 70),
        garden: C(120, 170, 90), orchard: C(70, 150, 80), forest: C(30, 90, 40),
        dense_forest: C(20, 70, 30), road: C(160, 140, 100), mud: C(100, 80, 60),
        yard: C(170, 160, 130), hedge: C(40, 110, 50), wall: C(150, 150, 160),
        house: C(180, 120, 90), water: C(40, 110, 200), swamp: C(80, 90, 70),
    };
    const STRUCTURE_COLOR = C(180, 120, 90); // buildings / props in the terrain mask

    let _terrainClassTex = null;

    const THREE = () => Game.THREE;

    // ── Build a flat class-colour texture for the terrain, on the SAME UV
    //    layout as the painted terrain texture so it aligns with the render. ──
    function terrainClassTexture() {
        if (_terrainClassTex) return _terrainClassTex;
        const px = 4;
        const W = Game.MAP_COLS * px, H = Game.MAP_ROWS * px;
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d');
        for (let ty = 0; ty < Game.MAP_ROWS; ty++) {
            for (let tx = 0; tx < Game.MAP_COLS; tx++) {
                const t = Game.terrain[ty] && Game.terrain[ty][tx];
                const c = (t && TERRAIN_MASK_COLORS[t.type]) || TERRAIN_MASK_COLORS.grass;
                ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
                ctx.fillRect(tx * px, ty * px, px, px);
            }
        }
        const tex = new (THREE().CanvasTexture)(cv);
        tex.colorSpace = THREE().SRGBColorSpace;
        tex.flipY = false; // match PlaneGeometry UVs used by the terrain mesh
        _terrainClassTex = tex;
        return tex;
    }

    const idColor = (id) => {
        // deterministic bright-ish colour per instance id
        const h = (id * 2654435761) >>> 0;
        return [(h & 255), ((h >> 8) & 255), ((h >> 16) & 255)].map(v => 60 + (v % 196));
    };

    function flatMat(rgb) {
        return new (THREE().MeshBasicMaterial)({
            color: (rgb[0] << 16) | (rgb[1] << 8) | rgb[2],
            fog: false,
        });
    }

    // ── Render the scene to an offscreen target and read it back to a canvas ──
    function renderToCanvas(w, h) {
        const renderer = Game.renderer;
        const rt = new (THREE().WebGLRenderTarget)(w, h);
        renderer.setRenderTarget(rt);
        renderer.render(Game.scene, Game.camera);
        const buf = new Uint8Array(w * h * 4);
        renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
        renderer.setRenderTarget(null);
        rt.dispose();

        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        const img = ctx.createImageData(w, h);
        // readRenderTargetPixels is bottom-up; flip vertically
        for (let y = 0; y < h; y++) {
            const src = (h - 1 - y) * w * 4;
            const dst = y * w * 4;
            img.data.set(buf.subarray(src, src + w * 4), dst);
        }
        ctx.putImageData(img, 0, 0);
        return cv.toDataURL('image/png');
    }

    // Temporarily override every mesh material under a group, render, restore.
    function withOverride(group, makeMat, fn) {
        const saved = [];
        group.traverse(o => {
            if (o.isMesh || o.isInstancedMesh) {
                saved.push([o, o.material]);
                const m = makeMat(o);
                if (m) o.material = m;
            }
        });
        try { return fn(); }
        finally { saved.forEach(([o, m]) => { o.material = m; }); }
    }

    // Override every mesh under each living unit with a per-unit flat colour.
    function withUnitColors(colorForUnit, fn) {
        const saved = [];
        Game.units.forEach(u => {
            if (!u.alive || !u.mesh) return;
            const mat = flatMat(colorForUnit(u));
            u.mesh.traverse(o => {
                if (o.isMesh || o.isInstancedMesh) { saved.push([o, o.material]); o.material = mat; }
            });
        });
        try { return fn(); } finally { saved.forEach(([o, m]) => { o.material = m; }); }
    }

    // Hide selection rings / health bars / objective ring so UI never bleeds
    // into the masks or the RGB input (the model must not learn to draw UI).
    function withUIHidden(fn) {
        const hidden = [];
        const hide = (el) => { if (el && el.visible) { el.visible = false; hidden.push(el); } };
        Game.units.forEach(u => {
            const ud = u.mesh && u.mesh.userData;
            if (ud) { hide(ud.selectionRing); hide(ud.healthBar); }
        });
        hide(Game.objectiveRing);
        try { return fn(); } finally { hidden.forEach(el => { el.visible = true; }); }
    }

    function setVisible(group, v) { if (group) group.visible = v; }

    function captureFrameData(opts = {}) {
        if (!Game.renderer || !Game.scene || !Game.camera) return null;
        const THREEi = THREE();
        const aspect = Game.viewW / Game.viewH;
        const H = opts.height || 540;
        const W = Math.round(H * aspect);

        const prevClear = Game.renderer.getClearColor(new THREEi.Color()).getHex();
        const prevAlpha = Game.renderer.getClearAlpha();
        const tGroup = Game.terrainGroup, uGroup = Game.unitsGroup, eGroup = Game.effectsGroup;
        const tVis = tGroup && tGroup.visible, uVis = uGroup && uGroup.visible, eVis = eGroup && eGroup.visible;
        const fog = Game.scene.fog; // masks should ignore fog

        const out = {};
        return withUIHidden(() => {
        try {
            setVisible(eGroup, false);

            // 1. RGB — the normal render
            out.rgb = renderToCanvas(W, H);

            // Disable fog for the analytic passes
            Game.scene.fog = null;
            Game.renderer.setClearColor(0x000000, 1);

            // 2. DEPTH — depth material override across the whole scene
            const depthMat = new THREEi.MeshDepthMaterial();
            const prevOverride = Game.scene.overrideMaterial;
            Game.scene.overrideMaterial = depthMat;
            out.depth = renderToCanvas(W, H);
            Game.scene.overrideMaterial = prevOverride;

            // 3-5. UNIT masks — units only, flat colours; terrain hidden
            setVisible(tGroup, false);
            out.unit = withUnitColors((u) => {
                const cls = (Game.UNIT_STATS[`${u.team}_${u.kind}`] || {}).class || 'default';
                return CLASS_COLORS[cls] || CLASS_COLORS.default;
            }, () => renderToCanvas(W, H));
            out.team = withUnitColors((u) => TEAM_COLORS[u.team] || TEAM_COLORS.neutral, () => renderToCanvas(W, H));
            out.id = withUnitColors((u) => idColor(u.id), () => renderToCanvas(W, H));

            // 6. TERRAIN class mask — terrain visible, units hidden
            setVisible(tGroup, true);
            setVisible(uGroup, false);
            const classTex = terrainClassTexture();
            out.terrain = withOverride(tGroup, (o) => {
                if (o === Game.terrainMesh) return flatMatTex(classTex);
                return flatMat(STRUCTURE_COLOR);
            }, () => renderToCanvas(W, H));

            // metadata
            out.meta = {
                width: W, height: H,
                camera: { x: Game.cam.x, z: Game.cam.z, zoom: Game.cam.zoom, tiltDeg: Game.camTiltDeg || 35 },
                units: Game.units.filter(u => u.alive).map(u => ({
                    id: u.id, team: u.team, kind: u.kind,
                    class: (Game.UNIT_STATS[`${u.team}_${u.kind}`] || {}).class || 'default',
                    x: +u.x.toFixed(2), z: +u.z.toFixed(2),
                })),
                map: Game.currentMap,
            };
        } finally {
            Game.scene.fog = fog;
            setVisible(tGroup, tVis); setVisible(uGroup, uVis); setVisible(eGroup, eVis);
            Game.renderer.setClearColor(prevClear, prevAlpha);
        }
        return out;
        });
    }

    function flatMatTex(tex) {
        return new (THREE().MeshBasicMaterial)({ map: tex, fog: false });
    }

    function dl(dataUrl, filename) {
        const a = document.createElement('a');
        a.href = dataUrl; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
    }

    function downloadFrame(name = 'frame') {
        const d = captureFrameData();
        if (!d) return;
        ['rgb', 'depth', 'unit', 'team', 'id', 'terrain'].forEach(k => dl(d[k], `${name}_${k}.png`));
        dl('data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(d.meta, null, 2)), `${name}_meta.json`);
    }

    return { captureFrameData, downloadFrame, terrainClassTexture, _palettes: { TEAM_COLORS, CLASS_COLORS, TERRAIN_MASK_COLORS } };
})();

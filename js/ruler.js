/**
 * Debug ruler — toggle from the debug panel (` key), then left-click the map
 * to drop point A and again for point B. The measured span is drawn as a
 * bright line with tick marks spaced exactly one soldier height apart, a
 * soldier-height reference pole at point A, and a floating label reporting
 * the distance in world units, infantry heights (Game.SOLDIER_HEIGHT) and
 * terrain tiles (Game.TILE) — everything needed to sanity-check unit scales
 * against the map and each other.
 *
 * Clicks are intercepted in Game.handleMouseSelection (input.js) while the
 * ruler is on, so placing points never selects/orders units. Esc cancels the
 * pending point, then exits the ruler; the panel's Clear button wipes all
 * measurements. Measurements persist until cleared or the ruler is switched
 * off, so several spans can be compared side by side.
 */

Game._ruler = { on: false, pairs: [], pending: null };

// ── Visuals ────────────────────────────────────────────────────────────────

Game._rulerDispose = () => {
    if (Game._rulerGroup) {
        Game._rulerGroup.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) o.material.dispose();
        });
        if (Game.scene) Game.scene.remove(Game._rulerGroup);
        Game._rulerGroup = null;
    }
    if (Game._rulerPreview) {
        if (Game._rulerPreview.geometry) Game._rulerPreview.geometry.dispose();
        if (Game._rulerPreview.material) Game._rulerPreview.material.dispose();
        if (Game.scene) Game.scene.remove(Game._rulerPreview);
        Game._rulerPreview = null;
    }
    (Game._rulerLabels || []).forEach(el => el.remove());
    Game._rulerLabels = [];
    if (Game._rulerLiveLabel) { Game._rulerLiveLabel.remove(); Game._rulerLiveLabel = null; }
};

Game._rulerGroundY = (x, z) => (Game.getHeight ? Game.getHeight(x, z) : 0);

// Vertices for one measured span: main line, end posts, a soldier-height
// reference pole at A, and cross ticks every soldier height along the span.
Game._rulerSpanVerts = (a, b, out) => {
    const S = Game.SOLDIER_HEIGHT || 1.14;
    const lift = 0.18;
    const ax = a.x, az = a.z, ay = Game._rulerGroundY(ax, az) + lift;
    const bx = b.x, bz = b.z, by = Game._rulerGroundY(bx, bz) + lift;
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    // main line
    out.push(ax, ay, az, bx, by, bz);
    // end posts (short verticals)
    out.push(ax, ay, az, ax, ay + 0.35, az);
    out.push(bx, by, bz, bx, by + 0.35, bz);
    // soldier-height pole at A — the infantry reference standing on the map
    const gy = Game._rulerGroundY(ax, az);
    out.push(ax, gy, az, ax, gy + S, az);
    if (len < 1e-6) return;
    const ux = dx / len, uz = dz / len;      // along the span
    const px = -uz, pz = ux;                 // perpendicular (ground plane)
    // ticks every soldier height, drawn as little crosses
    const tick = 0.16;
    for (let d = S; d < len - 1e-4; d += S) {
        const tx = ax + ux * d, tz = az + uz * d;
        const ty = Game._rulerGroundY(tx, tz) + lift;
        out.push(tx - px * tick, ty, tz - pz * tick, tx + px * tick, ty, tz + pz * tick);
        out.push(tx - ux * tick, ty, tz - uz * tick, tx + ux * tick, ty, tz + uz * tick);
    }
};

Game._rulerRebuild = () => {
    if (Game._rulerGroup) {
        Game._rulerGroup.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            if (o.material) o.material.dispose();
        });
        Game.scene.remove(Game._rulerGroup);
        Game._rulerGroup = null;
    }
    (Game._rulerLabels || []).forEach(el => el.remove());
    Game._rulerLabels = [];
    if (!Game.scene || !Game.THREE) return;
    const THREE = Game.THREE;
    const pairs = Game._ruler.pairs;
    if (!pairs.length) return;

    const verts = [];
    for (const [a, b] of pairs) Game._rulerSpanVerts(a, b, verts);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        color: 0xffe066, depthTest: false, transparent: true, opacity: 0.95,
    }));
    lines.renderOrder = 1000;
    lines.raycast = () => { };
    const group = new THREE.Group();
    group.add(lines);

    // bright dots on every placed point (fixed screen size at any zoom)
    const dotVerts = [];
    for (const [a, b] of pairs) {
        dotVerts.push(a.x, Game._rulerGroundY(a.x, a.z) + 0.22, a.z);
        dotVerts.push(b.x, Game._rulerGroundY(b.x, b.z) + 0.22, b.z);
    }
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(dotVerts), 3));
    const dots = new THREE.Points(dotGeo, new THREE.PointsMaterial({
        color: 0xffe066,
        size: 7 * (Game.renderer ? Game.renderer.getPixelRatio() : 1),
        sizeAttenuation: false, depthTest: false, transparent: true, opacity: 0.95,
    }));
    dots.renderOrder = 1000;
    dots.raycast = () => { };
    group.add(dots);
    group.name = 'debug-ruler';
    Game.scene.add(group);
    Game._rulerGroup = group;

    // one floating label per measured span
    const viewport = document.getElementById('viewport');
    if (viewport) {
        for (const [a, b] of pairs) {
            const el = document.createElement('div');
            el.className = 'ruler-label';
            el.textContent = Game._rulerFmt(Game.dist(a.x, a.z, b.x, b.z));
            viewport.appendChild(el);
            el._mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
            Game._rulerLabels.push(el);
        }
    }
};

Game._rulerFmt = (len) => {
    const S = Game.SOLDIER_HEIGHT || 1.14;
    const T = Game.TILE || 3;
    return `${len.toFixed(2)} u · ${(len / S).toFixed(1)} soldiers · ${(len / T).toFixed(1)} tiles`;
};

// ── Interaction ────────────────────────────────────────────────────────────

Game.toggleRuler = (on) => {
    Game._ruler.on = on === undefined ? !Game._ruler.on : !!on;
    const btn = document.getElementById('dbgRuler');
    if (btn) btn.textContent = Game._ruler.on ? 'Ruler: ON' : 'Ruler: off';
    if (!Game._ruler.on) {
        Game._ruler.pairs = [];
        Game._ruler.pending = null;
        Game._rulerDispose();
    } else {
        Game.pushMessage('Ruler: left-click to place point A, then point B. Esc to exit.', 3.5);
    }
};

Game.rulerClickAt = (screenX, screenY) => {
    const g = Game.screenToGround(screenX, screenY);
    if (!g) return;
    const r = Game._ruler;
    if (!r.pending) {
        r.pending = { x: g.x, z: g.z };
    } else {
        r.pairs.push([r.pending, { x: g.x, z: g.z }]);
        r.pending = null;
        Game._rulerRebuild();
    }
};

Game.rulerClear = () => {
    Game._ruler.pairs = [];
    Game._ruler.pending = null;
    Game._rulerRebuild();
};

// Per-frame: live preview line + cursor-following label while point B is
// undecided, and reprojection of the finished-span labels as the camera moves.
Game.updateRuler = () => {
    const r = Game._ruler;
    if (!r || !r.on || !Game.scene) return;
    const THREE = Game.THREE;

    // live preview from pending A to the cursor
    if (r.pending && Game.mouse && Game.mouse.worldX !== undefined) {
        const a = r.pending;
        const b = { x: Game.mouse.worldX, z: Game.mouse.worldZ };
        const verts = [];
        Game._rulerSpanVerts(a, b, verts);
        if (!Game._rulerPreview) {
            const geo = new THREE.BufferGeometry();
            Game._rulerPreview = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
                color: 0xfff3b0, depthTest: false, transparent: true, opacity: 0.6,
            }));
            Game._rulerPreview.renderOrder = 1000;
            Game._rulerPreview.raycast = () => { };
            Game._rulerPreview.frustumCulled = false;
            Game.scene.add(Game._rulerPreview);
        }
        Game._rulerPreview.geometry.setAttribute(
            'position', new THREE.BufferAttribute(new Float32Array(verts), 3));

        if (!Game._rulerLiveLabel) {
            const viewport = document.getElementById('viewport');
            if (viewport) {
                Game._rulerLiveLabel = document.createElement('div');
                Game._rulerLiveLabel.className = 'ruler-label ruler-live';
                viewport.appendChild(Game._rulerLiveLabel);
            }
        }
        if (Game._rulerLiveLabel) {
            const len = Game.dist(a.x, a.z, b.x, b.z);
            Game._rulerLiveLabel.textContent = Game._rulerFmt(len);
            Game._rulerLiveLabel.style.left = (Game.mouse.screenX + 14) + 'px';
            Game._rulerLiveLabel.style.top = (Game.mouse.screenY - 10) + 'px';
            Game._rulerLiveLabel.style.display = 'block';
        }
    } else {
        if (Game._rulerLiveLabel) Game._rulerLiveLabel.style.display = 'none';
    }
    if (Game._rulerPreview) Game._rulerPreview.visible = !!r.pending;

    // keep finished-span labels glued to their midpoints
    for (const el of (Game._rulerLabels || [])) {
        const m = el._mid;
        if (!m) continue;
        const sp = Game.worldToScreen(m.x, m.z, Game._rulerGroundY(m.x, m.z) + 0.5);
        el.style.left = sp.x + 'px';
        el.style.top = sp.y + 'px';
    }
};

// Esc: cancel the pending point first, then exit the ruler. Own listener so
// input.js stays untouched apart from the click hook.
window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || !Game._ruler || !Game._ruler.on) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (Game._ruler.pending) {
        Game._ruler.pending = null;
    } else {
        Game.toggleRuler(false);
    }
});

// ── Debug panel section ────────────────────────────────────────────────────

(() => {
    const panel = document.getElementById('debugPanel');
    if (!panel) return;
    const wrap = document.createElement('div');
    wrap.innerHTML =
        '<div style="color:#7a8a96;font-size:10px;text-transform:uppercase;margin:10px 0 3px;letter-spacing:1px">Ruler</div>' +
        '<label style="gap:4px"><button id="dbgRuler" style="flex:1;background:#2a3138;color:#dfe7ef;border:1px solid rgba(80,90,100,.5);padding:3px 8px;cursor:pointer;font-size:11px">Ruler: off</button>' +
        '<button id="dbgRulerClear" style="background:#2a3138;color:#dfe7ef;border:1px solid rgba(80,90,100,.5);padding:3px 8px;cursor:pointer;font-size:11px">Clear</button></label>' +
        '<label style="gap:4px"><span style="min-width:0;text-align:left;flex:1;color:#7a8a96">click map: A then B · ticks = 1 soldier height</span></label>';
    panel.appendChild(wrap);
    wrap.querySelector('#dbgRuler').addEventListener('click', () => Game.toggleRuler());
    wrap.querySelector('#dbgRulerClear').addEventListener('click', () => Game.rulerClear());
})();

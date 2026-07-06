/**
 * Under Fire — garrison_ui.js
 * A lightweight DOM overlay floating above buildings:
 *   - occupancy ("n/cap") + average health of the troops inside,
 *   - an "enter" chevron affordance when the cursor is over a building while
 *     infantry are selected (FULL if there's no room).
 * Pure UI — all garrison logic lives in buildings.js. Degradable: if anything is
 * missing it simply renders nothing.
 */

Game._garrisonUI = { container: null, labels: new Map(), vec: null };

Game._ensureGarrisonContainer = () => {
    if (Game._garrisonUI.container) return Game._garrisonUI.container;
    const vp = document.getElementById('viewport') || document.body;
    const c = document.createElement('div');
    c.id = 'garrisonOverlay';
    c.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:30;';
    vp.appendChild(c);
    Game._garrisonUI.container = c;
    return c;
};

// Project a world point (with height) to viewport pixels.
Game._projWorld = (x, y, z) => {
    const THREE = Game.THREE;
    const v = Game._garrisonUI.vec || (Game._garrisonUI.vec = new THREE.Vector3());
    v.set(x, y, z).project(Game.camera);
    return { x: (v.x * 0.5 + 0.5) * Game.viewW, y: (-v.y * 0.5 + 0.5) * Game.viewH, vis: v.z < 1 };
};

Game.updateGarrisonUI = () => {
    if (!Game.buildingRecords || !Game.camera || !Game.THREE) return;
    const c = Game._ensureGarrisonContainer();

    // Does the current selection contain infantry that could still enter?
    const selInf = Game.selectedPlayerUnits
        ? Game.selectedPlayerUnits().filter(u => u.alive && !Game.isTank(u.kind) && !u._garrisoned)
        : [];
    const canEnter = selInf.length > 0;

    // Building under the cursor (only relevant when we have infantry to send in).
    let hover = null;
    if (canEnter && Game.mouse) {
        hover = (Game.buildingAtScreen && Game.buildingAtScreen(Game.mouse.screenX, Game.mouse.screenY))
            || (Game.buildingAt && Game.buildingAt(Game.mouse.worldX, Game.mouse.worldZ));
        if (hover && hover.collapsed) hover = null;
    }
    Game.hoverBuilding = hover;

    // Cursor affordance: a door+chevron over an enterable building (with room)
    // while infantry are selected — but not while an attack/command mode owns the
    // cursor. This is what signals "click to enter"; empty buildings get no label.
    const inCmd = !!Game._commandMode || Game.orderStance === 'attack';
    const wantEnter = !!hover && canEnter && !inCmd && Game.buildingHasRoom(hover);
    const vp = document.getElementById('viewport');
    if (vp) vp.classList.toggle('cmd-enter', wantEnter);

    // A selected building that emptied or collapsed drops its selection.
    if (Game.selectedBuilding && (Game.selectedBuilding.collapsed
        || !Game.selectedBuilding.occupants || !Game.selectedBuilding.occupants.length)) {
        Game.selectedBuilding = null;
    }

    const seen = new Set();
    for (const rec of Game.buildingRecords) {
        if (rec.collapsed) continue;
        const occ = rec.occupants ? rec.occupants.length : 0;
        if (occ === 0) continue;               // only label buildings with troops inside
        seen.add(rec);

        let el = Game._garrisonUI.labels.get(rec);
        if (!el) {
            el = document.createElement('div');
            el.style.cssText = 'position:absolute;transform:translate(-50%,-100%);'
                + 'font:600 11px system-ui,Segoe UI,sans-serif;color:#eee;white-space:nowrap;'
                + 'padding:3px 6px;border-radius:5px;background:rgba(20,22,18,0.72);'
                + 'border:1px solid rgba(255,255,255,0.15);text-shadow:0 1px 2px #000;';
            c.appendChild(el);
            Game._garrisonUI.labels.set(rec, el);
        }

        // Sudden Strike-style status stack: one row per occupant — life bar
        // (green) over ammo bar (yellow) — always shown while troops are inside
        // (SS manual §III.D: buildings containing units display their status
        // bars even when unselected).
        const st = Game.buildingOccupantStats(rec);
        const rows = [];
        for (const id of rec.occupants) {
            const u = Game.getUnitById ? Game.getUnitById(id) : null;
            if (!u || !u.alive) continue;
            const hp = Game.clamp(u.hp / (u.maxHp || 1), 0, 1);
            const am = (u.maxAmmo > 0) ? Game.clamp(u.ammo / u.maxAmmo, 0, 1) : 1;
            const hpc = hp > 0.66 ? '#5ec95e' : hp > 0.33 ? '#e0c46a' : '#e06a5a';
            rows.push('<div style="margin:2px 0">'
                + `<div style="width:32px;height:3px;background:#2a2a2a;border-radius:1px">`
                + `<div style="width:${Math.round(hp * 100)}%;height:3px;background:${hpc};border-radius:1px"></div></div>`
                + `<div style="width:32px;height:2px;background:#2a2a2a;margin-top:1px;border-radius:1px">`
                + `<div style="width:${Math.round(am * 100)}%;height:2px;background:#d8b93c;border-radius:1px"></div></div>`
                + '</div>');
        }
        el.innerHTML = `<div style="font-size:10px;text-align:center;margin-bottom:1px">\u{1F465} ${st.count}/${st.capacity}</div>`
            + rows.join('');
        // Selected building: bright frame (right-click terrain = all out;
        // right-click the building = one out).
        const isSel = rec === Game.selectedBuilding;
        el.style.borderColor = isSel ? '#ffd24a' : 'rgba(255,255,255,0.15)';
        el.style.boxShadow = isSel ? '0 0 6px rgba(255,210,74,0.55)' : 'none';

        const p = Game._projWorld(rec.cx, (rec.baseY || 0) + 7, rec.cz);
        if (p.vis) { el.style.display = 'block'; el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; }
        else el.style.display = 'none';
    }

    // Drop labels for buildings that no longer have occupants.
    for (const [rec, el] of Game._garrisonUI.labels) {
        if (!seen.has(rec)) { el.remove(); Game._garrisonUI.labels.delete(rec); }
    }
};

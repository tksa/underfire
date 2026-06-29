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
                + 'font:600 12px system-ui,Segoe UI,sans-serif;color:#eee;white-space:nowrap;'
                + 'padding:2px 7px;border-radius:5px;background:rgba(20,22,18,0.72);'
                + 'border:1px solid rgba(255,255,255,0.15);text-shadow:0 1px 2px #000;';
            c.appendChild(el);
            Game._garrisonUI.labels.set(rec, el);
        }

        const st = Game.buildingOccupantStats(rec);
        const hpc = st.avgHealthPct > 66 ? '#7ec97e' : st.avgHealthPct > 33 ? '#e0c46a' : '#e07a6a';
        el.innerHTML = `<span>\u{1F465} ${st.count}/${st.capacity}</span>`
            + ` <span style="color:${hpc}">♥ ${st.avgHealthPct}%</span>`;

        const p = Game._projWorld(rec.cx, (rec.baseY || 0) + 7, rec.cz);
        if (p.vis) { el.style.display = 'block'; el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; }
        else el.style.display = 'none';
    }

    // Drop labels for buildings that no longer have occupants.
    for (const [rec, el] of Game._garrisonUI.labels) {
        if (!seen.has(rec)) { el.remove(); Game._garrisonUI.labels.delete(rec); }
    }
};

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

    const seen = new Set();
    for (const rec of Game.buildingRecords) {
        if (rec.collapsed) continue;
        const isHover = rec === hover;
        const occ = rec.occupants ? rec.occupants.length : 0;
        if (occ === 0 && !isHover) continue;   // nothing to show for this one
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
        let html;
        if (st.count > 0) {
            const hpc = st.avgHealthPct > 66 ? '#7ec97e' : st.avgHealthPct > 33 ? '#e0c46a' : '#e07a6a';
            html = `<span>\u{1F465} ${st.count}/${st.capacity}</span>`
                + ` <span style="color:${hpc}">♥ ${st.avgHealthPct}%</span>`;
        } else {
            html = `<span style="opacity:.85">${st.capacity} space</span>`;
        }
        if (isHover && canEnter) {
            const full = !Game.buildingHasRoom(rec);
            html += full
                ? ' <span style="color:#e07a6a">FULL</span>'
                : ' <span style="color:#9fd6ff">❯ enter</span>';
            el.style.borderColor = full ? 'rgba(224,122,106,.65)' : 'rgba(159,214,255,.8)';
            el.style.background = 'rgba(18,28,40,0.85)';
        } else {
            el.style.borderColor = 'rgba(255,255,255,0.15)';
            el.style.background = 'rgba(20,22,18,0.72)';
        }
        el.innerHTML = html;

        const p = Game._projWorld(rec.cx, (rec.baseY || 0) + 7, rec.cz);
        if (p.vis) { el.style.display = 'block'; el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; }
        else el.style.display = 'none';
    }

    // Drop labels for buildings no longer occupied/hovered.
    for (const [rec, el] of Game._garrisonUI.labels) {
        if (!seen.has(rec)) { el.remove(); Game._garrisonUI.labels.delete(rec); }
    }
};

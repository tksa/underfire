/**
 * Under Fire — garrison_ui.js
 * A lightweight DOM overlay floating above buildings:
 *   - occupancy ("n/cap") + average health of the troops inside,
 *   - an "enter" chevron affordance when the cursor is over a building while
 *     infantry are selected (FULL if there's no room).
 * Pure UI — all garrison logic lives in buildings.js. Degradable: if anything is
 * missing it simply renders nothing.
 */

Game._garrisonUI = { container: null, labels: new Map(), transportLabels: new Map(), vec: null };

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
    const selected = Game.selectedPlayerUnits ? Game.selectedPlayerUnits() : [];
    const selInf = selected.filter(u => u.alive && Game.isFootInfantry(u)
        && !u._garrisoned && u._inVehicle == null);
    const canEnter = selInf.length > 0;
    const inCmd = !!Game._commandMode || Game.orderStance === 'attack';
    // An attack cursor cannot enter/tow. Skip expensive triangle picks entirely
    // in that mode, and reuse the same unit pick for entry and towing otherwise.
    const key = `${inCmd}:${selected.map(u => u.id).join(',')}:${Game.mouse?.screenX}:${Game.mouse?.screenY}`
        + `:${Game.cam.x}:${Game.cam.z}:${Game.cam.zoom}`;
    const now = performance.now();
    const previous = Game._garrisonUI.pick;
    const reuse = previous?.key === key && now < previous.until;
    const screenHover = reuse ? previous.unit
        : !inCmd && selected.length && Game.mouse && Game.unitAtScreen
            ? Game.unitAtScreen(Game.mouse.screenX, Game.mouse.screenY) : null;

    // Building under the cursor (only relevant when we have infantry to send in).
    let hover = reuse ? previous.building : null;
    if (!reuse && !inCmd && canEnter && Game.mouse) {
        hover = (Game.buildingAtScreen && Game.buildingAtScreen(Game.mouse.screenX, Game.mouse.screenY))
            || (Game.buildingAt && Game.buildingAt(Game.mouse.worldX, Game.mouse.worldZ));
        if (hover && hover.collapsed) hover = null;
    }
    Game.hoverBuilding = hover;
    const hoverUnit = canEnter ? screenHover : null;
    const hoverTransport = hoverUnit && hoverUnit.team === Game.playerTeam
        && hoverUnit.supportType === 'transport' ? hoverUnit : null;
    Game.hoverTransport = hoverTransport;
    const canEnterGun = !!hoverUnit && !!Game.canManGun && selInf.some(u => Game.canManGun(hoverUnit, u));
    Game.hoverGun = canEnterGun ? hoverUnit : null;

    // Empty horses are world props rather than selectable units. Only advertise
    // entry when this exact horse can accept a selected dismounted reserve rider.
    const hoverHorse = reuse ? previous.horse : !inCmd && selected.length && Game.mouse
        ? ((Game.horseAtScreen && Game.horseAtScreen(Game.mouse.screenX, Game.mouse.screenY))
            || (!hoverUnit && Game.horseAtWorld
                && Game.horseAtWorld(Game.mouse.worldX, Game.mouse.worldZ)))
        : null;
    const canEnterHorse = !!hoverHorse && !!Game.canMountHorse
        && selected.some(u => Game.canMountHorse(u, hoverHorse));
    Game.hoverHorse = hoverHorse;
    // A stationary cursor needs only 12.5 picks/s as units move underneath it.
    // Mouse/camera/selection changes invalidate immediately; clicks always pick
    // fresh in input.js, so this visual cache never decides an actual order.
    if (!reuse) Game._garrisonUI.pick = { key, until: performance.now() + 80,
        unit: screenHover, building: hover, horse: hoverHorse };

    // Cursor affordance: a door+chevron over an enterable building (with room)
    // while infantry are selected — but not while an attack/command mode owns the
    // cursor. This is what signals "click to enter"; empty buildings get no label.
    const canEnterBuilding = !!hover && Game.buildingHasRoom(hover);
    const canEnterTransport = !!hoverTransport && Game.transportHasRoom(hoverTransport);
    const towPair = screenHover && Game.getTowHoverPair ? Game.getTowHoverPair(screenHover) : null;
    Game.hoverTowPair = towPair;
    const wantEnter = !inCmd
        && ((canEnter && (canEnterBuilding || canEnterTransport || canEnterGun)) || canEnterHorse || !!towPair);
    const vp = document.getElementById('viewport');
    if (vp) vp.classList.toggle('cmd-enter', wantEnter);

    // Keep this instruction visible even when optional occupancy overlays are
    // disabled. The same eligibility helper drives the cursor and right-click.
    let gunHint = Game._garrisonUI.gunHint;
    if (canEnterGun && !inCmd) {
        if (!gunHint) {
            gunHint = document.createElement('div');
            gunHint.style.cssText = 'position:absolute;transform:translate(-50%,-100%);padding:4px 7px;'
                + 'font:600 12px system-ui;color:#eee;background:rgba(20,22,18,.85);white-space:nowrap;';
            c.appendChild(gunHint); Game._garrisonUI.gunHint = gunHint;
        }
        gunHint.textContent = 'Enter / man gun · Right-click';
        const p = Game._projWorld(hoverUnit.x, (hoverUnit.y || 0) + 2, hoverUnit.z);
        gunHint.style.display = p.vis ? 'block' : 'none';
        gunHint.style.left = p.x + 'px'; gunHint.style.top = p.y + 'px';
    } else if (gunHint) gunHint.style.display = 'none';

    // A selected building that emptied or collapsed drops its selection.
    if (Game.selectedBuilding && (Game.selectedBuilding.collapsed
        || !Game.selectedBuilding.occupants || !Game.selectedBuilding.occupants.length)) {
        Game.selectedBuilding = null;
    }

    // Occupancy stacks are opt-in like HP/Ammo/Fuel overlays. Keep the entry
    // cursor logic above active even while these labels are hidden.
    if (!Game.overlay || !Game.overlay.units) {
        for (const el of Game._garrisonUI.labels.values()) el.style.display = 'none';
        for (const el of Game._garrisonUI.transportLabels.values()) el.style.display = 'none';
        return;
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
        const html = `<div style="font-size:10px;text-align:center;margin-bottom:1px">\u{1F465} ${st.count}/${st.capacity}</div>`
            + rows.join('');
        if (el._garrisonHTML !== html) { el.innerHTML = html; el._garrisonHTML = html; }
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

    // Occupied transports use the same always-visible status stack as occupied
    // buildings: count/capacity plus one health/ammo row per passenger.
    const seenTransports = new Set();
    for (const truck of Game.units || []) {
        if (!truck.alive || truck.supportType !== 'transport'
            || !truck._passengers || !truck._passengers.length) continue;
        seenTransports.add(truck);
        let el = Game._garrisonUI.transportLabels.get(truck);
        if (!el) {
            el = document.createElement('div');
            el.style.cssText = 'position:absolute;transform:translate(-50%,-100%);'
                + 'font:600 11px system-ui,Segoe UI,sans-serif;color:#eee;white-space:nowrap;'
                + 'padding:3px 6px;border-radius:5px;background:rgba(20,22,18,0.72);'
                + 'border:1px solid rgba(255,255,255,0.15);text-shadow:0 1px 2px #000;';
            c.appendChild(el);
            Game._garrisonUI.transportLabels.set(truck, el);
        }
        const rows = [];
        let count = 0;
        for (const id of truck._passengers) {
            const u = Game.getUnitById ? Game.getUnitById(id) : null;
            if (!u || !u.alive) continue;
            count++;
            const hp = Game.clamp(u.hp / (u.maxHp || 1), 0, 1);
            const am = u.maxAmmo > 0 ? Game.clamp(u.ammo / u.maxAmmo, 0, 1) : 1;
            const hpc = hp > 0.66 ? '#5ec95e' : hp > 0.33 ? '#e0c46a' : '#e06a5a';
            rows.push('<div style="margin:2px 0">'
                + '<div style="width:32px;height:3px;background:#2a2a2a;border-radius:1px">'
                + `<div style="width:${Math.round(hp * 100)}%;height:3px;background:${hpc};border-radius:1px"></div></div>`
                + '<div style="width:32px;height:2px;background:#2a2a2a;margin-top:1px;border-radius:1px">'
                + `<div style="width:${Math.round(am * 100)}%;height:2px;background:#d8b93c;border-radius:1px"></div></div>`
                + '</div>');
        }
        const html = `<div style="font-size:10px;text-align:center;margin-bottom:1px">👥 ${count}/${Game.carrierCapacity(truck)}</div>`
            + rows.join('');
        if (el._garrisonHTML !== html) { el.innerHTML = html; el._garrisonHTML = html; }
        const selected = Game.selection && Game.selection.has(truck.id);
        el.style.borderColor = selected ? '#ffd24a' : 'rgba(255,255,255,0.15)';
        el.style.boxShadow = selected ? '0 0 6px rgba(255,210,74,0.55)' : 'none';
        const p = Game._projWorld(truck.x, (truck.y || 0) + 2.4, truck.z);
        if (p.vis) { el.style.display = 'block'; el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; }
        else el.style.display = 'none';
    }
    for (const [truck, el] of Game._garrisonUI.transportLabels) {
        if (!seenTransports.has(truck)) { el.remove(); Game._garrisonUI.transportLabels.delete(truck); }
    }
};

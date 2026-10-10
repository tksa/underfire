/** DOM-only command deck, refreshed by the existing HUD cadence. */
Game.hudEscape = value => String(value ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Small SVG silhouettes stay sharp at any display scale; no extra texture loads.
Game.unitCardIcon = u => {
    let shape;
    if (Game.isMortar(u)) shape = '<path d="M20 28 35 8l5 3-15 21m0-8 17 13M11 37h35M23 25 17 37"/>';
    else if (Game.isTank(u.kind)) shape = '<path d="M11 24h35l5 7-4 7H12l-7-6zM19 23l4-9h16l5 9M39 17h17"/><path d="M15 31h28"/>';
    else if (Game.isCarrier?.(u) || /truck|supply|fuel|transport/.test(u.kind)) shape = '<path d="M5 12h29v20H5zM34 20h12l8 8v4H34M39 21v7h13"/><circle cx="15" cy="34" r="5"/><circle cx="44" cy="34" r="5"/>';
    else if (Game.GUN_CREWS?.[u.kind] || /hmg|lmg/.test(u.kind) || ['hmg', 'lmg', 'mg'].includes(Game.WEAPONS[u.weaponKey]?.type)) shape = '<path d="M9 20h30l15-5M31 20 20 37m11-17 12 17M16 16v8m6-7v7"/><circle cx="31" cy="27" r="5"/>';
    else if (/medic/.test(u.kind)) shape = '<path d="M24 8h12v10h10v12H36v10H24V30H14V18h10z"/>';
    else if (/cavalry|ulan/.test(u.kind)) shape = '<path d="m10 23 8-8 20 3 5-9 10 9-7 8-10-1-4 10M19 24l-4 14m22-14 6 14M17 15l-6-6"/>';
    else shape = '<circle cx="24" cy="10" r="5"/><path d="m22 18-4 11 11 2 8 9M27 18l5 9 14-9M21 30l-7 10M34 25l17-14"/>';
    return `<svg viewBox="0 0 60 46" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${shape}</svg>`;
};

Game.renderSelectionCard = selected => {
    const panel = Game.hud.selectedPanel;
    if (!panel) return;
    const escape = Game.hudEscape;
    const text = (el, value) => { if (el.textContent !== value) el.textContent = value; };
    const buckets = new Map();
    for (const u of selected) {
        const key = `${u.team}:${u.kind}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(u);
    }
    const topology = [...buckets.keys()].join('|');
    // Keep buttons alive across health/ammo updates, preserving focus and scroll.
    if (panel._rosterTopology !== topology) {
        panel._rosterTopology = topology;
        panel.innerHTML = `<div class="selection-heading"><span data-roster-title></span><span class="unit-count" data-roster-count></span></div>
            <div class="unit-roster" aria-label="Selected unit types">${[...buckets].map(([key, units]) => {
                const u = units[0];
                return `<button type="button" class="unit-card" data-select-kind="${escape(u.kind)}" data-select-team="${escape(u.team)}">
                    <span class="card-groups"></span><strong class="card-count"></strong>
                    <span class="card-icon">${Game.unitCardIcon(u)}</span><span class="card-name">${escape(u.label)}</span>
                    <span class="card-health"><span>HP</span><strong></strong></span>
                    <span class="card-meter"><i></i><b title="Lowest unit health"></b></span>
                    <span class="card-ammo"><i></i></span></button>`;
            }).join('')}</div><div class="selection-detail"></div>`;
    }
    text(panel.querySelector('[data-roster-title]'), selected.length ? `${selected[0].team} forces` : 'Unit roster');
    text(panel.querySelector('[data-roster-count]'), selected.length ? `${selected.length} selected · ${buckets.size} types` : 'Ctrl + 0–9 assigns a group');
    const groupSets = Object.entries(Game.groups || {}).map(([n, ids]) => [n, new Set(ids)]);
    const cards = panel.querySelectorAll('.unit-card');
    [...buckets.values()].forEach((units, i) => {
        const card = cards[i];
        const hp = Math.round(units.reduce((v, u) => v + u.hp / u.maxHp, 0) / units.length * 100);
        const minHP = Math.round(Math.min(...units.map(u => u.hp / u.maxHp)) * 100);
        const armed = units.filter(u => u.maxAmmo > 0);
        const ammo = armed.length ? Math.round(armed.reduce((v, u) => v + u.ammo / u.maxAmmo, 0) / armed.length * 100) : 100;
        const groups = groupSets.map(([n, ids]) => [n, units.filter(u => ids.has(u.id)).length]).filter(([, count]) => count);
        const groupHTML = groups.map(([n, count]) => `<span class="group-badge${count < units.length ? ' partial' : ''}" title="Control group ${n}: ${count} of ${units.length} units">${n}${count < units.length ? `<small>·${count}</small>` : ''}</span>`).join('');
        const badges = card.querySelector('.card-groups');
        if (badges._html !== groupHTML) { badges.innerHTML = groupHTML; badges._html = groupHTML; }
        text(card.querySelector('.card-count'), String(units.length));
        text(card.querySelector('.card-health strong'), `${hp}%`);
        card.querySelector('.card-meter i').style.width = `${Game.clamp(hp, 0, 100)}%`;
        card.querySelector('.card-meter b').style.left = `${Game.clamp(minHP, 0, 100)}%`;
        card.querySelector('.card-ammo i').style.width = `${Game.clamp(ammo, 0, 100)}%`;
        card.classList.toggle('damaged', minHP < 50); card.classList.toggle('critical', minHP < 25);
        const groupLabel = groups.map(([n, count]) => `${n} (${count}/${units.length})`).join(', ');
        const title = `${units.length} × ${units[0].label} · Health ${hp}% · Lowest ${minHP}% · Ammo ${ammo}%${groupLabel ? ` · Control groups: ${groupLabel}` : ''}. Click to select this type; Shift-click to remove it.`;
        card.title = title; card.setAttribute('aria-label', title);
    });
    let detail = 'Click or drag to select troops. Ctrl + 0–9 assigns a control group.';
    if (selected.length === 1) {
        const u = selected[0];
        const status = u._unmanned ? 'Crew required' : Game.isMortar(u) && u.bombardX != null ? Game.mortarStatus(u)
            : u.holdFire ? 'Holding fire' : u.moving ? 'Moving' : u.fireTargetId != null ? 'Engaging' : 'Ready';
        detail = `${u.label} · ${status}`;
        if (u.maxAmmo > 0) detail += ` · Ammo ${u.ammo}/${u.maxAmmo}`;
        if (u.range) detail += ` · Range ${Game.mortarDistanceLabel(u.range)}`;
        if (u.maxFuel > 0) detail += ` · Fuel ${Math.round(u.fuel / u.maxFuel * 100)}%`;
        detail += ` · XP ${Math.round(u.experience || 0)} · Suppression ${Math.round(u.suppressionValue || 0)}%`;
        if (u.tracksDisabled) detail += ' · Tracks disabled';
        if (u.engineDamaged) detail += ' · Engine damaged';
    } else if (selected.length) {
        detail = `${selected.filter(u => u.moving).length} moving · ${selected.filter(u => u.holdFire).length} holding fire · Click a card to select its type · Shift-click removes it`;
    }
    text(panel.querySelector('.selection-detail'), detail);
    if (!selected.length && !panel.querySelector('.selection-empty')) {
        panel.querySelector('.unit-roster').innerHTML = '<div class="selection-empty"><strong>Select your troops</strong>Unit types, counts, health and control groups appear here.</div>';
    }
    if (!panel._selectionClick) {
        panel._selectionClick = true;
        panel.addEventListener('click', e => {
            const button = e.target.closest('[data-select-kind]');
            if (!button) return;
            const same = u => u.kind === button.dataset.selectKind && u.team === button.dataset.selectTeam;
            const units = Game.selectedPlayerUnits().filter(u => e.shiftKey ? !same(u) : same(u));
            Game.selection.clear(); units.forEach(u => Game.selection.add(u.id)); Game.updateHUD();
            if (e.detail) document.activeElement?.blur();
        });
    }
};

Game.updateCommandDeck = () => {
    const selected = Game.selectedPlayerUnits(), mortars = selected.filter(Game.isMortar);
    const byId = id => document.getElementById(id);
    const text = (id, value) => { const el = byId(id); if (el && el.textContent !== value) el.textContent = value; };
    text('commandSelection', selected.length ? `${selected.length} selected` : 'Select a unit');
    text('hudMissionTime', Game.formatTime(Game.missionState?.timer || 0));
    const mortarPanel = byId('mortarControls');
    if (mortarPanel) mortarPanel.hidden = !mortars.length;
    const radius = byId('mortarAreaRadius');
    if (radius) {
        if (document.activeElement !== radius) radius.value = Game.groundFireRadius;
        if (!radius._bound) {
            radius._bound = true;
            radius.addEventListener('input', () => Game.setGroundFireRadius(+radius.value));
        }
    }
    text('mortarAreaValue', Game.mortarDistanceLabel(Game.groundFireRadius));
    const bar = byId('hudBar');
    Game._hudTop = bar?.offsetHeight ? bar.getBoundingClientRect().top : Game.viewH;
    const mode = Game._commandMode;
    const hints = {
        attackground: mortars.length ? 'Click terrain to bombard · Wheel changes area' : 'Click terrain to fire at that position',
        grenade: 'Right-click the grenade target', smoke: 'Right-click to place smoke',
        rotate: 'Right-click the facing direction', airstrike: 'Right-click a target · Wheel selects planes',
        fighter: 'Right-click the patrol area', unload: 'Right-click the unloading point',
    };
    text('commandHint', mode ? hints[mode] || 'Right-click to place this order'
        : !selected.length ? 'Select a unit, then choose an order.'
            : Game.orderStance === 'attack' ? 'Right-click to advance and engage · Shift queues orders'
                : mortars.length ? 'Attack ground places a bombardment area.' : 'Right-click to move · Shift queues orders');
    const cancel = byId('cmdCancel'); if (cancel) cancel.hidden = !mode;
    byId('commandHint')?.parentElement.classList.toggle('targeting', !!mode);
    byId('cmdAttackGround')?.classList.toggle('armed', mode === 'attackground');
    for (const id of ['stanceMove', 'stanceAttack', 'cmdAttackGround', 'cmdHold']) {
        const b = byId(id); if (b) b.setAttribute('aria-pressed', String(b.classList.contains('active') || b.classList.contains('armed')));
    }
    const rapid = byId('cmdMortarRapid');
    const ranged = byId('cmdMortarMethod');
    if (rapid) { rapid.classList.toggle('active', mortars.length > 0 && mortars.every(u => u.mortarFireMode === 'rapid')); rapid.setAttribute('aria-pressed', String(rapid.classList.contains('active'))); }
    if (ranged) { ranged.classList.toggle('active', mortars.length > 0 && mortars.every(u => u.mortarFireMode !== 'rapid')); ranged.setAttribute('aria-pressed', String(ranged.classList.contains('active'))); }
    const pace = byId('paceBtn');
    if (pace) pace.textContent = Game.groupSpeedMatch ? 'March together' : 'Individual pace';
};

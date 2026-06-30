/**
 * Under Fire — input.js
 * Mouse and keyboard event handlers, selection, player commands.
 * Uses Three.js raycasting for 3D selection.
 */

Game.selectedPlayerUnits = () =>
    Game.units.filter(u => u.alive && u.team === Game.TEAM.FRENCH && Game.selection.has(u.id));

Game.issueCommand = (wx, wz, mode = 'move', unitList = null, queue = false) => {
    const chosen = unitList || Game.selectedPlayerUnits();
    if (!chosen.length) return;
    // Waypoint queuing (Ctrl/Cmd + move): append a leg to the existing route
    // instead of replacing it. Only sensible for plain moves on units that are
    // already routed somewhere; otherwise it behaves like a normal move.
    queue = queue && mode === 'move';

    // Calculate formation center → target angle for rotation
    let cx = 0, cz = 0;
    chosen.forEach(u => { cx += u.x; cz += u.z; });
    cx /= chosen.length; cz /= chosen.length;
    const angle = Math.atan2(wz - cz, wx - cx);

    const offsets = Game.formationOffsets(chosen.length, 2.5);

    // ── Combined-movement controller: role-aware slot assignment + group speed ──
    // Rank each formation slot by how far FORWARD it sits along the line of march,
    // then match slots to units by role so a mixed group moves as a coherent body:
    // armor leads, riflemen screen, the officer rides central, and medics / trucks /
    // mortars sit to the rear (out of the lead). (Plain index order put whoever was
    // selected first at the front, so a medic could end up on point.)
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    const slotFwd = offsets.map(o => {
        const rx = o.x * cosA - o.z * sinA, rz = o.x * sinA + o.z * cosA;
        return rx * cosA + rz * sinA;          // signed distance along the march
    });
    const slotOrder = offsets.map((_, i) => i).sort((a, b) => slotFwd[b] - slotFwd[a]); // front first
    const roleRank = (u) => {
        if (Game.isTank(u.kind)) return 0;                                    // armor leads
        if (u.class === 'infantry' && !u.supportType) return 1;               // riflemen screen
        if (u.supportType === 'officer' || u._actingOfficer) return 2;        // central
        if (u.supportType === 'medic' || u.supportType === 'supply'
            || u.supportType === 'fuel' || u.supportType === 'mechanic') return 5; // support to the rear
        if (u.kind && String(u.kind).indexOf('mortar') === 0) return 5;       // mortars rear
        return 3;                                                             // MG / AT / other, mid
    };
    const unitOrder = chosen.map((_, i) => i).sort((a, b) => roleRank(chosen[a]) - roleRank(chosen[b]));
    const slotFor = new Array(chosen.length);
    for (let k = 0; k < chosen.length; k++) slotFor[unitOrder[k]] = slotOrder[k];

    // Group pace = the slowest member's EFFECTIVE speed, so armor/trucks wait for the
    // infantry. Foot troops carry a hidden 0.6 base factor (+ stance) that vehicles
    // don't, so compare like-for-like here and let the move module cap to this.
    const effSpeed = (u) => {
        let s = u.speed || 0;
        if (!Game.isTank(u.kind) && u.kind !== 'fuel' && u.kind !== 'supply') {
            const stanceF = ({ prone: 0.28, crouch: 0.55, stand: 1.0, run: 1.5 })[u.stance] ?? 1.0;
            s *= 0.6 * stanceF;
        }
        return s;
    };
    let groupSpeed = Infinity;
    if (chosen.length > 1 && !queue) for (const u of chosen) groupSpeed = Math.min(groupSpeed, effSpeed(u));
    // Opt-in only: by default every unit travels at its own speed. The pace cap is
    // applied solely when the player has toggled "march together" on.
    const groupMove = Game.groupSpeedMatch && chosen.length > 1 && !queue && groupSpeed < Infinity && groupSpeed > 0;

    chosen.forEach((unit, i) => {
        const isQueued = queue && unit.path && unit.path.length > 0;
        // A move order cancels any standing attack/bombard/facing/enter commitment.
        // (A queued leg keeps the unit rolling, so don't yank these mid-route — but
        // it's still a relocate, so clearing them is harmless and consistent.)
        unit.forcedTargetId = null;
        unit.bombardX = null; unit.bombardZ = null;
        unit._bombarding = false;
        unit._faceAngle = null; unit._faceUntil = 0;
        unit._enterRec = null;
        if (Game.AI && Game.AI.clearPosture) Game.AI.clearPosture(unit); // ends guard/at-ease
        // Group pace cap: armor/trucks wait for the slowest member (cleared on arrival).
        if (groupMove && !isQueued) { unit._groupSpeed = groupSpeed; unit._groupMoveActive = true; }
        // Rotate the unit's ROLE-ASSIGNED slot to face the movement direction.
        const off = offsets[isQueued ? i : (slotFor[i] != null ? slotFor[i] : i)];
        const rx = off.x * Math.cos(angle) - off.z * Math.sin(angle);
        const rz = off.x * Math.sin(angle) + off.z * Math.cos(angle);
        const tx = Game.clamp(wx + rx, 1, Game.WORLD_W - 1);
        const tz = Game.clamp(wz + rz, 1, Game.WORLD_H - 1);
        unit.targetX = tx;
        unit.targetZ = tz;
        if (isQueued) {
            // Append a leg from the current end of the route (skip the live detour
            // waypoint if one is in front) so the unit visits waypoints in order.
            const route = unit.path.filter(p => !p._detour);
            const from = route.length ? route[route.length - 1] : { x: unit.x, z: unit.z };
            const leg = Game.findPath(unit, from.x, from.z, tx, tz);
            unit.path = route.concat(leg);
        } else {
            unit.path = Game.findPath(unit, unit.x, unit.z, tx, tz);
        }
        // Attack-move: advance to the area but stop to engage any enemy that comes
        // into range, then push on. A plain move is a RELOCATE order: obey it and
        // get to the destination, do NOT stop to fight or chase (it can still
        // return fire on the move, but never halts/diverts). Hold = put-and-defend.
        if (mode === 'attack') {
            unit.orderMode = 'assault'; unit.holdFire = false;
            // Remember WHERE the attack-move is headed. The engage module clears the
            // path to stop and fight when an enemy comes into range; without this the
            // unit would just sit where the last enemy fell. With it, once the local
            // fight is over it resumes the advance to the ordered spot (the red circle).
            unit._assaultGoal = { x: tx, z: tz };
        }
        else if (mode === 'hold') { unit.orderMode = 'hold'; unit._assaultGoal = null; }
        else {
            // Plain move. Reset any standing 'assault'/forced-target lock so the
            // engage module can't halt the unit when an enemy is in range — this
            // is what made a tank under fire "not listen" and refuse to pull back.
            unit.orderMode = 'move';
            unit._assaultGoal = null;
            unit._engageId = null;
            unit._inFiringPos = false;
            unit._pursueAnchor = null;
            unit._pursueTimer = 0;
        }
        // Reverse-into-spot: a plain Move to a SHORT distance BEHIND a vehicle backs
        // it in rather than swinging the whole hull around. Tanks + trucks only.
        unit._reverseMove = false;
        if (mode === 'move' && !isQueued
            && (Game.isTank(unit.kind) || unit.kind === 'fuel' || unit.kind === 'supply')) {
            const gAng = Math.atan2(tz - unit.z, tx - unit.x);
            const gd = Math.hypot(tx - unit.x, tz - unit.z);
            if (gd < (Game.REVERSE_MAX_DIST ?? 11) && Math.abs(Game.angleDiff(unit.angle, gAng)) > 1.9) {
                unit._reverseMove = true;
                // Back STRAIGHT into the spot: replace A*'s tile-snapped, slightly
                // curved short path with a single direct segment to the exact point.
                // The curve was making the lorry steer through extra lanes and never
                // cleanly settle on the goal. A short reverse is a clear, direct back-up.
                unit.path = [{ x: tx, z: tz }];
            }
        }
        // Combat readiness: a plain Move travels "weapons stowed" — the unit needs
        // a moment to react to contact. Attack-move advances already ready. A
        // queued leg keeps whatever readiness it already had (no re-stow stall).
        if (mode === 'move' && !isQueued) { unit._combatReady = false; unit._readyTimer = 0; }
        else if (mode !== 'move') unit._combatReady = true;
        unit.moving = true;
        unit.stopTimer = 0;
        // Don't re-impose the command reaction delay on a queued leg — the unit is
        // already rolling and just gets another waypoint tacked on.
        if (!isQueued) unit.orderDelay = Game.commandDelay(unit);
        // Pulsing destination marker: red attack-move, green move, cyan queued waypoint.
        Game.spawnOrderMarker(tx, tz, mode === 'attack' ? 0xff5544 : (isQueued ? 0x55ccff : 0x88cc66));
    });
    Game.pushMessage(queue ? 'Waypoint added.' : (mode === 'attack' ? 'Attack-move ordered.' : 'Move ordered.'), 1.8);
    if (Game.Audio) {
        const anyTank = chosen.some(u => Game.isTank(u.kind));
        Game.Audio.voice(anyTank ? 'f_tank_move' : 'f_sold_move');
    }

    // Clear preview markers
    Game._clearFormationPreview();
};

/**
 * Set the persistent right-click order stance ('move' or 'attack') and reflect
 * it in the HUD switch + the battlefield cursor.
 */
Game.setOrderStance = (stance) => {
    Game.orderStance = stance === 'attack' ? 'attack' : 'move';
    document.querySelectorAll('.stance-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.stance === Game.orderStance));
    // Cursor is synced each frame in the game loop (covers stance + targeting modes).
    Game.pushMessage(Game.orderStance === 'attack'
        ? 'Attack-move: units advance ready and engage.'
        : 'Move: units relocate without seeking combat.', 1.6);
};

// Toggle "march together" pace matching. OFF (default) = every unit moves at its
// own speed; ON = a mixed group holds the slowest member's pace.
Game.toggleGroupPace = () => {
    Game.groupSpeedMatch = !Game.groupSpeedMatch;
    const btn = document.getElementById('paceBtn');
    if (btn) btn.classList.toggle('active', Game.groupSpeedMatch);
    if (!Game.groupSpeedMatch) Game.units.forEach(u => { u._groupMoveActive = false; }); // release any active cap
    Game.pushMessage(Game.groupSpeedMatch
        ? 'March together: the group holds the slowest unit’s pace.'
        : 'March: each unit moves at its own speed.', 1.8);
};

/**
 * Attack-move to a ground spot: EVERY selected unit advances to the area and
 * engages enemies it meets along the way. Mortars move too (they do not bombard
 * the spot here — deliberate area fire is the separate "Attack Ground" order).
 */
Game.orderAttackMove = (x, z) => {
    const chosen = Game.selectedPlayerUnits();
    if (!chosen.length) return;
    chosen.forEach(u => { u.bombardX = null; u.bombardZ = null; u._bombarding = false; });
    Game.issueCommand(x, z, 'attack', chosen);
};

/**
 * Retreat: force the selected units to break off the fight and fall back to a
 * point. They stop acquiring targets (no firing), infantry sprint, and tanks
 * reverse out of contact keeping their front toward the threat.
 */
Game.orderRetreat = (x, z) => {
    const chosen = Game.selectedPlayerUnits();
    if (!chosen.length) return;
    const tx = Game.clamp(x, 1, Game.WORLD_W - 1), tz = Game.clamp(z, 1, Game.WORLD_H - 1);
    chosen.forEach(u => {
        u.forcedTargetId = null;
        u.bombardX = null; u.bombardZ = null; u._bombarding = false;
        u._enterRec = null;
        u._assaultGoal = null;
        if (Game.AI && Game.AI.clearPosture) Game.AI.clearPosture(u);
        u.orderMode = 'retreat';
        u.retreating = true;
        const threat = (u._engageId != null ? Game.getUnitById(u._engageId) : null) || Game.nearestEnemy(u);
        u._retreatThreat = (threat && threat.alive) ? { x: threat.x, z: threat.z } : null;
        if (!Game.isTank(u.kind)) { u.stance = 'run'; u._autoStance = true; }
        u.path = Game.findPath(u, u.x, u.z, tx, tz);
        u.moving = true;
        u.stopTimer = 0;
        u.orderDelay = 0;
    });
    Game.spawnOrderMarker(x, z, 0x44aaff); // blue = retreat
    Game.pushMessage('Retreat — break off and fall back!', 1.8);
    if (Game.Audio) Game.Audio.voice('f_sold_move');
    Game._clearFormationPreview();
};

/**
 * Attack Ground: each selected armed unit takes up a firing position within
 * range + line of sight of the spot and pours fire onto it. Mortars/indirect
 * lob shells; direct-fire units (tanks, MGs, rifles) suppress the area. They do
 * NOT walk onto the spot — they shoot AT it.
 */
Game.orderAttackGround = (x, z) => {
    const chosen = Game.selectedPlayerUnits();
    if (!chosen.length) return;
    let any = false;
    chosen.forEach(u => {
        const w = Game.WEAPONS[u.weaponKey];
        if (!w || w.fireType === 'none' || (w.gameRange || 0) <= 0) return; // unarmed
        any = true;
        u._enterRec = null;
        if (Game.AI && Game.AI.clearPosture) Game.AI.clearPosture(u);
        u.bombardX = x; u.bombardZ = z;
        u.forcedTargetId = null;
        u.orderMode = 'aggressive';
        u.holdFire = false;
        u._bombarding = false;
        u._combatReady = true;
        u.stopTimer = 0;
        u.orderDelay = Game.commandDelay(u);
    });
    if (any) {
        Game.spawnOrderMarker(x, z, 0xff8844); // orange = fire on ground
        Game.pushMessage('Attack ground — suppressing the area.', 1.6);
        if (Game.Audio) Game.Audio.voice('f_sold_attack');
    }
    Game._clearFormationPreview();
};

/**
 * Command-and-control delay (GDD): orders are immediate for usability but
 * low-cohesion units react slower. Suppression lengthens the delay; a nearby
 * officer almost eliminates it; French radio cohesion is slightly worse.
 */
Game.commandDelay = (unit) => {
    let base = Game.isTank(unit.kind) ? 0.18 : 0.1;
    const supp = (unit.suppressionValue || 0) / 100;
    let delay = base + supp * 0.6;
    const nearOfficer = Game.units.some(o => o.alive && o.team === unit.team
        && o.supportType === 'officer' && Game.dist(o.x, o.z, unit.x, unit.z) < 12);
    if (nearOfficer) delay *= 0.3;
    else if (unit.team === Game.TEAM.FRENCH) delay *= 1.15;
    return Game.clamp(delay, 0, 1.0);
};

// Nearest enemy (of the player) to a world point, within pick radius.
// Fog-gated: an enemy the player hasn't currently spotted can't be picked, so
// clicking blind into the fog issues a ground order instead of silently
// "homing" onto a hidden unit and giving its position away.
Game.enemyAtWorld = (x, z) => {
    let best = null, bestD = Infinity;
    for (const u of Game.units) {
        if (!u.alive || u.team === Game.TEAM.FRENCH) continue;
        if (Game.isFogVisible && !Game.isFogVisible(u.x, u.z)) continue;
        const d = Game.distSq(x, z, u.x, u.z);
        const pick = Math.max((u.size + 0.9) * (u.size + 0.9), 3.5);
        if (d < pick && d < bestD) { bestD = d; best = u; }
    }
    return best;
};

/**
 * Force selected units to attack a specific enemy.
 * Direct-fire units commit to the target and close to weapon range;
 * mortars bombard the target's position. Unarmed units are ignored.
 */
Game.orderAttackTarget = (target) => {
    const chosen = Game.selectedPlayerUnits();
    if (!chosen.length || !target) return;
    let any = false;
    chosen.forEach(u => {
        const w = Game.WEAPONS[u.weaponKey];
        if (!w || w.fireType === 'none' || (w.gameRange || 0) <= 0) return; // unarmed
        any = true;
        u._enterRec = null;
        if (Game.AI && Game.AI.clearPosture) Game.AI.clearPosture(u);
        if (w.fireType === 'indirect') {
            u.bombardX = target.x; u.bombardZ = target.z;
            u.forcedTargetId = null;
            return;
        }
        u.forcedTargetId = target.id;
        u.bombardX = null; u.bombardZ = null;
        u.orderMode = 'aggressive';
        u.holdFire = false;
        u._combatReady = true; // explicit attack — engage on contact
        const d = Game.dist(u.x, u.z, target.x, target.z);
        if (d > u.range * 0.9) {
            // Close to within weapon range, approaching from our side
            const ang = Game.angleTo(target.x, target.z, u.x, u.z);
            const standoff = u.range * 0.75;
            const gx = Game.clamp(target.x + Math.cos(ang) * standoff, 1, Game.WORLD_W - 1);
            const gz = Game.clamp(target.z + Math.sin(ang) * standoff, 1, Game.WORLD_H - 1);
            u.path = Game.findPath(u, u.x, u.z, gx, gz);
            u.moving = true;
            u.orderDelay = Game.commandDelay(u);
        } else {
            u.path = []; u.moving = false;
        }
        u.stopTimer = 0;
    });
    if (any) {
        Game.spawnOrderMarker(target.x, target.z, 0xff5544); // red = attack
        Game.pushMessage('Attacking target!', 1.5);
        if (Game.Audio) {
            const anyTank = chosen.some(u => Game.isTank(u.kind));
            Game.Audio.voice(anyTank ? 'f_tank_attack' : 'f_sold_attack');
        }
    }
    Game._clearFormationPreview();
};

// ── Order Destination Markers (pulse where troops will move to) ──
Game._orderMarkers = [];

Game.spawnOrderMarker = (x, z, color = 0x88cc66) => {
    const THREE = Game.THREE;
    if (!THREE || !Game.scene) return;
    const y = (Game.getHeight ? Game.getHeight(x, z) : 0) + 0.12;

    const group = new THREE.Group();
    group.position.set(x, y, z);

    const ringGeo = new THREE.RingGeometry(0.3, 0.45, 20);
    const ringMat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.9,
        depthWrite: false, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);

    // Expanding pulse wave ring
    const pulseGeo = new THREE.RingGeometry(0.42, 0.52, 20);
    const pulseMat = ringMat.clone();
    pulseMat.opacity = 0.6;
    const pulse = new THREE.Mesh(pulseGeo, pulseMat);
    pulse.rotation.x = -Math.PI / 2;
    group.add(pulse);

    group.traverse(o => { o.raycast = () => { }; }); // don't block ground picking
    Game.scene.add(group);
    Game._orderMarkers.push({ group, ring, pulse, life: 1.1, total: 1.1 });
};

Game.updateOrderMarkers = (dt) => {
    for (let i = Game._orderMarkers.length - 1; i >= 0; i--) {
        const m = Game._orderMarkers[i];
        m.life -= dt;
        if (m.life <= 0) {
            Game.scene.remove(m.group);
            m.group.children.forEach(c => { c.geometry.dispose(); c.material.dispose(); });
            Game._orderMarkers.splice(i, 1);
            continue;
        }
        const t = m.total - m.life;
        const fade = Math.min(1, m.life / 0.5);   // fade out over the last 0.5s
        const pop = Math.min(1, t / 0.15);        // quick pop-in
        m.ring.scale.setScalar(0.7 + 0.3 * pop);
        m.ring.material.opacity = 0.9 * fade;

        // single pulse wave: expands once and fades out
        const wave = Math.min(1, t / 0.7);
        m.pulse.scale.setScalar(1 + wave * 1.6);
        m.pulse.material.opacity = (1 - wave) * 0.55 * fade;
    }
};

// ── Formation Preview Markers ──
Game._formationPreviews = [];

Game._clearFormationPreview = () => {
    Game._formationPreviews.forEach(m => {
        if (m.parent) m.parent.remove(m);
        m.geometry.dispose();
        m.material.dispose();
    });
    Game._formationPreviews = [];
};

Game._showFormationPreview = (wx, wz) => {
    Game._clearFormationPreview();
    const chosen = Game.selectedPlayerUnits();
    if (!chosen.length) return;

    const THREE = Game.THREE;
    let cx = 0, cz = 0;
    chosen.forEach(u => { cx += u.x; cz += u.z; });
    cx /= chosen.length; cz /= chosen.length;
    const angle = Math.atan2(wz - cz, wx - cx);

    // Red preview when attack-move is armed (advance + engage), green for a plain
    // move — matches the destination order-marker colours.
    const attackMode = Game.orderStance === 'attack';
    const ringColor = attackMode ? 0xff5544 : 0x88cc66;

    const offsets = Game.formationOffsets(chosen.length, 2.5);
    offsets.forEach(off => {
        const rx = off.x * Math.cos(angle) - off.z * Math.sin(angle);
        const rz = off.x * Math.sin(angle) + off.z * Math.cos(angle);
        const px = Game.clamp(wx + rx, 1, Game.WORLD_W - 1);
        const pz = Game.clamp(wz + rz, 1, Game.WORLD_H - 1);
        const py = Game.getHeight ? Game.getHeight(px, pz) : 0;

        const geo = new THREE.RingGeometry(0.25, 0.4, 12);
        const mat = new THREE.MeshBasicMaterial({
            color: ringColor,
            transparent: true,
            opacity: 0.45,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        const marker = new THREE.Mesh(geo, mat);
        marker.rotation.x = -Math.PI / 2;
        marker.position.set(px, py + 0.15, pz);
        Game.scene.add(marker);
        Game._formationPreviews.push(marker);
    });
};

/**
 * Rotate: turn the selected units in place to face a point. Sets a persistent
 * desired facing (held briefly) so the turn is actually carried out by the move
 * module instead of being snapped and instantly overwritten by path/aim logic.
 * Tanks swing hull + turret; infantry/guns pivot to face.
 */
Game.orderFace = (x, z) => {
    const chosen = Game.selectedPlayerUnits();
    if (!chosen.length) return;
    chosen.forEach(u => {
        u._faceAngle = Game.angleTo(u.x, u.z, x, z);
        u._faceUntil = Game.gameClock + 4;     // hold the manual facing while it turns
        u.path = [];
        u.moving = false;
        u.forcedTargetId = null;
        u._engageId = null;
        u.bombardX = null; u.bombardZ = null; u._bombarding = false;
        u.stopTimer = Math.max(u.stopTimer || 0, 0.2);
    });
    Game.spawnOrderMarker(x, z, 0xffd27a);     // amber = facing
    Game.pushMessage('Facing set.', 1.2);
    if (Game.Audio) {
        const anyTank = chosen.some(u => Game.isTank(u.kind));
        Game.Audio.voice(anyTank ? 'f_tank_move' : 'f_sold_move');
    }
    Game._clearFormationPreview();
};

Game.haltSelection = () => {
    Game.selectedPlayerUnits().forEach(u => {
        u.path = [];
        u.targetX = u.x;
        u.targetZ = u.z;
        u.stopTimer = 0.4;
        u.moving = false;
        u.forcedTargetId = null;
        u.bombardX = null; u.bombardZ = null;
        u._bombarding = false;
    });
    Game.pushMessage('Selected units halted.', 1.5);
};

// Movement modes: run → walk → crouch-walk → crawl
Game.STANCE_ORDER = ['run', 'stand', 'crouch', 'prone'];
Game.STANCE_LABEL = { run: 'Run', stand: 'Walk', crouch: 'Crouch', prone: 'Crawl' };

Game.setStanceForSelection = () => {
    const selected = Game.selectedPlayerUnits().filter(u => !Game.isTank(u.kind));
    if (!selected.length) return;
    const idx = Game.STANCE_ORDER.indexOf(selected[0].stance);
    const next = Game.STANCE_ORDER[(idx + 1) % Game.STANCE_ORDER.length];
    selected.forEach(u => { u.stance = next; u._autoStance = false; });
    Game.pushMessage(`Movement mode: ${Game.STANCE_LABEL[next]}.`, 1.7);
};

// Toggle selected infantry between crawling (prone) and standing.
Game.toggleProneSelection = () => {
    const sel = Game.selectedPlayerUnits().filter(u => !Game.isTank(u.kind));
    if (!sel.length) return;
    const anyUp = sel.some(u => u.stance !== 'prone');
    sel.forEach(u => { u.stance = anyUp ? 'prone' : 'stand'; u._autoStance = false; });
    if (Game.Audio) Game.Audio.voice(anyUp ? 'f_sold_move' : 'f_sold_select');
    Game.pushMessage(anyUp ? 'Crawling (prone).' : 'Standing up.', 1.5);
};

// The selected foot soldier nearest a target point — used for grenade/smoke so
// the closest man (most likely in range) does the throwing, not just the first.
Game.nearestThrower = (x, z) => {
    let best = null, bd = Infinity;
    for (const u of Game.selectedPlayerUnits()) {
        if (Game.isTank(u.kind)) continue;
        const d = Game.distSq(u.x, u.z, x, z);
        if (d < bd) { bd = d; best = u; }
    }
    return best;
};

// Hold fire is a dedicated stand-down flag (separate from move/attack orders):
// the unit keeps its orders and still relocates, but will not open fire or seek
// targets until weapons are freed again.
Game.setHoldFire = (on) => {
    Game.selectedPlayerUnits().forEach(u => { u.holdFire = !!on; });
};

Game.toggleHoldFire = () => {
    const sel = Game.selectedPlayerUnits();
    if (!sel.length) { Game.pushMessage('No unit selected.', 1.2); return; }
    const turnOn = sel.some(u => !u.holdFire);   // any weapon free -> hold them all
    sel.forEach(u => { u.holdFire = turnOn; });
    Game.pushMessage(turnOn ? 'Holding fire — weapons safe.' : 'Weapons free — fire at will.', 1.6);
    if (Game.Audio) Game.Audio.voice('f_sold_select');
};

Game.handleMouseSelection = () => {
    const mouse = Game.mouse;
    const dx = mouse.dragCurrentX - mouse.dragStartX;
    const dy = mouse.dragCurrentY - mouse.dragStartY;
    const boxW = Math.abs(dx);
    const boxH = Math.abs(dy);

    if (boxW < 4 && boxH < 4) {
        // Enter-building: if infantry are selected and the click lands on a
        // building (and not on a friendly unit you meant to select instead),
        // send the selected infantry in rather than changing the selection.
        const enterInf = Game.selectedPlayerUnits().filter(u => u.alive && !Game.isTank(u.kind) && !u._garrisoned);
        if (enterInf.length) {
            const picked0 = Game.unitAtScreen && Game.unitAtScreen(mouse.dragCurrentX, mouse.dragCurrentY);
            const onFriendly = picked0 && picked0.team === Game.TEAM.FRENCH;
            if (!onFriendly) {
                const gp = Game.screenToGround(mouse.dragCurrentX, mouse.dragCurrentY);
                const rec = (Game.buildingAtScreen && Game.buildingAtScreen(mouse.dragCurrentX, mouse.dragCurrentY))
                    || (gp && Game.buildingAt && Game.buildingAt(gp.x, gp.z));
                if (rec && !rec.collapsed) { Game.orderEnterBuilding(rec); return; }
            }
        }

        // Click select — dual approach: world-space + screen-space
        let picked = null;
        let bestDist = Infinity;

        // Method 1: World-space raycast pick
        const groundPt = Game.screenToGround(mouse.dragCurrentX, mouse.dragCurrentY);
        if (groundPt) {
            for (const unit of Game.units) {
                if (!unit.alive || unit.team !== Game.TEAM.FRENCH) continue;
                const d = Game.distSq(groundPt.x, groundPt.z, unit.x, unit.z);
                const pickRange = Math.max((unit.size + 0.8) * (unit.size + 0.8), 3.0);
                if (d < pickRange && d < bestDist) {
                    bestDist = d;
                    picked = unit;
                }
            }
        }

        // Method 2: Screen-space fallback (if world pick missed). Kept tight so a
        // click on empty ground between units deselects instead of grabbing the
        // nearest one (left-click empty = deselect).
        if (!picked) {
            let bestScreenDist = 169; // 13px squared
            for (const unit of Game.units) {
                if (!unit.alive || unit.team !== Game.TEAM.FRENCH) continue;
                const sp = Game.worldToScreen(unit.x, unit.z);
                const sdx = sp.x - mouse.dragCurrentX;
                const sdy = sp.y - mouse.dragCurrentY;
                const sd = sdx * sdx + sdy * sdy;
                if (sd < bestScreenDist) {
                    bestScreenDist = sd;
                    picked = unit;
                }
            }
        }
        if (!Game.keys['ShiftLeft'] && !Game.keys['ShiftRight']) Game.selection.clear();
        if (picked) {
            if (Game.Audio) Game.Audio.voice(Game.isTank(picked.kind) ? 'f_tank_select' : 'f_sold_select');
            const now = performance.now();
            if (Game._lastPickedKind === picked.kind && now - Game._lastPickedTime < 300) {
                // Double-click: select all visible units of same kind
                Game.units.forEach(u => {
                    if (u.alive && u.team === Game.TEAM.FRENCH && u.kind === picked.kind) {
                        Game.selection.add(u.id);
                    }
                });
            } else {
                Game.selection.add(picked.id);
            }
            Game._lastPickedKind = picked.kind;
            Game._lastPickedTime = now;
        }
    } else {
        // Box select — project units to screen, check in box
        const sx = Math.min(mouse.dragStartX, mouse.dragCurrentX);
        const sy = Math.min(mouse.dragStartY, mouse.dragCurrentY);
        const ex = sx + boxW;
        const ey = sy + boxH;

        if (!Game.keys['ShiftLeft'] && !Game.keys['ShiftRight']) Game.selection.clear();
        Game.units.forEach(unit => {
            if (!unit.alive || unit.team !== Game.TEAM.FRENCH) return;
            const sp = Game.worldToScreen(unit.x, unit.z);
            if (sp.x >= sx && sp.x <= ex && sp.y >= sy && sp.y <= ey) {
                Game.selection.add(unit.id);
            }
        });
    }

    // Update selection ring visibility
    Game.units.forEach(u => {
        if (u.mesh && u.mesh.userData.selectionRing) {
            u.mesh.userData.selectionRing.visible = Game.selection.has(u.id);
        }
    });

    // Deselecting must hide the green formation-preview rings right away — they
    // were only cleared on mousemove, so they lingered until the cursor moved.
    if (Game.selection.size === 0 && Game._clearFormationPreview) Game._clearFormationPreview();
};

Game.handleInputEvents = () => {
    const container = document.getElementById('viewport');

    container.addEventListener('contextmenu', e => e.preventDefault());

    container.addEventListener('mousedown', e => {
        Game.mouse.screenX = e.clientX;
        Game.mouse.screenY = e.clientY;

        if (e.button === 0) {
            Game.mouse.down = true;
            Game.mouse.dragStartX = Game.mouse.dragCurrentX = e.clientX;
            Game.mouse.dragStartY = Game.mouse.dragCurrentY = e.clientY;
        } else if (e.button === 2) {
            const ground = Game.screenToGround(e.clientX, e.clientY);
            if (ground) {
                // Double right-click = RETREAT: force selected units to break off
                // and fall back here (disengage; infantry sprint, tanks reverse).
                const now = performance.now();
                const dbl = Game._lastRC && (now - Game._lastRC.t) < 400
                    && Math.abs(e.clientX - Game._lastRC.x) < 24
                    && Math.abs(e.clientY - Game._lastRC.y) < 24;
                Game._lastRC = { t: now, x: e.clientX, y: e.clientY };
                if (dbl && !Game._commandMode && !e.shiftKey) {
                    Game.orderRetreat(ground.x, ground.z);
                } else if (Game._commandMode === 'airstrike') {
                    Game.callAirStrike(ground.x, ground.z);
                    Game._commandMode = null;
                } else if (Game._commandMode === 'recon') {
                    Game.callRecon(ground.x, ground.z);
                    Game._commandMode = null;
                } else if (Game._commandMode === 'garrison') {
                    Game.selectedPlayerUnits().forEach(u => {
                        if (!Game.isTank(u.kind)) Game.enterBuilding(u, ground.x, ground.z);
                    });
                    Game._commandMode = null;
                } else if (Game._commandMode === 'tnt') {
                    const sapper = Game.selectedPlayerUnits().find(u => u.supportType === 'sapper');
                    if (sapper) Game.throwTNT(sapper, ground.x, ground.z);
                    Game._commandMode = null;
                } else if (Game._commandMode === 'grenade') {
                    const thrower = Game.nearestThrower(ground.x, ground.z);
                    if (thrower) Game.throwGrenade(thrower, ground.x, ground.z);
                    else Game.pushMessage('Select infantry to throw a grenade.', 1.5);
                    Game._commandMode = null;
                } else if (Game._commandMode === 'smoke') {
                    const thrower = Game.nearestThrower(ground.x, ground.z);
                    if (thrower) Game.throwSmoke(thrower, ground.x, ground.z);
                    else Game.pushMessage('Select infantry to throw smoke.', 1.5);
                    Game._commandMode = null;
                } else if (Game._commandMode === 'rotate') {
                    Game.orderFace(ground.x, ground.z);
                    Game._commandMode = null;
                } else if (Game._commandMode === 'attackground') {
                    Game.orderAttackGround(ground.x, ground.z);
                    Game._commandMode = null;
                } else if (Game._commandMode === 'guard') {
                    Game.AI.setGuard(ground.x, ground.z);
                    Game._commandMode = null;
                } else {
                    // Ctrl/Cmd (or Shift) + right-click = queue a movement waypoint.
                    // Units visit each queued point in order; legs are pathfound so
                    // they route around obstacles (not the old straight-line push).
                    if (e.ctrlKey || e.metaKey || e.shiftKey) {
                        Game.issueCommand(ground.x, ground.z, 'move', null, true);
                    } else {
                        // Plain right-click. Clicking an enemy ALWAYS attacks it. On open
                        // ground, obey the current order stance: 'attack' = attack-move
                        // (advance + engage), otherwise a plain Move (relocate, stowed).
                        // Pick by the actual mesh first (parallax-proof), then fall back
                        // to a world-radius search around the ground hit.
                        const picked = Game.unitAtScreen(e.clientX, e.clientY);
                        const enemyUnit = (picked && picked.team !== Game.TEAM.FRENCH)
                            ? picked
                            : Game.enemyAtWorld(ground.x, ground.z);
                        // Building under the cursor (click the house itself, not the
                        // ground behind it) or at the ground hit.
                        const onBuilding = (Game.buildingAtScreen && Game.buildingAtScreen(e.clientX, e.clientY))
                            || (Game.buildingAt && Game.buildingAt(ground.x, ground.z));
                        const haveArmed = Game.selectedPlayerUnits().some(u => {
                            const w = Game.WEAPONS[u.weaponKey];
                            return w && w.fireType !== 'none' && (w.gameRange || 0) > 0;
                        });
                        if (enemyUnit) {
                            Game.orderAttackTarget(enemyUnit);
                        } else if (onBuilding && !onBuilding.collapsed) {
                            // Right-click a building: selected infantry move in and
                            // garrison it; otherwise armed vehicles/AT shell it.
                            const inf = Game.selectedPlayerUnits().filter(u => u.alive && !Game.isTank(u.kind) && !u._garrisoned);
                            if (inf.length) Game.orderEnterBuilding(onBuilding);
                            else if (haveArmed) Game.orderAttackGround(onBuilding.cx, onBuilding.cz);
                        } else if (Game.orderStance === 'attack') {
                            Game.orderAttackMove(ground.x, ground.z);
                        } else {
                            Game.issueCommand(ground.x, ground.z, 'move');
                        }
                    }
                }
            }
        }
    });

    window.addEventListener('mousemove', e => {
        Game.mouse.screenX = e.clientX;
        Game.mouse.screenY = e.clientY;
        if (Game.mouse.down) {
            Game.mouse.dragCurrentX = e.clientX;
            Game.mouse.dragCurrentY = e.clientY;
        }
        // Update world coords
        const ground = Game.screenToGround(e.clientX, e.clientY);
        if (ground) {
            Game.mouse.worldX = ground.x;
            Game.mouse.worldZ = ground.z;

            // Formation preview markers (throttled)
            const now = performance.now();
            const overHud = e.clientY > window.innerHeight - 110;
            if (Game.selection.size > 0 && !overHud && (!Game._lastPreviewTime || now - Game._lastPreviewTime > 150)) {
                Game._lastPreviewTime = now;
                Game._showFormationPreview(ground.x, ground.z);
            } else if (Game.selection.size === 0) {
                Game._clearFormationPreview();
            }
        } else {
            Game._clearFormationPreview();
        }
    });

    window.addEventListener('mouseup', e => {
        if (e.button === 0 && Game.mouse.down) {
            Game.mouse.down = false;
            Game.handleMouseSelection();
        }
    });

    // Mouse wheel does NOT zoom — use the +/- keys. Swallow the event so the
    // page/trackpad never scrolls the canvas. While an air strike is armed, the
    // wheel sets how many planes to commit.
    container.addEventListener('wheel', e => {
        e.preventDefault();
        if (Game._commandMode === 'airstrike') {
            Game.adjustAirStrikePlanes(e.deltaY < 0 ? 1 : -1);
            Game.pushMessage(`Air strike: ${Game.airStrikePlanesToUse} of ${Game.airStrikesAvailable} plane(s) — right-click target.`, 2.0);
        }
    }, { passive: false });

    window.addEventListener('keydown', e => {
        Game.keys[e.code] = true;
        if (e.repeat) return;

        // Alt — toggle all health bars
        if (e.code === 'AltLeft' || e.code === 'AltRight') {
            Game._showAllHealthBars = !Game._showAllHealthBars;
            e.preventDefault();
        }

        // Space — tactical pause: time stops, orders can still be issued
        if (e.code === 'Space') {
            e.preventDefault();
            const menuOpen = !document.getElementById('mainMenu')?.classList.contains('hidden');
            if (!menuOpen) {
                Game._paused = !Game._paused;
                Game.pushMessage(Game._paused
                    ? 'PAUSED — issue orders, Space to resume.'
                    : 'Resumed.', 2.0);
            }
        }

        // L — jump to last attack
        if (e.code === 'KeyL') {
            if (Game.lastAttackPos) {
                Game.cam.x = Game.lastAttackPos.x;
                Game.cam.z = Game.lastAttackPos.z;
            } else {
                Game.centerOnAction();
            }
        }

        // Unit groups: Ctrl+0-9 to assign, 0-9 to recall
        const numMatch = e.code.match(/^Digit(\d)$/);
        if (numMatch) {
            const n = parseInt(numMatch[1]);
            if (e.ctrlKey || e.metaKey) {
                // Assign group
                Game.groups = Game.groups || {};
                Game.groups[n] = [...Game.selection];
                Game.pushMessage(`Group ${n} assigned (${Game.selection.size} units).`, 1.5);
                e.preventDefault();
            } else {
                // Recall group
                Game.groups = Game.groups || {};
                const groupIds = Game.groups[n];
                if (groupIds && groupIds.length) {
                    const now = performance.now();
                    // Double-tap detection
                    if (Game._lastGroupKey === n && now - Game._lastGroupTime < 400) {
                        // Center camera on group
                        let gx = 0, gz = 0, count = 0;
                        Game.units.forEach(u => {
                            if (u.alive && groupIds.includes(u.id)) { gx += u.x; gz += u.z; count++; }
                        });
                        if (count) { Game.cam.x = gx / count; Game.cam.z = gz / count; }
                    }
                    Game._lastGroupKey = n;
                    Game._lastGroupTime = now;
                    // Select group
                    Game.selection.clear();
                    groupIds.forEach(id => {
                        if (Game.units.find(u => u.alive && u.id === id)) Game.selection.add(id);
                    });
                }
            }
        }

        // Camera save/recall (F5-F8)
        const fMatch = e.code.match(/^F([5-8])$/);
        if (fMatch) {
            const slot = parseInt(fMatch[1]);
            Game._camSlots = Game._camSlots || {};
            if (e.ctrlKey || e.metaKey) {
                Game._camSlots[slot] = { x: Game.cam.x, z: Game.cam.z, zoom: Game.cam.zoom };
                Game.pushMessage(`Camera position saved to F${slot}.`, 1.5);
                e.preventDefault();
            } else {
                const saved = Game._camSlots[slot];
                if (saved) {
                    Game.cam.x = saved.x;
                    Game.cam.z = saved.z;
                    Game.cam.targetZoom = saved.zoom;
                }
            }
        }

        // Behavior cycle (/ key)
        if (e.code === 'Slash') {
            const modes = ['defensive', 'aggressive', 'cautious'];
            Game.selectedPlayerUnits().forEach(u => {
                const idx = modes.indexOf(u.behavior || 'defensive');
                u.behavior = modes[(idx + 1) % modes.length];
            });
            const first = Game.selectedPlayerUnits()[0];
            if (first) Game.pushMessage(`Behavior: ${first.behavior}`, 1.5);
        }

        // Air strike (B key) — enter targeting mode
        if (e.code === 'KeyB') {
            if (Game.airStrikesAvailable > 0) {
                Game._commandMode = 'airstrike';
                Game.adjustAirStrikePlanes(0); // clamp selector to current stock
                Game.pushMessage(`Air strike: ${Game.airStrikePlanesToUse} of ${Game.airStrikesAvailable} plane(s). Wheel to adjust, right-click target.`, 3.5);
            } else {
                Game.pushMessage('No air strikes available!', 2.0);
            }
        }

        // Toggle Move / Attack-move stance (E key)
        if (e.code === 'KeyE') {
            Game.setOrderStance(Game.orderStance === 'attack' ? 'move' : 'attack');
        }

        // Attack ground — fire on a spot (F key)
        if (e.code === 'KeyF') {
            Game._commandMode = 'attackground';
            Game.pushMessage('Attack ground — right-click a spot to suppress.', 2.0);
        }

        // Rotate (R key)
        if (e.code === 'KeyR') {
            Game._commandMode = 'rotate';
            Game.pushMessage('Rotate — right-click direction.', 2.0);
        }

        // Cycle formation (Z key)
        if (e.code === 'KeyZ') {
            const idx = Game.FORMATIONS.indexOf(Game.currentFormation);
            Game.currentFormation = Game.FORMATIONS[(idx + 1) % Game.FORMATIONS.length];
            Game.pushMessage(`Formation: ${Game.currentFormation.toUpperCase()}`, 1.5);
            // Update HUD selector
            document.querySelectorAll('.fm-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.formation === Game.currentFormation);
            });
        }

        // Grenade (G key)
        if (e.code === 'KeyG') {
            Game._commandMode = 'grenade';
            Game.pushMessage('Grenade — right-click target.', 2.0);
        }

        // Smoke grenade (T key)
        if (e.code === 'KeyT') {
            Game._commandMode = 'smoke';
            Game.pushMessage('Smoke — right-click target.', 2.0);
        }

        // Posture cycle (X key): Attention -> At Ease -> Stand down (auto)
        if (e.code === 'KeyX') {
            Game.cyclePosture();
        }

        // Guard an area (C key) — enter placement mode, right-click sets the centre
        if (e.code === 'KeyC') {
            Game.AI.beginGuard();
        }

        // Stop / cancel orders (V key)
        if (e.code === 'KeyV') {
            Game.selectedPlayerUnits().forEach(u => {
                u.path = [];
                u.moving = false;
                u.orderMode = 'hold';
                u.forcedTargetId = null;
                u.bombardX = null; u.bombardZ = null;
                u._bombarding = false;
                u._assaultGoal = null;
                if (Game.AI && Game.AI.clearPosture) Game.AI.clearPosture(u);
            });
            Game.pushMessage('Units stopped.', 1.0);
        }

        // Hold fire toggle (H key)
        if (e.code === 'KeyH') {
            Game.toggleHoldFire();
        }

        // Pause / unpause (P key)
        if (e.code === 'KeyP') {
            Game._paused = !Game._paused;
            Game.pushMessage(Game._paused ? 'PAUSED — commands can still be issued' : 'UNPAUSED', 2.0);
        }

        // Run toggle (S key) — infantry switches between run and walk
        if (e.code === 'KeyS') {
            const inf = Game.selectedPlayerUnits().filter(u => !Game.isTank(u.kind));
            if (inf.length) {
                const toRun = inf.some(u => u.stance !== 'run');
                inf.forEach(u => { u.stance = toRun ? 'run' : 'stand'; u._autoStance = false; });
                Game.pushMessage(toRun ? 'Running!' : 'Walking.', 1.0);
            }
        }

        // First aid (F key) — one-time self-heal for infantry
        if (e.code === 'KeyF') {
            Game.selectedPlayerUnits().forEach(u => {
                if (!Game.isTank(u.kind) && u.hp < u.maxHp) {
                    u._firstAidKits = u._firstAidKits ?? 1;
                    if (u._firstAidKits > 0) {
                        u._firstAidKits--;
                        u.hp = Math.min(u.maxHp, u.hp + 40);
                        Game.pushMessage(`${u.label} used first aid kit.`, 1.5);
                    } else {
                        Game.pushMessage('No first aid kits left!', 1.5);
                    }
                }
            });
        }
        // Mine laying (M key) — sappers only
        if (e.code === 'KeyM') {
            const sapper = Game.selectedPlayerUnits().find(u => u.supportType === 'sapper');
            if (sapper) Game.layMine(sapper);
            else Game.pushMessage('Select a sapper to lay mines.', 1.5);
        }

        // Entrench toggle (N key)
        if (e.code === 'KeyN') {
            Game.selectedPlayerUnits().forEach(u => Game.entrenchUnit(u));
        }

        // Build sandbags (U key) — sappers only
        if (e.code === 'KeyU') {
            const sapper = Game.selectedPlayerUnits().find(u => u.supportType === 'sapper');
            if (sapper) Game.buildSandbag(sapper);
            else Game.pushMessage('Select a sapper to build sandbags.', 1.5);
        }

        // Tow / untow a gun (O key) — select a vehicle/truck
        if (e.code === 'KeyO') {
            const tower = Game.selectedPlayerUnits().find(u => Game.canTow(u));
            if (!tower) { Game.pushMessage('Select a vehicle or truck to tow with.', 1.5); }
            else {
                const towing = Game.units.find(u => u._towed && u._towedBy === tower.id);
                if (towing) { Game.untowUnit(towing); }
                else {
                    let best = null, bd = 8 * 8;
                    Game.units.forEach(u => {
                        if (!u.alive || u.team !== tower.team || !u.deployable || u._towed) return;
                        const d = Game.distSq(tower.x, tower.z, u.x, u.z);
                        if (d < bd) { bd = d; best = u; }
                    });
                    if (best) Game.towUnit(tower, best);
                    else Game.pushMessage('No gun within reach to tow.', 1.5);
                }
            }
        }

        // Load / unload troops (L key) — select a truck (+ infantry to load)
        if (e.code === 'KeyL') {
            const sel = Game.selectedPlayerUnits();
            const carrier = sel.find(u => Game.isCarrier(u));
            if (!carrier) { Game.pushMessage('Select a truck to carry troops.', 1.5); }
            else if (carrier._passengers && carrier._passengers.length) {
                Game.unloadCarrier(carrier);
            } else {
                let pool = sel.filter(u => u.class === 'infantry'
                    && Game.distSq(u.x, u.z, carrier.x, carrier.z) < 12 * 12);
                if (!pool.length) {
                    pool = Game.units.filter(u => u.alive && u.team === carrier.team
                        && u.class === 'infantry' && Game.distSq(u.x, u.z, carrier.x, carrier.z) < 10 * 10);
                }
                let n = 0;
                pool.forEach(u => { if (Game.loadUnit(u, carrier)) n++; });
                Game.pushMessage(n ? `${carrier.label} loaded ${n} troops.` : 'No infantry nearby to load.', 1.6);
            }
        }

        // Recon plane (J key)
        if (e.code === 'KeyJ') {
            Game._commandMode = 'recon';
            Game.pushMessage('Recon — right-click target area.', 2.0);
        }

        // Exit vehicle (X key)
        if (e.code === 'KeyX') {
            Game.selectedPlayerUnits().forEach(u => {
                if (Game.isTank(u.kind)) Game.exitVehicle(u);
            });
        }

        // Building garrison (Q key)
        if (e.code === 'KeyQ') {
            const garrisoned = Game.selectedPlayerUnits().filter(u => u._garrisoned);
            if (garrisoned.length > 0) {
                garrisoned.forEach(u => Game.exitBuilding(u));
            } else {
                Game._commandMode = 'garrison';
                Game.pushMessage('Garrison — right-click a building.', 2.0);
            }
        }

        // C key: cycle movement mode (run / walk / crouch / crawl)
        if (e.code === 'KeyC') {
            Game.setStanceForSelection();
        }

        // K key: TNT / demolitions — sappers only
        if (e.code === 'KeyK') {
            const sapper = Game.selectedPlayerUnits().find(u => u.supportType === 'sapper');
            if (sapper) {
                Game._commandMode = 'tnt';
                Game.pushMessage('TNT — right-click target.', 2.0);
            } else {
                Game.pushMessage('Select a sapper to use TNT.', 1.5);
            }
        }

        // Binoculars (Y key)
        if (e.code === 'KeyY') {
            Game.selectedPlayerUnits().forEach(u => {
                if (!Game.isTank(u.kind)) Game.useBinoculars(u);
            });
        }

        // Escape — cancel command mode or show menu
        if (e.code === 'Escape') {
            if (Game._commandMode) {
                Game._commandMode = null;
            } else {
                // Show main menu
                const menu = document.getElementById('mainMenu');
                if (menu) { menu.classList.remove('hidden'); Game._paused = true; }
            }
        }
    });

    window.addEventListener('keyup', e => { Game.keys[e.code] = false; });
};

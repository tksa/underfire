/**
 * Under Fire — ai_tactics.js
 * Higher-level tactical AI layer (the "thinking" layer) that sits on top of the
 * existing per-unit FSM (ai.js) and the movement modules (unit_modules.js).
 *
 * Built as a lightweight, deterministic HYBRID — perception -> intent -> arbiter
 * -> combined movement — entirely in plain JS. No build step, no server, no ML.
 * This is the heuristic foundation a learned model would only later refine; the
 * heuristics are what make units behave sensibly today.
 *
 * Implemented so far:
 *   - Game.AI namespace, tunables, and the intent / movement-mode label sets that
 *     the later phases (formation movement, intent arbiter) build on.
 *   - Game.uMod.ambient — idle / rest postures. A soldier who is safe and has
 *     nothing to do winds down through  ready -> at ease -> rest  instead of
 *     standing on the spot forever, and snaps back to a battle-ready footing the
 *     instant a threat or an order appears (rousing from rest costs him a beat).
 *
 * Loads AFTER unit_modules.js (it attaches to the existing Game.uMod) and before
 * main.js boots the loop. updateUnit calls Game.uMod.ambient defensively.
 */

Game.AI = Game.AI || {};

// Label sets — used by the intent arbiter / formation phases (later). Kept here
// so the whole vocabulary lives in one place. Doctrine is intentionally absent.
Game.AI.INTENTS = [
    'HOLD', 'ADVANCE', 'SEEK_COVER', 'SUPPRESS', 'RETREAT', 'RALLY',
    'SUPPORT_TANK', 'SCREEN_TANK', 'FLANK_LOCAL', 'REGROUP', 'DEFEND',
];
Game.AI.MOVEMENT_MODES = [
    'ROAD_COLUMN', 'LOOSE_ADVANCE', 'TANK_LED_ADVANCE', 'INFANTRY_LED',
    'CONTACT_SPREAD', 'DEFENSIVE_HOLD', 'WITHDRAWAL', 'REGROUP',
];

// ── Ambient / idle posture tuning (seconds) ────────────────────────────────
Game.AI.ambientCfg = {
    readyHold: 22,    // how long a unit stays standing-ready before it relaxes
    restAfter: 48,    // calm time before a soldier sits down to rest
    wakeDelay: 0.7,   // movement lag when roused out of rest (getting up)
    threatMemory: 6,  // a remembered threat newer than this keeps him alert
    lookMin: 3.0,     // idle "look around" interval bounds (at ease)
    lookMax: 7.0,
    restSuppRecover: 4.0,  // extra suppression shed per second while resting
    // Social idle: at ease, troops glance about and turn to face a nearby comrade
    // as if chatting, holding that for a few seconds before looking elsewhere.
    chatChance: 0.55, // odds an idle glance is "face a comrade" vs a random look
    chatRadius: 5.5,  // how close a comrade must be to turn and face him
    chatMin: 4.0,     // how long the "chat" facing is held
    chatMax: 9.0,
    // Guard: patrol an assigned circle, pausing to watch between moves.
    guardDwellMin: 2.5,
    guardDwellMax: 6.0,
    guardRadius: 7.0, // default patrol radius (tiles) when none is dragged out
};

/**
 * Ambient idle behaviour. Runs every frame for foot troops; the bulk of the work
 * happens only once a soldier is genuinely idle and safe. Manages ONLY the
 * relaxed stances {stand, ease, rest}; the suppression system in uMod.morale
 * still owns crouch/prone, so the two never fight.
 *
 *   alert  -> stand, weapon ready (rouse from rest costs a beat)
 *   ready  -> stand at the ready, face the last known threat
 *   ease   -> relaxed stand, rifle lowered, idle glances around
 *   rest   -> sit down, recover composure faster, slow to react
 */
Game.uMod.ambient = (unit, ctx) => {
    if (!unit.alive || unit.class !== 'infantry') return;
    if (unit._garrisoned || unit._enterRec || unit._inVehicle != null || unit._towed) return;

    const cfg = Game.AI.ambientCfg;
    const now = Game.gameClock || 0;
    const dt = ctx.dt;

    // Anything that should keep — or snap — the soldier to a ready footing. A
    // self-initiated idle stroll (_idleMoving) does NOT count as "busy" — only a
    // real order or combat does.
    const freshThreat = (now - (unit._threatTime || -1e9)) < cfg.threatMemory;
    const combatBusy = unit.orderMode === 'assault' || unit.retreating
        || unit.fireTargetId != null || unit._reverseMove;
    const orderedMove = ((unit.path && unit.path.length) || unit.moving) && !unit._idleMoving;
    const alert = !!ctx.enemy || freshThreat || combatBusy || orderedMove
        || (unit.suppressionValue || 0) > 12 || (unit.underFire || 0) > 0;

    // Only manage posture when the unit is upright/relaxed. A deliberate (or
    // suppression-driven) crouch/prone is left exactly as it is.
    const relaxed = (unit.stance === 'stand' || unit.stance === 'ease'
        || unit.stance === 'rest' || unit.stance == null);

    if (alert) {
        if (unit.stance === 'rest') {
            // Was sitting — needs a moment to get up and ready his weapon.
            unit.orderDelay = Math.max(unit.orderDelay || 0, cfg.wakeDelay);
            unit._readyTimer = 0;
            unit._combatReady = false;
        }
        if (unit.stance === 'rest' || unit.stance === 'ease') {
            unit.stance = 'stand';   // let morale/suppression take it from here
        }
        unit._idleMoving = false;    // abandon any casual stroll
        unit._idleAct = null;
        unit._restState = 'ready';
        unit._calmSince = null;
        unit._idleLookT = 0;
        return;
    }

    // Guard duty: patrol the assigned area instead of resting. Combat (handled by
    // the alert branch above) takes priority and pauses the patrol.
    if (unit._postureOrder === 'guard' && unit._guardArea) {
        unit._restState = 'guard';
        if (relaxed && unit.stance !== 'stand') unit.stance = 'stand';
        Game.AI._guardPatrol(unit, ctx);
        return;
    }

    // Calm — run the wind-down clock.
    if (unit._calmSince == null) unit._calmSince = now;
    const calm = now - unit._calmSince;

    // Player posture orders override the automatic wind-down:
    //   attention -> stand rigidly ready;  ease -> relax to "at ease" now.
    let state;
    if (unit._postureOrder === 'attention') state = 'attention';
    else if (unit._postureOrder === 'ease') state = 'ease';
    else if (calm < cfg.readyHold) state = 'ready';
    else state = 'idle';   // varied idle life (stand / sit / wander), picked per unit
    unit._restState = state;

    if (state === 'attention') {
        // Formed up, still, eyes front — no idle fidgeting.
        if (relaxed && unit.stance !== 'stand') unit.stance = 'stand';
    } else if (state === 'ready') {
        if (relaxed && unit.stance !== 'stand') unit.stance = 'stand';
        // Just out of action: keep eyes on the last place the enemy was.
        if (unit._lastThreat) {
            const a = Game.angleTo(unit.x, unit.z, unit._lastThreat.x, unit._lastThreat.z);
            unit.angle = Game.rotateTo(unit.angle, a, 2.2 * dt);
            unit.turretAngle = unit.angle;
        }
    } else if (state === 'ease') {
        // Deliberate "at ease" order: relaxed standing + chatter, no sitting.
        if (relaxed && unit.stance !== 'ease') unit.stance = 'ease';
        Game.AI._idleLook(unit, dt);   // glance about / turn to a comrade
    } else { // auto deep-calm: varied idle life (some sit, some stand, some wander)
        Game.AI._idleActivity(unit, ctx);
    }
};

// Social idle: at ease, a soldier shifts his gaze every few seconds and often
// turns to face a nearby comrade — read as the two of them chatting — before
// looking elsewhere. Beats staring rigidly in one direction forever.
Game.AI._idleLook = (unit, dt) => {
    const cfg = Game.AI.ambientCfg;
    unit._idleLookT = (unit._idleLookT || 0) - dt;
    if (unit._idleLookT <= 0) {
        let ang = unit.angle + Game.rand(-1.1, 1.1);    // default: a lazy glance
        let hold = Game.rand(cfg.lookMin, cfg.lookMax);
        if (Game.rand(0, 1) < cfg.chatChance) {
            const mate = Game.AI._nearestComrade(unit, cfg.chatRadius);
            if (mate) {
                ang = Game.angleTo(unit.x, unit.z, mate.x, mate.z);  // turn to him
                hold = Game.rand(cfg.chatMin, cfg.chatMax);
            }
        }
        unit._idleLookAng = ang;
        unit._idleLookT = hold;
    }
    if (unit._idleLookAng != null) {
        unit.angle = Game.rotateTo(unit.angle, unit._idleLookAng, 1.0 * dt);
        unit.turretAngle = unit.angle;
    }
};

// Nearest idle friendly foot soldier within radius (a comrade to face / chat to).
Game.AI._nearestComrade = (unit, radius) => {
    let best = null, bd = radius * radius;
    for (const a of Game.units) {
        if (!a.alive || a === unit) continue;
        if (a.team !== unit.team || a.class !== 'infantry') continue;
        if (a.moving || (a.path && a.path.length)) continue;   // not one hurrying off
        const d = Game.distSq(unit.x, unit.z, a.x, a.z);
        if (d > 0.5 && d < bd) { bd = d; best = a; }
    }
    return best;
};

// Guard patrol: when paused, scan around (social idle); when the dwell timer
// expires, stroll to a fresh random point inside the guard circle. Never pursues
// out of the area — the scan/fire modules engage intruders from where it stands.
Game.AI._guardPatrol = (unit, ctx) => {
    const cfg = Game.AI.ambientCfg;
    const area = unit._guardArea;
    const idle = (!unit.path || !unit.path.length) && !unit.moving;
    if (!idle) return;                       // still walking to the last point
    unit._guardDwell = (unit._guardDwell || 0) - ctx.dt;
    if (unit._guardDwell > 0) { Game.AI._idleLook(unit, ctx.dt); return; }
    // Pick a new point inside the circle (uniform over area) and stroll to it.
    const a = Game.rand(0, Math.PI * 2);
    const rr = Math.sqrt(Game.rand(0, 1)) * (area.r || cfg.guardRadius);
    const gx = Game.clamp(area.x + Math.cos(a) * rr, 1, Game.WORLD_W - 1);
    const gz = Game.clamp(area.z + Math.sin(a) * rr, 1, Game.WORLD_H - 1);
    unit.path = Game.findPath(unit, unit.x, unit.z, gx, gz);
    unit.moving = true;
    unit.orderMode = 'hold';                 // defend the post, don't chase
    unit._guardDwell = Game.rand(cfg.guardDwellMin, cfg.guardDwellMax);
};

// ── Player posture / guard orders ──────────────────────────────────────────

Game.AI.POSTURE_CYCLE = [null, 'attention', 'ease'];

// Apply a fixed posture to the selected foot troops and light the matching HUD
// button. mode: null (auto wind-down) | 'attention' | 'ease'.
Game.AI.applyPosture = (mode) => {
    const sel = Game.selectedPlayerUnits().filter(u => u.class === 'infantry');
    if (!sel.length) { Game.pushMessage('Select troops to set their posture.', 1.5); return; }
    sel.forEach(u => {
        u._postureOrder = mode;
        u._guardArea = null;              // a posture order ends guard duty
        u._idleMoving = false;
        u._calmSince = null;              // re-evaluate from now
    });
    Game.AI._reflectPostureUI(mode);
    const label = mode === 'attention' ? 'Attention' : (mode === 'ease' ? 'At ease' : 'Stand down (auto)');
    Game.pushMessage('Posture: ' + label, 1.6);
};

// Cycle the selected troops' posture (X key): Auto -> Attention -> At Ease -> Auto.
Game.cyclePosture = () => {
    const sel = Game.selectedPlayerUnits().filter(u => u.class === 'infantry');
    if (!sel.length) { Game.pushMessage('Select troops to set their posture.', 1.5); return; }
    const cur = (sel[0]._postureOrder === 'attention' || sel[0]._postureOrder === 'ease') ? sel[0]._postureOrder : null;
    const next = Game.AI.POSTURE_CYCLE[(Game.AI.POSTURE_CYCLE.indexOf(cur) + 1) % Game.AI.POSTURE_CYCLE.length];
    Game.AI.applyPosture(next);
};

// Enter "place a guard area" mode — the next right-click sets the patrol centre.
Game.AI.beginGuard = () => {
    const sel = Game.selectedPlayerUnits().filter(u => u.class === 'infantry' || u.supportType);
    if (!sel.length) { Game.pushMessage('Select troops to set a guard.', 1.5); return; }
    Game._commandMode = 'guard';
    Game.pushMessage('Guard — right-click the area to patrol.', 2.5);
};

// Light the posture HUD button matching the given mode (null -> the "auto" button).
Game.AI._reflectPostureUI = (mode) => {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.pos-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.posture === (mode || 'auto')));
};

// Put the selected troops on guard over a circular area (centre x,z, radius r).
Game.AI.setGuard = (x, z, r) => {
    const sel = Game.selectedPlayerUnits().filter(u => u.class === 'infantry' || u.supportType);
    if (!sel.length) { Game.pushMessage('Select troops to set a guard.', 1.5); return; }
    const rad = r || Game.AI.ambientCfg.guardRadius;
    sel.forEach(u => {
        u._postureOrder = 'guard';
        u._guardArea = { x, z, r: rad };
        u._guardDwell = 0;                // start patrolling immediately
        u.orderMode = 'hold';
        u.forcedTargetId = null;
    });
    if (Game.spawnOrderMarker) Game.spawnOrderMarker(x, z, 0x39ff5e);
    Game.pushMessage(`Guard set (${sel.length} on patrol).`, 1.8);
    Game.AI._reflectPostureUI('guard');
};

// Cancel any posture / guard order (called when a normal move/attack is issued).
Game.AI.clearPosture = (unit) => {
    if (!unit) return;
    unit._postureOrder = null;
    unit._guardArea = null;
    unit._idleMoving = false;     // so a real order isn't mistaken for an idle stroll
    unit._idleAct = null;
    unit._groupMoveActive = false; // drop any group pace cap (a fresh order re-sets it)
};

// ── Varied idle life (deep calm) ───────────────────────────────────────────
// Each soldier has a temperament (_idleBias: sitter <-> stander) and re-chooses
// what to do every so often, so a resting group looks alive — some seated (in
// varied positions), some on their feet, the odd man wandering to a mate first.
// Weighted seating poses (plain sit most common). 'kneel' = one-knee crouch,
// 'recline' = sit leaning back on hands, 'sidelay' = lying on one side.
Game.AI.SIT_VARIANTS = ['sit', 'sit', 'kneel', 'recline', 'sidelay'];

Game.AI._idleActivity = (unit, ctx) => {
    const cfg = Game.AI.ambientCfg;
    const now = Game.gameClock || 0;
    const dt = ctx.dt;
    const canSet = (unit.stance === 'stand' || unit.stance === 'ease'
        || unit.stance === 'rest' || unit.stance == null);

    // Reached the comrade he strolled to? settle into the planned activity.
    if (unit._idleMoving) {
        if ((!unit.path || !unit.path.length) && !unit.moving) {
            unit._idleMoving = false;
            unit._idleAct = unit._idleNextAct || 'sit';
            unit._idleActT = now + Game.rand(10, 24);
            if (unit._idleAct === 'sit') Game.AI._chooseSit(unit);
        }
        return;                                 // keep walking until he arrives
    }

    if (unit._idleAct == null || now >= (unit._idleActT || 0)) {
        Game.AI._pickIdleActivity(unit);
        if (unit._idleMoving) return;           // a stroll just started this frame
    }

    if (unit._idleAct === 'sit') {
        if (canSet && unit.stance !== 'rest') unit.stance = 'rest';
        Game.AI._idleLook(unit, dt);            // turn to chat with a neighbour
        if (unit.suppressionValue) unit.suppressionValue = Math.max(0, unit.suppressionValue - cfg.restSuppRecover * dt);
        if (unit.shaken) unit.shaken = Math.max(0, unit.shaken - dt);
        unit._restState = 'rest';
    } else {                                    // 'stand'
        if (canSet && unit.stance !== 'ease') unit.stance = 'ease';
        Game.AI._idleLook(unit, dt);
        unit._restState = 'ease';
    }
};

Game.AI._chooseSit = (unit) => {
    const v = Game.AI.SIT_VARIANTS;
    unit._sitVariant = v[Math.floor(Game.rand(0, v.length))];
};

Game.AI._pickIdleActivity = (unit) => {
    const now = Game.gameClock || 0;
    if (unit._idleBias == null) unit._idleBias = Game.rand(0.2, 0.85);   // sitter <-> stander
    const r = Game.rand(0, 1);

    // Now and then (player troops), get up and wander over to a comrade, then settle.
    if (r < 0.16 && unit.aiState === 'player') {
        const mate = Game.AI._nearestComrade(unit, 16);
        if (mate) {
            const a = Game.angleTo(mate.x, mate.z, unit.x, unit.z);
            const off = Game.rand(1.6, 2.6);
            const gx = Game.clamp(mate.x + Math.cos(a) * off, 1, Game.WORLD_W - 1);
            const gz = Game.clamp(mate.z + Math.sin(a) * off, 1, Game.WORLD_H - 1);
            const path = Game.findPath(unit, unit.x, unit.z, gx, gz);
            if (path && path.length) {
                unit.path = path; unit.moving = true; unit._idleMoving = true;
                unit.orderMode = 'hold';
                if (unit.stance === 'rest') unit.stance = 'stand';      // get up to walk
                unit._idleNextAct = (Game.rand(0, 1) < unit._idleBias) ? 'sit' : 'stand';
                return;
            }
        }
    }
    // Otherwise sit or stay standing, biased by temperament, for a spell.
    if (Game.rand(0, 1) < unit._idleBias) { unit._idleAct = 'sit'; Game.AI._chooseSit(unit); }
    else unit._idleAct = 'stand';
    unit._idleActT = now + Game.rand(10, 24);
};

/**
 * Under Fire — ai.js
 * Enemy combat AI: a per-unit finite state machine layered with squad-level
 * coordination (fire-and-maneuver / bounding overwatch). Built on the existing
 * suppression, tile-cover and squad-group systems.
 *
 * Per-unit states: hold · engage · advance · seekcover · pinned · retreat
 * Squad postures:  hold · attack · fallback   (set by updateSquadAI)
 * Squad roles:     fire (base of fire / overwatch) · maneuver (bounds forward)
 */

// Cover value at an arbitrary world position (generalises computeCover).
Game.coverAt = (x, z) => {
    const t = Game.getTileAtWorld(x, z);
    if (!t) return 0;
    let cover = t.cover || 0;
    const tp = Game.tileAtWorld(x, z);
    const around = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];
    for (const [dx, dy] of around) {
        const n = Game.getTile(tp.tx + dx, tp.ty + dy);
        if (!n) continue;
        if (n.type === 'wall') cover = Math.max(cover, 0.58);
        else if (n.type === 'house') cover = Math.max(cover, 0.65);
        else if (n.type === 'hedge') cover = Math.max(cover, 0.42);
    }
    if (Game.defenses) {
        for (const d of Game.defenses) {
            if (Game.distSq(d.x, d.z, x, z) <= 2.4 * 2.4) { cover = Math.max(cover, d.cover); break; }
        }
    }
    return Game.clamp(cover, 0, 0.82);
};

/**
 * Find a nearby covered position relative to a threat. Scores candidates by
 * cover value, whether the threat's line of sight is blocked, distance, and a
 * penalty for moving toward the threat. Returns {x,z} or null.
 */
Game.findCoverPosition = (unit, threatX, threatZ) => {
    const T = Game.TILE;
    const toThreat = Game.angleTo(unit.x, unit.z, threatX, threatZ);
    let best = null, bestScore = 25; // require a meaningfully covered spot
    for (let r = 1; r <= 6; r++) {
        for (let k = 0; k < 10; k++) {
            const a = (k / 10) * Math.PI * 2;
            const cx = Game.clamp(unit.x + Math.cos(a) * r * T * 0.8, 1, Game.WORLD_W - 1);
            const cz = Game.clamp(unit.z + Math.sin(a) * r * T * 0.8, 1, Game.WORLD_H - 1);
            const tile = Game.getTileAtWorld(cx, cz);
            if (!tile || tile.blocked || (Game.isTank(unit.kind) && tile.vehicleBlocked)) continue;
            const cover = Game.coverAt(cx, cz);
            // Only spots that will COUNT as in-cover once reached (the AI's
            // inCover test is >0.32). Accepting 0.2-0.32 refuges sent men on a
            // dash that left them still "exposed" on arrival, so they re-sought
            // cover forever — the seekcover/alert twitch loop.
            if (cover < 0.34) continue;
            const losBlocked = Game.lineOfSight({ x: threatX, z: threatZ }, { x: cx, z: cz }) === false;
            const dist = Game.dist(unit.x, unit.z, cx, cz);
            const towardThreat = Math.cos(a - toThreat); // +1 if heading at the threat
            const score = cover * 100 + (losBlocked ? 70 : 0) - dist * 2 - towardThreat * 30;
            if (score > bestScore) { bestScore = score; best = { x: cx, z: cz }; }
        }
    }
    return best;
};

/**
 * Pick a FIRING POSITION for a direct-fire vehicle against a target: a spot at
 * comfortable stand-off range with line of sight, on the shooter's own side of
 * the target, spaced off other friendly armor, with a nod to covering terrain.
 * The core armor rule: a tank moves toward a firing position, never toward the
 * enemy itself. Returns {x, z} or null (caller falls back to a plain approach).
 * opts.standoff: preferred fraction of weapon range (default 0.72).
 */
Game.findFiringPosition = (unit, target, opts = {}) => {
    // The stand-off ring is bounded by what the unit can actually SEE (firing
    // is sight-gated), and — crucially — by its CURRENT distance to the
    // target: taking a firing position means closing or flanking, never
    // backing away (tank guns have gameRange in the hundreds, and 72% of that
    // once sent an ordered tank driving to the map edge "to reposition").
    const sight = unit.sight || 20;
    const effRange = Math.min(unit.range || 30, sight * 0.95);
    const dCur = Game.dist(unit.x, unit.z, target.x, target.z);
    const standoff = Game.clamp(opts.standoff ?? 0.72, 0.3, 0.95);
    const ringBase = Math.min(effRange * standoff, Math.max(dCur * 0.95, 10));
    const bearing = Game.angleTo(target.x, target.z, unit.x, unit.z);   // target -> shooter side
    let best = null, bestScore = -Infinity;
    for (const rf of [1.0, 0.8, 1.15]) {
        const r = Math.min(ringBase * rf, Math.max(dCur * 0.95, 10));
        for (let k = -4; k <= 4; k++) {
            const a = bearing + k * 0.26;                    // fan ±60° on our own side
            const cx = target.x + Math.cos(a) * r;
            const cz = target.z + Math.sin(a) * r;
            // A spot the map can't contain is no firing position (clamping
            // these to the border was how tanks ended up parked on the edge).
            if (cx < 3 || cx > Game.WORLD_W - 3 || cz < 3 || cz > Game.WORLD_H - 3) continue;
            const tile = Game.getTileAtWorld(cx, cz);
            if (!tile || tile.blocked || tile.vehicleBlocked) continue;
            if (Game.lineOfSight({ x: cx, z: cz }, target) === false) continue;  // must see to shoot
            let score = 40;
            score -= Math.abs(rf - 1.0) * 20;                // hold the stand-off band
            score -= Game.dist(unit.x, unit.z, cx, cz) * 1.2; // shortest reposition wins
            score -= Math.abs(k) * 2.2;                      // don't cross the target's front
            score += (tile.cover || 0) * 25;                 // field edges/hedges: hull-down-ish
            for (const f of Game.units) {                    // don't stack armor on one spot
                if (!f.alive || f.id === unit.id || f.team !== unit.team || !Game.isTank(f.kind)) continue;
                if (Game.distSq(f.x, f.z, cx, cz) < 25) { score -= 18; break; }
            }
            if (score > bestScore) { bestScore = score; best = { x: cx, z: cz }; }
        }
    }
    return best;
};

// Nearest living friendly tank within radius — used by infantry to shelter in
// the lee of armor (mobile cover).
Game.nearestFriendlyTank = (unit, radius = 20) => {
    let best = null, bd = radius * radius;
    for (const a of Game.units) {
        // a.id check: a tank calling this must never pick ITSELF (it would
        // "shelter" in its own lee and chase that moving point in circles).
        if (!a.alive || a.id === unit.id || a.team !== unit.team || !Game.isTank(a.kind)) continue;
        const d = Game.distSq(unit.x, unit.z, a.x, a.z);
        if (d < bd) { bd = d; best = a; }
    }
    return best;
};

/**
 * Spread a threat to a unit's squad-mates and nearby allies so the whole
 * group reacts when one of them is fired on, instead of standing idle while a
 * buddy gets hit and runs. AI-controlled units only (never hijacks the
 * player's own squads). Called from applyShot (throttled) and squad AI.
 */
Game.alertAllies = (unit, threatX, threatZ, radius = 16) => {
    const now = Game.gameClock;
    const grp = unit.group || null;
    for (const ally of Game.units) {
        if (!ally.alive || ally === unit) continue;
        if (ally.team !== unit.team) continue;
        if (ally.aiState === 'player') continue;          // don't override player orders
        const sameSquad = grp && ally.group === grp;
        if (!sameSquad && Game.dist(unit.x, unit.z, ally.x, ally.z) > radius) continue;
        // Keep a fresher first-hand threat (they're already reacting to it)
        if (ally._threatTime && now - ally._threatTime < 1.2 && (ally.underFire || 0) > 0.4) continue;
        ally._lastThreat = { x: threatX, z: threatZ };
        ally._threatTime = now;
        ally.underFire = Math.max(ally.underFire || 0, 0.6);
        // a little shock so they take cover rather than just stand and stare
        ally.suppressionValue = Game.clamp((ally.suppressionValue || 0) + 7, 0, 100);
    }
};

Game.updateAI = (unit, dt, enemy) => {
    unit.thinking -= dt;
    if (unit.thinking > 0) return;
    unit.thinking = Game.rand(0.25, 0.5);
    unit.retreating = false; // re-asserted below only while actually falling back

    const isVeh = Game.isTank(unit.kind);
    const isFoot = Game.isFootInfantry(unit);
    const supp = unit.suppressionValue || 0;
    const hpPct = unit.hp / unit.maxHp;
    const inCover = (unit.coverBonus || 0) > 0.32;
    const posture = unit._squadPosture || 'hold';
    const role = unit._role || 'fire';

    // Remember the last seen threat briefly so units still react after LOS breaks.
    if (enemy) { unit._lastThreat = { x: enemy.x, z: enemy.z }; unit._threatTime = Game.gameClock; }
    const threatPos = enemy
        ? enemy
        : (unit._lastThreat && (Game.gameClock - (unit._threatTime || 0) < 8) ? unit._lastThreat : null);

    const setStance = (s) => { if (isFoot) { unit.stance = s; unit._autoStance = true; } };
    // Mokra's German armour owns stable scenario corridors. Reuse them for AI
    // firing-position, rally and patrol plans as well as stuck recovery so a
    // contact decision cannot launch the general 80k-state vehicle A* on the
    // simulation thread. Infantry, player units and every other scenario retain
    // the normal pathfinder.
    const planPath = (x, z) => {
        const authored = unit._mokraAuthoredAttacker
            && Game.currentScenario === 'mokra'
            && unit.team === Game.TEAM.GERMAN
            && Game._recoverMokraVehicleRoute;
        return authored
            ? Game._recoverMokraVehicleRoute(unit, x, z, 'ai-plan')
            : Game.findPath(unit, unit.x, unit.z, x, z);
    };

    // Morale: an officer's presence stiffens resolve (RWM officerradius); an
    // isolated soldier breaks sooner.
    const steady = unit._steadied ? 12 : 0;

    // ── TANK HUNTER: a foot soldier with an enemy tank right on top of him pulls
    //    an anti-tank grenade bundle and lobs it (RWM close-assault). Checked
    //    before the cover/retreat branches so a cornered man still fights back. ──
    if (isFoot) {
        unit._atGrenades = unit._atGrenades ?? 2;
        if (unit._atGrenades > 0 && (unit._atNext == null || Game.gameClock >= unit._atNext)) {
            let tank = null, bd = 7 * 7;
            for (const e of Game.units) {
                if (!e.alive || e.team === unit.team || !Game.isTank(e.kind)) continue;
                const ed = Game.distSq(unit.x, unit.z, e.x, e.z);
                if (ed < bd && Game.unitCanSee(unit, e)) { bd = ed; tank = e; }
            }
            if (tank && Game.spawnThrownGrenade) {
                // Whip around fast but finitely, and only let go once roughly
                // facing the tank — the instant 180° snap-and-throw read as a
                // teleport-turn glitch.
                const want = Game.angleTo(unit.x, unit.z, tank.x, tank.z);
                unit.angle = Game.rotateTo(unit.angle, want, 1.0);
                unit.turretAngle = unit.angle;
                if (Math.abs(Game.angleDiff(unit.angle, want)) < 0.3) {
                    unit._atGrenades--;
                    unit._atNext = Game.gameClock + Game.rand(2.5, 4.5);
                    Game.spawnThrownGrenade(unit.x, unit.z,
                        tank.x + Game.rand(-0.6, 0.6), tank.z + Game.rand(-0.6, 0.6),
                        { type: 'at', dmg: 45, blastR: 2.2, supp: 18, arc: 1.4 });
                }
            }
        }
    }

    // ── RETREAT: squad broken or near death — fall back to the rally point ──
    if (posture === 'fallback' || hpPct < 0.22) {
        unit._ai = 'retreat';
        // Commit to the fall-back: infantry sprint, tanks reverse out of contact
        // (the move module reads unit.retreating + _retreatThreat).
        unit.retreating = true;
        if (threatPos) unit._retreatThreat = { x: threatPos.x, z: threatPos.z };
        // Panic: a broken, heavily-suppressed soldier with no officer near may bolt
        // in a random direction instead of an orderly fall-back (RWM moralerndmove).
        const rally = unit._rally || unit.holdPoint || { x: unit.x, z: unit.z };
        if (isFoot && !unit._steadied && supp > 70 && Game.rand(0, 1) < 0.25 && threatPos) {
            // Commit to ONE bolt direction until it's spent — re-rolling a fresh
            // random direction every think tick had the panicking man swivelling
            // on the spot instead of running anywhere.
            if (!unit.path || !unit.path.length) {
                const away = Game.angleTo(threatPos.x, threatPos.z, unit.x, unit.z) + Game.rand(-0.8, 0.8);
                const gx = Game.clamp(unit.x + Math.cos(away) * 6 * Game.TILE, 1, Game.WORLD_W - 1);
                const gz = Game.clamp(unit.z + Math.sin(away) * 6 * Game.TILE, 1, Game.WORLD_H - 1);
                unit.path = planPath(gx, gz);
            }
            setStance('run');
            return;
        }
        if (Game.dist(unit.x, unit.z, rally.x, rally.z) > 3 && (!unit.path || !unit.path.length)) {
            unit.path = planPath(rally.x, rally.z);
        }
        setStance('run'); // sprint to the rally (infantry); no-op for vehicles
        return;
    }

    // ── PINNED: heavy suppression — go prone, crawl to the nearest cover ──
    if (supp > 75 + steady && isFoot) {
        unit._ai = 'pinned';
        setStance('prone');
        if (!inCover && threatPos) {
            const cov = Game.findCoverPosition(unit, threatPos.x, threatPos.z);
            unit.path = cov ? planPath(cov.x, cov.z) : [];
        } else {
            unit.path = [];
        }
        return;
    }

    // ── COMMIT to an in-progress cover dash: a man half-way to a wall must not
    //    have the dash cancelled because this tick happens to judge him "in
    //    cover" or the threat blinked — the cancel/replan cycle left men
    //    twitching in circles between refuges. He keeps going (still shooting;
    //    fire isn't gated on being halted) and re-evaluates once he arrives. ──
    if (isFoot && (unit._ai === 'seekcover' || unit._ai === 'shelter') && unit.path && unit.path.length) {
        // Sprint the open ground, drop to a crouch for the last couple of
        // meters (suppression can still force him lower via the morale module).
        const wp = unit.path[unit.path.length - 1];
        setStance(Game.dist(unit.x, unit.z, wp.x, wp.z) > 2.5 ? 'run' : 'crouch');
        return;
    }

    // ── REACT TO CONTACT: exposed infantry don't stand and trade shots — they
    //    break for terrain cover, a tree line, or the lee of a nearby friendly
    //    tank (mobile cover), then crouch and fire from there. Triggers on a live
    //    enemy too (not only once suppressed), so troops take cover proactively.
    //    Maneuver elements keep bounding. ──
    // FOOT TROOPS ONLY: armor doesn't scurry for infantry cover. (Ungated, a
    // tank ran this branch, picked "the lee of the nearest friendly tank" —
    // which was ITSELF — and chased that moving point in circles on the spot.)
    if (isFoot && threatPos && !inCover && role !== 'maneuver'
        && (enemy || supp > 15 || unit.underFire > 0)) {
        // Face the fire even from an unseen shooter — via the per-frame facing
        // goal (a discrete turn step per think tick read as jerky small turns).
        if (!enemy) {
            unit._faceGoal = Game.angleTo(unit.x, unit.z, threatPos.x, threatPos.z);
        }
        // Already moving to a refuge — keep going instead of re-planning each tick.
        if ((unit._ai === 'seekcover' || unit._ai === 'shelter')
            && unit.path && unit.path.length) {
            setStance('crouch');
            return;
        }
        // Candidate refuges: terrain cover, and the far side of a friendly tank.
        let refuge = Game.findCoverPosition(unit, threatPos.x, threatPos.z);
        let kind = refuge ? 'seekcover' : '';
        const tank = Game.nearestFriendlyTank(unit, 20);
        if (tank) {
            const a = Game.angleTo(threatPos.x, threatPos.z, tank.x, tank.z); // past the tank, away from fire
            // Stand CLEAR of the hull's collision box (worst case: its long axis),
            // not at a fixed 2.8u — that landed inside big tanks' boxes, so the man
            // jogged into the hull forever while the box pushed him back out.
            const lee = tank.size * (Game.TANK_BOX_LEN || 1.5) + (unit.size || 0.5) * 0.7 + 1.0;
            const ax = Game.clamp(tank.x + Math.cos(a) * lee, 1, Game.WORLD_W - 1);
            const az = Game.clamp(tank.z + Math.sin(a) * lee, 1, Game.WORLD_H - 1);
            if (!refuge || Game.dist(unit.x, unit.z, ax, az) < Game.dist(unit.x, unit.z, refuge.x, refuge.z)) {
                refuge = { x: ax, z: az }; kind = 'shelter';
            }
        }
        if (refuge && Game.dist(unit.x, unit.z, refuge.x, refuge.z) > 1.2) {
            unit._ai = kind;
            unit.path = planPath(refuge.x, refuge.z);
            // Break for it at a sprint; the dash-commit block above manages the
            // stance for the rest of the run and he crouches on arrival.
            setStance(Game.dist(unit.x, unit.z, refuge.x, refuge.z) > 2.5 ? 'run' : 'crouch');
        } else {
            // Nothing close — go to ground and fight from the dirt; crawl clear if pinned.
            unit._ai = 'pinned';
            setStance(supp > 45 ? 'prone' : 'crouch');
            if (supp > 55) {
                const away = Game.angleTo(threatPos.x, threatPos.z, unit.x, unit.z);
                const gx = Game.clamp(unit.x + Math.cos(away) * 4 * Game.TILE, 1, Game.WORLD_W - 1);
                const gz = Game.clamp(unit.z + Math.sin(away) * 4 * Game.TILE, 1, Game.WORLD_H - 1);
                unit.path = planPath(gx, gz);
            } else {
                unit.path = [];
            }
        }
        return;
    }

    // ── ARMOR COMBAT INTENTS: a tank fights from positions, it doesn't charge.
    //    Damaged (<35%): break off — reverse out of contact, front kept to the
    //    threat (the reverse-retreat drive handles the motion). In range + LOS:
    //    HALT AND FIRE (the fire module lays the turret/hull). Otherwise, and
    //    only if it's a mobile force (attack/patrol — hold garrisons keep their
    //    post), move to a scored firing position, not to the enemy. ──
    if (isVeh && enemy) {
        const d = Game.dist(unit.x, unit.z, enemy.x, enemy.z);
        if (hpPct < 0.35) {
            unit._ai = 'retreat';
            unit.retreating = true;
            unit._retreatThreat = { x: enemy.x, z: enemy.z };
            const rally = unit._rally || unit.holdPoint || { x: unit.x, z: unit.z };
            if ((!unit.path || !unit.path.length) && Game.dist(unit.x, unit.z, rally.x, rally.z) > 3) {
                unit.path = planPath(rally.x, rally.z);
            }
            return;
        }
        if (d <= unit.range * 0.95 && Game.unitCanSee(unit, enemy)) {
            unit._ai = 'engage';
            unit.path = [];                       // halt and fire from here
            return;
        }
        const mobile = unit.aiState === 'attack' || unit.aiState === 'patrol' || posture === 'attack';
        if (mobile) {
            // Re-plan only when idle or the target has shifted well away from the
            // last anchor — never every think tick.
            const shifted = !unit._fpAnchor
                || Game.distSq(unit._fpAnchor.x, unit._fpAnchor.z, enemy.x, enemy.z) > 36;
            if (!unit.path || !unit.path.length || shifted) {
                unit._fpAnchor = { x: enemy.x, z: enemy.z };
                // Maneuver element presses to a closer band; base of fire stands off.
                const fp = Game.findFiringPosition
                    ? Game.findFiringPosition(unit, enemy, { standoff: role === 'maneuver' ? 0.55 : 0.75 })
                    : null;
                const goal = fp || enemy;
                unit.path = planPath(goal.x, goal.z);
            }
            unit._ai = 'advance';
            return;
        }
        // Hold garrison without range/LOS: keep the post, stay pointed at him
        // (continuous per-frame facing — no stepwise think-tick turns).
        unit._ai = 'alert';
        unit._faceGoal = Game.angleTo(unit.x, unit.z, enemy.x, enemy.z);
        unit.path = [];
        return;
    }

    // ── ENGAGE / ADVANCE when an enemy is visible ──
    if (enemy) {
        const d = Game.dist(unit.x, unit.z, enemy.x, enemy.z);
        if (role === 'maneuver' && posture === 'attack' && d > unit.range * 0.6) {
            // Bound forward toward the enemy (the fire team overwatches us). Plan a
            // fresh bound only once the last one is spent — re-planning every
            // think-tick made the man twitch and never commit to a rush.
            unit._ai = 'advance';
            if (!unit.path || !unit.path.length) {
                const ang = Game.angleTo(unit.x, unit.z, enemy.x, enemy.z) + Game.rand(-0.3, 0.3);
                const step = Math.min(d - unit.range * 0.5, 7 * Game.TILE);
                const gx = Game.clamp(unit.x + Math.cos(ang) * step, 1, Game.WORLD_W - 1);
                const gz = Game.clamp(unit.z + Math.sin(ang) * step, 1, Game.WORLD_H - 1);
                unit.path = planPath(gx, gz);
            }
            setStance(supp > 20 ? 'crouch' : 'stand');
        } else {
            // Base of fire / in range: hold position and shoot (combat fires)
            unit._ai = 'engage';
            unit.path = [];
            setStance((inCover || supp > 25) ? 'crouch' : 'stand');
        }
        return;
    }

    // ── Alerted but no target in view: face the threat from cover ──
    // Turn a bounded step per think tick (~1-2 rad/s), never an instant snap —
    // snapping a tank's hull AND turret to each fresh threat bearing every
    // 0.25-0.5s was the alerted-unit twitch/spin. Turreted tanks swing the hull
    // only; the turret tracks via its own inertia (fire module idle recentre).
    if (threatPos) {
        unit._ai = 'alert';
        unit._faceGoal = Game.angleTo(unit.x, unit.z, threatPos.x, threatPos.z);
        if (isFoot) setStance(supp > 35 ? 'prone' : 'crouch');
        unit.path = [];
        return;
    }

    // ── No enemy: patrol, return to hold point, otherwise idle ──
    unit._ai = 'hold';
    if (unit.aiState === 'patrol' && unit.patrol) {
        const pt = unit.patrol[0];
        if (Game.dist(unit.x, unit.z, pt.x, pt.z) < 2) { unit.patrol.push(unit.patrol.shift()); unit.path = []; }
        // Re-path only when the current leg is spent — re-planning every think
        // tick fought the stuck-settle logic (a wedged patroller could never
        // stay settled long enough to be rescued).
        if (!unit.path || !unit.path.length) {
            unit.path = planPath(unit.patrol[0].x, unit.patrol[0].z);
        }
    } else if (unit.holdPoint && Game.dist(unit.x, unit.z, unit.holdPoint.x, unit.holdPoint.z) > 3
        && (!unit.path || !unit.path.length)) {
        unit.path = planPath(unit.holdPoint.x, unit.holdPoint.z);
    }
};

// ═══════════════════════════════════════════════════════
//  SQUAD COORDINATION (fire-and-maneuver / bounding overwatch)
// ═══════════════════════════════════════════════════════

Game.squads = {};

Game.updateSquadAI = (dt) => {
    Game._squadTimer = (Game._squadTimer || 0) - dt;
    if (Game._squadTimer > 0) return;
    Game._squadTimer = 1.2;

    // Group living German units by their squad tag (solo units = own squad)
    const groups = {};
    Game.units.forEach(u => {
        if (!u.alive || u.team === Game.playerTeam) return;   // squad AI drives the NON-player side
        const g = u.group || ('solo_' + u.id);
        (groups[g] = groups[g] || []).push(u);
    });

    for (const g in groups) {
        const mem = groups[g];
        const sq = Game.squads[g] = Game.squads[g] || { rally: null, peak: 0 };

        // Rally point = average of members' hold points (their defensive anchor)
        if (!sq.rally) {
            let rx = 0, rz = 0, n = 0;
            mem.forEach(u => { if (u.holdPoint) { rx += u.holdPoint.x; rz += u.holdPoint.z; n++; } });
            sq.rally = n ? { x: rx / n, z: rz / n } : { x: mem[0].x, z: mem[0].z };
        }

        const strength = mem.length;
        sq.peak = Math.max(sq.peak, strength);
        const losses = 1 - strength / sq.peak;          // fraction of the squad lost
        const avgSupp = mem.reduce((s, u) => s + (u.suppressionValue || 0), 0) / strength;

        // Reuse the staggered per-unit scan performed by unit_modules.js. Squad
        // coordination used to run two or three extra O(enemies × LOS-distance)
        // searches per member on this tick, producing a large periodic hitch.
        const sightings = new Map();
        let nKnown = 0;
        mem.forEach(u => {
            const enemy = Game.getCachedScanEnemy ? Game.getCachedScanEnemy(u) : null;
            sightings.set(u.id, enemy);
            if (enemy) nKnown++;
        });

        // Share the freshest threat across the whole squad so nobody stands
        // idle while a squad-mate is under fire. A live sighting always wins.
        let freshThreat = null, freshTime = -Infinity;
        mem.forEach(u => {
            const e = sightings.get(u.id);
            if (e) { freshTime = Game.gameClock; freshThreat = { x: e.x, z: e.z }; }
            else if (u._lastThreat && (u._threatTime || 0) > freshTime) {
                freshTime = u._threatTime; freshThreat = u._lastThreat;
            }
        });
        if (freshThreat && Game.gameClock - freshTime < 7) {
            mem.forEach(u => {
                if ((u._threatTime || -Infinity) < freshTime - 0.05) {
                    u._lastThreat = freshThreat;
                    u._threatTime = freshTime;
                    if (!sightings.get(u.id)) u.underFire = Math.max(u.underFire || 0, 0.5);
                }
            });
        }

        // Posture: break and fall back if mauled or pinned; press the attack if it's
        // an assault squad or most of the squad is in contact; otherwise hold.
        let candidate;
        const steadied = mem.some(u => u._steadied); // an officer is with the squad
        if (losses >= (steadied ? 0.6 : 0.5) || avgSupp > (steadied ? 82 : 72)) candidate = 'fallback';
        else if (nKnown > 0 && (mem[0].aiState === 'attack' || nKnown >= Math.ceil(strength * 0.5))) candidate = 'attack';
        else candidate = 'hold';

        // Intent hysteresis (the tactical arbiter): hold the current posture for a
        // minimum dwell so the squad doesn't thrash attack<->hold every time one
        // man's line of sight to the enemy blinks in and out. Falling back is a
        // survival decision and overrides the dwell instantly.
        const MIN_DWELL = 4.0;
        if (sq.posture == null) { sq.posture = candidate; sq.postureSince = Game.gameClock; }
        if (candidate !== sq.posture
            && (candidate === 'fallback' || (Game.gameClock - (sq.postureSince || 0)) >= MIN_DWELL)) {
            sq.posture = candidate;
            sq.postureSince = Game.gameClock;
        }
        const posture = sq.posture;

        // Roles: attacking squads split into a base of fire and a maneuver element
        // (bounding overwatch); everyone else forms a base of fire from cover.
        mem.forEach((u, i) => {
            u._squadPosture = posture;
            u._rally = sq.rally;
            u._role = (posture === 'attack' && i % 2 === 1) ? 'maneuver' : 'fire';
        });
    }
};

// ═══════════════════════════════════════════════════════
//  CHAIN OF COMMAND (succession of command)
// ═══════════════════════════════════════════════════════
//
// Real units never go leaderless: command devolves to the senior survivor.
// An officer leads; if he falls, the senior NCO/soldier is field-promoted to
// acting leader (inheriting the morale aura), and the chain continues down as
// leaders are lost. We keep each side's leader count topped up to its starting
// strength (and at least one), promoting the most senior eligible survivor.

// Seniority score: rank first, then battle experience / veterancy, then health.
Game.seniority = (u) => {
    let base = 0;
    if (u.supportType === 'officer') base = 1000;
    else if (u._actingOfficer) base = 800;
    return base + (u.veterancy || 0) * 200 + (u.experience || 0) + (u.hp / (u.maxHp || 1)) * 5;
};

Game.updateChainOfCommand = (dt) => {
    Game._cmdTimer = (Game._cmdTimer || 0) - dt;
    if (Game._cmdTimer > 0) return;
    Game._cmdTimer = 1.5;
    Game._cmd = Game._cmd || {};

    const NONCOMBAT = ['supply', 'fuel', 'transport', 'medic', 'mechanic'];
    for (const team of [Game.TEAM.POLISH, Game.TEAM.FRENCH, Game.TEAM.GERMAN]) {
        const living = Game.units.filter(u => u.alive && u.team === team);
        if (!living.length) continue;
        const cmd = Game._cmd[team] = Game._cmd[team] || {};
        // Establish the standing leader quota once (starting officers, min 1).
        if (cmd.quota == null) {
            cmd.quota = Math.max(living.filter(u => u.supportType === 'officer').length, 1);
        }
        const leaders = living.filter(u => u.supportType === 'officer' || u._actingOfficer);
        let need = cmd.quota - leaders.length;
        if (need <= 0) continue;
        // Promote the most senior eligible combat survivors to fill the gap.
        const elig = living
            .filter(u => !(u.supportType === 'officer' || u._actingOfficer)
                && !NONCOMBAT.includes(u.supportType))
            .sort((a, b) => Game.seniority(b) - Game.seniority(a));
        for (const u of elig) {
            if (need <= 0) break;
            u._actingOfficer = true;
            u.veterancy = Math.min(1, (u.veterancy || 0) + 0.1); // a field commission steadies him
            need--;
            if (team === Game.playerTeam) Game.pushMessage(`${u.label} takes command.`, 2.2);
        }
    }
};

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
            if (cover < 0.2) continue;
            const losBlocked = Game.lineOfSight({ x: threatX, z: threatZ }, { x: cx, z: cz }) === false;
            const dist = Game.dist(unit.x, unit.z, cx, cz);
            const towardThreat = Math.cos(a - toThreat); // +1 if heading at the threat
            const score = cover * 100 + (losBlocked ? 70 : 0) - dist * 2 - towardThreat * 30;
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
        if (!a.alive || a.team !== unit.team || !Game.isTank(a.kind)) continue;
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

    const setStance = (s) => { if (!isVeh) { unit.stance = s; unit._autoStance = true; } };

    // Morale: an officer's presence stiffens resolve (RWM officerradius); an
    // isolated soldier breaks sooner.
    const steady = unit._steadied ? 12 : 0;

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
        if (!isVeh && !unit._steadied && supp > 70 && Game.rand(0, 1) < 0.25 && threatPos) {
            const away = Game.angleTo(threatPos.x, threatPos.z, unit.x, unit.z) + Game.rand(-0.8, 0.8);
            const gx = Game.clamp(unit.x + Math.cos(away) * 6 * Game.TILE, 1, Game.WORLD_W - 1);
            const gz = Game.clamp(unit.z + Math.sin(away) * 6 * Game.TILE, 1, Game.WORLD_H - 1);
            unit.path = Game.findPath(unit, unit.x, unit.z, gx, gz);
            setStance('run');
            return;
        }
        if (Game.dist(unit.x, unit.z, rally.x, rally.z) > 3 && (!unit.path || !unit.path.length)) {
            unit.path = Game.findPath(unit, unit.x, unit.z, rally.x, rally.z);
        }
        setStance('run'); // sprint to the rally (infantry); no-op for vehicles
        return;
    }

    // ── PINNED: heavy suppression — go prone, crawl to the nearest cover ──
    if (supp > 75 + steady && !isVeh) {
        unit._ai = 'pinned';
        setStance('prone');
        if (!inCover && threatPos) {
            const cov = Game.findCoverPosition(unit, threatPos.x, threatPos.z);
            unit.path = cov ? Game.findPath(unit, unit.x, unit.z, cov.x, cov.z) : [];
        } else {
            unit.path = [];
        }
        return;
    }

    // ── REACT TO CONTACT: exposed infantry don't stand and trade shots — they
    //    break for terrain cover, a tree line, or the lee of a nearby friendly
    //    tank (mobile cover), then crouch and fire from there. Triggers on a live
    //    enemy too (not only once suppressed), so troops take cover proactively.
    //    Maneuver elements keep bounding. ──
    if (threatPos && !inCover && role !== 'maneuver'
        && (enemy || supp > 15 || unit.underFire > 0)) {
        // Face the fire even from an unseen shooter.
        if (!enemy) {
            unit.angle = Game.angleTo(unit.x, unit.z, threatPos.x, threatPos.z);
            unit.turretAngle = unit.angle;
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
            const ax = Game.clamp(tank.x + Math.cos(a) * 2.8, 1, Game.WORLD_W - 1);
            const az = Game.clamp(tank.z + Math.sin(a) * 2.8, 1, Game.WORLD_H - 1);
            if (!refuge || Game.dist(unit.x, unit.z, ax, az) < Game.dist(unit.x, unit.z, refuge.x, refuge.z)) {
                refuge = { x: ax, z: az }; kind = 'shelter';
            }
        }
        if (refuge && Game.dist(unit.x, unit.z, refuge.x, refuge.z) > 1.2) {
            unit._ai = kind;
            unit.path = Game.findPath(unit, unit.x, unit.z, refuge.x, refuge.z);
            setStance('crouch');
        } else {
            // Nothing close — go to ground and fight from the dirt; crawl clear if pinned.
            unit._ai = 'pinned';
            setStance(supp > 45 ? 'prone' : 'crouch');
            if (supp > 55) {
                const away = Game.angleTo(threatPos.x, threatPos.z, unit.x, unit.z);
                const gx = Game.clamp(unit.x + Math.cos(away) * 4 * Game.TILE, 1, Game.WORLD_W - 1);
                const gz = Game.clamp(unit.z + Math.sin(away) * 4 * Game.TILE, 1, Game.WORLD_H - 1);
                unit.path = Game.findPath(unit, unit.x, unit.z, gx, gz);
            } else {
                unit.path = [];
            }
        }
        return;
    }

    // ── ENGAGE / ADVANCE when an enemy is visible ──
    if (enemy) {
        const d = Game.dist(unit.x, unit.z, enemy.x, enemy.z);
        if (role === 'maneuver' && posture === 'attack' && d > unit.range * 0.6) {
            // Bound forward toward the enemy (the fire team overwatches us)
            unit._ai = 'advance';
            const ang = Game.angleTo(unit.x, unit.z, enemy.x, enemy.z) + Game.rand(-0.3, 0.3);
            const step = Math.min(d - unit.range * 0.5, 7 * Game.TILE);
            const gx = Game.clamp(unit.x + Math.cos(ang) * step, 1, Game.WORLD_W - 1);
            const gz = Game.clamp(unit.z + Math.sin(ang) * step, 1, Game.WORLD_H - 1);
            unit.path = Game.findPath(unit, unit.x, unit.z, gx, gz);
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
    if (threatPos) {
        unit._ai = 'alert';
        unit.angle = Game.angleTo(unit.x, unit.z, threatPos.x, threatPos.z);
        if (!isVeh) { unit.turretAngle = unit.angle; setStance(supp > 35 ? 'prone' : 'crouch'); }
        else { unit.turretAngle = unit.angle; }
        unit.path = [];
        return;
    }

    // ── No enemy: patrol, return to hold point, otherwise idle ──
    unit._ai = 'hold';
    if (unit.aiState === 'patrol' && unit.patrol) {
        const pt = unit.patrol[0];
        if (Game.dist(unit.x, unit.z, pt.x, pt.z) < 2) unit.patrol.push(unit.patrol.shift());
        unit.path = Game.findPath(unit, unit.x, unit.z, unit.patrol[0].x, unit.patrol[0].z);
    } else if (unit.holdPoint && Game.dist(unit.x, unit.z, unit.holdPoint.x, unit.holdPoint.z) > 3
        && (!unit.path || !unit.path.length)) {
        unit.path = Game.findPath(unit, unit.x, unit.z, unit.holdPoint.x, unit.holdPoint.z);
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
        if (!u.alive || u.team !== Game.TEAM.GERMAN) return;
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

        // How many members currently see an enemy?
        let nKnown = 0;
        mem.forEach(u => { if (Game.nearestEnemy(u)) nKnown++; });

        // Share the freshest threat across the whole squad so nobody stands
        // idle while a squad-mate is under fire. A live sighting always wins.
        let freshThreat = null, freshTime = -Infinity;
        mem.forEach(u => {
            const e = Game.nearestEnemy(u);
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
                    if (!Game.nearestEnemy(u)) u.underFire = Math.max(u.underFire || 0, 0.5);
                }
            });
        }

        // Posture: break and fall back if mauled or pinned; press the attack if it's
        // an assault squad or most of the squad is in contact; otherwise hold.
        let posture;
        const steadied = mem.some(u => u._steadied); // an officer is with the squad
        if (losses >= (steadied ? 0.6 : 0.5) || avgSupp > (steadied ? 82 : 72)) posture = 'fallback';
        else if (nKnown > 0 && (mem[0].aiState === 'attack' || nKnown >= Math.ceil(strength * 0.5))) posture = 'attack';
        else posture = 'hold';

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

    const NONCOMBAT = ['supply', 'fuel', 'medic', 'mechanic'];
    for (const team of [Game.TEAM.FRENCH, Game.TEAM.GERMAN]) {
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
            if (team === Game.TEAM.FRENCH) Game.pushMessage(`${u.label} takes command.`, 2.2);
        }
    }
};

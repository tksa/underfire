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

// Cover a unit's POSITION gives, independent of how he is standing. Decisions
// ("am I in cover?") must use this, not unit.coverBonus: that value includes
// the stance bonus (prone +0.15, crouch +0.08), so a prone man read as covered,
// was told to kneel, read as uncovered, was told to lie down... every think
// tick. That feedback loop was half of all animation flicker in a battle.
Game.positionCover = (unit) => {
    if (unit._garrisoned) return Game.GARRISON_COVER || 0.9;
    let c = Game.coverAt(unit.x, unit.z);
    if (unit.entrenched) c = Math.max(c, 0.5);
    return c;
};

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
 * opts.lane:  a vehicle — candidates inside its line of advance are rejected
 *             (no refuge is worth lying down in front of a tank).
 * opts.crowd: (default true) spots already taken or being run to by comrades
 *             score lower, so an alerted squad spreads along a hedge instead
 *             of piling onto one tile and elbowing each other back out.
 */
Game.findCoverPosition = (unit, threatX, threatZ, opts = null) => {
    const T = Game.TILE;
    const toThreat = Game.angleTo(unit.x, unit.z, threatX, threatZ);
    const lane = opts && opts.lane;
    const crowd = !opts || opts.crowd !== false;
    const rings = (opts && opts.rings) || 6;      // search radius in ~0.8-tile rings
    let best = null, bestScore = 25; // require a meaningfully covered spot
    for (let r = 1; r <= rings; r++) {
        for (let k = 0; k < 10; k++) {
            const a = (k / 10) * Math.PI * 2;
            const cx = Game.clamp(unit.x + Math.cos(a) * r * T * 0.8, 1, Game.WORLD_W - 1);
            const cz = Game.clamp(unit.z + Math.sin(a) * r * T * 0.8, 1, Game.WORLD_H - 1);
            const tile = Game.getTileAtWorld(cx, cz);
            if (!tile || tile.blocked || (Game.isTank(unit.kind) && tile.vehicleBlocked)) continue;
            if (!Game.coverSlotAvailable(unit, cx, cz)) continue;
            const cover = Game.coverAt(cx, cz);
            // Only spots that will COUNT as in-cover once reached (the AI's
            // inCover test is >0.32). Accepting 0.2-0.32 refuges sent men on a
            // dash that left them still "exposed" on arrival, so they re-sought
            // cover forever — the seekcover/alert twitch loop.
            if (cover < Game.COVER_MIN) continue;
            if (lane && Game.pointInLane(cx, cz, lane, 1.0)) continue;
            const losBlocked = Game.lineOfSight({ x: threatX, z: threatZ }, { x: cx, z: cz }) === false;
            const dist = Game.dist(unit.x, unit.z, cx, cz);
            const towardThreat = Math.cos(a - toThreat); // +1 if heading at the threat
            let score = cover * 100 + (losBlocked ? 70 : 0) - dist * 2 - towardThreat * 30;
            if (crowd) {
                for (const f of Game.units) {
                    if (!f.alive || f === unit || f.team !== unit.team || Game.isTank(f.kind) || Game.isTruck(f.kind)) continue;
                    if (Game.distSq(f.x, f.z, cx, cz) < 1.7 * 1.7) { score -= 35; break; }
                    const wp = f.path && f.path.length ? f.path[f.path.length - 1] : null;
                    if (wp && Game.distSq(wp.x, wp.z, cx, cz) < 1.7 * 1.7) { score -= 35; break; }
                }
            }
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
 * enemy itself. Returns {x, z} or null when no safe candidate exists.
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
            const facing = Game.angleTo(cx, cz, target.x, target.z);
            if (Game._bodySolidCount && Game._bodySolidCount(unit, cx, cz, facing)) continue;
            if (Game._vehiclePosePenetration
                && Game._vehiclePosePenetration(unit, cx, cz, facing, 0.2, false).depth > 0.001) continue;
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
 * Men already behind cover get the WORD (threat position, a little tension)
 * but not the shock that would have them abandon a good position to run for
 * the same hedge everyone else is heading to.
 */
Game.alertAllies = (unit, threatX, threatZ, radius = 16, threatUnit = null) => {
    const now = Game.gameClock;
    const grp = unit.group || null;
    for (const ally of Game.units) {
        if (!ally.alive || ally === unit) continue;
        if (ally.team !== unit.team) continue;
        const sameSquad = grp && ally.group === grp;
        const dAlly = Game.dist(unit.x, unit.z, ally.x, ally.z);
        if (!sameSquad && dAlly > radius) continue;
        if (dAlly > 40) continue;                         // word travels, not across the whole map
        if (ally.aiState === 'player') {
            // The player's men get the WORD ("Panzer, left!") so take-cover knows
            // the threat — never a suppression shove, never an overridden order.
            if (!(ally._threatTime && now - ally._threatTime < 1.2)) {
                ally._lastThreat = { x: threatX, z: threatZ };
                ally._threatTime = now;
                if (threatUnit) ally._threatUnit = threatUnit;
                ally.underFire = Math.max(ally.underFire || 0, 0.3);
            }
            continue;
        }
        // Keep a fresher first-hand threat (they're already reacting to it)
        if (ally._threatTime && now - ally._threatTime < 1.2 && (ally.underFire || 0) > 0.4) continue;
        ally._lastThreat = { x: threatX, z: threatZ };
        ally._threatTime = now;
        if (threatUnit) ally._threatUnit = threatUnit;
        const covered = Game.positionCover(ally) >= Game.COVER_MIN;
        ally.underFire = Math.max(ally.underFire || 0, covered ? 0.35 : 0.6);
        // a little shock so they take cover rather than just stand and stare —
        // but second-hand alarm alone never pins a squad (capped well below the
        // crouch floor; only rounds landing near a man take him past it).
        if ((ally.suppressionValue || 0) < 55) {
            ally.suppressionValue = Game.clamp((ally.suppressionValue || 0) + (covered ? 3 : 7), 0, 55);
        }
    }
};

// ═══════════════════════════════════════════════════════
//  ARMOR THREAT HELPERS (shared by the AI and the player-side take-cover)
// ═══════════════════════════════════════════════════════

/**
 * Where does this unit sit relative to a vehicle's line of advance? `ahead` and
 * `lateral` are hull-frame coordinates (metres along / across the hull axis);
 * `inLane` means "on its path within the next several seconds of travel";
 * `closing` means the hull is actually rolling and has not passed him yet.
 */
Game.laneInfo = (unit, tank) => {
    const fX = Math.cos(tank.angle || 0), fZ = Math.sin(tank.angle || 0);
    const rx = unit.x - tank.x, rz = unit.z - tank.z;
    const ahead = rx * fX + rz * fZ;
    const lateral = rx * -fZ + rz * fX;
    const halfW = tank.size * (Game.TANK_BOX_WID || 1.0) + (unit.size || 0.5) * 0.7 + 1.2;
    const speed = (tank.currentSpeed || 0) * (tank._reversing ? -1 : 1);
    const closing = speed > 0.3 && ahead > -tank.size;
    const reach = 8 + Math.max(0, speed) * 6;                 // ~6 s of travel
    const inLane = Math.abs(lateral) < halfW && ahead > -tank.size * 1.5 && ahead < reach;
    return { ahead, lateral, halfW, closing, inLane, dist: Math.hypot(rx, rz), fX, fZ };
};

/** Is a world point inside the vehicle's lane (plus a margin), ahead of it? */
Game.pointInLane = (x, z, tank, margin = 0) => {
    const fX = Math.cos(tank.angle || 0), fZ = Math.sin(tank.angle || 0);
    const rx = x - tank.x, rz = z - tank.z;
    const ahead = rx * fX + rz * fZ;
    const lateral = Math.abs(rx * -fZ + rz * fX);
    const halfW = tank.size * (Game.TANK_BOX_WID || 1.0) + 1.6 + margin;
    const reach = 8 + (tank.currentSpeed || 0) * 6;
    return lateral < halfW && ahead > -tank.size * 1.5 && ahead < reach;
};

/**
 * The enemy armor this unit should be worrying about: the scan module's cached
 * armor threat (a vehicle it cannot hurt) when fresh, else the nearest enemy
 * tank it can see — or hear: any tank inside ~14u is felt through foliage.
 * Player units only react to armor the team has actually spotted (fog). The
 * result is cached per frame so the AI and take-cover never re-scan twice.
 */
Game.armorThreatFor = (unit, maxDist = 32) => {
    const now = Game.gameClock;
    if (unit._armorRefT === now && unit._armorRefDist === maxDist) return unit._armorRef;
    let best = null, bd = maxDist * maxDist;
    const a = unit._armorThreat;
    if (a && a.alive && a.team !== unit.team && (now - (unit._armorThreatTime || 0)) < 2.5) {
        const d = Game.distSq(unit.x, unit.z, a.x, a.z);
        if (d < bd) { bd = d; best = a; }
    }
    // A tank that has been shooting at him (or his squad) in the last few
    // seconds is known — muzzle flash and engine noise carry well beyond the
    // scale at which a rifleman "sees" — even if it sits outside his sight ring.
    const tu = unit._threatUnit;
    if (tu && tu.alive && tu.team !== unit.team && Game.isTank(tu.kind)
        && (now - (unit._threatTime || -1e9)) < 8) {
        const d = Game.distSq(unit.x, unit.z, tu.x, tu.z);
        if (d < bd) { bd = d; best = tu; }
    }
    const fogGated = unit.team === Game.playerTeam && Game.isFogVisible;
    for (const e of Game.units) {
        if (!e.alive || e.team === unit.team || !Game.isTank(e.kind)) continue;
        const d = Game.distSq(unit.x, unit.z, e.x, e.z);
        if (d >= bd) continue;
        if (fogGated && !Game.isFogVisible(e.x, e.z)) continue;
        if (d > 14 * 14 && !Game.unitCanSee(unit, e)) continue;
        bd = d; best = e;
    }
    unit._armorRef = best; unit._armorRefT = now; unit._armorRefDist = maxDist;
    return best;
};

/**
 * Pick where a foot soldier should go to get out of an approaching tank's
 * path. Doctrine, not panic: leave the axis PERPENDICULARLY on the side he is
 * already on (committed per vehicle so he never dithers across the centreline),
 * far enough to clear the hull and its MG's natural arc, and take cover there
 * if any lies off-axis within a short dash. Never along the axis — a man who
 * runs straight down the barrel is out-run by the tank and shot in the back.
 * Returns {x, z, cover} where cover is true when the spot is a real refuge.
 */
Game.planArmorEvasion = (unit, tank) => {
    const L = Game.laneInfo(unit, tank);
    unit._evadeSides = unit._evadeSides || {};
    let side = unit._evadeSides[tank.id];
    if (side == null) {
        side = Math.abs(L.lateral) > 0.3 ? Math.sign(L.lateral) : ((unit.id & 1) ? 1 : -1);
        unit._evadeSides[tank.id] = side;
    }
    const passable = (x, z) => {
        if (x < 1 || z < 1 || x > Game.WORLD_W - 1 || z > Game.WORLD_H - 1) return false;
        const t = Game.getTileAtWorld(x, z);
        return !!t && !t.blocked;
    };
    const exitFor = (s) => {
        const px = -L.fZ * s, pz = L.fX * s;
        const out = L.halfW + 3.5 + Game.rand(0, 2.5) - Math.abs(L.lateral) * (Math.sign(L.lateral) === s ? 1 : -1);
        return { x: unit.x + px * Math.max(out, 3.0), z: unit.z + pz * Math.max(out, 3.0) };
    };
    // Real cover near an exit, still off-axis, beats bare ground.
    const T = Game.TILE;
    const coverNear = (exit) => {
        let best = null, bestScore = 20;
        for (let r = 0; r <= 4; r++) {
            for (let k = 0; k < (r ? 8 : 1); k++) {
                const a = (k / 8) * Math.PI * 2;
                const cx = exit.x + Math.cos(a) * r * T * 0.8, cz = exit.z + Math.sin(a) * r * T * 0.8;
                if (!passable(cx, cz)) continue;
                if (Game.pointInLane(cx, cz, tank, 0.8)) continue;
                const cover = Game.coverAt(cx, cz);
                if (cover < Game.COVER_MIN) continue;
                const score = cover * 100 - Game.dist(unit.x, unit.z, cx, cz) * 3;
                if (score > bestScore) { bestScore = score; best = { x: cx, z: cz, cover: true, score }; }
            }
        }
        return best && Game.dist(unit.x, unit.z, best.x, best.z) < 14 ? best : null;
    };
    let exit = exitFor(side);
    if (!passable(exit.x, exit.z)) {
        // Boxed in on that side (a wall, water): commit to the other one.
        side = -side; unit._evadeSides[tank.id] = side;
        exit = exitFor(side);
        if (!passable(exit.x, exit.z)) exit = { x: unit.x - L.fX * 2.5, z: unit.z - L.fZ * 2.5 };
    }
    let best = coverNear(exit);
    // No cover on his side but some on the other? Crossing the axis is only
    // acceptable while the tank is still well out — otherwise he would be
    // running across its nose.
    if (!best && L.dist > 18) {
        const otherExit = exitFor(-side);
        const other = passable(otherExit.x, otherExit.z) ? coverNear(otherExit) : null;
        if (other) { side = -side; unit._evadeSides[tank.id] = side; exit = otherExit; best = other; }
    }
    if (best) return best;
    return { x: Game.clamp(exit.x, 1, Game.WORLD_W - 1), z: Game.clamp(exit.z, 1, Game.WORLD_H - 1), cover: false };
};

// ═══════════════════════════════════════════════════════
//  CREW-SERVED GUNS (towed AT guns, field guns, tripod MGs)
// ═══════════════════════════════════════════════════════

/**
 * A gun is not a rifleman: it fights from where its trails are dug in, it
 * cannot outrun anything once limbered, and the crew — not the piece — is what
 * survives contact. So: with armor in reach it stays in action whatever the
 * squad is doing; when it is wrecked, dry, or about to be overrun the crew
 * bails out as riflemen (they can re-man it later); it only limbers to fall
 * back when nothing tracked can catch it; and it never packs up for a
 * two-metre shove back to its post.
 */
Game._gunAI = (unit, o) => {
    const { enemy, threatPos, posture, supp, hpPct, planPath, now } = o;
    const faceToward = (x, z) => {
        const want = Game.angleTo(unit.x, unit.z, x, z);
        const cur = unit._faceGoal != null ? unit._faceGoal : unit.angle;
        const stale = (now - (unit._faceSetT || -1e9)) > 6;
        if (Math.abs(Game.angleDiff(cur, want)) > (stale ? 0.3 : 0.7)) {
            unit._faceGoal = want; unit._faceSetT = now;
        }
    };
    const armor = Game.armorThreatFor(unit, 45);
    const d = armor ? Game.dist(unit.x, unit.z, armor.x, armor.z) : Infinity;
    const reach = Math.min(unit.range || 30, (unit.sight || 20) * 1.15);
    if (!unit._unmanned && Game.dismountGunCrew) {
        const overrun = armor && d < 7 && Game.laneInfo(unit, armor).closing && Game.laneInfo(unit, armor).inLane;
        const broken = supp > 90 && armor && d < 25;
        const dry = unit.ammo === 0 && !!armor;
        if (hpPct < 0.22 || overrun || broken || dry) {
            if (Game.dismountGunCrew(unit, { threat: armor || threatPos, quiet: unit.team !== Game.playerTeam })) {
                unit._ai = 'abandoned'; unit.path = [];
                return;
            }
        }
    }
    if (unit._unmanned) { unit._ai = 'abandoned'; unit.path = []; return; }
    // Armor within reach: stay in action, trails down, muzzle on the threat.
    if (armor && d <= reach * 1.3) {
        unit._holdDeployedUntil = now + 1.2;
        unit._ai = enemy ? 'engage' : 'alert';
        unit.path = [];
        if (!enemy) faceToward(armor.x, armor.z);
        return;
    }
    if (enemy) { unit._ai = 'engage'; unit.path = []; return; }
    // Fall back to the rally only when no armor is around to catch a limbered piece.
    if (posture === 'fallback' && !armor) {
        unit._ai = 'retreat';
        unit.retreating = true;
        if (threatPos) unit._retreatThreat = { x: threatPos.x, z: threatPos.z };
        const rally = unit._rally || unit.holdPoint || { x: unit.x, z: unit.z };
        if (Game.dist(unit.x, unit.z, rally.x, rally.z) > 3 && (!unit.path || !unit.path.length)) {
            unit.path = planPath(rally.x, rally.z);
        }
        return;
    }
    if (threatPos) {
        unit._ai = 'alert';
        faceToward(threatPos.x, threatPos.z);
        unit.path = [];
        return;
    }
    // Quiet. Creep back to the post only when displaced well off it: a small
    // shove must not buy a limber/deploy cycle.
    unit._ai = 'hold';
    if (unit.holdPoint && Game.dist(unit.x, unit.z, unit.holdPoint.x, unit.holdPoint.z) > 6
        && (!unit.path || !unit.path.length)) {
        unit.path = planPath(unit.holdPoint.x, unit.holdPoint.z);
    }
};

// ═══════════════════════════════════════════════════════
//  PER-UNIT AI
// ═══════════════════════════════════════════════════════

Game.updateAI = (unit, dt, enemy) => {
    unit.thinking -= dt;
    if (unit.thinking > 0) return;
    unit.thinking = Game.rand(0.25, 0.5);
    if (unit._infantryAction) return;
    if (enemy && !Game.unitCanSee(unit, enemy)) enemy = null;
    unit.retreating = false; // re-asserted below only while actually falling back

    const now = Game.gameClock;
    const isVeh = Game.isTank(unit.kind);
    const isFoot = Game.isFootInfantry(unit);
    const isGun = !!unit.deployable;
    const supp = unit.suppressionValue || 0;
    const hpPct = unit.hp / unit.maxHp;
    const inCover = Game.positionCover(unit) >= Game.COVER_MIN;
    const posture = unit._squadPosture || 'hold';
    const role = unit._role || 'fire';

    // Threat memory. A live sighting refreshes it; so does a remembered SHOOTER
    // that is still alive and in view (or a tank close enough to hear), so the
    // memory follows a moving tank instead of the spot it fired from 8 s ago.
    if (enemy) {
        unit._lastThreat = { x: enemy.x, z: enemy.z }; unit._threatTime = now; unit._threatUnit = enemy;
    } else {
        const tu = unit._threatUnit;
        if (tu && tu.alive && tu.team !== unit.team
            && ((Game.isTank(tu.kind) && Game.distSq(unit.x, unit.z, tu.x, tu.z) < 14 * 14) || Game.unitCanSee(unit, tu))) {
            unit._lastThreat = { x: tu.x, z: tu.z }; unit._threatTime = now;
        }
    }
    const threatPos = enemy
        ? enemy
        : (unit._lastThreat && (now - (unit._threatTime || 0) < 8) ? unit._lastThreat : null);

    // Stance is a REQUEST to the posture resolver (uMod.posture), merged with
    // the suppression floors once per frame. Writing unit.stance directly from
    // a think tick fought the per-frame morale writes: run/crouch flicker.
    const setStance = (s) => { if (isFoot) Game.wantStance(unit, s, 'ai', 1.1); };
    // Facing requests are damped: a defender whose squad reports a fresh threat
    // bearing every second or two used to swivel toward each one in turn (two
    // to three full turns in a two-minute fight while never moving). A new
    // bearing is adopted only when it differs meaningfully from the current one,
    // or the current one is stale.
    const faceToward = (x, z) => {
        const want = Game.angleTo(unit.x, unit.z, x, z);
        const cur = unit._faceGoal != null ? unit._faceGoal : unit.angle;
        const stale = (now - (unit._faceSetT || -1e9)) > 6;
        if (Math.abs(Game.angleDiff(cur, want)) > (stale ? 0.3 : 0.7)) {
            unit._faceGoal = want;
            unit._faceSetT = now;
        }
    };
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

    // A dash that just ended (seek-cover / shelter / evade path ran out) is
    // remembered so the man does not launch another one from the spot he
    // settled on: he goes to ground and fights from there for a few seconds.
    // (Un-remembered, a crowd-settled man re-dashed every think tick — the
    // hedge ping-pong.)
    const dashing = unit._ai === 'seekcover' || unit._ai === 'shelter' || unit._ai === 'evade';
    if (dashing && (!unit.path || !unit.path.length) && unit._dashEndT == null) unit._dashEndT = now;
    const recentlySettled = unit._dashEndT != null && (now - unit._dashEndT) < 4;
    const startDash = (kind, x, z) => { unit._ai = kind; unit._dashEndT = null; unit.path = planPath(x, z); };

    // ═══ CREW-SERVED GUNS have their own brain ═══
    if (isGun) {
        Game._gunAI(unit, { enemy, threatPos, posture, supp, hpPct, planPath, now });
        return;
    }

    const armor = isFoot ? Game.armorThreatFor(unit, 32) : null;
    const lane = armor ? Game.laneInfo(unit, armor) : null;

    // ── TANK HUNTER (ambush): a foot soldier with a bundle and an enemy tank
    //    right on top of him lobs it (RWM close-assault) — from where he is,
    //    beside the tank's path, never from inside it (a hunter lies in wait on
    //    the flank; a man in the lane gets out first). A man mid-dash keeps
    //    running unless the tank is at arm's length. Facing goes through the
    //    per-frame _faceGoal, not a discrete snap per think tick. ──
    if (isFoot && armor && lane.dist < 7 && !(lane.inLane && lane.closing)) {
        unit._atGrenades = unit._atGrenades ?? 2;
        if (unit._atGrenades > 0 && (unit._atNext == null || now >= unit._atNext)
            && Game.unitCanSee(unit, armor)) {
            const moving = unit.path && unit.path.length;
            if (!moving || lane.dist < 4.5) {
                unit.path = []; unit._ai = 'tankhunt';
                const want = Game.angleTo(unit.x, unit.z, armor.x, armor.z);
                unit._faceGoal = want;
                setStance('crouch');
                if (Math.abs(Game.angleDiff(unit.angle, want)) < 0.3 && Game.spawnThrownGrenade) {
                    unit._atGrenades--;
                    unit._atNext = now + Game.rand(2.5, 4.5);
                    Game.spawnThrownGrenade(unit.x, unit.z,
                        armor.x + Game.rand(-0.6, 0.6), armor.z + Game.rand(-0.6, 0.6),
                        { type: 'at', dmg: 45, blastR: 2.2, supp: 18, arc: 1.4 });
                }
                return;
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
        let rally = unit._rally || unit.holdPoint || { x: unit.x, z: unit.z };
        // Never run down the barrel: a man falling back through a tank's lane
        // clears it sideways first, then makes for the rally — and a rally that
        // itself lies in the tank's path is no rally: he holds off-axis instead.
        if (isFoot && armor && lane.inLane && lane.closing
            && (unit._retreatLeg !== 'exit' || !unit.path || !unit.path.length)) {
            const spot = Game.planArmorEvasion(unit, armor);
            unit._retreatLeg = 'exit';
            unit._evadePlan = { tankId: armor.id, until: now + 6 };
            unit._evadeUntil = now + 1.2;
            unit.path = planPath(spot.x, spot.z);
            setStance('run');
            return;
        }
        if (isFoot && armor && lane.closing && Game.pointInLane(rally.x, rally.z, armor, 1.5)) {
            if (!unit._retreatSpot || Game.pointInLane(unit._retreatSpot.x, unit._retreatSpot.z, armor, 1.5)) {
                unit._retreatSpot = Game.planArmorEvasion(unit, armor);
            }
            rally = unit._retreatSpot;
        }
        if (unit._retreatLeg === 'exit' && unit.path && unit.path.length) {
            unit._evadeUntil = now + 1.2;
            setStance('run');
            return;
        }
        // Panic: a broken, heavily-suppressed soldier with no officer near may bolt
        // in a random direction instead of an orderly fall-back (RWM moralerndmove).
        if (isFoot && !unit._steadied && supp > 70 && Game.rand(0, 1) < 0.08 && threatPos) {
            // Commit to ONE bolt direction until it's spent — re-rolling a fresh
            // random direction every think tick had the panicking man swivelling
            // on the spot instead of running anywhere.
            if (!unit.path || !unit.path.length) {
                const away = Game.angleTo(threatPos.x, threatPos.z, unit.x, unit.z) + Game.rand(-0.8, 0.8);
                const gx = Game.clamp(unit.x + Math.cos(away) * 6 * Game.TILE, 1, Game.WORLD_W - 1);
                const gz = Game.clamp(unit.z + Math.sin(away) * 6 * Game.TILE, 1, Game.WORLD_H - 1);
                unit._retreatLeg = 'bolt';
                unit.path = planPath(gx, gz);
            }
            setStance('run');
            return;
        }
        const atRally = Game.dist(unit.x, unit.z, rally.x, rally.z) <= 3;
        if (!atRally && (!unit.path || !unit.path.length)) {
            unit._retreatLeg = 'rally';
            unit.path = planPath(rally.x, rally.z);
        }
        // Sprint to the rally (infantry; no-op for vehicles). Once there, a
        // broken squad goes to ground rather than standing about in a sprint
        // stance waiting for the posture to lift.
        if (atRally && (!unit.path || !unit.path.length)) {
            setStance(supp > 45 ? 'prone' : 'crouch');
            if (isFoot && threatPos) faceToward(threatPos.x, threatPos.z);
        } else {
            setStance('run');
        }
        return;
    }
    unit._retreatLeg = null;
    unit._retreatSpot = null;

    // ── EVADE: standing in an approaching tank's lane — out of it, sideways,
    //    to cover if there is any off the axis. Committed until the dash is
    //    spent, whatever the suppression says: a pinned man in a tank's path
    //    gets up and scrambles too. ──
    if (isFoot && armor && lane.inLane && lane.closing) {
        unit._evadeUntil = now + 1.2;        // posture: on his feet, whatever the suppression
        if (unit._ai === 'evade' && unit.path && unit.path.length) { setStance('run'); return; }
        const spot = Game.planArmorEvasion(unit, armor);
        startDash('evade', spot.x, spot.z);
        unit._evadePlan = { tankId: armor.id, until: now + 6 };
        setStance('run');
        return;
    }

    // ── PINNED: heavy suppression — go prone, crawl to the nearest cover.
    //    Sticky: once pinned he stays down until the fire slackens well below
    //    the break point (alternating pinned/react around one threshold had
    //    men popping prone-crouch-prone under a steady MG). ──
    const pinned = isFoot && (supp > 75 + steady || (unit._ai === 'pinned' && supp > 55 + steady));
    if (pinned) {
        unit._ai = 'pinned';
        setStance('prone');
        if (inCover && !dashing) {
            // (a dash in progress is not cancelled by a prone-inflated "in cover")
            unit.path = [];
        } else if (threatPos && !recentlySettled && (!unit.path || !unit.path.length)) {
            // One crawl plan, followed to the end — not re-planned every tick.
            const cov = Game.findCoverPosition(unit, threatPos.x, threatPos.z,
                armor ? { lane: armor, rings: 8 } : { rings: 8 });
            if (cov) unit.path = planPath(cov.x, cov.z);
        }
        return;
    }

    // ── COMMIT to an in-progress dash: a man half-way to a wall must not
    //    have the dash cancelled because this tick happens to judge him "in
    //    cover" or the threat blinked — the cancel/replan cycle left men
    //    twitching in circles between refuges. He keeps going (still shooting;
    //    fire isn't gated on being halted) and re-evaluates once he arrives. ──
    if (isFoot && dashing && unit.path && unit.path.length) {
        // Sprint the open ground, drop to a crouch for the last couple of
        // meters (suppression can still force him lower via the posture floors —
        // except on an evade, where getting out of the lane comes first).
        const wp = unit.path[unit.path.length - 1];
        if (unit._ai === 'evade') unit._evadeUntil = now + 1.2;
        setStance(Game.dist(unit.x, unit.z, wp.x, wp.z) > 2.5 ? 'run' : 'crouch');
        return;
    }

    // ── ARMOR NEARBY, off its axis: hold what you have. In cover: stay low and
    //    keep fighting soft targets from it. In the open: one dash to off-axis
    //    cover if any is close, else go to ground where he stands and lie
    //    still — a man upright or jogging about inside a tank MG's arc is a
    //    dead man, and a moving target draws the gunner's eye. ──
    if (isFoot && armor && lane.dist < 26) {
        if (inCover) {
            unit._ai = 'alert'; unit.path = [];
            setStance(supp > 35 ? 'prone' : 'crouch');
            if (!enemy) faceToward(armor.x, armor.z);
            return;
        }
        if (!recentlySettled) {
            // How far he can afford to run: the closer the tank, the shorter the dash.
            const receding = lane.ahead < -armor.size;
            const reach = receding ? 24 : Math.min(18, lane.dist * 0.65);
            const cov = Game.findCoverPosition(unit, armor.x, armor.z, { lane: armor, rings: receding ? 10 : 8 });
            if (cov && Game.dist(unit.x, unit.z, cov.x, cov.z) < reach) {
                startDash('seekcover', cov.x, cov.z);
                setStance('run');
                return;
            }
        }
        unit._ai = 'goground'; unit.path = [];
        setStance('prone');
        if (!enemy) faceToward(armor.x, armor.z);
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
    if (Game.followSquadBound(unit)) return;
    if (isFoot && threatPos && !inCover && role !== 'maneuver'
        && (enemy || supp > 15 || unit.underFire > 0)) {
        // Face the fire even from an unseen shooter — via the per-frame facing
        // goal (a discrete turn step per think tick read as jerky small turns).
        if (!enemy) {
            faceToward(threatPos.x, threatPos.z);
        }
        if (recentlySettled) {
            // Just arrived somewhere and still exposed: fight from the dirt rather
            // than dash again straight away.
            unit._ai = 'pinned'; unit.path = [];
            setStance((supp > 25 || unit.underFire > 0) ? 'prone' : 'crouch');
            return;
        }
        // Candidate refuges: terrain cover, and the far side of a friendly tank.
        let refuge = Game.findCoverPosition(unit, threatPos.x, threatPos.z, armor ? { lane: armor, rings: 8 } : { rings: 8 });
        let kind = refuge ? 'seekcover' : '';
        const tank = Game.nearestFriendlyTank(unit, 20);
        // Mobile cover only behind a hull that is actually standing still — a
        // refuge that drives off is a dash to nowhere.
        if (tank && (tank.currentSpeed || 0) < 0.5 && !(tank.path && tank.path.length)) {
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
            startDash(kind, refuge.x, refuge.z);
            // Break for it at a sprint; the dash-commit block above manages the
            // stance for the rest of the run and he crouches on arrival.
            setStance(Game.dist(unit.x, unit.z, refuge.x, refuge.z) > 2.5 ? 'run' : 'crouch');
        } else {
            // Nothing close — go to ground and fight from the dirt; crawl clear if
            // pinned by SMALL ARMS. Not from a tank: "away from the threat" is
            // straight down its barrel, and a man crawling along a tank's axis is
            // simply run down; he lies still off-axis instead (the evade branch
            // has already moved him out of the lane if he was in it).
            unit._ai = 'pinned';
            setStance((supp > 25 || unit.underFire > 0) ? 'prone' : 'crouch');
            if (supp > 55 && !armor && (!unit.path || !unit.path.length)) {
                const away = Game.angleTo(threatPos.x, threatPos.z, unit.x, unit.z);
                const gx = Game.clamp(unit.x + Math.cos(away) * 4 * Game.TILE, 1, Game.WORLD_W - 1);
                const gz = Game.clamp(unit.z + Math.sin(away) * 4 * Game.TILE, 1, Game.WORLD_H - 1);
                unit.path = planPath(gx, gz);
            } else if (supp <= 55 || armor) {
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
            unit._faceGoal = null;                // the fire module lays the gun now
            unit.path = [];                       // halt and fire from here
            return;
        }
        const mobile = unit.aiState === 'attack' || unit.aiState === 'patrol' || posture === 'attack';
        if (mobile) {
            // Re-plan only when idle or the target has shifted well away from the
            // last anchor — never every think tick.
            const shifted = !unit._fpAnchor
                || Game.distSq(unit._fpAnchor.x, unit._fpAnchor.z, enemy.x, enemy.z) > 36;
            if ((!unit.path || !unit.path.length || shifted) && now >= (unit._fpRetryAt || 0)) {
                unit._fpAnchor = { x: enemy.x, z: enemy.z };
                unit._fpRetryAt = now + 2.5;
                // Maneuver element presses to a closer band; base of fire stands off.
                const fp = Game.findFiringPosition
                    ? Game.findFiringPosition(unit, enemy, { standoff: role === 'maneuver' ? 0.55 : 0.75 })
                    : null;
                // No safe firing position is not an instruction to charge the
                // target's centre. Hold the last route and retry at a bounded
                // cadence as sight lines and traffic change.
                if (fp) unit.path = planPath(fp.x, fp.z);
                if (!fp || !unit.path.length) unit._fpRetryAt = now + 5;
            }
            unit._ai = 'advance';
            return;
        }
        // Hold garrison without range/LOS: keep the post, stay pointed at him
        // (continuous per-frame facing — no stepwise think-tick turns).
        unit._ai = 'alert';
        faceToward(enemy.x, enemy.z);
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
            setStance((supp > 20 || unit.underFire > 0) ? 'crouch' : 'stand');
        } else {
            // Base of fire / in range: hold position and shoot (combat fires)
            unit._ai = 'engage';
            unit._faceGoal = null;                // the fire module owns the facing now
            unit.path = [];
            // Kneel to shoot; belly-down when rounds are coming back. Standing
            // to fire is for a man who has not been shot at yet.
            setStance(inCover ? 'crouch'
                : ((unit.underFire > 0 || supp > 15) ? 'prone'
                    : (unit._threatTime && (Game.gameClock - unit._threatTime) < 10 ? 'crouch' : 'stand')));
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
        faceToward(threatPos.x, threatPos.z);
        if (isFoot) setStance(supp > 35 ? 'prone' : 'crouch');
        unit.path = [];
        return;
    }

    // ── Gun crew that bailed out: once the shooting has stopped and no armor is
    //    about, walk back and re-man the piece. ──
    if (isFoot && unit._crewOfGunId != null && unit._enterGunId == null
        && (now - (unit._threatTime || -1e9)) > 12 && Game.orderManGun) {
        const gun = Game.getUnitById(unit._crewOfGunId);
        if (gun && gun.alive && gun._unmanned && !gun._towed && (gun._crewAboard || 0) < 2
            && Game.dist(unit.x, unit.z, gun.x, gun.z) < 30 && !Game.armorThreatFor(unit, 40)) {
            Game.orderManGun(gun, [unit], true);
            return;
        }
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
    } else if (unit.holdPoint && (!unit.path || !unit.path.length)) {
        const dHold = Game.dist(unit.x, unit.z, unit.holdPoint.x, unit.holdPoint.z);
        const attackGoal = unit.aiState === 'attack' ? (unit._mokraAttackGoal || unit._attackGoal || null) : null;
        if (attackGoal && Game.dist(unit.x, unit.z, attackGoal.x, attackGoal.z) > 6
            && (unit._attackGoalReplans || 0) < 3) {
            // The fight is over but the objective is not reached: press on
            // (bounded retries so an unreachable goal settles instead of churning).
            unit._attackGoalReplans = (unit._attackGoalReplans || 0) + 1;
            unit.path = planPath(attackGoal.x, attackGoal.z);
            if (!unit.path.length) unit.holdPoint = { x: unit.x, z: unit.z };
        } else if (unit.aiState === 'attack' || (inCover && dHold < 14)) {
            // An attacker holds the ground he has taken (walking back to the
            // map-edge spawn after every fight is no way to press an assault),
            // and a defender who found cover near his post makes it his post
            // instead of strolling back into the open when the memory fades.
            unit.holdPoint = { x: unit.x, z: unit.z };
        } else if (dHold > 3) {
            unit.path = planPath(unit.holdPoint.x, unit.holdPoint.z);
        }
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
            sq.homeRally = sq.rally;
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
            if (e && Game.unitCanSee(u, e)) { freshTime = Game.gameClock; freshThreat = { x: e.x, z: e.z }; }
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
        // Leaving a fall-back needs the squad genuinely calm again (suppression
        // well below the break point, and a few seconds of it): recovering the
        // moment the average dipped under the trigger sent squads
        // retreat->hold->retreat as suppression decayed and rebuilt.
        let candidate;
        const steadied = mem.some(u => u._steadied); // an officer is with the squad
        const breakSupp = steadied ? 82 : 72;
        const inFallback = sq.posture === 'fallback';
        const stillBroken = inFallback && (avgSupp > breakSupp - 27
            || (Game.gameClock - (sq.postureSince || 0)) < 6);
        if (losses >= (steadied ? 0.6 : 0.5) || avgSupp > breakSupp || stillBroken) candidate = 'fallback';
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
            if (candidate === 'fallback' && freshThreat) {
                // Break contact AWAY from the fire, a dozen metres behind the
                // squad, not "back to the post" (which for a holding squad is the
                // very spot it is being shot on). Restored when the squad recovers.
                let cx = 0, cz = 0;
                mem.forEach(u => { cx += u.x; cz += u.z; });
                cx /= strength; cz /= strength;
                const away = Game.angleTo(freshThreat.x, freshThreat.z, cx, cz);
                let spot = null;
                for (let dist = 14; dist >= 6 && !spot; dist -= 4) {
                    const px = Game.clamp(cx + Math.cos(away) * dist, 1, Game.WORLD_W - 1);
                    const pz = Game.clamp(cz + Math.sin(away) * dist, 1, Game.WORLD_H - 1);
                    const t = Game.getTileAtWorld(px, pz);
                    if (t && !t.blocked) spot = { x: px, z: pz };
                }
                if (spot) sq.rally = spot;
            } else if (sq.homeRally) {
                sq.rally = sq.homeRally;
            }
        }
        const posture = sq.posture;

        // Roles: attacking squads split into a base of fire and a maneuver element
        // (bounding overwatch); everyone else forms a base of fire from cover.
        // Crew-served guns are always base of fire: a towed piece never bounds.
        // Roles follow unit id, not array position: a casualty must not re-role
        // the whole squad mid-assault.
        mem.forEach((u) => {
            u._squadPosture = posture;
            u._rally = sq.rally;
            u._role = (posture === 'attack' && (u.id & 1) === 1 && !u.deployable) ? 'maneuver' : 'fire';
        });
        Game.updateSquadManeuver(sq, mem, sightings);
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

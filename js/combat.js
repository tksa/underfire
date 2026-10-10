/**
 * Under Fire — combat.js
 * Shooting, damage calculation, suppression, and armor penetration.
 * Uses Game.WEAPONS for detailed weapon stats and directional armor.
 */

// accept(other): optional filter (e.g. "only targets this weapon can hurt").
Game.nearestEnemy = (unit, accept = null) => {
    let best = null;
    let bestD = Infinity;
    // Player units only AUTO-engage enemies the team has actually spotted (lit in
    // the fog of war). Otherwise units fire at targets the player can't even see
    // (e.g. a mortar shelling an enemy hidden in fog). The AI has no player fog,
    // so it acquires by its own sight + LOS. This gates auto-acquisition only — a
    // player-FORCED target (right-clicked) still engages via its commitment path,
    // and firing itself is still gated by unitCanSee (line of sight).
    const fogGated = unit.team === Game.playerTeam && Game.isFogVisible;
    for (const other of Game.units) {
        if (!other.alive || other.team === unit.team) continue;
        if (fogGated && !Game.isFogVisible(other.x, other.z) && Game.firingSignature(other) === 1) continue;
        if (accept && !accept(other)) continue;
        const d = Game.distSq(unit.x, unit.z, other.x, other.z);
        if (d < bestD && Game.unitCanSee(unit, other)) {
            bestD = d;
            best = other;
        }
    }
    return best;
};

// Can this unit's weapon meaningfully damage the target? Small arms (pen 0)
// bounce off even the weakest plate of real armor, so rifles and MGs must
// never waste rounds on tanks. Soft targets (men, trucks, towed guns, supply
// and fuel vehicles) are always valid.
Game.unitCanHurt = (unit, target) => {
    const weapon = Game.WEAPONS[unit.weaponKey] || {};
    if (weapon.type === 'none') return false;
    const stats = Game.UNIT_STATS[target.statKey] || {};
    const armor = stats.armor;
    if (!armor) return true;
    const weakest = typeof armor === 'number'
        ? armor : Math.min(armor.front || 0, armor.side || 0, armor.rear || 0);
    if (weakest <= 0) return true;
    const pen = Game.getWeaponPenetration
        ? Game.getWeaponPenetration(weapon, Game.RANGE_BAND ? Game.RANGE_BAND.CLOSE : 5)
        : (weapon.penetration ?? unit.penetration ?? 0);
    // Reaching the partial-penetration band on the weakest plate is the
    // minimum bar for a shot to be worth taking at all.
    return pen >= weakest - 10;
};

// Where has there been shooting lately? A short ring of recent shot positions
// so idle logic can tell "quiet sector" from "the fight is sixty metres away".
Game._recentShots = [];
Game.noteCombatAt = (x, z) => {
    const r = Game._recentShots;
    const now = Game.gameClock || 0;
    // Coalesce shots from roughly the same spot so a firing MG is one entry.
    for (const e of r) {
        if (Game.distSq(e.x, e.z, x, z) < 36) { e.t = now; return; }
    }
    r.push({ x, z, t: now });
    if (r.length > 24) r.shift();
};
Game.recentCombatNear = (x, z, radius = 60, within = 25) => {
    const now = Game.gameClock || 0;
    const r2 = radius * radius;
    for (const e of Game._recentShots) {
        if (now - e.t <= within && Game.distSq(e.x, e.z, x, z) <= r2) return true;
    }
    return false;
};

Game.applyShot = (shooter, target) => {
    if (!shooter.alive || !target.alive) return;
    if (Game.friendlyFireBlocker?.(shooter, target)) return;

    // Ammo check
    if (!Game.consumeWeaponRound(shooter)) return;
    if (Game.noteWeaponShot) Game.noteWeaponShot(shooter);
    Game.noteFriendlyFireDirection?.(shooter);
    Game.noteCombatAt(target.x, target.z);
    Game.noteCombatAt(shooter.x, shooter.z);

    const weapon = Game.WEAPONS[shooter.weaponKey] || {};
    const d = Game.dist(shooter.x, shooter.z, target.x, target.z);

    // Get range-band accuracy
    const baseAcc = Game.getWeaponAccuracy
        ? Game.getWeaponAccuracy(weapon, d)
        : (weapon.accuracy?.medium || shooter.accuracy);

    const cover = target.coverBonus;
    // SS4: terrain cover damage reduction
    const targetTile = Game.getTileAtWorld(target.x, target.z);
    const terrainCoverReduction = targetTile ? targetTile.cover : 0;
    const suppressFactor = Game.clamp(1 - shooter.suppressionValue / 150, 0.45, 1);
    const vetBonus = shooter.veterancy * 0.18;
    const xpBonus = (shooter.experience || 0) / 500;  // up to +0.2 at max XP
    const eliteBonus = shooter._eliteCrew ? 0.15 : 0;  // Elite crew accuracy bonus
    const rangePenalty = Game.clamp((d - shooter.range * 0.6) / shooter.range, 0, 0.35);
    let hitChance = (baseAcc + vetBonus + xpBonus + eliteBonus) * suppressFactor * (1 - cover * 0.58) * (1 - rangePenalty);
    // Target stance: crawling soldiers are much harder to hit
    if (target.stance === 'prone') hitChance *= 0.7;
    else if (target.stance === 'crouch') hitChance *= 0.92;
    // A shooter sprinting flat-out can barely aim
    if (shooter.stance === 'run') hitChance *= 0.6;
    if (Game.weaponMotionAccuracy) hitChance *= Game.weaponMotionAccuracy(shooter);

    const isHit = Math.random() <= hitChance;

    let aimX, aimZ;
    if (isHit) {
        // Direct hit: Always aim exactly at the center of mass
        aimX = target.x;
        aimZ = target.z;
    } else {
        // Miss: Scatter around the target
        const randAngle = Math.random() * Math.PI * 2;
        const missDist = Game.rand(0.8, 2.5);
        aimX = target.x + Math.cos(randAngle) * missDist;
        aimZ = target.z + Math.sin(randAngle) * missDist;
    }

    // Use the weapon's local muzzle anchor after synchronizing this frame's
    // pose. A world bounding-box corner is never a reliable barrel tip.
    const isTankShooter = Game.isTank(shooter.kind);
    const crewedGun = Game.GUN_CREWS && Game.GUN_CREWS[shooter.kind];
    const smallArms = ['rifle','sniper','pistol','smg','lmg','hmg','mg','machine','at_rifle'].includes(weapon.type);
    const isHeavyGunShooter = !smallArms && (isTankShooter || (!!crewedGun && shooter.kind !== 'hmg'));
    const fireAngle = shooter.hasTurret ? shooter.turretAngle : shooter.angle;
    const muzzle = Game.getWeaponMuzzle(shooter);
    let muzzleX = muzzle.x, muzzleZ = muzzle.z;
    const muzzleY = muzzle.y;

    // Garrisoned shooter fires from a window: push the muzzle out to the building
    // edge toward the target so the tracer/flash isn't hidden inside the house.
    if (shooter._garrisoned && shooter._garrisonRec) {
        const rec = shooter._garrisonRec;
        const c = Math.cos(fireAngle), s = Math.sin(fireAngle);
        const halfW = (rec.w || 4) / 2, halfD = (rec.d || 4) / 2;
        const tEdge = Math.min(
            Math.abs(c) > 1e-3 ? halfW / Math.abs(c) : 1e9,
            Math.abs(s) > 1e-3 ? halfD / Math.abs(s) : 1e9
        ) + 1.0;
        muzzleX = rec.cx + c * tEdge;
        muzzleZ = rec.cz + s * tEdge;
    }

    // Tracer
    Game.addTracer({
        x: muzzleX, z: muzzleZ, y0: muzzleY,
        y1: (target.y || 0) + (target.stance === 'prone' ? 0.22 : 0.65),
        tx: aimX, tz: aimZ,
        life: 0.12 + d / 80,
        total: 0.12 + d / 80,
        team: shooter.team,
        big: isHeavyGunShooter, weaponType: weapon.type,
        impact: { ...Game.weaponImpactProfile(weapon), angle: fireAngle,
            onArmor: isHit && (Game.isTank(target.kind) || Game.isTruck(target.kind)) },
        mesh: null,
    });

    // Fire SFX (muzzle) + HE impact SFX. Pick by the actual weapon first (so an
    // MG-armed tank rattles instead of booming), falling back to "any vehicle/gun
    // fires a cannon" — which also covers imported units whose kind isn't in the
    // hardcoded tank list and whose synthesized weapon type is cannon/at/aa/gun.
    if (Game.Audio) {
        const wt = weapon.type;
        const isMG = ['lmg', 'hmg', 'smg', 'mg', 'machine'].includes(wt);
        // Foot soldiers never boom like a gun — a crewman's pistol or an AT rifle
        // is still a small-arms crack, even when its w_type came over as "at"/"gun".
        const isBigGun = !isMG && shooter.class !== 'infantry'
            && (['tankgun', 'atgun', 'fieldgun', 'cannon', 'at', 'aa', 'gun', 'howitzer', 'flak'].includes(wt)
                || isTankShooter || shooter.class === 'vehicle');
        if (isMG) {
            Game.Audio.mg(muzzleX, muzzleZ);
        } else if (isBigGun) {
            Game.Audio.cannon(muzzleX, muzzleZ);
        } else if (wt !== 'mortar' && wt !== 'none') {
            Game.Audio.rifle(muzzleX, muzzleZ);
        }

    }

    // Muzzle smoke (at barrel tip)
    Game.smoke.push({
        x: muzzleX,
        z: muzzleZ, baseY: muzzleY,
        r: isHeavyGunShooter ? 0.6 : 0.16,
        life: 0.36, total: 0.36,
        vx: Game.rand(-0.6, 0.6), vz: Game.rand(-1, -0.5),
        mesh: null,
    });

    // Tank recoil + muzzle flash + barrel smoke
    if (isHeavyGunShooter) {
        shooter.recoilTime = 0.001;  // start recoil (counts up in renderer)
        shooter.recoil = Game.recoilForWeapon ? Game.recoilForWeapon(weapon) : null;
        shooter.joltTime = 0.001;    // suspension rock timeline
        shooter.joltDir = fireAngle + Math.PI; // push direction
        
        // Bright muzzle flash at barrel tip
        Game.muzzleFlashes = Game.muzzleFlashes || [];
        Game.muzzleFlashes.push({
            x: muzzleX, z: muzzleZ, y: muzzleY,
            life: 0.1, total: 0.1,
            r: 0.9,
            mesh: null,
        });
        // Lingering barrel smoke cloud
        for (let s = 0; s < 3; s++) {
            Game.smoke.push({
                x: muzzleX + Game.rand(-0.3, 0.3),
                z: muzzleZ + Game.rand(-0.3, 0.3), baseY: muzzleY,
                r: Game.rand(0.4, 0.8),
                life: Game.rand(0.5, 1.0), total: 1.0,
                vx: Math.cos(fireAngle) * Game.rand(0.5, 1.5) + Game.rand(-0.3, 0.3),
                vz: Math.sin(fireAngle) * Game.rand(0.5, 1.5) + Game.rand(-0.3, 0.3),
                mesh: null,
            });
        }
        // Subtle camera shake
        Game.cameraShake = Math.max(Game.cameraShake || 0, 1);
    } else {
        // Small arms retain a brief flash; a tripod MG does not throw the
        // whole carriage backward or shake the camera like a field gun.
        (Game.muzzleFlashes ||= []).push({ x: muzzleX, z: muzzleZ, y: muzzleY,
            life: 0.07, total: 0.07, r: 0.14, mesh: null });
    }

    target.underFire = 0.9;
    // Record where the fire came from so the AI can react even when it can't
    // see the shooter (incoming-fire direction, like real troops). The shooter
    // itself is remembered too, so the AI can keep the memory on a MOVING tank
    // instead of the spot it fired from.
    target._lastThreat = { x: shooter.x, z: shooter.z };
    target._threatTime = Game.gameClock;
    target._threatUnit = shooter;
    target.suppressionValue = Game.clamp(
        target.suppressionValue + (weapon.suppression || shooter.suppression) * 0.7,
        0, 100
    );

    // Alert the target's squad/nearby allies so they react too instead of
    // standing idle while a buddy is hit. Throttled to keep MG fire cheap.
    if (Game.alertAllies && (!target._alertSpread || Game.gameClock - target._alertSpread > 0.6)) {
        target._alertSpread = Game.gameClock;
        Game.alertAllies(target, shooter.x, shooter.z, 16, shooter);
    }

    // HE blast damage (mortars, tank HE)
    if (weapon.heBlast && weapon.heBlast > 1.0) {
        // Splash damage to nearby units
        const blastR = weapon.heBlast;
        Game.units.forEach(u => {
            if (!u.alive || u === target) return;
            const bd = Game.dist(aimX, aimZ, u.x, u.z);
            if (bd < blastR) {
                const falloff = 1 - (bd / blastR);
                u.suppressionValue = Game.clamp(u.suppressionValue + weapon.suppression * falloff * 0.8, 0, 100);
                // Shell splash tells the men where the fire is coming from too;
                // without a bearing they lay in the barrage or dashed against an
                // ancient threat point.
                if (u.team !== shooter.team) {
                    u._lastThreat = { x: shooter.x, z: shooter.z };
                    u._threatTime = Game.gameClock;
                    u._threatUnit = shooter;
                    u.underFire = Math.max(u.underFire || 0, 0.6);
                }
                if (Math.random() < hitChance * falloff * 0.6) {
                    // More damage to unarmored targets
                    const splashMult = (typeof u.armor === 'number' && u.armor === 0) ? 0.7 : 0.3;
                    u.hp -= weapon.damage * falloff * splashMult;
                    u.shaken = 0.3;
                }
            }
        });
    }

    if (isHit) {
        let damage = weapon.damage || shooter.damage;
        let penetrated = true; // unarmored targets always "penetrate"

        // Tank/HE weapons are devastating against unarmored infantry
        const hit = Game.getHitFacing
            ? Game.getHitFacing(target, shooter.x, shooter.z)
            : { facing: 'front', armor: (typeof target.armor === 'number' ? target.armor : 0), obliquity: 0 };
        // Vision doc: 45° obliquity = +20% effective armor
        const targetArmor = hit.armor * (1 + 0.2 * hit.obliquity);

        if (hit.armor === 0 && weapon.heBlast && weapon.heBlast > 0) {
            // HE shells shred infantry — bigger blast = more damage
            damage *= 2.0 + weapon.heBlast * 0.3;
        }

        if (targetArmor > 0) {
            let pen = Game.getWeaponPenetration
                ? Game.getWeaponPenetration(weapon, d)
                : shooter.penetration;

            // Vision doc — side and rear vulnerability bonuses
            if (hit.facing === 'side') pen += 20;
            else if (hit.facing === 'rear') pen += 35;
            if (hit.facing !== 'front' && d <= Game.RANGE_BAND.CLOSE) pen += 10; // point-blank flank

            if (pen >= targetArmor + 15) {
                // Critical penetration — high damage
                damage *= 1.5;
            } else if (pen >= targetArmor) {
                // Good penetration — normal damage
                damage *= 1.0;
            } else if (pen >= targetArmor - 10) {
                // Partial penetration — reduced damage
                damage *= Game.clamp((pen - (targetArmor - 10)) / 10, 0.2, 0.7);
                penetrated = Math.random() < 0.5; // inconsistent partial pens
            } else {
                // Bounce / ricochet — negligible damage + visual spark
                damage *= 0.05;
                penetrated = false;
                // Ricochet spark tracer
                const ricoAngle = Math.atan2(target.z - shooter.z, target.x - shooter.x) + Game.rand(-1.0, 1.0);
                Game.addTracer({
                    x: target.x, z: target.z,
                    tx: target.x + Math.cos(ricoAngle) * 3,
                    tz: target.z + Math.sin(ricoAngle) * 3,
                    life: 0.08, total: 0.08,
                    team: shooter.team, big: false, mesh: null, ricochet: true,
                });
                // Still causes suppression
                target.suppressionValue = Game.clamp(target.suppressionValue + 3, 0, 100);
                if (Game.Audio) Game.Audio.ricochet(target.x, target.z);
            }
        }

        damage *= Game.rand(0.86, 1.14);
        // SS4 terrain cover damage reduction
        damage *= (1 - terrainCoverReduction);
        target.hp -= damage;
        target.shaken = 0.24;
        target.suppressionValue = Game.clamp(
            target.suppressionValue + (weapon.suppression || shooter.suppression) * 0.55,
            0, 100
        );

        // Rounds punching into a loaded transport find the men aboard: each
        // landed hit has a chance to wound or kill a passenger inside.
        if (target._passengers && target._passengers.length && damage > 1) {
            const throughChance = (weapon.heBlast || 0) > 0 ? 0.5 : 0.22;
            if (Math.random() < throughChance) {
                const pid = target._passengers[Math.floor(Math.random() * target._passengers.length)];
                const inf = Game.getUnitById(pid);
                if (inf && inf.alive) {
                    inf.hp -= Game.rand(8, 20);
                    inf.suppressionValue = Game.clamp((inf.suppressionValue || 0) + 30, 0, 100);
                    if (inf.hp <= 0) {
                        inf.hp = 0;
                        inf.alive = false;
                        inf._deathHandled = true;   // died aboard: no body outside
                        inf._noRemnant = true;
                        inf._inVehicle = null;
                        target._passengers = target._passengers.filter(id => id !== pid);
                        if (inf.mesh) inf.mesh.visible = false;
                        if (inf.team === Game.playerTeam) {
                            Game.pushMessage(`${inf.label} was hit inside ${target.label}!`, 2.0);
                        }
                    }
                }
            }
        }

        // Track last attack position
        Game.lastAttackPos = { x: target.x, z: target.z };

        // XP gain for shooter
        shooter.experience = Math.min(100, (shooter.experience || 0) + 2);
        // XP gain for target surviving damage (fastest way to gain XP — SS guide)
        if (target.alive && target.hp > 0) {
            target.experience = Math.min(100, (target.experience || 0) + 4);
        }

        // Component damage for vehicles — only on penetrating hits
        // (vision doc: light gun penetrations often disable before destroying)
        if (Game.isTank(target.kind) && damage > 5 && penetrated) {
            const roll = Math.random();
            if (roll < 0.08 && !target.tracksDisabled) {
                target.tracksDisabled = true;
                target.speed = 0;
                Game.pushMessage(`${target.label} tracks disabled!`, 2.0);
            } else if (roll < 0.15 && !target.engineDamaged) {
                target.engineDamaged = true;
                // SS4: engine damage halves speed AND causes DoT
                const ob = Game.UNIT_STATS[target.statKey];
                if (ob) target.speed = ob.speed * 0.5;
                Game.pushMessage(`${target.label} engine damaged!`, 2.0);
            } else if (roll < 0.20 && !target.turretDamaged) {
                target.turretDamaged = true;
                Game.pushMessage(`${target.label} turret jammed!`, 2.0);
            }
        }

        // Critical HP behavior
        if (target.hp > 0 && target.hp < target.maxHp * 0.1) {
            if (Game.isTank(target.kind)) {
                // Crew abandons vehicle
                target.alive = false;
                target.hp = 0;
                Game.pushMessage(`${target.label} crew bailed out!`, 2.0);
                if (target.mesh) target.mesh.visible = false;
            } else {
                // Infantry hits the dirt: a posture FLOOR for a few seconds (the
                // resolver in uMod.posture applies it). Writing the stance here on
                // every hit strobed prone against the AI's run each time a round
                // landed.
                target._hitFloorUntil = Game.gameClock + 4.0;
            }
        }

        if (target.hp <= 0) {
            target.alive = false;
            target.hp = 0;
            // XP bonus for kill
            shooter.experience = Math.min(100, (shooter.experience || 0) + 8);
            // Death effects
            if (Game.selection.has(target.id)) Game.selection.delete(target.id);
            Game.cameraShake = Math.max(Game.cameraShake, Game.isTank(target.kind) ? 6 : 2);
            if (Game.Audio && Game.isTank(target.kind)) Game.Audio.explosion(target.x, target.z);
            // Doc §9.1: a penetration knock-out is NOT a guaranteed fireball —
            // a modest hit flash here; the aftermath (smoke column, delayed fire,
            // rare cook-off / catastrophic blast) is carried by Game.updateWreckFx.
            if (Game.isTank(target.kind) && Game.addBlastFlash) Game.addBlastFlash(target.x, target.z, 0.9);

            const teamName = target.team === Game.playerTeam ? 'Friendly' : 'Enemy';
            Game.pushMessage(`${teamName} ${target.label} knocked out.`, 1.4);

            if (target.mesh) {
                if (Game.isTank(target.kind)) {
                    target.mesh.visible = false; // Tanks completely explode for now
                } else {
                    // Infantry dies — leave body on battlefield. The corpse pose is
                    // handled ONCE by the renderer's death branch (skinned soldiers
                    // play a death clip; procedural rigs fall over). Flattening the
                    // mesh here too made skinned soldiers play their death animation
                    // rotated 90° — the "rotate and flip" corpse.
                    target.isDeadBody = true;
                    target.speed = 0;
                    target.currentSpeed = 0;
                }
            }
        }
    }
};

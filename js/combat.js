/**
 * Under Fire — combat.js
 * Shooting, damage calculation, suppression, and armor penetration.
 * Uses Game.WEAPONS for detailed weapon stats and directional armor.
 */

Game.nearestEnemy = (unit) => {
    let best = null;
    let bestD = Infinity;
    // Player units only AUTO-engage enemies the team has actually spotted (lit in
    // the fog of war). Otherwise units fire at targets the player can't even see
    // (e.g. a mortar shelling an enemy hidden in fog). The AI has no player fog,
    // so it acquires by its own sight + LOS. This gates auto-acquisition only — a
    // player-FORCED target (right-clicked) still engages via its commitment path,
    // and firing itself is still gated by unitCanSee (line of sight).
    const fogGated = unit.team === Game.TEAM.FRENCH && Game.isFogVisible;
    for (const other of Game.units) {
        if (!other.alive || other.team === unit.team) continue;
        if (fogGated && !Game.isFogVisible(other.x, other.z)) continue;
        const d = Game.distSq(unit.x, unit.z, other.x, other.z);
        if (d < bestD && Game.unitCanSee(unit, other)) {
            bestD = d;
            best = other;
        }
    }
    return best;
};

Game.applyShot = (shooter, target) => {
    if (!shooter.alive || !target.alive) return;

    // Ammo check
    if (shooter.ammo === 0) return;
    if (shooter.ammo > 0) shooter.ammo--;

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

    // Barrel tip position — try to get from actual 3D gun mesh
    const isTankShooter = Game.isTank(shooter.kind);
    const fireAngle = isTankShooter ? (shooter.turretAngle || shooter.angle) : shooter.angle;
    let muzzleX, muzzleZ;

    if (isTankShooter && shooter.mesh?.userData?.turret) {
        // Prefer the explicitly wired gun node; fall back to turret children
        const turret = shooter.mesh.userData.turret;
        const gunNode = shooter.mesh.userData.gunNode || turret.children?.[1] || turret.children?.[0];
        if (gunNode) {
            // Get gun's world bounding box, barrel tip is the farthest edge
            const bbox = new Game.THREE.Box3().setFromObject(gunNode);
            const center = new Game.THREE.Vector3(shooter.x, 0, shooter.z);
            // Pick the corner of the bbox farthest from unit center
            const corners = [
                new Game.THREE.Vector3(bbox.min.x, 0, bbox.min.z),
                new Game.THREE.Vector3(bbox.min.x, 0, bbox.max.z),
                new Game.THREE.Vector3(bbox.max.x, 0, bbox.min.z),
                new Game.THREE.Vector3(bbox.max.x, 0, bbox.max.z),
            ];
            let best = corners[0], bestDist = 0;
            for (const c of corners) {
                const dd = c.distanceTo(center);
                if (dd > bestDist) { bestDist = dd; best = c; }
            }
            muzzleX = best.x;
            muzzleZ = best.z;
        } else {
            muzzleX = shooter.x + Math.cos(fireAngle) * 4.0;
            muzzleZ = shooter.z + Math.sin(fireAngle) * 4.0;
        }
    } else {
        const barrelLen = isTankShooter ? 4.0 : 0.6;
        muzzleX = shooter.x + Math.cos(fireAngle) * barrelLen;
        muzzleZ = shooter.z + Math.sin(fireAngle) * barrelLen;
    }

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

    // Determine terrain damage: tanks cause craters, mortars/AT cause smaller ones, infantry/MG = 0
    let terrainDmg = 0;
    if (isTankShooter) {
        terrainDmg = shooter.size >= 1.0 ? 1.0 : 0.7; // bigger tanks = bigger craters
    } else if (weapon.heBlast && weapon.heBlast > 1.0) {
        terrainDmg = 0.5; // mortars
    } else if (weapon.penetration && weapon.penetration > 20) {
        terrainDmg = 0.3; // AT guns
    }
    // Infantry, MG, HMG, SMG, snipers = 0 (no craters)

    // Tracer
    Game.tracers.push({
        x: muzzleX, z: muzzleZ,
        tx: aimX, tz: aimZ,
        life: 0.12 + d / 80,
        total: 0.12 + d / 80,
        team: shooter.team,
        big: isTankShooter,
        terrainDamage: terrainDmg,
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
            && (['tankgun', 'atgun', 'cannon', 'at', 'aa', 'gun', 'howitzer', 'flak'].includes(wt)
                || isTankShooter || shooter.class === 'vehicle');
        if (isMG) {
            Game.Audio.mg(muzzleX, muzzleZ);
        } else if (isBigGun) {
            Game.Audio.cannon(muzzleX, muzzleZ);
        } else if (wt !== 'mortar' && wt !== 'none') {
            Game.Audio.rifle(muzzleX, muzzleZ);
        }
        if (weapon.heBlast && weapon.heBlast > 1.0) {
            Game.Audio.explosion(aimX, aimZ);
        }
    }

    // Muzzle smoke (at barrel tip)
    Game.smoke.push({
        x: muzzleX,
        z: muzzleZ,
        r: isTankShooter ? 0.6 : 0.3,
        life: 0.36, total: 0.36,
        vx: Game.rand(-0.6, 0.6), vz: Game.rand(-1, -0.5),
        mesh: null,
    });

    // Tank recoil + muzzle flash + barrel smoke
    if (isTankShooter) {
        shooter.recoilTime = 0.001;  // start recoil (counts up in renderer)
        shooter.recoil = Game.recoilForWeapon ? Game.recoilForWeapon(weapon) : null;
        shooter.joltTime = 0.001;    // suspension rock timeline
        shooter.joltDir = fireAngle + Math.PI; // push direction
        
        // Bright muzzle flash at barrel tip
        Game.muzzleFlashes = Game.muzzleFlashes || [];
        Game.muzzleFlashes.push({
            x: muzzleX + Math.cos(fireAngle) * 0.3,
            z: muzzleZ + Math.sin(fireAngle) * 0.3,
            life: 0.1, total: 0.1,
            r: 0.9,
            mesh: null,
        });
        // Lingering barrel smoke cloud
        for (let s = 0; s < 3; s++) {
            Game.smoke.push({
                x: muzzleX + Game.rand(-0.3, 0.3),
                z: muzzleZ + Game.rand(-0.3, 0.3),
                r: Game.rand(0.4, 0.8),
                life: Game.rand(0.5, 1.0), total: 1.0,
                vx: Math.cos(fireAngle) * Game.rand(0.5, 1.5) + Game.rand(-0.3, 0.3),
                vz: Math.sin(fireAngle) * Game.rand(0.5, 1.5) + Game.rand(-0.3, 0.3),
                mesh: null,
            });
        }
        // Subtle camera shake
        Game.cameraShake = Math.max(Game.cameraShake || 0, 1);
    }

    target.underFire = 0.9;
    // Record where the fire came from so the AI can react even when it can't
    // see the shooter (incoming-fire direction, like real troops).
    target._lastThreat = { x: shooter.x, z: shooter.z };
    target._threatTime = Game.gameClock;
    target.suppressionValue = Game.clamp(
        target.suppressionValue + (weapon.suppression || shooter.suppression) * 0.7,
        0, 100
    );

    // Alert the target's squad/nearby allies so they react too instead of
    // standing idle while a buddy is hit. Throttled to keep MG fire cheap.
    if (Game.alertAllies && (!target._alertSpread || Game.gameClock - target._alertSpread > 0.6)) {
        target._alertSpread = Game.gameClock;
        Game.alertAllies(target, shooter.x, shooter.z);
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
                Game.tracers.push({
                    x: target.x, z: target.z,
                    tx: target.x + Math.cos(ricoAngle) * 3,
                    tz: target.z + Math.sin(ricoAngle) * 3,
                    life: 0.08, total: 0.08,
                    team: shooter.team, big: false, mesh: null,
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
                // Infantry hits the dirt
                target.stance = 'prone';
            }
        }

        if (target.hp <= 0) {
            target.alive = false;
            target.hp = 0;
            // XP bonus for kill
            shooter.experience = Math.min(100, (shooter.experience || 0) + 8);
            // Death effects
            Game.smoke.push({
                x: target.x, z: target.z,
                r: target.size + 0.4,
                life: 0.85, total: 0.85,
                vx: Game.rand(-0.3, 0.3), vz: Game.rand(-1.2, -0.5),
                mesh: null,
            });
            Game.craters.push({ x: target.x, z: target.z, r: Game.rand(0.5, 0.9) });
            if (Game.selection.has(target.id)) Game.selection.delete(target.id);
            Game.cameraShake = Math.max(Game.cameraShake, Game.isTank(target.kind) ? 6 : 2);
            if (Game.Audio && Game.isTank(target.kind)) Game.Audio.explosion(target.x, target.z);
            // Doc §9.1: a penetration knock-out is NOT a guaranteed fireball —
            // a modest hit flash here; the aftermath (smoke column, delayed fire,
            // rare cook-off / catastrophic blast) is carried by Game.updateWreckFx.
            if (Game.isTank(target.kind) && Game.addBlastFlash) Game.addBlastFlash(target.x, target.z, 0.9);

            const teamName = target.team === Game.TEAM.GERMAN ? 'Enemy' : 'French';
            Game.pushMessage(`${teamName} ${target.label} knocked out.`, 1.4);

            if (target.mesh) {
                if (Game.isTank(target.kind)) {
                    target.mesh.visible = false; // Tanks completely explode for now
                } else {
                    // Infantry dies — leave body on battlefield
                    target.isDeadBody = true;
                    // Stop any movement or rotation immediately
                    target.speed = 0;
                    target.currentSpeed = 0;
                    
                    // Flatten the mesh to simulate falling to the ground
                    if (target.mesh) {
                        target.mesh.rotation.z = Math.PI / 2;
                        target.mesh.position.y = (target.y || 0) + 0.1;
                    }
                }
            }
        }
    }
};

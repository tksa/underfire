/**
 * Under Fire — renderer.js
 * 3D rendering — syncs game state to Three.js meshes.
 * Manages tracer lines, smoke sprites, selection boxes, and minimap.
 */

/**
 * Sync all unit meshes with game state.
 */
Game.syncUnitMeshes = (dt) => {
    const THREE = Game.THREE;

    Game.units.forEach(unit => {
        if (!unit.mesh) return;
        if (!unit.alive) {
            const ud = unit.mesh.userData;
            // Promote any freshly-dead unit to a battlefield remnant ONCE, no
            // matter what killed it (direct fire, HE/splash, bleed-out, etc.).
            // Infantry leave a body; vehicles leave a charred wreck. Nothing
            // just blinks out of existence.
            if (!unit._deathHandled) {
                unit._deathHandled = true;
                if (ud.selectionRing) ud.selectionRing.visible = false;
                if (ud.healthBar) ud.healthBar.visible = false;
                unit.speed = 0; unit.currentSpeed = 0;
                if (Game.isTank(unit.kind)) {
                    unit._isWreck = true;
                    unit.mesh.traverse(o => {
                        if ((o.isMesh || o.isInstancedMesh) && o.material) {
                            const mats = Array.isArray(o.material) ? o.material : [o.material];
                            mats.forEach(m => {
                                if (m.color) m.color.multiplyScalar(0.28);
                                if ('metalness' in m) m.metalness = 0.1;
                                if ('roughness' in m) m.roughness = 1.0;
                            });
                        }
                    });
                } else {
                    unit.isDeadBody = true;
                    unit.mesh.rotation.z = Math.PI / 2;        // fall over
                    unit.mesh.position.y = (unit.y || 0) + 0.1;
                }
            }
            unit.mesh.visible = true; // corpse / wreck stays on the field
            if (ud.mixer) ud.mixer.update(dt);
            return; // dead remnants skip the rest of the per-frame logic
        }

        // Drive skeletal animation (clip chosen from unit state) + advance mixer
        Game._updateModelAnimation(unit, dt);

        // Hide living enemies in fog of war
        if (unit.team !== Game.TEAM.FRENCH && Game.isFogVisible && !Game.isFogVisible(unit.x, unit.z)) {
            unit.mesh.visible = false;
            return;
        }
        unit.mesh.visible = true;

        // Position
        unit.mesh.position.set(unit.x, unit.y || 0, unit.z);
        // Chassis suspension rocking (underdamped spring bounce from firing)
        if (unit.joltTime > 0 && unit.joltTime < 1.2) {
            const jt = unit.joltTime;
            // Higher decay + higher freq = fast, heavy settling thud instead of long bouncy rocking
            const rockDecay = 7.0; 
            const rockFreq = 18.0;
            const rockEnvelope = Math.exp(-rockDecay * jt) * Math.sin(rockFreq * jt);

            // Subtle 10% size jolt (approx 10cm) instead of exaggerated 35%
            const jDist = (unit.size || 0.8) * 0.10;
            unit.mesh.position.x += Math.cos(unit.joltDir) * jDist * rockEnvelope;
            unit.mesh.position.z += Math.sin(unit.joltDir) * jDist * rockEnvelope;
            // Subtle dip in Y
            unit.mesh.position.y += -0.02 * rockEnvelope;
            
            unit.joltTime += dt;
            if (unit.joltTime >= 1.2) unit.joltTime = 0;
        }

        // Rotation (angle is in 2D math, convert to Y rotation)
        // Use YXZ order so pitch (X) applies in the tank's local frame
        unit.mesh.rotation.order = 'YXZ';
        unit.mesh.rotation.y = -unit.angle + Math.PI / 2;

        // Vehicles: terrain slope tilt + momentum pitch-rock
        if (Game.isTank(unit.kind)) {
            const prevSpeed = unit._prevSpeed || 0;
            const speedDelta = (unit.currentSpeed || 0) - prevSpeed;
            unit._prevSpeed = unit.currentSpeed || 0;

            // Add the firing rock to the momentum pitch rock for organic blending
            const firePitchRock = (unit.joltTime > 0) ?
                (-0.02 * Math.exp(-7.0 * unit.joltTime) * Math.sin(18.0 * unit.joltTime)) : 0;

            const rockImpulse = -speedDelta * 0.05;
            unit._pitchRock = (unit._pitchRock || 0) * 0.95 + rockImpulse;
            unit._pitchRock = Math.max(-0.04, Math.min(0.04, unit._pitchRock));

            // Sample terrain fore/aft and left/right of the hull to align with slopes
            let slopePitch = 0, slopeRoll = 0;
            if (Game.getHeight) {
                const ca = Math.cos(unit.angle), sa = Math.sin(unit.angle);
                const L = unit.size * 1.2, W = unit.size * 0.8;
                const hF = Game.getHeight(unit.x + ca * L, unit.z + sa * L);
                const hB = Game.getHeight(unit.x - ca * L, unit.z - sa * L);
                // local +X side is world (sin a, -cos a) after yaw mapping
                const hR = Game.getHeight(unit.x + sa * W, unit.z - ca * W);
                const hL = Game.getHeight(unit.x - sa * W, unit.z + ca * W);
                slopePitch = Math.atan2(hB - hF, 2 * L); // nose up when front is higher
                slopeRoll = Math.atan2(hR - hL, 2 * W);
            }
            // Smooth so the hull doesn't snap between height samples
            unit._slopePitch = Game.lerp(unit._slopePitch || 0, slopePitch, 0.15);
            unit._slopeRoll = Game.lerp(unit._slopeRoll || 0, slopeRoll, 0.15);

            unit.mesh.rotation.x = unit._slopePitch + unit._pitchRock + firePitchRock;
            unit.mesh.rotation.z = unit._slopeRoll;
        }

        // Turret rotation for tanks (skip if debug-frozen for this unit)
        const dbgFrozen = Game._dbgTankFrozen && Game._dbgTankId === unit.id;
        if (unit.mesh.userData.turret && Game.isTank(unit.kind) && !dbgFrozen) {
            const turretRelative = -(unit.turretAngle - unit.angle);
            const axis = unit.mesh.userData.turretAxis || 'y';
            const base = unit.mesh.userData.turretBaseRot || { x: 0, y: 0, z: 0 };
            // Preserve base rotation, add yaw on turret axis
            unit.mesh.userData.turret.rotation.x = base.x;
            unit.mesh.userData.turret.rotation.y = base.y;
            unit.mesh.userData.turret.rotation.z = base.z;
            unit.mesh.userData.turret.rotation[axis] = base[axis] + turretRelative;

            // Recoil animation (per-caliber spring-damper: sin * exp decay)
            const rc = unit.recoil || { gun: 0.18, head: 0.014, dur: 0.3 };
            if (unit.recoilTime > 0 && unit.recoilTime < rc.dur) {
                const t = unit.recoilTime;
                const decay = 9;    // damping factor
                const freq = 18;    // oscillation frequency
                const envelope = Math.exp(-decay * t) * Math.sin(freq * t);

                // Head/turret rotation kick (subtle, scaled for on-screen legibility)
                const headNode = unit.mesh.userData.headNode;
                if (headNode) {
                    if (unit._headBaseRotX === undefined) unit._headBaseRotX = headNode.rotation.x;
                    headNode.rotation.x = unit._headBaseRotX - rc.head * 4 * envelope;
                }

                // Gun barrel slide along bore axis (the main visible recoil)
                const gunNode = unit.mesh.userData.gunNode;
                // Procedural meshes declare their recoil axis/sign; GLTF fallback is +z
                const recoilAxis = unit.mesh.userData.recoilAxis
                    || (gunNode && gunNode.name === 'Synthetic_Gun' ? 'x' : 'z');
                const recoilSign = unit.mesh.userData.recoilSign
                    ?? (gunNode && gunNode.name === 'Synthetic_Gun' ? -1 : 1);
                if (gunNode) {
                    if (unit._gunBasePos === undefined) unit._gunBasePos = gunNode.position[recoilAxis];
                    gunNode.position[recoilAxis] = unit._gunBasePos + recoilSign * rc.gun * envelope;
                }

                unit.recoilTime += dt;
                if (unit.recoilTime >= rc.dur) {
                    unit.recoilTime = 0;
                    if (gunNode && unit._gunBasePos !== undefined) {
                        gunNode.position[recoilAxis] = unit._gunBasePos; // snap back perfectly
                    }
                    if (headNode && unit._headBaseRotX !== undefined) {
                        headNode.rotation.x = unit._headBaseRotX;
                    }
                }
            }
        }

        // Infantry: articulated stance posing + walk/crawl cycle (smoothly transitioned)
        if (unit.mesh.userData.isInfantry && unit.mesh.userData.rig) {
            Game._applyInfantryPose(unit, dt);
        }

        // Selection ring
        if (unit.mesh.userData.selectionRing) {
            unit.mesh.userData.selectionRing.visible = Game.selection.has(unit.id);
        }

        // Health bar update
        const hb = unit.mesh.userData.healthBar;
        if (hb) {
            const hasAmmo = unit.maxAmmo > 0;
            const ammoRatio = hasAmmo ? Game.clamp(unit.ammo / unit.maxAmmo, 0, 1) : 1;
            const ammoLow = hasAmmo && ammoRatio <= 0.25; // includes empty
            const isSelected = Game.selection.has(unit.id);
            const isDamaged = unit.hp < unit.maxHp;
            const showAll = Game._showAllHealthBars || false;
            // Show the bar when selected, damaged, debug, OR low/out of ammo so
            // players can see at a glance why a unit has stopped shooting.
            hb.visible = isSelected || isDamaged || showAll || ammoLow;

            if (hb.visible) {
                const ratio = Game.clamp(unit.hp / unit.maxHp, 0, 1);
                // Redraw when HP, ammo, or damage state changes (not just HP).
                const key = ratio.toFixed(2) + '|' + (hasAmmo ? ammoRatio.toFixed(2) : 'x')
                    + (unit.tracksDisabled ? 't' : '') + (unit.engineDamaged ? 'e' : '') + (unit.turretDamaged ? 'r' : '');
                if (hb._lastKey !== key) {
                    hb._lastKey = key;
                    const canvas = unit.mesh.userData.healthBarCanvas;
                    const ctx = canvas.getContext('2d');
                    const w = canvas.width;
                    ctx.clearRect(0, 0, w, canvas.height);
                    // ── HP bar (top row) ──
                    const hpH = 7;
                    ctx.fillStyle = 'rgba(0,0,0,0.7)';
                    ctx.fillRect(0, 0, w, hpH);
                    ctx.fillStyle = ratio > 0.6 ? '#4a2' : (ratio > 0.3 ? '#da2' : '#d33');
                    ctx.fillRect(1, 1, Math.round(ratio * (w - 2)), hpH - 2);
                    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
                    ctx.lineWidth = 0.5;
                    ctx.strokeRect(0.5, 0.5, w - 1, hpH - 1);
                    // ── Ammo bar (bottom row), only for units that use ammo ──
                    if (hasAmmo) {
                        const ay = 9, aH = 6;
                        ctx.fillStyle = 'rgba(0,0,0,0.7)';
                        ctx.fillRect(0, ay, w, aH);
                        if (unit.ammo === 0) {
                            // Empty: bright red outline, no fill = unmistakably out
                            ctx.strokeStyle = '#ff3b30';
                            ctx.lineWidth = 1;
                            ctx.strokeRect(0.5, ay + 0.5, w - 1, aH - 1);
                        } else {
                            ctx.fillStyle = ammoRatio <= 0.25 ? '#f5a623' : '#3a8fd0'; // amber low / blue ok
                            ctx.fillRect(1, ay + 1, Math.round(ammoRatio * (w - 2)), aH - 2);
                            ctx.strokeStyle = 'rgba(255,255,255,0.25)';
                            ctx.lineWidth = 0.5;
                            ctx.strokeRect(0.5, ay + 0.5, w - 1, aH - 1);
                        }
                    }
                    unit.mesh.userData.healthBarTex.needsUpdate = true;
                }
            }
        }
    });
};

/**
 * Update tracer effects (3D lines).
 */
Game.updateTracers3D = (dt) => {
    const THREE = Game.THREE;

    for (let i = Game.tracers.length - 1; i >= 0; i--) {
        const tr = Game.tracers[i];
        tr.life -= dt;

        if (tr.life <= 0) {
            if (tr.mesh) {
                Game.effectsGroup.remove(tr.mesh);
                tr.mesh.geometry.dispose();
                tr.mesh.material.dispose();
            }
            
            // Spawn crater based on unit's terrain damage value
            if (tr.terrainDamage > 0 && typeof Game.spawnCrater === 'function') {
                const impactRadius = Game.rand(0.6, 1.0) * tr.terrainDamage;
                const impactDepth = 0.8 * tr.terrainDamage;
                const cx = tr.tx + Game.rand(-0.3, 0.3);
                const cz = tr.tz + Game.rand(-0.3, 0.3);
                Game.spawnCrater(cx, cz, impactRadius, impactDepth);
            }

            Game.tracers.splice(i, 1);
            continue;
        }

        const p = 1 - tr.life / tr.total;
        const cx = Game.lerp(tr.x, tr.tx, p);
        const cz = Game.lerp(tr.z, tr.tz, p);
        const bx = Game.lerp(tr.x, tr.tx, Math.max(0, p - 0.12));
        const bz = Game.lerp(tr.z, tr.tz, Math.max(0, p - 0.12));

        if (!tr.mesh) {
            const tracerY = (Game.getHeight ? Game.getHeight(cx, cz) : 0) + (tr.big ? 0.8 : 0.6);
            const color = tr.big ? 0xffd28c : (tr.team === Game.TEAM.FRENCH ? 0xfff5be : 0xffd6aa);

            if (tr.big) {
                // Tank shell: thick cylinder tracer
                const len = Math.hypot(cx - bx, cz - bz) || 0.3;
                const geo = new THREE.CylinderGeometry(0.06, 0.06, len, 4, 1);
                geo.rotateX(Math.PI / 2); // align along Z
                const mat = new THREE.MeshBasicMaterial({
                    color, transparent: true, opacity: 0.95,
                });
                tr.mesh = new THREE.Mesh(geo, mat);
                // Position at midpoint facing direction
                const midX = (bx + cx) / 2, midZ = (bz + cz) / 2;
                tr.mesh.position.set(midX, tracerY, midZ);
                tr.mesh.lookAt(cx, tracerY, cz);
            } else {
                // Regular tracer: thin line
                const geo = new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(bx, tracerY, bz),
                    new THREE.Vector3(cx, tracerY, cz)
                ]);
                const mat = new THREE.LineBasicMaterial({
                    color, linewidth: 2, transparent: true, opacity: 0.9
                });
                tr.mesh = new THREE.Line(geo, mat);
            }
            Game.effectsGroup.add(tr.mesh);
        } else {
            const tracerY = (Game.getHeight ? Game.getHeight(cx, cz) : 0) + (tr.big ? 0.8 : 0.6);
            if (tr.big && tr.mesh.isMesh) {
                // Update cylinder tracer position and orientation
                const midX = (bx + cx) / 2, midZ = (bz + cz) / 2;
                tr.mesh.position.set(midX, tracerY, midZ);
                tr.mesh.lookAt(cx, tracerY, cz);
                tr.mesh.material.opacity = Game.clamp(tr.life / tr.total * 2, 0, 0.95);
            } else if (tr.mesh.geometry.attributes.position) {
                const positions = tr.mesh.geometry.attributes.position.array;
                positions[0] = bx; positions[1] = tracerY; positions[2] = bz;
                positions[3] = cx; positions[4] = tracerY; positions[5] = cz;
                tr.mesh.geometry.attributes.position.needsUpdate = true;
                tr.mesh.material.opacity = Game.clamp(tr.life / tr.total * 2, 0, 0.9);
            }
        }
    }
};

/**
 * Update tank tracks (fading decals).
 */
Game.updateTracks3D = (dt) => {
    const THREE = Game.THREE;
    if (!Game.trackMarks) return;

    for (let i = Game.trackMarks.length - 1; i >= 0; i--) {
        const tr = Game.trackMarks[i];
        tr.life -= dt;

        if (tr.life <= 0) {
            if (tr.mesh) {
                Game.effectsGroup.remove(tr.mesh);
                tr.mesh.children.forEach(c => {
                    c.geometry.dispose();
                    c.material.dispose();
                });
            }
            Game.trackMarks.splice(i, 1);
            continue;
        }

        if (!tr.mesh) {
            const trackGeo = new THREE.PlaneGeometry(tr.size * 0.35, Math.max(1.5, tr.step || 1.5));
            trackGeo.rotateX(-Math.PI / 2);
            const trackMat = new THREE.MeshBasicMaterial({
                color: 0x221a10, transparent: true, opacity: 0.4, depthWrite: false
            });
            tr.mesh = new THREE.Group();
            
            const left = new THREE.Mesh(trackGeo, trackMat);
            left.position.x = -tr.size * 0.4;
            const right = new THREE.Mesh(trackGeo, trackMat);
            right.position.x = tr.size * 0.4;
            
            tr.mesh.add(left, right);
            
            const trackY = (Game.getHeight ? Game.getHeight(tr.x, tr.z) : 0) + 0.05;
            tr.mesh.position.set(tr.x, trackY, tr.z);
            tr.mesh.rotation.y = -tr.angle + Math.PI / 2;
            
            Game.effectsGroup.add(tr.mesh);
        } else {
            const opacity = (tr.life / tr.total) * 0.4;
            tr.mesh.children.forEach(c => c.material.opacity = opacity);
        }
    }
};

/**
 * Procedural sprite textures for billboard particle effects (no external files).
 */
/**
 * Pick the animation clip name that matches a unit's current state, from
 * whatever clips the loaded model actually provides.
 */
Game._chooseClip = (unit) => {
    const names = unit.mesh && unit.mesh.userData && unit.mesh.userData.clipNames;
    if (!names || !names.length) return null;
    const pick = (list) => list.find(n => names.includes(n));
    const st = unit.stance || 'stand';
    if (unit.moving) return pick(['walk', 'run', 'push', 'move', 'crawl']) || names[0];
    if (unit.fireTargetId != null) {
        return pick(['fire_' + st, 'fire_crouch', 'fire_stand', 'fire_prone', 'fire', 'attack'])
            || pick(['idle']) || names[0];
    }
    return pick(['idle', 'crouch_idle', 'prone_idle']) || names[0];
};

/** Crossfade the model's skeletal animation to the named clip. */
Game._playClip = (unit, name, fade = 0.25) => {
    const ud = unit.mesh && unit.mesh.userData;
    if (!ud || !ud.actions || !name || ud._activeClip === name) return;
    const next = ud.actions[name];
    if (!next) return;
    const prev = ud._activeClip ? ud.actions[ud._activeClip] : null;
    next.enabled = true;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.reset().play();
    if (prev && prev !== next) next.crossFadeFrom(prev, fade, false);
    ud._activeClip = name;
};

/** Choose + crossfade the right clip for a unit, then advance its mixer. */
Game._updateModelAnimation = (unit, dt) => {
    const ud = unit.mesh && unit.mesh.userData;
    if (!ud || !ud.mixer) return;
    if (ud.actions) {
        const want = Game._chooseClip(unit);
        if (want) Game._playClip(unit, want);
    }
    ud.mixer.update(dt);
};

Game._getSmokeTex = () => {
    if (Game._smokeTex) return Game._smokeTex;
    const THREE = Game.THREE;
    const S = 64, c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    // soft round core
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    // billowing lumps for an organic edge
    for (let i = 0; i < 16; i++) {
        const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 16;
        const px = S / 2 + Math.cos(a) * r, py = S / 2 + Math.sin(a) * r;
        const rad = 6 + Math.random() * 10;
        const lg = ctx.createRadialGradient(px, py, 0, px, py, rad);
        lg.addColorStop(0, 'rgba(255,255,255,0.35)');
        lg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = lg;
        ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }
    Game._smokeTex = new THREE.CanvasTexture(c);
    return Game._smokeTex;
};

Game._getFlashTex = () => {
    if (Game._flashTex) return Game._flashTex;
    const THREE = Game.THREE;
    const S = 64, c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,245,1)');
    g.addColorStop(0.25, 'rgba(255,220,140,0.95)');
    g.addColorStop(0.55, 'rgba(255,150,40,0.45)');
    g.addColorStop(1, 'rgba(255,120,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    // radial spikes for a muzzle/blast star
    ctx.strokeStyle = 'rgba(255,235,170,0.8)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.random() * 0.3;
        const len = S / 2 * (0.7 + Math.random() * 0.3);
        ctx.beginPath();
        ctx.moveTo(S / 2, S / 2);
        ctx.lineTo(S / 2 + Math.cos(a) * len, S / 2 + Math.sin(a) * len);
        ctx.stroke();
    }
    Game._flashTex = new THREE.CanvasTexture(c);
    return Game._flashTex;
};

/**
 * Update smoke effects (textured billboard sprites).
 */
Game.updateSmoke3D = (dt) => {
    const THREE = Game.THREE;

    for (let i = Game.smoke.length - 1; i >= 0; i--) {
        const s = Game.smoke[i];
        s.life -= dt;
        s.x += (s.vx || 0) * dt;
        s.z += (s.vz || 0) * dt;
        s.r += dt * 0.6;

        if (s.life <= 0) {
            if (s.mesh) {
                Game.effectsGroup.remove(s.mesh);
                s.mesh.geometry.dispose();
                s.mesh.material.dispose();
            }
            Game.smoke.splice(i, 1);
            continue;
        }

        if (!s.mesh) {
            // Darker for big/explosion puffs, lighter grey for muzzle smoke
            const shade = s.r > 1.2 ? 0x55504a : 0x8a8782;
            const mat = new THREE.SpriteMaterial({
                map: Game._getSmokeTex(),
                color: shade,
                transparent: true,
                opacity: 0.0,
                depthWrite: false,
            });
            mat.rotation = Math.random() * Math.PI * 2;
            s.mesh = new THREE.Sprite(mat);
            s._baseY = (Game.getHeight ? Game.getHeight(s.x, s.z) : 0) + 0.5;
            s.mesh.position.set(s.x, s._baseY, s.z);
            Game.effectsGroup.add(s.mesh);
        }
        {
            const t = s.life / s.total;              // 1 -> 0 over lifetime
            const age = 1 - t;
            s.mesh.position.set(s.x, (s._baseY || 0) + age * 1.8, s.z);
            s.mesh.scale.setScalar(s.r * 2.4);
            const fadeIn = Math.min(1, age / 0.15);  // quick puff-in
            s.mesh.material.opacity = 0.6 * fadeIn * t;
        }
    }

    // Muzzle flashes (bright flash at barrel tip)
    if (Game.muzzleFlashes) {
        for (let i = Game.muzzleFlashes.length - 1; i >= 0; i--) {
            const f = Game.muzzleFlashes[i];
            f.life -= dt;

            if (f.life <= 0) {
                if (f.mesh) {
                    Game.effectsGroup.remove(f.mesh);
                    f.mesh.geometry.dispose();
                    f.mesh.material.dispose();
                }
                Game.muzzleFlashes.splice(i, 1);
                continue;
            }

            if (!f.mesh) {
                const mat = new THREE.SpriteMaterial({
                    map: Game._getFlashTex(),
                    color: 0xffcc66,
                    transparent: true,
                    opacity: 0.95,
                    blending: THREE.AdditiveBlending,
                    depthWrite: false,
                });
                mat.rotation = Math.random() * Math.PI * 2;
                f.mesh = new THREE.Sprite(mat);
                f._baseY = (Game.getHeight ? Game.getHeight(f.x, f.z) : 0) + 0.7;
                f.mesh.position.set(f.x, f._baseY, f.z);
                Game.effectsGroup.add(f.mesh);
            } else {
                const t = f.life / f.total;          // 1 -> 0
                // pop big then snap down
                f.mesh.scale.setScalar(f.r * (2.2 - t * 0.8) * (f.big ? 2.2 : 1));
                f.mesh.material.opacity = t * 0.95;
            }
        }
    }
};

/**
 * Procedurally pose an infantry rig from its stance + movement, with smooth
 * transitions and a walk/crawl leg cycle (stand-in for skeletal animation).
 */
Game._applyInfantryPose = (unit, dt) => {
    const rig = unit.mesh.userData.rig;
    if (!rig) return;
    const st = unit.stance;
    const moving = unit.moving && (unit.currentSpeed || 0) > 0.05;

    // Target pose per stance: rootPitch (whole-body), rootY (hip height),
    // thigh + knee bend, upper-body lean, arm angle.
    let T;
    if (st === 'prone') {
        // body pitched flat; upper-body arched UP (negative) so the head/chest
        // lift to look forward instead of planting the face into the ground.
        T = { rootPitch: 1.3, rootY: 0.0, thigh: 0.05, knee: 0.15, upper: -0.6, arm: -0.35 };
    } else if (st === 'crouch') {
        T = { rootPitch: 0, rootY: -0.14, thigh: 0.85, knee: -1.35, upper: 0.28, arm: -0.7 };
    } else {
        const lean = (st === 'run' && moving) ? 0.22 : 0.05;
        T = { rootPitch: 0, rootY: 0, thigh: 0, knee: 0, upper: lean, arm: -0.65 };
    }

    let p = unit._pose;
    if (!p) p = unit._pose = { ...T };
    const k = Math.min(1, dt * 7);   // ~0.15s transition
    for (const key in T) p[key] = Game.lerp(p[key], T[key], k);

    rig.root.rotation.x = p.rootPitch;
    rig.root.position.y = p.rootY;
    rig.upper.rotation.x = p.upper;
    rig.armL.rotation.x = p.arm;
    rig.armR.rotation.x = p.arm - 0.15;

    // Walk / crawl cycle: legs swing out of phase; subtle body bob
    let swing = 0;
    if (moving) {
        const freq = st === 'run' ? 13 : (st === 'prone' ? 6 : 9);
        const amp = st === 'prone' ? 0.25 : (st === 'crouch' ? 0.4 : (st === 'run' ? 0.7 : 0.5));
        const ph = (Game.gameClock || 0) * freq + unit.id * 1.7;
        swing = Math.sin(ph) * amp;
        rig.root.position.y = p.rootY + Math.abs(Math.sin(ph)) * 0.03;
        // arms counter-swing a touch when not aiming forward
        rig.armL.rotation.x = p.arm - swing * 0.4;
        rig.armR.rotation.x = p.arm - 0.15 + swing * 0.4;
    }
    rig.legL.rotation.x = p.thigh + swing;
    rig.legR.rotation.x = p.thigh - swing;
    rig.kneeL.rotation.x = p.knee;
    rig.kneeR.rotation.x = p.knee;
};

/**
 * Deform terrain mesh to create a real crater indent.
 * Modifies vertex positions of Game.terrainMesh geometry directly.
 * 
 * @param {number} wx - World X position of impact
 * @param {number} wz - World Z position of impact
 * @param {number} radius - Crater radius in world units
 * @param {number} depth - How deep to push vertices down
 */
Game.spawnCrater = (wx, wz, radius, depth) => {
    if (!Game.terrainMesh) return;
    
    const geo = Game.terrainMesh.geometry;
    const pos = geo.attributes.position;
    const col = geo.attributes.color;
    
    // Terrain mesh is centered at (WORLD_W/2, 0, WORLD_H/2)
    const localX = wx - Game.WORLD_W / 2;
    const localZ = wz - Game.WORLD_H / 2;
    
    // Keep radius tight but restore full depth
    const craterRadius = radius * 0.6;
    const craterDepth = depth;
    
    // Scorch radius: wide enough for vertex density but not huge
    const scorchRadius = Math.max(2.0, craterRadius * 2.0);
    let changed = false;
    
    for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i);
        const vz = pos.getZ(i);
        
        const dx = vx - localX;
        const dz = vz - localZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        
        // Physical deformation (bowl + rim)
        if (dist <= craterRadius) {
            const t = dist / craterRadius;
            const bowl = Math.pow(Math.cos(t * Math.PI * 0.5), 2.0);
            const rim = Math.pow(Math.max(0, 1 - Math.abs(t - 0.82) / 0.18), 2.0);
            const noise = 0.85 + Math.sin(vx * 13.7 + vz * 7.3) * 0.15;
            const deltaY = (-craterDepth * bowl + craterDepth * 0.15 * rim) * noise;
            pos.setY(i, pos.getY(i) + deltaY);
            changed = true;
        }
        
        // Scorch darkening (wider than crater, darkest at center).
        // Floor kept well above black so the surface stays matte — near-black
        // diffuse made the fixed specular response read as a wet sheen.
        if (dist <= scorchRadius && col) {
            const st = dist / scorchRadius; // 0 at center, 1 at edge
            const darkFactor = 0.42 + 0.58 * Math.pow(st, 1.6);
            // multiply toward the darkest reached so repeated hits don't go black
            col.setXYZ(i,
                Math.max(col.getX(i) * darkFactor, 0.18),
                Math.max(col.getY(i) * darkFactor, 0.15),
                Math.max(col.getZ(i) * darkFactor, 0.12));
            changed = true;
        }
    }
    
    if (changed) {
        pos.needsUpdate = true;
        if (col) col.needsUpdate = true;
        geo.computeVertexNormals();
        geo.attributes.normal.needsUpdate = true;
    }
};

/**
 * Draw selection box as a CSS overlay.
 */
Game.updateSelectionBox = () => {
    const box = Game.hud.selectionBox;
    if (!box) return;
    if (!Game.mouse.down) {
        box.style.display = 'none';
        return;
    }
    const x = Math.min(Game.mouse.dragStartX, Game.mouse.dragCurrentX);
    const y = Math.min(Game.mouse.dragStartY, Game.mouse.dragCurrentY);
    const w = Math.abs(Game.mouse.dragStartX - Game.mouse.dragCurrentX);
    const h = Math.abs(Game.mouse.dragStartY - Game.mouse.dragCurrentY);
    if (w < 3 || h < 3) {
        box.style.display = 'none';
        return;
    }
    box.style.display = 'block';
    box.style.left = x + 'px';
    box.style.top = y + 'px';
    box.style.width = w + 'px';
    box.style.height = h + 'px';
};

/**
 * Update minimap (2D canvas).
 */
Game.updateMinimap = () => {
    const canvas = Game.hud.minimapCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    const TILE_COLORS_2D = {
        grass: '#768a4a', pasture: '#8a9a52', wheat: '#c2a85a', stubble: '#c9b884',
        plowed: '#8a6948', vineyard: '#76884a', garden: '#88965a', orchard: '#6e8046',
        road: '#b09468', mud: '#6e5a42', forest: '#46582f', dense_forest: '#36462a',
        house: '#8b8075', wall: '#8b8075', hedge: '#3a5c2e', yard: '#bcab84',
        water: '#4a6e74', swamp: '#5a5e44'
    };

    // Terrain layer is static — render it once to an offscreen cache
    if (!Game._minimapCache) {
        const cache = document.createElement('canvas');
        cache.width = w;
        cache.height = h;
        const cctx = cache.getContext('2d');
        cctx.fillStyle = '#202831';
        cctx.fillRect(0, 0, w, h);
        for (let ty = 0; ty < Game.MAP_ROWS; ty++) {
            for (let tx = 0; tx < Game.MAP_COLS; tx++) {
                const t = Game.terrain[ty]?.[tx];
                if (!t) continue;
                cctx.fillStyle = TILE_COLORS_2D[t.type] || '#556b44';
                cctx.fillRect(tx / Game.MAP_COLS * w, ty / Game.MAP_ROWS * h,
                    Math.ceil(w / Game.MAP_COLS), Math.ceil(h / Game.MAP_ROWS));
            }
        }
        Game._minimapCache = cache;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(Game._minimapCache, 0, 0);

    // Fog overlay — reuse the fog texture canvas (black with alpha)
    if (Game._fogCanvas) {
        ctx.drawImage(Game._fogCanvas, 0, 0, w, h);
    }

    // Units (hide enemies in fog)
    Game.units.filter(u => u.alive).forEach(u => {
        // Don't show enemies in fog
        if (u.team !== Game.TEAM.FRENCH && Game.isFogVisible && !Game.isFogVisible(u.x, u.z)) return;
        ctx.fillStyle = u.team === Game.TEAM.FRENCH ? '#9cc9ff' : '#d7dc9c';
        const px = (u.x / Game.WORLD_W) * w;
        const py = (u.z / Game.WORLD_H) * h;
        ctx.fillRect(px - 2, py - 2, 4, 4);
    });

    // Camera viewport
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    const camViewW = Game.cam.zoom * 2 * (Game.viewW / Game.viewH);
    const camViewH = Game.cam.zoom * 2;
    const cx = (Game.cam.x / Game.WORLD_W) * w - (camViewW / Game.WORLD_W * w) / 2;
    const cz = (Game.cam.z / Game.WORLD_H) * h - (camViewH / Game.WORLD_H * h) / 2;
    ctx.strokeRect(cx, cz, (camViewW / Game.WORLD_W) * w, (camViewH / Game.WORLD_H) * h);
};

/**
 * Update HUD panels.
 */
Game.updateHUD = () => {
    // Pause banner
    const pauseBanner = document.getElementById('pauseBanner');
    if (pauseBanner) {
        pauseBanner.style.display = Game._paused ? 'block' : 'none';
    }

    // Crawl button reflects prone state of selected infantry
    const proneBtn = document.getElementById('cmdProne');
    if (proneBtn) {
        const inf = Game.selectedPlayerUnits().filter(u => !Game.isTank(u.kind));
        const proneActive = inf.length > 0 && inf.every(u => u.stance === 'prone');
        proneBtn.classList.toggle('active', proneActive);
    }

    // Status pill
    if (Game.hud.statusPill) {
        Game.hud.statusPill.textContent = Game.missionState.won
            ? 'Mission accomplished'
            : (Game.missionState.lost
                ? 'Mission failed'
                : `Elapsed ${Game.formatTime(Game.missionState.timer)} • ${Game.selectedPlayerUnits().length} selected`);
    }

    // Mission panel
    if (Game.hud.missionPanel) {
        const enemyAlive = Game.getTeamUnits(Game.TEAM.GERMAN).length;
        const frenchAlive = Game.getTeamUnits(Game.TEAM.FRENCH).length;
        let status = 'Use cover. German MG fire will pin exposed infantry.';
        if (Game.missionState.won) status = '<span class="win">Mission accomplished</span>';
        else if (Game.missionState.lost) status = '<span class="lose">Mission failed</span>';
        Game.hud.missionPanel.innerHTML = `
      <div class="hud-title">Mission</div>
      <div class="hud-subtitle">Advance to the Dyle line</div>
      <div class="hud-text">Primary: seize the crossroads east of the village.</div>
      <div class="hud-text">French: ${frenchAlive} • Enemy: ${enemyAlive} • ${Game.formatTime(Game.missionState.timer)}</div>
      <div class="hud-status">${status}</div>
    `;
    }

    // Selected panel
    if (Game.hud.selectedPanel) {
        const selected = Game.selectedPlayerUnits();
        if (!selected.length) {
            Game.hud.selectedPanel.innerHTML = `
        <div class="hud-title">Selected</div>
        <div class="hud-text muted">No friendly unit selected.</div>
      `;
        } else if (selected.length === 1) {
            const u = selected[0];
            const hpPct = Math.round(u.hp / u.maxHp * 100);
            const isV = Game.isTank(u.kind);
            const fuelStr = isV ? ` • Fuel ${Math.round(u.fuel)}` : '';
            const hasAmmo = u.maxAmmo > 0;
            const ammoPct = hasAmmo ? Math.round(u.ammo / u.maxAmmo * 100) : 100;
            const ammoOut = hasAmmo && u.ammo === 0;
            const ammoLow = hasAmmo && u.ammo > 0 && ammoPct <= 25;
            const ammoColor = ammoOut ? '#ff5a4d' : (ammoLow ? '#f5a623' : '#6fd06f');
            const statusFlags = [];
            if (u.tracksDisabled) statusFlags.push('⚠ TRACKS');
            if (u.engineDamaged) statusFlags.push('🔥 ENGINE');
            if (u.turretDamaged) statusFlags.push('⚠ TURRET JAMMED');
            if (ammoOut) statusFlags.push('⛔ OUT OF AMMO — can\'t fire');
            else if (ammoLow) statusFlags.push('⚠ LOW AMMO');
            const ammoText = hasAmmo
                ? `<span style="color:${ammoColor};font-weight:600">Ammo ${u.ammo}/${u.maxAmmo}</span>`
                : 'Ammo —';
            Game.hud.selectedPanel.innerHTML = `
        <div class="hud-title">Selected</div>
        <div class="hud-unit-name">${u.label}</div>
        <div class="hud-text">Move: ${(Game.STANCE_LABEL && Game.STANCE_LABEL[u.stance]) || u.stance} • Fire: ${u.orderMode === 'hold' ? 'hold' : 'fire'} • ${u.behavior || 'defensive'}</div>
        <div class="hud-text">HP ${Math.round(u.hp)} • ${ammoText}${fuelStr} • XP ${Math.round(u.experience || 0)}</div>
        ${statusFlags.length ? `<div class="hud-text" style="color:#ff6b5e;font-weight:600">${statusFlags.join(' &nbsp; ')}</div>` : ''}
        <div class="hud-bar"><div class="hud-bar-fill hp" style="width:${hpPct}%"></div></div>
        ${hasAmmo ? `<div class="hud-bar"><div class="hud-bar-fill" style="width:${ammoPct}%;background:${ammoColor}"></div></div>` : ''}
        <div class="hud-bar"><div class="hud-bar-fill supp" style="width:${Math.round(u.suppressionValue)}%"></div></div>
      `;
        } else {
            const counts = {};
            selected.forEach(u => counts[u.label] = (counts[u.label] || 0) + 1);
            const lines = Object.entries(counts).slice(0, 5).map(([k, v]) => `${k}: ${v}`).join(' • ');
            const avgHp = Math.round(selected.reduce((s, u) => s + u.hp / u.maxHp, 0) / selected.length * 100);
            const armed = selected.filter(u => u.maxAmmo > 0);
            const out = armed.filter(u => u.ammo === 0).length;
            const low = armed.filter(u => u.ammo > 0 && u.ammo <= u.maxAmmo * 0.25).length;
            const ammoWarn = out || low
                ? `<div class="hud-text" style="color:#ff6b5e;font-weight:600">${out ? `⛔ ${out} out of ammo` : ''}${out && low ? ' • ' : ''}${low ? `⚠ ${low} low` : ''}</div>`
                : '';
            Game.hud.selectedPanel.innerHTML = `
        <div class="hud-title">Selected</div>
        <div class="hud-unit-name">${selected.length} units (${avgHp}% avg HP)</div>
        <div class="hud-text">${lines}</div>
        ${ammoWarn}
      `;
        }
    }

    // Objective ring pulse
    if (Game.objectiveRing) {
        const pulse = 0.4 + Math.sin(Game.gameClock * 2.1) * 0.2;
        Game.objectiveRing.material.opacity = pulse;
        Game.objectiveRing.scale.setScalar(1 + Math.sin(Game.gameClock * 1.5) * 0.08);
    }
};

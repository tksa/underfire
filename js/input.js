/**
 * Under Fire — input.js
 * Mouse and keyboard event handlers, selection, player commands.
 * Uses Three.js raycasting for 3D selection.
 */

Game.selectedPlayerUnits = () =>
    Game.units.filter(u => u.alive && u.team === Game.TEAM.FRENCH && Game.selection.has(u.id));

Game.issueCommand = (wx, wz, mode = 'move', unitList = null) => {
    const chosen = unitList || Game.selectedPlayerUnits();
    if (!chosen.length) return;

    // Calculate formation center → target angle for rotation
    let cx = 0, cz = 0;
    chosen.forEach(u => { cx += u.x; cz += u.z; });
    cx /= chosen.length; cz /= chosen.length;
    const angle = Math.atan2(wz - cz, wx - cx);

    const offsets = Game.formationOffsets(chosen.length, 2.5);
    chosen.forEach((unit, i) => {
        // A move order cancels any standing attack/bombard commitment
        unit.forcedTargetId = null;
        unit.bombardX = null; unit.bombardZ = null;
        unit._bombarding = false;
        // Rotate offset to face movement direction
        const rx = offsets[i].x * Math.cos(angle) - offsets[i].z * Math.sin(angle);
        const rz = offsets[i].x * Math.sin(angle) + offsets[i].z * Math.cos(angle);
        const tx = Game.clamp(wx + rx, 1, Game.WORLD_W - 1);
        const tz = Game.clamp(wz + rz, 1, Game.WORLD_H - 1);
        unit.targetX = tx;
        unit.targetZ = tz;
        unit.path = Game.findPath(unit, unit.x, unit.z, tx, tz);
        unit.orderMode = mode === 'hold' ? 'hold' : unit.orderMode;
        unit.moving = true;
        unit.stopTimer = 0;
        unit.orderDelay = Game.commandDelay(unit);
        // Pulsing destination marker where this unit will end up
        Game.spawnOrderMarker(tx, tz);
    });
    Game.pushMessage(mode === 'attack' ? 'Attack-move ordered.' : 'Move ordered.', 1.8);
    if (Game.Audio) {
        const anyTank = chosen.some(u => Game.isTank(u.kind));
        Game.Audio.voice(anyTank ? 'f_tank_move' : 'f_sold_move');
    }

    // Clear preview markers
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
Game.enemyAtWorld = (x, z) => {
    let best = null, bestD = Infinity;
    for (const u of Game.units) {
        if (!u.alive || u.team === Game.TEAM.FRENCH) continue;
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
        if (w.fireType === 'indirect') {
            u.bombardX = target.x; u.bombardZ = target.z;
            u.forcedTargetId = null;
            return;
        }
        u.forcedTargetId = target.id;
        u.bombardX = null; u.bombardZ = null;
        u.orderMode = 'aggressive';
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

    const offsets = Game.formationOffsets(chosen.length, 2.5);
    offsets.forEach(off => {
        const rx = off.x * Math.cos(angle) - off.z * Math.sin(angle);
        const rz = off.x * Math.sin(angle) + off.z * Math.cos(angle);
        const px = Game.clamp(wx + rx, 1, Game.WORLD_W - 1);
        const pz = Game.clamp(wz + rz, 1, Game.WORLD_H - 1);
        const py = Game.getHeight ? Game.getHeight(px, pz) : 0;

        const geo = new THREE.RingGeometry(0.25, 0.4, 12);
        const mat = new THREE.MeshBasicMaterial({
            color: 0x88cc66,
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

Game.setHoldFire = (toggle) => {
    Game.selectedPlayerUnits().forEach(u => u.orderMode = toggle ? 'hold' : 'aggressive');
    Game.pushMessage(toggle ? 'Hold fire set.' : 'Aggressive fire set.', 1.7);
};

Game.handleMouseSelection = () => {
    const mouse = Game.mouse;
    const dx = mouse.dragCurrentX - mouse.dragStartX;
    const dy = mouse.dragCurrentY - mouse.dragStartY;
    const boxW = Math.abs(dx);
    const boxH = Math.abs(dy);

    if (boxW < 4 && boxH < 4) {
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

        // Method 2: Screen-space fallback (if world pick missed)
        if (!picked) {
            let bestScreenDist = 400; // 20px squared
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
                if (Game._commandMode === 'airstrike') {
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
                    const thrower = Game.selectedPlayerUnits().find(u => !Game.isTank(u.kind));
                    if (thrower) Game.throwGrenade(thrower, ground.x, ground.z);
                    Game._commandMode = null;
                } else if (Game._commandMode === 'smoke') {
                    const thrower = Game.selectedPlayerUnits().find(u => !Game.isTank(u.kind));
                    if (thrower) Game.throwSmoke(thrower, ground.x, ground.z);
                    Game._commandMode = null;
                } else if (Game._commandMode === 'rotate') {
                    Game.selectedPlayerUnits().forEach(u => {
                        u.angle = Game.angleTo(u.x, u.z, ground.x, ground.z);
                        u.turretAngle = u.angle;
                    });
                    Game._commandMode = null;
                } else if (Game._commandMode === 'assault') {
                    // Attack command: mortars bombard the spot; everyone else attack-moves.
                    const chosen = Game.selectedPlayerUnits();
                    const indirect = chosen.filter(u =>
                        Game.WEAPONS[u.weaponKey]?.fireType === 'indirect');
                    const movers = chosen.filter(u => !indirect.includes(u));
                    indirect.forEach(u => {
                        u.bombardX = ground.x; u.bombardZ = ground.z;
                        u.forcedTargetId = null;
                    });
                    if (indirect.length) {
                        Game.spawnOrderMarker(ground.x, ground.z, 0xff8844); // orange = bombard
                        Game.pushMessage('Bombarding position!', 1.5);
                    }
                    movers.forEach(u => { u.orderMode = 'assault'; });
                    if (movers.length) Game.issueCommand(ground.x, ground.z, 'attack', movers);
                    Game._commandMode = null;
                } else {
                    // Shift+right-click = queue waypoint
                    if (e.shiftKey) {
                        Game.selectedPlayerUnits().forEach(u => {
                            if (!u.path) u.path = [];
                            u.path.push({ x: ground.x, z: ground.z });
                        });
                        if (Game.selectedPlayerUnits().length) {
                            Game.spawnOrderMarker(ground.x, ground.z);
                        }
                    } else {
                        // Plain right-click: force-fire an enemy under the cursor, else MOVE
                        // everyone (mortars included — bombarding ground is the Attack command).
                        const enemyUnit = Game.enemyAtWorld(ground.x, ground.z);
                        if (enemyUnit) {
                            Game.orderAttackTarget(enemyUnit);
                        } else {
                            Game.issueCommand(ground.x, ground.z, 'attack');
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
    // page/trackpad never scrolls the canvas.
    container.addEventListener('wheel', e => {
        e.preventDefault();
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
                Game.pushMessage('Click target for air strike...', 3.0);
            } else {
                Game.pushMessage('No air strikes available!', 2.0);
            }
        }

        // Assault move (E key)
        if (e.code === 'KeyE') {
            Game._commandMode = 'assault';
            Game.pushMessage('Assault move — right-click target.', 2.0);
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

        // Stop / cancel orders (V key)
        if (e.code === 'KeyV') {
            Game.selectedPlayerUnits().forEach(u => {
                u.path = [];
                u.moving = false;
                u.orderMode = 'hold';
                u.forcedTargetId = null;
                u.bombardX = null; u.bombardZ = null;
                u._bombarding = false;
            });
            Game.pushMessage('Units stopped.', 1.0);
        }

        // Hold fire toggle (H key)
        if (e.code === 'KeyH') {
            Game.selectedPlayerUnits().forEach(u => {
                u.orderMode = u.orderMode === 'hold' ? 'aggressive' : 'hold';
            });
            const first = Game.selectedPlayerUnits()[0];
            if (first) Game.pushMessage(`Fire: ${first.orderMode}`, 1.0);
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

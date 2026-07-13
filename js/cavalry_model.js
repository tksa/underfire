/**
 * Under Fire — mounted Polish cavalry model + state transitions.
 *
 * The supplied GLB is a single in-place horse/rider rig with 17 named clips.
 * This module maps those authored names onto the engine animator, keeps the
 * gait synchronized to measured ground speed, and swaps a reserve Ułan between
 * the mounted GLB and the existing dismounted Polish soldier without replacing
 * any of the Ułans that begin the Mokra battle on foot.
 */

Game.CAVALRY_MODEL_PATH = 'models/polish_mounted_ulan.glb';

Game.CAVALRY_MOVE = Object.freeze({
    acceleration: 3.0,       // world units / s²: walk first, then build to gallop
    braking: 5.2,            // firm but progressive stop; used by v² = 2ad
    walkRunSpeed: 4.6,       // animation gait boundary with hysteresis in renderer
    walkReferenceSpeed: 2.8, // authored clip playback = 1x around this ground speed
    runReferenceSpeed: 7.2,
    minMovingSpeed: 0.12,
    arrivalRadius: 0.65,
});

Game.isCavalryPath = (path) => path === Game.CAVALRY_MODEL_PATH;

const CAVALRY_CLIP_NAMES = Object.freeze({
    Dismount_Left: 'dismount',
    Horse_Collapse_Forward: 'death3',
    Horse_Fall_Left: 'death',
    Horse_Fall_Right: 'death2',
    Horse_Run: 'run',
    Horse_Walk_Slow: 'walk',
    Idle_Standing: 'idle',
    Mount_Left: 'mount',
    Rider_Fall_Back: 'rider_fall_back',
    Rider_Fall_Left: 'rider_fall_left',
    Rider_Fall_Right: 'rider_fall_right',
    Run_Shoot_Backward: 'fire_backward',
    Run_Shoot_Forward: 'fire_forward',
    Run_Shoot_Left: 'fire_left',
    Run_Shoot_Right: 'fire_right',
    Run_Sword_Ready: 'sword_ready',
    Run_Sword_Swing: 'sword_attack',
});

// Clone before renaming: the cached source scene is shared by every horse and
// must retain its authored animation metadata for future clones/reloads.
Game.prepareCavalryAnimations = (sourceClips) => (sourceClips || []).map(source => {
    const clip = source.clone();
    clip.name = CAVALRY_CLIP_NAMES[source.name] || source.name;
    return clip;
});

Game.chooseCavalryClip = (unit, names) => {
    if (!names || !names.length) return null;
    const pick = (...choices) => choices.find(name => names.includes(name));
    const speed = unit._dispSpeed != null ? unit._dispSpeed : (unit.currentSpeed || 0);

    if (unit.fireTargetId != null) {
        const target = Game.getUnitById(unit.fireTargetId);
        if (target) {
            const bearing = Math.atan2(target.z - unit.z, target.x - unit.x);
            const relative = Game.angleDiff(unit.angle || 0, bearing);
            const abs = Math.abs(relative);
            if (abs > Math.PI * 0.72) return pick('fire_backward', 'fire_forward', 'run', 'idle');
            if (abs > Math.PI * 0.22) {
                // Positive game-angle rotation points to the rider's right in the
                // x/z movement plane; negative points left.
                return relative > 0
                    ? pick('fire_right', 'fire_forward', 'run', 'idle')
                    : pick('fire_left', 'fire_forward', 'run', 'idle');
            }
        }
        return pick('fire_forward', 'run', 'idle');
    }

    const moving = speed > (unit.mesh.userData._locoOn ? 0.12 : 0.30);
    unit.mesh.userData._locoOn = moving;
    if (moving) {
        const cfg = Game.CAVALRY_MOVE;
        const running = speed > (unit.mesh.userData._runOn
            ? cfg.walkRunSpeed * 0.82
            : cfg.walkRunSpeed);
        unit.mesh.userData._runOn = running;
        return running ? pick('run', 'walk', 'idle') : pick('walk', 'run', 'idle');
    }
    return pick('idle', 'walk', 'run') || names[0];
};

// Match the in-place cycle to actual displacement. A blocked horse therefore
// slows its legs instead of galloping on the spot, while a full-speed horse does
// not visibly skate across the ground.
Game.updateCavalryAnimationSpeed = (unit) => {
    const ud = unit.mesh && unit.mesh.userData;
    if (!ud || !ud.actions || !ud._activeClip) return;
    const clip = ud._activeClip;
    const isFire = clip.startsWith('fire_');
    if (clip !== 'walk' && clip !== 'run' && !isFire) return;
    const action = ud.actions[clip];
    if (!action) return;
    const speed = unit._dispSpeed != null ? unit._dispSpeed : (unit.currentSpeed || 0);
    const reference = clip === 'walk'
        ? Game.CAVALRY_MOVE.walkReferenceSpeed
        : Game.CAVALRY_MOVE.runReferenceSpeed;
    action.setEffectiveTimeScale(Game.clamp(speed / reference, isFire ? 0.55 : 0.42, 1.65));
};

Game._setCavalryStats = (unit, mounted) => {
    const key = `${unit.team}_${mounted ? 'mounted_ulan' : 'ulan'}`;
    const base = Game.UNIT_STATS[key];
    if (!base) return false;
    const hpRatio = unit.maxHp > 0 ? Game.clamp(unit.hp / unit.maxHp, 0, 1) : 1;
    const weapon = Game.WEAPONS[base.weapon] || {};
    const oldSize = unit.size || base.size;

    unit.kind = base.kind;
    unit.statKey = key;
    unit.label = base.label;
    unit.description = base.description || '';
    unit.class = base.class;
    unit.supportType = base.supportType || null;
    unit.weaponKey = base.weapon;
    unit.secondaryWeaponKey = base.secondaryWeapon || null;
    unit.speed = base.speed;
    unit.maxHp = base.hp;
    unit.hp = Math.max(1, base.hp * hpRatio);
    unit.size = base.size;
    unit.armor = base.armor;
    unit.sight = base.sight;
    unit.rotationSpeed = base.rotationSpeed;
    unit.cost = base.cost || unit.cost || 1;
    unit.range = weapon.fireType === 'indirect'
        ? Math.max((weapon.gameRange || 0) * 1.5, 240)
        : (weapon.gameRange || 12);
    unit.damage = weapon.damage || 10;
    unit.cooldown = weapon.cooldown || 1;
    unit.accuracy = weapon.accuracy?.medium || 0.5;
    unit.suppression = weapon.suppression || 5;
    unit.penetration = typeof weapon.penetration === 'object'
        ? weapon.penetration.medium || 0
        : weapon.penetration || 0;
    unit.stance = 'stand';
    unit._autoStance = false;
    unit._postureOrder = null;
    unit._cavalryMounted = mounted;
    unit._cavalryCanMount = true;
    unit._yellowSlow = false;

    // The outer unit group survives the swap so IDs, selection and references
    // remain stable. Resize its persistent selection ring to the new footprint.
    const ud = unit.mesh && unit.mesh.userData;
    if (ud && ud.selectionRing) {
        if (!unit._cavalryRingBaseRadius) unit._cavalryRingBaseRadius = oldSize + 0.15;
        const desired = unit.size + 0.15;
        ud.selectionRing.scale.setScalar(desired / unit._cavalryRingBaseRadius);
    }
    return true;
};

Game._restoreCavalryOrderMode = (unit) => {
    if (unit._preCavalryOrderMode != null) {
        unit.orderMode = unit._preCavalryOrderMode;
        unit._preCavalryOrderMode = null;
    }
};

Game._playCavalryOneShot = (unit, name, toMounted) => {
    const ud = unit.mesh && unit.mesh.userData;
    const action = ud && ud.actions && ud.actions[name];
    if (!action) return false;
    const previous = ud._activeClip ? ud.actions[ud._activeClip] : null;
    Object.values(ud.actions).forEach(other => {
        if (other !== action && other !== previous) { other.stop(); other.enabled = false; }
    });
    action.reset();
    action.setLoop(Game.THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.enabled = true;
    action.setEffectiveTimeScale(1);
    action.setEffectiveWeight(1);
    action.play();
    if (previous && previous !== action) action.crossFadeFrom(previous, 0.18, false);
    ud._activeClip = name;
    unit._cavalryTransition = {
        phase: 'animating',
        clip: name,
        toMounted,
        remaining: action.getClip().duration + 0.05,
    };
    return true;
};

Game._loadCavalryModeModel = (unit, mounted, playMount = false) => {
    unit._cavalryAwaitingModel = true;
    unit._cavalryPendingMountClip = playMount ? 'mount' : null;
    Game._loadUnitModel(unit, unit.mesh);
};

// Public state setter. The default path plays the authored transitions;
// `{ immediate: true }` is reserved for deterministic tests/editor setup.
Game.setCavalryMounted = (unit, mounted, options = {}) => {
    if (!unit || !unit.alive || !unit._cavalryCanMount
        || unit._cavalryAwaitingModel || unit._cavalryTransition) return false;
    mounted = !!mounted;
    if (unit._cavalryMounted === mounted) return false;

    unit.path = [];
    unit.moving = false;
    unit.forcedTargetId = null;
    unit.fireTargetId = null;
    unit._preCavalryOrderMode = unit.orderMode;
    unit.orderMode = 'hold';

    if (!mounted && !options.immediate) {
        // First brake naturally along the horse's current heading. The transition
        // begins only once it has actually stopped.
        unit._cavalryTransition = { phase: 'braking', toMounted: false };
        return true;
    }

    if (!Game._setCavalryStats(unit, mounted)) return false;
    unit.currentSpeed = 0;
    Game._loadCavalryModeModel(unit, mounted, mounted && !options.immediate);
    return true;
};

// Called by the unit loader after either the cavalry GLB or the shared foot
// soldier has created its mixer/actions.
Game.onCavalryModelLoaded = (unit, path) => {
    if (!unit || !unit._cavalryCanMount) return;
    if (unit._cavalryMounted && !Game.isCavalryPath(path)) {
        // Graceful asset failure: retain a usable dismounted soldier instead of
        // running horse physics on a foot model.
        Game._setCavalryStats(unit, false);
        unit._cavalryPendingMountClip = null;
        unit._cavalryAwaitingModel = false;
        unit._cavalryTransition = null;
        Game._restoreCavalryOrderMode(unit);
        if (!unit._cavalryFallbackWarned && Game.pushMessage) {
            unit._cavalryFallbackWarned = true;
            Game.pushMessage(`${unit.label}: mounted model unavailable; remaining dismounted.`, 2.5);
        }
        return;
    }

    unit._cavalryAwaitingModel = false;
    const pending = unit._cavalryPendingMountClip;
    unit._cavalryPendingMountClip = null;
    if (pending && Game._playCavalryOneShot(unit, pending, true)) return;
    unit._cavalryTransition = null;
    Game._restoreCavalryOrderMode(unit);
};

// Returns true while normal unit simulation should be held. The braking phase
// returns false so the mounted movement module can coast/decelerate naturally.
Game.updateCavalryTransition = (unit, dt) => {
    if (!unit || !unit._cavalryCanMount) return false;
    if (unit._cavalryAwaitingModel) return true;
    const transition = unit._cavalryTransition;
    if (!transition) return false;

    unit.path = [];
    unit.moving = false;
    unit.forcedTargetId = null;
    unit.fireTargetId = null;

    if (transition.phase === 'braking') {
        if ((unit.currentSpeed || 0) > Game.CAVALRY_MOVE.minMovingSpeed) return false;
        unit.currentSpeed = 0;
        if (!Game._playCavalryOneShot(unit, 'dismount', false)) {
            Game._setCavalryStats(unit, false);
            Game._loadCavalryModeModel(unit, false, false);
        }
        return true;
    }

    if (transition.phase === 'animating') {
        transition.remaining -= dt;
        if (transition.remaining > 0) return true;
        if (!transition.toMounted) {
            Game._setCavalryStats(unit, false);
            unit.currentSpeed = 0;
            Game._loadCavalryModeModel(unit, false, false);
            return true;
        }
        unit._cavalryTransition = null;
        Game._restoreCavalryOrderMode(unit);
    }
    return false;
};

Game.toggleSelectedCavalry = () => {
    const selected = Game.selectedPlayerUnits().filter(unit => unit._cavalryCanMount);
    if (!selected.length) {
        Game.pushMessage('Select a cavalry reserve unit to mount or dismount.', 1.6);
        return;
    }
    // A mixed selection converges on one state: if every unit is dismounted,
    // mount them; otherwise dismount the mounted members.
    const targetMounted = selected.every(unit => !unit._cavalryMounted);
    let changed = 0;
    selected.forEach(unit => {
        if (Game.setCavalryMounted(unit, targetMounted)) changed++;
    });
    if (!changed) {
        Game.pushMessage('Cavalry is already changing state.', 1.5);
    } else {
        Game.pushMessage(targetMounted ? 'Cavalry mounting up.' : 'Cavalry dismounting.', 1.8);
    }
};

/**
 * Weapon handling: acquire a sight picture before firing and expose the actual
 * action to animation. Timings are gameplay tuning, not historical weapon stats.
 * Movement orders remain authoritative; a rifleman relocates with his weapon
 * lowered, while an assault order lets engage stop him to take an aimed shot.
 */
Game.resetWeaponAim = (unit, state = 'idle') => {
    unit._aimTargetId = null;
    unit._aimStableFor = 0;
    unit.weaponState = unit._reload ? 'reloading' : state;
};

// Motion disturbs a sight picture immediately; steadiness returns gradually
// after halting. Inspired by the motion/settling distinction in Realism Mod,
// with original tuning for Under Fire's world scale and simulation cadence.
Game.updateWeaponHandling = (unit, dt) => {
    Game.updateMagazine?.(unit, dt);
    if (unit._shotAge != null) unit._shotAge += dt;
    const bearing = unit.hasTurret ? unit.turretAngle : unit.angle;
    const angularSpeed = unit._weaponBearingPrev == null || dt <= 0 ? 0
        : Math.abs(Game.angleDiff(unit._weaponBearingPrev, bearing)) / dt;
    unit._weaponBearingPrev = bearing;
    const speed = Math.max(unit._dispSpeed || 0, unit.currentSpeed || 0);
    const disturbance = Math.min(1, speed / 5 + angularSpeed / 1.5);
    const target = 1 - disturbance;
    const current = unit.weaponSteadiness ?? 1;
    const rate = target < current ? 7 : 1.1;
    unit.weaponSteadiness = current + (target - current) * (1 - Math.exp(-dt * rate));
};

Game.weaponMotionAccuracy = unit => 0.55 + 0.45 * (unit.weaponSteadiness ?? 1);

Game.weaponAimReady = (unit, target, dt, aligned, combatReady = true) => {
    const weapon = Game.WEAPONS[unit.weaponKey] || {};
    const mounted = Game.isMountedCavalry && Game.isMountedCavalry(unit);
    const vehicle = Game.isTank(unit.kind);
    const speed = Math.max(unit.currentSpeed || 0, unit._dispSpeed || 0);
    const relocating = speed > 0.25 || !!(unit.path?.length && unit.moving);
    const runFire = weapon.type === 'smg' && unit.stance !== 'prone'
        && unit.stance !== 'run' && speed < 2.8;
    if (unit._aimTargetId !== target.id) {
        unit._aimTargetId = target.id;
        unit._aimStableFor = 0;
    }
    if (unit.ammo === 0) { Game.resetWeaponAim(unit, 'empty'); return false; }
    if (!Game.weaponCanDischarge(unit)) { Game.resetWeaponAim(unit, unit._reload ? 'reloading' : 'busy'); return false; }
    if (Game.friendlyFireBlocker?.(unit, target)) { Game.resetWeaponAim(unit, 'blocked'); return false; }
    if (!combatReady) { Game.resetWeaponAim(unit, 'deploying'); return false; }
    if (!mounted && !vehicle && relocating && !runFire) {
        Game.resetWeaponAim(unit, 'moving');
        return false;
    }
    // Reacquire after a turn or an interrupted sight picture. A frame of
    // alignment cannot discharge a cannon still swinging across its target.
    const base = vehicle ? 0.35 : unit.deployable ? 0.5 : runFire ? 0.12 : 0.28;
    const settle = base * (1 + (unit.suppressionValue || 0) / 140);
    unit._aimStableFor = aligned ? (unit._aimStableFor || 0) + dt : 0;
    unit.weaponState = unit.cooldownLeft > 0 ? 'cycling'
        : unit._aimStableFor >= settle ? 'ready' : 'aiming';
    return aligned && unit._aimStableFor >= settle && unit.cooldownLeft <= 0;
};

Game.noteWeaponShot = (unit) => {
    unit._lastShotAt = Game.gameClock || 0;
    unit._shotAge = 0;
    unit._shotSerial = (unit._shotSerial || 0) + 1;
    unit.weaponState = 'cycling';
    if (Game.isTank(unit.kind) || (unit.kind !== 'hmg' && Game.GUN_CREWS?.[unit.kind] && unit.mesh?.userData.modelWrapper)) {
        unit.recoilTime = 0.001;
        unit.recoil = Game.recoilForWeapon?.(Game.WEAPONS[unit.weaponKey] || {}) || null;
    }
};

// Attack-ground shares the same finite traverse and aiming gate as unit fire.
// Previously that order snapped the hull and turret to the point in one frame.
Game.aimWeaponAtPoint = (unit, x, z, dt) => {
    if (unit.holdFire || unit._unmanned || unit.ammo === 0) {
        Game.resetWeaponAim(unit, unit.ammo === 0 ? 'empty' : 'idle');
        return false;
    }
    const aim = Game.angleTo(unit.x, unit.z, x, z);
    let heading;
    if (Game.isTank(unit.kind) && unit.hasTurret) {
        const turn = Game.rotateWithInertia(unit.turretAngle, unit.turretAngVel,
            aim, unit.turretRotSpeed, unit.turretAccel, dt);
        unit.turretAngle = turn.angle; unit.turretAngVel = turn.angVel;
        heading = turn.angle;
    } else {
        const rate = unit.deployable ? 0.8 : Game.isTank(unit.kind) ? unit.rotationSpeed * 0.5 : 5;
        unit.angle = Game.rotateTo(unit.angle, aim, rate * dt);
        unit.turretAngle = unit.angle; heading = unit.angle;
    }
    return Game.weaponAimReady(unit, { id: `ground:${x}:${z}` }, dt,
        Math.abs(Game.angleDiff(heading, aim)) < 0.15, !unit.deployable || unit._canFire !== false);
};

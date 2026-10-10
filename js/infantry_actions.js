/** Simulation-owned actions. Renderers display progress; they never create
 * ammunition, release a grenade twice, or finish an action while paused. */
Game.beginGrenadeThrow = (unit, x, z, opts = {}) => {
    if (!unit?.alive || !Game.isFootInfantry(unit) || Game.isMountedCavalry?.(unit)
        || unit._inVehicle != null || unit._infantryAction || (unit.suppressionValue || 0) >= 90) return false;
    const type = opts.type || 'frag';
    const pocket = type === 'smoke' ? '_smokeGrenades' : type === 'at' ? '_atGrenades' : '_grenades';
    unit[pocket] ??= type === 'frag' ? 3 : 2;
    if (unit[pocket] <= 0) return false;
    const range = type === 'at' ? 8.5 : (Game.MAX_THROW || 12);
    const bearing = Game.angleTo(unit.x, unit.z, x, z), distance = Math.min(range, Game.dist(unit.x, unit.z, x, z));
    if (distance < 1) return false;
    unit.path = []; unit.moving = false; unit.currentSpeed = unit._dispSpeed = 0;
    unit._reload = null; unit._supportFire = null;
    const stance = unit.stance === 'prone' ? 'prone' : unit.stance === 'crouch' ? 'crouch' : 'stand';
    unit._infantryAction = { kind: 'grenade', clip: `throw_${stance}`, elapsed: 0, duration: 1.5,
        releaseAt: 0.9, released: false, pocket, bearing,
        x: unit.x + Math.cos(bearing) * distance, z: unit.z + Math.sin(bearing) * distance,
        opts: { ...opts, type }, stance };
    Game.resetWeaponAim(unit, 'throwing');
    return true;
};

Game.beginSupportAction = (unit, target, kind) => {
    if (!unit.alive || !target.alive || unit.team !== target.team || unit._inVehicle != null
        || !['repair', 'treat'].includes(kind) || unit._infantryAction || unit.moving || unit.path?.length || target.moving
        || target._inVehicle != null || (unit.suppressionValue || 0) > 50
        || Game.dist(unit.x, unit.z, target.x, target.z) > (kind === 'repair' ? target.size + 1.5 : 2.2)) return false;
    unit._reload = null;
    unit._infantryAction = { kind: 'support', work: kind, targetId: target.id,
        clip: kind === 'repair' ? 'repair' : 'treat', elapsed: 0, duration: kind === 'repair' ? 4 : 3,
        bearing: Game.angleTo(unit.x, unit.z, target.x, target.z) };
    return true;
};

Game.completeSupportAction = (unit, target, work) => {
    if (work === 'treat') target.hp = Math.min(target.maxHp, target.hp + 8);
    else {
        // Restore mobility before repairing hull damage, one component per job.
        const part = ['tracksDisabled', 'engineDamaged', 'turretDamaged'].find(key => target[key]);
        if (part) {
            target[part] = false;
            const base = Game.UNIT_STATS[target.statKey];
            if (base) target.speed = base.speed * (target.engineDamaged ? 0.5 : 1);
        } else target.hp = Math.min(target.maxHp, target.hp + 5);
    }
    unit.experience = Math.min(100, (unit.experience || 0) + 1);
};

Game.updateInfantryActions = (unit, dt) => {
    const action = unit._infantryAction;
    if (!action) return;
    const interrupted = !unit.alive || unit._inVehicle != null || unit._towed
        || (action.kind === 'getup' && (unit.stance === 'prone' || (unit._evadeUntil || 0) > Game.gameClock))
        || (action.kind !== 'getup' && (unit.moving || unit.path?.length
            || (unit.suppressionValue || 0) >= 90 || unit.holdFire && action.opts?.automatic));
    if (interrupted) { unit._infantryAction = null; return; }
    let recipient;
    if (action.kind === 'support') {
        recipient = Game.units.find(u => u.id === action.targetId);
        if (!recipient?.alive || recipient.team !== unit.team || recipient.moving || recipient._inVehicle != null
            || Game.dist(unit.x, unit.z, recipient.x, recipient.z) > (action.work === 'repair' ? recipient.size + 1.5 : 2.2)) {
            unit._infantryAction = null; return;
        }
    }
    if (action.kind === 'grenade' || action.kind === 'support') {
        unit.angle = Game.rotateTo(unit.angle, action.bearing, 6 * dt); unit.turretAngle = unit.angle;
        // Finish facing before starting the windup; no sideways instant toss.
        if (action.elapsed === 0 && Math.abs(Game.angleDiff(unit.angle, action.bearing)) > 0.15) return;
    }
    action.elapsed += dt;
    if (action.kind === 'grenade' && !action.released && action.elapsed >= action.releaseAt) {
        if (unit[action.pocket] <= 0) { unit._infantryAction = null; return; }
        action.released = true; unit[action.pocket]--;
        const T = Game.THREE, hand = unit.mesh?.userData.soldierModel?.getObjectByName('right_hand');
        const position = hand?.getWorldPosition(new T.Vector3());
        // A headless or culled renderer may not have updated the skeleton yet.
        const near = position && Math.hypot(position.x - unit.x, position.z - unit.z) < 2;
        Game.spawnThrownGrenade(near ? position.x : unit.x, near ? position.z : unit.z,
            action.x, action.z, { ...action.opts, y0: near ? position.y : (unit.y || 0) + 0.8 });
        unit._atNext = Game.gameClock + 3;
    }
    if (action.elapsed >= action.duration) {
        if (recipient) Game.completeSupportAction(unit, recipient, action.work);
        unit._infantryAction = null;
    }
};

Game.updateInfantryGetUp = unit => {
    if (!Game.isFootInfantry(unit) || Game.isMountedCavalry?.(unit)) return;
    const previous = unit._actionPosture;
    unit._actionPosture = unit.stance;
    if (unit._infantryAction || previous !== 'prone' || unit.stance === 'prone') return;
    if ((unit._evadeUntil || 0) > Game.gameClock) return;
    const crouch = unit.stance === 'crouch';
    unit._reload = null;
    unit._infantryAction = { kind: 'getup', clip: crouch ? 'getup_crouch' : 'getup_stand', elapsed: 0,
        duration: crouch ? 0.65 : 1.1 };
};

Game.animateInfantryAction = (unit, dt) => {
    const data = unit.mesh?.userData;
    if (!data?.isSoldier || data.isFieldGunCrewman || Game.SOLDIER_FORCE_CLIP) return false;
    const invalidReload = unit._reload && (unit.ammo === 0 || (unit._dispSpeed ?? unit.currentSpeed ?? 0) > 0.2
        || unit.stance !== unit._reload.stance);
    const state = unit._infantryAction || (!invalidReload && unit._reload);
    if (data.heldGrenade) data.heldGrenade.visible = state?.kind === 'grenade' && !state.released;
    const model = data.soldierModel;
    const weapon = model?.getObjectByName(`equipment_${model.userData.infantryWeapon}`);
    if (weapon) {
        data.weaponRestParent ||= weapon.parent;
        // The throw uses the right hand; the other hand retains the firearm.
        const parent = ['grenade', 'support'].includes(state?.kind) ? model.getObjectByName('left_hand') : data.weaponRestParent;
        if (parent && weapon.parent !== parent) {
            weapon.parent.updateWorldMatrix(true, false); parent.updateWorldMatrix(true, false);
            weapon.scale.z *= Math.sign(weapon.parent.matrixWorld.determinant() * parent.matrixWorld.determinant());
            parent.add(weapon);
        }
    }
    if (!state) return false;
    if (state.kind === 'grenade' && !data.heldGrenade) {
        const hand = data.soldierModel?.getObjectByName('right_hand');
        if (hand) {
            const T = Game.THREE;
            data.heldGrenade = new T.Mesh(new T.SphereGeometry(0.035, 8, 6),
                new T.MeshStandardMaterial({ color: 0x46503b, roughness: 0.8 }));
            data.heldGrenade.name = 'held_grenade';
            data.heldGrenade.position.set(0.015, 0, 0.015);
            hand.add(data.heldGrenade);
        }
    }
    const stance = state.stance === 'prone' ? 'prone' : state.stance === 'crouch' ? 'crouch' : 'stand';
    const name = state.clip || `reload_${stance}`;
    const action = data.actions?.[name];
    if (!action) return false;
    Game._playClip(unit, name, 0.12);
    action.setEffectiveTimeScale(0);
    action.time = Math.min(action.getClip().duration - 0.001,
        Math.max(0, state.elapsed / state.duration) * action.getClip().duration);
    data.mixer.update(dt);
    data._weaponPoseBlend = 0;
    Game._captureSoldierMotion?.(unit);
    return true;
};

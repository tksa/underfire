/** Loaded rounds and carried stock are separate. `ammo` remains TOTAL rounds,
 * including the loaded magazine, so existing supply/UI/save contracts survive.
 * Capacities and timings are gameplay profiles, configurable per weapon. */
Game.MAGAZINE_PROFILES = {
    rifle: [5, 3.0], sniper: [5, 3.5], pistol: [8, 2.6],
    smg: [32, 3.0], lmg: [25, 4.0], hmg: [100, 5.0], at_rifle: [4, 3.8],
};
Game.MAGAZINE_OVERRIDES = { mg34_bipod: [50, 4.5], hotchkiss_m1914: [24, 3.2],
    browning_wz28: [20, 3.6], mas38: [32, 3.0] };

Game.ensureMagazine = unit => {
    if (Game.isTank(unit.kind) || Game.isTruck(unit.kind)) return null;
    const weapon = Game.WEAPONS[unit.weaponKey] || {};
    const profile = Game.MAGAZINE_OVERRIDES[unit.weaponKey] || Game.MAGAZINE_PROFILES[weapon.type];
    if (!profile) return null;
    const capacity = weapon.magazineSize || profile[0];
    if (unit._magazineWeapon !== unit.weaponKey) {
        unit._magazineWeapon = unit.weaponKey;
        unit.magazineAmmo = unit.ammo < 0 ? capacity : Math.min(capacity, Math.max(0, unit.ammo || 0));
        unit._reload = null;
    }
    unit.magazineSize = capacity;
    unit.magazineAmmo = Math.max(0, Math.min(unit.magazineAmmo, capacity, unit.ammo < 0 ? capacity : unit.ammo));
    return { capacity, seconds: weapon.magazineReload || profile[1] };
};

Game.weaponCanDischarge = unit => {
    if (Game.WEAPONS[unit.weaponKey]?.type === 'none') return false;
    Game.ensureMagazine(unit);
    return unit.alive && unit.ammo !== 0 && !unit._reload && !unit._infantryAction
        && (unit.magazineAmmo == null || unit.magazineAmmo > 0);
};

// All shot paths use this one transaction. Reload completion transfers stock
// into the magazine; only an actual discharge removes a round from inventory.
Game.consumeWeaponRound = unit => {
    if (!Game.weaponCanDischarge(unit)) return false;
    if (unit.ammo > 0) unit.ammo--;
    if (unit.magazineAmmo != null) unit.magazineAmmo--;
    return true;
};

Game.updateMagazine = (unit, dt) => {
    const profile = Game.ensureMagazine(unit);
    if (!profile) return;
    const moving = unit.moving || unit.path?.length || (unit._dispSpeed ?? unit.currentSpeed ?? 0) > 0.2;
    const interrupted = !unit.alive || moving || unit._unmanned || unit._towed
        || unit._inVehicle != null || unit.retreating || unit._infantryAction
        || (unit.suppressionValue || 0) >= 90;
    if (interrupted || unit.ammo === 0) { unit._reload = null; return; }
    if (!unit._reload && unit.magazineAmmo === 0) {
        unit._reload = { elapsed: 0, duration: profile.seconds * (1 + (unit.suppressionValue || 0) / 200),
            stance: unit.stance || 'stand' };
        Game.resetWeaponAim(unit, 'reloading');
    }
    const reload = unit._reload;
    if (!reload) return;
    // A dive to cover interrupts the operation; start afresh in the new pose.
    if ((unit.stance || 'stand') !== reload.stance) { unit._reload = null; return; }
    reload.elapsed += dt;
    unit.weaponState = 'reloading';
    if (reload.elapsed >= reload.duration) {
        unit.magazineAmmo = unit.ammo < 0 ? profile.capacity : Math.min(profile.capacity, unit.ammo);
        unit._reload = null;
        Game.resetWeaponAim(unit, 'aiming');
    }
};

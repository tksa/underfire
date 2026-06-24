/**
 * Under Fire — weapons.js
 * Detailed weapon definitions with range bands, accuracy falloff,
 * penetration values, and suppression characteristics.
 *
 * Based on the game vision doc. All ranges in game meters (1 game m ≈ 5 real m).
 * Accuracy/damage values use a 0-1 scale.
 */

Game.RANGE_BAND = {
    POINT_BLANK: 4,   // 0-20 real m
    CLOSE: 16,   // 20-80 real m
    MEDIUM: 50,   // 80-250 real m
    LONG: 120,   // 250-600 real m
    EXTREME: 200,   // 600+ real m
};

/**
 * Weapon definitions.
 * Each weapon has stats at multiple range bands.
 * fireType: 'single', 'burst', 'auto', 'indirect'
 */
Game.WEAPONS = {
    // ── No weapon (support vehicles) ────────────────
    none: {
        name: 'Unarmed', type: 'none', fireType: 'single',
        gameRange: 0, cooldown: 999, damage: 0, suppression: 0,
        accuracy: { close: 0, medium: 0, long: 0 },
        penetration: 0, heBlast: 0,
    },
    // ── Pistols ─────────────────────────────────────
    pistol_fr: {
        name: 'Ruby M1914', nation: 'french', type: 'pistol', fireType: 'single',
        crew: 1, gameRange: 10, rateOfFire: 1.2, cooldown: 0.8,
        accuracy: { close: 0.45, medium: 0.18, long: 0.05 },
        damage: 10, suppression: 2, penetration: 0, heBlast: 0,
    },
    pistol_de: {
        name: 'Luger P08', nation: 'german', type: 'pistol', fireType: 'single',
        crew: 1, gameRange: 10, rateOfFire: 1.2, cooldown: 0.8,
        accuracy: { close: 0.48, medium: 0.20, long: 0.06 },
        damage: 10, suppression: 2, penetration: 0, heBlast: 0,
    },
    // ── Rifles ──────────────────────────────────────
    kar98k: {
        name: 'Kar98k',
        nation: 'german',
        type: 'rifle',
        fireType: 'single',
        crew: 1,
        gameRange: 80,
        rateOfFire: 0.83,           // shots per second (12 rpm)
        cooldown: 1.2,
        accuracy: { close: 0.55, medium: 0.70, long: 0.65 },
        damage: 18,
        suppression: 4,
        penetration: 0,
        heBlast: 0,
    },
    mas36: {
        name: 'MAS-36',
        nation: 'french',
        type: 'rifle',
        fireType: 'single',
        crew: 1,
        gameRange: 80,
        rateOfFire: 0.75,
        cooldown: 1.3,
        accuracy: { close: 0.53, medium: 0.68, long: 0.63 },
        damage: 17,
        suppression: 4,
        penetration: 0,
        heBlast: 0,
    },

    // ── Submachine Guns ─────────────────────────────
    mp40: {
        name: 'MP38/40',
        nation: 'german',
        type: 'smg',
        fireType: 'burst',
        crew: 1,
        gameRange: 20,
        rateOfFire: 4.0,
        cooldown: 0.25,
        accuracy: { close: 0.62, medium: 0.30, long: 0.10 },
        damage: 12,
        suppression: 6,
        penetration: 0,
        heBlast: 0,
    },
    mas38: {
        name: 'MAS-38',
        nation: 'french',
        type: 'smg',
        fireType: 'burst',
        crew: 1,
        gameRange: 18,
        rateOfFire: 4.5,
        cooldown: 0.22,
        accuracy: { close: 0.60, medium: 0.28, long: 0.08 },
        damage: 11,
        suppression: 6,
        penetration: 0,
        heBlast: 0,
    },

    // ── Light Machine Guns ──────────────────────────
    mg34_bipod: {
        name: 'MG34 (bipod)',
        nation: 'german',
        type: 'lmg',
        fireType: 'auto',
        crew: 2,
        gameRange: 120,
        rateOfFire: 6.0,
        cooldown: 0.16,
        accuracy: { close: 0.55, medium: 0.52, long: 0.40 },
        damage: 10,
        suppression: 14,
        penetration: 1,
        heBlast: 0,
        setupTime: 0.8,
    },
    fm2429: {
        name: 'FM 24/29',
        nation: 'french',
        type: 'lmg',
        fireType: 'auto',
        crew: 2,
        gameRange: 110,
        rateOfFire: 4.0,
        cooldown: 0.24,
        accuracy: { close: 0.54, medium: 0.50, long: 0.36 },
        damage: 10,
        suppression: 11,
        penetration: 1,
        heBlast: 0,
        setupTime: 0.6,
    },

    // ── Heavy Machine Guns ──────────────────────────
    mg34_tripod: {
        name: 'MG34 (tripod)',
        nation: 'german',
        type: 'hmg',
        fireType: 'auto',
        crew: 3,
        gameRange: 190,
        rateOfFire: 6.5,
        cooldown: 0.15,
        accuracy: { close: 0.58, medium: 0.55, long: 0.45 },
        damage: 10,
        suppression: 18,
        penetration: 1,
        heBlast: 0,
        setupTime: 3.0,
        teardownTime: 2.5,
    },
    hotchkiss_m1914: {
        name: 'Hotchkiss M1914',
        nation: 'french',
        type: 'hmg',
        fireType: 'auto',
        crew: 3,
        gameRange: 190,
        rateOfFire: 4.5,
        cooldown: 0.22,
        accuracy: { close: 0.55, medium: 0.52, long: 0.42 },
        damage: 11,
        suppression: 16,
        penetration: 1,
        heBlast: 0,
        setupTime: 3.5,
        teardownTime: 3.0,
    },

    // ── Sniper Rifles ───────────────────────────────
    kar98k_scoped: {
        name: 'Kar98k (scoped)',
        nation: 'german',
        type: 'sniper',
        fireType: 'single',
        crew: 1,
        gameRange: 160,
        rateOfFire: 0.42,
        cooldown: 2.4,
        accuracy: { close: 0.45, medium: 0.80, long: 0.85 },
        damage: 35,
        suppression: 8,
        penetration: 0,
        heBlast: 0,
    },
    mas36_scoped: {
        name: 'MAS-36 (scoped)',
        nation: 'french',
        type: 'sniper',
        fireType: 'single',
        crew: 1,
        gameRange: 160,
        rateOfFire: 0.42,
        cooldown: 2.4,
        accuracy: { close: 0.43, medium: 0.78, long: 0.83 },
        damage: 34,
        suppression: 8,
        penetration: 0,
        heBlast: 0,
    },

    // ── Mortars ─────────────────────────────────────
    mortar_50mm: {
        name: '5cm leGrW 36',
        nation: 'german',
        type: 'mortar',
        fireType: 'indirect',
        crew: 2,
        gameRange: 100,
        minRange: 16,
        rateOfFire: 0.55,
        cooldown: 1.8,
        accuracy: { close: 0.70, medium: 0.55, long: 0.40 },
        damage: 22,
        suppression: 16,
        penetration: 0,
        heBlast: 3.0,
    },
    mortar_81mm_ger: {
        name: '8cm GrW 34',
        nation: 'german',
        type: 'mortar',
        fireType: 'indirect',
        crew: 3,
        gameRange: 600,
        minRange: 100,
        rateOfFire: 0.33,
        cooldown: 3.0,
        accuracy: { close: 0.60, medium: 0.50, long: 0.35 },
        damage: 38,
        suppression: 22,
        penetration: 2,
        heBlast: 5.0,
    },
    mortar_60mm: {
        name: 'Brandt 60mm',
        nation: 'french',
        type: 'mortar',
        fireType: 'indirect',
        crew: 2,
        gameRange: 200,
        minRange: 20,
        rateOfFire: 0.5,
        cooldown: 2.0,
        accuracy: { close: 0.65, medium: 0.52, long: 0.38 },
        damage: 20,
        suppression: 14,
        penetration: 0,
        heBlast: 3.5,
    },
    mortar_81mm_fr: {
        name: 'Brandt 81mm',
        nation: 'french',
        type: 'mortar',
        fireType: 'indirect',
        crew: 3,
        gameRange: 600,
        minRange: 100,
        rateOfFire: 0.33,
        cooldown: 3.0,
        accuracy: { close: 0.58, medium: 0.48, long: 0.34 },
        damage: 36,
        suppression: 20,
        penetration: 2,
        heBlast: 5.0,
    },

    // ── Anti-Tank Guns ──────────────────────────────
    pak36: {
        name: 'Pak 36 (37mm)',
        nation: 'german',
        type: 'atgun',
        fireType: 'single',
        crew: 5,
        gameRange: 160,
        rateOfFire: 0.5,
        cooldown: 2.0,
        accuracy: { close: 0.72, medium: 0.65, long: 0.50 },
        damage: 42,
        suppression: 6,
        penetration: { close: 40, medium: 34, long: 28 },
        heBlast: 0.8,
        setupTime: 4.0,
        teardownTime: 3.5,
    },
    hotchkiss_25mm: {
        name: '25mm Hotchkiss AT',
        nation: 'french',
        type: 'atgun',
        fireType: 'single',
        crew: 4,
        gameRange: 160,
        rateOfFire: 0.55,
        cooldown: 1.8,
        accuracy: { close: 0.70, medium: 0.62, long: 0.48 },
        damage: 36,
        suppression: 5,
        penetration: { close: 30, medium: 24, long: 18 },
        heBlast: 0.5,
        setupTime: 3.5,
        teardownTime: 3.0,
    },
    sa37_47mm: {
        name: '47mm SA 37',
        nation: 'french',
        type: 'atgun',
        fireType: 'single',
        crew: 5,
        gameRange: 240,
        rateOfFire: 0.4,
        cooldown: 2.5,
        accuracy: { close: 0.74, medium: 0.66, long: 0.55 },
        damage: 55,
        suppression: 8,
        penetration: { close: 70, medium: 60, long: 50 },
        heBlast: 1.2,
        setupTime: 5.0,
        teardownTime: 4.0,
    },

    // ── Tank Guns ───────────────────────────────────
    kwk30_20mm: {
        name: '2cm KwK 30',
        nation: 'german',
        type: 'tankgun',
        fireType: 'burst',
        gameRange: 160,
        rateOfFire: 2.2,
        cooldown: 0.45,
        accuracy: { close: 0.58, medium: 0.48, long: 0.32 },
        damage: 14,
        suppression: 8,
        penetration: { close: 12, medium: 8, long: 5 },
        heBlast: 1.0,
    },
    kwk36_37mm: {
        name: '3.7cm KwK 36',
        nation: 'german',
        type: 'tankgun',
        fireType: 'single',
        gameRange: 240,
        rateOfFire: 0.45,
        cooldown: 2.2,
        accuracy: { close: 0.64, medium: 0.56, long: 0.42 },
        damage: 40,
        suppression: 10,
        penetration: { close: 38, medium: 32, long: 26 },
        heBlast: 1.2,
    },
    kwk37_75mm: {
        name: '7.5cm KwK 37 L/24',
        nation: 'german',
        type: 'tankgun',
        fireType: 'single',
        gameRange: 240,
        rateOfFire: 0.35,
        cooldown: 2.8,
        accuracy: { close: 0.60, medium: 0.50, long: 0.38 },
        damage: 45,
        suppression: 16,
        penetration: { close: 32, medium: 26, long: 20 },
        heBlast: 3.5,
    },
    sa18_37mm: {
        name: '3.7cm SA 18',
        nation: 'french',
        type: 'tankgun',
        fireType: 'single',
        gameRange: 160,
        rateOfFire: 0.4,
        cooldown: 2.5,
        accuracy: { close: 0.58, medium: 0.48, long: 0.32 },
        damage: 28,
        suppression: 8,
        penetration: { close: 18, medium: 14, long: 10 },
        heBlast: 1.5,
    },
    sa35_47mm: {
        name: '4.7cm SA 35',
        nation: 'french',
        type: 'tankgun',
        fireType: 'single',
        gameRange: 240,
        rateOfFire: 0.38,
        cooldown: 2.6,
        accuracy: { close: 0.66, medium: 0.58, long: 0.45 },
        damage: 50,
        suppression: 12,
        penetration: { close: 65, medium: 55, long: 45 },
        heBlast: 1.8,
    },
    sa35_75mm_hull: {
        name: '7.5cm ABS SA 35 (hull)',
        nation: 'french',
        type: 'tankgun',
        fireType: 'single',
        gameRange: 200,
        rateOfFire: 0.28,
        cooldown: 3.5,
        accuracy: { close: 0.55, medium: 0.45, long: 0.32 },
        damage: 48,
        suppression: 18,
        penetration: { close: 28, medium: 24, long: 18 },
        heBlast: 4.0,
    },

    // ── Armored Car Guns ────────────────────────────
    kwk30_sdkfz: {
        name: '2cm KwK 30 (Sd.Kfz.)',
        nation: 'german',
        type: 'tankgun',
        fireType: 'burst',
        gameRange: 140,
        rateOfFire: 2.0,
        cooldown: 0.5,
        accuracy: { close: 0.55, medium: 0.44, long: 0.28 },
        damage: 13,
        suppression: 7,
        penetration: { close: 12, medium: 8, long: 5 },
        heBlast: 0.8,
    },
    sa35_25mm_panhard: {
        name: '25mm SA 35 (Panhard)',
        nation: 'french',
        type: 'tankgun',
        fireType: 'single',
        gameRange: 150,
        rateOfFire: 0.5,
        cooldown: 2.0,
        accuracy: { close: 0.62, medium: 0.52, long: 0.38 },
        damage: 30,
        suppression: 6,
        penetration: { close: 30, medium: 24, long: 18 },
        heBlast: 0.6,
    },
};

/**
 * Get weapon accuracy at a given distance.
 */
Game.getWeaponAccuracy = (weapon, dist) => {
    const RB = Game.RANGE_BAND;
    if (dist <= RB.CLOSE) return weapon.accuracy.close;
    if (dist <= RB.MEDIUM) return Game.lerp(weapon.accuracy.close, weapon.accuracy.medium,
        (dist - RB.CLOSE) / (RB.MEDIUM - RB.CLOSE));
    if (dist <= RB.LONG) return Game.lerp(weapon.accuracy.medium, weapon.accuracy.long,
        (dist - RB.MEDIUM) / (RB.LONG - RB.MEDIUM));
    // Beyond long range — rapid falloff
    return weapon.accuracy.long * Game.clamp(1 - (dist - RB.LONG) / RB.EXTREME, 0.05, 1);
};

/**
 * Per-caliber recoil parameters (see docs/recoil.md).
 * gun = barrel slide distance (world units), head = turret kick (radians),
 * hull = hull rock (radians), dur = total recoil duration (seconds).
 * Caliber is parsed from the weapon's display name.
 */
Game.recoilForWeapon = (weapon) => {
    const name = (weapon && weapon.name) || '';
    let mm = 37;
    const cm = name.match(/([\d.]+)\s*cm/i);
    const mmM = name.match(/(\d+)\s*mm/i);
    if (cm) mm = parseFloat(cm[1]) * 10;
    else if (mmM) mm = parseFloat(mmM[1]);

    const table = [
        { mm: 20, gun: 0.08, head: 0.006, hull: 0.0015, dur: 0.18 },
        { mm: 37, gun: 0.15, head: 0.012, hull: 0.0025, dur: 0.22 },
        { mm: 47, gun: 0.22, head: 0.016, hull: 0.0035, dur: 0.26 },
        { mm: 75, gun: 0.34, head: 0.022, hull: 0.0060, dur: 0.32 },
    ];
    let best = table[0], bd = Infinity;
    for (const e of table) { const d = Math.abs(e.mm - mm); if (d < bd) { bd = d; best = e; } }
    return best;
};

/**
 * Get weapon penetration at a given distance (for AP weapons).
 */
Game.getWeaponPenetration = (weapon, dist) => {
    if (typeof weapon.penetration === 'number') return weapon.penetration;
    if (!weapon.penetration) return 0;
    const RB = Game.RANGE_BAND;
    if (dist <= RB.CLOSE) return weapon.penetration.close;
    if (dist <= RB.MEDIUM) return Game.lerp(weapon.penetration.close, weapon.penetration.medium,
        (dist - RB.CLOSE) / (RB.MEDIUM - RB.CLOSE));
    if (dist <= RB.LONG) return Game.lerp(weapon.penetration.medium, weapon.penetration.long,
        (dist - RB.MEDIUM) / (RB.LONG - RB.MEDIUM));
    return weapon.penetration.long * 0.7;
};

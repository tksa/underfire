/**
 * Under Fire — units.js
 * Complete unit type definitions, 3D unit factory, and mesh generation.
 * All unit types from docs/game-vision.txt — infantry, support weapons, vehicles.
 *
 * Armor values: { front, side, rear } for vehicles (0 for infantry).
 * weapon: key into Game.WEAPONS for primary weapon.
 */

Game.UNIT_STATS = {
    // ═══════════════════════════════════════════════════
    //  FRENCH ARMY
    // ═══════════════════════════════════════════════════

    // ── Infantry ────────────────────────────────────
    french_fusilier: {
        label: 'Fusilier', kind: 'fusilier', class: 'infantry',
        weapon: 'mas36',
        speed: 4.5, hp: 100, size: 0.5,
        armor: 0,
        sight: 16, rotationSpeed: 8,
        color: '#8395a5', cost: 1,
    },
    french_smg: {
        label: 'Pistolet-Mitrailleur', kind: 'smg', class: 'infantry',
        weapon: 'mas38',
        speed: 4.8, hp: 95, size: 0.5,
        armor: 0,
        sight: 14, rotationSpeed: 9,
        color: '#7a8e9e', cost: 1,
    },
    french_fm24: {
        label: 'FM 24/29 Team', kind: 'fm24', class: 'infantry',
        weapon: 'fm2429',
        speed: 4.2, hp: 110, size: 0.55,
        armor: 0,
        sight: 17, rotationSpeed: 7,
        color: '#6f8597', cost: 2,
    },
    french_dragoon: {
        label: 'Dragon Porté', kind: 'dragoon', class: 'infantry',
        weapon: 'mas36',
        speed: 4.6, hp: 100, size: 0.5,
        armor: 0,
        sight: 16, rotationSpeed: 8,
        color: '#728698', cost: 1,
    },
    french_sniper: {
        label: 'Tireur d\'Élite', kind: 'sniper', class: 'infantry',
        weapon: 'mas36_scoped',
        speed: 3.8, hp: 80, size: 0.45,
        armor: 0,
        sight: 24, rotationSpeed: 6,
        color: '#6a7f92', cost: 2,
    },

    // ── Support Weapons ─────────────────────────────
    french_hmg: {
        label: 'Hotchkiss M1914', kind: 'hmg', class: 'support',
        weapon: 'hotchkiss_m1914',
        speed: 2.8, hp: 130, size: 0.6,
        armor: 0,
        sight: 20, rotationSpeed: 4,
        color: '#607486', cost: 3,
    },
    french_mortar_60: {
        label: 'Brandt 60mm', kind: 'mortar60', class: 'support',
        weapon: 'mortar_60mm',
        speed: 3.5, hp: 100, size: 0.55,
        armor: 0,
        sight: 12, rotationSpeed: 5,
        color: '#5e7080', cost: 2,
    },
    french_mortar_81: {
        label: 'Brandt 81mm', kind: 'mortar81', class: 'support',
        weapon: 'mortar_81mm_fr',
        speed: 2.5, hp: 120, size: 0.6,
        armor: 0,
        sight: 10, rotationSpeed: 4,
        color: '#556878', cost: 4,
    },
    french_at_25mm: {
        label: '25mm Hotchkiss AT', kind: 'at25', class: 'support',
        weapon: 'hotchkiss_25mm',
        speed: 2.0, hp: 140, size: 0.7,
        armor: 0,
        sight: 18, rotationSpeed: 3,
        color: '#506272', cost: 2,
    },
    french_at_47mm: {
        label: '47mm SA 37', kind: 'at47', class: 'support',
        weapon: 'sa37_47mm',
        speed: 1.5, hp: 160, size: 0.75,
        armor: 0,
        sight: 20, rotationSpeed: 3,
        color: '#485c6c', cost: 4,
    },

    // ── Vehicles ────────────────────────────────────
    french_h35: {
        label: 'Hotchkiss H35', kind: 'h35', class: 'vehicle',
        weapon: 'sa18_37mm',
        speed: 4.5, hp: 190, size: 0.9,
        armor: { front: 38, side: 34, rear: 34 },
        driveType: 'tracked',
        turret: { speed: 3.0, accel: 1.5 },  // slow one-man turret
        sight: 20, rotationSpeed: 1.4, hullTurnAccel: 0.9,
        color: '#788473', cost: 3,
    },
    french_r35: {
        label: 'Renault R35', kind: 'r35', class: 'vehicle',
        weapon: 'sa18_37mm',
        speed: 3.8, hp: 200, size: 0.9,
        armor: { front: 38, side: 35, rear: 28 },
        driveType: 'tracked',
        turret: { speed: 3.0, accel: 1.5 },  // slow one-man turret
        sight: 18, rotationSpeed: 1.3, hullTurnAccel: 0.8,
        color: '#6e8070', cost: 3,
    },
    french_s35: {
        label: 'Somua S35', kind: 's35', class: 'vehicle',
        weapon: 'sa35_47mm',
        speed: 5.2, hp: 240, size: 1.0,
        armor: { front: 45, side: 40, rear: 35 },
        driveType: 'tracked',
        turret: { speed: 3.5, accel: 2.0 },  // one-man turret, slightly better
        sight: 24, rotationSpeed: 1.2, hullTurnAccel: 0.7,
        color: '#889385', cost: 5,
    },
    french_b1: {
        label: 'Char B1 bis', kind: 'b1', class: 'vehicle',
        weapon: 'sa35_47mm',
        secondaryWeapon: 'sa35_75mm_hull',
        speed: 3.2, hp: 340, size: 1.2,
        armor: { front: 60, side: 55, rear: 55 },
        driveType: 'tracked',
        turret: { speed: 2.5, accel: 1.2 },  // APX-4 turret, very slow traverse
        sight: 22, rotationSpeed: 0.9, hullTurnAccel: 0.5,
        color: '#7a8a78', cost: 8,
    },
    french_panhard: {
        label: 'Panhard 178', kind: 'panhard', class: 'vehicle',
        weapon: 'sa35_25mm_panhard',
        speed: 7.5, hp: 120, size: 0.8,
        armor: { front: 20, side: 15, rear: 10 },
        driveType: 'wheeled',
        turret: { speed: 5.0, accel: 3.0 },  // fast armored car turret
        sight: 26, rotationSpeed: 3.0, hullTurnAccel: 2.5,
        color: '#6f8574', cost: 2,
    },

    // ═══════════════════════════════════════════════════
    //  GERMAN ARMY (WEHRMACHT)
    // ═══════════════════════════════════════════════════

    // ── Infantry ────────────────────────────────────
    german_grenadier: {
        label: 'Grenadier', kind: 'grenadier', class: 'infantry',
        weapon: 'kar98k',
        speed: 4.6, hp: 100, size: 0.5,
        armor: 0,
        sight: 15.5, rotationSpeed: 8,
        color: '#7e8278', cost: 1,
    },
    german_smg: {
        label: 'Sturmtrupp', kind: 'smg', class: 'infantry',
        weapon: 'mp40',
        speed: 4.9, hp: 95, size: 0.5,
        armor: 0,
        sight: 14, rotationSpeed: 9,
        color: '#757a70', cost: 1,
    },
    german_mg34: {
        label: 'MG34 Team', kind: 'mg34', class: 'infantry',
        weapon: 'mg34_bipod',
        speed: 3.9, hp: 110, size: 0.55,
        armor: 0,
        sight: 17.5, rotationSpeed: 6.5,
        color: '#71776d', cost: 2,
    },
    german_sniper: {
        label: 'Scharfschütze', kind: 'sniper', class: 'infantry',
        weapon: 'kar98k_scoped',
        speed: 3.8, hp: 80, size: 0.45,
        armor: 0,
        sight: 26, rotationSpeed: 6,
        color: '#6b7065', cost: 2,
    },

    // ── Support Weapons ─────────────────────────────
    german_hmg: {
        label: 'MG34 (Schwer)', kind: 'hmg', class: 'support',
        weapon: 'mg34_tripod',
        speed: 2.5, hp: 130, size: 0.6,
        armor: 0,
        sight: 22, rotationSpeed: 4,
        color: '#656b5f', cost: 3,
    },
    german_mortar_50: {
        label: '5cm leGrW 36', kind: 'mortar50', class: 'support',
        weapon: 'mortar_50mm',
        speed: 3.8, hp: 100, size: 0.55,
        armor: 0,
        sight: 12, rotationSpeed: 5,
        color: '#5f6558', cost: 2,
    },
    german_mortar_81: {
        label: '8cm GrW 34', kind: 'mortar81', class: 'support',
        weapon: 'mortar_81mm_ger',
        speed: 2.5, hp: 120, size: 0.6,
        armor: 0,
        sight: 10, rotationSpeed: 4,
        color: '#585e52', cost: 4,
    },
    german_pak36: {
        label: 'Pak 36 (37mm)', kind: 'pak36', class: 'support',
        weapon: 'pak36',
        speed: 1.8, hp: 150, size: 0.7,
        armor: 0,
        sight: 20, rotationSpeed: 3,
        color: '#52584c', cost: 2,
    },

    // ── Vehicles ────────────────────────────────────
    german_panzer1: {
        label: 'Panzer I', kind: 'panzer1', class: 'vehicle',
        weapon: 'mg34_bipod',   // MG-armed only
        speed: 7.0, hp: 100, size: 0.75,
        armor: { front: 13, side: 13, rear: 13 },
        driveType: 'tracked',
        turret: { speed: 5.0, accel: 3.0 },  // small fast turret
        sight: 18, rotationSpeed: 1.8, hullTurnAccel: 1.2,
        color: '#787d70', cost: 1,
    },
    german_panzer2: {
        label: 'Panzer II', kind: 'panzer2', class: 'vehicle',
        weapon: 'kwk30_20mm',
        speed: 5.8, hp: 180, size: 0.9,
        armor: { front: 22, side: 18, rear: 16 },
        driveType: 'tracked',
        turret: { speed: 5.0, accel: 2.5 },  // fast turret
        sight: 22, rotationSpeed: 1.5, hullTurnAccel: 1.0,
        color: '#787d70', cost: 2,
    },
    german_panzer3: {
        label: 'Panzer III', kind: 'panzer3', class: 'vehicle',
        weapon: 'kwk36_37mm',
        speed: 5.4, hp: 250, size: 1.0,
        armor: { front: 30, side: 26, rear: 21 },
        driveType: 'tracked',
        turret: { speed: 6.0, accel: 3.0 },  // good turret traverse
        sight: 24, rotationSpeed: 1.3, hullTurnAccel: 0.8,
        color: '#6e7366', cost: 4,
    },
    german_panzer4: {
        label: 'Panzer IV', kind: 'panzer4', class: 'vehicle',
        weapon: 'kwk37_75mm',
        speed: 5.0, hp: 260, size: 1.0,
        armor: { front: 30, side: 20, rear: 20 },
        driveType: 'tracked',
        turret: { speed: 5.5, accel: 2.5 },  // good turret traverse
        sight: 22, rotationSpeed: 1.2, hullTurnAccel: 0.7,
        color: '#6a6f62', cost: 4,
    },
    german_sdkfz: {
        label: 'Sd.Kfz. 222', kind: 'sdkfz', class: 'vehicle',
        weapon: 'kwk30_sdkfz',
        speed: 7.5, hp: 110, size: 0.85,
        armor: { front: 12, side: 8, rear: 8 },
        driveType: 'wheeled',
        turret: { speed: 6.0, accel: 3.5 },  // open-top, fast traverse
        sight: 24, rotationSpeed: 3.0, hullTurnAccel: 2.5,
        color: '#7b7f73', cost: 2,
    },

    // ── Support Units ──
    french_medic: {
        label: 'Medic', kind: 'medic', class: 'support', supportType: 'medic',
        weapon: 'pistol_fr',
        speed: 4.5, hp: 60, size: 0.45,
        armor: { front: 0, side: 0, rear: 0 },
        sight: 14, rotationSpeed: 8,
        color: '#eeeeee', cost: 1,
    },
    french_mechanic: {
        label: 'Mechanic', kind: 'mechanic', class: 'support', supportType: 'mechanic',
        weapon: 'pistol_fr',
        speed: 4.2, hp: 65, size: 0.45,
        armor: { front: 0, side: 0, rear: 0 },
        sight: 14, rotationSpeed: 8,
        color: '#88aacc', cost: 1,
    },
    french_supply_truck: {
        label: 'Supply Truck', kind: 'supply', class: 'support', supportType: 'supply',
        weapon: 'none',
        speed: 5.0, hp: 80, size: 0.85,
        armor: { front: 2, side: 1, rear: 1 },
        sight: 16, rotationSpeed: 5,
        color: '#8b8d6b', cost: 2,
    },
    french_fuel_truck: {
        label: 'Fuel Truck', kind: 'fuel', class: 'support', supportType: 'fuel',
        weapon: 'none',
        speed: 5.0, hp: 80, size: 0.85,
        armor: { front: 2, side: 1, rear: 1 },
        sight: 16, rotationSpeed: 5,
        color: '#6b8b6b', cost: 2,
    },
    french_officer: {
        label: 'Officer', kind: 'officer', class: 'support', supportType: 'officer',
        weapon: 'pistol_fr',
        speed: 4.6, hp: 70, size: 0.45,
        armor: { front: 0, side: 0, rear: 0 },
        sight: 20, rotationSpeed: 8,
        color: '#dbb866', cost: 2,
    },
    french_sapper: {
        label: 'Sapper', kind: 'sapper', class: 'support', supportType: 'sapper',
        weapon: 'mas36',
        speed: 4.0, hp: 90, size: 0.5,
        armor: { front: 0, side: 0, rear: 0 },
        sight: 15, rotationSpeed: 7,
        color: '#cc9966', cost: 1,
    },

    // ── German Support ──
    german_medic: {
        label: 'Sanitäter', kind: 'medic', class: 'support', supportType: 'medic',
        weapon: 'pistol_de',
        speed: 4.5, hp: 60, size: 0.45,
        armor: { front: 0, side: 0, rear: 0 },
        sight: 14, rotationSpeed: 8,
        color: '#eeeeee', cost: 1,
    },
    german_mechanic: {
        label: 'Mechaniker', kind: 'mechanic', class: 'support', supportType: 'mechanic',
        weapon: 'pistol_de',
        speed: 4.2, hp: 65, size: 0.45,
        armor: { front: 0, side: 0, rear: 0 },
        sight: 14, rotationSpeed: 8,
        color: '#88aacc', cost: 1,
    },
    german_supply_truck: {
        label: 'Munitionswagen', kind: 'supply', class: 'support', supportType: 'supply',
        weapon: 'none',
        speed: 5.0, hp: 80, size: 0.85,
        armor: { front: 2, side: 1, rear: 1 },
        sight: 16, rotationSpeed: 5,
        color: '#8b8d6b', cost: 2,
    },
    german_fuel_truck: {
        label: 'Tanklaster', kind: 'fuel', class: 'support', supportType: 'fuel',
        weapon: 'none',
        speed: 5.0, hp: 80, size: 0.85,
        armor: { front: 2, side: 1, rear: 1 },
        sight: 16, rotationSpeed: 5,
        color: '#6b8b6b', cost: 2,
    },
};

/**
 * Check if a unit is a vehicle (has directional armor).
 */
Game.isVehicle = (unit) => {
    const stats = typeof unit === 'string'
        ? Game.UNIT_STATS[unit]
        : Game.UNIT_STATS[unit.team + '_' + unit.kind] || unit;
    return stats && stats.class === 'vehicle';
};

Game.isTank = (kind) => {
    // Check all possible vehicle kinds
    return ['s35', 'h35', 'r35', 'b1', 'panhard', 'panzer1', 'panzer2', 'panzer3', 'panzer4', 'sdkfz'].includes(kind);
};

Game.isSupport = (kind) => {
    return ['hmg', 'mortar50', 'mortar60', 'mortar81', 'pak36', 'at25', 'at47'].includes(kind);
};

// ═══════════════════════════════════════════════════════
//  DATA-DRIVEN UNIT ROSTER (data/units.csv)
// ═══════════════════════════════════════════════════════
// The unit table above is the built-in baseline. `data/units.csv` is the
// editable roster: at boot it is merged over the baseline, so you can tweak a
// stat or add a whole new unit just by editing the CSV — no JS changes, no build
// step. If the CSV is missing/unreadable (e.g. opened via file://), the built-in
// table is used unchanged. Schema + how-to: data/README.md.

// Built-in snapshot kept so we can prove the CSV round-trips the baseline exactly.
Game._unitStatsBuiltin = JSON.parse(JSON.stringify(Game.UNIT_STATS));

// Minimal RFC-4180-ish CSV parser (quoted fields, "" escapes, commas, CRLF).
Game._parseCSV = (text) => {
    const rows = []; let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQ) {
            if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
            else field += c;
        } else if (c === '"') inQ = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (c !== '\r') field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
};

// Merge a units CSV string into Game.UNIT_STATS (override fields present, add new
// keys). Returns the number of rows applied.
Game.applyUnitsCSV = (text) => {
    const rows = Game._parseCSV(text).filter(r => r.length > 1);
    if (rows.length < 2) return 0;
    const idx = {}; rows[0].forEach((h, i) => idx[h.trim()] = i);
    const cell = (row, name) => { const v = idx[name] != null ? row[idx[name]] : undefined; return (v === undefined || v === '') ? undefined : v; };
    const num = (row, name) => { const v = cell(row, name); return v === undefined ? undefined : parseFloat(v); };
    let applied = 0;
    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const key = (cell(row, 'key') || '').trim();
        if (!key) continue;
        const u = Game.UNIT_STATS[key] || {};
        const set = (k, v) => { if (v !== undefined) u[k] = v; };
        set('kind', cell(row, 'kind'));
        set('class', cell(row, 'class'));
        set('supportType', cell(row, 'supportType'));
        set('label', cell(row, 'label'));
        set('weapon', cell(row, 'weapon'));
        set('secondaryWeapon', cell(row, 'secondaryWeapon'));
        set('color', cell(row, 'color'));
        set('driveType', cell(row, 'driveType'));
        set('hp', num(row, 'hp'));
        set('speed', num(row, 'speed'));
        set('size', num(row, 'size'));
        set('sight', num(row, 'sight'));
        set('rotationSpeed', num(row, 'rotationSpeed'));
        set('cost', num(row, 'cost'));
        set('hullTurnAccel', num(row, 'hullTurnAccel'));
        const af = num(row, 'armor_front'), as = num(row, 'armor_side'), ar = num(row, 'armor_rear');
        if (cell(row, 'class') === 'vehicle' || af || as || ar) u.armor = { front: af || 0, side: as || 0, rear: ar || 0 };
        else u.armor = 0;
        const tsp = num(row, 'turret_speed'), tac = num(row, 'turret_accel');
        if (tsp !== undefined) u.turret = { speed: tsp, accel: tac !== undefined ? tac : tsp };
        set('crew', num(row, 'crew'));
        set('year', num(row, 'year'));     // introduction year (era gating)
        // Synthesize a weapon for imported units (their weapon key won't exist in
        // the built-in WEAPONS table). Built-in units leave the w_* columns blank
        // and keep their hand-authored weapon.
        const wkey = u.weapon;
        const wr = num(row, 'w_range');
        if (wkey && wr !== undefined && Game.WEAPONS && !Game.WEAPONS[wkey]) {
            const acc = num(row, 'w_accuracy'); const a = (acc === undefined ? 0.65 : acc);
            Game.WEAPONS[wkey] = {
                name: u.label || wkey,
                type: cell(row, 'w_type') || 'rifle',
                fireType: cell(row, 'w_fire') || 'direct',
                gameRange: wr,
                damage: num(row, 'w_damage') ?? 10,
                cooldown: num(row, 'w_cooldown') ?? 1.5,
                accuracy: { short: Math.min(0.98, a + 0.1), medium: a, long: Math.max(0.1, a - 0.12) },
                suppression: num(row, 'w_supp') ?? 6,
                penetration: num(row, 'w_pen') ?? 0,
                heBlast: num(row, 'w_blast') ?? 0,
            };
        }
        Game.UNIT_STATS[key] = u;
        applied++;
    }
    return applied;
};

// Unit keys available in a given campaign year (introduction year <= year).
// Optional team filter ('french'/'german'/...). Units with no year are treated
// as always available. Lets a scenario offer only era-appropriate units (e.g. a
// 1940 campaign excludes the StG-44 and Tiger).
Game.unitsForYear = (year, team) => {
    return Object.keys(Game.UNIT_STATS).filter(k => {
        const u = Game.UNIT_STATS[k];
        if (team && k.split('_')[0] !== team) return false;
        return u.year == null || u.year <= year;
    });
};

Game.loadUnitsCSV = async () => {
    try {
        const res = await fetch('data/units.csv?v=' + Date.now());
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const n = Game.applyUnitsCSV(await res.text());
        console.log('[units] applied ' + n + ' unit defs from data/units.csv');
    } catch (e) {
        console.warn('[units] data/units.csv not loaded (' + e.message + ') — using built-in roster.');
    }
};

/**
 * Resolve which armor facing a shot hits, with obliquity.
 * Returns { facing, armor, obliquity } where obliquity is 0 (perpendicular)
 * to 1 (45° glancing). Per the vision doc, 45° obliquity = +20% effective armor.
 */
Game.getHitFacing = (target, shooterX, shooterZ) => {
    const stats = Game.UNIT_STATS[target.statKey] || {};
    if (!stats.armor || typeof stats.armor === 'number') {
        return { facing: 'front', armor: stats.armor || 0, obliquity: 0 };
    }

    const incomingAngle = Math.atan2(shooterZ - target.z, shooterX - target.x);
    let relAngle = incomingAngle - target.angle;
    while (relAngle > Math.PI) relAngle -= Math.PI * 2;
    while (relAngle < -Math.PI) relAngle += Math.PI * 2;
    const absAngle = Math.abs(relAngle);

    let facing, bandCenter;
    if (absAngle < Math.PI / 4) { facing = 'front'; bandCenter = 0; }
    else if (absAngle > Math.PI * 3 / 4) { facing = 'rear'; bandCenter = Math.PI; }
    else { facing = 'side'; bandCenter = Math.PI / 2; }

    const obliquity = Math.min(1, Math.abs(absAngle - bandCenter) / (Math.PI / 4));
    return { facing, armor: stats.armor[facing], obliquity };
};

/**
 * Get the effective armor facing for a shooter→target angle (legacy wrapper).
 */
Game.getArmorFacing = (target, shooterX, shooterZ) =>
    Game.getHitFacing(target, shooterX, shooterZ).armor;

/**
 * Add procedural weathering/dirt to a MeshStandardMaterial (no texture needed).
 */
Game._addWeathering = (mat, intensity = 0.15) => {
    // vNormal is not declared for flat-shaded materials — injection would not compile
    if (mat.flatShading) return;
    mat.onBeforeCompile = (shader) => {
        shader.uniforms.wearSeed = { value: Math.random() * 100 };
        shader.fragmentShader = 'uniform float wearSeed;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <color_fragment>',
            `#include <color_fragment>
             // Procedural dirt/wear noise using normals instead of UVs for universal compatibility
             vec2 wUv = vNormal.xz * 3.0 + wearSeed;
             float n1 = fract(sin(dot(wUv, vec2(12.9898, 78.233))) * 43758.5453);
             float n2 = fract(sin(dot(wUv * 2.3, vec2(39.346, 11.135))) * 43758.5453);
             float wear = mix(n1, n2, 0.5);
             // Darken edges and low areas using normal orientation
             float edgeDark = smoothstep(0.0, 0.5, abs(vNormal.y)) * 0.15;
             diffuseColor.rgb *= mix(1.0 - ${intensity.toFixed(2)}, 1.0 + ${(intensity * 0.3).toFixed(2)}, wear);
             diffuseColor.rgb -= edgeDark;`
        );
    };
};

/**
 * Create a 3D mesh for a unit. Local +Z is forward.
 */
Game._createUnitMesh = (unit) => {
    const THREE = Game.THREE;
    const group = new THREE.Group();
    const stats = Game.UNIT_STATS[unit.statKey] || {};
    const isVeh = Game.isTank(unit.kind);
    const isSup = Game.isSupport(unit.kind);
    const isTruck = unit.kind === 'supply' || unit.kind === 'fuel';
    const baseColor = new THREE.Color(stats.color || (unit.team === Game.TEAM.FRENCH ? '#6f7f6a' : '#6d7362'));
    const accentColor = unit.team === Game.TEAM.FRENCH ? 0x8395a5 : 0x7e8278;
    const gunmetal = 0x3a3530;

    // No flatShading: box/cylinder geometry already has faceted normals, and
    // flat shading removes vNormal from the fragment shader (breaks weathering).
    const std = (color, opts = {}) => new THREE.MeshStandardMaterial({
        color, roughness: 0.85, ...opts
    });
    const addMesh = (geo, mat, x, y, z, parent = group) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.castShadow = true;
        m.receiveShadow = true;
        parent.add(m);
        return m;
    };

    if (isVeh) {
        const s = unit.size;
        const wheeled = stats.driveType === 'wheeled';
        const hullW = s * 1.5;
        const hullH = s * 0.55;
        const hullD = s * 2.4;
        const hullBaseY = s * 0.38;

        const hullMat = std(baseColor, { roughness: 0.75 });
        Game._addWeathering(hullMat, 0.18);
        const darkMat = std(0x2a2520, { roughness: 0.95 });

        // Hull + sloped glacis plate at the front
        addMesh(new THREE.BoxGeometry(hullW, hullH, hullD), hullMat, 0, hullBaseY + hullH / 2, 0);
        const glacis = addMesh(new THREE.BoxGeometry(hullW * 0.96, s * 0.3, s * 0.55), hullMat,
            0, hullBaseY + hullH * 0.78, hullD / 2 - s * 0.12);
        glacis.rotation.x = -0.55;

        if (wheeled) {
            // Armored car: 4 big wheels
            const wheelGeo = new THREE.CylinderGeometry(s * 0.32, s * 0.32, s * 0.18, 10);
            wheelGeo.rotateZ(Math.PI / 2);
            [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([sx, sz]) => {
                addMesh(wheelGeo, darkMat, sx * (hullW / 2 + s * 0.02), s * 0.32, sz * hullD * 0.3);
            });
        } else {
            // Tracked: track boxes + road wheels + fenders
            const wheelGeo = new THREE.CylinderGeometry(s * 0.18, s * 0.18, s * 0.26, 8);
            wheelGeo.rotateZ(Math.PI / 2);
            [-1, 1].forEach(side => {
                const tx = side * (hullW / 2 + s * 0.14);
                addMesh(new THREE.BoxGeometry(s * 0.28, s * 0.36, hullD + s * 0.15), darkMat, tx, s * 0.26, 0);
                for (let w = 0; w < 4; w++) {
                    addMesh(wheelGeo, darkMat, tx, s * 0.18, (w - 1.5) * hullD * 0.24);
                }
                // fender
                addMesh(new THREE.BoxGeometry(s * 0.32, s * 0.05, hullD + s * 0.2), hullMat, tx, hullBaseY + hullH * 0.4, 0);
            });
        }

        // Turret: body + mantlet + gun + cupola, grouped for rotation
        const turretGroup = new THREE.Group();
        turretGroup.name = 'turretGroup';
        turretGroup.position.set(0, hullBaseY + hullH + s * 0.02, -s * 0.1);
        group.add(turretGroup);

        const turretMat = std(baseColor.clone().multiplyScalar(1.08), { roughness: 0.7 });
        Game._addWeathering(turretMat, 0.12);
        const turretBody = addMesh(
            new THREE.CylinderGeometry(s * 0.42, s * 0.5, s * 0.38, 10),
            turretMat, 0, s * 0.19, 0, turretGroup);
        turretBody.name = 'TurretBody';
        // mantlet
        addMesh(new THREE.BoxGeometry(s * 0.34, s * 0.26, s * 0.2), turretMat, 0, s * 0.2, s * 0.45, turretGroup);
        // cupola
        addMesh(new THREE.CylinderGeometry(s * 0.16, 0.18 * s, s * 0.14, 8), turretMat, -s * 0.12, s * 0.44, -s * 0.12, turretGroup);

        const barrelLen = s * (unit.kind === 'b1' ? 1.6 : (unit.kind === 'panzer1' || unit.kind === 'panzer2' || unit.kind === 'sdkfz' ? 1.0 : 1.3));
        const barrelGeo = new THREE.CylinderGeometry(0.05 * s, 0.065 * s, barrelLen, 8);
        barrelGeo.rotateX(Math.PI / 2);
        const barrel = addMesh(barrelGeo, std(gunmetal, { roughness: 0.6, flatShading: false }),
            0, s * 0.2, s * 0.5 + barrelLen / 2, turretGroup);
        barrel.name = 'Gun';

        // B1: short 75mm hull gun
        if (unit.kind === 'b1') {
            const hullGunGeo = new THREE.CylinderGeometry(0.08 * s, 0.1 * s, s * 0.7, 8);
            hullGunGeo.rotateX(Math.PI / 2);
            addMesh(hullGunGeo, std(gunmetal, { flatShading: false }), hullW * 0.22, hullBaseY + hullH * 0.45, hullD / 2 + s * 0.3);
        }

        group.userData.turret = turretGroup;
        group.userData.gunNode = barrel;
        group.userData.headNode = turretBody;
        group.userData.turretAxis = 'y';
        group.userData.turretBaseRot = { x: 0, y: 0, z: 0 };
        group.userData.recoilAxis = 'z';
        group.userData.recoilSign = -1; // gun recoils toward -Z (backward)
    } else if (isTruck) {
        const s = unit.size;
        const cabMat = std(baseColor, { roughness: 0.8 });
        Game._addWeathering(cabMat, 0.12);
        const darkMat = std(0x2a2520, { roughness: 0.95 });
        // chassis + hood + cab + canvas bed
        addMesh(new THREE.BoxGeometry(s * 1.1, s * 0.18, s * 2.6), darkMat, 0, s * 0.3, 0);
        addMesh(new THREE.BoxGeometry(s * 0.9, s * 0.45, s * 0.7), cabMat, 0, s * 0.55, s * 0.9);
        addMesh(new THREE.BoxGeometry(s * 1.0, s * 0.6, s * 0.5), cabMat, 0, s * 0.65, s * 0.35);
        const bedMat = unit.kind === 'fuel'
            ? std(0x55584a, { roughness: 0.6, flatShading: false })
            : std(0x7a7458, { roughness: 0.95 });
        if (unit.kind === 'fuel') {
            const tankGeo = new THREE.CylinderGeometry(s * 0.42, s * 0.42, s * 1.4, 10);
            tankGeo.rotateX(Math.PI / 2);
            addMesh(tankGeo, bedMat, 0, s * 0.75, -s * 0.55);
        } else {
            addMesh(new THREE.BoxGeometry(s * 1.05, s * 0.55, s * 1.5), bedMat, 0, s * 0.75, -s * 0.55);
        }
        const wheelGeo = new THREE.CylinderGeometry(s * 0.22, s * 0.22, s * 0.14, 8);
        wheelGeo.rotateZ(Math.PI / 2);
        [[-1, 0.85], [1, 0.85], [-1, -0.3], [1, -0.3], [-1, -0.85], [1, -0.85]].forEach(([sx, sz]) => {
            addMesh(wheelGeo, darkMat, sx * s * 0.55, s * 0.22, sz * s);
        });
    } else if (isSup) {
        const gunMat = std(baseColor, { roughness: 0.8 });
        Game._addWeathering(gunMat, 0.10);
        const metalMat = std(gunmetal, { roughness: 0.7, flatShading: false });

        if (unit.kind.includes('mortar')) {
            // baseplate + angled tube + bipod
            addMesh(new THREE.CylinderGeometry(0.32, 0.38, 0.08, 8), gunMat, 0, 0.06, -0.1);
            const tube = addMesh(new THREE.CylinderGeometry(0.05, 0.07, 0.75, 8), metalMat, 0, 0.4, 0.05);
            tube.rotation.x = -0.65;
            const leg = addMesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 4), metalMat, 0, 0.3, 0.3);
            leg.rotation.x = 0.5;
        } else if (unit.kind === 'hmg') {
            // Hotchkiss M1914: low tripod, finned air-cooled barrel, metallic
            // strip feed, rear spade grips, and a crouched gunner. (+Z forward.)
            const brass = std(0x96702f, { roughness: 0.45, metalness: 0.35, flatShading: false });
            const apexY = 0.44;

            // Tripod: three splayed legs (one forward, two rear) up to the cradle.
            for (let i = 0; i < 3; i++) {
                const a = i * (Math.PI * 2 / 3) + Math.PI / 2;
                const leg = addMesh(new THREE.CylinderGeometry(0.018, 0.028, 0.58, 5), metalMat,
                    Math.cos(a) * 0.17, apexY * 0.5, Math.sin(a) * 0.17 - 0.06);
                leg.rotation.z = Math.cos(a) * 0.46;
                leg.rotation.x = -Math.sin(a) * 0.46;
            }
            // Cradle / pintle on the apex.
            addMesh(new THREE.CylinderGeometry(0.05, 0.065, 0.12, 8), metalMat, 0, apexY, -0.04);
            // Receiver body.
            addMesh(new THREE.BoxGeometry(0.12, 0.11, 0.42), gunMat, 0, apexY + 0.1, 0.0);
            // Finned cooling jacket — the gun's signature ring stack near the breech.
            const barrelY = apexY + 0.12;
            const finGeo = new THREE.CylinderGeometry(0.062, 0.062, 0.03, 10);
            finGeo.rotateX(Math.PI / 2);
            for (let f = 0; f < 7; f++) {
                addMesh(finGeo, brass, 0, barrelY, 0.24 + f * 0.052);
            }
            // Slim barrel beyond the jacket + muzzle.
            const barrelGeo = new THREE.CylinderGeometry(0.022, 0.026, 0.5, 8);
            barrelGeo.rotateX(Math.PI / 2);
            addMesh(barrelGeo, metalMat, 0, barrelY, 0.72);
            addMesh(new THREE.BoxGeometry(0.016, 0.06, 0.02), metalMat, 0, barrelY + 0.05, 0.92); // front sight
            // Metallic feed strip jutting from the right side.
            const strip = addMesh(new THREE.BoxGeometry(0.26, 0.018, 0.05), brass, 0.15, barrelY + 0.01, 0.16);
            strip.rotation.y = 0.14;
            // Rear spade grips.
            [-1, 1].forEach(s => addMesh(new THREE.BoxGeometry(0.028, 0.16, 0.028), gunMat, s * 0.07, apexY + 0.07, -0.22));
            addMesh(new THREE.BoxGeometry(0.2, 0.028, 0.028), gunMat, 0, apexY + 0.15, -0.22);

            // Crouched gunner behind the gun.
            const skinCol = 0xcaa987;
            const helmetCol = unit.team === Game.TEAM.FRENCH ? 0x515f6e : 0x53574b;
            const clothMat = std(baseColor, { roughness: 0.9 });
            Game._addWeathering(clothMat, 0.1);
            const gnr = new THREE.Group();
            gnr.position.set(0, 0, -0.42);
            group.add(gnr);
            addMesh(new THREE.BoxGeometry(0.32, 0.16, 0.34), std(baseColor.clone().multiplyScalar(0.72), { roughness: 0.95 }), 0, 0.16, 0.02, gnr); // haunches
            const torso = addMesh(new THREE.BoxGeometry(0.26, 0.26, 0.2), clothMat, 0, 0.42, 0.06, gnr);
            torso.rotation.x = 0.5; // hunched over the grips
            addMesh(new THREE.BoxGeometry(0.085, 0.05, 0.085), std(skinCol), 0, 0.58, 0.04, gnr); // neck
            addMesh(new THREE.SphereGeometry(0.092, 10, 8), std(skinCol), 0, 0.62, 0.13, gnr);     // head
            addMesh(new THREE.SphereGeometry(0.112, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
                std(helmetCol, { roughness: 0.6 }), 0, 0.64, 0.13, gnr);                            // helmet
        } else {
            // AT gun: carriage + wheels + shield + barrel + trail legs
            const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.1, 10);
            wheelGeo.rotateZ(Math.PI / 2);
            const darkMat = std(0x2a2520, { roughness: 0.95 });
            addMesh(wheelGeo, darkMat, -0.42, 0.3, 0);
            addMesh(wheelGeo, darkMat, 0.42, 0.3, 0);
            addMesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), gunMat, 0, 0.34, 0);
            // shield (angled)
            const shield = addMesh(new THREE.BoxGeometry(0.85, 0.5, 0.04), gunMat, 0, 0.55, 0.18);
            shield.rotation.x = -0.18;
            const bLen = unit.kind === 'at47' ? 1.3 : 1.0;
            const barrelGeo2 = new THREE.CylinderGeometry(0.03, 0.045, bLen, 8);
            barrelGeo2.rotateX(Math.PI / 2);
            addMesh(barrelGeo2, metalMat, 0, 0.5, 0.25 + bLen / 2);
            // split trail legs
            [-1, 1].forEach(side => {
                const trail = addMesh(new THREE.BoxGeometry(0.06, 0.06, 1.0), metalMat, side * 0.18, 0.18, -0.55);
                trail.rotation.y = side * 0.25;
            });
        }
    } else {
        // Infantry — posable low-poly soldier rig (procedural animation; +Z forward).
        // Hierarchy: group > rigRoot > {legL,legR (thigh+knee+shin), upper(torso..head..weapon)}
        const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
        const skin = 0xcaa987;
        const isOfficer = unit.kind === 'officer';
        const helmetCol = unit.kind === 'medic' ? 0xdedcc8
            : (unit.team === Game.TEAM.FRENCH ? 0x515f6e : 0x53574b);
        const cloth = std(baseColor, { roughness: 0.9 });
        Game._addWeathering(cloth, 0.12);
        const trousers = std(baseColor.clone().multiplyScalar(0.72), { roughness: 0.95 });
        const boots = std(0x241d16, { roughness: 0.95 });
        const gunMat = std(gunmetal, { roughness: 0.6 });
        const HIP = 0.34;

        const rigRoot = new THREE.Group();
        group.add(rigRoot);

        // ── Legs: hip pivot -> thigh, knee pivot -> shin + boot ──
        const makeLeg = (lx) => {
            const leg = new THREE.Group(); leg.position.set(lx, HIP, 0);
            addMesh(box(0.105, 0.18, 0.12), trousers, 0, -0.08, 0, leg);     // thigh
            const knee = new THREE.Group(); knee.position.set(0, -0.17, 0); leg.add(knee);
            addMesh(box(0.095, 0.17, 0.11), trousers, 0, -0.08, 0, knee);    // shin
            addMesh(box(0.12, 0.07, 0.2), boots, 0, -0.16, 0.03, knee);      // boot
            rigRoot.add(leg);
            return { leg, knee };
        };
        const legL = makeLeg(-0.075), legR = makeLeg(0.075);

        // ── Upper body: pivot at hip ──
        const upper = new THREE.Group(); upper.position.set(0, HIP, 0); rigRoot.add(upper);
        const torso = addMesh(box(0.3, 0.36, 0.18), cloth, 0, 0.2, 0, upper);
        torso.castShadow = true;
        addMesh(box(0.31, 0.05, 0.19), boots, 0, 0.04, 0, upper);            // belt
        addMesh(box(0.22, 0.26, 0.11), std(0x554c39, { roughness: 0.95 }), 0, 0.21, -0.13, upper); // pack
        const armL = addMesh(box(0.075, 0.3, 0.085), cloth, -0.17, 0.2, 0.05, upper);
        const armR = addMesh(box(0.075, 0.3, 0.085), cloth, 0.15, 0.18, 0.09, upper);
        addMesh(box(0.09, 0.06, 0.09), std(skin), 0, 0.42, 0, upper);        // neck
        addMesh(new THREE.SphereGeometry(0.1, 10, 8), std(skin), 0, 0.51, 0.01, upper); // head
        if (isOfficer) {
            const capCol = unit.team === Game.TEAM.FRENCH ? 0x3a4a64 : 0x46493e;
            addMesh(new THREE.CylinderGeometry(0.12, 0.125, 0.09, 12), std(capCol, { roughness: 0.55 }), 0, 0.54, 0, upper);
            addMesh(box(0.2, 0.02, 0.08), std(0x1a1a18, { roughness: 0.5 }), 0, 0.51, 0.11, upper);
            addMesh(box(0.07, 0.04, 0.02), std(0xcaa23a, { roughness: 0.4, metalness: 0.3 }), 0, 0.56, 0.12, upper);
        } else {
            addMesh(new THREE.SphereGeometry(0.125, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
                std(helmetCol, { roughness: 0.6 }), 0, 0.53, 0.01, upper);
            addMesh(new THREE.CylinderGeometry(0.135, 0.135, 0.028, 12),
                std(helmetCol, { roughness: 0.6 }), 0, 0.51, 0.01, upper);
        }

        const weaponDef = Game.WEAPONS[unit.weaponKey];
        if (weaponDef && weaponDef.type !== 'none' && weaponDef.type !== 'pistol') {
            const gunLen = weaponDef.type === 'sniper' ? 0.66
                : (weaponDef.type === 'lmg' || weaponDef.type === 'hmg' ? 0.58
                    : (weaponDef.type === 'smg' ? 0.36 : 0.5));
            const gun = addMesh(box(0.04, 0.055, gunLen), gunMat, 0.1, 0.2, 0.18, upper);
            gun.rotation.x = -0.18;
            if (weaponDef.type === 'rifle' || weaponDef.type === 'sniper') {
                const stock = addMesh(box(0.05, 0.07, 0.16), std(0x5a3d24, { roughness: 0.9 }), 0.1, 0.19, 0.05, upper);
                stock.rotation.x = -0.18;
            }
        }
        if (unit.kind === 'medic') {
            addMesh(box(0.09, 0.12, 0.09), std(0xe8e8e0), -0.17, 0.26, 0.05, upper);
            addMesh(box(0.05, 0.05, 0.1), std(0xcc2222, { roughness: 0.7 }), -0.17, 0.26, 0.06, upper);
        }

        group.userData.isInfantry = true;
        group.userData.rig = {
            root: rigRoot, legL: legL.leg, legR: legR.leg,
            kneeL: legL.knee, kneeR: legR.knee, upper, armL, armR,
        };
    }

    // Selection ring
    const ringRadius = isVeh ? unit.size + 0.3 : (isSup ? unit.size + 0.2 : unit.size + 0.15);
    const ringGeo = new THREE.RingGeometry(ringRadius - 0.08, ringRadius, 24);
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0xdbbe73,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    ring.visible = false;
    group.add(ring);
    group.userData.selectionRing = ring;

    // Health bar sprite
    const hbCanvas = document.createElement('canvas');
    hbCanvas.width = 64;
    hbCanvas.height = 24; // up to 3 stacked rows: HP, ammo, fuel
    const hbTex = new THREE.CanvasTexture(hbCanvas);
    hbTex.minFilter = THREE.LinearFilter;
    const hbMat = new THREE.SpriteMaterial({ map: hbTex, transparent: true, depthTest: false });
    const hbSprite = new THREE.Sprite(hbMat);
    const barY = isVeh ? unit.size * 2.5 + 1.5 : 2.2;
    hbSprite.position.set(0, barY, 0);
    hbSprite.scale.set(isVeh ? 2.0 : 1.2, isVeh ? 0.7 : 0.5, 1);
    hbSprite.visible = false;
    group.add(hbSprite);
    group.userData.healthBar = hbSprite;
    group.userData.healthBarCanvas = hbCanvas;
    group.userData.healthBarTex = hbTex;

    // Team indicator ring (always visible, subtle)
    if (unit.team === Game.TEAM.FRENCH) {
        const indGeo = new THREE.RingGeometry(ringRadius - 0.15, ringRadius - 0.08, 24);
        const indMat = new THREE.MeshBasicMaterial({
            color: 0x8cc0ff,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.25
        });
        const ind = new THREE.Mesh(indGeo, indMat);
        ind.rotation.x = -Math.PI / 2;
        ind.position.y = 0.02;
        group.add(ind);
    }

    group.userData.unitId = unit.id;
    group.userData.isUnit = true;
    return group;
};

/**
 * Try to load a 3D model for a unit, falling back to placeholder.
 * For tanks: tries kind-specific model first, then falls back to tiger-E.fbx.
 * Automatically detects turret child nodes for independent rotation.
 */
Game._loadUnitModel = (unit, mesh) => {
    const isVeh = Game.isTank(unit.kind);
    const isSup = Game.isSupport(unit.kind);

    // The heavy MG (incl. the former french_hmg "Hotchkiss M1914" GLB) is fully
    // procedural now — the bundled model didn't read well at game scale, so it
    // was removed in favour of the built mesh in _createUnitMesh.
    if (unit.kind === 'hmg') return;

    // Prefer a team-specific model, then a generic per-kind model. No cross-kind
    // fallback — the procedural mesh looks better than a wrong model. Probe once.
    const teamKind = `${unit.team}_${unit.kind}`;
    Game._modelLoadFailed = Game._modelLoadFailed || new Set();
    if (Game._modelLoadFailed.has(teamKind)) return;
    const paths = [`models/${teamKind}.glb`, `models/${unit.kind}.glb`];

    // Per-model corrections: yaw (radians) when the source faces the wrong way,
    // and an extra scale multiplier on top of footprint normalization.
    const MODEL_YAW = {};
    const MODEL_SCALE = {};

    // Try each path sequentially until one works
    const tryLoad = (idx) => {
        if (idx >= paths.length) {
            Game._modelLoadFailed.add(teamKind); // keep placeholder, don't re-probe
            return;
        }
        Game.loadModel(paths[idx]).then(model => {
            // Remove placeholder children (keep selection ring, indicators, health bar)
            const keep = new Set();
            if (mesh.userData.selectionRing) keep.add(mesh.userData.selectionRing);
            if (mesh.userData.healthBar) keep.add(mesh.userData.healthBar);
            const children = [...mesh.children];
            children.forEach(c => {
                if (!keep.has(c) && !c.userData?.isIndicator) mesh.remove(c);
            });

            const THREE = Game.THREE;

            // ── 1. Normalize scale: fit the model's longest horizontal axis to
            //      the unit's intended footprint, so every source model lands at a
            //      consistent in-world size regardless of its native units. ──
            model.scale.set(1, 1, 1);
            model.updateMatrixWorld(true);
            const nb = new THREE.Box3().setFromObject(model);
            const nativeLong = Math.max(nb.max.x - nb.min.x, nb.max.z - nb.min.z) || 1;
            const targetLong = isVeh ? unit.size * 2.6 : (isSup ? unit.size * 2.0 : unit.size * 1.9);
            const sizeScale = (targetLong / nativeLong) * (MODEL_SCALE[teamKind] || 1);
            model.scale.set(sizeScale, sizeScale, sizeScale);

            // ── 2. Strip embedded lights and cameras ──
            const toRemove = [];
            model.traverse(child => {
                if (child.isLight || child.isCamera) {
                    toRemove.push(child);
                }
            });
            toRemove.forEach(obj => {
                if (obj.parent) obj.parent.remove(obj);
                if (obj.dispose) obj.dispose();
            });
            if (toRemove.length > 0) {
                console.log(`Stripped ${toRemove.length} embedded lights/cameras from ${paths[idx]}`);
            }

            // ── 3. Log hierarchy for debugging (first load only) ──
            if (!Game._modelHierarchyLogged) {
                Game._modelHierarchyLogged = true;
                console.log(`Model hierarchy for ${paths[idx]}:`);
                model.traverse(child => {
                    const depth = [];
                    let p = child.parent;
                    while (p && p !== model) { depth.push('  '); p = p.parent; }
                    console.log(`${depth.join('')}${child.type}: "${child.name}"`);
                });
            }

            // ── 4. Auto-detect model forward direction & create orientation wrapper ──
            const modelWrapper = new THREE.Group();
            modelWrapper.name = 'modelWrapper';

            // Measure bounding box to determine which horizontal axis is "forward" (longest)
            model.updateMatrixWorld(true);
            const rawBox = new THREE.Box3().setFromObject(model);
            const sizeX = rawBox.max.x - rawBox.min.x;
            const sizeY = rawBox.max.y - rawBox.min.y;
            const sizeZ = rawBox.max.z - rawBox.min.z;
            console.log(`Model "${paths[idx]}" bbox: X=${sizeX.toFixed(2)} Y=${sizeY.toFixed(2)} Z=${sizeZ.toFixed(2)}`);

            // Game expects forward = +Z in local space.
            // If model is significantly longer along X than Z, it faces +X → rotate to face +Z
            if (sizeX > sizeZ * 1.3) {
                modelWrapper.rotation.y = -Math.PI / 2;
                console.log(`Model forward detected as +X, rotating -90° to align with +Z`);
            } else if (sizeZ > sizeX * 1.3) {
                // Model already faces +Z (or -Z). Check if gun/barrel is on -Z side
                // For now assume +Z is correct
                console.log(`Model forward detected as +Z (correct, no rotation needed)`);
            } else {
                console.log(`Model is roughly square — assuming +Z forward (no rotation)`);
            }

            // Per-model yaw correction (e.g. barrel pointing the wrong way)
            if (MODEL_YAW[teamKind] != null) modelWrapper.rotation.y += MODEL_YAW[teamKind];

            // Center model horizontally within wrapper
            const centerX = (rawBox.min.x + rawBox.max.x) / 2;
            const centerZ = (rawBox.min.z + rawBox.max.z) / 2;
            model.position.x = -centerX;
            model.position.z = -centerZ;

            // Store auto-center offsets for debug adjustment
            mesh.userData.modelCenterOffset = { x: -centerX, y: 0, z: -centerZ };
            mesh.userData.modelWrapper = null; // will be set after add

            modelWrapper.add(model);

            // ── 5. Ground-snap: shift wrapper so bottom sits at y=0 ──
            modelWrapper.updateMatrixWorld(true);
            const finalBox = new THREE.Box3().setFromObject(modelWrapper);
            modelWrapper.position.y = -finalBox.min.y;
            console.log(`Ground snap: shifted Y by ${(-finalBox.min.y).toFixed(2)}`);

            // ── 6. Search for turret and gun nodes within the model ──
            let turretNode = null;
            let gunNode = null;
            const turretNames = ['turret', 'tower', 'turm', 'tourelle', 'head'];
            const gunNames = ['gun', 'barrel', 'cannon', 'kanone'];
            model.traverse(child => {
                const name = (child.name || '').toLowerCase();
                if (!turretNode) {
                    for (const tn of turretNames) {
                        if (name.includes(tn)) { turretNode = child; break; }
                    }
                }
                if (!gunNode) {
                    for (const gn of gunNames) {
                        if (name.includes(gn)) { gunNode = child; break; }
                    }
                }
            });

            // ── 7. Wire turret rotation ──
            if (turretNode && isVeh) {
                let turretGroup;

                if (gunNode && gunNode.parent === turretNode.parent) {
                    // Both are siblings — create container group
                    const parent = turretNode.parent;
                    turretGroup = new THREE.Group();
                    turretGroup.name = 'turretGroup';

                    turretGroup.position.copy(turretNode.position);

                    parent.remove(turretNode);
                    turretNode.position.set(0, 0, 0);
                    turretGroup.add(turretNode);

                    const headPos = turretGroup.position;
                    parent.remove(gunNode);
                    gunNode.position.set(
                        gunNode.position.x - headPos.x,
                        gunNode.position.y - headPos.y,
                        gunNode.position.z - headPos.z
                    );
                    turretGroup.add(gunNode);

                    parent.add(turretGroup);
                    console.log(`Merged "${turretNode.name}" + "${gunNode.name}" into turretGroup`);
                } else {
                    turretGroup = turretNode;
                }

                mesh.userData.turret = turretGroup;
                mesh.userData.gunNode = gunNode;
                mesh.userData.headNode = turretNode;
                mesh.userData.turretAxis = 'y';
                mesh.userData.turretBaseRot = {
                    x: turretGroup.rotation.x,
                    y: turretGroup.rotation.y,
                    z: turretGroup.rotation.z
                };
                console.log(`Turret wired: axis=y`);
            } else if (isVeh && unit.hasTurret) {
                // No turret in model — create synthetic turret + gun
                console.log(`Creating synthetic turret for ${unit.label} (no turret in model)`);
                const turretGroup = new THREE.Group();
                turretGroup.name = 'turretGroup';

                const bbox = new THREE.Box3().setFromObject(model);
                const topY = bbox.max.y;
                const cX = (bbox.min.x + bbox.max.x) / 2;
                const cZ = (bbox.min.z + bbox.max.z) / 2;

                const domeGeo = new THREE.SphereGeometry(12, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
                const domeMat = new THREE.MeshStandardMaterial({ color: 0xA08050, roughness: 0.75, metalness: 0.15 });
                const dome = new THREE.Mesh(domeGeo, domeMat);
                dome.name = 'Synthetic_Head';
                turretGroup.add(dome);

                const barrelGeo = new THREE.CylinderGeometry(2, 2, 40, 6);
                barrelGeo.rotateZ(Math.PI / 2);
                const barrelMat = new THREE.MeshStandardMaterial({ color: 0xa48450, roughness: 0.6, metalness: 0.4 });
                const barrel = new THREE.Mesh(barrelGeo, barrelMat);
                barrel.name = 'Synthetic_Gun';
                barrel.position.set(20, 3, 0);
                turretGroup.add(barrel);

                turretGroup.position.set(cX, topY, cZ);
                model.add(turretGroup);

                mesh.userData.turret = turretGroup;
                mesh.userData.gunNode = barrel;
                mesh.userData.headNode = dome;
                mesh.userData.turretAxis = 'y';
                mesh.userData.turretBaseRot = { x: 0, y: 0, z: 0 };
                console.log(`Synthetic turret wired: axis=y`);
            } else if (isVeh) {
                console.warn(`No turret node found for ${unit.label}!`);
            }

            // ── 8. Enable shadows on all meshes ──
            model.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    child._originalMaterial = child.material;
                }
            });

            // ── 9. Setup Animation Mixer + actions, play a default clip ──
            mesh.userData.mixer = new THREE.AnimationMixer(model);
            const clips = (model.animations && model.animations.length) ? model.animations
                : (modelWrapper.animations || []);
            if (clips.length) {
                mesh.userData.animations = clips;
                mesh.userData.actions = {};
                mesh.userData.clipNames = clips.map(c => c.name);
                clips.forEach(c => { mesh.userData.actions[c.name] = mesh.userData.mixer.clipAction(c); });
                console.log(`Animations for ${unit.label}: ${mesh.userData.clipNames.join(', ')}`);
                if (Game._updateModelAnimation) Game._updateModelAnimation(unit, 0); // kick the default clip
            }

            // ── 10. Add wrapper to unit mesh group ──
            mesh.add(modelWrapper);
            mesh.userData.modelWrapper = modelWrapper;
            console.log(`Loaded model: ${paths[idx]} for ${unit.label}`);
        }).catch(() => {
            tryLoad(idx + 1); // try next path
        });
    };
    tryLoad(0);
};

/**
 * Create a unit and add it to the game.
 */
Game.makeUnit = (team, kind, x, z, opts = {}) => {
    const key = team + '_' + kind;
    const base = Game.UNIT_STATS[key];
    if (!base) {
        console.warn(`Unknown unit type: ${key}`);
        return null;
    }

    const weaponDef = Game.WEAPONS[base.weapon] || {};
    const isVehClass = base.class === 'vehicle';

    const unit = {
        id: Game.nextUnitId++,
        team,
        kind: base.kind || kind,   // Use kind from stat definition
        statKey: key,              // Store the lookup key for stat access
        supportType: base.supportType || null,
        label: base.label,
        class: base.class,
        weaponKey: base.weapon,
        secondaryWeaponKey: base.secondaryWeapon || null,
        // Stats from definition
        speed: base.speed,
        currentSpeed: 0,
        hp: base.hp,
        maxHp: base.hp,
        size: base.size,
        armor: base.armor,
        sight: base.sight,
        rotationSpeed: base.rotationSpeed,
        cost: base.cost || 1,
        // Weapon stats (from weapon definition for quick access)
        range: weaponDef.gameRange || 12,
        damage: weaponDef.damage || 10,
        cooldown: weaponDef.cooldown || 1.0,
        accuracy: (weaponDef.accuracy?.medium) || 0.5,
        suppression: weaponDef.suppression || 5,
        penetration: typeof weaponDef.penetration === 'object'
            ? weaponDef.penetration.medium || 0
            : (weaponDef.penetration || 0),
        // Position
        x, z,
        y: Game.getHeight ? Game.getHeight(x, z) : 0,
        angle: opts.angle ?? Game.rand(-0.2, 0.2),
        turretAngle: opts.angle ?? Game.rand(-0.2, 0.2),
        targetX: x, targetZ: z,
        path: [],
        // State
        selected: false,
        alive: true,
        cooldownLeft: Game.rand(0, weaponDef.cooldown || 1),
        suppressionValue: 0,
        fatigue: Game.rand(0, 10),
        stance: 'stand',
        orderMode: 'aggressive',
        underFire: 0,
        coverBonus: 0,
        preferredCover: 0,
        fireTargetId: null,
        thinking: Game.rand(0, 0.5),
        aiState: opts.aiState || 'hold',
        patrol: opts.patrol || null,
        holdPoint: { x, z },
        group: opts.group || '',
        rallied: true,
        stopTimer: 0,
        moving: false,
        shaken: 0,
        veterancy: opts.veterancy ?? Game.rand(0, 0.18),
        // Sudden Strike systems
        experience: 0,
        behavior: 'defensive',  // aggressive, defensive, cautious
        ammo: isVehClass ? 24 : (weaponDef.type === 'lmg' || weaponDef.type === 'hmg' ? 50 : 30),
        maxAmmo: isVehClass ? 24 : (weaponDef.type === 'lmg' || weaponDef.type === 'hmg' ? 50 : 30),
        fuel: isVehClass ? 100 : -1,  // -1 = no fuel (infantry)
        maxFuel: isVehClass ? 100 : -1,
        tracksDisabled: false,
        engineDamaged: false,
        turretDamaged: false,
        driveType: base.driveType || 'tracked',  // 'tracked' | 'wheeled'
        hullTurnAccel: base.hullTurnAccel || base.rotationSpeed,  // angular accel (rad/s²)
        hullAngVel: 0,  // current hull angular velocity (rad/s)
        turretRotSpeed: base.turret ? base.turret.speed : 0,  // rad/s max, 0 = hull-fixed
        turretAccel: base.turret ? (base.turret.accel || base.turret.speed) : 0,  // turret angular accel
        turretAngVel: 0,  // current turret angular velocity (rad/s)
        recoilTime: 0,    // remaining recoil animation time (s)
        hasTurret: !!base.turret,
        // RWM-style towed-gun deploy (siege): AT guns must be set up to fire and
        // packed up to move. They start deployed; the update loop limbers them
        // automatically when ordered to move and re-deploys them once stopped.
        deployable: ['at25', 'at47', 'pak36', 'hmg'].includes(base.kind || kind),
        deployed: true,
        _deployT: 0,
        mesh: null,
    };

    // Create 3D mesh
    unit.mesh = Game._createUnitMesh(unit);
    unit.mesh.position.set(x, unit.y, z);
    unit.mesh.rotation.y = -unit.angle;
    Game.unitsGroup.add(unit.mesh);

    // Try GLTF model
    Game._loadUnitModel(unit, unit.mesh);

    Game.units.push(unit);
    return unit;
};

Game.getUnitById = (id) => Game.units.find(u => u.id === id);
Game.getTeamUnits = (team) => Game.units.filter(u => u.alive && u.team === team);

// Formation types
Game.FORMATIONS = ['line', 'column', 'wedge', 'block', 'spread'];
Game.currentFormation = 'block';

Game.formationOffsets = (count, spacing = 2.0, type) => {
    type = type || Game.currentFormation;
    const offsets = [];
    if (count <= 1) { offsets.push({ x: 0, z: 0 }); return offsets; }

    switch (type) {
        case 'line': // Single row
            for (let i = 0; i < count; i++) {
                offsets.push({ x: (i - (count - 1) / 2) * spacing, z: 0 });
            }
            break;

        case 'column': // Single file
            for (let i = 0; i < count; i++) {
                offsets.push({ x: 0, z: (i - (count - 1) / 2) * spacing });
            }
            break;

        case 'wedge': // V-shape, leader at front
            offsets.push({ x: 0, z: -spacing });
            for (let i = 1; i < count; i++) {
                const side = (i % 2 === 1) ? 1 : -1;
                const row = Math.ceil(i / 2);
                offsets.push({ x: side * row * spacing, z: row * spacing * 0.6 });
            }
            break;

        case 'spread': // Wide dispersal (double spacing)
            {
                const cols = Math.ceil(Math.sqrt(count));
                const rows = Math.ceil(count / cols);
                for (let i = 0; i < count; i++) {
                    const cx = (i % cols) - (cols - 1) / 2;
                    const cy = Math.floor(i / cols) - (rows - 1) / 2;
                    offsets.push({ x: cx * spacing * 2.2, z: cy * spacing * 2.2 });
                }
            }
            break;

        case 'block': // Square grid (default)
        default:
            {
                const cols = Math.ceil(Math.sqrt(count));
                const rows = Math.ceil(count / cols);
                for (let i = 0; i < count; i++) {
                    const cx = (i % cols) - (cols - 1) / 2;
                    const cy = Math.floor(i / cols) - (rows - 1) / 2;
                    offsets.push({ x: cx * spacing, z: cy * spacing });
                }
            }
            break;
    }
    return offsets;
};

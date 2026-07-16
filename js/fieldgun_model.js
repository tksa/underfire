/**
 * Polish 75 mm field-gun crew.
 *
 * The replacement gun GLB is static. Its two visible crewmen use clones of the same
 * skinned, Polish-tinted soldier rig as the infantry, with rifles hidden and
 * the shared locomotion/gait controller driving them while the gun moves.
 * Lightweight articulated figures remain only as a load-failure fallback.
 */

Game.FIELDGUN75_MODEL_PATH = 'models/polish_fieldgun75.glb';

// Fallback palette. The normal crew path uses Game.applySoldierSkin on the real
// soldier GLB; these colours are visible only if that model cannot load.
Game.FIELDGUN75_CREW_SKIN = Object.freeze({
    team: 'polish',
    coatFallback: 0xa29f78,
    helmet: 0x5d6245,
    skin: 0xcaa987,
});

Game.FIELDGUN75_CREW_COUNT = 2;
Game.FIELDGUN75_CREW_PLACEMENTS = Object.freeze([
    // Coordinates are defined before the gun's per-model half-turn, when its
    // trails extend toward +Z. The crew host inherits that half-turn below.
    Object.freeze({ x: -0.23, z: 0.40, phase: 0.00, restStance: 'crouch', role: 'trail_left' }),
    Object.freeze({ x:  0.23, z: 0.54, phase: 0.50, restStance: 'crouch', role: 'trail_right' }),
]);

// Crewed guns: which kinds get the soldier crew, rolling wheels, and the
// push/kneel behaviour. The Polish 75 mm pioneered the system; the French
// 25 mm Hotchkiss reuses it with French-skinned clones of the same rig.
// `muzzle` is the world-unit barrel-tip offset applyShot fires from.
Game.GUN_CREWS = Object.freeze({
    fieldgun75: Object.freeze({
        placements: Game.FIELDGUN75_CREW_PLACEMENTS,
        muzzle: 1.15,
    }),
    at47: Object.freeze({
        // The 47 mm SA 37: same crew layout as the Hotchkiss, longer barrel.
        placements: Object.freeze([
            Object.freeze({ x: -0.21, z: 0.40, phase: 0.00, restStance: 'crouch', role: 'trail_left' }),
            Object.freeze({ x:  0.21, z: 0.52, phase: 0.50, restStance: 'crouch', role: 'trail_right' }),
        ]),
        muzzle: 0.85,
    }),
    at25: Object.freeze({
        // The Hotchkiss is a much smaller piece: the two crewmen kneel close
        // behind its split trails.
        placements: Object.freeze([
            Object.freeze({ x: -0.20, z: 0.36, phase: 0.00, restStance: 'crouch', role: 'trail_left' }),
            Object.freeze({ x:  0.20, z: 0.48, phase: 0.50, restStance: 'crouch', role: 'trail_right' }),
        ]),
        muzzle: 0.75,
    }),
});

// Per-team fallback palettes for the placeholder figures (the real crew path
// uses applySoldierSkin on the shared rig, keyed by the unit's own team).
Game.GUN_CREW_FALLBACK_SKINS = Object.freeze({
    polish: Object.freeze({ coatFallback: 0xa29f78, helmet: 0x5d6245, skin: 0xcaa987 }),
    french: Object.freeze({ coatFallback: 0x7d86a0, helmet: 0x4c5566, skin: 0xcaa987 }),
});

Game.FIELDGUN_PUSH_KEYS = Object.freeze([
    { hipL: -0.52, hipR:  0.34, kneeL: 0.12, kneeR: 0.48, bob:  0.000, torso: 0.30, armL: -1.15, armR: -1.10 },
    { hipL: -0.28, hipR:  0.48, kneeL: 0.06, kneeR: 0.34, bob: -0.018, torso: 0.33, armL: -1.20, armR: -1.07 },
    { hipL:  0.08, hipR:  0.36, kneeL: 0.18, kneeR: 0.12, bob: -0.030, torso: 0.35, armL: -1.23, armR: -1.10 },
    { hipL:  0.42, hipR:  0.04, kneeL: 0.45, kneeR: 0.06, bob: -0.014, torso: 0.32, armL: -1.17, armR: -1.15 },
    { hipL:  0.34, hipR: -0.52, kneeL: 0.48, kneeR: 0.12, bob:  0.000, torso: 0.30, armL: -1.10, armR: -1.15 },
    { hipL:  0.48, hipR: -0.28, kneeL: 0.34, kneeR: 0.06, bob: -0.018, torso: 0.33, armL: -1.07, armR: -1.20 },
    { hipL:  0.36, hipR:  0.08, kneeL: 0.12, kneeR: 0.18, bob: -0.030, torso: 0.35, armL: -1.10, armR: -1.23 },
    { hipL:  0.04, hipR:  0.42, kneeL: 0.06, kneeR: 0.45, bob: -0.014, torso: 0.32, armL: -1.15, armR: -1.17 },
]);

Game._makeFieldGunCrewman = (materials) => {
    const THREE = Game.THREE;
    const root = new THREE.Group();
    root.name = 'fieldGunCrewman';

    const mesh = (geometry, material, parent, x, y, z) => {
        const part = new THREE.Mesh(geometry, material);
        part.position.set(x, y, z);
        part.castShadow = true;
        part.receiveShadow = true;
        parent.add(part);
        return part;
    };
    const limb = (radius, length, material, parent) =>
        mesh(new THREE.CylinderGeometry(radius * 0.88, radius, length, 7), material,
            parent, 0, -length * 0.5, 0);

    // Legs pivot at the hips, with separately bending knees.
    const makeLeg = (x) => {
        const hip = new THREE.Group(); hip.position.set(x, 0.55, 0); root.add(hip);
        limb(0.058, 0.25, materials.trousers, hip);
        const knee = new THREE.Group(); knee.position.set(0, -0.245, 0); hip.add(knee);
        limb(0.052, 0.25, materials.trousers, knee);
        mesh(new THREE.BoxGeometry(0.115, 0.07, 0.20), materials.boots,
            knee, 0, -0.245, 0.055);
        return { hip, knee };
    };
    const left = makeLeg(-0.09);
    const right = makeLeg(0.09);

    // Upper body leans into the trails. Arms are two-bone chains so the hands
    // stay visibly extended rather than swinging at the sides like normal walk.
    const upper = new THREE.Group(); upper.position.set(0, 0.55, 0); root.add(upper);
    mesh(new THREE.BoxGeometry(0.34, 0.38, 0.20), materials.coat, upper, 0, 0.20, 0);
    mesh(new THREE.BoxGeometry(0.35, 0.055, 0.21), materials.leather, upper, 0, 0.05, 0);
    mesh(new THREE.SphereGeometry(0.095, 9, 7), materials.skin, upper, 0, 0.49, 0.015);
    mesh(new THREE.SphereGeometry(0.115, 9, 7, 0, Math.PI * 2, 0, Math.PI / 2),
        materials.helmet, upper, 0, 0.51, 0.015);

    const makeArm = (x) => {
        const shoulder = new THREE.Group(); shoulder.position.set(x, 0.36, 0.02); upper.add(shoulder);
        limb(0.047, 0.23, materials.coat, shoulder);
        const elbow = new THREE.Group(); elbow.position.set(0, -0.22, 0); shoulder.add(elbow);
        limb(0.041, 0.22, materials.coat, elbow);
        mesh(new THREE.SphereGeometry(0.048, 7, 6), materials.skin, elbow, 0, -0.225, 0);
        elbow.rotation.x = -0.12;
        return { shoulder, elbow };
    };
    const armL = makeArm(-0.19);
    const armR = makeArm(0.19);

    root.userData.controls = { left, right, upper, armL, armR };
    return root;
};

// Push stance for the real soldier rigs, tuned visually in Blender against the
// reference push cycle: torso driven forward over the trails, both arms
// extended forward-and-down onto the carriage, head back up toward the road.
// Angles are radians; "down" angles are measured below the horizontal.
Game.FIELDGUN_PUSH_POSE = Object.freeze({
    torsoLean: 0.52,
    headBack: -0.42,
    upperArmDown: 0.70,
    forearmDown: 0.91,
    armFlare: 0.10,
});

// While the push is active the whole man steps in toward the carriage (world
// units, scaled by the push blend) so the reaching hands meet the trails
// instead of hovering behind them. At rest he kneels back at his placement.
Game.FIELDGUN_PUSH_CLOSE = 0.15;

// Solve the push-stance target quaternions on the actual runtime rig instead of
// baking Blender values: bone rest frames differ between the source GLB and any
// re-export, so aiming the real limb vectors here is convention-proof. Must run
// while the clone still holds its bind pose (before the mixer first updates).
Game._solveFieldGunPushPose = (figure) => {
    const THREE = Game.THREE;
    const model = figure.userData.soldierModel;
    const P = Game.FIELDGUN_PUSH_POSE;
    if (!THREE || !model || !P) return null;
    const names = {
        torso: 'torso_010', head: 'head_017',
        shoulderL: 'shoulder_left_011', armL: 'arm_left_012', fistL: 'fist_left_013',
        shoulderR: 'shoulder_right_014', armR: 'arm_right_015', fistR: 'fist_right_016',
    };
    const bones = {};
    model.traverse(object => {
        for (const key in names) if (object.name === names[key]) bones[key] = object;
    });
    if (!bones.torso || !bones.shoulderL || !bones.armL
        || !bones.shoulderR || !bones.armR) return null;

    const rest = {};
    for (const key in bones) rest[key] = bones[key].quaternion.clone();
    figure.updateMatrixWorld(true);

    // The wrapped soldier faces figure-local +Z (same tuning as line infantry);
    // the figure's own yaw has already turned him toward the breech.
    const F = new THREE.Vector3(0, 0, 1).applyQuaternion(figure.quaternion).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(F, up).normalize();
    const leanAxis = new THREE.Vector3().crossVectors(up, F).normalize();

    // Rotate a bone by a solver-frame delta, keeping its origin fixed.
    const premul = (bone, delta) => {
        const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
        bone.quaternion.premultiply(
            parentQ.clone().invert().multiply(delta).multiply(parentQ));
        figure.updateMatrixWorld(true);
    };
    // Aim the from→to limb vector at a direction (rotates the "from" bone).
    const aimLimb = (from, to, dir) => {
        const a = from.getWorldPosition(new THREE.Vector3());
        const b = to.getWorldPosition(new THREE.Vector3());
        premul(from, new THREE.Quaternion().setFromUnitVectors(
            b.sub(a).normalize(), dir));
    };
    const reach = (down, flare) => F.clone().multiplyScalar(Math.cos(down))
        .addScaledVector(up, -Math.sin(down)).addScaledVector(side, flare).normalize();

    premul(bones.torso, new THREE.Quaternion().setFromAxisAngle(leanAxis, P.torsoLean));
    aimLimb(bones.shoulderL, bones.armL, reach(P.upperArmDown, -P.armFlare));
    aimLimb(bones.shoulderR, bones.armR, reach(P.upperArmDown, P.armFlare));
    if (bones.fistL) aimLimb(bones.armL, bones.fistL, reach(P.forearmDown, -P.armFlare * 0.6));
    if (bones.fistR) aimLimb(bones.armR, bones.fistR, reach(P.forearmDown, P.armFlare * 0.6));
    if (bones.head) premul(bones.head, new THREE.Quaternion().setFromAxisAngle(leanAxis, P.headBack));

    // Capture the solved locals as blend targets, then restore the bind pose.
    const solved = ['torso', 'head', 'shoulderL', 'armL', 'shoulderR', 'armR'];
    const targets = solved.filter(key => bones[key]).map(key => ({
        bone: bones[key], quat: bones[key].quaternion.clone(),
    }));
    for (const key in bones) bones[key].quaternion.copy(rest[key]);
    figure.updateMatrixWorld(true);
    return targets;
};

Game._fieldGunSoldierRestPose = (model) => {
    const names = [
        'hip_left_06', 'knee_left_07', 'hip_right_02',
        'knee_right_03', 'torso_010',
    ];
    const rest = {};
    model.traverse(object => {
        if (!names.includes(object.name)) return;
        rest[object.name] = {
            x: object.rotation.x, y: object.rotation.y, z: object.rotation.z,
        };
        if (object.name === 'hip_left_06' || object.name === 'hip_right_02') {
            rest[object.name + '_pos'] = {
                x: object.position.x, y: object.position.y, z: object.position.z,
            };
        }
    });
    return rest;
};

Game._correctFieldGunCrewFacing = (figure) => {
    const data = figure && figure.userData;
    const root = data && data.fieldGunFacingRoot;
    const THREE = Game.THREE;
    if (!root || !root.quaternion || !THREE || !THREE.Euler) return false;
    // The source crouch frame at 23.4 s carries an almost-180° root yaw even
    // though its walk/idle frames face forward. Preserve the clip's pitch/roll
    // (the working crouch) but remove that yaw: the crew slot/gun owns heading.
    const euler = data.fieldGunFacingEuler
        || (data.fieldGunFacingEuler = new THREE.Euler(0, 0, 0, 'YXZ'));
    euler.setFromQuaternion(root.quaternion, 'YXZ');
    euler.y = 0;
    root.quaternion.setFromEuler(euler);
    return true;
};

Game._makeFieldGunSoldierCrewman = (model, placement, index) => {
    const THREE = Game.THREE;
    const figure = new THREE.Group();
    figure.name = `fieldGunSoldierCrewman_${index + 1}`;
    figure.position.set(placement.x, 0.01, placement.z);
    // Before the crew host's half-turn, the breech is toward local -Z.
    figure.rotation.y = Math.PI;

    model.scale.set(1, 1, 1);
    model.position.set(0, 0, 0);
    model.updateMatrixWorld(true);
    const nativeBox = new THREE.Box3().setFromObject(model);
    const nativeHeight = Math.max(0.001, nativeBox.max.y - nativeBox.min.y);
    const targetHeight = Game.SOLDIER_HEIGHT || 1.14;
    const scale = targetHeight / nativeHeight;
    model.scale.set(scale, scale, scale);
    model.updateMatrixWorld(true);

    // Centre the already-scaled clone, then apply the same orientation tuning
    // used by ordinary Polish infantry.
    const scaledBox = new THREE.Box3().setFromObject(model);
    model.position.x -= (scaledBox.min.x + scaledBox.max.x) * 0.5;
    model.position.z -= (scaledBox.min.z + scaledBox.max.z) * 0.5;
    model.position.x += Game.SOLDIER_OFFSET_X || 0;
    model.position.z += Game.SOLDIER_OFFSET_Z || 0;

    const modelWrapper = new THREE.Group();
    modelWrapper.name = 'fieldGunSoldierWrapper';
    modelWrapper.rotation.order = 'YXZ';
    modelWrapper.rotation.y = Game.SOLDIER_YAW || 0;
    modelWrapper.rotation.x = Game.SOLDIER_PITCH || 0;
    modelWrapper.add(model);
    modelWrapper.updateMatrixWorld(true);
    const groundedBox = new THREE.Box3().setFromObject(modelWrapper);
    modelWrapper.position.y = -groundedBox.min.y + (Game.SOLDIER_Y_TRIM || 0);
    figure.add(modelWrapper);

    model.traverse(object => {
        if (!object.isMesh) return;
        object.castShadow = true;
        object.receiveShadow = true;
    });

    const mixer = new THREE.AnimationMixer(model);
    // Splitting the 46-second source timeline is relatively expensive. All
    // SkeletonUtils clones can safely share immutable AnimationClip objects, so
    // do it once for every gun/crew member and instantiate only the three actions
    // this role can actually use.
    if (!Game._fieldGunSoldierClips) {
        const split = Game.splitSoldierAnim
            ? Game.splitSoldierAnim(model.animations || [])
            : (model.animations || []);
        const roleClips = split.filter(clip =>
            clip.name === 'idle' || clip.name === 'walk' || clip.name === 'crouch');
        Game._fieldGunSoldierClips = roleClips.length ? roleClips : split;
    }
    const clips = Game._fieldGunSoldierClips;
    const actions = {};
    clips.forEach(clip => { actions[clip.name] = mixer.clipAction(clip); });
    let facingRoot = null;
    model.traverse(object => {
        if (object.name === 'GermanSoldierRig_01') facingRoot = object;
    });

    // Make the figure look like a normal soldier to the existing animation
    // helpers, without adding it to Game.units or making it selectable.
    Object.assign(figure.userData, {
        isSoldier: true,
        isFieldGunCrewman: true,
        soldierModel: model,
        modelWrapper,
        mixer,
        actions,
        clipNames: clips.map(clip => clip.name),
        soldierLegRest: Game._fieldGunSoldierRestPose(model),
        fieldGunFacingRoot: facingRoot,
        fieldGunRole: placement.role,
        fieldGunRestStance: placement.restStance,
        fieldGunHomeZ: placement.z,
        phaseOffset: placement.phase,
    });
    // Solve while the clone is still in its bind pose, before the first
    // mixer/animation update below can disturb the limb vectors.
    figure.userData.pushPose = Game._solveFieldGunPushPose
        ? Game._solveFieldGunPushPose(figure) : null;
    figure.userData.animationUnit = {
        mesh: figure,
        stance: placement.restStance,
        currentSpeed: 0,
        _dispSpeed: 0,
    };
    if (Game._updateModelAnimation) {
        Game._updateModelAnimation(figure.userData.animationUnit, 0);
    }
    Game._correctFieldGunCrewFacing(figure);
    return figure;
};

Game._disposeFieldGunFallback = (crew) => {
    if (!crew || crew.userData.crewMode !== 'fallback' || !crew.traverse) return;
    const geometries = new Set();
    const materials = new Set();
    crew.traverse(object => {
        if (!object.isMesh) return;
        if (object.geometry) geometries.add(object.geometry);
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.filter(Boolean).forEach(material => materials.add(material));
    });
    geometries.forEach(geometry => geometry.dispose && geometry.dispose());
    materials.forEach(material => material.dispose && material.dispose());
};

Game._releaseFieldGunCrew = (crew) => {
    if (!crew) return;
    crew.userData.loadToken = null;
    (crew.userData.figures || []).forEach(figure => {
        const data = figure.userData || {};
        const mixer = data.mixer;
        if (mixer && mixer.stopAllAction) mixer.stopAllAction();
        if (mixer && mixer.uncacheRoot && data.soldierModel) {
            mixer.uncacheRoot(data.soldierModel);
        }
        // applySoldierSkin clones materials per figure. Dispose those wrappers,
        // but never shared geometries or cached texture maps.
        if (crew.userData.crewMode === 'soldier' && data.soldierModel) {
            const materials = new Set();
            data.soldierModel.traverse(object => {
                if (!object.isMesh || !object.material) return;
                const list = Array.isArray(object.material) ? object.material : [object.material];
                list.filter(Boolean).forEach(material => materials.add(material));
            });
            materials.forEach(material => material.dispose && material.dispose());
        }
    });
    Game._disposeFieldGunFallback(crew);
};

Game.detachFieldGunCrew = (unitMesh) => {
    const crew = unitMesh && unitMesh.userData && unitMesh.userData.fieldGunCrew;
    if (!crew) return false;
    Game._releaseFieldGunCrew(crew);
    unitMesh.remove(crew);
    unitMesh.userData.fieldGunCrew = null;
    return true;
};

Game._loadFieldGunSoldierCrew = async (unit, unitMesh, crew) => {
    if (!Game.loadModel || !Game.applySoldierSkin || !Game.SOLDIER_MODEL_PATH) {
        throw new Error('shared soldier model pipeline is unavailable');
    }
    const token = crew.userData.loadToken;
    const gunWrapper = unitMesh.userData.modelWrapper;
    const isCurrent = () => unit.mesh === unitMesh
        && unit.alive !== false
        && unitMesh.userData.fieldGunCrew === crew
        && crew.userData.loadToken === token
        && unitMesh.userData.modelWrapper === gunWrapper
        && (!Game.getUnitById || unit.id == null || Game.getUnitById(unit.id) === unit);
    const config = (Game.GUN_CREWS && Game.GUN_CREWS[unit.kind]) || Game.GUN_CREWS.fieldgun75;
    const placements = config.placements;
    const models = await Promise.all(placements.map(() => Game.loadModel(Game.SOLDIER_MODEL_PATH)));
    if (!isCurrent()) return false;

    const figures = models.map((model, index) => {
        // Skin the shared rig for the GUN'S team: Polish crews for the 75 mm,
        // French crews for the Hotchkiss, without new animation work.
        Game.applySoldierSkin(model, unit.team, 'fieldgun_crew');
        return Game._makeFieldGunSoldierCrewman(model, placements[index], index);
    });
    if (!isCurrent()) return false;

    Game._disposeFieldGunFallback(crew);
    [...crew.children].forEach(child => crew.remove(child));
    figures.forEach(figure => crew.add(figure));
    crew.userData.figures = figures;
    crew.userData.crewMode = 'soldier';
    crew.userData.skinSource = Game.SOLDIER_MODEL_PATH;
    crew.userData.materials = null;
    Game.updateFieldGunCrew(unit, 0);
    return true;
};

Game.attachFieldGunCrew = (unit, unitMesh) => {
    const config = unit && Game.GUN_CREWS && Game.GUN_CREWS[unit.kind];
    if (!unit || !config || !unitMesh || !Game.THREE) return false;
    const THREE = Game.THREE;
    const old = unitMesh.userData.fieldGunCrew;
    if (old) {
        Game.detachFieldGunCrew(unitMesh);
    }

    const crew = new THREE.Group();
    crew.name = 'fieldGunCrew';
    const skin = (Game.GUN_CREW_FALLBACK_SKINS && Game.GUN_CREW_FALLBACK_SKINS[unit.team])
        || Game.FIELDGUN75_CREW_SKIN;
    const coat = new THREE.Color(
        (Game.SOLDIER_SKIN_TINT && Game.SOLDIER_SKIN_TINT[unit.team])
        || skin.coatFallback
    );
    const materials = {
        coat: new THREE.MeshStandardMaterial({ color: coat, roughness: 0.92 }),
        trousers: new THREE.MeshStandardMaterial({
            color: coat.clone().multiplyScalar(0.72), roughness: 0.95,
        }),
        boots: new THREE.MeshStandardMaterial({ color: 0x211b16, roughness: 0.96 }),
        leather: new THREE.MeshStandardMaterial({ color: 0x38281b, roughness: 0.88 }),
        skin: new THREE.MeshStandardMaterial({ color: skin.skin, roughness: 0.9 }),
        helmet: new THREE.MeshStandardMaterial({ color: skin.helmet, roughness: 0.76 }),
    };

    // Two cheap articulated figures cover the short async load window and are
    // retained only if the shared soldier asset fails. The normal path below
    // replaces them with the two proper crewmen.
    const positions = config.placements.slice(0, 2);
    crew.userData.figures = positions.map((placement, index) => {
        const figure = Game._makeFieldGunCrewman(materials);
        figure.name = `fieldGunCrewman_${index + 1}`;
        figure.position.set(placement.x, 0.01, placement.z);
        // These placements are authored against the gun immediately after its
        // generic X-axis normalization: barrel -Z, trails +Z. The crew group's
        // per-model yaw below then turns both placement and facing with the gun.
        figure.rotation.y = Math.PI;
        figure.userData.baseY = 0.01;
        figure.userData.kneelSide = index % 2;
        figure.userData.fieldGunHomeZ = placement.z;
        figure.userData.phaseOffset = placement.phase;
        crew.add(figure);
        return figure;
    });
    // Crew are siblings of modelWrapper, so they do not inherit MODEL_YAW.
    // Apply only the per-model correction (not the wrapper's automatic -90°)
    // to put them behind the now +Z-facing bore and facing its breech.
    crew.rotation.y = (Game.MODEL_YAW && Game.MODEL_YAW[`${unit.team}_${unit.kind}`]) || 0;
    crew.userData.skinTeam = unit.team;
    crew.userData.uniformTint = coat.getHex();
    crew.userData.materials = materials;
    crew.userData.crewMode = 'fallback';
    crew.userData.expectedCrewCount = config.placements.length;
    crew.userData.loadToken = {};
    unitMesh.add(crew);
    unitMesh.userData.fieldGunCrew = crew;
    unit._crewAboard = unit._crewAboard ?? config.placements.length;
    unitMesh.userData.fieldGunPushTime = 0;
    unitMesh.userData.fieldGunPushBlend = 0;
    Game.updateFieldGunCrew(unit, 0);
    Game._loadFieldGunSoldierCrew(unit, unitMesh, crew).catch(error => {
        if (unitMesh.userData.fieldGunCrew !== crew || !crew.userData.loadToken) return;
        if (!Game._fieldGunCrewLoadWarned) {
            Game._fieldGunCrewLoadWarned = true;
            console.warn('Gun crew model failed; using lightweight fallback.', error);
        }
    });
    return true;
};

Game._sampleFieldGunPush = (phase) => {
    const keys = Game.FIELDGUN_PUSH_KEYS;
    const scaled = ((phase % 1) + 1) % 1 * keys.length;
    const index = Math.floor(scaled) % keys.length;
    const next = (index + 1) % keys.length;
    const t = scaled - Math.floor(scaled);
    const pose = {};
    for (const key of Object.keys(keys[index])) {
        pose[key] = Game.lerp(keys[index][key], keys[next][key], t);
    }
    return pose;
};

// Roll the wheels with the carriage. The GLB carries `wheel_left`/`wheel_right`
// nodes with hub-centred origins; the axle is the disc's thin local axis, so
// the spin adapts to whatever axis conventions load/export produced.
Game.updateFieldGunWheels = (unit, dt) => {
    const THREE = Game.THREE;
    const ud = unit && unit.mesh && unit.mesh.userData;
    if (!THREE || !ud) return;
    const wrapper = ud.modelWrapper;
    const childCount = wrapper ? wrapper.children.length : 0;
    if (ud.fieldGunWheels === undefined || ud.fieldGunWheelScan !== childCount) {
        // The gun model arrives asynchronously: rescan whenever the wrapper's
        // content changes, so a late load still finds its wheels.
        ud.fieldGunWheelScan = childCount;
        const found = [];
        unit.mesh.traverse(object => {
            if (object.name !== 'wheel_left' && object.name !== 'wheel_right') return;
            const geometry = object.geometry;
            if (!geometry) return;
            if (!geometry.boundingBox) geometry.computeBoundingBox();
            const size = geometry.boundingBox.getSize(new THREE.Vector3());
            const axis = size.x < size.y && size.x < size.z ? 'x'
                : (size.y < size.z ? 'y' : 'z');
            found.push({
                node: object,
                axle: new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0),
                radiusLocal: Math.max(size.x, size.y, size.z) * 0.5,
            });
        });
        ud.fieldGunWheels = found.length ? found : null;
    }
    const lastX = ud.fieldGunWheelX, lastZ = ud.fieldGunWheelZ;
    ud.fieldGunWheelX = unit.x;
    ud.fieldGunWheelZ = unit.z;
    if (!ud.fieldGunWheels || lastX == null || !(dt > 0)) return;
    const dx = unit.x - lastX, dz = unit.z - lastZ;
    if (dx * dx + dz * dz < 1e-10) return;
    const tmp = Game._fieldGunWheelTmp || (Game._fieldGunWheelTmp = {
        up: new THREE.Vector3(0, 1, 0),
        disp: new THREE.Vector3(),
        roll: new THREE.Vector3(),
        axle: new THREE.Vector3(),
        col: new THREE.Vector3(),
    });
    tmp.disp.set(dx, 0, dz);
    // Rolling without slipping: the rotation vector for this displacement is
    // (up × d) / r; each wheel takes its component along its own world axle.
    tmp.roll.crossVectors(tmp.up, tmp.disp);
    for (const wheel of ud.fieldGunWheels) {
        const scale = tmp.col.setFromMatrixColumn(wheel.node.matrixWorld, 1).length() || 1;
        const radius = Math.max(1e-4, wheel.radiusLocal * scale);
        tmp.axle.copy(wheel.axle).transformDirection(wheel.node.matrixWorld);
        wheel.node.rotateOnAxis(wheel.axle, tmp.roll.dot(tmp.axle) / radius);
    }
};

// Snap the crew back to the exact state they were built in: every action
// stopped, all accumulated clip/gait/blend state cleared, then the rest pose
// replayed from scratch. This is the same path the initial load takes, so the
// post-move rest can never drift from the spawn kneel.
Game._resetFieldGunCrewRest = (unit, crew) => {
    const ud = unit.mesh.userData;
    ud.fieldGunPushBlend = 0;
    ud.fieldGunPushTime = 0;
    (crew.userData.figures || []).forEach(figure => {
        const data = figure.userData;
        if (data.mixer && data.mixer.stopAllAction) data.mixer.stopAllAction();
        data._activeClip = null;
        data._clipSince = undefined;
        data._gaitBlend = 0;
        data._gaitPhase = 0;
        data._locoOn = false;
        data._runOn = false;
        const animationUnit = data.animationUnit;
        if (animationUnit) {
            animationUnit.stance = data.fieldGunRestStance || 'crouch';
            animationUnit.currentSpeed = 0;
            animationUnit._dispSpeed = 0;
            if (Game._updateModelAnimation) Game._updateModelAnimation(animationUnit, 0);
        }
        Game._correctFieldGunCrewFacing(figure);
        figure.position.y = 0.01;
        if (data.fieldGunHomeZ != null) figure.position.z = data.fieldGunHomeZ;
    });
};

Game.updateFieldGunCrew = (unit, dt) => {
    const ud = unit && unit.mesh && unit.mesh.userData;
    const crew = ud && ud.fieldGunCrew;
    if (Game.updateFieldGunWheels) Game.updateFieldGunWheels(unit, dt);
    if (!crew || !crew.userData.figures) return;
    // Towed: the crew has climbed aboard the towing truck. Unmanned: they
    // dismounted as real infantry. Either way the decorative crew hides
    // (wheels above keep rolling while towed).
    if (unit._towed || unit._unmanned) {
        crew.visible = false;
        return;
    }
    if (!crew.visible) crew.visible = true;
    const speed = unit._dispSpeed != null ? unit._dispSpeed : (unit.currentSpeed || 0);
    // Hysteresis: engage the push at walk-clip pace (0.3, as _chooseClip), and
    // drop it at the PROCEDURAL GAIT threshold (0.2, _soldierProceduralLegs),
    // not below it. A lower drop-out kept "pushing" latched while the settling
    // gun micro-jittered at 0.12..0.2 — a band where the walk clip plays but
    // the gait is off, freezing the crew in a leaning half-stand. Pushing must
    // imply striding legs; anything slower kneels.
    const pushing = speed > (ud.fieldGunPushOn ? 0.2 : 0.3) && unit._canMove !== false;
    // Movement just ended: let the pose EASE out (crouch crossfade + blend
    // decay below), then anchor on the exact spawn rest state once the blend
    // has died away — smooth on the way down, identical to load at the end.
    if (ud.fieldGunPushOn && !pushing) ud.fieldGunRestPending = true;
    if (pushing) ud.fieldGunRestPending = false;
    ud.fieldGunPushOn = pushing;
    const response = Math.min(1, Math.max(0, dt * 7));
    ud.fieldGunPushBlend = Game.lerp(ud.fieldGunPushBlend || 0, pushing ? 1 : 0, response);
    if (pushing) {
        const cadence = Game.clamp(speed / 1.3, 0.55, 1.45);
        ud.fieldGunPushTime = ((ud.fieldGunPushTime || 0) + dt * cadence) % 1;
    }

    let blend = ud.fieldGunPushBlend || 0;
    if (ud.fieldGunRestPending && !pushing && blend < 0.02 && Game._resetFieldGunCrewRest) {
        // The ease-out has finished (the crouch is already showing at nearly
        // full weight), so rebuilding the state now is visually seamless.
        ud.fieldGunRestPending = false;
        Game._resetFieldGunCrewRest(unit, crew);
        blend = 0;
    }
    if (crew.userData.crewMode === 'soldier') {
        // These are genuine soldier rigs. Feed them through the same clip,
        // speed-sync and procedural-leg pipeline as ordinary Polish infantry so
        // both crewmen walk instead of sliding while the carriage is being pushed.
        crew.userData.figures.forEach(figure => {
            const data = figure.userData;
            const animationUnit = data.animationUnit;
            if (!animationUnit) return;
            animationUnit._dispSpeed = pushing ? speed : 0;
            animationUnit.currentSpeed = pushing ? speed : 0;
            animationUnit.stance = pushing ? 'stand' : (data.fieldGunRestStance || 'crouch');
            const previousClip = data._activeClip;
            if (Game._updateModelAnimation) {
                Game._updateModelAnimation(animationUnit, dt);
            } else if (data.mixer) {
                data.mixer.update(dt);
            }
            // A resting artilleryman KNEELS, unconditionally. The shared clip
            // chooser has speed/stance/min-hold bands that can strand a crewman
            // in the standing idle after a move; his rest pose is not
            // negotiable, so force the clip rather than trust the chooser.
            if (!pushing && data._activeClip !== 'crouch'
                && data.actions && data.actions.crouch && Game._playClip) {
                Game._playClip(animationUnit, 'crouch', Game.SOLDIER_POSTURE_FADE || 0.3);
            }
            // Animation clips may pose the body, but they must never turn an
            // artilleryman away from the heading established by his crew slot.
            Game._correctFieldGunCrewFacing(figure);
            // Stagger both strides whenever a new locomotion clip begins.
            // The gait phase is separate because soldier.glb's baked walk keeps
            // its legs static and the shared procedural gait supplies the step.
            const activeClip = data._activeClip;
            if (pushing && activeClip !== previousClip
                && (activeClip === 'walk' || activeClip === 'run')) {
                const action = data.actions && data.actions[activeClip];
                const clip = action && action.getClip && action.getClip();
                const phase = data.phaseOffset || 0;
                if (action && clip && clip.duration) action.time = clip.duration * phase;
                data._gaitPhase = Math.PI * 2 * phase;
            }
            // Push stance: blend the upper body from the clip's port-arms pose
            // into the solved lean-and-reach so the hands stay planted on the
            // carriage while the legs keep the shared procedural stride.
            if (data.pushPose && blend > 0.01) {
                for (const target of data.pushPose) {
                    target.bone.quaternion.slerp(target.quat, blend);
                }
            }
            figure.position.y = 0.01;
            if (data.fieldGunHomeZ != null) {
                figure.position.z = data.fieldGunHomeZ
                    - (Game.FIELDGUN_PUSH_CLOSE || 0) * blend;
            }
        });
    } else {
        // Load-failure fallback: the two simple articulated figures mirror the
        // planted/kneeling leg, then rise smoothly into the push stride.
        crew.userData.figures.forEach(figure => {
            const leftDown = figure.userData.kneelSide === 0;
            const idle = {
                hipL: leftDown ? 0.30 : 0.08,
                hipR: leftDown ? 0.08 : 0.30,
                kneeL: leftDown ? -1.55 : -0.12,
                kneeR: leftDown ? -0.12 : -1.55,
                bob: 0, torso: 0.14,
                armL: leftDown ? -1.05 : -0.96,
                armR: leftDown ? -0.96 : -1.05,
                rootY: -0.25,
                hipLiftL: leftDown ? 0 : 0.25,
                hipLiftR: leftDown ? 0.25 : 0,
            };
            const moving = Game._sampleFieldGunPush(
                (ud.fieldGunPushTime || 0) + (figure.userData.phaseOffset || 0));
            moving.rootY = 0;
            moving.hipLiftL = 0;
            moving.hipLiftR = 0;
            const pose = {};
            for (const key of Object.keys(idle)) pose[key] = Game.lerp(idle[key], moving[key], blend);
            const c = figure.userData.controls;
            c.left.hip.rotation.x = pose.hipL;
            c.right.hip.rotation.x = pose.hipR;
            c.left.hip.position.y = 0.55 + pose.hipLiftL;
            c.right.hip.position.y = 0.55 + pose.hipLiftR;
            c.left.knee.rotation.x = pose.kneeL;
            c.right.knee.rotation.x = pose.kneeR;
            c.upper.position.y = 0.55 + pose.bob;
            c.upper.rotation.x = pose.torso;
            c.armL.shoulder.rotation.x = pose.armL;
            c.armR.shoulder.rotation.x = pose.armR;
            figure.position.y = (figure.userData.baseY || 0) + pose.rootY;
            if (figure.userData.fieldGunHomeZ != null) {
                figure.position.z = figure.userData.fieldGunHomeZ
                    - (Game.FIELDGUN_PUSH_CLOSE || 0) * blend;
            }
        });
    }

    // Real firing action, triggered by combat.js. With the corrected bore on
    // local +Z, the complete carriage and crew recoil toward local -Z.
    const wrapper = ud.modelWrapper;
    if (wrapper && ud.fieldGunBaseZ == null) ud.fieldGunBaseZ = wrapper.position.z;
    if (wrapper && unit.recoilTime > 0) {
        const duration = 0.46;
        const t = unit.recoilTime;
        const envelope = Math.exp(-7.5 * t) * Math.sin(19 * t);
        wrapper.position.z = ud.fieldGunBaseZ - 0.13 * envelope;
        crew.position.z = -0.035 * envelope;
        crew.userData.figures.forEach(figure => {
            const controls = figure.userData.controls;
            if (controls && controls.upper) {
                controls.upper.rotation.x += 0.10 * envelope;
                return;
            }
            const animationUnit = figure.userData.animationUnit;
            const bones = animationUnit && Game._soldierLegBones
                ? Game._soldierLegBones(animationUnit) : null;
            if (bones && bones.torso) bones.torso.rotation.x += 0.10 * envelope;
        });
        unit.recoilTime += dt;
        if (unit.recoilTime >= duration) {
            unit.recoilTime = 0;
            wrapper.position.z = ud.fieldGunBaseZ;
            crew.position.z = 0;
        }
    } else if (wrapper && unit.recoilTime === 0) {
        wrapper.position.z = ud.fieldGunBaseZ;
        crew.position.z = 0;
    }
};

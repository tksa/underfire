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
    Object.freeze({ x: -0.23, z: 0.48, phase: 0.00, restStance: 'crouch', role: 'trail_left' }),
    Object.freeze({ x:  0.23, z: 0.64, phase: 0.50, restStance: 'crouch', role: 'trail_right' }),
]);

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
        phaseOffset: placement.phase,
    });
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
    const placements = Game.FIELDGUN75_CREW_PLACEMENTS;
    const models = await Promise.all(placements.map(() => Game.loadModel(Game.SOLDIER_MODEL_PATH)));
    if (!isCurrent()) return false;

    const figures = models.map((model, index) => {
        Game.applySoldierSkin(model, Game.TEAM.POLISH, 'fieldgun_crew');
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
    if (!unit || unit.kind !== 'fieldgun75' || !unitMesh || !Game.THREE) return false;
    const THREE = Game.THREE;
    const old = unitMesh.userData.fieldGunCrew;
    if (old) {
        Game.detachFieldGunCrew(unitMesh);
    }

    const crew = new THREE.Group();
    crew.name = 'fieldGunCrew';
    const skin = Game.FIELDGUN75_CREW_SKIN;
    const polishCoat = new THREE.Color(
        (Game.SOLDIER_SKIN_TINT && Game.SOLDIER_SKIN_TINT.polish)
        || skin.coatFallback
    );
    const materials = {
        coat: new THREE.MeshStandardMaterial({ color: polishCoat, roughness: 0.92 }),
        trousers: new THREE.MeshStandardMaterial({
            color: polishCoat.clone().multiplyScalar(0.72), roughness: 0.95,
        }),
        boots: new THREE.MeshStandardMaterial({ color: 0x211b16, roughness: 0.96 }),
        leather: new THREE.MeshStandardMaterial({ color: 0x38281b, roughness: 0.88 }),
        skin: new THREE.MeshStandardMaterial({ color: skin.skin, roughness: 0.9 }),
        helmet: new THREE.MeshStandardMaterial({ color: skin.helmet, roughness: 0.76 }),
    };

    // Two cheap articulated figures cover the short async load window and are
    // retained only if the shared soldier asset fails. The normal path below
    // replaces them with the two proper crewmen.
    const positions = Game.FIELDGUN75_CREW_PLACEMENTS.slice(0, 2);
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
        figure.userData.phaseOffset = placement.phase;
        crew.add(figure);
        return figure;
    });
    // Crew are siblings of modelWrapper, so they do not inherit MODEL_YAW.
    // Apply only the per-model correction (not the wrapper's automatic -90°)
    // to put them behind the now +Z-facing bore and facing its breech.
    crew.rotation.y = (Game.MODEL_YAW && Game.MODEL_YAW.polish_fieldgun75) || 0;
    crew.userData.skinTeam = skin.team;
    crew.userData.uniformTint = polishCoat.getHex();
    crew.userData.materials = materials;
    crew.userData.crewMode = 'fallback';
    crew.userData.expectedCrewCount = Game.FIELDGUN75_CREW_COUNT;
    crew.userData.loadToken = {};
    unitMesh.add(crew);
    unitMesh.userData.fieldGunCrew = crew;
    unitMesh.userData.fieldGunPushTime = 0;
    unitMesh.userData.fieldGunPushBlend = 0;
    Game.updateFieldGunCrew(unit, 0);
    Game._loadFieldGunSoldierCrew(unit, unitMesh, crew).catch(error => {
        if (unitMesh.userData.fieldGunCrew !== crew || !crew.userData.loadToken) return;
        if (!Game._fieldGunCrewLoadWarned) {
            Game._fieldGunCrewLoadWarned = true;
            console.warn('Polish field-gun crew model failed; using lightweight fallback.', error);
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

Game.updateFieldGunCrew = (unit, dt) => {
    const ud = unit && unit.mesh && unit.mesh.userData;
    const crew = ud && ud.fieldGunCrew;
    if (!crew || !crew.userData.figures) return;
    const speed = unit._dispSpeed != null ? unit._dispSpeed : (unit.currentSpeed || 0);
    const pushing = speed > 0.06 && unit._canMove !== false;
    const response = Math.min(1, Math.max(0, dt * 7));
    ud.fieldGunPushBlend = Game.lerp(ud.fieldGunPushBlend || 0, pushing ? 1 : 0, response);
    if (pushing) {
        const cadence = Game.clamp(speed / 1.3, 0.55, 1.45);
        ud.fieldGunPushTime = ((ud.fieldGunPushTime || 0) + dt * cadence) % 1;
    }

    const blend = ud.fieldGunPushBlend || 0;
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
            figure.position.y = 0.01;
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

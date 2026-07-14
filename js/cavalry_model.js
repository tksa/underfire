/**
 * Under Fire — mounted Polish cavalry model + state transitions.
 *
 * The supplied GLB is a single in-place horse/rider rig with 17 named clips.
 * This module maps those authored names onto the engine animator, keeps the
 * gait synchronized to measured ground speed, parks a riderless clone of the
 * horse after dismounting, and swaps the linked reserve Ułan to the existing
 * Polish foot soldier without changing ordinary Ułans already on the map.
 */

Game.CAVALRY_MODEL_PATH = 'models/polish_mounted_ulan.glb';

Game.CAVALRY_MOVE = Object.freeze({
    acceleration: 3.0,       // world units / s²: walk first, then build to gallop
    braking: 5.2,            // firm but progressive stop; used by v² = 2ad
    walkRunSpeed: 4.6,       // animation gait boundary with hysteresis in renderer
    walkReferenceSpeed: 2.8, // authored clip playback = 1x around this ground speed
    runReferenceSpeed: 7.2,
    minGaitTimeScale: 0.06,  // let the final stride visibly ease down before idle
    minMovingSpeed: 0.12,
    arrivalRadius: 0.65,
});

Game.isCavalryPath = (path) => path === Game.CAVALRY_MODEL_PATH;

// Riderless horses are persistent presentation/interaction actors, deliberately
// kept outside Game.units so they cannot be selected, commanded, targeted, count
// toward mission strength, or enter ordinary unit simulation. The source GLB's
// horse and rider share one SkinnedMesh, but every triangle is influenced wholly
// by either horse bones or rider/weapon bones, allowing a clean index-only split
// of the already-loaded model without downloading a second 8 MB asset.
Game.CAVALRY_HORSE_BONES = Object.freeze(new Set([
    'Root', 'HorseBody', 'HorseNeck', 'HorseHead', 'Tail',
    'HorseFrontLeg_L', 'HorseFrontLeg_R',
    'HorseBackLeg_L', 'HorseBackLeg_R',
]));
Game.CAVALRY_HORSE_ENTRY_OFFSET = 0.82;
Game.CAVALRY_HORSE_ARRIVAL_RADIUS = 0.46;
Game.CAVALRY_DISMOUNT_TIME_SCALE = 1.7;
// The mounted asset is intentionally 15% smaller than its earlier presentation.
// A parked clone retains that exact transform so the horse never changes size
// during dismount; only the rider swaps to the normal foot-infantry scale.
Game.CAVALRY_MOUNTED_SCALE = 0.85;
Game.cavalryHorses = Game.cavalryHorses || [];
Game._cavalryHorseSerial = Game._cavalryHorseSerial || 0;
Game._cavalryHorseGeometryCache = Game._cavalryHorseGeometryCache || new WeakMap();

Game.cavalryHorseById = (id) => (Game.cavalryHorses || [])
    .find(horse => horse.id === id) || null;

Game.cavalryHorseForRider = (unit) => unit
    ? (Game.cavalryHorses || []).find(horse => horse.riderId === unit.id) || null
    : null;

Game._horseOnlyGeometry = (mesh) => {
    const source = mesh && mesh.geometry;
    if (!source) return null;
    const cached = Game._cavalryHorseGeometryCache.get(source);
    if (cached !== undefined) return cached;

    const positions = source.getAttribute && source.getAttribute('position');
    const skinIndex = source.getAttribute && source.getAttribute('skinIndex');
    const skinWeight = source.getAttribute && source.getAttribute('skinWeight');
    const bones = mesh.skeleton && mesh.skeleton.bones;
    if (!positions || !skinIndex || !skinWeight || !bones || !bones.length) {
        Game._cavalryHorseGeometryCache.set(source, null);
        return null;
    }

    const horseVertex = new Uint8Array(positions.count);
    const jointAt = (attribute, vertex, component) => {
        if (component === 0) return attribute.getX(vertex);
        if (component === 1) return attribute.getY(vertex);
        if (component === 2) return attribute.getZ(vertex);
        return attribute.getW(vertex);
    };
    for (let vertex = 0; vertex < positions.count; vertex++) {
        let influenced = false;
        let horseOnly = true;
        for (let component = 0; component < 4; component++) {
            const weight = jointAt(skinWeight, vertex, component);
            if (weight <= 0.0001) continue;
            influenced = true;
            const joint = Math.round(jointAt(skinIndex, vertex, component));
            const boneName = bones[joint] && bones[joint].name;
            if (!Game.CAVALRY_HORSE_BONES.has(boneName)) {
                horseOnly = false;
                break;
            }
        }
        horseVertex[vertex] = influenced && horseOnly ? 1 : 0;
    }

    const sourceIndex = source.index && source.index.array;
    const indexCount = sourceIndex ? sourceIndex.length : positions.count;
    const indexAt = i => sourceIndex ? sourceIndex[i] : i;
    const kept = [];
    for (let i = 0; i + 2 < indexCount; i += 3) {
        const a = indexAt(i), b = indexAt(i + 1), c = indexAt(i + 2);
        if (horseVertex[a] && horseVertex[b] && horseVertex[c]) kept.push(a, b, c);
    }
    if (!kept.length) {
        Game._cavalryHorseGeometryCache.set(source, null);
        return null;
    }

    const geometry = source.clone();
    geometry.setIndex(kept);
    geometry.setDrawRange(0, kept.length);
    geometry.clearGroups();
    geometry.addGroup(0, kept.length, 0);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData = { ...(geometry.userData || {}), horseOnly: true, triangleCount: kept.length / 3 };
    Game._cavalryHorseGeometryCache.set(source, geometry);
    return geometry;
};

Game._proceduralEmptyHorse = () => {
    const THREE = Game.THREE;
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: 0x75533a, roughness: 0.88 });
    const add = (geometry, x, y, z, sx, sy, sz, rx = 0, rz = 0) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x, y, z);
        mesh.scale.set(sx, sy, sz);
        mesh.rotation.x = rx;
        mesh.rotation.z = rz;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
    };
    add(new THREE.SphereGeometry(0.55, 8, 6), 0, 0.95, 0, 0.72, 0.68, 1.25);
    add(new THREE.CylinderGeometry(0.18, 0.28, 0.95, 7), 0, 1.48, 0.72, 1, 1, 1, -0.48);
    add(new THREE.SphereGeometry(0.28, 7, 5), 0, 1.83, 1.02, 0.82, 0.72, 1.05);
    [[-0.33, -0.55], [0.33, -0.55], [-0.33, 0.55], [0.33, 0.55]].forEach(([x, z]) => {
        add(new THREE.CylinderGeometry(0.075, 0.09, 0.9, 6), x, 0.43, z, 1, 1, 1);
    });
    group.userData.proceduralHorseFallback = true;
    return group;
};

Game._cloneRiderlessHorseWrapper = (unit) => {
    const liveWrapper = unit && unit.mesh && unit.mesh.userData.modelWrapper;
    if (!liveWrapper || !Game.THREE) return { wrapper: Game._proceduralEmptyHorse(), mixer: null, triangles: 0 };
    const wrapper = Game.SkeletonUtils
        ? Game.SkeletonUtils.clone(liveWrapper)
        : liveWrapper.clone(true);
    const remove = [];
    let horseMeshes = 0;
    let triangles = 0;
    wrapper.traverse(object => {
        if (!object.isMesh) return;
        const geometry = object.isSkinnedMesh ? Game._horseOnlyGeometry(object) : null;
        if (!geometry) {
            remove.push(object);
            return;
        }
        object.geometry = geometry;
        object.userData = { ...(object.userData || {}), riderlessHorseMesh: true };
        object.castShadow = true;
        object.receiveShadow = true;
        horseMeshes++;
        triangles += geometry.userData.triangleCount || 0;
    });
    remove.forEach(object => {
        if (object.parent) object.parent.remove(object);
    });
    if (!horseMeshes) return { wrapper: Game._proceduralEmptyHorse(), mixer: null, triangles: 0 };

    const clips = (unit.mesh.userData.animations || []).filter(Boolean);
    const idle = clips.find(clip => clip.name === 'idle' || clip.name === 'Idle_Standing');
    let mixer = null;
    if (idle) {
        mixer = new Game.THREE.AnimationMixer(wrapper);
        const action = mixer.clipAction(idle);
        action.reset();
        action.setLoop(Game.THREE.LoopRepeat, Infinity);
        action.play();
        mixer.update(0);
    }
    return { wrapper, mixer, triangles };
};

Game.cavalryHorseEntryPoints = (horse) => {
    if (!horse) return [];
    const forwardX = Math.cos(horse.angle || 0), forwardZ = Math.sin(horse.angle || 0);
    const leftX = -forwardZ, leftZ = forwardX;
    const offset = Game.CAVALRY_HORSE_ENTRY_OFFSET;
    const candidates = [
        { x: horse.x + leftX * offset, z: horse.z + leftZ * offset },
        { x: horse.x + leftX * offset - forwardX * 0.35, z: horse.z + leftZ * offset - forwardZ * 0.35 },
        { x: horse.x + leftX * offset + forwardX * 0.35, z: horse.z + leftZ * offset + forwardZ * 0.35 },
        { x: horse.x - leftX * offset, z: horse.z - leftZ * offset },
    ];
    // If the authored left/right positions are obstructed, progressively fan
    // around the horse. This preserves a natural side approach in open ground
    // while allowing a rider to use another reachable side near woods/buildings.
    [1.0, 1.35, 1.7].forEach(radiusScale => {
        for (let i = 0; i < 8; i++) {
            const angle = (horse.angle || 0) + i * Math.PI / 4;
            candidates.push({
                x: horse.x + Math.cos(angle) * offset * radiusScale,
                z: horse.z + Math.sin(angle) * offset * radiusScale,
            });
        }
    });
    const seen = new Set();
    return candidates.filter(point => {
        if (point.x < 1 || point.z < 1 || point.x > Game.WORLD_W - 1 || point.z > Game.WORLD_H - 1) return false;
        const tile = Game.getTileAtWorld ? Game.getTileAtWorld(point.x, point.z) : true;
        if (!tile || tile.blocked) return false;
        const key = `${point.x.toFixed(2)}:${point.z.toFixed(2)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

Game.cavalryHorseEntryPoint = (horse, unit = null) => {
    const pool = Game.cavalryHorseEntryPoints(horse);
    if (!pool.length) return null;
    if (!unit) return pool[0];
    return pool.reduce((best, point) => Game.distSq(unit.x, unit.z, point.x, point.z)
        < Game.distSq(unit.x, unit.z, best.x, best.z) ? point : best, pool[0]);
};

Game._cavalryHorseEntryPath = (unit, point) => {
    if (!unit || !point) return [];
    const path = Game.findPath(unit, unit.x, unit.z, point.x, point.z) || [];
    const last = path.length ? path[path.length - 1] : { x: unit.x, z: unit.z };
    if (Game.distSq(last.x, last.z, point.x, point.z) > 0.01
        && (!Game.segmentPassable || Game.segmentPassable(unit, last.x, last.z, point.x, point.z))) {
        path.push({ x: point.x, z: point.z, _horseEntry: true });
    }
    return path;
};

Game._cavalryHorseEntryRoute = (unit, horse, startIndex = 0) => {
    if (!unit || !horse) return null;
    const points = Game.cavalryHorseEntryPoints(horse)
        .sort((a, b) => Game.distSq(unit.x, unit.z, a.x, a.z)
            - Game.distSq(unit.x, unit.z, b.x, b.z));
    if (!points.length) return null;
    for (let offset = 0; offset < points.length; offset++) {
        const index = (startIndex + offset) % points.length;
        const point = points[index];
        const closeEnough = Game.distSq(unit.x, unit.z, point.x, point.z)
            <= Game.CAVALRY_HORSE_ARRIVAL_RADIUS ** 2;
        const path = closeEnough ? [] : Game._cavalryHorseEntryPath(unit, point);
        if (closeEnough || path.length) {
            return { point, path, nextIndex: (index + 1) % points.length };
        }
    }
    return null;
};

Game._parkCavalryHorse = (unit) => {
    if (!unit || !unit.alive) return null;
    const existing = Game.cavalryHorseForRider(unit);
    if (existing) {
        unit._cavalryParkPose = null;
        return existing;
    }
    // Capture occurs immediately before the authored dismount clip starts. Use
    // that exact stationary pose rather than any later render/model transform,
    // making the horse's post-animation world position an explicit invariant.
    const parkPose = unit._cavalryParkPose || unit;
    const id = `horse-${unit.id}-${++Game._cavalryHorseSerial}`;
    const cloned = Game._cloneRiderlessHorseWrapper(unit);
    const horse = {
        id,
        riderId: unit.id,
        team: unit.team,
        state: 'empty',
        reservedBy: null,
        x: parkPose.x,
        z: parkPose.z,
        y: Game.getHeight ? Game.getHeight(parkPose.x, parkPose.z) : (parkPose.y || 0),
        angle: parkPose.angle || 0,
        mesh: null,
        mixer: cloned.mixer,
        triangleCount: cloned.triangles,
    };
    const root = new Game.THREE.Group();
    root.name = id;
    root.userData.cavalryHorseId = id;
    root.position.set(horse.x, horse.y, horse.z);
    // Match syncUnitMeshes exactly. Omitting the engine's +90° model-forward
    // correction made the long horse rotate around its origin on dismount,
    // which looked like a large position jump despite identical x/z values.
    root.rotation.y = -horse.angle + Math.PI / 2;
    root.add(cloned.wrapper);
    horse.mesh = root;
    if (Game.unitsGroup) Game.unitsGroup.add(root);
    Game.cavalryHorses.push(horse);
    unit._cavalryHorseId = horse.id;

    // The foot model is attached asynchronously. Remove the combined live
    // wrapper now so one render frame cannot show a second rider/horse shifted
    // to the dismount point beside the parked riderless proxy.
    const liveWrapper = unit.mesh && unit.mesh.userData.modelWrapper;
    if (liveWrapper) {
        unit.mesh.remove(liveWrapper);
        unit.mesh.userData.modelWrapper = null;
    }

    // Finish beside the horse instead of replacing the rider at the saddle's
    // centre. Validate the short step with a foot-Ułan footprint so a horse next
    // to a wall/blocked edge cannot teleport its rider through that obstruction.
    const footBase = Game.UNIT_STATS && Game.UNIT_STATS[`${unit.team}_ulan`];
    const footProbe = footBase
        ? { ...unit, kind: footBase.kind || 'ulan', class: footBase.class || 'infantry', size: footBase.size }
        : unit;
    const dismountPool = Game.cavalryHorseEntryPoints(horse).filter(point =>
        !Game.segmentPassable || Game.segmentPassable(footProbe, horse.x, horse.z, point.x, point.z));
    const dismountPoint = dismountPool.reduce((best, point) => !best
        || Game.distSq(unit.x, unit.z, point.x, point.z) < Game.distSq(unit.x, unit.z, best.x, best.z)
        ? point : best, null);
    if (dismountPoint) {
        unit.x = dismountPoint.x;
        unit.z = dismountPoint.z;
        unit.y = Game.getHeight ? Game.getHeight(unit.x, unit.z) : unit.y;
        unit.angle = Game.angleTo ? Game.angleTo(unit.x, unit.z, horse.x, horse.z) : unit.angle;
    }
    unit._cavalryParkPose = null;
    return horse;
};

Game._removeCavalryHorse = (horse) => {
    if (!horse) return false;
    if (horse.mesh && horse.mesh.parent) horse.mesh.parent.remove(horse.mesh);
    const index = Game.cavalryHorses.indexOf(horse);
    if (index >= 0) Game.cavalryHorses.splice(index, 1);
    const rider = Game.getUnitById && Game.getUnitById(horse.riderId);
    if (rider) {
        if (rider._cavalryHorseId === horse.id) rider._cavalryHorseId = null;
        if (rider._mountingHorseId === horse.id) rider._mountingHorseId = null;
        if (rider._enterHorseId === horse.id) rider._enterHorseId = null;
    }
    return true;
};

Game.clearCavalryHorses = () => {
    (Game.units || []).forEach(unit => {
        unit._enterHorseId = null;
        unit._enterHorsePoint = null;
        unit._enterHorseRepath = null;
        unit._enterHorseAttempt = null;
        unit._mountingHorseId = null;
        unit._cavalryHorseId = null;
        unit._cavalryParkPose = null;
    });
    (Game.cavalryHorses || []).slice().forEach(Game._removeCavalryHorse);
    Game.cavalryHorses.length = 0;
};

Game.horseAtScreen = (screenX, screenY) => {
    if (!Game.raycaster || !Game.camera || !Game.THREE) return null;
    const meshes = (Game.cavalryHorses || [])
        .filter(horse => horse.state === 'empty' && horse.mesh && horse.mesh.visible !== false)
        .map(horse => horse.mesh);
    if (!meshes.length) return null;
    const ndc = new Game.THREE.Vector2(
        (screenX / Game.viewW) * 2 - 1,
        -(screenY / Game.viewH) * 2 + 1);
    Game.raycaster.setFromCamera(ndc, Game.camera);
    const hits = Game.raycaster.intersectObjects(meshes, true);
    for (const hit of hits) {
        let object = hit.object;
        while (object && object.userData?.cavalryHorseId == null) object = object.parent;
        const horse = object && Game.cavalryHorseById(object.userData.cavalryHorseId);
        if (horse && horse.state === 'empty') return horse;
    }
    return null;
};

Game.horseAtWorld = (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    let best = null;
    let bestDistance = 1.7 * 1.7;
    for (const horse of Game.cavalryHorses || []) {
        if (horse.state !== 'empty' || !horse.mesh || horse.mesh.visible === false) continue;
        const distance = Game.distSq(x, z, horse.x, horse.z);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = horse;
        }
    }
    return best;
};

Game.canMountHorse = (unit, horse) => !!unit && !!horse
    && unit.alive && unit._cavalryCanMount && !unit._cavalryMounted
    && !unit._cavalryAwaitingModel && !unit._cavalryTransition
    && !unit._garrisoned && unit._inVehicle == null
    && horse.riderId === unit.id && horse.state === 'empty'
    && (horse.reservedBy == null || horse.reservedBy === unit.id);

Game.cancelHorseMountOrder = (unit) => {
    if (!unit || unit._enterHorseId == null) return false;
    const horse = Game.cavalryHorseById(unit._enterHorseId);
    if (horse && horse.reservedBy === unit.id) horse.reservedBy = null;
    unit._enterHorseId = null;
    unit._enterHorsePoint = null;
    unit._enterHorseRepath = null;
    unit._enterHorseAttempt = null;
    unit.path = [];
    unit.moving = false;
    return true;
};

Game.orderMountHorse = (horse, options = {}) => {
    if (typeof horse === 'string') horse = Game.cavalryHorseById(horse);
    const selected = Game.selectedPlayerUnits ? Game.selectedPlayerUnits() : [];
    const rider = selected.find(unit => Game.canMountHorse(unit, horse));
    if (!rider) {
        if (!options.silent && Game.pushMessage) Game.pushMessage('Select the Ułan linked to this horse.', 1.6);
        return false;
    }
    const route = Game._cavalryHorseEntryRoute(rider, horse, 0);
    if (!route) {
        if (!options.silent && Game.pushMessage) Game.pushMessage('No clear route to the horse.', 1.8);
        return false;
    }
    Game.cancelHorseMountOrder(rider);
    if (Game.clearArrivalFacing) Game.clearArrivalFacing(rider);
    rider._enterRec = null;
    rider._enterCarrierId = null;
    rider.forcedTargetId = null;
    rider.fireTargetId = null;
    rider.bombardX = null;
    rider.bombardZ = null;
    rider._bombarding = false;
    if (Game.AI?.clearPosture) Game.AI.clearPosture(rider);
    rider.stance = 'stand';
    rider._autoStance = false;
    rider.orderMode = 'move';
    rider.orderDelay = Game.commandDelay ? Game.commandDelay(rider) : 0;
    rider._enterHorseId = horse.id;
    rider._enterHorsePoint = route.point;
    rider._enterHorseRepath = 0.45;
    rider._enterHorseAttempt = route.nextIndex;
    rider.path = route.path;
    rider.moving = route.path.length > 0;
    horse.reservedBy = rider.id;
    Game.updateCavalryHorseEntry(0);
    if (Game.spawnOrderMarker) Game.spawnOrderMarker(horse.x, horse.z, 0x66ccff);
    if (!options.silent && Game.pushMessage) Game.pushMessage(`${rider.label} returning to horse.`, 1.6);
    if (!options.silent && Game.Audio) Game.Audio.voice('f_sold_move');
    return true;
};

Game._restoreCavalryHorseAfterFailedMount = (unit, options = {}) => {
    const horse = unit && Game.cavalryHorseById(unit._mountingHorseId);
    if (!horse) return;
    horse.state = 'empty';
    horse.reservedBy = null;
    if (horse.mesh) horse.mesh.visible = true;
    unit._mountingHorseId = null;
    unit._cavalryHorseId = horse.id;
    const point = !options.keepPosition && Game.cavalryHorseEntryPoint(horse, unit);
    if (point && unit.alive) {
        unit.x = point.x;
        unit.z = point.z;
        unit.y = Game.getHeight ? Game.getHeight(point.x, point.z) : unit.y;
    }
};

Game._consumeMountedHorse = (unit) => {
    const horse = unit && Game.cavalryHorseById(unit._mountingHorseId);
    if (!horse) return false;
    return Game._removeCavalryHorse(horse);
};

Game.updateCavalryHorseEntry = (dt) => {
    for (const horse of (Game.cavalryHorses || []).slice()) {
        const rider = Game.getUnitById && Game.getUnitById(horse.riderId);
        if (horse.state === 'mounting' && (!rider || !rider.alive)) {
            // A rider killed after the remount has begun uses the combined
            // mounted death presentation. Consume the hidden proxy so a second,
            // live-looking riderless horse cannot appear beside the corpse.
            Game._removeCavalryHorse(horse);
            if (rider) {
                rider._mountingHorseId = null;
                rider._cavalryHorseId = null;
                rider._cavalryPendingMountClip = null;
                rider._cavalryAwaitingModel = false;
                rider._cavalryTransition = null;
            }
            continue;
        } else if (horse.reservedBy != null) {
            const reserver = Game.getUnitById && Game.getUnitById(horse.reservedBy);
            if (!reserver || !reserver.alive) horse.reservedBy = null;
        }
        if (horse.mixer && horse.mesh?.visible !== false) horse.mixer.update(dt);
    }
    for (const unit of Game.units || []) {
        if (unit._enterHorseId == null) continue;
        const horse = Game.cavalryHorseById(unit._enterHorseId);
        if (!Game.canMountHorse(unit, horse)) {
            Game.cancelHorseMountOrder(unit);
            continue;
        }
        const point = unit._enterHorsePoint || Game.cavalryHorseEntryPoint(horse, unit);
        unit._enterHorsePoint = point;
        if (!point) {
            Game.cancelHorseMountOrder(unit);
            continue;
        }
        const distanceSq = Game.distSq(unit.x, unit.z, point.x, point.z);
        if (distanceSq <= Game.CAVALRY_HORSE_ARRIVAL_RADIUS ** 2) {
            unit.path = [];
            unit.moving = false;
            unit._enterHorseId = null;
            unit._enterHorsePoint = null;
            unit._enterHorseRepath = null;
            unit._enterHorseAttempt = null;
            unit._mountingHorseId = horse.id;
            unit.orderMode = 'hold';
            horse.state = 'mounting';
            horse.reservedBy = unit.id;
            const accepted = Game.setCavalryMounted(unit, true, { fromHorse: true });
            if (!accepted) Game._restoreCavalryHorseAfterFailedMount(unit);
            continue;
        }
        unit._enterHorseRepath = (unit._enterHorseRepath || 0) - dt;
        if (unit._enterHorseRepath <= 0 && !unit.path?.length) {
            const route = Game._cavalryHorseEntryRoute(unit, horse, unit._enterHorseAttempt || 0);
            if (!route) {
                Game.cancelHorseMountOrder(unit);
                if (unit.team === Game.playerTeam && Game.pushMessage) {
                    Game.pushMessage(`${unit.label}: no clear route to the horse.`, 1.8);
                }
                continue;
            }
            unit._enterHorsePoint = route.point;
            unit._enterHorseAttempt = route.nextIndex;
            unit.path = route.path;
            unit.moving = route.path.length > 0;
            unit._enterHorseRepath = 0.45;
        }
    }
};

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

// Match the in-place cycle to actual displacement. The very low non-combat floor
// is intentional: physical braking reaches walking pace progressively, so the
// final stride must wind down with it rather than stay at 0.42x and snap to idle.
// Firing clips retain their firmer floor so their authored weapon action remains
// readable even when the horse is barely advancing.
Game.cavalryAnimationTimeScale = (clip, speed) => {
    const isFire = typeof clip === 'string' && clip.startsWith('fire_');
    const reference = clip === 'walk'
        ? Game.CAVALRY_MOVE.walkReferenceSpeed
        : Game.CAVALRY_MOVE.runReferenceSpeed;
    const minScale = isFire ? 0.55 : Game.CAVALRY_MOVE.minGaitTimeScale;
    return Game.clamp(Math.max(0, speed || 0) / reference, minScale, 1.65);
};

Game.updateCavalryAnimationSpeed = (unit) => {
    const ud = unit.mesh && unit.mesh.userData;
    if (!ud || !ud.actions || !ud._activeClip) return;
    const clip = ud._activeClip;
    const isFire = clip.startsWith('fire_');
    if (clip !== 'walk' && clip !== 'run' && !isFire) return;
    const action = ud.actions[clip];
    if (!action) return;
    const speed = unit._dispSpeed != null ? unit._dispSpeed : (unit.currentSpeed || 0);
    action.setEffectiveTimeScale(Game.cavalryAnimationTimeScale(clip, speed));
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
    const timeScale = name === 'dismount' ? Game.CAVALRY_DISMOUNT_TIME_SCALE : 1;
    action.setEffectiveTimeScale(timeScale);
    action.setEffectiveWeight(1);
    action.play();
    if (previous && previous !== action) action.crossFadeFrom(previous, 0.18, false);
    ud._activeClip = name;
    unit._cavalryTransition = {
        phase: 'animating',
        clip: name,
        toMounted,
        remaining: action.getClip().duration / timeScale + 0.05,
    };
    return true;
};

Game._loadCavalryModeModel = (unit, mounted, playMount = false) => {
    unit._cavalryAwaitingModel = true;
    unit._cavalryPendingMountClip = playMount ? 'mount' : null;
    Game._loadUnitModel(unit, unit.mesh);
};

Game._restoreCavalryProceduralFoot = (unit) => {
    const mesh = unit && unit.mesh;
    const ud = mesh && mesh.userData;
    if (!mesh || !ud || ud.modelWrapper) return false;
    // The unit's original low-poly infantry rig is retained in userData even
    // after the GLB loader detaches its placeholder children. Reattach that rig
    // as the terminal fallback instead of leaving a living dismounted rider
    // represented by only a selection ring.
    const root = ud.rig && ud.rig.root;
    if (!root) return false;
    if (!root.parent) mesh.add(root);
    ud.isInfantry = true;
    ud.isSoldier = false;
    ud.isMountedCavalry = false;
    ud.cavalryModel = null;
    ud.mixer = null;
    ud.actions = null;
    ud.animations = null;
    ud.clipNames = null;
    ud._activeClip = null;
    return true;
};

// `_loadUnitModel` normally resolves through onCavalryModelLoaded. If every
// candidate asset fails (or that key is already in its failure cache), release
// the transition explicitly so neither the rider nor a reserved horse can be
// left locked in an awaiting state forever.
Game.onCavalryModelLoadFailed = (unit) => {
    if (!unit || !unit._cavalryCanMount || !unit._cavalryAwaitingModel) return;
    if (unit._cavalryMounted) {
        Game._setCavalryStats(unit, false);
        Game._restoreCavalryHorseAfterFailedMount(unit, { keepPosition: !unit.alive });
    }
    if (!unit._cavalryMounted) Game._restoreCavalryProceduralFoot(unit);
    unit._cavalryPendingMountClip = null;
    unit._cavalryAwaitingModel = false;
    unit._cavalryTransition = null;
    Game._restoreCavalryOrderMode(unit);
    if (!unit._cavalryFallbackWarned && Game.pushMessage) {
        unit._cavalryFallbackWarned = true;
        Game.pushMessage(`${unit.label}: cavalry model unavailable; state change cancelled.`, 2.5);
    }
};

// Public state setter. The default path plays the authored transitions;
// `{ immediate: true }` is reserved for deterministic tests/editor setup.
Game.setCavalryMounted = (unit, mounted, options = {}) => {
    if (!unit || !unit.alive || !unit._cavalryCanMount
        || unit._cavalryAwaitingModel || unit._cavalryTransition) return false;
    mounted = !!mounted;
    if (unit._cavalryMounted === mounted) return false;

    if (mounted) {
        let horse = Game.cavalryHorseById(unit._mountingHorseId)
            || Game.cavalryHorseForRider(unit);
        if (!horse || horse.riderId !== unit.id) return false;
        if (!options.fromHorse && !options.immediate) {
            const point = Game.cavalryHorseEntryPoint(horse, unit);
            if (!point || Game.distSq(unit.x, unit.z, point.x, point.z)
                > Game.CAVALRY_HORSE_ARRIVAL_RADIUS ** 2) return false;
        }
        unit._mountingHorseId = horse.id;
        horse.state = 'mounting';
        horse.reservedBy = unit.id;
    }

    unit.path = [];
    unit.moving = false;
    if (Game.clearArrivalFacing) Game.clearArrivalFacing(unit);
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

    if (!mounted) {
        unit._cavalryParkPose = { x: unit.x, z: unit.z, y: unit.y, angle: unit.angle };
        Game._parkCavalryHorse(unit);
    }

    if (!Game._setCavalryStats(unit, mounted)) {
        if (mounted) Game._restoreCavalryHorseAfterFailedMount(unit);
        return false;
    }
    unit.currentSpeed = 0;
    Game._loadCavalryModeModel(unit, mounted, mounted && !options.immediate);
    return true;
};

// Called by the unit loader after either the cavalry GLB or the shared foot
// soldier has created its mixer/actions.
Game.onCavalryModelLoaded = (unit, path) => {
    if (!unit || !unit._cavalryCanMount) return;
    if (!unit.alive) {
        const mountingHorse = Game.cavalryHorseById(unit._mountingHorseId);
        if (mountingHorse) Game._removeCavalryHorse(mountingHorse);
        unit._cavalryPendingMountClip = null;
        unit._cavalryAwaitingModel = false;
        unit._cavalryTransition = null;
        return;
    }
    if (unit._cavalryMounted && !Game.isCavalryPath(path)) {
        // Graceful asset failure: retain a usable dismounted soldier instead of
        // running horse physics on a foot model.
        Game._setCavalryStats(unit, false);
        Game._restoreCavalryHorseAfterFailedMount(unit);
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
    const mountingHorse = Game.cavalryHorseById(unit._mountingHorseId);
    if (mountingHorse) {
        unit.x = mountingHorse.x;
        unit.z = mountingHorse.z;
        unit.y = mountingHorse.y;
        unit.angle = mountingHorse.angle;
        if (unit.mesh) {
            unit.mesh.position.set(unit.x, unit.y, unit.z);
            unit.mesh.rotation.y = -unit.angle + Math.PI / 2;
        }
        if (mountingHorse.mesh) mountingHorse.mesh.visible = false;
    }
    if (pending && Game._playCavalryOneShot(unit, pending, true)) return;
    if (mountingHorse) Game._consumeMountedHorse(unit);
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
        unit._cavalryParkPose = { x: unit.x, z: unit.z, y: unit.y, angle: unit.angle };
        if (!Game._playCavalryOneShot(unit, 'dismount', false)) {
            Game._parkCavalryHorse(unit);
            Game._setCavalryStats(unit, false);
            Game._loadCavalryModeModel(unit, false, false);
        }
        return true;
    }

    if (transition.phase === 'animating') {
        transition.remaining -= dt;
        if (transition.remaining > 0) return true;
        if (!transition.toMounted) {
            Game._parkCavalryHorse(unit);
            Game._setCavalryStats(unit, false);
            unit.currentSpeed = 0;
            Game._loadCavalryModeModel(unit, false, false);
            return true;
        }
        Game._consumeMountedHorse(unit);
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
    // A mixed selection dismounts its mounted members. If everybody is already
    // on foot, issue one entry-style return order to each linked parked horse;
    // never recreate a horse underneath a distant soldier.
    const returnToHorses = selected.every(unit => !unit._cavalryMounted);
    let changed = 0;
    if (returnToHorses) {
        selected.forEach(unit => {
            const horse = Game.cavalryHorseForRider(unit);
            if (horse && Game.orderMountHorse(horse, { silent: true })) changed++;
        });
    } else {
        selected.forEach(unit => {
            if (unit._cavalryMounted && Game.setCavalryMounted(unit, false)) changed++;
        });
    }
    if (!changed) {
        Game.pushMessage(returnToHorses
            ? 'No available linked horse for the selected Ułan.'
            : 'Cavalry is already changing state.', 1.5);
    } else {
        Game.pushMessage(returnToHorses
            ? 'Cavalry returning to their horses.'
            : 'Cavalry dismounting.', 1.8);
        if (returnToHorses && Game.Audio) Game.Audio.voice('f_sold_move');
    }
};

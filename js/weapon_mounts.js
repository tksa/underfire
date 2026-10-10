/** Muzzle anchors live on weapon geometry, in the same hierarchy as its recoil. */
Game.MODEL_WEAPON_NODES = {
    german_hmg: ['equipment_mg34_mg34'], french_hmg: ['gun_barrel'], polish_hmg: ['gun_barrel'],
    french_b1: ['turret'], french_r35: ['Object_60'], french_h35: ['body_tower_0'],
    french_s35: ['split_turret'], french_panhard: ['Object_12'],
    german_panzer3: ['split_turret'],
    polish_7tp: ['gun'], polish_7tp_dw: ['turret', 'turret2'],
    polish_7tp_dwr: ['gun', 'turret2'],
    polish_tks: ['gun_20mm'], polish_tks20: ['gun_20mm'],
    french_at25: ['hull'], french_at47: ['hull'], polish_fieldgun75: ['armata_body'],
};

// Sample only vertices referenced by drawn triangles. A split mesh deliberately
// shares the original attribute buffer; Box3 would include the discarded hull.
Game.weaponGeometryPoints = (source, relativeTo) => {
    const T = Game.THREE, points = [];
    relativeTo.updateWorldMatrix(true, true);
    const inverse = relativeTo.matrixWorld.clone().invert();
    source.traverse(node => {
        if (!node.isMesh || !node.geometry?.attributes.position || !node.visible) return;
        const geo = node.geometry, pos = geo.attributes.position;
        const matrix = new T.Matrix4().multiplyMatrices(inverse, node.matrixWorld);
        const used = geo.index ? new Set(geo.index.array) : Array.from({ length: pos.count }, (_, i) => i);
        for (const i of used) points.push(new T.Vector3().fromBufferAttribute(pos, i).applyMatrix4(matrix));
    });
    return points;
};

// Intersect drawn triangle edges with a plane. Low-poly wings may have no
// vertices at a gun station; a vertex-only slice would miss the wing entirely.
Game.weaponGeometrySection = (source, relativeTo, axis, value) => {
    const T = Game.THREE, points = [];
    relativeTo.updateWorldMatrix(true, true);
    const inverse = relativeTo.matrixWorld.clone().invert();
    source.traverse(node => {
        if (!node.isMesh || !node.visible || !node.geometry?.attributes.position) return;
        const g = node.geometry, pos = g.attributes.position;
        const matrix = new T.Matrix4().multiplyMatrices(inverse, node.matrixWorld);
        const index = i => g.index ? g.index.getX(i) : i;
        const count = g.index ? g.index.count : pos.count;
        for (let i = 0; i + 2 < count; i += 3) {
            const tri = [0, 1, 2].map(k => new T.Vector3().fromBufferAttribute(pos, index(i + k)).applyMatrix4(matrix));
            for (let k = 0; k < 3; k++) {
                const a = tri[k], b = tri[(k + 1) % 3], delta = b[axis] - a[axis];
                if (Math.abs(delta) < 1e-8) continue;
                const t = (value - a[axis]) / delta;
                if (t >= 0 && t <= 1) points.push(a.clone().lerp(b, t));
            }
        }
    });
    return points;
};

Game.attachWeaponMuzzle = (unit, source, localPoint, localDirection = null) => {
    const T = Game.THREE, anchor = new T.Object3D();
    anchor.name = 'weapon_muzzle'; anchor.position.copy(localPoint);
    if (localDirection) anchor.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), localDirection.clone().normalize());
    source.add(anchor);
    const binding = { anchor, source };
    (unit.mesh.userData.weaponMuzzles ||= []).push(binding);
    return binding;
};

Game.bindWeaponMuzzles = (unit) => {
    const T = Game.THREE, mesh = unit.mesh, ud = mesh.userData;
    for (const old of ud.weaponMuzzles || []) if (!old.embedded) old.anchor.removeFromParent();
    ud.weaponMuzzles = [];
    ud._mountedWeaponPose = null; ud._mountedAimBlend = 0;
    mesh.updateWorldMatrix(true, true);
    const key = `${unit.team}_${unit.kind}`;
    const names = Game.MODEL_WEAPON_NODES[key];
    const authored = Game.isAuthoredVehicle?.(ud.modelWrapper || mesh) || Game.isAuthoredMortar?.(ud.modelWrapper || mesh);
    if (authored) {
        ud.modelWrapper.traverse(anchor => {
            if (anchor.userData.weaponMuzzle) ud.weaponMuzzles.push({ anchor, source: anchor.parent, embedded: true });
        });
    }
    if (ud.mortarTube && !ud.modelWrapper) {
        Game.attachWeaponMuzzle(unit, ud.mortarTube, new T.Vector3(0, ud.mortarTubeEnd ?? 0.375, 0), new T.Vector3(0, 1, 0));
        return;
    }
    const sources = ud.modelWrapper && names ? names.map(n => ud.modelWrapper.getObjectByName(n)).filter(Boolean)
        : ud.gunNode ? [ud.gunNode] : [];
    if (ud.isSoldier) {
        if (Game.isMowSoldier?.(ud.soldierModel)) {
            const weapon = ud.soldierModel.userData.infantryWeapon;
            const anchor = weapon && ud.soldierModel.getObjectByName(`equipment_${weapon}_muzzle`);
            if (anchor) ud.weaponMuzzles.push({ anchor, source: anchor.parent, embedded: true });
            return;
        }
        const rifle = ud.soldierModel.getObjectByName('mauser_k98_lambert1_0');
        if (rifle) {
            // The narrow +Z end is the muzzle; -Z is the wooden butt.
            const points = Game.weaponGeometryPoints(rifle, rifle);
            const end = Math.max(...points.map(p => p.z));
            const cap = points.filter(p => p.z >= end - 0.003);
            const box = new T.Box3().setFromPoints(cap);
            const tip = box.getCenter(new T.Vector3()); tip.z = end;
            Game.attachWeaponMuzzle(unit, rifle, tip, new T.Vector3(0, 0, 1));
        }
        return;
    }
    if (ud.isMountedCavalry) {
        // The rifle shares a skinned mesh with horse/rider. Only its rigid Gun
        // weights belong to the weapon. In this asset the narrow muzzle is at
        // native -Y; the stock is the wide +Y end. Anchor to the animated bone.
        ud.cavalryModel.traverse(node => {
            if (!node.isSkinnedMesh) return;
            const bone = node.skeleton.bones.find(b => b.name === 'Gun');
            const joint = node.skeleton.bones.indexOf(bone), a = node.geometry.attributes;
            if (!bone || !a.skinIndex || !a.skinWeight) return;
            const vertices = [];
            for (let i = 0; i < a.position.count; i++) {
                let weight = 0;
                for (let k = 0; k < 4; k++) {
                    if (a.skinIndex.getComponent(i, k) === joint) weight += a.skinWeight.getComponent(i, k);
                }
                if (weight > 0.99) vertices.push(i);
            }
            if (!vertices.length) return;
            const end = Math.min(...vertices.map(i => a.position.getY(i)));
            // Undo the bind pose directly. Using getVertexPosition here before
            // the first render would read the clone's stale bindMatrixInverse.
            const toBone = i => new T.Vector3().fromBufferAttribute(a.position, i)
                .applyMatrix4(node.bindMatrix).applyMatrix4(node.skeleton.boneInverses[joint]);
            const cap = vertices.filter(i => a.position.getY(i) < end + 0.02).map(toBone);
            const rear = vertices.filter(i => a.position.getY(i) > end + 0.20
                && a.position.getY(i) < end + 0.27).map(toBone);
            if (!cap.length || !rear.length) return;
            const tip = new T.Box3().setFromPoints(cap).getCenter(new T.Vector3());
            const breech = new T.Box3().setFromPoints(rear).getCenter(new T.Vector3());
            Game.attachWeaponMuzzle(unit, bone, tip, tip.clone().sub(breech));
        });
        return;
    }
    for (const source of authored ? [] : sources) {
        const points = Game.weaponGeometryPoints(source, mesh);
        if (!points.length) continue;
        let end = -Infinity, start = Infinity;
        for (const p of points) { end = Math.max(end, p.z); start = Math.min(start, p.z); }
        const cap = points.filter(p => p.z >= end - Math.max(0.002, (end - start) * 0.003));
        const tip = new T.Box3().setFromPoints(cap).getCenter(new T.Vector3()); tip.z = end;
        const local = source.worldToLocal(mesh.localToWorld(tip.clone()));
        const ahead = source.worldToLocal(mesh.localToWorld(tip.clone().add(new T.Vector3(0, 0, 1))));
        Game.attachWeaponMuzzle(unit, source, local, ahead.sub(local));
    }
    // Each separate gun recoils along its bore in its PARENT's coordinates.
    // This preserves non-unit GLB scale and Z-up authoring conventions.
    ud.weaponRecoil = null;
    if (ud.gunNode && ud.weaponMuzzles.length && ud.gunNode !== ud.headNode) {
        const node = ud.gunNode, parent = node.parent;
        if (parent) {
            const zero = parent.worldToLocal(mesh.localToWorld(new T.Vector3()));
            const ahead = parent.worldToLocal(mesh.localToWorld(new T.Vector3(0, 0, 1)));
            ud.weaponRecoil = { node, base: node.position.clone(), direction: ahead.sub(zero) };
        }
    }
};

// Fire runs before the renderer. Synchronize these cheap transforms now so a
// shot uses this simulation frame's turret angle and position, not yesterday's.
Game.syncWeaponTransform = (unit) => {
    const mesh = unit.mesh, ud = mesh?.userData;
    if (!ud) return;
    mesh.position.set(unit.x, unit.y || 0, unit.z);
    mesh.rotation.order = 'YXZ'; mesh.rotation.y = -unit.angle + Math.PI / 2;
    if (ud.turret && Game.isTank(unit.kind)) {
        const base = ud.turretBaseRot || { x: 0, y: 0, z: 0 };
        ud.turret.rotation.set(base.x, base.y, base.z);
        ud.turret.rotation[ud.turretAxis || 'y'] = base[ud.turretAxis || 'y'] - (unit.turretAngle - unit.angle);
        for (const m of ud.turretMirrors || []) {
            m.group.rotation.set(m.baseRot.x, m.baseRot.y, m.baseRot.z);
            m.group.rotation[ud.turretAxis || 'y'] -= unit.turretAngle - unit.angle;
        }
    }
    mesh.updateWorldMatrix(true, true);
};

Game.getWeaponMuzzle = (unit, index = null) => {
    Game.syncWeaponTransform(unit);
    const T = Game.THREE, bindings = unit.mesh?.userData.weaponMuzzles || [];
    if (bindings.length) {
        const pick = index ?? Math.max(0, (unit._shotSerial || 1) - 1);
        const binding = bindings[pick % bindings.length];
        const p = binding.anchor.getWorldPosition(new T.Vector3());
        return { x: p.x, y: p.y, z: p.z,
            direction: binding.anchor.getWorldDirection(new T.Vector3()), binding };
    }
    // Unarmed personnel and legacy assets without a separate weapon keep an
    // explicit fallback; the audit reports them instead of inventing a socket.
    const a = unit.hasTurret ? unit.turretAngle : unit.angle;
    const length = Game.GUN_CREWS?.[unit.kind]?.muzzle || 0.6;
    return { x: unit.x + Math.cos(a) * length, y: (unit.y || 0) + 0.6,
        z: unit.z + Math.sin(a) * length, direction: new T.Vector3(Math.cos(a), 0, Math.sin(a)), fallback: true };
};

// The shared take holds its rifle off-axis. Turn the upper body and both arms
// together, preserving the authored grip, until the bore follows the sight line.
Game.alignSoldierWeapon = (unit, dt) => {
    const ud = unit.mesh?.userData, binding = ud?.weaponMuzzles?.[0];
    if (!ud?.isSoldier || !binding || Game.SOLDIER_FORCE_CLIP || unit._reload || unit._infantryAction) return;
    const torso = Game._soldierLegBones(unit)?.torso;
    if (!torso?.parent) return;
    const speed = unit._dispSpeed ?? unit.currentSpeed ?? 0;
    if (ud._locoOn || speed >= 0.25
        || ['walk', 'run', 'crawl', 'crouch_walk'].includes(ud._activeClip)) {
        // The mixer already blends out the aiming pose. Applying its leftover
        // bore correction to a carry/run pose twists it back toward the target.
        ud._weaponPoseBlend = 0;
        return;
    }
    const aiming = unit.ammo !== 0 && !unit.holdFire && (unit.fireTargetId != null || unit._bombarding || unit._supportFire)
        && speed < 0.25;
    ud._weaponPoseBlend = Game.lerp(ud._weaponPoseBlend || 0, aiming ? 1 : 0, 1 - Math.exp(-dt * 12));
    if (ud._weaponPoseBlend < 0.001) return;
    const T = Game.THREE;
    unit.mesh.updateWorldMatrix(true, true);
    const direction = binding.anchor.getWorldDirection(new T.Vector3());
    const desired = new T.Vector3(0, 0, 1).transformDirection(unit.mesh.matrixWorld);
    // A GEM parent may contain a reflection. World quaternion decomposition
    // loses that handedness; solve both directions in the parent's actual
    // matrix frame before rotating the torso.
    const parentInverse = torso.parent.matrixWorld.clone().invert();
    const correction = new T.Quaternion().setFromUnitVectors(
        direction.transformDirection(parentInverse), desired.transformDirection(parentInverse));
    const angle = 2 * Math.acos(Game.clamp(correction.w, -1, 1));
    const amount = ud._weaponPoseBlend * Math.min(1, 0.9 / Math.max(0.001, angle));
    correction.slerp(new T.Quaternion(), 1 - amount);
    torso.quaternion.premultiply(correction);
};

Game.restoreMountedWeaponPose = unit => {
    for (const p of unit.mesh?.userData._mountedWeaponPose || []) {
        p.bone.position.copy(p.position); p.bone.quaternion.copy(p.quaternion);
    }
};

// The cavalry's directional takes turn the rider but leave the rifle tilted.
// Correct both arms and the rifle together about their common shoulder frame,
// preserving the authored hand-to-weapon relationship and the horse's gait.
Game.alignMountedWeapon = (unit, dt) => {
    const ud = unit.mesh?.userData, binding = ud?.weaponMuzzles?.[0];
    if (!ud?.isMountedCavalry || !binding) return;
    const model = ud.cavalryModel, T = Game.THREE;
    const bones = ['Gun', 'RiderArm_L', 'RiderArm_R'].map(n => model.getObjectByName(n));
    if (bones.some(b => !b?.parent)) return;
    ud._mountedWeaponPose = bones.map(bone => ({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone() }));
    const target = unit.fireTargetId != null ? Game.getUnitById(unit.fireTargetId) : null;
    const aiming = target?.alive && !unit.holdFire && unit.ammo !== 0;
    const sabre = model.getObjectByName('Cavalry_Sabre');
    if (sabre) sabre.visible = !aiming;
    ud._mountedAimBlend = Game.lerp(ud._mountedAimBlend || 0, aiming ? 1 : 0, 1 - Math.exp(-12 * dt));
    if (!aiming || ud._mountedAimBlend < 0.001) return;
    unit.mesh.updateWorldMatrix(true, true);
    const muzzle = binding.anchor.getWorldPosition(new T.Vector3());
    const desired = new T.Vector3(target.x, (target.y || 0) + (target.stance === 'prone' ? 0.22 : 0.7), target.z).sub(muzzle).normalize();
    const correction = new T.Quaternion().setFromUnitVectors(binding.anchor.getWorldDirection(new T.Vector3()), desired);
    correction.slerp(new T.Quaternion(), 1 - ud._mountedAimBlend);
    const pivot = bones[0].parent.getWorldPosition(new T.Vector3());
    for (const bone of bones) {
        const position = bone.getWorldPosition(new T.Vector3()).sub(pivot).applyQuaternion(correction).add(pivot);
        const rotation = bone.getWorldQuaternion(new T.Quaternion()).premultiply(correction);
        bone.position.copy(bone.parent.worldToLocal(position));
        bone.quaternion.copy(bone.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(rotation));
    }
};

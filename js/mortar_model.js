/** Original, articulated mortar teams. +Z is forward; tube sockets follow the
 * elevation pivot and the whole assembly rises into the crew's carry grips. */
const _mortarCrew = Object.freeze({ placements: Object.freeze([
    Object.freeze({ x: 0.40, z: 0.1, phase: 0, restStance: 'crouch', role: 'mortar_gunner' }),
    Object.freeze({ x: -0.40, z: -0.1, phase: 0.5, restStance: 'crouch', role: 'mortar_loader' }),
]), muzzle: 0.6 });
Game.GUN_CREWS = Object.freeze({ ...Game.GUN_CREWS,
    mortar46: _mortarCrew, mortar50: _mortarCrew, mortar60: _mortarCrew, mortar81: _mortarCrew });

Game.isAuthoredMortar = model => {
    let found = false;
    model.traverse(node => { if (node.userData.underfireMortar) found = true; });
    return found;
};

Game.bindMortarModel = (unit, model) => {
    const T = Game.THREE, ud = unit.mesh.userData;
    const root = model.getObjectByName('mortar_assembly'), pivot = model.getObjectByName('tube_elevation');
    const muzzle = model.getObjectByName('tube_end'), base = model.getObjectByName('tube_base');
    const shell = model.getObjectByName('loading_round');
    model.updateWorldMatrix(true, true);
    const direction = muzzle.position.clone().sub(base.position).normalize();
    muzzle.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), direction);
    muzzle.userData.weaponMuzzle = true;
    shell.visible = false;
    ud.mortarTube = model.getObjectByName('mortar_tube');
    ud.mortar = { imported: true, root, rootBase: root.position.clone(), pivot, muzzle, base,
        bipod: model.getObjectByName('folding_bipod'), shell, box: model.getObjectByName('ammunition_box'),
        carry: 0, direction, length: muzzle.position.distanceTo(base.position) };
};

Game.buildMortarModel = (unit, host) => {
    const T = Game.THREE, heavy = unit.kind === 'mortar81';
    const root = new T.Group(); root.name = 'mortar_assembly'; host.add(root);
    const paint = new T.MeshStandardMaterial({ color: unit.team === 'german' ? 0x51594e : 0x5e6346, roughness: 0.78, metalness: 0.3 });
    const steel = new T.MeshStandardMaterial({ color: 0x303737, roughness: 0.5, metalness: 0.7 });
    const wood = new T.MeshStandardMaterial({ color: 0x746449, roughness: 0.9 });
    const add = (name, geo, mat, x, y, z, parent = root) => {
        const mesh = new T.Mesh(geo, mat); mesh.name = name; mesh.position.set(x, y, z);
        mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
    };
    const rod = (name, a, b, radius = 0.018, parent = root) => {
        a = new T.Vector3(...a); b = new T.Vector3(...b);
        const m = add(name, new T.CylinderGeometry(radius, radius, a.distanceTo(b), 12), steel, ...a.clone().add(b).multiplyScalar(0.5).toArray(), parent);
        m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.sub(a).normalize()); return m;
    };
    add('baseplate', new T.CylinderGeometry(heavy ? 0.31 : 0.22, heavy ? 0.34 : 0.25, 0.045, 12), paint, 0, 0.065, -0.16);
    for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        rod('baseplate_rib', [0, 0.09, -0.16], [Math.cos(a) * 0.21, 0.09, -0.16 + Math.sin(a) * 0.21], 0.012);
    }
    add('ball_socket', new T.SphereGeometry(0.07, 12, 8), steel, 0, 0.13, -0.16);
    const pivot = new T.Group(); pivot.name = 'tube_elevation'; pivot.position.set(0, 0.15, -0.16); pivot.rotation.x = 0.48; root.add(pivot);
    const length = heavy ? 0.87 : unit.kind === 'mortar60' ? 0.65 : 0.5;
    const radius = heavy ? 0.049 : 0.036;
    const tube = add('mortar_tube', new T.CylinderGeometry(radius, radius * 1.1, length, 20, 1, true), steel, 0, length / 2, 0, pivot);
    add('open_bore', new T.CircleGeometry(radius * 0.87, 20), new T.MeshBasicMaterial({ color: 0x0b1010, side: T.DoubleSide }), 0, length - 0.028, 0, pivot).rotation.x = -Math.PI / 2;
    const collar = add('tube_collar', new T.TorusGeometry(radius * 1.1, 0.014, 6, 18), paint, 0, length * 0.57, 0, pivot); collar.rotation.x = Math.PI / 2;
    const bipod = new T.Group(); bipod.name = 'folding_bipod'; root.add(bipod);
    for (const side of [-1, 1]) {
        rod('bipod_leg', [side * 0.04, 0.43, 0.13], [side * 0.26, 0.04, 0.33], 0.023, bipod);
        add('bipod_foot', new T.BoxGeometry(0.11, 0.025, 0.085), paint, side * 0.26, 0.035, 0.33, bipod);
        rod('carry_handle', [side * 0.16, 0.34, -0.12], [side * 0.16, 0.34, 0.12], 0.016);
    }
    rod('elevation_screw', [0, 0.15, 0.32], [0, 0.49, 0.1], 0.014);
    rod('traverse_crossbar', [-0.16, 0.42, 0.16], [0.16, 0.42, 0.16], 0.02);
    const crank = add('elevation_handwheel', new T.TorusGeometry(0.055, 0.009, 6, 16), steel, 0.16, 0.46, 0.12); crank.rotation.y = Math.PI / 2;
    add('sight', new T.BoxGeometry(0.045, 0.07, 0.04), steel, -0.095, 0.51, 0.05);
    const box = add('ammunition_box', new T.BoxGeometry(0.28, 0.14, 0.2), wood, 0.58, 0.09, -0.3);
    add('box_latch', new T.BoxGeometry(0.035, 0.055, 0.01), steel, 0.58, 0.11, -0.195);
    const shell = add('loading_round', new T.CylinderGeometry(0.024, 0.014, 0.18, 10), paint, 0, 0, 0, pivot); shell.visible = false;
    host.userData.mortarTube = tube; host.userData.mortarTubeEnd = length / 2;
    host.userData.mortar = { root, pivot, bipod, shell, box, length, carry: 0 };
};

Game.updateMortarModel = (unit, dt) => {
    const m = unit.mesh?.userData.mortar;
    if (!m) return;
    const moving = (unit._dispSpeed ?? unit.currentSpeed ?? 0) > 0.2 && unit._canMove !== false;
    m.carry = Game.lerp(m.carry, moving ? 1 : 0, 1 - Math.exp(-6 * dt));
    if (m.imported) {
        const scale = m.root.parent.getWorldScale(new Game.THREE.Vector3()).y;
        m.root.position.copy(m.rootBase); m.root.position.y += 0.42 * m.carry / Math.max(0.001, scale);
    } else m.root.position.y = 0.42 * m.carry;
    m.bipod.scale.x = 1 - m.carry * 0.65;
    m.box.visible = m.carry < 0.2;
    const age = unit._shotAge ?? Infinity, cycle = Game.crewLoadDuration(unit);
    const phase = (age - 0.25) / cycle;
    m.shell.visible = !moving && !unit._unmanned && !unit._towed && phase > 0.15 && phase < 0.85;
    // Hidden geometry still participates in bounds/debug traversal. Never let
    // an idle age of Infinity send the round (and the model bounds) to infinity.
    const roundPhase = Number.isFinite(phase) ? Game.clamp(phase, 0, 1) : 0;
    if (m.imported) {
        // Same pivot as the tube: the round follows its actual inclined bore.
        m.shell.position.copy(m.muzzle.position).addScaledVector(m.direction, 0.23 - Math.max(0, roundPhase - 0.4) * 0.65);
    } else m.shell.position.y = m.length + 0.3 - Math.max(0, roundPhase - 0.4) * 0.7;
};

Game.fitMortarCrewHands = (unit, figure, moving) => {
    const m = unit.mesh?.userData.mortar;
    if (!m || !figure.userData.fieldGunRole?.startsWith('mortar_')) return;
    unit.mesh.updateWorldMatrix(true, true);
    const T = Game.THREE, loader = figure.userData.fieldGunRole === 'mortar_loader';
    if (moving) {
        for (const side of ['l', 'r']) {
            const grip = m.imported && m.root.getObjectByName(loader ? 'carry_grip_right' : 'carry_grip_left');
            const target = grip ? grip.localToWorld(new T.Vector3(0, 0, side === 'l' ? 0.06 : -0.06))
                : m.root.localToWorld(new T.Vector3(loader ? -0.16 : 0.16, 0.34, side === 'l' ? 0.10 : -0.10));
            Game._placeCrewHand(figure, side, target, unit);
        }
    } else if (loader && m.shell.visible) {
        const target = m.shell.getWorldPosition(new T.Vector3());
        Game._placeCrewHand(figure, 'r', target, unit);
    } else if (!loader && m.imported) {
        const control = m.root.getObjectByName('optical_sight') || m.root.getObjectByName('sighting_scale');
        const target = control.getWorldPosition(new T.Vector3());
        Game._placeCrewHand(figure, 'r', target, unit);
        Game._placeCrewHand(figure, 'l', target.clone().add(new T.Vector3(0, -0.045, -0.035).applyQuaternion(unit.mesh.quaternion)), unit);
    }
};

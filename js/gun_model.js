/** Original articulated gun carriages for the procedural asset path. */
Game.buildGunCarriage = (unit, group, color) => {
    const T = Game.THREE;
    const bofors = unit.kind === 'bofors37';
    const pak = unit.kind === 'pak36';
    const radius = bofors ? 0.34 : 0.30;
    const width = bofors ? 0.49 : 0.44;
    const length = unit.kind === 'fieldgun75' ? 1.5 : unit.kind === 'at47' ? 1.3 : bofors ? 1.22 : 1.05;
    const paint = new T.MeshStandardMaterial({ color, roughness: 0.84, metalness: 0.18 });
    const tire = new T.MeshStandardMaterial({ color: 0x25231e, roughness: 0.96 });
    const steel = new T.MeshStandardMaterial({ color: 0x55554b, roughness: 0.65, metalness: 0.5 });
    const add = (geo, mat, parent, x, y, z, name = '') => {
        const mesh = new T.Mesh(geo, mat); mesh.position.set(x, y, z);
        mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true;
        parent.add(mesh); return mesh;
    };
    const box = (w, h, d, x, y, z, parent = group) =>
        add(new T.BoxGeometry(w, h, d), paint, parent, x, y, z);
    const axle = new T.CylinderGeometry(0.055, 0.055, width * 2, 10); axle.rotateZ(Math.PI / 2);
    add(axle, steel, group, 0, radius, 0);
    for (const side of [-1, 1]) {
        const geo = new T.CylinderGeometry(radius, radius, 0.13, 20); geo.rotateZ(Math.PI / 2);
        const wheel = add(geo, tire, group, width * side, radius, 0, side < 0 ? 'wheel_left' : 'wheel_right');
        const rim = new T.CylinderGeometry(radius * 0.7, radius * 0.7, 0.14, 16); rim.rotateZ(Math.PI / 2);
        add(rim, paint, wheel, 0, 0, 0);
        // The spoke pattern makes wheel rotation readable at tactical zoom.
        for (let i = 0; i < 6; i++) {
            const spoke = box(0.15, radius * 1.25, 0.035, 0, 0, 0, wheel);
            spoke.rotation.x = i * Math.PI / 3;
        }
        const hub = new T.CylinderGeometry(0.075, 0.075, 0.19, 10); hub.rotateZ(Math.PI / 2);
        add(hub, steel, wheel, 0, 0, 0);
    }
    box(0.43, 0.13, 0.5, 0, radius + 0.03, 0);
    // Split shields give the two missing guns distinct, readable silhouettes.
    const shield = new T.Shape();
    const half = bofors ? 0.49 : 0.45, top = bofors ? 0.88 : 0.76;
    shield.moveTo(-half, 0.27); shield.lineTo(-half, top - 0.19);
    shield.lineTo(-half * (pak ? 0.65 : 0.88), top);
    shield.lineTo(-0.07, top); shield.lineTo(-0.07, 0.60);
    shield.lineTo(0.07, 0.60); shield.lineTo(0.07, top);
    shield.lineTo(half * (pak ? 0.65 : 0.88), top);
    shield.lineTo(half, top - 0.19); shield.lineTo(half, 0.27); shield.closePath();
    const plate = add(new T.ExtrudeGeometry(shield, { depth: 0.035, bevelEnabled: false }), paint, group, 0, 0, 0.18);
    plate.rotation.x = -0.10;
    box(0.14, 0.08, 0.62, 0, 0.49, 0.10); // recoil cradle stays fixed
    const barrel = new T.Group(); barrel.name = 'recoiling_breech'; group.add(barrel);
    const tube = new T.CylinderGeometry(0.027, 0.045, length, 12); tube.rotateX(Math.PI / 2);
    group.userData.gunNode = add(tube, paint, barrel, 0, 0.56, 0.23 + length / 2, 'gun_barrel');
    box(0.15, 0.15, 0.30, 0, 0.55, 0.02, barrel);
    const bore = new T.CylinderGeometry(0.023, 0.023, 0.008, 12); bore.rotateX(Math.PI / 2);
    add(bore, tire, barrel, 0, 0.56, 0.235 + length);
    const trails = [];
    for (const side of [-1, 1]) {
        const hinge = new T.Group(); hinge.position.set(side * 0.15, 0.18, -0.12);
        group.add(hinge); box(0.065, 0.08, 1.08, 0, 0, -0.52, hinge);
        box(0.22, 0.07, 0.14, 0, -0.055, -1.04, hinge); // ground spade
        trails.push({ node: hinge, side });
        const handwheel = new T.TorusGeometry(0.085, 0.012, 6, 14); handwheel.rotateY(Math.PI / 2);
        add(handwheel, steel, group, side * 0.21, 0.46, -0.12);
    }
    group.userData.gunMechanism = { barrel, trails, travel: 0.13, open: unit.deployed ? 1 : 0 };
    group.userData.proceduralGun = unit.kind;
    group.userData.modelSource = 'Under Fire procedural carriage';
};

Game.updateGunMechanism = (unit, dt) => {
    const mechanism = unit.mesh?.userData.gunMechanism;
    if (!mechanism) return;
    const target = unit.deployed && !unit._towed ? 1 : 0;
    mechanism.open += (target - mechanism.open) * (1 - Math.exp(-Math.max(0, dt) * 3));
    for (const trail of mechanism.trails) trail.node.rotation.y = trail.side * (0.04 + mechanism.open * 0.30);
    const age = unit._lastShotAt == null ? Infinity : unit._shotAge ?? Game.gameClock - unit._lastShotAt;
    mechanism.barrel.position.z = age >= 0 && age < 0.55
        ? -mechanism.travel * Math.sin(Math.PI * Math.min(1, age / 0.55)) * Math.exp(-age * 2) : 0;
};

/** Articulated rigid assets use explicit part tags, Y-up pivots and bore sockets. */
Game.isAuthoredVehicle = model => {
    let found = false;
    model.traverse(node => { if (node.userData.underfireVehicle) found = true; });
    return found;
};

Game.bindVehicleModel = (unit, model) => {
    const ud = unit.mesh.userData, wheels = [], steering = [], trails = [];
    model.traverse(node => {
        switch (node.userData.vehiclePart) {
            case 'turret':
                if (unit.hasTurret) {
                    ud.turret = ud.headNode = node;
                    ud.turretAxis = 'y'; ud.turretBaseRot = { x: 0, y: 0, z: 0 };
                }
                break;
            case 'gun': ud.gunNode = node; break;
            case 'wheel': wheels.push({ node, radius: node.userData.radius }); break;
            case 'steering': steering.push(node); break;
            case 'trail': trails.push(node); break;
        }
    });
    ud.vehicleRig = { wheels, steering, trails, closed: 0, lastX: unit.x, lastZ: unit.z, lastAngle: unit.angle, steer: 0 };
};

Game.updateVehicleModel = (unit, dt) => {
    const ud = unit.mesh?.userData, rig = ud?.vehicleRig;
    if (!rig) return;
    const dx = unit.x - rig.lastX, dz = unit.z - rig.lastZ;
    const distance = dx * Math.cos(unit.angle) + dz * Math.sin(unit.angle);
    const turn = Game.angleDiff(rig.lastAngle, unit.angle);
    rig.lastX = unit.x; rig.lastZ = unit.z; rig.lastAngle = unit.angle;
    rig.closed = Game.lerp(rig.closed, unit.deployed && !unit._towed ? 0 : 1, 1 - Math.exp(-dt * 4));
    for (const node of rig.trails) node.rotation.y = node.userData.closedYaw * rig.closed;
    if (!Game.isTank(unit.kind) && ud.weaponRecoil) {
        const age = unit._shotAge ?? Infinity, recoil = ud.weaponRecoil;
        const kick = age >= 0 && age < 0.55 ? 0.12 * Math.sin(Math.PI * age / 0.55) * Math.exp(-age * 2) : 0;
        recoil.node.position.copy(recoil.base).addScaledVector(recoil.direction, -kick);
    }
    // Use actual travel: blocked units stop rolling; reverse reverses the tyres.
    // Teleports/spawns never become a burst of wheel animation.
    if (unit.alive && Math.hypot(dx, dz) < 3 && dt > 0) {
        const T = Game.THREE;
        for (const wheel of rig.wheels) {
            const ws = wheel.node.getWorldScale(new T.Vector3());
            let travel = distance;
            if (unit.driveType === 'tracked') {
                const local = unit.mesh.worldToLocal(wheel.node.getWorldPosition(new T.Vector3()));
                travel -= turn * local.x;
            }
            wheel.node.rotation.x = (wheel.node.rotation.x + travel / Math.max(0.02, wheel.radius * Math.abs(ws.y))) % (Math.PI * 2);
        }
        const desired = Game.isTruck(unit.kind) ? -(unit._truckSteer || 0)
            : Math.abs(distance) > 0.002 ? Game.clamp(-turn * unit.size / distance, -0.5, 0.5) : 0;
        rig.steer = Game.lerp(rig.steer, desired, 1 - Math.exp(-dt * 8));
        for (const node of rig.steering) node.rotation.y = rig.steer;
    }
};

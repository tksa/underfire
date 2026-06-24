/**
 * Under Fire — utils.js
 * Pure math helpers and tile utilities.
 * Works with x/z coordinates for the 3D ground plane.
 */
Game.rand = (min = 0, max = 1) => min + Math.random() * (max - min);
Game.randi = (min, max) => Math.floor(Game.rand(min, max + 1));
Game.clamp = (v, min, max) => Math.max(min, Math.min(max, v));
Game.lerp = (a, b, t) => a + (b - a) * t;
Game.dist = (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az);
Game.distSq = (ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az; return dx * dx + dz * dz; };
Game.angleTo = (ax, az, bx, bz) => Math.atan2(bz - az, bx - ax);

Game.lerpAngle = (a, b, t) => {
    let diff = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return a + diff * t;
};

Game.angleDiff = (a, b) => {
    let diff = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return diff;
};

/**
 * Rotate angle 'from' toward angle 'to' by at most 'maxStep' radians.
 * Returns the new angle. Uses shortest-path rotation.
 */
Game.rotateTo = (from, to, maxStep) => {
    const diff = Game.angleDiff(from, to);
    if (Math.abs(diff) <= maxStep) return to;
    return from + Math.sign(diff) * maxStep;
};

/**
 * Acceleration-based rotation with inertia (ease-in / ease-out).
 * @param {number} angle     Current angle (rad)
 * @param {number} angVel    Current angular velocity (rad/s)
 * @param {number} target    Target angle (rad)
 * @param {number} maxVel    Max angular speed (rad/s)
 * @param {number} accel     Angular acceleration (rad/s²)
 * @param {number} dt        Delta time (s)
 * @returns {{angle: number, angVel: number}}
 */
Game.rotateWithInertia = (angle, angVel, target, maxVel, accel, dt) => {
    // Guard: if no accel/maxVel, fall back to instant rotation
    if (!accel || !maxVel) {
        return { angle: Game.rotateTo(angle, target, (maxVel || 2) * dt), angVel: 0 };
    }
    const diff = Game.angleDiff(angle, target);
    const absDiff = Math.abs(diff);

    // Close enough — snap and stop
    if (absDiff < 0.01 && Math.abs(angVel) < 0.05) {
        return { angle: target, angVel: 0 };
    }

    const dir = Math.sign(diff);
    // Braking distance at current velocity
    const brakeDist = (angVel * angVel) / (2 * accel);

    // Should we accelerate or brake?
    const sameDir = Math.sign(angVel) === dir || Math.abs(angVel) < 0.01;

    if (sameDir && absDiff > brakeDist + 0.02) {
        // Accelerate toward target
        angVel += dir * accel * dt;
    } else {
        // Decelerate (brake)
        angVel -= Math.sign(angVel) * accel * dt;
        // Prevent overshoot past zero
        if (Math.abs(angVel) < accel * dt * 0.5) angVel = 0;
    }

    // Wrong direction — brake harder
    if (!sameDir && Math.abs(angVel) > 0.01) {
        angVel -= Math.sign(angVel) * accel * 2 * dt;
    }

    // Clamp to max velocity
    angVel = Game.clamp(angVel, -maxVel, maxVel);

    angle += angVel * dt;
    return { angle, angVel };
};

Game.tileAtWorld = (x, z) => ({
    tx: Game.clamp(Math.floor(x / Game.TILE), 0, Game.MAP_COLS - 1),
    ty: Game.clamp(Math.floor(z / Game.TILE), 0, Game.MAP_ROWS - 1)
});

Game.worldFromTile = (tx, ty) => ({
    x: tx * Game.TILE + Game.TILE / 2,
    z: ty * Game.TILE + Game.TILE / 2
});

Game.getTile = (tx, ty) => {
    if (tx < 0 || ty < 0 || tx >= Game.MAP_COLS || ty >= Game.MAP_ROWS) return null;
    return Game.terrain[ty][tx];
};

Game.getTileAtWorld = (x, z) => {
    const t = Game.tileAtWorld(x, z);
    return Game.getTile(t.tx, t.ty);
};

Game.isBlocked = (tx, ty) => {
    const tile = Game.getTile(tx, ty);
    return !tile || tile.blocked;
};

Game.pushMessage = (text, ttl = 4) => {
    Game.messages.push({ text, ttl, total: ttl });
    // Render into HUD log panel
    const container = Game.hud?.messages || document.getElementById('gameMessages');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'game-msg';
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    // Fade out before removal
    const fadeStart = Math.max(0, (ttl - 0.5)) * 1000;
    setTimeout(() => div.classList.add('fading'), fadeStart);
    setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, ttl * 1000);
    // Cap visible messages at 8
    while (container.children.length > 8) container.removeChild(container.firstChild);
};

Game.formatTime = (t) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
};

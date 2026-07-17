/**
 * Under Fire — camera.js
 * Orthographic camera: arrow keys, edge-pan, and +/- zoom.
 * (Letter keys are reserved for unit commands — no WASD pan.)
 */

Game.updateCamera = (dt) => {
    const edge = 30;  // pixels from edge for edge-pan
    let dx = 0, dz = 0;

    // Shift + arrows = orbit the view instead of panning it: left/right spins
    // the yaw, up/down tilts toward/away from top-down. Zoom stays on +/- and
    // works with Shift held too. (Shift only modifies mouse clicks elsewhere,
    // so the arrow keys are free while it's down.)
    const shiftHeld = Game.keys['ShiftLeft'] || Game.keys['ShiftRight'];
    if (shiftHeld) {
        const yawSpeed = 55, tiltSpeed = 35;   // deg/s — slow enough to aim
        let yaw = Game.camYawDeg != null ? Game.camYawDeg : 23;
        let tilt = Game.camTiltDeg || 45;
        if (Game.keys['ArrowLeft']) yaw -= yawSpeed * dt;
        if (Game.keys['ArrowRight']) yaw += yawSpeed * dt;
        if (Game.keys['ArrowUp']) tilt += tiltSpeed * dt;    // toward top-down
        if (Game.keys['ArrowDown']) tilt -= tiltSpeed * dt;  // more oblique
        Game.camYawDeg = ((yaw % 360) + 360) % 360;
        Game.camTiltDeg = Game.clamp(tilt, 25, 88);
    } else {
        // Arrow keys pan
        if (Game.keys['ArrowLeft']) dx -= 1;
        if (Game.keys['ArrowRight']) dx += 1;
        if (Game.keys['ArrowUp']) dz -= 1;
        if (Game.keys['ArrowDown']) dz += 1;
    }

    // Edge-pan (screen pixel coordinates) — disabled when mouse is over HUD
    const overHUD = Game.mouse.screenY > Game.viewH - 160;
    // Keep the world point under a directional right-drag stable. If edge-pan
    // moved the camera mid-gesture, the arrow endpoint would drift beneath the
    // cursor and produce a different heading from the one the player drew.
    if (!overHUD && !Game._rightOrderDrag) {
        if (Game.mouse.screenX < edge) dx -= 1;
        if (Game.mouse.screenX > Game.viewW - edge) dx += 1;
        if (Game.mouse.screenY < edge) dz -= 1;
        if (Game.mouse.screenY > Game.viewH - edge) dz += 1;
    }

    // The view is yawed (see below), so rotate pan input into screen space:
    // screen-left stays screen-left regardless of the camera yaw.
    const camYawR = (Game.camYawDeg != null ? Game.camYawDeg : 23) * Math.PI / 180;
    const yawC = Math.cos(camYawR), yawS = Math.sin(camYawR);
    const speed = 30;
    Game.cam.x += (dx * yawC + dz * yawS) * speed * dt;
    Game.cam.z += (-dx * yawS + dz * yawC) * speed * dt;

    // Keyboard zoom: + zooms in (smaller frustum), - zooms out. Hold to zoom smoothly.
    const zoomSpeed = 26;
    if (Game.keys['Equal'] || Game.keys['NumpadAdd']) Game.cam.targetZoom -= zoomSpeed * dt;
    if (Game.keys['Minus'] || Game.keys['NumpadSubtract']) Game.cam.targetZoom += zoomSpeed * dt;

    // Smooth zoom + dynamic max zoom cap (frustum can't exceed map)
    const zoomAspect = Game.viewW / Game.viewH;
    const maxZoomX = Game.WORLD_W / (2 * zoomAspect);
    const maxZoomZ = Game.WORLD_H / 2;
    const maxZoom = Math.min(Game.zoomMax || 60, maxZoomX, maxZoomZ);
    Game.cam.targetZoom = Game.clamp(Game.cam.targetZoom, Game.zoomMin || 8, maxZoom);
    Game.cam.zoom = Game.lerp(Game.cam.zoom, Game.cam.targetZoom, 6 * dt);

    // Compute frustum size for clamping + rendering
    const aspect = Game.viewW / Game.viewH;
    const f = Game.cam.zoom;
    const marginX = f * aspect;  // Half visible width
    const marginZ = f;           // Half visible height

    // Clamp camera to map bounds (frustum never extends past terrain)
    Game.cam.x = Game.clamp(Game.cam.x, marginX, Math.max(marginX, Game.WORLD_W - marginX));
    Game.cam.z = Game.clamp(Game.cam.z, marginZ, Math.max(marginZ, Game.WORLD_H - marginZ));

    // Apply camera position (oblique, Sudden Strike-style tilt).
    // Lower angle from horizontal = more tilted/oblique; 90° would be straight down.
    const camAngle = (Game.camTiltDeg || 45) * Math.PI / 180;
    const elevation = Game.cam.zoom * 1.5 * Math.sin(camAngle) / Math.sin(60 * Math.PI / 180);
    const offset = elevation / Math.tan(camAngle);

    // Camera shake
    let shakeX = 0, shakeZ = 0;
    if (Game.cameraShake > 0) {
        shakeX = Game.rand(-Game.cameraShake, Game.cameraShake) * 0.1;
        shakeZ = Game.rand(-Game.cameraShake, Game.cameraShake) * 0.1;
        Game.cameraShake = Math.max(0, Game.cameraShake - dt * 24);
    }
    // Aircraft rumble — a DIFFERENT kind of shake: continuous low sinusoidal
    // vibration (blended engine harmonics) while a plane passes near overhead,
    // instead of the sharp random jolts of explosions. Subtle but unmistakably
    // tied to the flyover; intensity comes from updateFighters (proximity ×
    // low-altitude factor).
    if ((Game.planeRumble || 0) > 0.02) {
        const t = Game.gameClock || 0;
        const a = 0.018 * Game.planeRumble;   // felt, not seen — a light rumble
        shakeX += (Math.sin(t * 53) + Math.sin(t * 31) * 0.6) * a;
        shakeZ += (Math.cos(t * 47) + Math.sin(t * 37) * 0.6) * a;
    }

    // Yaw the viewpoint ~23° to the right (Game.camYawDeg) so the map reads
    // obliquely instead of grid-square to the screen.
    Game.camera.position.set(
        Game.cam.x + Math.sin(camYawR) * offset + shakeX,
        elevation,
        Game.cam.z + Math.cos(camYawR) * offset + shakeZ
    );
    Game.camera.lookAt(Game.cam.x, 0, Game.cam.z);

    // Update orthographic frustum for zoom
    Game.camera.left = -f * aspect;
    Game.camera.right = f * aspect;
    Game.camera.top = f;
    Game.camera.bottom = -f;
    Game.camera.updateProjectionMatrix();

    // Update sun position to follow camera
    if (Game.sun) {
        Game.sun.position.set(Game.cam.x + 40, 80, Game.cam.z - 30);
        Game.sun.target.position.set(Game.cam.x, 0, Game.cam.z);
        Game.sun.target.updateMatrixWorld();
    }
};

Game.centerOnAction = () => {
    const selected = Game.selectedPlayerUnits();
    if (selected.length) {
        const avgX = selected.reduce((a, u) => a + u.x, 0) / selected.length;
        const avgZ = selected.reduce((a, u) => a + u.z, 0) / selected.length;
        Game.cam.x = Game.clamp(avgX, 0, Game.WORLD_W);
        Game.cam.z = Game.clamp(avgZ, 0, Game.WORLD_H);
    }
};

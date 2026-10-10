/** Short, fast projectile glimpses. Visual randomness never consumes combat RNG. */
Game._tracerRandom = () => {
    Game._tracerSeed = (Math.imul(Game._tracerSeed ?? 19790417, 1664525) + 1013904223) >>> 0;
    return Game._tracerSeed / 4294967296;
};

Game.prepareTracer = tr => {
    if (tr.visual) return tr;
    const random = Game._tracerRandom;
    const mg = ['lmg', 'hmg', 'mg', 'machine'].includes(tr.weaponType);
    const heavy = tr.big && !mg && !['smg', 'pistol', 'rifle'].includes(tr.weaponType);
    const roll = random(), shade = random(), strength = random();
    const bright = !tr.mortar && (tr.ricochet || roll < (mg ? .22 : heavy ? .25 : .10));
    const colors = tr.mortar ? [0x8f9687, 0xa29c86, 0x747e75]
        : bright ? [0xffcf91, 0xf1dfb7, 0xffb57f, 0xe9e5d4]
            : [0xa49f8e, 0xb7b6a9, 0x8b9694, 0xc0b298];
    // Most ordinary rounds have no luminous trail. Some briefly catch the light;
    // a minority are bright tracers. These are presentation choices, not ammo odds.
    tr.visual = {
        bright,
        color: colors[Math.floor(shade * colors.length)],
        opacity: tr.mortar ? .35 + strength * .2
            : bright ? .30 + strength * .40 : roll < .55 ? 0 : .025 + strength * .10,
        length: tr.mortar ? .24 : tr.ricochet ? .35 + random() * .45
            : heavy ? .65 + random() * 1.15 : .30 + random() * 1.15,
        width: tr.mortar ? .12 : heavy ? .045 : bright ? .026 : .045,
    };
    if (!tr.mortar && !tr.ricochet && !tr.preserveFlight) {
        const distance = Math.hypot(tr.tx - tr.x, tr.tz - tr.z, (tr.y1 || 0) - (tr.y0 || 0));
        const baseSpeed = tr.weaponType === 'pistol' ? 480 : tr.weaponType === 'smg' ? 650 : heavy ? 780 : 1050;
        const elapsed = Math.max(0, (tr.total || 0) - (tr.life || 0));
        tr.total = Math.max(.035, distance / (baseSpeed * (.94 + random() * .12)));
        tr.life = Math.max(0, tr.total - elapsed);
    }
    return tr;
};

Game.addTracer = tr => { Game.tracers.push(Game.prepareTracer(tr)); return tr; };

Game._ensureTracerBatch = () => {
    const T = Game.THREE;
    if (!Game._tracerBatch) {
        const capacity = 256, geometry = new T.PlaneGeometry(1, 1);
        const colors = new T.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
        colors.setUsage(T.DynamicDrawUsage); geometry.setAttribute('tracerTone', colors);
        const material = new T.ShaderMaterial({
            transparent: true, depthWrite: false, side: T.DoubleSide,
            vertexShader: `attribute vec4 tracerTone; varying vec4 vTone; varying vec2 vUv;
                void main() { vUv=uv; vTone=tracerTone;
                    gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0); }`,
            fragmentShader: `varying vec4 vTone; varying vec2 vUv;
                void main() {
                    float edge=1.0-smoothstep(.05,.5,abs(vUv.y-.5));
                    float tip=1.0-smoothstep(.80,1.0,vUv.x);
                    float tail=smoothstep(0.0,.45,vUv.x);
                    gl_FragColor=vec4(vTone.rgb,vTone.a*edge*tail*tip);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }`,
        });
        const mesh = new T.InstancedMesh(geometry, material, capacity);
        mesh.name = 'projectile-glimpses'; mesh.count = 0; mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); mesh.raycast = () => {};
        Game._tracerBatch = { mesh, colors, capacity, matrix: new T.Matrix4(),
            head: new T.Vector3(), back: new T.Vector3(), direction: new T.Vector3(),
            side: new T.Vector3(), normal: new T.Vector3(), view: new T.Vector3(),
            scale: new T.Vector3(), color: new T.Color() };
    }
    const batch = Game._tracerBatch;
    if (batch.mesh.parent !== Game.effectsGroup) Game.effectsGroup.add(batch.mesh);
    return batch;
};

Game.updateTracers3D = dt => {
    let batch = Game._tracerBatch, count = 0;
    if (batch) batch.mesh.count = 0;
    for (let i = Game.tracers.length - 1; i >= 0; i--) {
        const tr = Game.prepareTracer(Game.tracers[i]);
        tr.life -= dt;
        if (tr.life <= 0) {
            if (tr.impact) {
                Game.emitWeaponImpact?.(tr.tx, tr.tz, tr.impact, tr.impact.angle, tr.impact.onArmor);
                if (tr.impact.kind === 'he') Game.Audio?.explosion(tr.tx, tr.tz);
            } else if (tr.terrainDamage > 0 && Game.spawnCrater) {
                const radius = Game.rand(.6, 1) * tr.terrainDamage;
                Game.spawnCrater(tr.tx + Game.rand(-.3, .3), tr.tz + Game.rand(-.3, .3), radius, .8 * tr.terrainDamage);
            }
            Game.tracers.splice(i, 1); continue;
        }
        const style = tr.visual;
        if (style.opacity === 0) continue;
        if (!batch) batch = Game._ensureTracerBatch();
        if (batch.mesh.parent !== Game.effectsGroup) Game.effectsGroup.add(batch.mesh);
        if (count >= batch.capacity) continue; // visual overflow never drops impact work
        const p = Game.clamp(1 - tr.life / tr.total, 0, 1);
        const distance = Math.max(.01, Math.hypot(tr.tx - tr.x, tr.tz - tr.z,
            (tr.y1 || 0) - (tr.y0 || 0)));
        const tail = Math.max(0, p - style.length / distance);
        const yAt = q => tr.y0 != null
            ? Game.lerp(tr.y0, tr.y1 ?? .6, q) + (tr.arc || 0) * 4 * q * (1 - q)
            : (Game.getHeight?.(Game.lerp(tr.x, tr.tx, q), Game.lerp(tr.z, tr.tz, q)) || 0) + (tr.big ? .8 : .6);
        batch.head.set(Game.lerp(tr.x, tr.tx, p), yAt(p), Game.lerp(tr.z, tr.tz, p));
        batch.back.set(Game.lerp(tr.x, tr.tx, tail), yAt(tail), Game.lerp(tr.z, tr.tz, tail));
        batch.direction.subVectors(batch.head, batch.back);
        const length = Math.max(.001, batch.direction.length()); batch.direction.normalize();
        Game.camera.getWorldDirection(batch.view).negate();
        batch.side.crossVectors(batch.direction, batch.view);
        if (batch.side.lengthSq() < 1e-6) batch.side.crossVectors(batch.direction, Game.camera.up);
        batch.side.normalize(); batch.normal.crossVectors(batch.direction, batch.side).normalize();
        const pixel = (Game.camera.top - Game.camera.bottom) / Math.max(1, Game.viewH);
        batch.scale.set(length, Math.max(style.width, pixel * (style.bright ? 1.5 : 1.7)), 1);
        batch.matrix.makeBasis(batch.direction, batch.side, batch.normal).scale(batch.scale);
        batch.matrix.setPosition(batch.head.add(batch.back).multiplyScalar(.5));
        batch.mesh.setMatrixAt(count, batch.matrix);
        const view = .65 + .35 * (.5 - .5 * batch.direction.dot(batch.view));
        const fade = tr.mortar ? 1 : Math.min(1, p * 12, (1 - p) * 8);
        batch.color.setHex(style.color);
        batch.colors.setXYZW(count, batch.color.r, batch.color.g, batch.color.b, style.opacity * view * fade);
        count++;
    }
    if (batch) {
        batch.mesh.count = count;
        batch.mesh.visible = count > 0;
        if (count) { batch.mesh.instanceMatrix.needsUpdate = true; batch.colors.needsUpdate = true; }
    }
};

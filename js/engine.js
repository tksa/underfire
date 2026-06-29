/**
 * Under Fire — engine.js
 * Three.js scene setup, lighting, ground plane, and GLTF model loader.
 * This is loaded as a classic script — Three.js is loaded via global CDN.
 */

Game.initEngine = () => {
    const THREE = window.THREE;
    Game.THREE = THREE;

    const container = document.getElementById('viewport');
    Game.viewW = container.clientWidth;
    Game.viewH = container.clientHeight;

    // Renderer
    Game.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    Game.renderer.setSize(Game.viewW, Game.viewH);
    Game.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    Game.renderer.shadowMap.enabled = true;
    Game.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    Game.renderer.setClearColor(0xcabf9f); // warm hazy horizon
    container.insertBefore(Game.renderer.domElement, container.firstChild);

    // Scene
    Game.scene = new THREE.Scene();
    // Light warm haze only — keep the field patchwork crisp
    Game.scene.fog = new THREE.FogExp2(0xd0cab0, 0.0016);

    // Camera (orthographic, top-down angled)
    const aspect = Game.viewW / Game.viewH;
    const frustum = Game.cam.zoom;
    Game.camera = new THREE.OrthographicCamera(
        -frustum * aspect, frustum * aspect,
        frustum, -frustum,
        0.1, 500
    );
    Game.camera.position.set(Game.cam.x, 60, Game.cam.z + 40);
    Game.camera.lookAt(Game.cam.x, 0, Game.cam.z);

    // Lighting — warm late-summer afternoon
    const ambient = new THREE.AmbientLight(0xb3a684, 2.1);
    Game.scene.add(ambient);
    Game.ambient = ambient;

    const sun = new THREE.DirectionalLight(0xffe6b8, 5.05);
    sun.position.set(40, 80, -30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -100;
    sun.shadow.camera.right = 100;
    sun.shadow.camera.top = 100;
    sun.shadow.camera.bottom = -100;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 200;
    sun.shadow.bias = -0.001;
    sun.shadow.radius = 4;   // soft shadow edges (esp. trees); tunable in debug
    Game.scene.add(sun);
    Game.scene.add(sun.target);
    Game.sun = sun;

    // Cloud shadow plane — drifts overhead, creates moving light patches
    const cloudRes = 256;
    const cloudCanvas = document.createElement('canvas');
    cloudCanvas.width = cloudRes;
    cloudCanvas.height = cloudRes;
    const cctx = cloudCanvas.getContext('2d');
    // Generate procedural cloud noise
    const cimg = cctx.createImageData(cloudRes, cloudRes);
    for (let i = 0; i < cloudRes * cloudRes; i++) {
        const x = i % cloudRes, y = Math.floor(i / cloudRes);
        // Layered sine noise for soft cloud shapes
        const n = Math.sin(x * 0.04) * Math.cos(y * 0.035)
            + Math.sin(x * 0.02 + y * 0.015) * 0.7
            + Math.sin(x * 0.065 - y * 0.04) * 0.5;
        const v = Math.max(0, Math.min(255, (n + 1.2) * 80));
        cimg.data[i * 4] = cimg.data[i * 4 + 1] = cimg.data[i * 4 + 2] = v;
        cimg.data[i * 4 + 3] = 255;
    }
    cctx.putImageData(cimg, 0, 0);
    const cloudTex = new THREE.CanvasTexture(cloudCanvas);
    cloudTex.wrapS = cloudTex.wrapT = THREE.RepeatWrapping;
    cloudTex.repeat.set(2, 2);

    const cloudGeo = new THREE.PlaneGeometry(Game.WORLD_W * 2, Game.WORLD_H * 2);
    const cloudMat = new THREE.MeshBasicMaterial({
        color: 0x000000,
        alphaMap: cloudTex,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    Game.cloudShadow = new THREE.Mesh(cloudGeo, cloudMat);
    Game.cloudShadow.rotation.x = -Math.PI / 2;
    Game.cloudShadow.position.set(Game.WORLD_W / 2, 8, Game.WORLD_H / 2);
    Game.scene.add(Game.cloudShadow);

    // Ground plane (for raycasting)
    const groundGeo = new THREE.PlaneGeometry(Game.WORLD_W + 20, Game.WORLD_H + 20);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x161a1e, roughness: 0.95 });
    Game.groundPlane = new THREE.Mesh(groundGeo, groundMat);
    Game.groundPlane.rotation.x = -Math.PI / 2;
    Game.groundPlane.position.set(Game.WORLD_W / 2, -0.05, Game.WORLD_H / 2);
    Game.groundPlane.receiveShadow = true;
    Game.scene.add(Game.groundPlane);

    // Groups
    Game.terrainGroup = new THREE.Group();
    Game.terrainGroup.name = 'terrain';
    Game.scene.add(Game.terrainGroup);

    Game.unitsGroup = new THREE.Group();
    Game.unitsGroup.name = 'units';
    Game.scene.add(Game.unitsGroup);

    Game.effectsGroup = new THREE.Group();
    Game.effectsGroup.name = 'effects';
    Game.scene.add(Game.effectsGroup);

    // Raycaster
    Game.raycaster = new THREE.Raycaster();

    // GLTF loader (+ Draco decoder for compressed meshes like the building model)
    if (Game.GLTFLoader) {
        Game.gltfLoader = new Game.GLTFLoader();
        if (Game.DRACOLoader) {
            const draco = new Game.DRACOLoader();
            // Decoder from jsDelivr (same CDN as our other libs — more reliable
            // here than gstatic), pinned to our three version.
            draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/draco/');
            Game.gltfLoader.setDRACOLoader(draco);
            Game.dracoLoader = draco;
        }
    } else {
        Game.gltfLoader = null;
    }

    // Handle resize
    window.addEventListener('resize', () => {
        Game.viewW = container.clientWidth;
        Game.viewH = container.clientHeight;
        const aspect = Game.viewW / Game.viewH;
        const f = Game.cam.zoom;
        Game.camera.left = -f * aspect;
        Game.camera.right = f * aspect;
        Game.camera.top = f;
        Game.camera.bottom = -f;
        Game.camera.updateProjectionMatrix();
        Game.renderer.setSize(Game.viewW, Game.viewH);
        if (Game.composer) Game._applyComposerSize();
    });

    // Postprocessing (bloom, tilt-shift DoF, colour grade, vignette, SMAA)
    Game.setupPostFX();
};

/**
 * Load a 3D model (GLTF/GLB or FBX). Returns a Promise<THREE.Group>.
 */
Game._cloneModel = (src) => {
    const c = Game.SkeletonUtils ? Game.SkeletonUtils.clone(src) : src.clone();
    c.animations = src.animations || [];
    return c;
};

Game.loadModel = (path) => {
    if (Game.modelCache[path]) {
        return Promise.resolve(Game._cloneModel(Game.modelCache[path]));
    }

    const isFBX = path.toLowerCase().endsWith('.fbx');
    const isPLY = path.toLowerCase().endsWith('.ply');

    if (isFBX) {
        // Lazy-init FBX loader
        if (!Game.fbxLoader && Game.FBXLoader) {
            Game.fbxLoader = new Game.FBXLoader();
        }
        if (!Game.fbxLoader) return Promise.reject('No FBX loader available');
        return new Promise((resolve, reject) => {
            Game.fbxLoader.load(
                path,
                (group) => {
                    Game.modelCache[path] = group;
                    resolve(group.clone());
                },
                undefined,
                (err) => reject(err)
            );
        });
    } else if (isPLY) {
        // PLY loader — returns BufferGeometry, wrap in Mesh + Group
        if (!Game.plyLoader && Game.PLYLoader) {
            Game.plyLoader = new Game.PLYLoader();
        }
        if (!Game.plyLoader) return Promise.reject('No PLY loader available');
        return new Promise((resolve, reject) => {
            Game.plyLoader.load(
                path,
                (geometry) => {
                    geometry.computeVertexNormals();
                    // PLY may have vertex colors
                    const hasColors = geometry.hasAttribute('color');
                    const mat = new Game.THREE.MeshStandardMaterial({
                        color: 0x888888,
                        roughness: 0.8,
                        metalness: 0.1,
                        vertexColors: hasColors,
                    });
                    const mesh = new Game.THREE.Mesh(geometry, mat);
                    mesh.name = path.split('/').pop().replace('.ply', '');
                    const group = new Game.THREE.Group();
                    group.add(mesh);
                    Game.modelCache[path] = group;
                    resolve(group.clone());
                },
                undefined,
                (err) => reject(err)
            );
        });
    } else {
        // GLTF/GLB
        if (!Game.gltfLoader) return Promise.reject('No GLTF loader available');
        return new Promise((resolve, reject) => {
            Game.gltfLoader.load(
                path,
                (gltf) => {
                    // Cache the original scene and its animations
                    const scene = gltf.scene;
                    scene.animations = gltf.animations || [];
                    Game.modelCache[path] = scene;
                    resolve(Game._cloneModel(scene)); // SkeletonUtils clone keeps the rig bindable

                },
                undefined,
                (err) => reject(err)
            );
        });
    }
};

/**
 * Raycast from screen coordinates to ground plane.
 */
Game.screenToGround = (screenX, screenY) => {
    const THREE = Game.THREE;
    const ndc = new THREE.Vector2(
        (screenX / Game.viewW) * 2 - 1,
        -(screenY / Game.viewH) * 2 + 1
    );
    Game.raycaster.setFromCamera(ndc, Game.camera);

    // Try terrain mesh first (accurate 3D surface)
    if (Game.terrainMesh) {
        const hits = Game.raycaster.intersectObject(Game.terrainMesh);
        if (hits.length > 0) {
            return { x: hits[0].point.x, z: hits[0].point.z };
        }
    }

    // Fall back to flat ground plane
    const intersects = Game.raycaster.intersectObject(Game.groundPlane);
    if (intersects.length > 0) {
        return { x: intersects[0].point.x, z: intersects[0].point.z };
    }
    return null;
};

/**
 * Pick the living unit whose 3D mesh is directly under the cursor. Raycasts the
 * actual meshes (not the ground), so it works regardless of camera parallax —
 * clicking a tall tank body targets that tank, not the ground behind it.
 */
Game.unitAtScreen = (screenX, screenY) => {
    if (!Game.raycaster || !Game.unitsGroup) return null;
    const THREE = Game.THREE;
    const ndc = new THREE.Vector2((screenX / Game.viewW) * 2 - 1, -(screenY / Game.viewH) * 2 + 1);
    Game.raycaster.setFromCamera(ndc, Game.camera);
    const hits = Game.raycaster.intersectObjects(Game.unitsGroup.children, true);
    for (const h of hits) {
        let o = h.object;
        while (o && (!o.userData || o.userData.unitId == null)) o = o.parent;
        if (o && o.userData && o.userData.unitId != null) {
            const u = Game.getUnitById(o.userData.unitId);
            if (u && u.alive && u.mesh && u.mesh.visible !== false) return u;
        }
    }
    return null;
};

/**
 * Project a world position to screen pixel coordinates.
 */
Game.worldToScreen = (x, z) => {
    const THREE = Game.THREE;
    const vec = new THREE.Vector3(x, 0, z);
    vec.project(Game.camera);
    return {
        x: (vec.x * 0.5 + 0.5) * Game.viewW,
        y: (-vec.y * 0.5 + 0.5) * Game.viewH
    };
};

/**
 * Build the postprocessing pipeline (pmndrs/postprocessing, MIT, from CDN):
 * bloom, tilt-shift depth-of-field, colour grading, vignette and SMAA.
 * Degrades to a direct render if the library or a GL feature is unavailable.
 */
Game.setupPostFX = () => {
    const PF = Game.PostFX;
    if (!PF || !Game.renderer || !Game.scene || !Game.camera) return false;
    if (Game.postFXDisabled) return false;
    try {
        const composer = new PF.EffectComposer(Game.renderer, {
            frameBufferType: THREE.HalfFloatType,
            multisampling: Math.min(4, Game.renderer.capabilities.maxSamples || 0),  // hardware MSAA (the composer bypasses the renderer's own AA)
        });
        composer.addPass(new PF.RenderPass(Game.scene, Game.camera));

        const bloom = new PF.BloomEffect({
            intensity: 0.4,
            luminanceThreshold: 0.65,
            luminanceSmoothing: 0.3,
            radius: 0.7,
            mipmapBlur: true,
        });
        const tiltShift = new PF.TiltShiftEffect({
            offset: 0.0,
            rotation: 0.0,
            focusArea: 0.9,    // wide sharp band over the playfield (tuned)
            feather: 0.22,
            kernelSize: PF.KernelSize.SMALL,
        });
        const hueSat = new PF.HueSaturationEffect({ hue: -0.06, saturation: 0.05 });
        const brightContrast = new PF.BrightnessContrastEffect({ brightness: 0.01, contrast: 0.12 });
        const vignette = new PF.VignetteEffect({ offset: 0.62, darkness: 0.67 });
        const smaa = new PF.SMAAEffect();

        const smaaPass = new PF.EffectPass(Game.camera, smaa);
        composer.addPass(smaaPass);
        composer.addPass(new PF.EffectPass(Game.camera, bloom));
        composer.addPass(new PF.EffectPass(Game.camera, tiltShift));
        composer.addPass(new PF.EffectPass(Game.camera, hueSat, brightContrast, vignette));

        Game.composer = composer;
        Game.postfx = { bloom, tiltShift, hueSat, brightContrast, vignette, smaa, smaaPass };

        // FSR-like upscaler: render the composed frame at reduced resolution and
        // edge-enhance it on the way up to the canvas.
        Game._setupUpscaler();
        Game._applyComposerSize();

        // Live-tunable state (mirrors the constructor values above) + debug UI.
        Game.postfxState = {
            upscaleFactor: Game.upscaleFactor,
            bloomIntensity: 0.4, bloomThreshold: 0.65,
            tiltFocusArea: 0.9, tiltFeather: 0.22,
            saturation: 0.05, hue: -0.06,
            brightness: 0.01, contrast: 0.12,
            vignetteOffset: 0.62, vignetteDarkness: 0.67,
            sunIntensity: Game._dbgSunBase != null ? Game._dbgSunBase : 5.05,
            ambientIntensity: Game._dbgAmbientBase != null ? Game._dbgAmbientBase : 2.1,
            cloudShadow: Game._dbgCloudBase != null ? Game._dbgCloudBase : 0,
            antialias: true,
            shadowBlur: (Game.sun && Game.sun.shadow) ? Game.sun.shadow.radius : 4,
            shadowStrength: (Game.sun && Game.sun.shadow && Game.sun.shadow.intensity !== undefined) ? Game.sun.shadow.intensity : 1,
            fxDustOpacity: (Game.fxDustOpacity != null) ? Game.fxDustOpacity : 1,
            fxDustLife: (Game.fxDustLife != null) ? Game.fxDustLife : 1,
            fxImpactDust: (Game.fxImpactDust != null) ? Game.fxImpactDust : 1,
            fxShake: (Game.fxShake != null) ? Game.fxShake : 1,
        };
        // Apply the FX defaults so the live globals exist before the panel opens.
        Game.fxDustOpacity = Game.postfxState.fxDustOpacity;
        Game.fxDustLife = Game.postfxState.fxDustLife;
        Game.fxImpactDust = Game.postfxState.fxImpactDust;
        Game.fxShake = Game.postfxState.fxShake;
        // VALOR realism passes (aerial perspective, grain, exposure) layered on
        // top. Self-contained and degradable: a failure leaves the base intact.
        if (Game.setupValor) { Game.setupValor(); Game._applyComposerSize(); }
        if (Game.buildingDebugDefaults) {
            for (const k in Game.buildingDebugDefaults) {
                if (Game.postfxState[k] === undefined) Game.postfxState[k] = Game.buildingDebugDefaults[k];
            }
        }
        Game.buildPostFXDebugUI();
        return true;
    } catch (e) {
        console.warn('PostFX setup failed, falling back to direct render:', e);
        Game.composer = null;
        Game.upscale = null;
        return false;
    }
};

// Edge-aware upscaling shader, ported from DevsDaddy/threejs-upscaler (MIT).
// Samples 4 neighbours and lifts edges; mix kept mild so it sharpens the
// low-res frame without washing out the postprocessed colours.
Game._upscaleFrag = `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    varying vec2 vUv;
    void main() {
        vec2 texelSize = 1.0 / resolution;
        vec4 color = texture2D(tDiffuse, vUv);
        vec4 cU = texture2D(tDiffuse, vUv + vec2(0.0, texelSize.y));
        vec4 cD = texture2D(tDiffuse, vUv - vec2(0.0, texelSize.y));
        vec4 cL = texture2D(tDiffuse, vUv - vec2(texelSize.x, 0.0));
        vec4 cR = texture2D(tDiffuse, vUv + vec2(texelSize.x, 0.0));
        float e = 1.0 - smoothstep(0.1, 0.3, length(color.rgb - cU.rgb));
        e += 1.0 - smoothstep(0.1, 0.3, length(color.rgb - cD.rgb));
        e += 1.0 - smoothstep(0.1, 0.3, length(color.rgb - cL.rgb));
        e += 1.0 - smoothstep(0.1, 0.3, length(color.rgb - cR.rgb));
        e = clamp(e, 0.0, 1.0);
        vec3 enhanced = mix(color.rgb, vec3(1.0) - (1.0 - color.rgb) * e, 0.25);
        // The composer's output buffer is LINEAR (autoRenderToScreen is off), so
        // encode to sRGB here or the upscaled frame comes out too dark.
        vec3 srgb = mix(enhanced * 12.92,
                        1.055 * pow(max(enhanced, 0.0), vec3(1.0 / 2.4)) - 0.055,
                        step(0.0031308, enhanced));
        gl_FragColor = vec4(srgb, color.a);
    }`;

Game._setupUpscaler = () => {
    const f = Game.upscaleFactor != null ? Game.upscaleFactor : 1.0;  // upscaler off by default
    Game.upscaleFactor = f;
    if (!(f > 1.001) || !Game.composer) { Game.upscale = null; return; }
    Game.composer.autoRenderToScreen = false;   // keep the result in outputBuffer
    const mat = new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: null }, resolution: { value: new THREE.Vector2(2, 2) } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: Game._upscaleFrag,
        depthTest: false, depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(quad);
    Game.upscale = { mat, scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
};

// Size the composer's internal buffers (reduced for upscaling) while keeping
// the canvas at full resolution.
Game._applyComposerSize = () => {
    if (!Game.composer) return;
    const f = Game.upscaleFactor || 1.0;
    if (Game.upscale && f > 1.001) {
        const lowW = Math.max(2, Math.round(Game.viewW / f));
        const lowH = Math.max(2, Math.round(Game.viewH / f));
        Game.composer.setSize(lowW, lowH);                 // composer buffers (also resizes renderer)
        Game.renderer.setSize(Game.viewW, Game.viewH);     // restore full-res canvas
        Game.upscale.mat.uniforms.resolution.value.set(lowW, lowH);
    } else {
        Game.composer.setSize(Game.viewW, Game.viewH);
    }
};

/**
 * Render one frame (through the postprocessing composer + upscaler when available).
 */
Game.renderScene = () => {
    if (Game.composer && Game.upscale) {
        Game.composer.render();
        Game.upscale.mat.uniforms.tDiffuse.value = Game.composer.outputBuffer.texture;
        Game.renderer.setRenderTarget(null);
        Game.renderer.render(Game.upscale.scene, Game.upscale.camera);
    } else if (Game.composer) {
        Game.composer.render();
    } else {
        Game.renderer.render(Game.scene, Game.camera);
    }
};

// Change the upscaler factor at runtime (1.0 = off). Rebuilds the blit quad
// and resizes the composer buffers accordingly.
Game.setUpscale = (f) => {
    Game.upscaleFactor = f;
    if (Game.postfxState) Game.postfxState.upscaleFactor = f;
    if (!Game.composer) return;
    if (f > 1.001) {
        if (!Game.upscale) Game._setupUpscaler();
        Game.composer.autoRenderToScreen = false;
    } else {
        Game.upscale = null;
        Game.composer.autoRenderToScreen = true;
    }
    Game._applyComposerSize();
};

// Descriptors for the debug-panel post-processing sliders. apply() writes the
// live effect/light; read-back for the copy box comes from Game.postfxState.
// Lighting writes the *base* the dynamic-light loop reads (Game._dbg*Base).
Game._postfxControlDefs = () => {
    const pf = Game.postfx || {};
    return [
        { group: 'Anti-aliasing', key: 'antialias', type: 'bool', label: 'SMAA', apply: v => { if (pf.smaaPass) pf.smaaPass.enabled = !!v; } },
        { group: 'Upscaler', key: 'upscaleFactor', label: 'Upscale Factor', min: 1, max: 3, step: 0.01, apply: v => Game.setUpscale(v) },
        { group: 'Bloom', key: 'bloomIntensity', label: 'Bloom Intensity', min: 0, max: 3, step: 0.05, apply: v => { if (pf.bloom) pf.bloom.intensity = v; } },
        { group: 'Bloom', key: 'bloomThreshold', label: 'Bloom Threshold', min: 0, max: 1, step: 0.01, apply: v => { if (pf.bloom && pf.bloom.luminanceMaterial) pf.bloom.luminanceMaterial.threshold = v; } },
        { group: 'Tilt-Shift', key: 'tiltFocusArea', label: 'Focus Area', min: 0, max: 1, step: 0.01, apply: v => { if (pf.tiltShift) pf.tiltShift.focusArea = v; } },
        { group: 'Tilt-Shift', key: 'tiltFeather', label: 'Feather', min: 0, max: 1, step: 0.01, apply: v => { if (pf.tiltShift) pf.tiltShift.feather = v; } },
        { group: 'Colour Grade', key: 'saturation', label: 'Saturation', min: -1, max: 1, step: 0.01, apply: v => { if (pf.hueSat) pf.hueSat.saturation = v; } },
        { group: 'Colour Grade', key: 'hue', label: 'Hue', min: -3.14, max: 3.14, step: 0.02, apply: v => { if (pf.hueSat) pf.hueSat.hue = v; } },
        { group: 'Colour Grade', key: 'brightness', label: 'Brightness', min: -0.5, max: 0.5, step: 0.01, apply: v => { if (pf.brightContrast) pf.brightContrast.brightness = v; } },
        { group: 'Colour Grade', key: 'contrast', label: 'Contrast', min: -0.5, max: 0.5, step: 0.01, apply: v => { if (pf.brightContrast) pf.brightContrast.contrast = v; } },
        { group: 'Vignette', key: 'vignetteOffset', label: 'Offset', min: 0, max: 1, step: 0.01, apply: v => { if (pf.vignette) pf.vignette.offset = v; } },
        { group: 'Vignette', key: 'vignetteDarkness', label: 'Darkness', min: 0, max: 1, step: 0.01, apply: v => { if (pf.vignette) pf.vignette.darkness = v; } },
        { group: 'Lighting', key: 'sunIntensity', label: 'Sun Intensity', min: 0, max: 6, step: 0.05, apply: v => { Game._dbgSunBase = v; if (Game.sun) Game.sun.intensity = v; } },
        { group: 'Lighting', key: 'ambientIntensity', label: 'Ambient', min: 0, max: 5, step: 0.05, apply: v => { Game._dbgAmbientBase = v; if (Game.ambient) Game.ambient.intensity = v; } },
        { group: 'Lighting', key: 'cloudShadow', label: 'Cloud Shadows', min: 0, max: 0.5, step: 0.01, apply: v => { Game._dbgCloudBase = v; } },
        { group: 'Shadows', key: 'shadowBlur', label: 'Shadow Blur (trees)', min: 0, max: 14, step: 0.5, apply: v => { if (Game.sun && Game.sun.shadow) { Game.sun.shadow.radius = v; if (Game.renderer) Game.renderer.shadowMap.needsUpdate = true; } } },
        { group: 'Shadows', key: 'shadowStrength', label: 'Shadow Strength', min: 0, max: 1, step: 0.02, apply: v => { if (Game.sun && Game.sun.shadow && Game.sun.shadow.intensity !== undefined) { Game.sun.shadow.intensity = v; if (Game.renderer) Game.renderer.shadowMap.needsUpdate = true; } } },
        { group: 'Effects', key: 'fxDustOpacity', label: 'Dust Opacity', min: 0, max: 1.5, step: 0.05, apply: v => { Game.fxDustOpacity = v; } },
        { group: 'Effects', key: 'fxDustLife', label: 'Dust Lifetime x', min: 0.3, max: 3, step: 0.1, apply: v => { Game.fxDustLife = v; } },
        { group: 'Effects', key: 'fxImpactDust', label: 'Impact Dust x', min: 0, max: 3, step: 0.1, apply: v => { Game.fxImpactDust = v; } },
        { group: 'Effects', key: 'fxShake', label: 'Camera Shake x', min: 0, max: 2, step: 0.05, apply: v => { Game.fxShake = v; } },
        ...(Game._valorControlDefs ? Game._valorControlDefs() : []),
        ...(Game._valorMatControlDefs ? Game._valorMatControlDefs() : []),
        ...(Game._valorDecalControlDefs ? Game._valorDecalControlDefs() : []),
        ...(Game._valorFoliageControlDefs ? Game._valorFoliageControlDefs() : []),
        ...(Game._buildingControlDefs ? Game._buildingControlDefs() : []),
    ];
};

// Serialise the current look (post-processing + lighting) for pasting back.
Game.postfxValuesText = () => {
    const s = Game.postfxState || {};
    const f = (n) => { const t = (+n).toFixed(3).replace(/\.?0+$/, ''); return t === '' || t === '-' ? '0' : t; };
    return [
        'postfx = {',
        `  antialias: ${s.antialias ? 'true' : 'false'},  // SMAA + 4x MSAA`,
        `  upscaleFactor: ${f(s.upscaleFactor)},`,
        `  bloom:          { intensity: ${f(s.bloomIntensity)}, threshold: ${f(s.bloomThreshold)} },`,
        `  tiltShift:      { focusArea: ${f(s.tiltFocusArea)}, feather: ${f(s.tiltFeather)} },`,
        `  hueSaturation:  { hue: ${f(s.hue)}, saturation: ${f(s.saturation)} },`,
        `  brightContrast: { brightness: ${f(s.brightness)}, contrast: ${f(s.contrast)} },`,
        `  vignette:       { offset: ${f(s.vignetteOffset)}, darkness: ${f(s.vignetteDarkness)} },`,
        `  lighting:       { sun: ${f(s.sunIntensity)}, ambient: ${f(s.ambientIntensity)}, cloudShadows: ${f(s.cloudShadow)} },`,
        `  valor:          { enable: ${s.valorEnable ? 'true' : 'false'}, exposure: ${f(s.valorExposure)}, aerial: ${f(s.valorAerial)}, aerialStart: ${f(s.valorAerialStart)}, aerialEnd: ${f(s.valorAerialEnd)}, desat: ${f(s.valorDesat)}, tint: ${f(s.valorTint)}, grain: ${f(s.valorGrain)}, chiaro: ${f(s.valorChiaro)}, sfumato: ${f(s.valorSfumato)}, sfumatoStart: ${f(s.valorSfumatoStart)} },`,
        `  valorMat:       { enable: ${s.valorMatEnable ? 'true' : 'false'}, dirt: ${f(s.valorMatDirt)}, wear: ${f(s.valorMatWear)}, wet: ${f(s.valorMatWet)}, snow: ${f(s.valorMatSnow)} },`,
        `  valorGrade:     { desat: ${f(s.valorGradeDesat)}, temp: ${f(s.valorGradeTemp)}, foliageSat: ${f(s.valorFoliageSat)}, metalDesat: ${f(s.valorMetalDesat)}, skinWarm: ${f(s.valorSkinWarm)} },`,
        `  valorDecals:    { scorch: ${s.valorScorchEnable ? 'true' : 'false'}, opacity: ${f(s.valorScorchOpacity)}, max: ${f(s.valorScorchMax)} },`,
        `  valorFoliage:   { treeBlur: ${f(s.valorTreeBlur)}, hedgeBlur: ${f(s.valorHedgeBlur)} },`,
        '}',
    ].join('\n');
};

// Inject the post-processing section into the debug panel (idempotent).
// Each control gets a slider + a typeable number box (kept in sync).
Game.buildPostFXDebugUI = () => {
    const panel = document.getElementById('debugPanel');
    if (!panel || document.getElementById('dbgPostFXSection')) return;
    const wrap = document.createElement('div');
    wrap.id = 'dbgPostFXSection';
    const title = document.createElement('div');
    title.className = 'dbg-title';
    title.style.marginTop = '8px';
    title.textContent = 'Post-processing';
    wrap.appendChild(title);

    let valuesBox = null;
    let lastGroup = null;
    Game._postfxControlDefs().forEach(def => {
        if (def.group && def.group !== lastGroup) {
            lastGroup = def.group;
            const gh = document.createElement('div');
            gh.textContent = def.group;
            gh.style.cssText = 'color:#7a8a96;font-size:10px;text-transform:uppercase;margin:6px 0 2px;letter-spacing:1px';
            wrap.appendChild(gh);
        }
        const v0 = Game.postfxState[def.key];
        // Boolean controls render as a checkbox.
        if (def.type === 'bool') {
            const blabel = document.createElement('label');
            blabel.style.gap = '4px';
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.checked = !!v0;
            cb.addEventListener('change', () => {
                Game.postfxState[def.key] = cb.checked;
                try { def.apply(cb.checked); } catch (e) { /* ignore */ }
                if (valuesBox) valuesBox.value = Game.postfxValuesText();
            });
            blabel.appendChild(cb);
            blabel.appendChild(document.createTextNode(' ' + def.label));
            wrap.appendChild(blabel);
            return;
        }
        const label = document.createElement('label');
        label.appendChild(document.createTextNode(def.label + ' '));
        const range = document.createElement('input');
        range.type = 'range'; range.min = def.min; range.max = def.max; range.step = def.step; range.value = v0;
        const num = document.createElement('input');
        num.type = 'number'; num.step = def.step; num.value = (+v0);
        num.className = 'dbg-val';
        num.style.cssText = 'width:52px;background:#2a3038;color:#dfe7ef;border:1px solid rgba(80,90,100,0.4);font-size:11px;padding:1px 3px';
        const setVal = (v, from) => {
            if (isNaN(v)) return;
            Game.postfxState[def.key] = v;
            try { def.apply(v); } catch (e) { /* ignore unsupported props */ }
            if (from !== 'range') range.value = v;
            if (from !== 'num') num.value = v;
            if (valuesBox) valuesBox.value = Game.postfxValuesText();
        };
        range.addEventListener('input', () => setVal(parseFloat(range.value), 'range'));
        num.addEventListener('input', () => setVal(parseFloat(num.value), 'num'));
        label.appendChild(range);
        label.appendChild(num);
        wrap.appendChild(label);
    });

    const btn = document.createElement('button');
    btn.textContent = 'Copy values';
    btn.style.cssText = 'margin:6px 0 2px;padding:4px 12px;cursor:pointer;background:#2a3038;color:#dfe7ef;border:1px solid rgba(80,90,100,0.4);font-size:11px';
    valuesBox = document.createElement('textarea');
    valuesBox.readOnly = true;
    valuesBox.style.cssText = 'width:100%;height:150px;background:#10141a;color:#bfeecc;border:1px solid rgba(80,90,100,0.4);font-size:10px;font-family:monospace;margin-top:2px;box-sizing:border-box';
    valuesBox.value = Game.postfxValuesText();
    btn.addEventListener('click', () => {
        valuesBox.value = Game.postfxValuesText();
        valuesBox.select();
        try { navigator.clipboard.writeText(valuesBox.value); } catch (e) { /* clipboard may be blocked */ }
    });
    wrap.appendChild(btn);
    wrap.appendChild(valuesBox);
    panel.appendChild(wrap);
};

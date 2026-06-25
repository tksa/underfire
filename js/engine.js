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
    const ambient = new THREE.AmbientLight(0xb3a684, 1.25);
    Game.scene.add(ambient);
    Game.ambient = ambient;

    const sun = new THREE.DirectionalLight(0xffe6b8, 2.6);
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

    // GLTF loader
    if (Game.GLTFLoader) {
        Game.gltfLoader = new Game.GLTFLoader();
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
    });
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
 * Render one frame.
 */
Game.renderScene = () => {
    Game.renderer.render(Game.scene, Game.camera);
};

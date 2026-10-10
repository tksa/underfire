/** Shared campaign paint and surface response. Source UVs, markings and normal
 * maps stay intact; procedural wear is fixed to each part, never the camera. */
Game.ARMY_PALETTE = {
    french: { paint: 0x626b53, canvas: 0x6b6953 },
    german: { paint: 0x555e58, canvas: 0x666952 },
    polish: { paint: 0x68694c, canvas: 0x706748 },
};
Game._armyTextureLuminance = new WeakMap();
Game._r35NormalRepairs = new WeakMap();
Game.armyTextureLuminance = texture => {
    if (!texture?.image) return 0.18;
    const cached = Game._armyTextureLuminance.get(texture);
    if (cached != null) return cached;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const values = [], color = new Game.THREE.Color();
    try {
        ctx.drawImage(texture.image, 0, 0, 48, 48);
        const pixels = ctx.getImageData(0, 0, 48, 48).data;
        for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] < 128) continue;
            color.setRGB(pixels[i] / 255, pixels[i + 1] / 255, pixels[i + 2] / 255, Game.THREE.SRGBColorSpace);
            const y = color.r * .2126 + color.g * .7152 + color.b * .0722;
            if (y > .018 && y < .7) values.push(y);
        }
    } catch (_) { /* Optional compressed textures retain conservative exposure. */ }
    values.sort((a, b) => a - b);
    // Dark atlas padding / hidden running gear must not set hull exposure.
    const value = values[Math.floor(values.length * .75)] || .18;
    Game._armyTextureLuminance.set(texture, value); return value;
};

Game.armySurfaceKind = material => {
    const name = material.name.toLowerCase();
    if (/number|decal|insignia|lens|glass|sight scale|bore interior/.test(name) || material.transparent) return 'detail';
    if (/rubber|tyre|tire/.test(name)) return 'rubber';
    if (/track|oruga|running|gears/.test(name)) return 'running';
    if (/wood|timber|plank/.test(name)) return 'wood';
    if (/canvas|fabric|seat/.test(name)) return 'canvas';
    if (/steel|fitting|metal|mgun|gunmetal/.test(name)) return 'steel';
    return 'paint';
};

Game.applyArmyMaterials = (unit, model) => {
    const T = Game.THREE, palette = Game.ARMY_PALETTE[unit.team];
    if (!palette || Game.isMowSoldier?.(model) || unit._cavalryCanMount) return;
    model.updateWorldMatrix(true, true);
    model.traverse(node => {
        if (!node.isMesh || node.isSkinnedMesh) return;
        if (unit.team === 'french' && unit.kind === 'r35') {
            // The source turret stores 9,534 corner normals against winding
            // (84 agree). Rebuild normals on an isolated shared geometry; UVs,
            // vertices, indices and authored articulation remain unchanged.
            const original = node.geometry;
            let repaired = Game._r35NormalRepairs.get(original);
            if (!repaired) {
                repaired = original.clone(); repaired.computeVertexNormals();
                repaired.userData.r35NormalRepair = true;
                Game._r35NormalRepairs.set(original, repaired);
            }
            node.geometry = repaired;
        }
        const materials = (Array.isArray(node.material) ? node.material : [node.material]).map(source => {
            if (!source.isMeshStandardMaterial) return source;
            const kind = Game.armySurfaceKind(source), mat = source.clone();
            mat.userData = { ...source.userData, armySurface: kind, armyTeam: unit.team };
            // Cloning preserves side/alpha/UV channel: the R35 repaint used to
            // discard all three, culling its inward-wound roof and smearing one
            // unrelated atlas across nine separately unwrapped materials.
            if (kind === 'detail') return mat;
            const paint = kind === 'paint' || kind === 'canvas';
            const color = new T.Color(kind === 'canvas' ? palette.canvas : palette.paint);
            if (paint) {
                mat.metalness = kind === 'canvas' ? 0 : .08;
                mat.metalnessMap = null; mat.roughness = kind === 'canvas' ? .94 : .84;
            } else {
                mat.roughness = kind === 'rubber' || kind === 'wood' ? .94 : .78;
                mat.metalness = kind === 'rubber' || kind === 'wood' ? 0 : .35;
            }
            const sourceY = mat.map ? Game.armyTextureLuminance(mat.map) : 1;
            if (paint && !mat.map) {
                // Retain distinct camouflage panels without the original bright,
                // linear-color blocks overwhelming the textured vehicles.
                const variation = /ochre/.test(mat.name) ? 1.16 : /brown/.test(mat.name) ? .72 : 1;
                mat.color.copy(color).multiplyScalar(variation);
            }
            if (paint && mat.map) {
                // The old palette replacement erased camouflage and painted
                // weathering. Keep those pixels; correct exposure only, within
                // a narrow band, and retain the source tint/UV/normal maps.
                const targetY = color.r*.2126 + color.g*.7152 + color.b*.0722;
                const gain = Game.clamp(Math.sqrt(targetY / Math.max(sourceY,.04)), .85, 1.15);
                mat.color.multiplyScalar(gain);
            }
            return mat;
        });
        node.material = Array.isArray(node.material) ? materials : materials[0];
    });
};

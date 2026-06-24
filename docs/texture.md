# Under — Texture Roadmap

## Current State

| Surface | Material Type | Textures | PBR Maps |
|---------|--------------|----------|----------|
| **Terrain** | MeshStandardMaterial | `2-texture.jpg` (color only) | ❌ None |
| **Water** | MeshStandardMaterial | `waternormals.jpg` (animated normal) | ✅ Normal only |
| **Buildings** (walls) | MeshStandardMaterial | ❌ Flat color `0x9a8d7a` | ❌ None |
| **Buildings** (roofs) | MeshStandardMaterial | ❌ Flat color `0x6e3f34` | ❌ None |
| **Trees** (trunk) | MeshStandardMaterial | ❌ Flat color `0x5c4033` | ❌ None |
| **Trees** (canopy) | MeshStandardMaterial | ❌ Flat color | ❌ None |
| **Walls/Fences** | MeshStandardMaterial | ❌ Flat color `0x847b72` | ❌ None |
| **Tank hull** | MeshStandardMaterial | ❌ Flat color, flatShading | ❌ None |
| **Tank tracks** | MeshStandardMaterial | ❌ Flat color `0x2a2520` | ❌ None |
| **Infantry body** | MeshStandardMaterial | ❌ Flat color, flatShading | ❌ None |
| **Ground plane** | MeshStandardMaterial | ❌ Flat color `0x161a1e` | ❌ None |

> Everything except terrain and water uses **flat colors with no textures**. This is the single largest realism gap.

### Existing Texture Files
```
textures/
├── 1-depth.png          # Heightmap (map variant)
├── 1-texture.png        # Terrain color (map variant)
├── 2-depth.png          # Heightmap (current map)
├── 2-texture.jpg        # Terrain color (current map, loaded by terrain.js)
├── upscale-texture.jpg  # AI-upscaled terrain color
├── waternormals.jpg     # Water normal map (animated)
└── README.md
maps/map_1/
├── depth.png            # Heightmap
└── texture.png          # Terrain color
```

---

## Phase 1 — Terrain PBR (High Priority, Quick Win)

The terrain is the largest visible surface. Adding normal + roughness maps transforms it instantly.

### Required Textures
| File | Purpose | Source |
|------|---------|--------|
| `terrain_normal.jpg` | Surface relief (furrows, rocks, roots) | Generate or download |
| `terrain_roughness.jpg` | Dry vs wet areas, paths vs grass | Generate or download |
| `terrain_ao.jpg` | Ambient occlusion in crevices | Optional — bake from heightmap |

### Implementation
```diff
// terrain.js — terrainMat
const terrainMat = new THREE.MeshStandardMaterial({
    map: terrainTex,
    roughness: 0.88,
    metalness: 0.02,
    flatShading: false,
+   normalMap: terrainNormalTex,
+   normalScale: new THREE.Vector2(0.8, 0.8),
+   roughnessMap: terrainRoughTex,
});
```

### Free PBR Sources
- [ambientCG](https://ambientcg.com) — CC0, search "Ground", "Soil", "Grass"
- [Poly Haven](https://polyhaven.com/textures) — CC0, ground/terrain category
- [FreePBR](https://freepbr.com) — ground textures with full PBR set

> Download a 2K ground texture set (color + normal + roughness) from ambientCG. The terrain UV already covers the full mesh, so a seamless tiling texture works with `RepeatWrapping`.

---

## Phase 2 — Building & Wall Textures (High Priority)

Buildings are the second most visible element. Stone/brick walls and tile/slate roofs need texture.

### Required Textures
| File | Purpose |
|------|---------|
| `wall_color.jpg` | Stone/brick/plaster wall |
| `wall_normal.jpg` | Brick relief, mortar lines |
| `roof_color.jpg` | Tile/slate roof |
| `roof_normal.jpg` | Tile ridges |

### Implementation
- Load textures once at boot, assign to building materials in `terrain.js` `addBuilding()`
- Use `RepeatWrapping` scaled to building dimensions
- Consider a simple texture atlas (wall + roof on one 1024×512 sheet)

---

## Phase 3 — Vehicle & Unit Textures (Medium Priority)

Tanks and infantry currently use `flatShading: true` with team-colored flat materials.

### Approach Options
1. **Camo patterns via procedural shader** — no texture files needed, generates camo at runtime
2. **Small texture atlas** — 256×256 per unit class (tank, infantry, support)
3. **Color ramp + noise** — shader that adds weathering/dirt to flat colors

> Units are small on screen from top-down view. High-res textures here are wasted GPU memory. A **256×256 camo/weathering overlay** applied procedurally is the sweet spot.

### Recommended: Shader-Based Weathering
```javascript
// Add to tank materials via onBeforeCompile
material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float wear = fract(sin(dot(vUv * 8.0, vec2(12.9,78.2))) * 43758.0);
         diffuseColor.rgb *= mix(0.85, 1.0, wear);`
    );
};
```

---

## Phase 4 — Environment Details (Medium Priority)

### Trees
- Replace flat-color canopy with a **leaf pattern alpha texture** (256×256 PNG with transparency)
- Trunk: simple bark normal map (128×128)
- Both can share a single 512×256 atlas

### Roads & Paths
- Separate road texture with tire tracks, gravel
- Applied to road-type tiles via UV region in terrain atlas

### Craters & Destruction
- Crater decal texture (projected onto terrain after explosions)
- Burnt/scorched earth overlay

---

## Phase 5 — Effects & Atmosphere (Lower Priority)

### Smoke & Explosions
- Current: plain colored meshes
- Improvement: billboard sprites with animated smoke/fire texture atlas
- Use `SpriteMaterial` with a 4×4 animation sheet

### Muzzle Flash
- Small 64×64 flash sprite, additive blending
- One per weapon class (rifle, MG, cannon, mortar)

### Ground Decals
- Blood splatter, tire tracks, shell casings
- Use projected texture technique

---

## Phase 6 — Advanced Techniques (Future)

### Texture LOD System
Swap texture resolution based on camera zoom:
- **Zoomed in** (zoom < 25): 2K textures, full PBR
- **Medium** (zoom 25–50): 1K textures, color + normal only
- **Zoomed out** (zoom > 50): 512px textures, color only

### Texture Atlas for All Materials
Combine all building/wall/road textures into a single 2048×2048 atlas to reduce draw calls.

### Procedural Detail Layer
Noise-based detail mask blended over terrain to break up texture repetition at close zoom.

---

## Performance Budget

| Constraint | Target |
|-----------|--------|
| Max texture memory | < 32 MB |
| Max texture dimensions | 2048×2048 (terrain), 512×512 (objects) |
| Anisotropic filtering | 4x (terrain), 1x (objects) |
| Mipmap generation | Enabled for all |
| Draw call target | < 200 per frame |
| Texture format | JPG for color, PNG for alpha/normal |

> Every 2048×2048 RGBA texture uses ~16 MB of VRAM. Keep object textures small (256–512px). The terrain is the only surface that justifies 2K resolution.

---

## Resource Checklist

### Can Generate Now (AI image generation)
- [x] Terrain color map (already exists)
- [ ] Camo patterns for vehicles
- [ ] Smoke/explosion sprite sheets
- [ ] Ground decals (craters, blood)

### Need to Download (Free PBR Sources)
- [ ] Terrain normal map (ambientCG "Ground037" or similar)
- [ ] Terrain roughness map
- [ ] Stone wall PBR set (color + normal)
- [ ] Roof tile PBR set (color + normal)
- [ ] Bark texture + normal

### Can Generate Procedurally (No Files Needed)
- [ ] Vehicle weathering/dirt via shader noise
- [ ] Terrain detail noise layer
- [ ] Water caustics animation

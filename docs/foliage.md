# Under — Foliage System

## Current State

- **Instanced foliage is DISABLED** — the entire tree system in `terrain.js` (lines 460–641) is commented out
- No trees, shrubs, or forest objects render on the map
- The old system used **one generic tree model** (cylinder trunk + 3 jittered icosahedron canopy layers) for all tile types — no species differentiation
- No 3D model files exist yet (`models/` is empty)
- Trees were placed on `forest`, `dense_forest`, `orchard` tiles + noise-scattered across open terrain

## What Can Be Done Now (Without External Models)

The procedural instanced system **can be re-enabled and improved** using only code — no imported models needed:

1. **Re-enable the existing foliage block** and verify it renders
2. **Differentiate tree silhouettes by species** using procedural geometry variations:
   - **Oak**: wider, flatter canopy (scale X/Z > Y), irregular icosahedron, visible trunk
   - **Pine/Scots Pine**: tall narrow cone (`ConeGeometry`) on a taller trunk, dark green
   - **Beech**: dense round canopy, taller trunk, tight spacing
   - **Birch**: small light canopy, thin white trunk (`color: 0xdadada`), pale green crown
   - **Willow/Alder**: drooping squashed ellipsoid (heavy Y-squash), placed only near water
3. **Add species assignment per biome zone** — tag each tree position with a species ID and use different geometry/color/scale per species
4. **Add shrub instances** — low-profile `BoxGeometry` or squashed spheres for hazel, hawthorn, blackberry along forest edges
5. **Improve placement** — use the biome-aware clustering rules (pine clusters on dry, oak mixed on lowland, beech in dense blocks, riparian near water)

### Limitations Without Models
- All trees will still be **primitive shapes** (spheres, cones, cylinders)
- No branch detail, no leaf geometry, no bark detail
- Acceptable for prototype/gameplay testing but not final art quality

---

## Tree Object Naming Guide

When projecting/creating 3D tree models, use these names. The foliage system will look for them by these exact IDs.

### Canopy Trees

| Object Name | Species | Biome | Visual Notes |
|---|---|---|---|
| `oak` | Pedunculate Oak | Oak mixed woodland | Broad crown, irregular, 8–14 m spacing |
| `beech` | European Beech | Beech forest | Round dense crown, straight trunk, 3–6 m spacing |
| `scots_pine` | Scots Pine | Pine forest | Tall narrow cone crown, reddish bark, 4–8 m spacing |
| `birch` | Silver Birch | Pioneer / transition | Small light crown, white trunk, 3–6 m spacing |
| `hornbeam` | Hornbeam | Oak mixed (secondary) | Oval crown, smaller than oak |
| `maple` | Field Maple | Oak mixed (secondary) | Round crown, medium size |
| `alder` | Common Alder | Riparian | Irregular crown, near water only |
| `willow` | White Willow | Riparian | Drooping crown, near water only |
| `poplar` | Black Poplar | Riparian (secondary) | Tall columnar crown |
| `ash` | European Ash | Riparian (secondary) | Open crown |
| `linden` | Linden / Lime | Oak mixed (rare) | Dense round crown |
| `aspen` | Aspen | Birch transition | Trembling leaf, white-grey trunk |

### Young / Small Trees

| Object Name | Species | Notes |
|---|---|---|
| `young_oak` | Young Oak | Smaller version, edge/gap placement |
| `young_beech` | Young Beech | Interior filler |
| `young_pine` | Young Pine | Smaller cone |
| `young_birch` | Young Birch | Thinner, shorter |
| `young_willow` | Young Willow | Wet edge |

### Shrubs

| Object Name | Type | Notes |
|---|---|---|
| `hazel` | Hazel | Forest edge, oak gaps |
| `hawthorn` | Hawthorn | Edge / hedgerow |
| `blackthorn` | Blackthorn | Edge band |
| `elder` | Elder | Edge / clearing |
| `blackberry` | Blackberry Bramble | Low dense clutter |
| `juniper` | Juniper | Dry pine / heath |

### Ground Cover / Clutter

| Object Name | Type | Notes |
|---|---|---|
| `stump` | Tree stump | Battlefield debris |
| `fallen_log` | Fallen tree trunk | Clutter / cover |
| `reed_patch` | Reeds | Wet areas |
| `fern_patch` | Ferns | Wet / shade areas |

---

## 1940s European Forest Composition Reference

### Core Rule
European forest = **patch mosaic**, not random scatter.
- One area dominated by 1 main species
- Edge zones with transition species
- Shrubs at margins
- Wet species only near water
- Birch at disturbed / pioneer areas
- Beech forms dense blocks
- Pine in large dry-soil stands

### Biome Types

#### 1. Oak Mixed Woodland
- **Terrain**: lowlands, countryside, gentle hills
- **Dominant**: pedunculate oak (35–55%)
- **Secondary**: hornbeam (20–35%), maple, linden
- **Shrubs**: hazel, hawthorn, blackthorn, bramble — high density at edges
- **Spacing**: oak 8–14 m, hornbeam/maple 5–9 m
- **Canopy cover**: 45–68%
- **Feel**: open, uneven, broad crowns, bushes in gaps

#### 2. Dense Beech Forest
- **Terrain**: hills, mature woodland, cooler soils
- **Dominant**: European beech (75–95%)
- **Secondary**: oak/maple on edges only
- **Shrubs**: sparse — leaf litter dominant
- **Spacing**: 3–6 m
- **Canopy cover**: 70–90%
- **Feel**: dense trunk field, dark floor, clean

#### 3. Scots Pine Forest
- **Terrain**: sandy soil, dry flats, heath
- **Dominant**: Scots pine (70–90%)
- **Secondary**: birch (5–20%), oak on richer edge
- **Ground**: moss, heather, juniper
- **Spacing**: pine 4–8 m, birch 5–9 m edge-biased
- **Canopy cover**: 40–65%
- **Feel**: repeated vertical trunks, green in winter

#### 4. Pine-Birch Transition
- **Terrain**: disturbed land, burned/cut zones, field edges
- **Mix**: birch 35–65%, pine 25–55%
- **Spacing**: birch 3–6 m, pine 4–8 m
- **Canopy cover**: 32–58%
- **Feel**: patchy, light, irregular young stands

#### 5. Birch Pioneer Patch
- **Terrain**: abandoned farmland, forest edges, cutover land
- **Dominant**: silver birch (60–90%)
- **Secondary**: pine, aspen, willow in damp
- **Spacing**: 3–6 m
- **Feel**: bright, white trunks, edge character

#### 6. Riparian Alder / Willow
- **Terrain**: stream edges, riverbanks, floodplains — **only near water**
- **Dominant**: alder (30–50%), willow (20–40%)
- **Secondary**: poplar, ash, birch
- **Ground**: reeds, sedges, ferns, wet grass
- **Spacing**: willow/alder 4–8 m, poplar 6–12 m
- **Rule**: willow closest to water, alder slightly back, poplar/ash on drier margin

#### 7. Shrub Edge Zone
- **Terrain**: field-to-forest transitions, road margins, clearings
- **Species**: hazel, hawthorn, blackthorn, elder, bramble, juniper (dry)
- **Spacing**: 1–3 m, clusters of 3–12
- **Edge order**: open field → tall grass → shrub band → young trees → mature canopy

### Country Bias

| Region | Dominant | Notes |
|---|---|---|
| France / Belgium | Oak-hornbeam strong, beech blocks | Riparian willow/alder near rivers |
| Germany | Beech very important, oak-hornbeam common | Pine on sandy soils |
| Poland | Scots pine very common on poor/sandy soils | Pine-birch transitions, oak-hornbeam on richer soils |

### Seasonal Palette

| Season | Oak | Beech | Pine | Birch | Riparian |
|---|---|---|---|---|---|
| Spring | Fresh bright green | Clean light green | Deep green (stable) | Pale green | Saturated green |
| Summer | Deep green | Dark green | Deep green | Light green | Lush green |
| Autumn | Yellow/orange/brown | Copper/rust | Deep green (unchanged) | Bright yellow | Yellow-brown |
| Winter | Bare branches | Bare grey-brown | Deep green (anchor) | White trunks | Mud/reeds exposed |

### Density Classes

| Type | Trees/ha | Spacing | Visibility |
|---|---|---|---|
| Open woodland | 20–40 | 7–14 m | High |
| Mixed forest | 40–80 | 4–10 m | Medium |
| Dense forest | 80–150 | 3–6 m | Low |

### Visual Mistakes to Avoid
- Random equal mix of every species everywhere
- Willow far from water
- Dense shrubs deep inside beech core
- Birch scattered randomly in every biome
- Oak trunks packed as tightly as beech
- Hard forest edge with no shrub band
- Riparian trees on hilltops
- Perfect grid spacing

---

## Species Affinity Rules

```json
{
  "oak":       { "likes": ["hornbeam", "maple", "hazel", "hawthorn"], "dislikes": ["willow", "alder"] },
  "beech":     { "likes": ["beech"], "edge_likes": ["oak", "maple"], "dislikes": ["dense_shrub_core"] },
  "scots_pine":{ "likes": ["scots_pine", "birch", "heather", "moss"], "dislikes": ["wet_scrub", "willow"] },
  "birch":     { "likes": ["birch", "pine", "aspen", "grass"], "edge_likes": ["scrub", "young_oak"] },
  "willow":    { "likes": ["alder", "reeds", "wet_grass"], "requires": ["water_nearby"] },
  "alder":     { "likes": ["willow", "sedge", "wet_scrub"], "requires": ["high_moisture"] }
}
```

---

## Cluster Templates

| Template | Biome | Radius | Dominant Count | Secondary Count |
|---|---|---|---|---|
| `oak_anchor_cluster` | oak_mixed | 12–28 m | 4–12 | 3–10 |
| `oak_hornbeam_cluster` | oak_mixed | 15–32 m | 6–18 | 4–14 |
| `dense_beech_core` | beech | 18–40 m | 14–45 | 2–10 |
| `pine_mass_cluster` | pine | 20–45 m | 18–60 | 2–12 |
| `pine_birch_edge` | pine | 12–26 m | 8–22 | 3–10 |
| `birch_grove` | birch_transition | 10–22 m | 6–18 | 4–12 |
| `bank_willow_strip` | riparian | 8–20 m wide | 6–22 | 8–30 |
| `alder_backline` | riparian | 10–22 m wide | 8–24 | 4–12 |

---

## Country Presets

```json
{
  "preset_polish_lowland": {
    "oak_mixed": 0.22, "beech": 0.08, "pine": 0.35,
    "birch_transition": 0.15, "riparian": 0.08, "open_scrub": 0.12
  },
  "preset_french_lowland": {
    "oak_mixed": 0.34, "beech": 0.18, "pine": 0.14,
    "birch_transition": 0.08, "riparian": 0.08, "open_scrub": 0.14
  },
  "preset_german_mixed": {
    "oak_mixed": 0.28, "beech": 0.24, "pine": 0.16,
    "birch_transition": 0.08, "riparian": 0.08, "open_scrub": 0.12
  }
}
```

---

## Procedural Generation Workflow

1. **Build terrain masks** — moisture, soil_poor, fertility, disturbance, river_distance, edge
2. **Assign biome patches** — riparian near water, pine on dry/poor soil, birch on disturbed, beech on fertile+dense, oak mixed default
3. **Place dominant clusters** — blue-noise cluster centers per biome
4. **Place dominant trees** — poisson scatter from cluster centers
5. **Place secondary trees** — near dominant, respecting affinity rules
6. **Place shrubs** — at edges, gaps, and water margins
7. **Place clutter** — logs, stumps, rocks, leaf litter, reeds
8. **Apply seasonal palette**
9. **Trim gameplay sightlines** — ensure minimum path visibility

---

## Old Architecture Reference

```
4 InstancedMesh = ALL trees:
  trunkMesh  → CylinderGeometry(0.08, 0.14, 1, 5)
  canopyBot  → IcosahedronGeometry(1, 1) jittered, flat bottom
  canopyMid  → IcosahedronGeometry(1, 1) jittered
  canopyTop  → IcosahedronGeometry(1, 1) jittered
```

| Metric | Old System | Instanced |
|---|---|---|
| Draw calls | 2 per tree | 4 total |
| 200 trees | 400 draws | 4 draws |
| Geometries | N copies | 4 shared |

---

## Future Phases

### Phase 2 — Leaf Sway Animation
- Vertex shader `sin(time + phase)` on canopy vertices
- Per-tree phase offset for organic variety

### Phase 3 — External 3D Models
- Replace procedural geometry with projected tree models
- Use naming from the Object Naming table above
- Load via GLTFLoader into instanced mesh system

### Phase 4 — Tree Destruction
- Tank/explosion collision → scale instance to 0
- Spawn stump instance
- Debris particles
- Update collision data

### Phase 5 — Hedges & Bushes
- Low-profile instances providing infantry cover

## References
- [Instanced Forest (Three.js Discourse)](https://discourse.threejs.org/t/procedural-instanced-forest-high-performance-real-trees/88610)
- [EZ-Tree: Fractals to Forests (Codrops)](https://tympanus.net/codrops/2025/01/27/fractals-to-forests-creating-realistic-3d-trees-with-three-js/)

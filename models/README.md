# Tank Models — Pipeline Guide

## Format

**GLB only.** All models should be exported from Blender as `.glb` with embedded materials.

Materials are authored in Blender and preserved at runtime — no runtime material overrides.

## Turret Auto-Detection

When a GLB model is loaded for a vehicle, `_loadUnitModel` automatically:

1. **Scans all child nodes** for turret-related names (case-insensitive):
   - Turret/Head: `turret`, `tower`, `turm`, `tourelle`, `head`
   - Gun/Barrel: `gun`, `barrel`, `cannon`, `kanone`

2. **Merges head + gun into `turretGroup`** if both are siblings:
   - Creates a `THREE.Group` at the head node's position
   - Moves both head and gun into the group as children
   - Each keeps its own original rotation

3. **If gun is already a child of turret** (preferred setup):
   - Uses the turret node directly as the rotation group
   - No merging needed

4. **Wires rotation**: Y axis for yaw (standard Three.js up axis)

## Blender Export Checklist

1. **Name nodes properly** — turret mesh named `turret`, gun parts include `gun` in name
2. **Parent gun to turret** — gun meshes should be children of the turret object
3. **Remove non-mesh objects** — delete cameras, curves, lights before export
4. **Materials** — set up all materials in Blender (they'll be used as-is in game)
5. **Export settings:**
   - Format: GLB
   - Include: Animations (if any)
   - Materials: Export
   - Cameras/Lights: Off

## Adding New Models

1. Model and texture in Blender
2. Set up turret hierarchy (parent gun → turret)
3. Export as `models/{unit_kind}.glb` (e.g., `panzer3.glb`, `s35.glb`)
4. If filename differs from unit kind, add mapping to `modelNameMap` in `units.js`
5. Fallback: all tanks without a specific model use `tiger-E.glb`

## Scale

GLB scale factor: `0.5 * unit.size` (where size 1.0 = standard tank)

## Current Models

| File | Unit | Notes |
|------|------|-------|
| `tiger-E.glb` | All tanks (fallback) | Early grey Dunkelgrau RAL 7021, textured in Blender |

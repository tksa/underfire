# Train Track - Modular Pack attribution

The railway assets in this directory are adapted from [“Train Track - Modular Pack”](https://sketchfab.com/3d-models/train-track-modular-pack-e662a834e5fb4b65ad4f8194f8af515b) by [Digital Goblin](https://sketchfab.com/DigitalGoblin), licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).

Modifications for Under Fire: the five modules were split from the source’s fused mesh; each module was recentered on local X/Z and grounded at local Y=0; the legacy specular-glossiness material was converted to core glTF metallic-roughness; the diffuse and normal maps were externalized and shared. The original specular-glossiness map is not redistributed. No endorsement by the original author is implied.

Derived files:

- `train_track_straight.glb`
- `train_track_curve_01.glb`
- `train_track_curve_02.glb`
- `train_track_curve_03.glb`
- `train_track_curve_04.glb`
- `textures/train_track_diffuse.png`
- `textures/train_track_normal.png`

The original author, source URL, license, source SHA-256, and modification summary are also embedded in each GLB’s `asset.extras` metadata.

The derived files can be reproduced from the original Sketchfab download with:

```bash
node scripts/split-train-track-pack.mjs /path/to/train_track_-_modular_pack.glb models/railway
```

The splitter validates the exact source SHA-256 and mesh layout before writing anything, then verifies every generated GLB.

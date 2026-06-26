"""
Blender refine pass for the model pipeline (see docs/MODEL_PIPELINE.md).

Runs inside Blender (bpy) — driven via the Blender MCP. Takes a raw Meshy .glb and
makes it conform to the game's rules: low-poly, true-metre scale, +Z forward,
grounded at y=0, lights stripped, exported as models/{team}_{kind}.glb. Turret/gun
node naming for wired units is best-effort and should be eyeballed on first run.

Usage (call from the MCP, or `blender --background --python blender_refine.py`):
    refine(
        src="/abs/path/raw.glb",
        out="/abs/path/models/german_panzer4.glb",
        real_size_m=(5.92, 2.88, 2.68),   # L(x) x W(z) x H(y) in metres
        defining="length",                  # 'length' (vehicles) or 'height' (infantry)
        tri_budget=5000,
        forward_yaw_deg=0,                  # rotate about up if it faces the wrong way
        turret_hint=None, gun_hint=None,    # substrings of node names to rename
    )

Note: glTF is Y-up; Blender is Z-up. The importer/exporter convert automatically,
so we work in Blender space (up = +Z) and let export remap to Y-up.
"""
import bpy, math
from mathutils import Vector


def _clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for b in list(block):
            if b.users == 0:
                block.remove(b)


def _all_meshes():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


def _world_bbox():
    mins = Vector((1e9, 1e9, 1e9)); maxs = Vector((-1e9, -1e9, -1e9))
    for o in _all_meshes():
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mins = Vector((min(mins[i], w[i]) for i in range(3)))
            maxs = Vector((max(maxs[i], w[i]) for i in range(3)))
    return mins, maxs


def refine(src, out, real_size_m, defining="length", tri_budget=5000,
           forward_yaw_deg=0, turret_hint=None, gun_hint=None):
    _clear_scene()
    bpy.ops.import_scene.gltf(filepath=src)

    # Strip lights/cameras Meshy sometimes embeds.
    for o in list(bpy.context.scene.objects):
        if o.type in {'LIGHT', 'CAMERA'}:
            bpy.data.objects.remove(o, do_unlink=True)

    meshes = _all_meshes()
    if not meshes:
        raise RuntimeError("no mesh imported from " + src)

    # Optional forward correction (about Z / up).
    if forward_yaw_deg:
        for o in meshes:
            o.rotation_euler[2] += math.radians(forward_yaw_deg)
        bpy.context.view_layer.update()

    # Decimate each mesh down toward the tri budget.
    total_tris = sum(len(m.data.polygons) for m in meshes)
    if total_tris > tri_budget:
        ratio = max(0.02, tri_budget / total_tris)
        for o in meshes:
            md = o.modifiers.new("decimate", 'DECIMATE')
            md.ratio = ratio
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier=md.name)

    # Scale to TRUE METRES by the defining dimension, then ground + centre.
    mins, maxs = _world_bbox()
    dim = maxs - mins  # x=length, y=width(depth), z=height in Blender after import
    # glTF Y-up -> Blender Z-up: height is Z, the two horizontals are X and Y.
    target = real_size_m[2] if defining == "height" else real_size_m[0]
    current = dim[2] if defining == "height" else max(dim[0], dim[1])
    s = (target / current) if current else 1.0
    for o in meshes:
        o.scale = (o.scale[0] * s, o.scale[1] * s, o.scale[2] * s)
    bpy.context.view_layer.update()

    # Recentre on footprint, drop to ground (min Z = 0).
    mins, maxs = _world_bbox()
    cx = (mins[0] + maxs[0]) / 2
    cy = (mins[1] + maxs[1]) / 2
    for o in meshes:
        o.location[0] -= cx
        o.location[1] -= cy
        o.location[2] -= mins[2]
    bpy.context.view_layer.update()

    # Best-effort: tag turret/gun nodes so the game loader can wire them.
    # (Verify on first run — depends on how Meshy named/split the parts.)
    if turret_hint:
        for o in bpy.context.scene.objects:
            if turret_hint.lower() in o.name.lower():
                o.name = "turret"; break
    if gun_hint:
        for o in bpy.context.scene.objects:
            if gun_hint.lower() in o.name.lower():
                o.name = "gun"; break

    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB',
                              use_selection=True, export_yup=True)
    mins, maxs = _world_bbox()
    print("REFINED", out, "size(m)=", [round((maxs[i]-mins[i]), 2) for i in range(3)])

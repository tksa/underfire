"""Convert selected user-supplied MOW vehicles to articulated, Y-up GLBs.

Run with Blender Python; requires the pinned GEM reader documented in
docs/MOW_AS2_REVIEW.md. Source archives and the external reader are not bundled.
"""
import argparse, importlib.util, pathlib, sys, re, struct, math
from dataclasses import replace
from mathutils import Matrix, Vector

spec = importlib.util.spec_from_file_location('infantry_converter', pathlib.Path(__file__).with_name('convert-mow-infantry.py'))
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
parser = argparse.ArgumentParser()
parser.add_argument('--resources', type=pathlib.Path, required=True)
parser.add_argument('--reader', type=pathlib.Path, required=True)
parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path('models'))
parser.add_argument('--only', nargs='*')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
MODELS = {
    'german_pak36': 'cannon/pak36/pak36.mdl',
    'german_sdkfz': 'btr/sdkfz222/sdkfz222.mdl',
    'german_panzer1': 'tank_light/pz1b/pz1b.mdl',
    'german_panzer2': 'tank_light/pz2f/pz2f.mdl',
    'german_panzer4': 'tank_medium/pz4g/pz4g.mdl',
    'german_supply': 'car/blitz3_6/blitz3_6.mdl',
    'german_fuel': 'car/blitz3_6f/blitz3_6f.mdl',
}

class VehicleBuilder(module.Builder):
    def material(self,name):
        index=super().material(name)
        source=self.reader.read_material(self.model_dir/name)
        target=self.doc['materials'][index]
        target['name']=pathlib.Path(name).stem
        target['doubleSided']=target.get('doubleSided',False) or source.two_sided
        if source.blend=='test':
            target.update(alphaMode='MASK',alphaCutoff=source.alpharef/255 if source.alpharef and source.alpharef>1 else source.alpharef or .5)
        elif source.blend in ('blend','alpha'):
            target.update(alphaMode='BLEND')
        return index

for key, relative in MODELS.items():
    if args.only and key not in args.only: continue
    b = VehicleBuilder(module.load_reader(args.reader), args.resources.resolve())
    path = b.resources / 'entity/-vehicle' / relative
    b.source_files.add(path); b.model_dir = path.parent
    b.material_label = key
    b.doc['asset']['generator'] = 'Under Fire rigid MOW converter'
    b.doc['nodes'].append(dict(name='underfire_vehicle', children=[],
                              extras=dict(underfireVehicle=True, forward='+Z', up='+Y', source=relative)))
    axis = Matrix(((0,1,0,0),(0,0,1,0),(1,0,0,0),(0,0,0,1)))
    node_points = {}
    def visit(bone, parent, parent_world, parent_origin):
        world = parent_world @ b.matrix(bone.matrix)
        origin = world.translation
        short_gun = key == 'german_panzer4' and bone.name == 'gun'
        if short_gun: origin.z = parent_origin.z + .30
        idx = len(b.doc['nodes'])
        # Bake rotations/reflections into rigid vertices while retaining each
        # authored pivot and hierarchy. All runtime joints then share Y-up,
        # identity rest rotation: yaw never turns into roll on a mirrored frame.
        node = dict(name='mow_' + bone.name, translation=list(origin-parent_origin), children=[])
        b.doc['nodes'].append(node); b.doc['nodes'][parent]['children'].append(idx)
        if bone.name == 'turret': node['extras'] = dict(vehiclePart='turret')
        elif bone.name == 'gun' or (key == 'german_panzer1' and bone.name == 'gun_rot'):
            node['extras'] = dict(vehiclePart='gun')
        elif bone.name.startswith('steer_'): node['extras'] = dict(vehiclePart='steering')
        views = [g[0] for g in bone.lod_view_groups if g] or bone.mesh_views[:1]
        if short_gun: views = []
        normal_matrix = world.to_3x3().inverted().transposed()
        mirrored = world.to_3x3().determinant() < 0
        primitives = []; all_points = []
        for view in views:
            mesh_path = b.model_dir/view.file_name; b.source_files.add(mesh_path)
            mesh = b.reader.read_mesh(mesh_path)
            # Older trucks include a packed D3DFVF_DIFFUSE DWORD after the
            # normal. The reader's modern layout otherwise interprets white
            # 0xffffffff as a NaN U coordinate and shifts V into the tangent.
            raw = mesh_path.read_bytes()
            fvf = struct.unpack_from('<I', raw, raw.index(b'MESH') + 4)[0]
            if fvf & 0x40:
                offset = raw.index(b'VERT') + 4
                count, stride, flags = struct.unpack_from('<IHH', raw, offset)
                assert count == len(mesh.vertices)
                if mesh.skinned_bones:
                    # Pz I belt: XYZ + one weight/index + normal + color + UV.
                    assert stride == 44 and fvf == 0x1158
                    normal_offset = 20
                else:
                    assert stride in (36,52)
                    normal_offset = 12
                for i, vertex in enumerate(mesh.vertices):
                    start = offset + 8 + i*stride
                    mesh.vertices[i] = replace(vertex,
                        normal=struct.unpack_from('<3f', raw, start + normal_offset),
                        uv=struct.unpack_from('<2f', raw, start + normal_offset + 16))
                assert all(math.isfinite(v) for vertex in mesh.vertices for v in vertex.uv)
            for section in mesh.sections:
                used = sorted({i for tri in section.triangle_indices for i in tri})
                remap = {v:i for i,v in enumerate(used)}
                verts = [mesh.vertices[i] for i in used]
                positions = [world @ (Vector(v.position)/20) - origin for v in verts]
                all_points.extend(positions)
                normals = [(normal_matrix @ Vector(v.normal)).normalized() for v in verts]
                attributes = dict(POSITION=b.accessor(positions,3,target=34962,bounds=True),
                                  NORMAL=b.accessor(normals,3,target=34962),
                                  TEXCOORD_0=b.accessor([v.uv for v in verts],2,target=34962))
                indices = [remap[i] for a,c,d in section.triangle_indices for i in ((a,c,d) if mirrored else (a,d,c))]
                material=b.material(section.material_file)
                if section.two_sided:b.doc['materials'][material]['doubleSided']=True
                primitives.append(dict(attributes=attributes, indices=b.accessor(indices,1,'I',34963),material=material))
        if short_gun:
            # The available hull is Ausf. G. Build an original open-bore short
            # barrel for Under Fire's KwK37; never show a long KwK40/muzzle brake
            # while simulating the early short 75mm. Hull remains an approximation.
            profile=[(-.1,.16),(0,.16),(.12,.12),(.65,.095),(.95,.073),(1,.073),(1,.050),(.86,.050)]
            positions=[]; normals=[]; indices=[]
            for (z0,r0),(z1,r1) in zip(profile,profile[1:]):
                for i in range(32):
                    start=len(positions)
                    for z,r,j in [(z0,r0,i),(z0,r0,i+1),(z1,r1,i+1),(z1,r1,i)]:
                        a=j*math.tau/32
                        positions.append(Vector((math.cos(a)*r,math.sin(a)*r,z)))
                        normals.append(Vector((math.cos(a)*(z1-z0),math.sin(a)*(z1-z0),r0-r1)).normalized())
                    indices.extend([start,start+1,start+2,start,start+2,start+3])
            material=len(b.doc['materials'])
            b.doc['materials'].append(dict(name='original KwK37 short barrel',pbrMetallicRoughness=dict(baseColorFactor=[.19,.22,.20,1],metallicFactor=.6,roughnessFactor=.7)))
            primitives.append(dict(attributes=dict(POSITION=b.accessor(positions,3,target=34962,bounds=True),NORMAL=b.accessor(normals,3,target=34962)),indices=b.accessor(indices,1,'I',34963),material=material))
            all_points=positions
            node.setdefault('extras',{})['adaptation']='Original short KwK37 presentation barrel on MOW Pz IV G hull; not an exact Ausf. D.'
        if primitives:
            node['mesh'] = len(b.doc['meshes']); b.doc['meshes'].append(dict(name=node['name'], primitives=primitives))
            node_points[idx] = all_points
            # Suspension and track assemblies must not spin as complete wheels.
            if re.fullmatch(r'wheel[lr]\d*',bone.name):
                radius = (max(p.y for p in all_points)-min(p.y for p in all_points))/2
                node['extras'] = dict(vehiclePart='wheel', radius=radius)
            elif key == 'german_pak36' and bone.name in ('standl','standr'):
                rear = min(p.z for p in all_points)
                foot = [p for p in all_points if p.z < rear+.025]
                x = sum(p.x for p in foot)/len(foot)
                node['extras'] = dict(vehiclePart='trail', closedYaw=math.atan2(x,-rear))
        if (bone.name == 'gun' or (key == 'german_panzer1' and bone.name in ('shooter00','shooter01'))) and all_points:
            end = max(p.z for p in all_points)
            cap = [p for p in all_points if p.z >= end-.003]
            groups = [cap]
            for number, points in enumerate(groups):
                tip = [(min(p[k] for p in points)+max(p[k] for p in points))/2 for k in range(3)]
                tip[2] = end
                socket = len(b.doc['nodes'])
                b.doc['nodes'].append(dict(name=f'{bone.name}_muzzle_{number}', translation=tip, extras=dict(weaponMuzzle=True)))
                node['children'].append(socket)
        for child in bone.children: visit(child, idx, world, origin)
    visit(b.reader.read_model(path).basis, 0, axis, Vector((0,0,0)))
    args.output.mkdir(parents=True, exist_ok=True)
    b.save(args.output/(key+'.glb'))
    print('CONVERTED',key,len(b.doc['meshes']),'meshes',flush=True)

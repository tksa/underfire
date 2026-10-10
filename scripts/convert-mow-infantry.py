"""Build an animated GLB from locally supplied MOW assets. Run with Blender Python.

Uses an external, pinned GEM format reader; neither the reader nor source game
archives are bundled with this script. See docs/MOW_AS2_REVIEW.md for provenance.
"""
import argparse, importlib.util, sys, pathlib, struct, json, math, hashlib
import bpy
from mathutils import Matrix, Vector


def load_reader(path):
    spec = importlib.util.spec_from_file_location('gem_format_reader', path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class Builder:
    def __init__(self, reader, resources):
        self.reader, self.resources = reader, resources
        self.binary = bytearray()
        self.doc = dict(asset=dict(version='2.0', generator='Under Fire MOW infantry converter'),
                        scene=0, scenes=[dict(nodes=[0])], nodes=[], meshes=[], skins=[],
                        materials=[], textures=[], images=[], samplers=[dict(magFilter=9729,minFilter=9987,wrapS=10497,wrapT=10497)],
                        bufferViews=[], accessors=[], animations=[])
        self.source_files = set()
        self.material_cache = {}
        self.bones, self.local, self.world, self.parents = {}, {}, {}, {}

    def view(self, data, target=None):
        self.binary.extend(b'\0' * (-len(self.binary) % 4))
        view = dict(buffer=0, byteOffset=len(self.binary), byteLength=len(data))
        if target: view['target'] = target
        self.binary.extend(data)
        self.doc['bufferViews'].append(view)
        return len(self.doc['bufferViews']) - 1

    def accessor(self, values, width, kind='f', target=None, bounds=False):
        flat = [x for row in values for x in row] if width > 1 else list(values)
        assert all(math.isfinite(x) for x in flat)
        raw = struct.pack('<' + kind * len(flat), *flat)
        row = dict(bufferView=self.view(raw,target),componentType={'f':5126,'H':5123,'I':5125}[kind],
                   count=len(flat)//width,type={1:'SCALAR',2:'VEC2',3:'VEC3',4:'VEC4',16:'MAT4'}[width])
        if bounds:
            row['min'] = [min(flat[i::width]) for i in range(width)]
            row['max'] = [max(flat[i::width]) for i in range(width)]
        self.doc['accessors'].append(row)
        return len(self.doc['accessors']) - 1

    @staticmethod
    def matrix(rows):
        if rows is None: return Matrix.Identity(4)
        m = Matrix(rows[:3]).transposed().to_4x4()
        m.translation = Vector(rows[3]) / 20
        return m

    @staticmethod
    def trs(m):
        p,q,s = m.decompose()
        return dict(translation=list(p),rotation=[q.x,q.y,q.z,q.w],scale=list(s))

    def skeleton(self, model_path):
        self.source_files.add(model_path)
        self.model_dir = model_path.parent
        self.model = self.reader.read_model(model_path)
        # Source X-forward/Z-up -> engine Z-forward/Y-up. Root handedness is
        # retained as an ordinary node transform and included in inverse binds.
        axis = Matrix(((0,1,0,0),(0,0,1,0),(1,0,0,0),(0,0,0,1)))
        self.doc['nodes'].append(dict(name='mow_infantry',children=[],**self.trs(axis),
                                     extras=dict(underfireRig='mow',forward='+Z',up='+Y')))
        self.world[0] = axis
        def visit(bone,parent):
            idx = len(self.doc['nodes']); m = self.matrix(bone.matrix)
            self.bones[bone.name] = idx; self.local[idx] = m
            self.parents[idx] = parent; self.world[idx] = self.world[parent] @ m
            self.doc['nodes'].append(dict(name=bone.name,children=[],**self.trs(m)))
            self.doc['nodes'][parent]['children'].append(idx)
            for child in bone.children: visit(child,idx)
        visit(self.model.basis,0)

    def texture_path(self, name):
        if not name: return None
        base = self.resources/'texture/common'/name[2:] if name.startswith('$/') else self.model_dir/name
        for suffix in ('','.dds','.tga','.png'):
            p = pathlib.Path(str(base)+suffix)
            if p.is_file(): return p
        raise FileNotFoundError(f'Missing texture {name} at {base}')

    def texture(self,path):
        self.source_files.add(path)
        image = bpy.data.images.load(str(path),check_existing=True)
        image.colorspace_settings.name = 'sRGB'
        _ = image.pixels[0]
        assert image.has_data and image.size[0] > 0
        # Blender transcodes the legacy DDS data to a portable embedded PNG.
        image.file_format='PNG'
        temporary = pathlib.Path(bpy.app.tempdir)/('underfire-'+hashlib.sha256(str(path).encode()).hexdigest()[:12]+'.png')
        image.filepath_raw=str(temporary);image.save()
        raw=temporary.read_bytes();temporary.unlink()
        index=len(self.doc['images'])
        self.doc['images'].append(dict(name=path.stem,mimeType='image/png',bufferView=self.view(raw)))
        self.doc['textures'].append(dict(source=index,sampler=0))
        return len(self.doc['textures'])-1

    def material(self,name):
        key=str(self.model_dir/name)
        if key in self.material_cache: return self.material_cache[key]
        path=self.model_dir/name; self.source_files.add(path)
        mat=self.reader.read_material(path)
        diffuse=self.texture_path(mat.diffuse_texture or mat.simple_texture)
        pbr=dict(baseColorFactor=[1,1,1,1],metallicFactor=0,roughnessFactor=.85)
        if diffuse: pbr['baseColorTexture']=dict(index=self.texture(diffuse))
        index=len(self.doc['materials'])
        self.doc['materials'].append(dict(name=self.material_label,pbrMetallicRoughness=pbr,doubleSided=False))
        self.material_cache[key]=index
        return index

    def mesh(self):
        self.material_label='mow_uniform'
        mesh_path=self.model_dir/'skin.ply';self.source_files.add(mesh_path)
        mesh=self.reader.read_mesh(mesh_path)
        node=self.bones['skin']
        # The subskin palette uses 1-based global bone IDs; zero is the rigid
        # mesh frame. Vertex indices address the section palette, not SKIN.
        joints=[node]+[self.bones[name] for name in mesh.skinned_bones]
        inverse=[self.world[j].inverted() @ self.world[node] for j in joints]
        skin=dict(joints=joints,inverseBindMatrices=self.accessor([[m[r][c] for c in range(4) for r in range(4)] for m in inverse],16),skeleton=self.bones['basis'])
        self.doc['skins'].append(skin)
        primitives=[]
        for section in mesh.sections:
            used=sorted({i for tri in section.triangle_indices for i in tri})
            remap={v:i for i,v in enumerate(used)}
            positions=[];normals=[];uv=[];weights=[];joint_values=[]
            for i in used:
                v=mesh.vertices[i]
                positions.append([x/20 for x in v.position]);normals.append(v.normal);uv.append(v.uv)
                w=list(v.weights);w.append(max(0.,1-sum(w)));w=(w+[0.]*4)[:4]
                total=sum(w);assert total>0
                w=[x/total for x in w]
                ids=[]
                for slot,k in enumerate(v.bone_indices):
                    mapped=section.subskin_bones[k] if section.subskin_bones and w[slot]>0 else k
                    assert 0<=mapped<len(joints),(mapped,len(joints))
                    ids.append(mapped if w[slot]>0 else 0)
                weights.append(w);joint_values.append(ids)
            attributes=dict(POSITION=self.accessor(positions,3,target=34962,bounds=True),NORMAL=self.accessor(normals,3,target=34962),
                            TEXCOORD_0=self.accessor(uv,2,target=34962),JOINTS_0=self.accessor(joint_values,4,'H',34962),WEIGHTS_0=self.accessor(weights,4,target=34962))
            indices=[remap[i] for a,b,c in section.triangle_indices for i in (a,c,b)]
            primitives.append(dict(attributes=attributes,indices=self.accessor(indices,1,'I',34963),material=self.material(section.material_file)))
        self.doc['meshes'].append(dict(name='mow_soldier_skin',primitives=primitives))
        self.doc['nodes'][node].update(mesh=0,skin=0)

    def item(self, path, slot, parent_bone, handle=None):
        """Attach a rigid item by its authored grip, retaining its own hierarchy."""
        self.source_files.add(path);old_dir=self.model_dir;self.model_dir=path.parent
        self.material_label=slot
        model=self.reader.read_model(path)
        local_world={};node_indices={}
        def measure(bone,parent):
            world=parent@self.matrix(bone.matrix);local_world[bone.name]=world
            for child in bone.children:measure(child,world)
        measure(model.basis,Matrix.Identity(4))
        transform=local_world[handle].inverted() @ Matrix.Rotation(math.pi/2,4,'X') if handle else Matrix.Identity(4)
        parent=self.bones[parent_bone];root=len(self.doc['nodes'])
        self.doc['nodes'].append(dict(name=slot,children=[],**self.trs(transform),extras=dict(equipment=slot)))
        self.doc['nodes'][parent]['children'].append(root)
        def visit(bone,parent):
            idx=len(self.doc['nodes']);node_indices[bone.name]=idx
            self.doc['nodes'].append(dict(name=slot+'_'+bone.name,children=[],**self.trs(self.matrix(bone.matrix))))
            self.doc['nodes'][parent]['children'].append(idx)
            views=[g[0] for g in bone.lod_view_groups if g] or bone.mesh_views[:1]
            primitives=[];all_positions=[]
            for view in views:
                mesh_path=self.model_dir/view.file_name;self.source_files.add(mesh_path)
                mesh=self.reader.read_mesh(mesh_path)
                for section in mesh.sections:
                    used=sorted({i for tri in section.triangle_indices for i in tri});remap={v:i for i,v in enumerate(used)}
                    verts=[mesh.vertices[i] for i in used];positions=[[x/20 for x in v.position] for v in verts];all_positions.extend(positions)
                    attributes=dict(POSITION=self.accessor(positions,3,target=34962,bounds=True),NORMAL=self.accessor([v.normal for v in verts],3,target=34962),TEXCOORD_0=self.accessor([v.uv for v in verts],2,target=34962))
                    indices=[remap[i] for a,b,c in section.triangle_indices for i in (a,c,b)]
                    primitives.append(dict(attributes=attributes,indices=self.accessor(indices,1,'I',34963),material=self.material(section.material_file)))
            if primitives:
                self.doc['nodes'][idx]['mesh']=len(self.doc['meshes']);self.doc['meshes'].append(dict(name=slot+'_'+bone.name,primitives=primitives))
                if handle and bone==model.basis:
                    end=max(p[0] for p in all_positions);cap=[p for p in all_positions if p[0]>=end-.003]
                    tip=[sum(p[k] for p in cap)/len(cap) for k in range(3)];tip[0]=end
                    muzzle=len(self.doc['nodes']);q=Vector((0,0,1)).rotation_difference(Vector((1,0,0)))
                    self.doc['nodes'].append(dict(name=slot+'_muzzle',translation=tip,rotation=[q.x,q.y,q.z,q.w],extras=dict(weaponMuzzle=True)))
                    self.doc['nodes'][idx]['children'].append(muzzle)
            for child in bone.children:visit(child,idx)
        visit(model.basis,root);self.model_dir=old_dir
        return node_indices

    def animation(self,name,sources,freeze=None,fps=30,sequence=False,reverse=False):
        animations=[]
        for source in sources:
            path=self.resources/'properties/animation/human'/(source+'.anm');self.source_files.add(path)
            animations.append(self.reader.read_animation(path))
        count=max(len(a.frames) for a in animations)
        # Some upper-body takes omit legs. Use a complete animation rest pose,
        # not the mesh bind pose (whose mirrored thigh frame differs from ANM).
        if not hasattr(self,'animation_rest'):
            self.animation_rest={}
            for source in ('stand_take_gun_down','stand_take_gun_up'):
                path=self.resources/'properties/animation/human'/(source+'.anm');self.source_files.add(path)
                self.animation_rest.update(self.reader.read_animation(path).frames[-1])
        frames=[]
        for i in range(count):
            frame=dict(self.animation_rest)
            for a in animations:
                # Upper/lower takes share phase; never concatenate disjoint takes.
                index=round(i*(len(a.frames)-1)/max(1,count-1))
                frame.update(a.frames[index])
            frames.append(frame)
        if sequence:
            frames=[];frame=dict(self.animation_rest)
            for a in animations:
                for source_frame in a.frames:
                    frame={**frame,**source_frame};frames.append(frame)
            count=len(frames)
        if reverse:frames.reverse()
        if freeze is not None:
            frames=[frames[0 if freeze=='first' else -1]]*2;count=2;fps=2
        times=[i/fps for i in range(count)]
        time_accessor=self.accessor(times,1,bounds=True)
        channels=[];samplers=[]
        # Write every joint on every clip so crossfades cannot retain an old pose.
        for bone,idx in self.bones.items():
            if bone=='skin':continue
            transforms=[]
            for frame in frames:
                state=frame.get(bone)
                transforms.append(self.trs(self.matrix(state.matrix) if state else self.local[idx]))
            for path,width in (('translation',3),('rotation',4),('scale',3)):
                values=[t[path] for t in transforms]
                if name.startswith('death') and bone in ('body','placement') and path=='translation':
                    # Keep the fall close to its simulation position. These
                    # source takes include several metres of staged root travel.
                    values=[[values[0][0]+(v[0]-values[0][0])*.22,
                             values[0][1]+(v[1]-values[0][1])*.22,v[2]] for v in values]
                if path=='rotation':
                    for i in range(1,len(values)):
                        if sum(a*b for a,b in zip(values[i-1],values[i]))<0:values[i]=[-x for x in values[i]]
                sampler=len(samplers);samplers.append(dict(input=time_accessor,output=self.accessor(values,width),interpolation='LINEAR'))
                channels.append(dict(sampler=sampler,target=dict(node=idx,path=path)))
        self.doc['animations'].append(dict(name=name,channels=channels,samplers=samplers,extras=dict(sourceFiles=sources)))

    def original_weapon(self, kind):
        """Original geometry for weapons absent from the recovered inventory."""
        slot=next(n for n in self.doc['nodes'] if n['name']=='equipment_rifle')
        root=len(self.doc['nodes']);self.doc['nodes'].append(dict(name='equipment_'+kind,children=[],
            **{k:slot[k] for k in ('translation','rotation','scale')},extras=dict(equipment='equipment_'+kind,originalUnderFire=True)))
        self.doc['nodes'][self.bones['right_hand']]['children'].append(root)
        basis=len(self.doc['nodes']);self.doc['nodes'].append(dict(name=kind+'_geometry',children=[],
            **self.trs(Matrix.Diagonal((1,-1,1,1)))))
        self.doc['nodes'][root]['children'].append(basis)
        materials=[]
        for label,color,metal in [('wood',[.22,.105,.035,1],0),('steel',[.12,.14,.15,1],.6)]:
            materials.append(len(self.doc['materials']));self.doc['materials'].append(dict(name=kind+'_'+label,
                pbrMetallicRoughness=dict(baseColorFactor=color,metallicFactor=metal,roughnessFactor=.7)))
        primitives=[]
        def save_object(obj,material):
            obj.data.calc_loop_triangles();positions=[];normals=[]
            for tri in obj.data.loop_triangles:
                for i in tri.vertices:
                    positions.append(list(obj.matrix_world@obj.data.vertices[i].co))
                    normals.append(list((obj.matrix_world.to_3x3()@tri.normal).normalized()))
            primitives.append(dict(attributes=dict(POSITION=self.accessor(positions,3,target=34962,bounds=True),
                NORMAL=self.accessor(normals,3,target=34962)),material=materials[material]))
            bpy.data.objects.remove(obj,do_unlink=True)
        def box(loc,size,material=1):
            bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.scale=size
            bpy.context.view_layer.update();save_object(o,material)
        def rod(a,b,r):
            a,b=Vector(a),Vector(b);bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=r,depth=(b-a).length,location=(a+b)*.5)
            o=bpy.context.object;o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();bpy.context.view_layer.update();save_object(o,1)
        end={'fm24':.78,'wz35':1.0,'mas36':.72,'mas38':.4,'ruby':.17,'vis':.20}[kind]
        pistol=kind in ('ruby','vis')
        if pistol:
            box((-.01,-.055,0),(.065,.12,.033),0)
            box((.055,.045,0),(.23 if kind=='vis' else .20,.038,.035))
            rod((.035,.057,0),(end,.057,0),.009)
        else:
            box((-.21,.025,0),(.33,.095,.052),0)
            box((-.055,-.012,0),(.10,.095,.046),0)
            box((.11,.04,0),(.28,.064,.055))
            rod((.23,.057,0),(end,.057,0),.014)
        rod((.05,.082,.025),(.035,.025,.065),.01)
        box((.02,-.035,0),(.065,.038,.032))
        box((end-.03,.08,0),(.02,.065,.01))
        box((.055,.09,0),(.035,.035,.024))
        if kind=='fm24':
            box((.11,.18,0),(.13,.235,.037))
            box((.11,.304,0),(.14,.017,.044))
            box((-.06,-.083,0),(.05,.12,.044),0)
            rod((.23,.019,0),(.65,.019,0),.017)
        elif kind=='mas38':
            rod((.08,.053,0),(.32,.053,0),.026)
            box((.17,-.105,0),(.045,.235,.025))
            box((-.055,-.085,0),(.055,.14,.04),0)
        elif not pistol:
            box((.27,.029,0),(.46,.052,.054),0)
            box((.14,-.017,0),(.1,.045,.04))
        if kind in ('fm24','wz35'):
            for sign in (-1,1):
                rod((end-.12,.04,sign*.025),(end-.04,-.23,sign*.14),.009)
                box((end-.04,-.23,sign*.14),(.055,.014,.025))
        mesh=len(self.doc['meshes']);self.doc['meshes'].append(dict(name=kind,primitives=primitives));self.doc['nodes'][basis]['mesh']=mesh
        q=Vector((0,0,1)).rotation_difference(Vector((1,0,0)));muzzle=len(self.doc['nodes'])
        self.doc['nodes'].append(dict(name='equipment_'+kind+'_muzzle',translation=[end,.057,0],rotation=[q.x,q.y,q.z,q.w],extras=dict(weaponMuzzle=True)))
        self.doc['nodes'][basis]['children'].append(muzzle)

    def save(self,path):
        self.doc['buffers']=[dict(byteLength=len(self.binary))]
        raw=json.dumps(self.doc,separators=(',',':')).encode();raw+=b' '*(-len(raw)%4)
        binary=bytes(self.binary);binary+=b'\0'*(-len(binary)%4)
        output=struct.pack('<III',0x46546c67,2,28+len(raw)+len(binary))+struct.pack('<I4s',len(raw),b'JSON')+raw+struct.pack('<I4s',len(binary),b'BIN\0')+binary
        path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(output)
        manifest=dict(output=path.name,bytes=len(output),animations=[a['name'] for a in self.doc['animations']],
                      sources=[dict(path=str(p.relative_to(self.resources)),sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in sorted(self.source_files)])
        path.with_suffix('.sources.json').write_text(json.dumps(manifest,indent=2)+'\n')
        print(json.dumps({k:v for k,v in manifest.items() if k!='sources'}))


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--resources',type=pathlib.Path,required=True)
    parser.add_argument('--reader',type=pathlib.Path,required=True)
    parser.add_argument('--model',default='entity/humanskin/ger_t1/ger_t1.mdl')
    parser.add_argument('--output',type=pathlib.Path,required=True)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    b=Builder(load_reader(args.reader),args.resources.resolve())
    b.skeleton(b.resources/args.model);b.mesh()
    for key,folder,file in [('rifle','mauzer','mauzer'),('mg34','mg34','mg34'),('smg','mp40','mp40'),('bar','bar','bar'),('luger','luger','luger')]:
        b.item(b.resources/f'entity/inventory/-weapon/{folder}/{file}.mdl','equipment_'+key,'right_hand','handle')
    b.item(b.resources/'entity/inventory/-equipment/head/helmet1_ger/helmet1_ger.mdl','equipment_helmet','head')
    for kind in ('fm24','wz35','mas36','mas38','ruby','vis'):b.original_weapon(kind)
    b.animation('idle',['stand_take_gun_down','stand_take_gun_up'],freeze='last')
    # "up"/"down" are upper/lower body layers. The normal_gun upper take
    # walks while aiming; ordinary travel uses the authored waist-level carry.
    b.animation('walk',['walk_normal_gun_down','walk_gun_up'])
    b.animation('run',['run_down','run_gun_up'])
    b.animation('crawl',['crawl_gun'])
    b.animation('crouch_walk',['run_bow_gun_down','run_bow_gun_up'])
    b.animation('aim_stand',['stand_fire_rifle_down','stand_fire_rifle_up'],freeze='first')
    b.animation('aim_crouch',['squat_fire_rifle'],freeze='first')
    b.animation('crouch',['squat_fire_rifle'],freeze='first')
    b.animation('prone_idle',['lie_fire_gun'],freeze='first')
    b.animation('fire_stand',['stand_fire_rifle_down','stand_fire_rifle_up'])
    b.animation('fire_crouch',['squat_fire_rifle'])
    b.animation('fire_prone',['lie_fire_gun'])
    b.animation('reload_stand',['stand_reload_gun'])
    b.animation('reload_crouch',['squat_reload_gun'])
    b.animation('reload_prone',['lie_reload_gun'])
    b.animation('death',['stand_die_front_1'])
    b.animation('death2',['stand_die_front_2'])
    b.animation('death3',['stand_die_back_1'])
    b.animation('crew_idle',['cannon_pak40_gunlayer'],freeze='first')
    b.animation('crew_load',['cannon_pak40_charger'])
    b.animation('crew_push',['cannon_pak40_pusher_left'])
    b.animation('hmg_idle',['mgun_stan_down'],freeze='first')
    b.animation('hmg_load',['mgun_stan_charger'])
    b.animation('unarmed_idle',['stand_idle_empty_1'])
    b.animation('unarmed_walk',['walk_normal_gun_down','walk_empty_up'])
    b.animation('unarmed_run',['run_down','run_empty_up'])
    b.animation('unarmed_crouch',['squat_from_stand_empty'],freeze='last')
    for stance,source in [('stand','stand'),('crouch','squat'),('prone','lie')]:
        b.animation('throw_'+stance,[source+'_throw_grenade_begin',source+'_throw_grenade_end'],sequence=True)
        b.animation('pistol_reload_'+stance,[source+'_reload_pistol'])
    b.animation('getup_crouch',['lie_from_squat_gun'],reverse=True)
    b.animation('getup_stand',['squat_from_stand_gun','lie_from_squat_gun'],sequence=True,reverse=True)
    b.animation('mortar_idle',['squat_load_mortar'],freeze='first')
    b.animation('mortar_load',['squat_load_mortar'])
    b.animation('treat',['squat_repair_2'])
    b.animation('repair',['squat_repair_1'])
    b.animation('mortar_walk',['walk_normal_gun_down','walk_empty_up'])
    b.animation('pistol_walk',['walk_normal_gun_down','walk_empty_up'])
    b.animation('pistol_run',['run_down','run_empty_up'])
    b.animation('pistol_idle',['stand_holdback_pistol_down','stand_holdback_pistol_up'],freeze='first')
    b.animation('pistol_aim_stand',['stand_fire_pistol_down','stand_fire_pistol_up'],freeze='first')
    b.animation('pistol_aim_crouch',['squat_fire_pistol'],freeze='first')
    b.animation('pistol_prone_idle',['lie_fire_pistol'],freeze='first')
    for name,sources in [('aim_stand',['stand_fire_mgun_down','stand_fire_mgun_up']),('prone_idle',['lie_fire_mgun']),('reload_stand',['stand_reload_mgun']),('reload_prone',['lie_reload_mgun'])]:
        b.animation('mg_'+name,sources,freeze='first' if name in ('aim_stand','prone_idle') else None)
    b.save(args.output)

if __name__=='__main__':main()

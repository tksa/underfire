"""Original mortar presentation assets: 46/50/60/81mm. Run with Blender.

Separate tube, bipod, sight, grips, loading round and ammunition box remain
named for the crew/handling controller. Dimensions are presentation proportions,
not manufacturing drawings. No MOW 120mm geometry is relabelled as a light mortar.
"""
import bpy, math, pathlib
from mathutils import Vector
out = pathlib.Path(__file__).resolve().parents[1]/'models'
def point(p): return Vector((p[0], -p[2], p[1]))
for caliber in (46,50,60,81):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    def mat(name,color,metal=0):
        m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
        s=m.node_tree.nodes.get('Principled BSDF');s.inputs['Base Color'].default_value=(*color,1)
        s.inputs['Roughness'].default_value=.72;s.inputs['Metallic'].default_value=metal
        return m
    paint=mat('mortar field paint',(.18,.22,.14),.25)
    steel=mat('blued machined steel',(.105,.12,.12),.65)
    edge=mat('worn metal edges',(.27,.28,.25),.65)
    black=mat('bore interior',(.008,.011,.009))
    wood=mat('ammunition chest wood',(.25,.17,.085))
    brass=mat('sight scale',(.43,.34,.14),.55)
    def group(name,loc=(0,0,0),parent=None):
        o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.parent=parent;o.location=point(loc);return o
    root=group('mortar_assembly');root['underfireMortar']=True;root['forward']='+Z';root['caliber']=caliber
    def finish(o,name,material,parent):
        o.name=name;o.parent=parent or root;o.data.materials.append(material)
        bevel=o.modifiers.new('rounded machined edges','BEVEL');bevel.width=.0015;bevel.segments=2
        o.modifiers.new('weighted face normals','WEIGHTED_NORMAL');return o
    def box(name,loc,size,material=paint,parent=None):
        bpy.ops.mesh.primitive_cube_add(size=1);o=bpy.context.object;o.location=point(loc);o.scale=(size[0],size[2],size[1])
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        return finish(o,name,material,parent)
    def rod(name,a,b,r,material=steel,parent=None,vertices=16):
        a,b=point(a),point(b)
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=(b-a).length)
        o=bpy.context.object;o.location=(a+b)*.5;o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
        return finish(o,name,material,parent)
    def ring(name,loc,r,thickness,material=steel,parent=None):
        bpy.ops.mesh.primitive_torus_add(major_segments=24,minor_segments=8,major_radius=r,minor_radius=thickness)
        o=bpy.context.object;o.location=point(loc);return finish(o,name,material,parent)
    heavy=caliber==81; brandt=caliber in (60,81)
    length={46:.37,50:.46,60:.63,81:.87}[caliber]
    radius=caliber/1000*.6
    # Rectangular ribbed base plates distinguish Brandt-pattern mortars from
    # the compact 5cm mount and the small Polish grenade launcher.
    width,depth=(.43,.35) if heavy else ((.30,.25) if brandt else (.31,.26))
    box('baseplate',(0,.038,-.19),(width,.034,depth))
    for x in (-width*.44,0,width*.44):
        box('pressed_baseplate_rib',(x,.061,-.19),(.014,.018,depth*.92),edge)
    for z in (-.19-depth*.43,-.19+depth*.43):
        box('baseplate_flange',(0,.057,z),(width,.019,.018))
    for x in (-width*.43,width*.43):
        for z in (-.19-depth*.4,-.19+depth*.4):
            rod('plate_rivet',(x,.05,z),(x,.071,z),.012,edge,vertices=8)
    rod('ball_socket',(0,.04,-.19),(0,.115,-.19),radius*1.5)
    pivot=group('tube_elevation',(0,.115,-.19),root)
    pivot.rotation_euler.x=math.radians(28 if brandt else 30)
    # Mesh the tube as an annulus: the muzzle is genuinely open with an inner
    # wall, rim and dark bore, rather than a solid cylinder end cap.
    verts=[]
    for h,r in [(0,radius*1.08),(length,radius),(length,radius*.77),(length-.13,radius*.77)]:
        verts.extend(tuple(point((math.cos(i*math.tau/32)*r,h,math.sin(i*math.tau/32)*r))) for i in range(32))
    faces=[]
    for band in range(3):
        for i in range(32):
            j=(i+1)%32;faces.append((band*32+i,band*32+j,(band+1)*32+j,(band+1)*32+i))
    me=bpy.data.meshes.new('hollow tube');me.from_pydata(verts,[],faces);me.update()
    o=bpy.data.objects.new('mortar_tube',me);bpy.context.collection.objects.link(o);finish(o,'mortar_tube',steel,pivot)
    rod('dark_bore',(0,length-.131,0),(0,length-.129,0),radius*.77,black,pivot,32)
    ring('reinforced_muzzle_lip',(0,length-.008,0),radius,.005,edge,pivot)
    rod('breech_cap',(0,-.015,0),(0,.05,0),radius*1.2,steel,pivot)
    muzzle=group('tube_end',(0,length,0),pivot);muzzle['mortarSocket']='muzzle'
    group('tube_base',(0,0,0),pivot)
    if brandt:
        ring('bipod_tube_clamp',(0,length*.53,0),radius*1.18,.012,paint,pivot)
        bipod=group('folding_bipod',parent=root)
        joint=(0,.115+length*.53*.88,-.19+length*.53*.47)
        for side in (-1,1):
            foot=(side*(.27 if heavy else .21),.035,.27 if heavy else .19)
            rod('bipod_leg',tuple(joint),(foot[0],foot[1],foot[2]),.019,paint,bipod)
            box('bipod_shoe',foot,(.085,.027,.085),steel,bipod)
            rod('bipod_brace',(side*.04,.19,.15),(foot[0]*.8,.10,foot[2]*.9),.009,edge,bipod)
        rod('elevation_screw',(0,.17,.16),joint,.014,edge,bipod)
        rod('traverse_screw',(-.17,joint[1],joint[2]),(.17,joint[1],joint[2]),.012,edge,bipod)
        # Crank with open spokes, a small folding handle and sight pedestal.
        crank=group('elevation_handwheel',(.15,joint[1],joint[2]),bipod)
        r=ring('handwheel_rim',(0,0,0),.055,.007,steel,crank);r.rotation_euler.y=math.pi/2
        for a in (0,math.pi/2):
            rod('handwheel_spoke',(0,-math.cos(a)*.05,-math.sin(a)*.05),(0,math.cos(a)*.05,math.sin(a)*.05),.005,steel,crank)
        rod('crank_handle',(0,.04,0),(.045,.04,0),.009,steel,crank)
        sight=group('optical_sight',(-.105,length*.52,.025),pivot)
        rod('sight_stem',(0,-.04,0),(0,.065,0),.011,edge,sight)
        box('sight_head',(0,.065,0),(.034,.038,.08),steel,sight)
        rod('sight_eyepiece',(0,.063,-.043),(0,.063,-.066),.016,black,sight)
        box('range_scale',(0,.014,-.017),(.052,.027,.009),brass,sight)
    else:
        # Light 46/50mm weapons use compact integral support and hand controls,
        # not a scaled-down tall Brandt bipod.
        bipod=group('folding_bipod',parent=root)
        for side in (-1,1):
            rod('short_mount_arm',(side*.12,.06,-.2),(side*.085,.24,-.11),.02,paint,bipod)
        rod('mount_trunnion',(-.11,.24,-.11),(.11,.24,-.11),.028,steel,bipod)
        box('range_regulator',(.095,.13,-.15),(.10,.07,.075),paint,bipod)
        dial=ring('range_dial',(.15,.17,-.15),.039,.008,steel,bipod);dial.rotation_euler.y=math.pi/2
        box('sighting_scale',(-.08,.24,-.13),(.04,.065,.017),brass,bipod)
        if caliber==46:
            rod('gas_regulator_tube',(.075,.07,-.19),(.075,.22,-.04),.019,steel)
            rod('trigger_grip',(-.10,.14,-.24),(-.1,.23,-.24),.016,steel)
        else:
            rod('elevation_adjuster',(.09,.08,-.29),(.09,.22,-.17),.012,edge)
    for side in (-1,1):
        for z in (-.08,.09):
            rod('carry_handle_mount',(side*.11,.25,z-.15),(side*.18,.25,z-.15),.01)
        rod('carry_handle',(side*.18,.25,-.23),(side*.18,.25,-.06),.013)
        group('carry_grip_'+('left' if side<0 else 'right'),(side*.18,.25,-.15),root)
    chest=group('ammunition_box',(.52,.08,-.28),root)
    box('wooden_chest',(0,0,0),(.25,.14,.30),wood,chest)
    box('chest_lid',(0,.076,0),(.26,.013,.31),wood,chest)
    for x in (-.085,.085):
        box('steel_chest_band',(x,.085,0),(.014,.007,.31),steel,chest)
        box('steel_chest_band',(x,0,.153),(.014,.145,.007),steel,chest)
    rod('chest_handle',(-.045,.115,0),(.045,.115,0),.009,steel,chest)
    shell=group('loading_round',parent=pivot)
    rod('bomb_body',(0,-.09,0),(0,.06,0),radius*.72,paint,shell)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=1)
    o=bpy.context.object;o.location=point((0,.06,0));o.scale=(radius*.72,radius*.72,.045)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);finish(o,'bomb_ogive',paint,shell)
    rod('impact_fuze',(0,.083,0),(0,.10,0),radius*.23,brass,shell)
    rod('tail_stem',(0,-.09,0),(0,-.16,0),radius*.23,steel,shell)
    for i in range(4):
        o=box('bomb_tail_fin',(0,-.137,0),(radius*1.4,.035,.004),steel,shell);o.rotation_euler.z=i*math.pi/4
    # Runtime initially hides the round and drives a visible loading cycle.
    shell['mortarRound']=True
    bpy.ops.export_scene.gltf(filepath=str(out/f'mortar{caliber}.glb'),export_format='GLB',export_animations=False,export_apply=True,export_extras=True)

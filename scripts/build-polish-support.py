"""Original wz.34, Fiat 621L and 37mm Bofors presentation models, Blender Python.

Reference/proportion notes are in docs/MODEL_COVERAGE.md. Authored geometry,
not extracted MOW models. Separate wheels, steering, guns and trails carry
the same explicit runtime part tags as imported rigid vehicles.
"""
import bpy, math, pathlib
from mathutils import Vector
out=pathlib.Path(__file__).resolve().parents[1]/'models'
def p(v):return Vector((v[0],-v[2],v[1]))
for kind in ('wz34','supply','transport','bofors37'):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    def mat(name,col,metal=0,rough=.75):
        m=bpy.data.materials.new(name);m.diffuse_color=(*col,1);m.use_nodes=True
        s=m.node_tree.nodes.get('Principled BSDF');s.inputs['Base Color'].default_value=(*col,1)
        s.inputs['Metallic'].default_value=metal;s.inputs['Roughness'].default_value=rough;return m
    green=mat('Polish field khaki',(.25,.285,.16),.3)
    sand=mat('ochre camouflage',(.46,.38,.22),.2)
    brown=mat('brown camouflage',(.24,.16,.09),.2)
    steel=mat('blued steel',(.12,.14,.13),.6)
    edge=mat('worn fittings',(.27,.29,.25),.65)
    rubber=mat('rubber',(.038,.043,.035),0,.95)
    glass=mat('smoky window glass',(.115,.17,.18),.2,.22)
    wood=mat('wooden cargo deck',(.28,.24,.14))
    canvas=mat('canvas cover',(.34,.35,.24),0,.94)
    lamp=mat('headlamp lens',(.63,.64,.53),.35,.23)
    def group(name,loc=(0,0,0),parent=None,part=None):
        o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.location=p(loc);o.parent=parent
        if part:o['vehiclePart']=part
        return o
    root=group('underfire_vehicle');root['underfireVehicle']=True;root['forward']='+Z';root['up']='+Y'
    root['source']='Original Under Fire '+kind+' presentation geometry'
    def finish(o,name,material,parent=None,bevel=.006):
        o.name=name;o.parent=parent or root;o.data.materials.append(material)
        if bevel:
            b=o.modifiers.new('machined edges','BEVEL');b.width=bevel;b.segments=2
            o.modifiers.new('weighted normals','WEIGHTED_NORMAL')
        return o
    def box(name,loc,size,material=green,parent=None,bevel=.006):
        bpy.ops.mesh.primitive_cube_add(size=1);o=bpy.context.object;o.location=p(loc);o.scale=(size[0],size[2],size[1])
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return finish(o,name,material,parent,bevel)
    def rod(name,a,b,r,material=steel,parent=None,n=16):
        a,b=p(a),p(b);bpy.ops.mesh.primitive_cylinder_add(vertices=n,radius=r,depth=(b-a).length)
        o=bpy.context.object;o.location=(a+b)*.5;o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
        return finish(o,name,material,parent,.002)
    def mesh(name,verts,faces,material=green,parent=None):
        g=bpy.data.meshes.new(name);g.from_pydata([tuple(p(v)) for v in verts],[],faces);g.update()
        o=bpy.data.objects.new(name,g);bpy.context.collection.objects.link(o);return finish(o,name,material,parent,.003)
    def hull(name,lo,hi,y0,y1,z0,z1,material=green,parent=None):
        # Tapered riveted plate hull, outward normals with +Z forward.
        v=[(-lo,y0,z0),(lo,y0,z0),(lo,y0,z1),(-lo,y0,z1),(-hi,y1,z0),(hi,y1,z0),(hi,y1,z1),(-hi,y1,z1)]
        return mesh(name,v,[(0,3,2,1),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)],material,parent)
    def wheel(name,x,y,z,r=.34,width=.12,front=False,parent=None):
        steer=group(name+'_steering',(x,y,z),parent or root,'steering' if front else None)
        hub=group(name,parent=steer,part='wheel');hub['radius']=r
        # Broad tyre with beveled shoulders, rim and raised tread blocks.
        dual=width>.17
        for offset in (-width*.28,width*.28) if dual else (0,):
            half=width*.22 if dual else width/2
            rod('tyre',(offset-half,0,0),(offset+half,0,0),r,rubber,hub,32)
        for side in (-1,1):
            rod('pressed_steel_rim',(side*(width/2+.002),0,0),(side*(width/2+.012),0,0),r*.64,green,hub,24)
            rod('hub_cap',(side*(width/2+.012),0,0),(side*(width/2+.04),0,0),r*.22,edge,hub,16)
            for i in range(6):
                a=i*math.tau/6
                rod('wheel_lug',(side*(width/2+.014),math.cos(a)*r*.38,math.sin(a)*r*.38),(side*(width/2+.023),math.cos(a)*r*.38,math.sin(a)*r*.38),.012,steel,hub,8)
        for i in range(28):
            a=i*math.tau/28
            for offset in (-width*.28,width*.28) if dual else (0,):
                o=box('tyre_tread',(offset,math.cos(a)*r,math.sin(a)*r),(width*(.41 if dual else .96),.021,.035),rubber,hub,.001)
                o.rotation_euler.x=a
        return hub
    def fender(x,y,z,r,width):
        verts=[]
        for i in range(21):
            a=-.22+i*(math.pi+.44)/20
            verts.extend([(x-width/2,y+math.sin(a)*r,z+math.cos(a)*r),(x+width/2,y+math.sin(a)*r,z+math.cos(a)*r)])
        o=mesh('curved_mudguard',verts,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(20)])
        solid=o.modifiers.new('pressed sheet thickness','SOLIDIFY');solid.thickness=.014
    def socket(parent,loc):
        o=group('weapon_muzzle',loc,parent);o['weaponMuzzle']=True;return o
    def rivets(x,y,z0,z1,n=9,parent=None):
        for i in range(n):
            z=z0+(z1-z0)*i/max(1,n-1)
            rod('armor_rivet',(x,y,z),(x+(.005 if x>0 else -.005),y,z),.008,edge,parent,8)
    def hollow_barrel(parent,a,b,r0,r1):
        # Axis-aligned +Z barrel with an open bore and muzzle rim.
        verts=[];faces=[]
        for z,r in [(a[2],r0),(b[2],r1),(b[2],r1*.64),(b[2]-.12,r1*.64)]:
            verts.extend((a[0]+math.cos(i*math.tau/24)*r,a[1]+math.sin(i*math.tau/24)*r,z) for i in range(24))
        for band in range(3):
            for i in range(24):
                j=(i+1)%24;faces.append((band*24+i,band*24+j,(band+1)*24+j,(band+1)*24+i))
        mesh('open_barrel',verts,faces,steel,parent)
        rod('dark_bore',(a[0],a[1],b[2]-.121),(a[0],a[1],b[2]-.119),r1*.64,rubber,parent,24)
        socket(parent,b)
    if kind=='bofors37':
        for side in (-1,1):wheel('wheel_'+str(side),side*.52,.33,0,.33,.13)
        rod('axle',(-.53,.33,0),(.53,.33,0),.055)
        box('axle_saddle',(0,.38,0),(.52,.14,.37))
        # Stepped shield with the central barrel notch and raised outer wings.
        outline=[(-.47,.29),(-.47,.72),(-.37,.85),(-.085,.85),(-.085,.61),(.085,.61),(.085,.85),(.37,.85),(.47,.72),(.47,.29)]
        v=[(x,y,.15+(y-.29)*.09) for x,y in outline]+[(x,y,.175+(y-.29)*.09) for x,y in outline]
        faces=[tuple(range(9,-1,-1)),tuple(range(10,20))]+[(i,(i+1)%10,(i+1)%10+10,i+10) for i in range(10)]
        mesh('notched_gun_shield',v,faces)
        for x in (-.42,-.25,.25,.42):
            for y in (.35,.52,.70):rod('shield_rivet',(x,y,.166+(y-.29)*.09),(x,y,.19+(y-.29)*.09),.008,edge,n=8)
        rod('trunnion',(-.23,.58,-.03),(.23,.58,-.03),.055)
        box('recoil_cradle',(0,.53,.16),(.18,.085,.65))
        gun=group('bofors_gun',(0,.61,0),root,'gun')
        box('sliding_breech',(0,0,-.20),(.15,.14,.26),steel,gun)
        rod('breech_handle',(.08,0,-.25),(.17,0,-.25),.012,edge,gun)
        hollow_barrel(gun,(0,0,-.06),(0,0,1.4),.052,.029)
        rod('recoil_cylinder',(0,.48,-.28),(0,.48,.57),.045,edge)
        for side in (-1,1):
            trail=group('split_trail_'+str(side),(side*.17,.24,-.15),root,'trail');trail['closedYaw']=side*math.atan2(.36,1.23)
            rod('trail_tube',(0,0,0),(side*.36,-.13,-1.23),.035,green,trail)
            box('ground_spade',(side*.36,-.18,-1.24),(.27,.09,.14),steel,trail)
            rod('trail_handle',(side*.36,-.05,-1.15),(side*.48,-.05,-1.15),.012,steel,trail)
            rod('elevation_wheel_axle',(side*.16,.48,-.23),(side*.28,.48,-.23),.012)
            bpy.ops.mesh.primitive_torus_add(major_segments=20,minor_segments=6,major_radius=.06,minor_radius=.007)
            o=bpy.context.object;o.location=p((side*.29,.48,-.23));o.rotation_euler.y=math.pi/2;finish(o,'elevation_handwheel',steel)
        rod('optical_sight',(-.13,.69,-.19),(-.13,.69,-.34),.021)
        box('gunner_seat',(-.29,.30,-.48),(.17,.035,.17),brown)
    else:
        truck=kind!='wz34'; L=3.4 if truck else 2.35; W=1.25 if truck else 1.1
        front=1.06 if truck else .75; rear=-1.10 if truck else -.72;r=.30 if truck else .26
        for side in (-1,1):
            wheel('front_'+str(side),side*W*.52,r,front,r,.115,True)
            wheel('rear_'+str(side),side*W*.52,r,rear,r,.19)
            box('frame_rail',(side*.32,.34,-.12),(.065,.105,L-.15),steel)
            rod('leaf_spring',(side*.36,.28,rear-.25),(side*.36,.28,rear+.25),.019,steel)
            rod('leaf_spring',(side*.36,.28,front-.20),(side*.36,.28,front+.20),.019,steel)
        for z in (front,rear):rod('live_axle',(-W*.53,r,z),(W*.53,r,z),.043)
        rod('propeller_shaft',(0,r,-1.05),(0,r,.8),.027)
        box('front_bumper',(0,.39,L/2), (W+.07,.075,.08),edge)
        rod('rear_towing_eye',(0,.32,-L/2-.07),(0,.32,-L/2),.06,steel)
        if truck:
            hull('engine_bonnet',.37,.31,.51,1.02,.74,1.59)
            box('radiator',(0,.78,1.60),(.57,.53,.04),steel)
            for i in range(13):box('radiator_slats',(-.25+i*.042,.78,1.625),(.012,.47,.012),edge)
            rod('radiator_cap',(0,1.04,1.52),(0,1.075,1.52),.029,edge)
            box('cab_floor',(0,.60,.41),(1.03,.085,.78))
            box('cab_rear',(0,1.06,.035),(1.04,.91,.055))
            box('cab_roof',(0,1.51,.40),(1.13,.045,.83))
            box('cab_front_lower',(0,.82,.81),(1.03,.41,.045))
            for side in (-1,1):
                box('cab_door',(side*.515,.86,.41),(.04,.50,.74))
                box('side_window',(side*.516,1.25,.41),(.018,.30,.64),glass)
                for z in (.065,.755):box('door_window_frame',(side*.522,1.25,z),(.045,.42,.033))
                box('door_top_frame',(side*.522,1.435,.41),(.045,.03,.74))
                rod('door_handle',(side*.55,1.02,.18),(side*.55,1.02,.29),.01,edge)
                box('cab_step',(side*.67,.41,.33),(.27,.035,.65),steel)
                for j in range(8):box('bonnet_vent',(side*.355,.86,.91+j*.074),(.018,.16,.018),steel)
                rod('headlight_housing',(side*.53,.85,1.28),(side*.53,.85,1.40),.067)
                rod('headlight_lens',(side*.53,.85,1.402),(side*.53,.85,1.413),.055,lamp)
                fender(side*.63,.30,1.06,.36,.29)
                fender(side*.64,.30,-1.10,.36,.30)
            for side in (-1,1):box('split_windscreen',(side*.248,1.26,.799),(.465,.33,.021),glass)
            box('windshield_center_bar',(0,1.26,.817),(.029,.38,.035))
            box('windshield_top',(0,1.448,.811),(1.04,.034,.035))
            for side in (-1,1):rod('windscreen_wiper',(side*.25,1.4,.83),(side*.15,1.17,.83),.006,steel)
            # Slatted deck and drop sides, with individual planks and latches.
            box('cargo_bed',(0,.63,-.89),(1.23,.07,1.71),wood)
            for z in (-1.67,-1.25,-.80,-.15):
                for side in (-1,1):box('bed_upright',(side*.615,.91,z),(.035,.53,.045),edge)
            for h in (.74,.88,1.02):
                for side in (-1,1):box('drop_side_plank',(side*.60,h,-.91),(.033,.125,1.7),wood)
                box('tailgate_plank',(0,h,-1.75),(1.20,.125,.033),wood)
            for x in (-.48,.48):box('tailgate_hinge',(x,.68,-1.777),(.09,.05,.018),edge)
            if kind=='supply':
                for z in (-1.43,-.80,-.27):
                    for x in (-.3,.3):
                        box('supply_crate',(x,.85,z),(.49,.33,.46),wood)
                        for off in (-.16,.16):box('crate_strap',(x+off,1.021,z),(.024,.011,.47),steel)
                # Canvas roof with arched ribs, open at the rear.
                v=[]
                for z in (-1.74,-.06):
                    for i in range(13):
                        a=i*math.pi/12;v.append((math.cos(a)*.63,1.14+math.sin(a)*.39,z))
                mesh('canvas_hood',v,[(i,i+1,i+14,i+13) for i in range(12)],canvas)
                canvas.use_nodes=True;canvas.surface_render_method='DITHERED'
                for z in (-1.72,-.90,-.08):
                    for i in range(12):
                        a=i*math.pi/12;b=(i+1)*math.pi/12
                        rod('hood_rib',(math.cos(a)*.62,1.13+math.sin(a)*.385,z),(math.cos(b)*.62,1.13+math.sin(b)*.385,z),.008,edge)
            else:
                for side in (-1,1):
                    box('troop_bench',(side*.42,.85,-.9),(.26,.045,1.48),wood)
                    for z in (-1.42,-.41):box('bench_leg',(side*.42,.74,z),(.04,.20,.05),steel)
        else:
            # Compact faceted fighting compartment, narrow armored bonnet,
            # exposed running gear and riveted polygonal MG turret.
            hull('fighting_compartment',.48,.38,.41,1.20,-1.03,.28)
            hull('armored_bonnet',.32,.25,.50,.84,.25,1.14)
            box('sloping_driver_plate',(0,1.00,.29),(.74,.34,.027))
            box('driver_visor',(0,1.10,.31),(.29,.075,.04),steel)
            box('visor_slit',(0,1.10,.334),(.21,.018,.008),rubber)
            for side in (-1,1):
                box('side_access_door',(side*.44,.81,-.53),(.025,.61,.48),green)
                rivets(side*.451,.55,-.75,-.29,7);rivets(side*.405,1.08,-.95,.20,12)
                rod('door_hinge',(side*.46,.61,-.77),(side*.46,.95,-.77),.016,edge)
                fender(side*.59,.26,.75,.32,.28)
                fender(side*.59,.26,-.72,.32,.31)
                rod('lamp_housing',(side*.33,.73,1.15),(side*.33,.73,1.23),.05)
                rod('lamp_lens',(side*.33,.73,1.232),(side*.33,.73,1.24),.04,lamp)
            for i in range(9):box('radiator_armor_louver',(-.2+i*.05,.65,1.16),(.024,.23,.035),steel)
            turret=group('wz34_turret',(0,1.20,-.36),root,'turret')
            rod('turret_ring',(0,-.02,0),(0,.025,0),.29,steel,turret,24)
            bpy.ops.mesh.primitive_cone_add(vertices=8,radius1=.33,radius2=.255,depth=.36)
            o=bpy.context.object;o.location=p((0,.20,0));finish(o,'octagonal_turret',green,turret)
            box('turret_hatch',(0,.39,-.03),(.30,.023,.25),sand,turret)
            rod('hatch_handle',(-.04,.423,-.03),(.04,.423,-.03),.01,steel,turret)
            gun=group('wz34_machine_gun',(0,.19,.30),turret,'gun')
            rod('armored_ball_mount',(0,0,-.04),(0,0,.07),.09,steel,gun)
            hollow_barrel(gun,(0,0,.02),(0,0,.49),.024,.016)
            for i in range(5):rod('hotchkiss_cooling_fin',(0,0,.08+i*.045),(0,0,.095+i*.045),.04,edge,gun)
    # Palette bands on body panels give originals a restrained period finish;
    # all running gear and fittings retain their distinct materials.
    if kind=='wz34':
        for o in list(bpy.data.objects):
            if o.type=='MESH' and o.name.startswith(('fighting_compartment','armored_bonnet','octagonal_turret')):
                o.data.materials.append(sand);o.data.materials.append(brown)
                for poly in o.data.polygons:
                    if poly.index%4==1:poly.material_index=1
                    elif poly.index%5==2:poly.material_index=2
    # Batch static details by parent/material. Wheel treads, rivets and planks
    # retain their shape without becoming hundreds of draw calls per vehicle.
    meshes=[o for o in bpy.data.objects if o.type=='MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:o.select_set(True)
    bpy.context.view_layer.objects.active=meshes[0]
    bpy.ops.object.convert(target='MESH')
    batches={}
    for o in list(bpy.data.objects):
        if o.type=='MESH':batches.setdefault((o.parent,tuple(o.data.materials)),[]).append(o)
    for objects in batches.values():
        if len(objects)<2:continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:o.select_set(True)
        bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join()
    bpy.ops.export_scene.gltf(filepath=str(out/f'polish_{kind}.glb'),export_format='GLB',export_animations=False,export_apply=True,export_extras=True)

"""Original Hotchkiss M1914 and wz.30 presentation models. Blender Python."""
import bpy, math, pathlib
from mathutils import Vector
out=pathlib.Path(__file__).resolve().parents[1]/'models'
def point(p): return Vector((p[0],-p[2],p[1]))
for nation in ('french','polish'):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    def material(name,color,metal=0):
        m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
        shader=m.node_tree.nodes.get('Principled BSDF');shader.inputs['Base Color'].default_value=(*color,1)
        shader.inputs['Roughness'].default_value=.65;shader.inputs['Metallic'].default_value=metal;return m
    steel=material('worn blued steel',(.16,.17,.15),.65)
    paint=material('field paint',(.24,.27,.19),.25)
    wood=material('walnut grips',(.22,.11,.045))
    brass=material('cartridge brass',(.52,.34,.11),.6)
    belt=material('canvas belt',(.39,.34,.23))
    def finish(obj,name,mat):
        obj.name=name;obj.data.materials.append(mat)
        if obj.type=='MESH':
            bevel=obj.modifiers.new('machined edges','BEVEL');bevel.width=.002;bevel.segments=2
            normal=obj.modifiers.new('weighted normals','WEIGHTED_NORMAL')
        return obj
    def box(name,loc,size,mat):
        bpy.ops.mesh.primitive_cube_add(size=1,location=point(loc));o=bpy.context.object;o.scale=(size[0],size[2],size[1])
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return finish(o,name,mat)
    def rod(name,a,b,r,mat,vertices=12):
        a,b=point(a),point(b);bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=(b-a).length,location=(a+b)*.5)
        o=bpy.context.object;o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return finish(o,name,mat)
    # Stable low tripod, feet, elevation wheel, cradle and rear traverse screw.
    apex=(0,.51,-.08)
    for i,p in enumerate([(-.32,.035,-.52),(.32,.035,-.52),(0,.035,.35)]):
        rod('tripod_leg_'+str(i),apex,p,.024,paint)
        box('foot_'+str(i),p,(.095,.023,.13),steel)
        rod('tripod_brace_'+str(i),(0,.23,-.1),tuple((p[k]+apex[k])*.5 for k in range(3)),.012,steel)
    rod('pintle',(0,.43,-.08),(0,.65,-.08),.038,steel)
    rod('traverse_screw',(-.14,.55,-.29),(.14,.55,-.29),.015,steel)
    rod('elevation_wheel',(.115,.51,-.22),(.14,.51,-.22),.07,steel,20)
    box('receiver',(0,.7,-.13),(.12,.14,.42),paint)
    box('feed_cover',(0,.775,-.13),(.135,.018,.26),steel)
    rod('charging_handle',(.06,.72,-.2),(.14,.72,-.2),.013,steel)
    if nation=='french':
        for i in range(5):rod('cooling_fin_'+str(i),(0,.72,.13+i*.05),(0,.72,.151+i*.05),.065,steel,20)
        barrel=rod('gun_barrel',(0,.72,.1),(0,.72,.92),.024,steel,16)
        rod('gas_tube',(0,.66,.07),(0,.66,.58),.017,steel)
        box('feed_strip',(-.2,.73,.0),(.32,.012,.07),brass)
        for i in range(12):rod('strip_round_'+str(i),(-.35+i*.026,.74,-.025),(-.35+i*.026,.74,.035),.008,brass,6)
    else:
        # Water jacket and condensing hose distinguish wz.30 from an air-cooled MG.
        rod('water_jacket',(0,.72,.08),(0,.72,.65),.067,paint,24)
        rod('front_jacket_cap',(0,.72,.635),(0,.72,.66),.072,steel,20)
        barrel=rod('gun_barrel',(0,.72,.64),(0,.72,.86),.022,steel,16)
        rod('filler_cap',(0,.77,.14),(0,.82,.14),.025,steel)
        rod('hose',(.05,.68,.12),(.2,.05,.09),.012,steel)
        box('water_can',(.29,.13,.09),(.16,.23,.18),paint)
        for i in range(12):
            x=-.08-i*.024;y=.72-.22*(i/11)**2
            box('belt_link_'+str(i),(x,y,0),(.023,.014,.075),belt)
            rod('belt_round_'+str(i),(x,y+.014,-.02),(x,y+.014,.04),.009,brass,6)
    for sign in (-1,1):
        rod('spade_grip_'+str(sign),(sign*.085,.63,-.385),(sign*.085,.79,-.385),.021,wood)
        rod('grip_mount_'+str(sign),(0,.73,-.32),(sign*.085,.73,-.385),.017,steel)
    box('rear_sight',(0,.80,-.24),(.04,.055,.016),steel)
    box('front_sight',(0,.78,.81 if nation=='french' else .78),(.017,.065,.025),steel)
    box('ammo_box',(-.42,.12,-.13),(.21,.23,.32),paint)
    box('ammo_lid',(-.42,.242,-.13),(.225,.014,.335),steel)
    rod('ammo_handle',(-.47,.28,-.13),(-.37,.28,-.13),.009,steel)
    bpy.ops.export_scene.gltf(filepath=str(out/(nation+'_hmg.glb')),export_format='GLB',export_animations=False,export_apply=True)

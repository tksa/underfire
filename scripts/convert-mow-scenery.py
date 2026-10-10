"""Convert selected local MOW scenery, including assembled building sections.
Uses the pinned external GEM reader; source PAKs stay outside shipped assets.
Blender Python --resources PATH --reader PATH --payload PATH --output PATH.
"""
import argparse, importlib.util, pathlib, sys, re, struct, math, json, zipfile, hashlib
from dataclasses import replace
import bpy
from mathutils import Matrix, Vector
spec=importlib.util.spec_from_file_location('mow_builder',pathlib.Path(__file__).with_name('convert-mow-infantry.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
p=argparse.ArgumentParser();p.add_argument('--resources',type=pathlib.Path,required=True);p.add_argument('--reader',type=pathlib.Path,required=True);p.add_argument('--payload',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,default=pathlib.Path('models/scenery'));p.add_argument('--only',nargs='*');args=p.parse_args(sys.argv[sys.argv.index('--')+1:])
MODELS={
 'haystack':'entourage/stack_euro/stack_euro', 'hayrick':'entourage/stack/stack',
 'farm_cart':'entourage/telega/telega','wood_barrel':'entourage/barrel_woods/barrel_woods',
 'firewood':'entourage/firewood/firewood','sacks':'entourage/sack_3/sack_3',
 'well':'entourage/shaft_euro/shaft_euro','plough':'entourage/plough/plough',
 'farmhouse':'village/e-house03a1/e-house03a1','farm_barn':'village/e_farm_112/e_farm_112',
 'wood_shed':'village/shed_wood125/shed_wood125','barn_annex':'village/barn_annex/barn_annex',
 'rail_fence':'fence/fence-wood4/fence-wood4','plank_fence':'fence/fence-wood_3/fence-wood_3',
}
texture_pak=zipfile.ZipFile(args.payload/'resource/texture.pak')
texture_index={n.lower():n for n in texture_pak.namelist()}
class SceneryBuilder(module.Builder):
 def __init__(self,*a):
  super().__init__(*a);self.texture_cache={};self.parts={};self.texture_limit=512
 def texture_path(self,name):
  try:return super().texture_path(name)
  except FileNotFoundError:
   if not name.startswith('$/'):raise
   for suffix in ('','.dds','.tga','.png'):
    n='texture/common/'+name[2:]+suffix
    if n.lower() in texture_index:
     target=self.resources/n;target.parent.mkdir(parents=True,exist_ok=True)
     target.write_bytes(texture_pak.read(texture_index[n.lower()]));return target
   raise
 def texture(self,path):
  path=path.resolve()
  if path in self.texture_cache:return self.texture_cache[path]
  self.source_files.add(path);image=bpy.data.images.load(str(path),check_existing=True).copy();image.colorspace_settings.name='sRGB';_=image.pixels[0]
  w,h=image.size
  if max(w,h)>self.texture_limit:image.scale(max(1,round(w*self.texture_limit/max(w,h))),max(1,round(h*self.texture_limit/max(w,h))))
  image.file_format='PNG';tmp=pathlib.Path(bpy.app.tempdir)/('uf-scenery-'+hashlib.sha256(str(path).encode()).hexdigest()[:12]+'.png');image.filepath_raw=str(tmp);image.save()
  raw=tmp.read_bytes();tmp.unlink();bpy.data.images.remove(image)
  i=len(self.doc['images']);self.doc['images'].append(dict(name=path.stem,mimeType='image/png',bufferView=self.view(raw)));self.doc['textures'].append(dict(source=i,sampler=0));self.texture_cache[path]=i;return i
 def material(self,name):
  path=(self.model_dir/name).resolve();name=str(path)
  if name in self.material_cache:return self.material_cache[name]
  i=super().material(name);source=self.reader.read_material(path);m=self.doc['materials'][i];m['name']=path.stem;m['doubleSided']=source.two_sided
  if source.blend=='test':m.update(alphaMode='MASK',alphaCutoff=.5)
  elif source.blend in ('blend','alpha'):m.update(alphaMode='BLEND')
  return i
 def add_model(self,path,parent_world,depth=0):
  assert depth<5;path=path.resolve();self.source_files.add(path);model=self.reader.read_model(path)
  definition=path.with_suffix('.def');placements={}
  if definition.exists():
   self.source_files.add(definition)
   placements=dict(re.findall(r'\{place\s+"([^"]+)"\s+"([^"]+)"',definition.read_text(errors='replace')))
  def visit(bone,parent,visible=True):
   visible=visible and bone.visibility!=0
   if not visible:return
   local=self.matrix(bone.matrix)
   # Component roots repeat the GEM handedness conversion already carried by
   # the assembled structure. Keep it once, or every wall mirrors away from
   # its attachment and opens seams through the roof.
   if depth and bone is model.basis and local.to_3x3().determinant()<0:
    local=local @ Matrix.Diagonal((1,-1,1,1))
   world=parent @ local
   old_dir=self.model_dir if hasattr(self,'model_dir') else None;self.model_dir=path.parent
   views=[g[0] for g in bone.lod_view_groups if g] or bone.mesh_views[:1]
   for view in views:
    mesh_path=(path.parent/view.file_name).resolve();self.source_files.add(mesh_path);mesh=self.reader.read_mesh(mesh_path)
    raw=mesh_path.read_bytes();fvf=struct.unpack_from('<I',raw,raw.index(b'MESH')+4)[0]
    if fvf&0x40:
     off=raw.index(b'VERT')+4;count,stride,flags=struct.unpack_from('<IHH',raw,off);normal_offset=20 if mesh.skinned_bones else 12
     for i,v in enumerate(mesh.vertices):
      start=off+8+i*stride;mesh.vertices[i]=replace(v,normal=struct.unpack_from('<3f',raw,start+normal_offset),uv=struct.unpack_from('<2f',raw,start+normal_offset+16))
    nm=world.to_3x3().inverted().transposed();mirrored=world.to_3x3().determinant()<0
    for section in mesh.sections:
     mi=self.material(section.material_file)
     if section.two_sided:self.doc['materials'][mi]['doubleSided']=True
     part=self.parts.setdefault(mi,dict(p=[],n=[],uv=[],idx=[]));used=sorted({i for tri in section.triangle_indices for i in tri});remap={v:i+len(part['p']) for i,v in enumerate(used)}
     for i in used:
      v=mesh.vertices[i];part['p'].append(world @ (Vector(v.position)/20));part['n'].append((nm @ Vector(v.normal)).normalized());part['uv'].append(v.uv)
     part['idx'].extend(remap[i] for a,c,d in section.triangle_indices for i in ((a,c,d) if mirrored else (a,d,c)))
   self.model_dir=old_dir
   if bone.name in placements:
    child=placements[bone.name];self.add_model(path.parent/child/(child+'.mdl'),world,depth+1)
   for child in bone.children:visit(child,world,visible)
  visit(model.basis,parent_world)

reports=[]
for key,rel in MODELS.items():
 if args.only and key not in args.only:continue
 b=SceneryBuilder(module.load_reader(args.reader),args.resources.resolve());b.material_label=key
 b.doc['asset']['generator']='Under Fire MOW scenery converter';b.doc['nodes']=[dict(name=key,children=[],extras=dict(source='construction/'+rel,metres=True))]
 axis=Matrix(((0,1,0,0),(0,0,1,0),(1,0,0,0),(0,0,0,1)))
 try:
  b.add_model(b.resources/'entity/construction'/(rel+'.mdl'),axis)
  all_p=[p for v in b.parts.values() for p in v['p']];assert all_p,'No visible geometry'
  lo=[min(p[i] for p in all_p) for i in range(3)];hi=[max(p[i] for p in all_p) for i in range(3)]
  centre=Vector(((lo[0]+hi[0])/2,lo[1],(lo[2]+hi[2])/2))
  for mi,part in b.parts.items():
   attributes=dict(POSITION=b.accessor([v-centre for v in part['p']],3,target=34962,bounds=True),NORMAL=b.accessor(part['n'],3,target=34962),TEXCOORD_0=b.accessor(part['uv'],2,target=34962))
   b.doc['meshes'].append(dict(name=key+'_'+str(mi),primitives=[dict(attributes=attributes,indices=b.accessor(part['idx'],1,'I',34963),material=mi)]))
   ni=len(b.doc['nodes']);b.doc['nodes'].append(dict(name=key+'_'+str(mi),mesh=len(b.doc['meshes'])-1));b.doc['nodes'][0]['children'].append(ni)
  b.save(args.output/(key+'.glb'))
  report=dict(name=key,dimensions=[round(hi[i]-lo[i],3) for i in range(3)],triangles=sum(len(v['idx'])//3 for v in b.parts.values()),materials=len(b.parts));reports.append(report);print('SCENERY',json.dumps(report),flush=True)
 except Exception as e:
  import traceback;traceback.print_exc();reports.append(dict(name=key,error=str(e)))
args.output.mkdir(parents=True,exist_ok=True);(args.output/'conversion-report.json').write_text(json.dumps(reports,indent=2))

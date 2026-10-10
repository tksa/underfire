"""Build the complete MG34 mount and weapon using the shared local asset reader."""
import importlib.util, pathlib, argparse, sys
from mathutils import Matrix
spec=importlib.util.spec_from_file_location('infantry_converter',pathlib.Path(__file__).with_name('convert-mow-infantry.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
parser=argparse.ArgumentParser()
parser.add_argument('--resources',type=pathlib.Path,required=True)
parser.add_argument('--reader',type=pathlib.Path,required=True)
parser.add_argument('--output',type=pathlib.Path,required=True)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
b=module.Builder(module.load_reader(args.reader),args.resources.resolve())
b.model_dir=b.resources
axis=Matrix(((0,1,0,0),(0,0,1,0),(1,0,0,0),(0,0,0,1)))
b.doc['nodes'].append(dict(name='mow_hmg',children=[],**b.trs(axis),extras=dict(forward='+Z',up='+Y')))
b.bones['origin']=0
nodes=b.item(b.resources/'entity/-vehicle/cannon/mg34_stan/mg34_stan.mdl','mount','origin')
b.bones['mgun']=nodes['mgun']
b.item(b.resources/'entity/inventory/-weapon/mg34/mg34.mdl','equipment_mg34','mgun','handle')
b.save(args.output)

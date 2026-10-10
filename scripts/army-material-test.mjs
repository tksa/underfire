import { chromium } from 'playwright';
import fs from 'node:fs';
const browser = await chromium.launch();
const errors = [], checks = [];
try {
    const page = await browser.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error' && !m.text().startsWith('Failed to load resource:'))errors.push(m.text());});
    await page.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8741');
    await page.waitForFunction(()=>Game.units?.length,null,{timeout:120000});
    await page.evaluate(()=>{
        Game._paused=true; window.requestAnimationFrame=()=>0;
        window.materialUnits = ['french_r35','french_h35','german_panzer2','polish_7tp','polish_wz34','german_mortar_81','french_mortar_81','polish_mortar81'].map(key=>{
            const team=key.split('_')[0],kind=key.slice(team.length+1);
            return Game.makeUnit(team,kind,100,100,{aiState:'player'});
        });
    });
    await page.waitForFunction(()=>materialUnits.every(u=>u.mesh.userData.modelPath),null,{timeout:120000});
    const result=await page.evaluate(()=>{
        const T=Game.THREE,checks=[],details=[];
        const check=(name,pass)=>checks.push({name,pass:!!pass});
        for(const u of materialUnits){
            const nodes=[];u.mesh.userData.modelWrapper.traverse(n=>{if(n.isMesh)nodes.push(n)});
            const mats=[...new Set(nodes.flatMap(n=>Array.isArray(n.material)?n.material:[n.material]))];
            details.push({key:u.statKey,materials:mats.map(m=>({name:m.name,color:m.color?.getHexString(),side:m.side,map:m.map?.uuid,grade:m.userData.armyTeam,median:m.map&&Game.armyTextureLuminance(m.map)}))});
            check(`${u.statKey}: faction material`,mats.every(m=>m.userData.armyTeam===u.team));
            check(`${u.statKey}: source materials are isolated`,!mats.some(m=>{let shared=false;Game.modelCache[u.mesh.userData.modelPath]?.traverse(n=>{if(n.isMesh&&(n.material===m||(Array.isArray(n.material)&&n.material.includes(m))))shared=true});return shared}));
            if(u.kind==='r35'){
                check('R35 retains all eight separate texture maps',new Set(mats.map(m=>m.map).filter(Boolean)).size===8);
                check('R35 keeps double-sided shell surfaces',mats.every(m=>m.side===T.DoubleSide));
                const turret=u.mesh.userData.modelWrapper.getObjectByName('Object_36');
                turret.updateWorldMatrix(true,true);
                const g=turret.geometry, position=g.attributes.position, normal=g.attributes.normal;
                let wrong=0,total=0;
                for(let i=0;i<(g.index?.count||position.count);i+=3){
                    const ids=[0,1,2].map(k=>g.index?g.index.getX(i+k):i+k);
                    const vertices=ids.map(id=>new T.Vector3().fromBufferAttribute(position,id));
                    const face=vertices[1].sub(vertices[0]).cross(vertices[2].sub(vertices[0]));
                    if(face.lengthSq()<1e-12)continue;
                    for(const id of ids){total++;if(face.dot(new T.Vector3().fromBufferAttribute(normal,id))<0)wrong++;}
                }
                check('R35 rebuilt normals agree with turret triangle winding',g.userData.r35NormalRepair&&wrong/total<.01);
                const b=new T.Box3().setFromObject(turret),c=b.getCenter(new T.Vector3());
                const ray=new T.Raycaster(new T.Vector3(c.x,b.max.y+2,c.z),new T.Vector3(0,-1,0));
                check('R35 roof blocks a downward ray through the turret',ray.intersectObject(turret,true).length>0);
            }
            Game.renderer.compile(u.mesh,Game.camera);
        }
        const mortarMats=materialUnits.slice(-3).map(u=>{let m;u.mesh.userData.modelWrapper.traverse(n=>{if(n.isMesh&&n.material.name==='mortar field paint')m=n.material});return m;});
        check('shared mortar GLB has separate national paint',new Set(mortarMats).size===3&&new Set(mortarMats.map(m=>m.color.getHex())).size===3);
        return {checks,details};
    });
    checks.push(...result.checks);
    fs.mkdirSync('tmp/army-material-review',{recursive:true});fs.writeFileSync('tmp/army-material-review/materials.json',JSON.stringify(result,null,2));
    for(const c of checks)console.log(`${c.pass?'PASS':'FAIL'} ${c.name}`);
    console.log(JSON.stringify({errors,checks:checks.length}));
    if(errors.length||checks.some(c=>!c.pass))process.exitCode=1;
}catch(e){console.error(errors);throw e;}finally{await browser.close()}

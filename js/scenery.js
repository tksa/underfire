Game.modelUnitsPerMetre = () => (Game.SOLDIER_HEIGHT || 1.24) / 1.75;
/** Farm scenery uses measured joins, shared assets and spatial instance batches. */

Game.DIVIDER_MODELS.fence = ['models/scenery/rail_fence.glb'];

Game.cleanDividerSegments = pieces => {
    const T = Game.TILE, accepted = [], bins = new Map(), cell = 12;
    const ends = p => { const h = T * (p.sMul || 1) / 2, dx = Math.cos(p.rotY) * h, dz = -Math.sin(p.rotY) * h;
        return { ax:p.x-dx, az:p.z-dz, bx:p.x+dx, bz:p.z+dz }; };
    const cells = p => { const keys=[]; for(let x=Math.floor((Math.min(p.ax,p.bx)-.4)/cell);x<=Math.floor((Math.max(p.ax,p.bx)+.4)/cell);x++)
        for(let z=Math.floor((Math.min(p.az,p.bz)-.4)/cell);z<=Math.floor((Math.max(p.az,p.bz)+.4)/cell);z++)keys.push(`${x},${z}`);return keys; };
    const cross = (ax,az,bx,bz) => ax*bz-az*bx;
    for (const source of [...pieces].sort((a,b)=>(a.c1<0)-(b.c1<0))) {
        const p={...source,...ends(source)};
        const neighbors=new Set(cells(p).flatMap(k=>bins.get(k)||[]));let reject=false;
        for(const q of neighbors){
            const dx=p.bx-p.ax,dz=p.bz-p.az,ex=q.bx-q.ax,ez=q.bz-q.az;
            const den=cross(dx,dz,ex,ez),len=Math.hypot(dx,dz),qlen=Math.hypot(ex,ez);
            if(len<.45){reject=true;break;}
            if(Math.abs(den)<len*qlen*.07){
                const separation=Math.abs(cross(q.ax-p.ax,q.az-p.az,dx,dz))/len;
                const a=((q.ax-p.ax)*dx+(q.az-p.az)*dz)/len,b=((q.bx-p.ax)*dx+(q.bz-p.az)*dz)/len;
                if(separation<.38 && Math.min(len,Math.max(a,b))-Math.max(0,Math.min(a,b))>.3){reject=true;break;}
                continue;
            }
            const t=cross(q.ax-p.ax,q.az-p.az,ex,ez)/den,u=cross(q.ax-p.ax,q.az-p.az,dx,dz)/den;
            if(t<-.01||t>1.01||u<-.01||u>1.01)continue;
            // Shared end posts are a join. An interior crossing is trimmed to
            // the longer side with a small clear gap, never an X through a wall.
            if(Math.min(t,1-t)*len<.18 && Math.min(u,1-u)*qlen<.18)continue;
            const gap=.22/len;
            if(t>.5){p.bx=p.ax+dx*Math.max(0,t-gap);p.bz=p.az+dz*Math.max(0,t-gap);}
            else {p.ax+=dx*Math.min(1,t+gap);p.az+=dz*Math.min(1,t+gap);}
        }
        const length=Math.hypot(p.bx-p.ax,p.bz-p.az);
        if(reject||length<.65)continue;
        let clear=true;
        for(let n=0;n<=4;n++){
            const tile=Game.getTileAtWorld(Game.lerp(p.ax,p.bx,n/4),Game.lerp(p.az,p.bz,n/4));
            if(!tile||['road','water','house','wall'].includes(tile.type)){clear=false;break;}
        }
        if(!clear)continue;
        p.x=(p.ax+p.bx)/2;p.z=(p.az+p.bz)/2;p.rotY=Math.atan2(p.az-p.bz,p.bx-p.ax);p.sMul=length/T;
        accepted.push(p);for(const k of cells(p)){if(!bins.has(k))bins.set(k,[]);bins.get(k).push(p);}
    }
    Game._dividerPlan=accepted;Game._dividerAudit={candidates:pieces.length,placed:accepted.length};
    return accepted;
};

Game.buildDividerInstances = (url, mine, kind, variant) => {
    if(!mine.length)return;
    const generation=Game._terrainBuildSerial;
    Game.loadModel(url).then(model=>{
        if(generation!==Game._terrainBuildSerial)return;
        const T=Game.THREE;let source;model.updateMatrixWorld(true);model.traverse(o=>{if(!source&&o.isMesh)source=o;});if(!source)return;
        const cache=Game._dividerPrototypes ||= new Map();let proto=cache.get(url);
        if(!proto){
            const geo=source.geometry.clone().applyMatrix4(source.matrixWorld);geo.computeBoundingBox();let bb=geo.boundingBox;
            if(bb.max.z-bb.min.z>bb.max.x-bb.min.x){geo.rotateY(Math.PI/2);geo.computeBoundingBox();bb=geo.boundingBox;}
            geo.translate(-(bb.min.x+bb.max.x)/2,-bb.min.y,-(bb.min.z+bb.max.z)/2);geo.computeBoundingBox();bb=geo.boundingBox;
            if(!geo.attributes.normal)geo.computeVertexNormals();
            const mat=source.material.clone();mat.roughness=.95;mat.metalness=0;
            if(kind==='wall'){mat.map=Game._makeDarkStoneTexture();mat.color.setHex(0xffffff);}
            proto={geo,mat,length:bb.max.x-bb.min.x,height:bb.max.y-bb.min.y};cache.set(url,proto);
        }
        const chunks=new Map();for(const p of mine){const key=`${Math.floor(p.x/48)},${Math.floor(p.z/48)}`;if(!chunks.has(key))chunks.set(key,[]);chunks.get(key).push(p);}
        const dummy=new T.Object3D(),color=new T.Color();
        for(const [chunk,list] of chunks){
            const inst=new T.InstancedMesh(proto.geo,proto.mat,list.length);inst.name=`divider-${kind}-${variant+1}-${chunk}`;inst.castShadow=inst.receiveShadow=true;
            list.forEach((p,i)=>{
                const length=Game.TILE*p.sMul;
                const bulk=kind==='fence'?Game.modelUnitsPerMetre():Game.TILE/proto.length*.8;
                const sy=bulk*(p.hMul||1),y=Math.min(Game.getHeight(p.ax,p.az),Game.getHeight(p.bx,p.bz),Game.getHeight(p.x,p.z))-.025;
                dummy.position.set(p.x,y,p.z);dummy.rotation.set(0,p.rotY,0);dummy.scale.set(length/proto.length,sy,bulk);dummy.updateMatrix();inst.setMatrixAt(i,dummy.matrix);inst.setColorAt(i,color.setScalar(p.tint||1));
                Game.foliageKD?.push({leaves:inst,branches:inst,idx:i,x:p.x,y,z:p.z,rotY:p.rotY,s:length/proto.length,sy,sz:bulk,
                    rrMul:.8,rrAdd:.1,stone:kind==='wall',wood:kind==='fence',dir:0,fallT:0,triggered:false});
            });
            inst.instanceMatrix.needsUpdate=true;if(inst.instanceColor)inst.instanceColor.needsUpdate=true;
            inst.computeBoundingSphere();inst.boundingSphere.radius+=proto.height*Game.modelUnitsPerMetre();Game.terrainGroup.add(inst);
        }
    }).catch(err=>console.warn('Divider asset unavailable:',url,err));
};

Game.FARM_PROPS = {
    haystack: {radius:1.9,solid:true}, hayrick:{radius:1.4,solid:true},
    farm_cart:{radius:1.7,solid:true}, wood_barrel:{radius:.5}, firewood:{radius:1.25},
    sacks:{radius:.9}, well:{radius:1.5,solid:true}, plough:{radius:1.8},
};
Game.clearFarmScenery = () => {
    for(const r of Game._farmScenery||[])for(const t of r.tiles||[])
        if(Game.getTile(t.tx,t.ty)===t.tile)Game.terrain[t.ty][t.tx]=t.original;
    Game._farmScenery=[];
};
Game.addFarmScenery = () => {
    const generation=Game._terrainBuildSerial, plans=[], occupied=[];
    const hash=(x,z,salt)=>Game._hash2(x*.713+salt*31.7,z*.619-salt*17.3);
    const allowed=new Set(['yard','grass','pasture','garden','orchard','plowed']);
    const add=(key,x,z,angle,scale=1)=>{
        const def=Game.FARM_PROPS[key],r=def.radius*scale;
        if(plans.length>=84 || x<5 || z<5 || x>Game.WORLD_W-5 || z>Game.WORLD_H-5)return;
        // Leave roads, door approaches, hedges, water and existing footprints free.
        for(const [dx,dz] of [[0,0],[r,0],[-r,0],[0,r],[0,-r]]){
            const t=Game.getTileAtWorld(x+dx,z+dz);if(!t||t.blocked||!allowed.has(t.type))return;
        }
        if(Game.buildingRecords.some(b=>Math.abs(x-b.cx)<b.w/2+r+1.4&&Math.abs(z-b.cz)<b.d/2+r+1.4))return;
        if(occupied.some(p=>Game.distSq(p.x,p.z,x,z)<(p.r+r+.4)**2))return;
        if(Game.units?.some(u=>u.alive&&Game.distSq(u.x,u.z,x,z)<(r+4)**2))return;
        const heights=[Game.getHeight(x-r,z),Game.getHeight(x+r,z),Game.getHeight(x,z-r),Game.getHeight(x,z+r)];
        if(Math.max(...heights)-Math.min(...heights)>.3)return;
        const p={key,x,z,angle,scale,r,ground:Math.min(...heights),slots:[],tiles:[],alive:true};occupied.push(p);plans.push(p);
    };
    for(const rec of Game.buildingRecords){
        const h=hash(rec.cx,rec.cz,2),side=h<.5?-1:1;
        const x=rec.cx+side*(rec.w/2+5.2),z=rec.cz+(h-.5)*rec.d;
        add(h<.4?'hayrick':'haystack',x,z,h*Math.PI*2,.85+h*.15);
        add('farm_cart',rec.cx+side*(rec.w/2+4.8),rec.cz+rec.d/2+6,h*Math.PI);
        add('firewood',rec.cx-side*(rec.w/2+4),rec.cz-rec.d/2-3.8,rec.w>rec.d?0:Math.PI/2,.85);
        add('wood_barrel',x+side*3.4,z+2.8,h*Math.PI,.8);
        add('sacks',x+side*3.6,z-2.2,h*Math.PI,.8);
        if(h<.45)add('plough',x+side*4,z+6,h*Math.PI,.62);
        if(h>.7)add('well',rec.cx,rec.cz+rec.d/2+5.3,0,.65);
    }
    // A few stored hay ricks at quiet pasture margins, never random objects in roads.
    for(let ty=10;ty<Game.MAP_ROWS-8;ty+=9)for(let tx=8;tx<Game.MAP_COLS-8;tx+=11){
        const t=Game.getTile(tx,ty);if(!t||!['grass','pasture'].includes(t.type)||hash(tx,ty,8)>.35)continue;
        if(!['hedge','plowed','wheat','orchard'].includes(Game.getTile(tx+1,ty)?.type))continue;
        add('hayrick',(tx+.5)*Game.TILE,(ty+.5)*Game.TILE,hash(tx,ty,9)*6.28,.85);
    }
    Game._farmScenery=plans;
    const keys=[...new Set(plans.map(p=>p.key))];
    Game._farmSceneryReady=Promise.all(keys.map(async key=>{
        try{
            const source=await Game.loadModel(`models/scenery/${key}.glb`);
            if(generation!==Game._terrainBuildSerial)return;
            const T=Game.THREE,mine=plans.filter(p=>p.key===key),chunks=new Map();
            for(const p of mine){const c=`${Math.floor(p.x/48)},${Math.floor(p.z/48)}`;if(!chunks.has(c))chunks.set(c,[]);chunks.get(c).push(p);}
            source.updateMatrixWorld(true);const parts=[];source.traverse(o=>{if(o.isMesh)parts.push(o);});
            const dummy=new T.Object3D(),matrix=new T.Matrix4();
            for(const [chunk,list] of chunks)for(const part of parts){
                const inst=new T.InstancedMesh(part.geometry,part.material,list.length);inst.name=`farm-${key}-${chunk}`;inst.castShadow=inst.receiveShadow=true;
                list.forEach((p,i)=>{
                    dummy.position.set(p.x,p.ground-.015,p.z);dummy.rotation.set(0,p.angle,0);dummy.scale.setScalar(Game.modelUnitsPerMetre()*p.scale);dummy.updateMatrix();matrix.multiplyMatrices(dummy.matrix,part.matrixWorld);inst.setMatrixAt(i,matrix);p.slots.push({mesh:inst,index:i});
                });inst.instanceMatrix.needsUpdate=true;inst.computeBoundingSphere();Game.terrainGroup.add(inst);
            }
            for(const p of mine)if(Game.FARM_PROPS[key].solid){
                const {tx,ty}=Game.tileAtWorld(p.x,p.z),original=Game.getTile(tx,ty);
                if(original&&!original.blocked){const tile={...original,blocked:true,sightBlock:/hay/.test(key),cover:.7,_farmProp:p};Game.terrain[ty][tx]=tile;p.tiles.push({tx,ty,original,tile});}
            }
        }catch(e){console.warn('Farm scenery unavailable:',key,e);}
    }));
};
Game.damageFarmSceneryAt = (x,z,radius,damage) => {
    if(damage<20)return;
    const T=Game.THREE;let zero;
    for(const p of Game._farmScenery||[]){
        if(!p.alive||Game.distSq(x,z,p.x,p.z)>(radius+p.r*.6)**2)continue;
        p.alive=false;zero||=new T.Matrix4();
        for(const slot of p.slots){
            slot.mesh.getMatrixAt(slot.index,zero);
            const position=new T.Vector3(),rotation=new T.Quaternion(),scale=new T.Vector3();zero.decompose(position,rotation,scale);scale.y*=.12;
            zero.compose(position,rotation,scale);slot.mesh.setMatrixAt(slot.index,zero);slot.mesh.instanceMatrix.needsUpdate=true;
            // Keep a flattened remnant; restore movement through the destroyed prop.
        }
        for(const t of p.tiles)if(Game.getTile(t.tx,t.ty)===t.tile)Game.terrain[t.ty][t.tx]=t.original;
        Game.smoke?.push({x:p.x,z:p.z,r:.55,life:.65,total:.65,dust:true,maxOpacity:.4,rise:.35,vx:0,vz:0,mesh:null});
    }
};

// The preserved source shop-house remains one option. Other footprint-compatible
// structures use the infantry's metric scale, with real garrison/damage records.
Game.FARM_BUILDINGS = ['farmhouse','farm_barn','wood_shed'];
Game._loadBuildingModels = () => {
    const records=Game.buildingRecords.slice(),generation=Game._terrainBuildSerial;
    const paths=[Game.BUILDING_MODEL,...Game.FARM_BUILDINGS.map(k=>`models/scenery/${k}.glb`)];
    Game._buildingModelsReady=Promise.all(paths.map(p=>Game.loadModel(p).catch(()=>null))).then(models=>{
        if(generation!==Game._terrainBuildSerial)return;
        Game._buildingSrcModel=models[0];
        for(let i=0;i<records.length;i++){
            const rec=records[i],roll=Game._hash2(rec.cx*.19+7,rec.cz*.17-3);
            const preferred=i%4;let done=false;
            // Keep some stone shop-houses; every other plot tries the recovered
            // houses in a deterministic order, skipping anything that won't fit.
            if(preferred!==0)for(let n=0;n<3&&!done;n++){
                const index=(preferred+n-1)%3+1,src=models[index];if(!src)continue;
                done=Game.populateFarmBuilding(rec,src,Game.FARM_BUILDINGS[index-1],roll);
            }
            if(!done&&models[0])Game._populateBuildingModel(rec,models[0]);
        }
    });
};
Game.populateFarmBuilding = (rec,source,key,roll) => {
    const T=Game.THREE,model=source.clone(),S=Game.modelUnitsPerMetre();
    model.scale.setScalar(S);model.updateMatrixWorld(true);let box=new T.Box3().setFromObject(model);const size=box.getSize(new T.Vector3());
    const flip=(rec.w>=rec.d)!==(size.x>=size.z);
    if((flip?size.z:size.x)>rec.w-.1||(flip?size.x:size.z)>rec.d-.1)return false;
    model.rotation.y=(flip?Math.PI/2:0)+(roll>.5?Math.PI:0);model.updateMatrixWorld(true);box=new T.Box3().setFromObject(model);
    model.position.set(rec.cx-(box.min.x+box.max.x)/2,rec.baseY-box.min.y-.08,rec.cz-(box.min.z+box.max.z)/2);
    model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=false;}});
    rec.group.add(model);rec.houses=[{root:model,states:[null,null,null,null]}];rec.modelKey=key;
    rec.procMeshes.forEach(o=>o.visible=false);Game.setBuildingDamage(rec,rec.level);Game._sealBuildingFootprint(rec);return true;
};

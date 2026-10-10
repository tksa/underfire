/** Reproducible attack-move CPU and asset audit. Run alone, not beside other GPU tests. */
import { chromium } from 'playwright';
import fs from 'node:fs';
const out=process.argv[2]||'tmp/performance/attack-move.json';
const browser=await chromium.launch({args:process.env.PROFILE_GPU==='metal'?['--use-angle=metal','--enable-gpu']:[]});
const errors=[];
try{
    const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:Number(process.env.PROFILE_DPR||1)});
    await page.addInitScript(()=>{let seed=162719;Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);});
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(process.env.SMOKE_URL||'http://127.0.0.1:8741',{waitUntil:'domcontentloaded',timeout:120000});
    await page.waitForFunction(()=>Game.units?.length,null,{timeout:120000});
    await page.evaluate(()=>{Game._paused=true;window.__profileRAF=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=()=>0;});
    await page.waitForFunction(()=>Game.units.filter(u=>u.alive).every(u=>u.mesh.userData.modelPath
        && (!Game.GUN_CREWS[u.kind]||u.mesh.userData.fieldGunCrew?.userData.crewMode==='soldier')),null,{timeout:120000});
    await page.evaluate(async()=>{await Game._farmSceneryReady;await Game._buildingModelsReady;});
    await page.waitForFunction(()=>Game._dividerPlan?.length&&Game.terrainGroup.children.filter(o=>/^divider-(wall|fence)-/.test(o.name)).reduce((s,o)=>s+o.count,0)===Game._dividerPlan.length,null,{timeout:60000});
    const resources=await page.evaluate(()=>{
        const textures=new Map(),geometries=new Map(),materials=new Set(),byModel={},owners=new Map(),drawMeshes=[];
        Game.scene.traverse(o=>{
            if(!o.isMesh)return;geometries.set(o.geometry.uuid,o.geometry);
            drawMeshes.push({name:o.name,parent:o.parent?.name,instances:o.count||1,
                triangles:(o.geometry.index?.count||o.geometry.attributes.position?.count||0)/3*(o.count||1),shadow:o.castShadow});
            for(const m of Array.isArray(o.material)?o.material:[o.material]){
                materials.add(m);for(const v of Object.values(m))if(v?.isTexture){textures.set(v.uuid,v);owners.set(v.uuid,`${o.parent?.name}/${o.name} (${m.name})`);}
            }
        });
        const textureList=[...textures.values()].map(t=>({name:t.name,owner:owners.get(t.uuid),source:t.source?.uuid,
            width:t.image?.width||t.image?.videoWidth||0,height:t.image?.height||t.image?.videoHeight||0,
            bytes:(t.image?.width||0)*(t.image?.height||0)*4*(t.generateMipmaps?4/3:1)}));
        for(const u of Game.units){let meshes=0,vertices=0,triangles=0,bones=0;u.mesh.traverse(n=>{
            if(n.isMesh){meshes++;vertices+=n.geometry.attributes.position?.count||0;triangles+=(n.geometry.index?.count||n.geometry.attributes.position?.count||0)/3;}
            if(n.isBone)bones++;
        });const key=u.mesh.userData.modelPath;(byModel[key]||=[]).push({meshes,vertices,triangles,bones});}
        const paths=performance.getEntriesByType('resource').map(r=>new URL(r.name).pathname);
        const scripts=[...document.scripts].filter(s=>s.src).map(s=>new URL(s.src).pathname);
        const duplicateScripts=scripts.filter((p,i)=>scripts.indexOf(p)!==i);
        const gl=Game.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
        return {units:Game.units.length,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
            pixelRatio:Game.renderer.getPixelRatio(),
            drawingBuffer:{width:Game.renderer.domElement.width,height:Game.renderer.domElement.height},
            grass:Game._fluffStats,materials:materials.size,geometries:geometries.size,
            textures:textureList.length,textureMiB:textureList.reduce((s,t)=>s+t.bytes,0)/1048576,
            uniqueSources:new Set(textureList.map(t=>t.source)).size,
            largestTextures:textureList.sort((a,b)=>b.bytes-a.bytes).slice(0,15),
            models:Object.entries(byModel).map(([path,entries])=>({path,count:entries.length,...entries[0]})),
            largestMeshes:drawMeshes.sort((a,b)=>b.triangles-a.triangles).slice(0,20),
            duplicateScripts,duplicateModelRequests:paths.filter((p,i)=>p.endsWith('.glb')&&paths.indexOf(p)!==i)};
    });
    const stats=process.env.PROFILE_ASSETS_ONLY==='1'?{}:await page.evaluate(async()=>{
        const names=['updateUnit','updateSquadAI','updateChainOfCommand','updateSupportUnits','updateFogOfWar',
            'updateCamouflage','updateHover','syncUnitMeshes','_updateModelAnimation','updateFieldGunCrew','updateVehicleModel',
            'updateHUD','updateMinimap','updateFoliage','updateWaterFX','updateValor','processVehicleRouteQueue',
            'findPath','lineOfSight','unitCanSee','nearestEnemy','friendlyFireBlocker','updateSupportingFire',
            'getWeaponMuzzle','syncWeaponTransform','updateMortarAreaMarkers','updateCamera',
            'updateIndirectShells','updateAirStrikes','updateBombers','updateFighters','updateThrownGrenades',
            'updateSmokeClouds','updateTracers3D','updateImpactDebris','updateCraterDeformations','updateWreckFx','updateFires',
            'updateBuildings','updateBuildingEntry','updateCavalryHorseEntry','updateSmoke3D','updateScorch3D',
            'updateFoliageKnockdown','updateTracks3D','updateMines','updateTowing','updateRecon','updateBinoculars',
            'updateEliteCrews','updateMission','updateMessages','updateLighting','updateOrderMarkers','updateGarrisonUI'];
        const stats={},originals={};let active={};
        for(const name of names){const fn=Game[name];if(!fn)continue;originals[name]=fn;Game[name]=function(...args){
            const start=performance.now();try{return fn.apply(this,args);}finally{const ms=performance.now()-start;const s=active[name]||=( {calls:0,total:0,max:0});s.calls++;s.total+=ms;s.max=Math.max(s.max,ms);}
        };}
        const render=Game.renderScene;Game.renderScene=()=>{};Game._paused=false;Game.gameClock=100;
        let now=Game.lastTime;
        const phase=async(label,frames)=>{
            active={};const times=[];
            for(let i=0;i<frames;i++){
                const start=performance.now();now+=1000/30;Game.tick(now);times.push(performance.now()-start);
                if(i%30===29)await new Promise(r=>setTimeout(r,0));
            }
            times.sort((a,b)=>a-b);
            stats[label]={frames,mean:times.reduce((a,b)=>a+b,0)/frames,p95:times[Math.floor(frames*.95)],max:times.at(-1),
                alive:Game.units.filter(u=>u.alive).length,moving:Game.units.filter(u=>u.moving).length,
                top:Object.entries(active).sort((a,b)=>b[1].total-a[1].total).slice(0,20)};
        };
        await phase('idle',60);
        const mine=Game.units.filter(u=>u.alive&&u.team===Game.playerTeam&&u._inVehicle==null);
        Game.selection.clear();for(const u of mine)Game.selection.add(u.id);
        const start=performance.now();Game.orderAttackMove(Game.missionState.objectiveX,Game.missionState.objectiveY);
        stats.orderMs=performance.now()-start;
        await phase('advance',180);await phase('contact',240);
        Game.renderScene=render;Game._paused=true;Object.assign(Game,originals);
        return stats;
    });
    const render=await page.evaluate(()=>{
        Game.updateCamera(0);Game.syncUnitMeshes(0);
        const info=Game.renderer.info;info.autoReset=false;info.reset();
        const start=performance.now();Game.renderScene();const submitMs=performance.now()-start;
        return {submitMs,calls:info.render.calls,triangles:info.render.triangles,programs:info.programs.length,memory:{...info.memory}};
    });
    const frameCount=Number(process.env.PROFILE_RENDER_FRAMES||0);
    const live=frameCount?await page.evaluate(async(count)=>{
        Game._paused=false;Game.lastTime=performance.now();
        const intervals=[];let previous=performance.now();
        for(let n=0;n<count+10;n++){
            const now=await new Promise(window.__profileRAF);
            Game.tick(now);
            if(n>=10)intervals.push(now-previous);
            previous=now;
        }
        Game._paused=true;intervals.sort((a,b)=>a-b);
        const mean=intervals.reduce((a,b)=>a+b,0)/intervals.length;
        return {frames:count,mean,p95:intervals[Math.floor(count*.95)],fps:1000/mean};
    },frameCount):undefined;
    const report={resources,stats,render,live,errors};fs.mkdirSync(out.slice(0,out.lastIndexOf('/')),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));
    console.log(JSON.stringify({out,resources:{...resources,models:undefined,largestTextures:undefined},render,live,
        stats:Object.fromEntries(Object.entries(stats).map(([k,v])=>[k,typeof v==='object'?{...v,top:v.top.slice(0,8)}:v])),errors},null,2));
}finally{await browser.close()}

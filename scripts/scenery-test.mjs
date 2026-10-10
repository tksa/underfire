import {chromium} from 'playwright';import fs from 'node:fs';
const out=process.argv[2]||'tmp/scenery-review';fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch();const errors=[],checks=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{let seed=82910;Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296)});
 await page.goto('http://127.0.0.1:8741',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>Game.units?.length,null,{timeout:120000});
 await page.waitForFunction(()=>document.getElementById('bootLoader')?.style.display==='none',null,{timeout:45000});
 await page.locator('#btnEnterGame').click();await page.locator('#btnStartMission').click();
 await page.waitForFunction(()=>Game._dividerPlan?.length&&Game.terrainGroup.children.filter(o=>/^divider-(wall|fence)-/.test(o.name)).reduce((s,o)=>s+o.count,0)===Game._dividerPlan.length,null,{timeout:60000});
 const data=await page.evaluate(async()=>{
  Game._paused=true;window.requestAnimationFrame=()=>0;Game._fogDisabled=true;Game.updateFogOfWar(10);await Game._farmSceneryReady;await Game._buildingModelsReady;
  const T=Game.THREE,check=(name,pass,detail)=>({name,pass:!!pass,detail});
  const props=Game._farmScenery||[],types=[...new Set(props.filter(p=>p.slots.length).map(p=>p.key))],buildingTypes=[...new Set(Game.buildingRecords.map(r=>r.modelKey||'shop_house'))];
  const findings=[check('suitable farm sites receive varied props',props.length>0&&types.length>=5,{count:props.length,types}),check('building silhouettes vary',buildingTypes.length>=3,buildingTypes),check('props load completely within placement budget',props.length<=84&&props.every(p=>p.slots.length)),
   check('large props register matching collision and keep roads clear',props.filter(p=>p.tiles.length).every(p=>p.tiles.every(t=>t.tile.blocked&&t.original.type!=='road'))),
   check('field boundaries have measured endpoints',Game._dividerPlan?.every(p=>Math.abs(Math.hypot(p.bx-p.ax,p.bz-p.az)-p.sMul*Game.TILE)<1e-5),Game._dividerAudit)];
  const saved=Game.getTileAtWorld,oldPlan=Game._dividerPlan,oldAudit=Game._dividerAudit;Game.getTileAtWorld=()=>({type:'grass'});
  const pieces=[{x:0,z:0,rotY:0,c1:0,kind:'wall'}, {x:0,z:0,rotY:Math.PI/2,c1:-1,kind:'fence'}, {x:.02,z:.05,rotY:0,c1:-1,kind:'fence'}, {x:Game.TILE,z:0,rotY:0,c1:1,kind:'wall'}];
  const clean=Game.cleanDividerSegments(pieces);Game.getTileAtWorld=saved;Game._dividerPlan=oldPlan;Game._dividerAudit=oldAudit;
  findings.push(check('crossing/duplicate segments become clean end joins',clean.length===3&&clean.find(p=>p.kind==='fence').sMul<.5,clean.map(p=>({x:p.x,z:p.z,length:p.sMul*Game.TILE}))));
  const victim=props.find(p=>p.tiles.length),untouched=props.find(p=>Game.distSq(p.x,p.z,victim.x,victim.z)>100);
  Game.damageFarmSceneryAt(victim.x,victim.z,.2,50);
  findings.push(check('destroyed scenery releases collision without deleting other props',!victim.alive&&victim.tiles.every(t=>Game.getTile(t.tx,t.ty)===t.original)&&untouched.alive));
  const intact=Game.buildingRecords.find(r=>r.modelKey);const hp=intact.hp;Game.damageBuildingAt(intact.cx,intact.cz,35,1);findings.push(check('imported buildings retain damage and garrison records',intact.hp<hp&&intact.capacity>0&&Array.isArray(intact.occupants)));
  Game.selection.clear();Game.units.filter(u=>u.alive&&u.team===Game.playerTeam).slice(0,16).forEach(u=>Game.selection.add(u.id));Game.updateHUD();
  return {findings,views:Game.buildingRecords.filter(r=>r.modelKey).slice(0,3).map(r=>({x:r.cx,z:r.cz,key:r.modelKey})),props:props.length,buildingTypes};
 });checks.push(...data.findings);
 for(const v of data.views){await page.evaluate(v=>{Game.cam.x=v.x;Game.cam.z=v.z;Game.cam.zoom=Game.cam.targetZoom=15;Game.mouse.screenX=700;Game.mouse.screenY=300;Game.updateCamera(0);Game.syncUnitMeshes(0);Game.updateMinimap();Game.renderScene();},v);await page.screenshot({path:`${out}/${v.key}.png`});}
 console.log(JSON.stringify({checks,errors},null,2));fs.writeFileSync(`${out}/checks.json`,JSON.stringify({checks,errors},null,2));if(errors.length||checks.some(c=>!c.pass))process.exitCode=1;
}finally{await browser.close();}

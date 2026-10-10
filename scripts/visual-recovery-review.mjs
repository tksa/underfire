/** Compare the rejected art pass with its rollback in the same battlefield fixture. */
import {chromium} from 'playwright';import fs from 'node:fs';
const out='tmp/visual-recovery';fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch();
const report=[];
try{for(const version of ['before','after']){
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{let seed=82910;Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296)});
 if(version==='before')for(const file of ['army_materials','impact_fx','renderer','units','main'])await page.route(`**/js/${file}.js*`,r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync(`${out}/before/js/${file}.js`,'utf8')}));
 await page.goto('http://127.0.0.1:8741',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>Game.units?.length,null,{timeout:120000});await page.waitForFunction(()=>document.getElementById('bootLoader')?.style.display==='none',null,{timeout:45000});
 await page.locator('#btnEnterGame').click();await page.locator('#btnStartMission').click();
 await page.waitForFunction(()=>Game._dividerPlan?.length&&Game.terrainGroup.children.filter(o=>/^divider-(wall|fence)-/.test(o.name)).reduce((s,o)=>s+o.count,0)===Game._dividerPlan.length,null,{timeout:60000});
 await page.evaluate(async()=>{Game._paused=true;window.requestAnimationFrame=()=>0;await Game._farmSceneryReady;await Game._buildingModelsReady;Game.unitsGroup.clear();Game.units=[];Game.selection.clear();Game.effectsGroup.clear();Game.smoke=[];Game.muzzleFlashes=[];Game.scorchDecals=[];Game.tracers=[];Game._craterQueue=[];
 let best=null;for(let z=40;z<250&&!best;z+=3)for(let x=50;x<250&&!best;x+=3){let clear=true;for(let dz=-14;dz<=14&&clear;dz+=3)for(let dx=-20;dx<=20;dx+=3){const t=Game.getTileAtWorld(x+dx,z+dz);if(!t||t.blocked||['water','forest','dense_forest','orchard'].includes(t.type)){clear=false;break;}}if(clear && Game._dividerPlan.every(p=>p.x<x-16||p.x>x+12||p.z<z-9||p.z>z+11) && Game.buildingRecords.every(r=>Math.hypot(r.cx-x,r.cz-z)>25))best={x,z};}
 window.reviewPoint=best||{x:65,z:80};const{x,z}=reviewPoint;
 const make=(team,kind,dx,dz)=>Game.makeUnit(team,kind,x+dx,z+dz,{aiState:'player',angle:0});
 window.reviewUnits=[make('french','s35',-9,-4),make('french','r35',-13,2),make('french','h35',-5,6),make('french','supply_truck',-11,8),...Array.from({length:10},(_,i)=>make('german','grenadier',i%4*2.1+1,Math.floor(i/4)*3-5)),...Array.from({length:4},(_,i)=>make('french','fusilier',-10+i*2,1))];
 Game._fogDisabled=true;Game.updateFogOfWar(10);Game.cam.x=x;Game.cam.z=z;Game.cam.zoom=Game.cam.targetZoom=19;Game.updateCamera(0);
 });
 await page.waitForFunction(()=>reviewUnits.every(u=>u.mesh.userData.modelPath),null,{timeout:120000});
 const result=await page.evaluate(()=>{Game.syncUnitMeshes(0);const shooter=reviewUnits[0],target=reviewUnits[4];target.hp=target.maxHp=400;const rng=Math.random;Math.random=()=>.01;const ammo=shooter.ammo,hp=target.hp;Game.applyShot(shooter,target);Math.random=rng;const shotHp=target.hp;Game.updateTracers3D(.1);const arrivalHp=target.hp;
 // Scatter a finite shell group to expose repeated-mark artifacts at normal zoom.
 const{x,z}=reviewPoint;for(let i=0;i<20;i++)Game.emitWeaponImpact(x+(i%5)*2.4-1+Math.sin(i)*.4,z+Math.floor(i/5)*2.5-5,{kind:'he',scale:.85+(i%3)*.13},0);
 for(let n=0;n<60;n++){Game.updateImpactDebris(.033);Game.updateCraterDeformations(.033);Game.updateSmoke3D(.033);Game.updateScorch3D(.033);Game.syncUnitMeshes(.033);}
 reviewUnits.forEach(u=>u.mesh.visible=true);Game.updateHUD();Game.renderScene();return{damage:hp-shotHp,arrivalDamage:shotHp-arrivalHp,ammoUsed:ammo-shooter.ammo,scars:Game.scorchDecals.length};});
 await page.screenshot({path:`${out}/${version}-battlefield.png`});
 await page.evaluate(()=>{const{x,z}=reviewPoint;Game.emitWeaponImpact(x+2,z,{kind:'he',scale:1.2},0);Game.updateImpactDebris(.06);Game.updateSmoke3D(.06);Game.renderScene();});await page.screenshot({path:`${out}/${version}-contact.png`});
 report.push({version,...result,errors});await page.close();
}fs.writeFileSync(`${out}/comparison.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.some(r=>r.errors.length||r.ammoUsed!==1||r.damage<=0||r.arrivalDamage!==0))process.exitCode=1;
}finally{await browser.close()}

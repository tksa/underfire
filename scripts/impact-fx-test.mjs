/** Impact delivery, surface response and bounded terrain deformation. */
import {chromium} from 'playwright';import fs from 'node:fs';
const out='tmp/impact-review';fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch();const errors=[];
try{const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:8741',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>Game.units?.length,null,{timeout:120000});await page.waitForFunction(()=>document.getElementById('bootLoader')?.style.display==='none',null,{timeout:45000});
await page.locator('#btnEnterGame').click();await page.locator('#btnStartMission').click();
const checks=await page.evaluate(()=>{Game._paused=true;window.requestAnimationFrame=()=>0;const checks=[],check=(name,pass,detail)=>checks.push({name,pass:!!pass,detail}),T=Game.THREE;
const tileAt=Game.getTileAtWorld;Game.getTileAtWorld=()=>({type:'grass'});Game._craterQueue=[];Game.tracers=[];Game.smoke=[];Game._impactDebris=[];
check('machine-gun tank rounds stay small arms',Game.weaponImpactProfile({type:'hmg',heBlast:0}).kind==='bullet');
check('HE size follows blast rather than chassis',Game.weaponImpactProfile({type:'tankgun',heBlast:4}).scale>Game.weaponImpactProfile({type:'tankgun',heBlast:1.5}).scale);
const oldEmit=Game.emitWeaponImpact,oldSpawn=Game.spawnCrater;let impacts=0,craters=0;Game.emitWeaponImpact=(...a)=>{impacts++;oldEmit(...a)};Game.spawnCrater=()=>craters++;
Game.addTracer({x:150,z:150,tx:155,tz:150,y0:1,y1:0,total:1,life:1,preserveFlight:true,big:true,weaponType:'tankgun',impact:{kind:'he',scale:1,angle:0}});
Game.updateTracers3D(.1);check('no contact effect before projectile arrival',impacts===0);Game.updateTracers3D(1);Game.updateTracers3D(1);
check('one shell delivers exactly one impact and crater',impacts===1&&craters===1);Game.emitWeaponImpact=oldEmit;
let before=craters;for(let i=0;i<20;i++)Game.emitWeaponImpact(151,151,{kind:'bullet',scale:.18});check('small arms never deform terrain',craters===before);
Game.emitWeaponImpact(151,151,{kind:'kinetic',scale:.55});check('kinetic impacts leave a gouge without HE excavation',craters===before);
Game.getTileAtWorld=()=>({type:'road'});Game.emitWeaponImpact(152,152,{kind:'he',scale:1});Game.getTileAtWorld=()=>({type:'water'});Game.emitWeaponImpact(152,152,{kind:'he',scale:1});check('road and water impacts do not dig soil',craters===before);
Game.getTileAtWorld=()=>({type:'grass'});Game.spawnCrater=oldSpawn;Game._craterQueue=[];
const geo=Game.terrainMesh.geometry,p=geo.attributes.position,seg=geo.parameters.widthSegments,stride=seg+1,i=Math.floor(geo.parameters.heightSegments/2)*stride+Math.floor(seg/2),x=p.getX(i)+Game.WORLD_W/2,z=p.getZ(i)+Game.WORLD_H/2,y=p.getY(i),sample=Game.getHeight(x,z);
for(let n=0;n<30;n++){Game.spawnCrater(x,z,3,4);Game.updateCraterDeformations(1);}
const depth=y-p.getY(i);check('repeated hits saturate in a shallow bowl',depth>.15&&depth<=.321,{depth});check('unit ground sampling follows deformation',Math.abs((sample-Game.getHeight(x,z))-depth)<.002);
const j=i+5,jy=p.getY(j);Game.spawnCrater(p.getX(j)+Game.WORLD_W/2,p.getZ(j)+Game.WORLD_H/2,.3,2);Game.updateCraterDeformations(1);check('sub-grid impacts cannot make isolated spikes',p.getY(j)===jy);
Game.emitWeaponImpact(x+6,z,{kind:'he',scale:1.4});Game.updateScorch3D(.3);check('persistent scars conform to the sampled surface',Game.scorchDecals.length>0&&Game.scorchDecals.every(s=>{if(!s.mesh)return true;const a=s.mesh.geometry.attributes.position;return Array.from({length:a.count},(_,i)=>i).every(i=>Math.abs(a.getY(i)-Game.getHeight(s.x+a.getX(i),s.z+a.getZ(i))-.018)<.0001)}));
for(let n=0;n<200;n++)Game.emitWeaponImpact(x,z,{kind:'he',scale:1});Game.updateImpactDebris(.05);check('debris uses one bounded instanced mesh',Game._impactDebris.length<=128&&Game._impactDebrisBatch.mesh.count<=128);check('persistent scars remain bounded',Game.scorchDecals.length<=140);check('dust bursts are bounded under heavy fire',Game.smoke.length<=248);
Game.updateImpactDebris(5);check('expired fragments release active slots',!Game._impactDebris.length&&Game._impactDebrisBatch.mesh.count===0);
Game.getTileAtWorld=tileAt;return checks;});
// A clean contact timeline in the real scene, preserving the current lighting.
await page.evaluate(()=>{for(const u of Game.units)u.mesh.visible=false;Game.effectsGroup.clear();Game.smoke=[];Game.muzzleFlashes=[];Game._impactDebris=[];Game.scorchDecals=[];
Game._fogDisabled=true;Game.updateFogOfWar(10);
const p=Game._farmScenery?.find(p=>p.key==='hayrick')||{x:150,z:150};window._impactPoint={x:p.x+7,z:p.z+5};Game.cam.x=_impactPoint.x;Game.cam.z=_impactPoint.z;Game.cam.zoom=Game.cam.targetZoom=9;Game.updateCamera(0);Game.emitWeaponImpact(_impactPoint.x,_impactPoint.z,{kind:'he',scale:1.2},0);});
for(const[t,name]of[[.055,'contact'],[.22,'debris'],[.65,'settling'],[1.4,'scar']]){await page.evaluate(dt=>{Game.updateImpactDebris(dt);Game.updateCraterDeformations(dt);Game.updateSmoke3D(dt);Game.updateScorch3D(dt);Game.renderScene();},t);await page.screenshot({path:`${out}/${name}.png`});}
fs.writeFileSync(`${out}/checks.json`,JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors},null,2));if(errors.length||checks.some(c=>!c.pass))process.exitCode=1;
}finally{await browser.close();}

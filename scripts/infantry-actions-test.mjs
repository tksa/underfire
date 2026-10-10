import { chromium } from 'playwright';
import fs from 'node:fs';
const out = process.argv[2] || 'tmp/actions-review'; fs.mkdirSync(out, {recursive:true});
const browser = await chromium.launch();
try {
    const page = await browser.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(process.env.SMOKE_URL || 'http://127.0.0.1:8741', {waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>Game.units?.length>0);
    await page.evaluate(()=>{
        Game._paused=true; window.requestAnimationFrame=()=>0;
        for(const u of Game.units){u.alive=false;u.mesh.visible=false;} Game.units=[]; Game.gameClock=100;
        Game.setPatch(55,55,42,42,'grass');
        window.actor=Game.makeUnit('german','grenadier',220,230,{aiState:'player'});
        window.target=Game.makeUnit('french','fusilier',240,230,{aiState:'player'}); target.hp=100000;
        window.officers=['french','german','polish'].map(t=>Game.makeUnit(t,'officer',220,240,{aiState:'player'}));
        window.supports=['medic','mechanic'].map(k=>Game.makeUnit('german',k,220,230,{aiState:'player'}));
        window.heavyMG=Game.makeUnit('german','hmg',230,260,{aiState:'player'});
        window.damaged=Game.makeUnit('german','panzer2',221,230,{aiState:'player'});
        window.mortars=[['french','mortar_60'],['german','mortar_50'],['polish','mortar81']].map(([t,k])=>Game.makeUnit(t,k,220,250,{aiState:'player'}));
    });
    await page.waitForFunction(()=>[actor,...officers,...supports].every(u=>u.mesh.userData.isSoldier)&&heavyMG.mesh.userData.fieldGunCrew?.userData.crewMode==='soldier'&&mortars.every(u=>u.mesh.userData.fieldGunCrew?.userData.crewMode==='soldier'),null,{timeout:120000});
    const result=await page.evaluate(()=>{
        const T=Game.THREE,checks=[]; const check=(name,pass,detail)=>checks.push({name,pass:!!pass,detail});
        actor.ammo=12; actor._magazineWeapon=null; Game.ensureMagazine(actor);
        check('rifle starts with five loaded rounds and total stock unchanged',actor.magazineAmmo===5&&actor.ammo===12);
        for(let i=0;i<5;i++) Game.applyShot(actor,target);
        const serial=actor._shotSerial;
        Game.applyShot(actor,target); Game.fireAtGround(actor,target.x,target.z,Game.WEAPONS[actor.weaponKey]);
        Game.fireSupportingRound(actor,{bearing:0});
        check('all three firing paths obey the empty magazine',actor.magazineAmmo===0&&actor.ammo===7&&actor._shotSerial===serial);
        Game.updateMagazine(actor,0.1); const reload=actor._reload;
        check('empty magazine begins a timed reload',reload&&reload.elapsed<reload.duration);
        Game._updateModelAnimation(actor,0.1);
        check('reload has a visible animation',actor.mesh.userData._activeClip==='reload_stand');
        actor.moving=true;actor.path=[{x:250,z:230}]; Game.updateMagazine(actor,10);
        check('movement interrupts reload without creating ammunition',!actor._reload&&actor.ammo===7&&actor.magazineAmmo===0);
        actor.moving=false;actor.path=[];Game.updateMagazine(actor,0.1);
        const elapsed=actor._reload.elapsed;Game._updateModelAnimation(actor,2);
        check('rendering cannot complete a simulation reload',actor._reload.elapsed===elapsed&&actor.magazineAmmo===0);
        Game.updateMagazine(actor,5);
        check('reload transfers five rounds without adding stock',!actor._reload&&actor.magazineAmmo===5&&actor.ammo===7);
        for(let i=0;i<5;i++)Game.consumeWeaponRound(actor);Game.updateMagazine(actor,5);
        check('partial reserve loads only remaining rounds',actor.magazineAmmo===2&&actor.ammo===2);
        Game.consumeWeaponRound(actor);Game.consumeWeaponRound(actor);Game.updateMagazine(actor,5);
        check('exhausted stock cannot reload',actor.ammo===0&&actor.magazineAmmo===0&&!actor._reload);
        actor.ammo=3;Game.updateMagazine(actor,0.1);
        check('resupply requires a new reload',actor._reload&&actor.magazineAmmo===0);
        Game.updateMagazine(actor,5);
        actor.ammo=-1;actor._magazineWeapon=null;Game.ensureMagazine(actor);
        for(let i=0;i<5;i++)Game.consumeWeaponRound(actor);Game.updateMagazine(actor,5);
        check('unlimited reserve still respects magazine changes',actor.ammo===-1&&actor.magazineAmmo===5);
        actor.ammo=30;actor._reload=null;actor._infantryAction=null;actor.holdFire=false;actor.stance='stand';actor.angle=0;
        actor._grenades=2; Game.syncWeaponTransform(actor);const before=Game.thrownGrenades.length;
        Game.throwGrenade(actor,actor.x+6,actor.z);
        check('throw begins without spawning or spending the grenade',Game.thrownGrenades.length===before&&actor._grenades===2&&actor._infantryAction);
        Game.updateInfantryActions(actor,0.1);Game._updateModelAnimation(actor,0.1);
        check('throw action blocks gunfire and plays authored motion',!Game.weaponCanDischarge(actor)&&actor.mesh.userData._activeClip==='throw_stand');
        actor.moving=true;actor.path=[{x:245,z:230}];Game.updateInfantryActions(actor,1);
        check('new movement cancels the windup and preserves the grenade',!actor._infantryAction&&actor._grenades===2&&Game.thrownGrenades.length===before);
        actor.moving=false;actor.path=[];Game.throwGrenade(actor,actor.x+6,actor.z);
        for(let i=0;i<60;i++){Game.gameClock+=1/30;Game.updateInfantryActions(actor,1/30);Game._updateModelAnimation(actor,1/30);}
        check('release spends and spawns exactly once',actor._grenades===1&&Game.thrownGrenades.length===before+1&&!actor._infantryAction);
        const g=Game.thrownGrenades.at(-1);check('grenade starts at hand height',Number.isFinite(g.y0)&&g.y0>actor.y+0.25);
        actor.stance='prone';Game.updateInfantryGetUp(actor);actor.stance='stand';actor.path=[{x:245,z:230}];Game.updateInfantryGetUp(actor);
        Game.uMod.move(actor,{dt:0.1});Game._updateModelAnimation(actor,0.1);
        check('get-up plays before moving, preserving the route',actor._infantryAction?.kind==='getup'&&actor.mesh.userData._activeClip==='getup_stand'&&actor._dispSpeed===0&&actor.path.length===1);
        actor.thinking=0;const rise=actor._infantryAction,route=actor.path;
        Game.updateAI(actor,.5,target);
        check('AI does not replace a get-up action or its route',actor._infantryAction===rise&&actor.path===route);
        Game.updateInfantryActions(actor,2);check('get-up finishes on simulation time',!actor._infantryAction);
        actor._actionPosture='prone';actor.stance='stand';Game.updateInfantryGetUp(actor);actor.stance='prone';Game.updateInfantryActions(actor,.1);
        check('renewed need for cover interrupts getting up',!actor._infantryAction);
        actor.stance='stand';actor._grenadeChargeId=target.id;actor.forcedTargetId=target.id;actor._atGrenades=0;
        Game.uMod.engage(actor,{enemy:target,dt:.1});
        check('empty grenade pockets end the close assault order',actor._grenadeChargeId==null&&actor.forcedTargetId==null);
        heavyMG._dispSpeed=heavyMG.currentSpeed=0;heavyMG.moving=false;heavyMG.path=[];
        Game.ensureMagazine(heavyMG);heavyMG.magazineAmmo=0;Game.updateMagazine(heavyMG,2.5);
        Game.updateFieldGunCrew(heavyMG,.1);
        const loader=heavyMG.mesh.userData.fieldGunCrew.userData.figures.find(f=>f.userData.fieldGunRole==='mg_loader');
        check('HMG loader follows the real magazine change',heavyMG._reload&&loader.userData.actions.load.getEffectiveWeight()>.8);
        heavyMG._reload=null;heavyMG._lastShotAt=Game.gameClock;heavyMG._shotAge=.5;Game.updateFieldGunCrew(heavyMG,.1);
        check('ordinary HMG shots do not replay a belt change',!loader.userData.actions.load.isRunning());

        const [medic,mechanic]=supports;
        actor.path=[];actor.moving=false;actor._dispSpeed=actor.currentSpeed=0;actor.hp=actor.maxHp-20;
        medic.angle=0;medic.holdFire=true;
        const hp=actor.hp;Game.updateSupportUnits(3);
        check('medic begins work without instantly healing',medic._infantryAction?.work==='treat'&&actor.hp===hp);
        Game.updateInfantryActions(medic,.4);Game._updateModelAnimation(medic,.1);
        check('medic kneels to treat a nearby casualty',medic.mesh.userData._activeClip==='treat');
        Game._updateModelAnimation(medic,10);check('rendering cannot finish treatment',actor.hp===hp);
        actor.moving=true;Game.updateInfantryActions(medic,4);
        check('patient movement interrupts treatment without healing',!medic._infantryAction&&actor.hp===hp);
        actor.moving=false;Game.beginSupportAction(medic,actor,'treat');Game.updateInfantryActions(medic,4);
        check('completed treatment applies once',actor.hp===hp+8);Game.updateInfantryActions(medic,4);
        check('finished treatment cannot repeat without a new action',actor.hp===hp+8);
        damaged.hp=damaged.maxHp-30;damaged.tracksDisabled=true;damaged.engineDamaged=true;mechanic.angle=0;
        mechanic.x=damaged.x-2;mechanic.z=damaged.z;mechanic._infantryAction=null;Game.beginSupportAction(mechanic,damaged,'repair');Game.updateInfantryActions(mechanic,.3);Game._updateModelAnimation(mechanic,.1);
        check('mechanic uses repair animation',mechanic.mesh.userData._activeClip==='repair',{state:mechanic._infantryAction,clip:mechanic.mesh.userData._activeClip,moving:mechanic.moving,path:mechanic.path,targetMoving:damaged.moving,distance:Game.dist(mechanic.x,mechanic.z,damaged.x,damaged.z),size:damaged.size});
        Game.updateInfantryActions(mechanic,5);
        check('repair fixes tracks before hull and preserves remaining engine fault',!damaged.tracksDisabled&&damaged.engineDamaged&&damaged.hp===damaged.maxHp-30);
        Game.beginSupportAction(mechanic,damaged,'repair');mechanic.moving=true;Game.updateInfantryActions(mechanic,5);
        check('new mechanic movement interrupts repair',!mechanic._infantryAction&&damaged.engineDamaged);mechanic.moving=false;
        Game.beginSupportAction(mechanic,damaged,'repair');Game.updateInfantryActions(mechanic,5);
        check('next complete job repairs engine',!damaged.engineDamaged);
        damaged.alive=false;
        for(const u of officers){
            const d=u.mesh.userData;check(`${u.team}: officer has a pistol`,['luger','ruby','vis'].includes(d.soldierModel.userData.infantryWeapon));
            u._dispSpeed=u.currentSpeed=0;u.fireTargetId=999;u.ammo=30;
            for(let i=0;i<60;i++){Game.gameClock+=1/30;Game._updateModelAnimation(u,1/30);}
            Game.syncWeaponTransform(u);const bore=Game.getWeaponMuzzle(u);
            check(`${u.team}: pistol bore follows aim`,bore.direction.dot(new T.Vector3(Math.cos(u.angle),0,Math.sin(u.angle)))>.97,bore.direction.toArray());
            check(`${u.team}: pistol uses a dedicated aiming clip`,d.actions.aim_stand.getClip().tracks.length>0&&d.soldierModel.getObjectByName('equipment_'+d.soldierModel.userData.infantryWeapon).visible);
        }
        for(const u of mortars){
            const d=u.mesh.userData;check(`${u.team}: mortar has two animated crew`,d.fieldGunCrew.userData.figures.length===2&&d.fieldGunCrew.userData.figures.every(f=>f.userData.actions.load));
            Game.bindWeaponMuzzles(u);Game.syncWeaponTransform(u);const muzzle=Game.getWeaponMuzzle(u);
            check(`${u.team}: mortar muzzle is on the upward tube`,!muzzle.fallback&&muzzle.direction.y>0.75);
            u._shotAge=0.9;u._dispSpeed=0;u._canMove=true;Game.updateFieldGunCrew(u,0.1);
            check(`${u.team}: loading round appears during the cycle`,d.mortar.shell.visible);
            u._dispSpeed=1.2;for(let i=0;i<45;i++)Game.updateFieldGunCrew(u,1/30);
            check(`${u.team}: mortar folds and is carried during travel`,d.mortar.carry>0.9&&d.mortar.bipod.scale.x<0.5&&!d.mortar.shell.visible);
            u._towed=true;Game.updateFieldGunCrew(u,0.1);check(`${u.team}: transported mortar crew hides`,!d.fieldGunCrew.visible);u._towed=false;
        }
        const scene=new T.Scene();scene.background=new T.Color(0x29303a);scene.add(new T.HemisphereLight(0xeef3ff,0x675846,2));
        const sun=new T.DirectionalLight(0xffffff,3);sun.position.set(3,5,4);scene.add(sun);
        const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1200,900);renderer.setScissorTest(true);
        const camera=new T.PerspectiveCamera(35,4/3,.01,30);camera.position.set(2.2,1.5,3.2);camera.lookAt(0,.6,0);
        const samples=[...officers,...mortars,...['throw_stand','reload_prone','getup_stand'],...['treat','repair','throw_prone']];
        renderer.setSize(1200,1200);
        for(let i=0;i<samples.length;i++){
            let u=samples[i];if(typeof u==='string'){
                const name=u;u=name==='treat'?medic:name==='repair'?mechanic:actor;
                u._reload=null;u._infantryAction=null;u.path=[];u.moving=false;u._dispSpeed=u.currentSpeed=0;u.ammo=30;
                u.stance=name.includes('prone')?'prone':'stand';
                if(name.startsWith('reload'))u._reload={elapsed:.55,duration:1,stance:u.stance};
                else u._infantryAction={kind:name.startsWith('throw')?'grenade':name.startsWith('getup')?'getup':'support',clip:name,elapsed:.55,duration:1};
                u.mesh.userData.mixer.stopAllAction();u.mesh.userData._activeClip=null;
                for(let j=0;j<15;j++)Game._updateModelAnimation(u,1/30);
            }else if(u.kind.startsWith('mortar')){u._dispSpeed=u.currentSpeed=0;u._shotAge=1.1;for(let j=0;j<45;j++)Game.updateFieldGunCrew(u,1/30);}
            scene.add(u.mesh);u.mesh.position.set(0,0,0);u.mesh.rotation.y=0;u.mesh.visible=true;scene.updateMatrixWorld(true);
            renderer.setViewport(i%3*400,(3-Math.floor(i/3))*300,400,300);renderer.setScissor(i%3*400,(3-Math.floor(i/3))*300,400,300);renderer.render(scene,camera);scene.remove(u.mesh);
        }
        return {checks,png:renderer.domElement.toDataURL('image/png')};
    });
    fs.writeFileSync(`${out}/actions.png`,Buffer.from(result.png.split(',')[1],'base64'));delete result.png;
    fs.writeFileSync(`${out}/actions.json`,JSON.stringify({...result,errors},null,2));
    const failures=result.checks.filter(c=>!c.pass);console.log(JSON.stringify({checks:result.checks.length,failures,errors},null,2));
    if(failures.length||errors.length)process.exitCode=1;
} finally {await browser.close();}

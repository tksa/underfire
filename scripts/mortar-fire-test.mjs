import { chromium } from 'playwright';
const browser=await chromium.launch(); const errors=[];
try {
    const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(process.env.SMOKE_URL||'http://127.0.0.1:8741',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>Game.units?.length,null,{timeout:120000});
    const checks=await page.evaluate(()=>{
        Game._paused=true;window.requestAnimationFrame=()=>0;Game.units=[];Game.selection.clear();
        Game.setPatch(20,20,110,110,'grass');Game.getHeight=()=>0;Game.gameClock=100;
        Game.playerTeam='german';Game.isFogVisible=()=>false;Game.indirectShells=[];
        const results=[],check=(name,pass,detail)=>results.push({name,pass:!!pass,detail});
        let seed=541;const random=Math.random;Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
        const make=(mode='ranged',xp=0)=>{
            const u=Game.makeUnit('german','mortar_50',160,200,{aiState:'player',angle:0,veterancy:0});
            Object.assign(u,{experience:xp,mortarFireMode:mode,ammo:100,_combatReady:true,cooldownLeft:0,orderDelay:0,suppressionValue:0});
            Game.selection.clear();Game.selection.add(u.id);Game.orderAttackGround(220,200,{radius:10,mode});u.orderDelay=0;
            return u;
        };
        const tick=(u,seconds)=>{for(let n=0;n<seconds*30;n++){Game.gameClock+=1/30;Game.updateUnit(u,1/30);}};
        const first=(u)=>{let t=0;while(!u._shotSerial&&t<12){tick(u,1/30);t+=1/30;}return t;};
        try{
            const ranged=make(),rangedTime=first(ranged);
            check('ground order fires without enemy LOS or map visibility',ranged._shotSerial===1 && !ranged._mortarMission.observed);
            check('ranged fire spends time sighting',rangedTime>=5.4&&rangedTime<7,rangedTime);
            check('one actual shell consumes one round',ranged.ammo===99&&Game.indirectShells.length===1);
            const arc=Game.tracers.find(t=>t.mortar),shellVisual=Game.indirectShells[0];
            check('mortar visual follows a rising arc through the shell flight',arc?.arc>0
                && Math.abs(arc.life-shellVisual.t)<.01 && Number.isFinite(arc.x));
            check('ground order keeps the crew in position',ranged.x===160&&ranged.z===200&&!ranged.path.length);
            const rapid=make('rapid'),rapidTime=first(rapid);
            check('rapid fire starts promptly after laying',rapidTime<1.5&&rapidTime<rangedTime/3,rapidTime);
            const veteran=make('ranged',100),vetTime=first(veteran);
            check('experienced crews sight faster',vetTime<rangedTime*.75,vetTime);
            check('HUD describes bombardment rather than endless deployment',/fire/.test(Game.mortarStatus(veteran)));
            const mission=ranged._mortarMission;
            const samples=Array.from({length:200},()=>Game.mortarImpactPoint(ranged,220,200));
            check('rounds cover a region rather than one point',Math.max(...samples.map(s=>s.x))-Math.min(...samples.map(s=>s.x))>15);
            const initial=samples[0].error;
            const shell={shooterId:ranged.id,mission:mission.serial,sx:220,sz:200};
            Game.observeMortarImpact(shell);
            check('unobserved impacts grant no correction or XP',mission.correction===0&&ranged.experience===0);
            const observer=Game.makeUnit('german','grenadier',222,203,{aiState:'player'});observer.sight=30;
            Game.observeMortarImpact(shell);
            const rookieCorrection=mission.correction;
            Game.observeMortarImpact({shooterId:veteran.id,mission:veteran._mortarMission.serial,sx:220,sz:200});
            check('experienced crews correct more per observed impact',veteran._mortarMission.correction>rookieCorrection);
            for(let i=0;i<5;i++)Game.observeMortarImpact(shell);
            check('observed ranging tightens error and earns experience',Game.mortarImpactPoint(ranged,220,200).error<initial*.5&&ranged.experience>0);
            const old=mission.serial;Game.selection.clear();Game.selection.add(ranged.id);Game.orderAttackGround(235,210,{radius:6});ranged.orderDelay=0;
            Game.observeMortarImpact(shell);
            check('retargeting resets the solution and old shells cannot correct it',ranged._mortarMission.serial!==old&&ranged._mortarMission.correction===0);
            const before=ranged.ammo;ranged.holdFire=true;tick(ranged,8);
            check('hold fire prevents bombardment',ranged.ammo===before);
            ranged.holdFire=false;ranged._unmanned=true;tick(ranged,8);
            check('unmanned mortar cannot fire',ranged.ammo===before);
            ranged._unmanned=false;Game.orderAttackGround(165,200);ranged.orderDelay=0;tick(ranged,1);
            check('minimum range rejects unsafe close targeting',ranged.bombardX==null&&ranged.ammo===before);
            Game.orderAttackGround(235,210);ranged.orderDelay=0;
            Game.issueCommand(180,205,'move',[ranged]);
            check('move order cancels bombardment',ranged.bombardX==null&&!ranged._bombarding);
            const cached=ranged._mortarMission; ranged.x+=5;
            check('relocation invalidates the old range solution',Game.ensureMortarMission(ranged,235,210)!==cached);
            Game.selection.clear();Game.selection.add(rapid.id);Game.toggleMortarFireMode();
            check('fire-method control changes selected mortar mode',rapid.mortarFireMode==='ranged');
            Game.updateHUD();
            check('mortar method control is visible for mortar selection',document.getElementById('cmdMortarMethod').style.display!=='none');
            return results;
        }finally{Math.random=random;}
    });
    for(const c of checks)console.log(`${c.pass?'PASS':'FAIL'} ${c.name}${c.detail!=null?': '+c.detail:''}`);
    if(errors.length||checks.some(c=>!c.pass))process.exitCode=1;
    console.log(JSON.stringify({checks:checks.length,errors}));
}catch(e){console.error(errors);throw e;}finally{await browser.close();}

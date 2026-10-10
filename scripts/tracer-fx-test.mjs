/** Visual projectile batching must not alter combat randomness or lose impacts. */
import { chromium } from 'playwright';
import fs from 'node:fs';
const out = process.argv[2] || 'tmp/tracer-fx'; fs.mkdirSync(out, {recursive:true});
const browser = await chromium.launch(); const errors = [];
try {
    const page = await browser.newPage({viewport:{width:1200,height:800}});
    page.on('pageerror', e=>errors.push(e.message));
    page.on('console', m=>{if(m.type()==='error' && /shader|WebGL|GLSL/i.test(m.text())) errors.push(m.text());});
    await page.goto(process.env.SMOKE_URL||'http://127.0.0.1:8741',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>Game.units?.length,null,{timeout:120000});
    const result = await page.evaluate(()=>{
        Game._paused=true; window.requestAnimationFrame=()=>0;
        const T=Game.THREE, checks=[], check=(name,pass,detail)=>checks.push({name,pass:!!pass,detail});
        const shot=(extra={})=>({x:-30,z:0,tx:30,tz:0,y0:1,y1:1,life:.5,total:.5,weaponType:'rifle',...extra});
        let rngCalls=0; const rng=Math.random; Math.random=()=>{rngCalls++;return .5;};
        const samples=Array.from({length:1000},()=>Game.prepareTracer(shot()));Math.random=rng;
        check('visual choices never consume combat RNG',rngCalls===0);
        const bright=samples.filter(t=>t.visual.bright),hidden=samples.filter(t=>!t.visual.opacity);
        check('bright rifle tracers are occasional; ordinary rounds often invisible',bright.length>60&&bright.length<160&&hidden.length>350, {bright:bright.length,hidden:hidden.length});
        check('short glints keep a world-length limit over long ranges', samples.every(t=>t.visual.length<=1.45) && Game.prepareTracer(shot({tx:1200})).visual.length<=1.45);
        check('rifle glimpses cover 60 world units in under 65ms',samples.every(t=>t.total<.065));
        check('bright shots vary in color and intensity',new Set(bright.map(t=>t.visual.color)).size===4 && Math.max(...bright.map(t=>t.visual.opacity))-Math.min(...bright.map(t=>t.visual.opacity))>.3);
        const mortar=Game.prepareTracer(shot({mortar:true,life:3,total:3,arc:15}));
        check('mortar retains its actual shell flight and arc',mortar.life===3&&mortar.total===3&&mortar.arc===15);
        const scene=new T.Scene(); scene.background=new T.Color(0x26302b);
        Game.effectsGroup=new T.Group();scene.add(Game.effectsGroup);Game._tracerBatch=null;
        Game.camera=new T.OrthographicCamera(-40,40,26.666,-26.666,.1,100);Game.camera.position.set(0,60,0);Game.camera.up.set(0,0,-1);Game.camera.lookAt(0,0,0);Game.camera.updateMatrixWorld();Game.viewH=800;
        Game.tracers=[];
        const visible=samples.find(t=>t.visual.bright);
        Game.addTracer({...visible,visual:{...visible.visual},life:visible.total*.5});Game.updateTracers3D(0);
        const batch=Game._tracerBatch, matrix=new T.Matrix4();batch.mesh.getMatrixAt(0,matrix);
        check('one ribbon is fixed length and camera-facing',Math.abs(new T.Vector3().setFromMatrixColumn(matrix,0).length()-visible.visual.length)<1e-4 && batch.mesh.count===1);
        const target=new T.WebGLRenderTarget(1200,800);Game.renderer.setRenderTarget(target);Game.renderer.render(scene,Game.camera);
        const pixels=new Uint8Array(1200*800*4);Game.renderer.readRenderTargetPixels(target,0,0,1200,800,pixels);
        const bg=[...pixels.slice(0,3)];let different=0;for(let i=0;i<pixels.length;i+=4)if(Math.abs(pixels[i]-bg[0])+Math.abs(pixels[i+1]-bg[1])+Math.abs(pixels[i+2]-bg[2])>3)different++;
        check('ribbon shader draws a short visible glint',different>0&&different<120,{pixels:different});
        Game.renderer.setRenderTarget(null);target.dispose();
        const oldCrater=Game.spawnCrater;let impacts=0;Game.spawnCrater=()=>impacts++;
        Game.tracers=[];
        for(let i=0;i<300;i++)Game.addTracer(shot({visual:{...visible.visual},life:1,total:1,terrainDamage:1}));
        Game.updateTracers3D(.5);
        check('heavy fire uses one persistent instanced draw with a bounded capacity',Game._tracerBatch===batch&&batch.mesh.count===256&&Game.tracers.length===300&&Game.effectsGroup.children.length===1);
        Game.updateTracers3D(.6);
        check('all impacts survive visual overflow exactly once',impacts===300&&Game.tracers.length===0&&!batch.mesh.visible);
        Game.updateTracers3D(1);check('expired shots cannot repeat impacts',impacts===300);Game.spawnCrater=oldCrater;
        Game.tracers=[];
        for(let i=0;i<40;i++){const t=Game.prepareTracer(shot({z:-22+i*1.1,tz:-22+i*1.1}));t.life=t.total*(.15+(i%7)*.1);Game.tracers.push(t);}
        Game.updateTracers3D(0);Game.renderer.setPixelRatio(1);Game.renderer.setSize(1200,800);Game.renderer.render(scene,Game.camera);
        document.body.appendChild(Game.renderer.domElement);Game.renderer.domElement.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:2147483647';
        return checks;
    });
    await page.screenshot({path:`${out}/glimpses.png`});
    result.push({name:'no runtime or shader errors',pass:!errors.length,detail:errors});
    fs.writeFileSync(`${out}/checks.json`,JSON.stringify(result,null,2));
    for(const c of result)console.log(`${c.pass?'PASS':'FAIL'} ${c.name}`,c.detail??'');
    if(result.some(c=>!c.pass))process.exitCode=1;
}finally{await browser.close();}

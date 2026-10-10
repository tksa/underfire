/** Render new core-roster assets in deployed/loading/travel poses for review. */
import { chromium } from 'playwright';
import fs from 'node:fs';
const out = process.argv[2] || 'tmp/model-gallery';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const rows = [];
try {
    await page.goto(process.env.SMOKE_URL || 'http://localhost:8741', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Game?.units?.length, null, { timeout: 120000 });
    const entries = await page.evaluate(() => {
        Game._paused = true; window.requestAnimationFrame = () => 0;
        for (const u of Game.units) u.mesh.removeFromParent();
        Game.units = [];
        const defs = { german: ['panzer1','panzer2','panzer3','panzer4','sdkfz','pak36','supply_truck','fuel_truck','mortar_50','mortar_81'],
            polish: ['7tp','tks','wz34','bofors37','supply_truck','transport_truck','mortar46','mortar81'], french: ['r35','h35','s35','b1','panhard','supply_truck','hmg','mortar_60','mortar_81'] };
        window.galleryUnits = [];
        for (const [team,kinds] of Object.entries(defs)) for (const kind of kinds) {
            const u = Game.makeUnit(team,kind,100,100,{aiState:'player',angle:Math.PI/2});
            u.holdFire = true; galleryUnits.push(u);
        }
        return galleryUnits.map(u => ({key:u.statKey,label:u.label,mortar:u.kind.startsWith('mortar')}));
    });
    await page.waitForFunction(() => galleryUnits.every(u => u.mesh.userData.modelPath &&
        (!Game.GUN_CREWS[u.kind] || u.mesh.userData.fieldGunCrew?.userData.crewMode==='soldier')),
    null,{timeout:120000,polling:250});
    await page.evaluate(() => {
        const T=Game.THREE;
        window.galleryScene=new T.Scene(); galleryScene.background=new T.Color(0x343d3b);
        galleryScene.add(new T.HemisphereLight(0xe3eafa,0x737664,2.2));
        const light=new T.DirectionalLight(0xffedd2,3);light.position.set(-4,8,5);galleryScene.add(light);
        const floor=new T.Mesh(new T.PlaneGeometry(40,40),new T.MeshStandardMaterial({color:0x555f53,roughness:1}));
        floor.rotation.x=-Math.PI/2;floor.position.y=-.02;galleryScene.add(floor);
        window.galleryCamera=new T.OrthographicCamera(-2,2,1.5,-1.5,.1,70);
        const canvas=Game.renderer.domElement;document.body.replaceChildren(canvas);
        canvas.style.cssText='position:fixed;inset:0;width:100%;height:100%';
        Game.renderer.setPixelRatio(1);Game.renderer.setSize(800,600);
    });
    for(let i=0;i<entries.length;i++) for(const pose of entries[i].mortar?['ready','loading','carrying']:['ready','turning']){
        await page.evaluate(({i,pose}) => {
            const T=Game.THREE;
            for(const u of galleryUnits)u.mesh.removeFromParent();
            const u=galleryUnits[i],ud=u.mesh.userData;
            galleryScene.add(u.mesh);u.x=u.y=u.z=0;u.angle=Math.PI/2;u.turretAngle=u.angle+(pose==='turning'?Math.PI/3:0);
            u.mesh.position.set(0,0,0);u.mesh.rotation.set(0,0,0);u.mesh.visible=true;
            ud.selectionRing.visible=ud.healthBar.visible=false;
            const moving=pose==='carrying'; u._dispSpeed=u.currentSpeed=moving?1.5:0;
            u.deployed=!moving;u._towed=false;u._unmanned=false;
            for(let frame=0;frame<70;frame++){
                Game.gameClock+=1/30;
                u._lastShotAt=0;u._shotAge=pose==='loading'?.25+Game.crewLoadDuration(u)*.45:100;
                if(Game.GUN_CREWS[u.kind])Game.updateFieldGunCrew(u,1/30);
                if(ud.vehicleRig){u._truckSteer=pose==='turning'?.4:0;Game.updateVehicleModel(u,1/30);}
            }
            Game.syncWeaponTransform(u);
            const b=new T.Box3().setFromObject(ud.modelWrapper);
            if(ud.fieldGunCrew)b.union(new T.Box3().setFromObject(ud.fieldGunCrew));
            const size=b.getSize(new T.Vector3()),center=b.getCenter(new T.Vector3());
            const span=Math.max(size.x,size.z,size.y*1.4)*.81;
            galleryCamera.left=-span;galleryCamera.right=span;galleryCamera.top=span*.75;galleryCamera.bottom=-span*.75;
            galleryCamera.position.copy(center).add(new T.Vector3(4,4.0,7).normalize().multiplyScalar(10));
            galleryCamera.lookAt(center);galleryCamera.updateProjectionMatrix();
            Game.renderer.render(galleryScene,galleryCamera);
        },{i,pose});
        const file=`${entries[i].key}-${pose}.png`;
        await page.screenshot({path:`${out}/${file}`}); rows.push({...entries[i],pose,file});
    }
    const cards=rows.map(r=>`<figure><img loading="lazy" src="${r.file}" alt="${r.label} ${r.pose}"><figcaption>${r.label}<small>${r.pose}</small></figcaption></figure>`).join('');
    fs.writeFileSync(`${out}/index.html`,`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Under Fire · Unit models</title><style>body{margin:0;padding:32px;background:#1e2926;color:#e5e7d8;font:16px system-ui}h1{font-size:26px;margin:0 0 8px}p{color:#b6c1b3;margin:0 0 28px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px}figure{margin:0;background:#343d3b;border-radius:10px;overflow:hidden}img{display:block;width:100%}figcaption{padding:12px 18px}small{display:block;color:#b6c1b3;margin-top:4px}</style><h1>Under Fire · Unit models</h1><p>${entries.length} configurations · faction paint, weapon handling, crew loading and travel poses</p><main>${cards}</main>`);
    console.log(`Saved ${rows.length} views to ${out}/index.html`);
}finally{await browser.close();}

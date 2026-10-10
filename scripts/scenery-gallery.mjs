/** Render imported static scenery at the infantry scale, without a second game loop. */
import {chromium} from 'playwright';import fs from 'node:fs';
const out=process.argv[2]||'tmp/scenery-gallery';fs.mkdirSync(out,{recursive:true});
const entries=JSON.parse(fs.readFileSync('models/scenery/conversion-report.json')).filter(r=>!r.error);
const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:720,height:540}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:8741',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>Game.units?.length,null,{timeout:120000});
 await page.waitForFunction(()=>document.getElementById('bootLoader')?.style.display==='none',null,{timeout:45000});
 await page.evaluate(()=>{Game._paused=true;window.requestAnimationFrame=()=>0;});
 await page.evaluate(async entries=>{
  const T=Game.THREE;window._scenerySources=await Promise.all(entries.map(e=>Game.loadModel('models/scenery/'+e.name+'.glb')));
  window._sceneryScene=new T.Scene();_sceneryScene.background=new T.Color(0x343d38);_sceneryScene.add(new T.HemisphereLight(0xe3eafa,0x66685b,2.2));const sun=new T.DirectionalLight(0xffefdc,3);sun.position.set(-5,8,5);_sceneryScene.add(sun);
  const floor=new T.Mesh(new T.PlaneGeometry(100,100),new T.MeshStandardMaterial({color:0x616b54,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.03;_sceneryScene.add(floor);
  window._sceneryCamera=new T.OrthographicCamera(-5,5,3.75,-3.75,.1,120);Game.renderer.setPixelRatio(1);Game.renderer.setSize(720,540);
  const c=Game.renderer.domElement; document.body.appendChild(c); c.style.cssText='position:fixed;inset:0;width:100%;height:100%;z-index:2147483647';
 },entries);
 for(let i=0;i<entries.length;i++){
  await page.evaluate(i=>{
   const T=Game.THREE;for(const m of _scenerySources)m.removeFromParent();const m=_scenerySources[i];m.scale.setScalar(Game.SOLDIER_HEIGHT/1.75);_sceneryScene.add(m);
   const box=new T.Box3().setFromObject(m),size=box.getSize(new T.Vector3()),center=box.getCenter(new T.Vector3());const span=Math.max(size.x,size.z,size.y*1.3)*.8;
   Object.assign(_sceneryCamera,{left:-span,right:span,top:span*.75,bottom:-span*.75});_sceneryCamera.position.copy(center).add(new T.Vector3(5,4.5,7).normalize().multiplyScalar(25));_sceneryCamera.lookAt(center);_sceneryCamera.updateProjectionMatrix();Game.renderer.render(_sceneryScene,_sceneryCamera);
  },i);await page.screenshot({path:`${out}/${entries[i].name}.png`});
 }
 fs.writeFileSync(`${out}/index.html`,`<!doctype html><meta charset="utf-8"><title>Under Fire · Farm scenery</title><style>body{background:#1d2520;color:#e4e5d7;font:15px system-ui;margin:28px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:16px}figure{margin:0;background:#303c31;padding:12px;border:1px solid #617059}img{width:100%}figcaption{padding-top:8px}small{color:#adbca4}</style><h1>Farm scenery</h1><p>Recovered MOW assets, original materials, measured proportions. One shared scale with infantry.</p><main>${entries.map(e=>`<figure><img src="${e.name}.png"><figcaption>${e.name.replaceAll('_',' ')}<br><small>${e.triangles} triangles · ${e.materials} materials</small></figcaption></figure>`).join('')}</main>`);
 console.log(JSON.stringify({models:entries.length,errors}));if(errors.length)process.exitCode=1;
}finally{await browser.close();}

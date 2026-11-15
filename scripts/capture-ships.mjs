// Planche graphique synthétique : suivis / estimés, caps N/E/S/O et navire arrêté.
// Build web servi localement. CHROMIUM_PATH, VACARME_URL et CAPTURE_DIR sont configurables.
// Taille multipliée par trois pour examiner les détails ; aucune donnée AIS réelle.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
import { mkdirSync } from 'node:fs';
const out=process.env.CAPTURE_DIR ?? '/tmp/navires';
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--enable-gpu','--ignore-gpu-blocklist','--use-angle=vulkan','--enable-features=Vulkan']});
const errors=[];
try {
 const page=await browser.newPage({viewport:{width:1000,height:540}});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('404')&&!m.text().includes('GPU stall'))errors.push(m.text());});
 await page.goto(`${process.env.VACARME_URL ?? 'http://127.0.0.1:8765/'}?quality=expo`);
 await page.waitForFunction(()=>window.vacarme?.ships.shipCount>0&&window.vacarme.warmupLeft===0,null,{timeout:120000});
 await page.evaluate(()=>{
  const a=window.vacarme;
  a.frame=()=>{}; a.local.worker.terminate(); a.cfg.audio.enabled=false;
  for(const el of document.body.children)if(el!==a.renderer.domElement)el.style.display='none';
 });
 for(const [name,scale,theme] of [['navires-proches-jour',120,'day'],['navires-proches-nuit',120,'night'],['navires-globaux-jour',3,'day']]){
  await page.evaluate(({scale,theme})=>{
   const a=window.vacarme,r=a.renderer;
   a.cfg.display.theme=theme; a.cfg.scenario='actuel'; a.cfg.ships.visible=true;
   // Échantillon graphique synthétique : deux rangées (suivis puis estimés), caps N/E/S/O, puis navire arrêté.
   const n=10,buf=new ArrayBuffer(24+40*n),v=new DataView(buf);
   for(let i=0;i<n;i++){
    const o=24+40*i,col=i%5,row=Math.floor(i/5);
    v.setUint32(o,i+1,true); v.setFloat32(o+4,(row? -80:80)/scale,true); v.setFloat32(o+8,(col-2)*170/scale,true);
    v.setFloat32(o+12,col===4?0:12,true); v.setFloat32(o+16,col*90,true); v.setUint8(o+21,row?4:0);
    v.setFloat32(o+36,192,true);
   }
   a.ships.update({count:n,view:v,simTimeMs:0,timeScale:1,timelineId:0},performance.now(),a.cfg);a.ships.setTime(0);
   r.setRenderTarget(null);r.setClearColor(theme==='day'?0x739aa5:0x102e42,1);r.clear(true,false,false);
   a.ships.draw(r,performance.now(),{width:1000,height:540,centerLon:0,centerLat:0,latMin:-89,latMax:89,scale},a.cfg,3,scale);
  },{scale,theme});
  await page.locator('canvas').screenshot({path:`${out}/${name}.png`});
  console.log(name);
 }
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('Échantillons synthétiques : aucune erreur JavaScript/GLSL');
}finally{await browser.close();}

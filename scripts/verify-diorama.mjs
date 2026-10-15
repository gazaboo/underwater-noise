// Serveur npm run dev actif ; Playwright Core disponible séparément.
import {fileURLToPath} from 'node:url';
import {mkdirSync,existsSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright-core');
const root=fileURLToPath(new URL('..',import.meta.url)),out=root+'docs/captures/diorama',frames='/tmp/diorama-rotation';mkdirSync(out,{recursive:true});mkdirSync(frames,{recursive:true});
const local=root+'config/local.json5',before=existsSync(local)?readFileSync(local):null;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/opt/brave.com/brave/brave',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1120,height:840}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('404'))errors.push(m.text())});
function check(ok,label){if(!ok)throw Error(label);console.log('PASS',label)}
const url=process.env.VACARME_URL??'http://localhost:5173/';
try{
 await page.goto(url+'?mode=globe&quality=light&theme=day&style=diorama');
 await page.waitForFunction(()=>window.vacarme?.diorama.ground,{},{timeout:90000});
 await page.evaluate(()=>{window.realRAF=window.requestAnimationFrame;window.requestAnimationFrame=()=>0});await page.waitForTimeout(250);
 await page.evaluate(()=>{
  const a=window.vacarme;a.cfg.audio.enabled=false;a.cfg.globe.periodMinutes=0;a.ships.update=()=>{};a.physics.step=()=>{};a.physics.updateEnergy=()=>{};a.physics.accumulate=()=>{};
  window.drawDiorama=()=>{a.profile.visualSimSteps=0;a.frame(a.lastFrame)};
 });
 check(await page.evaluate(()=>window.vacarme.cfg.scene.style==='diorama'),'choix URL conservé après le premier message serveur');
 await page.screenshot({path:out+'/comparateur.png'});
 const beforeSwitch=await page.evaluate(()=>{const a=window.vacarme;return [a.globeCtl.facingLon,a.globeCtl.zoom,a.lastFrame]});
 await page.getByRole('button',{name:/Monde sculpté/}).click();await page.evaluate(()=>window.drawDiorama());
 await page.getByRole('button',{name:/Diorama pilote/}).click();await page.evaluate(()=>window.drawDiorama());
 check(JSON.stringify(beforeSwitch)===JSON.stringify(await page.evaluate(()=>{const a=window.vacarme;return [a.globeCtl.facingLon,a.globeCtl.zoom,a.lastFrame]})),'comparaison sans déplacement ni remise à zéro du temps');
 const hide=await page.addStyleTag({content:'.scene-switcher,.scene-reopen,.tp-dfwv{visibility:hidden!important}'});
 for(const theme of ['day','night'])for(const view of ['overview','grazing','detail']){
  await page.evaluate(({theme,view})=>{const a=window.vacarme;a.cfg.display.theme=theme;a.setDioramaView(view);window.drawDiorama()},{theme,view});
  await page.screenshot({path:`${out}/${theme}-${view}.png`});console.log('capture',theme,view);
  if(theme==='day'){
   await page.evaluate(()=>{window.vacarme.cfg.scene.style='sculpted';window.drawDiorama()});await page.screenshot({path:`${out}/avant-${view}.png`});
   await page.evaluate(()=>{window.vacarme.cfg.scene.style='diorama';window.drawDiorama()});
  }
 }
 const stats=await page.evaluate(()=>{
  const a=window.vacarme;a.cfg.display.theme='day';a.setDioramaView('overview');window.drawDiorama();
  const d=a.diorama,g=d.ground.geometry,p=g.getAttribute('position');let max=0;for(let i=0;i<p.count;i++)max=Math.max(max,Math.hypot(p.getX(i),p.getY(i),p.getZ(i)));
  const n=a.renderer.info.memory.geometries;for(let i=0;i<4;i++){a.cfg.scene.style='current';window.drawDiorama();a.cfg.scene.style='diorama';window.drawDiorama()}
  const c=a.renderer.domElement,geo=d.pixelToGeo(c.width/2,c.height/2,c.width,c.height);
  return {maxRadius:max,vertices:p.count,cliffVertices:d.cliffs.geometry.getAttribute('position').count,instances:d.landscape.children.filter(c=>c.isInstancedMesh).reduce((n,c)=>n+c.count,0),geometriesBefore:n,geometriesAfter:a.renderer.info.memory.geometries,picking:geo};
 });
 check(stats.maxRadius>1.15&&stats.cliffVertices>0,'massifs et falaises réellement en volume');check(stats.instances>100,'modèles GLB instanciés dans le pilote');
 check(stats.geometriesBefore===stats.geometriesAfter,'ressources stables après changements de style');check(stats.picking&&Math.abs(stats.picking[0]+12)<.2&&Math.abs(stats.picking[1]+69)<.2,'lecture géographique sur le terrain déformé');
 for(let i=0;i<24;i++){
  await page.evaluate(i=>{const a=window.vacarme;a.globeCtl.facingLon=-116+i*2.1;a.globeCtl.zoom=1.05;a.cfg.globe.viewLatDeg=-12;window.drawDiorama()},i);
  await page.screenshot({path:`${frames}/${String(i).padStart(3,'0')}.png`});
 }
 execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-framerate','8','-i',frames+'/%03d.png','-frames:v','24','-c:v','libx264','-pix_fmt','yuv420p','-crf','22',out+'/rotation.mp4']);
 console.log('rotation enregistrée');
 await hide.evaluate(e=>e.remove());
 for(const mode of ['flat','hemisphere','fisheye','equirect']){
  await page.evaluate(mode=>{window.vacarme.cfg.display.mode=mode;window.drawDiorama()},mode);
  check(await page.getByRole('button',{name:/Diorama pilote/}).isDisabled(),'pilote désactivé en '+mode);
 }
 await page.evaluate(()=>{const a=window.vacarme;a.cfg.display.mode='globe';a.setDioramaView('overview');a.cfg.scene.relief=.68;window.drawDiorama();a.onServerConfig(a.raw)});
 check(await page.evaluate(()=>window.vacarme.cfg.scene.style==='diorama'&&window.vacarme.cfg.globe.viewLatDeg===-12),'choix local et cadrage conservés au rechargement serveur');
 await page.evaluate(()=>window.requestAnimationFrame=window.realRAF);
 check((await page.evaluate(()=>window.vacarme.save())).startsWith('enregistré'),'enregistrement du pilote');
 await page.waitForFunction(async()=>{const c=await(await fetch('/api/config')).json();return c.scene.style==='diorama'&&c.scene.relief===.68},{},{timeout:5000});
 check(true,'style et relief relus par le serveur');
 console.log('stats',stats);check(errors.length===0,'aucune erreur JavaScript ou GLSL');
 // Échec réseau sur une page indépendante, puis reprise explicite.
 const failure=await browser.newPage({viewport:{width:900,height:700}});
 await failure.route('**/models/diorama/*.glb',r=>r.fulfill({status:503,body:'test indisponible'}));
 await failure.goto(url+'?mode=globe&quality=light&style=current');await failure.waitForFunction(()=>window.vacarme,{},{timeout:60000});
 await failure.getByRole('button',{name:/Diorama pilote/}).click();await failure.waitForFunction(()=>window.vacarme.diorama.status==='error');
 check(await failure.getByRole('button',{name:'Réessayer',exact:true}).isVisible(),'erreur de chargement présentée avec reprise');
 check(await failure.evaluate(()=>window.vacarme.lastGlobe?.surface!=='diorama'),'scène précédente conservée en cas d’échec');
 await failure.unroute('**/models/diorama/*.glb');await failure.getByRole('button',{name:'Réessayer',exact:true}).click();
 await failure.waitForFunction(()=>window.vacarme.diorama.ground,{},{timeout:90000});check(true,'reprise après échec des modèles');await failure.close();
}finally{await browser.close();if(before)writeFileSync(local,before);else if(existsSync(local))unlinkSync(local)}

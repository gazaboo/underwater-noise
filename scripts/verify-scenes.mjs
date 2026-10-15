// Contrôles WebGL optionnels ; npm run dev et Playwright Core sont nécessaires.
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const root = fileURLToPath(new URL('..', import.meta.url));
const out = root+'docs/captures/directions-artistiques'; mkdirSync(out,{recursive:true});
const local = root+'config/local.json5', previous = existsSync(local)?readFileSync(local):null;
const browser = await chromium.launch({ executablePath:process.env.CHROMIUM_PATH ?? '/opt/brave.com/brave/brave',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({viewport:{width:1280,height:900}});
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('404'))errors.push(m.text())});
function check(ok,label){if(!ok)throw Error(label);console.log('PASS',label)}
const draw=()=>page.evaluate(()=>window.drawScene());
try {
 await page.goto((process.env.VACARME_URL ?? 'http://localhost:5173/')+'?quality=light');
 await page.waitForFunction(()=>window.vacarme,{timeout:60000});
 await page.evaluate(()=>{window.realRAF=window.requestAnimationFrame;window.requestAnimationFrame=()=>0});
 await page.waitForTimeout(300);
 await page.evaluate(()=>{
  const a=window.vacarme;
  // Geler le temps et les états physiques seulement dans cette page de test.
  a.ships.update=()=>{};a.physics.step=()=>{};a.physics.updateEnergy=()=>{};a.physics.accumulate=()=>{};
  a.cfg.audio.enabled=false;a.cfg.globe.periodMinutes=0;
  window.drawScene=()=>{a.profile.visualSimSteps=0;a.frame(a.lastFrame)};
  window.readPixels=()=>{const gl=a.renderer.getContext();const p=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,p);return p};
 });
 for(const mode of ['globe','flat']) for(const theme of ['day','night']) {
  await page.evaluate(({mode,theme})=>{const a=window.vacarme;a.cfg.display.mode=mode;a.cfg.display.theme=theme;a.nav.reset()}, {mode,theme});
  await draw();
  for(const [style,label] of [['painted','Planète peinte'],['sculpted','Monde sculpté'],['faceted','Atlas facetté']]) {
   const before=await page.evaluate(()=>{const a=window.vacarme;return [a.lastFrame,a.globeCtl.facingLon,a.globeCtl.zoom,a.nav.zoom]});
   await page.getByRole('button',{name:new RegExp(label)}).click();await draw();
   const after=await page.evaluate(()=>{const a=window.vacarme;return [a.lastFrame,a.globeCtl.facingLon,a.globeCtl.zoom,a.nav.zoom]});
   check(JSON.stringify(before)===JSON.stringify(after),'cadrage et temps conservés : '+style+'/'+mode+'/'+theme);
   await page.screenshot({path:`${out}/${mode}-${theme}-${style}.png`});
   if(mode==='globe'&&style!=='painted'){
    check(await page.evaluate(()=>{const a=window.vacarme,g=a.sculptedGlobe,p=g.terrain.mesh.geometry.getAttribute('position');let max=0;for(let i=0;i<p.count;i++)max=Math.max(max,Math.hypot(p.getX(i),p.getY(i),p.getZ(i)));return max>1.03}),'silhouette réellement déformée : '+style);
   }
  }
 }
 // Points connus, deux pôles et couture : picking sur la géométrie visible.
 for(const [lon,lat] of [[-72,-16],[-62,-5],[-19,65],[110,-7],[179,20],[0,85],[0,-85]]) {
  await page.evaluate(({lon,lat})=>{const a=window.vacarme;a.cfg.display.mode='globe';a.cfg.scene.style='sculpted';a.cfg.globe.viewLatDeg=lat;a.globeCtl.userLat=0;a.globeCtl.facingLon=lon;a.globeCtl.zoom=1.4;window.drawScene()}, {lon,lat});
  const geo=await page.evaluate(()=>{const a=window.vacarme,c=a.renderer.domElement;return a.sculptedGlobe.pixelToGeo(c.width/2,c.height/2,c.width,c.height)});
  check(geo&&Math.abs(geo[0]-lat)<0.15&&Math.abs(((geo[1]-lon+540)%360)-180)<0.15,'picking du relief : '+lon+'/'+lat);
 }
 await page.evaluate(()=>{const a=window.vacarme;a.cfg.globe.viewLatDeg=-16;a.globeCtl.facingLon=-72;a.globeCtl.zoom=2;a.cfg.display.theme='day';window.drawScene()});
 await page.screenshot({path:out+'/andes-volume.png'});
 await page.getByRole('button',{name:'Masquer le comparateur'}).click();check(await page.locator('.scene-switcher').isHidden(),'masquer le comparateur');
 await page.getByRole('button',{name:'◈ Directions artistiques',exact:true}).click();
 await page.keyboard.press('j');await draw();check(await page.evaluate(()=>window.vacarme.cfg.display.theme==='night'),'raccourci J après sélection');
 for(const mode of ['hemisphere','fisheye','equirect']){
  await page.evaluate(mode=>{window.vacarme.cfg.display.mode=mode;window.drawScene()},mode);
  check(await page.locator('.scene-choice:disabled').count()===4,'comparateur désactivé : '+mode);
  const equal=await page.evaluate(()=>{const a=window.vacarme;window.drawScene();const selected=window.readPixels();a.cfg.scene.style='current';window.drawScene();const current=window.readPixels();a.cfg.scene.style='sculpted';return selected.every((v,i)=>v===current[i])});
  check(equal,'projection conservée : '+mode);
 }
 await page.evaluate(()=>{const a=window.vacarme;a.cfg.display.mode='globe';a.cfg.display.theme='day';a.globeCtl.facingLon=0;a.cfg.globe.viewLatDeg=25;a.globeCtl.zoom=1;window.drawScene()});
 check(await page.getByRole('button',{name:/Monde sculpté/}).getAttribute('aria-pressed')==='true','style retrouvé au retour au globe');
 const resources=await page.evaluate(()=>{
  const a=window.vacarme;const sizes=[];
  for(let i=0;i<8;i++){a.cfg.scene.style=i%2?'sculpted':'faceted';window.drawScene();sizes.push(a.renderer.info.memory.geometries)}
  const g=a.lastGlobe,cfg={...a.themed(),display:{...a.cfg.display,quality:'expo'}};
  a.sculptedGlobe.render(a.renderer,a.worldTarget.texture,g.cam,g.M,cfg,g.w,g.h,12);
  const expo={vertices:a.sculptedGlobe.terrain.mesh.geometry.getAttribute('position').count,shadow:a.sculptedGlobe.shadowTarget.width};
  window.drawScene();const light={vertices:a.sculptedGlobe.terrain.mesh.geometry.getAttribute('position').count,shadow:a.sculptedGlobe.shadowTarget.width};
  return {sizes,expo,light};
 });
 check(resources.sizes.slice(2).every(n=>n===resources.sizes[2]),'géométries stables après changements répétés');
 check(resources.light.vertices<resources.expo.vertices&&resources.light.shadow<resources.expo.shadow,'profil light allégé');
 await page.evaluate(()=>{const a=window.vacarme;a.cfg.display.target='projector';a.cfg.scene.relief=0.61;a.onPanelChange('display')});
 check(await page.evaluate(()=>window.vacarme.cfg.scene.style==='sculpted'&&window.vacarme.cfg.scene.relief===0.61),'direction conservée au changement de cible');
 await page.evaluate(()=>{window.requestAnimationFrame=window.realRAF});
 await page.keyboard.press('p');check(await page.locator('.tp-dfwv').count()===1,'panneau P conservé');
 await page.evaluate(()=>{for(const c of window.vacarme.panel.pane.children)if('expanded' in c)c.expanded=c.title==='Direction artistique'});
 await page.waitForTimeout(400);await page.screenshot({path:out+'/reglages.png'});
 check((await page.evaluate(()=>window.vacarme.save())).startsWith('enregistré'),'enregistrement de la direction artistique');
 await page.waitForFunction(async()=>{const c=await(await fetch('/api/config')).json();return c.scene.style==='sculpted'&&c.scene.relief===0.61},{},{timeout:5000});
 check(true,'relecture du style et du relief');
 check(errors.length===0,'aucune erreur JavaScript ou GLSL');console.log('ressources',resources);
} finally {await browser.close();if(previous)writeFileSync(local,previous);else if(existsSync(local))unlinkSync(local)}

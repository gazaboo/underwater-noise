// Vérification WebGL optionnelle : serveur npm run dev actif et Playwright Core disponible.
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
const root=fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const original=execFileSync('git',['show','cc72bb3:client/src/render/flat-view.ts'],{cwd:root,encoding:'utf8'}).split('const COMPOSITE_FRAG = /* glsl */ `')[1].split('`;')[0];
const out=root+'/docs/captures/terres-gouache';mkdirSync(out,{recursive:true});
const local=root+'/config/local.json5', oldLocal=existsSync(local)?readFileSync(local):null;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH ?? '/opt/brave.com/brave/brave',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:800}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('404'))errors.push(m.text())});
function check(ok,msg){if(!ok)throw Error(msg);console.log('PASS',msg)}
try{
await page.goto((process.env.VACARME_URL ?? 'http://localhost:5173/')+'?quality=light');await page.waitForFunction(()=>window.vacarme,{timeout:60000});
await page.evaluate(()=>{window.realRAF=window.requestAnimationFrame; window.requestAnimationFrame=()=>0; window.vacarme.cfg.audio.enabled=false});await page.waitForTimeout(300);
await page.evaluate(async()=>{
 const a=window.vacarme;
 const {computeFlatTransform}=await import('/src/render/flat-view.ts');
 window.landView=()=>computeFlatTransform(a.cfg,a.renderer.domElement.width,a.renderer.domElement.height,a.nav.update(10000));
 window.paintFlat=()=>a.flat.render(a.renderer,a.wave.texture,{x:a.wave.width,y:a.wave.height},a.coverage,window.landView(),a.themed(),12);
 window.pixels=()=>{const gl=a.renderer.getContext();const p=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,p);return p};
 window.diff=(a,b)=>a.reduce((n,v,i)=>n+(v!==b[i]),0);
});
for(const theme of ['night','day']) {
await page.evaluate(theme=>window.vacarme.cfg.display.theme=theme,theme);
const equality=await page.evaluate(async original=>{
 const a=window.vacarme;const {FullscreenPass,rawMaterial}=await import('/src/render/fullscreen.ts');
 a.cfg.land.style='flat';a.cfg.land.paper.enabled=false;a.cfg.land.stars.enabled=false;
 window.paintFlat();const now=window.pixels();const pass=new FullscreenPass(rawMaterial(original,a.flat.uniforms));pass.render(a.renderer,null);const old=window.pixels();pass.material.dispose();pass.mesh.geometry.dispose();return window.diff(now,old);
},original);check(equality===0,'aplat identique à l’ancien shader, octet par octet : '+theme);
}
await page.evaluate(()=>window.vacarme.cfg.display.theme='night');
await page.evaluate(()=>{const a=window.vacarme;a.cfg.land.style='gouache';a.cfg.land.paper.enabled=true;a.cfg.land.stars.enabled=true;window.paintFlat()});
await page.screenshot({path:out+'/nuit.png'});
await page.evaluate(()=>{window.vacarme.cfg.display.theme='day';window.paintFlat()});
await page.screenshot({path:out+'/jour.png'});
for(const [name,lon,lat,zoom] of [['amazonie',-62,-5,12],['andes',-72,-16,10],['islande',-19,65,18],['indonesie',110,-7,18]]){
 await page.evaluate(({lon,lat,zoom})=>{const a=window.vacarme;a.cfg.display.theme='day';a.nav.goTo(lon,lat,zoom);window.paintFlat();a.volcanoes.draw(a.renderer,window.landView(),a.themed(),12)},{lon,lat,zoom});
 await page.screenshot({path:out+'/'+name+'.png'});
}
const toggles=await page.evaluate(()=>{
 const a=window.vacarme;a.nav.goTo(-62,-5,12);a.cfg.land.ornaments.enabled=true;window.paintFlat();const trees=window.pixels();a.cfg.land.ornaments.enabled=false;window.paintFlat();const noTrees=window.pixels();
 a.cfg.land.paper.enabled=false;window.paintFlat();const noPaper=window.pixels();
 a.cfg.land.paper.enabled=true;a.cfg.land.ornaments.enabled=true;a.nav.goTo(110,-7,18);window.paintFlat();const base=window.pixels();a.volcanoes.draw(a.renderer,window.landView(),a.themed(),12);const volcanoes=window.pixels();
 a.cfg.land.ornaments.volcanoes=false;window.paintFlat();a.volcanoes.draw(a.renderer,window.landView(),a.themed(),12);const disabled=window.pixels();
 a.cfg.land.ornaments.volcanoes=true;a.cfg.land.ornaments.smokeSinceYear=2100;window.paintFlat();a.volcanoes.draw(a.renderer,window.landView(),a.themed(),12);const noSmoke=window.pixels();a.cfg.land.ornaments.smokeSinceYear=1950;
 return {trees:window.diff(trees,noTrees),paper:window.diff(noTrees,noPaper),volcanoes:window.diff(base,volcanoes),disabled:window.diff(base,disabled),smoke:window.diff(volcanoes,noSmoke)};
});for(const k of ['trees','paper','volcanoes','smoke'])check(toggles[k]>0,'bascule '+k+' modifie le rendu');check(toggles.disabled===0,'désactivation des volcans effective');
for(const mode of ['globe','hemisphere','fisheye','equirect']){
 await page.evaluate(mode=>{const a=window.vacarme;a.cfg.display.theme='night';a.cfg.display.mode=mode;a.cfg.physics.enabled=false;a.frame(a.lastFrame+16)},mode);
 await page.screenshot({path:out+'/'+mode+'.png'});
 const mask=await page.evaluate(()=>{
  const a=window.vacarme;const g=a.lastGlobe;
  const draw=()=>a.globe.render(a.renderer,a.worldTarget.texture,g.mode,g.cam,g.M,a.themed(),g.w,g.h,12);
  a.cfg.land.stars.enabled=true;draw();const stars=window.pixels();a.cfg.land.stars.enabled=false;draw();const noStars=window.pixels();a.cfg.land.stars.enabled=true;
  return {stars:window.diff(stars,noStars),corner:Array.from(noStars.slice(0,3))};
 });check(mode==='globe'?mask.stars>0:mask.stars===0,'étoiles réservées au globe : '+mode);check(mode==='globe'||mask.corner.every(v=>v===0),'extérieur du masque noir : '+mode);
}
await page.evaluate(()=>{const a=window.vacarme;a.cfg.display.target='projector';a.cfg.land.saturation=1.83;a.cfg.dayPalette.landLight=0.87;a.onPanelChange('display')});
check(await page.evaluate(()=>window.vacarme.cfg.land.saturation===1.83&&window.vacarme.cfg.dayPalette.landLight===0.87),'réglages conservés au changement de cible');
await page.evaluate(()=>{const a=window.vacarme;a.cfg.display.mode='hemisphere';a.frame(a.lastFrame+16)});await page.screenshot({path:out+'/projecteur.png'});
await page.evaluate(()=>window.requestAnimationFrame=window.realRAF);
await page.keyboard.press('p');check(await page.locator('.tp-dfwv').count()===1,'panneau P construit');
await page.evaluate(()=>{for(const c of window.vacarme.panel.pane.children)if('expanded' in c)c.expanded=c.title==='Terres (gouache)'});
await page.waitForTimeout(400);
const folder=page.locator('.tp-fldv').filter({has:page.getByText('Terres (gouache)',{exact:true})}).first();
await folder.locator('select.tp-lstv_s').selectOption({label:'aplat'});
check(await page.evaluate(()=>window.vacarme.cfg.land.style==='flat'),'sélecteur de style du panneau');
await folder.locator('select.tp-lstv_s').selectOption({label:'gouache'});
for(const [title,key] of [['Ornements','ornaments'],['Papier','paper'],['Étoiles (globe)','stars']]) {
 await page.getByText(title,{exact:true}).click();await page.waitForTimeout(200);
 const sub=page.locator('.tp-fldv').filter({has:page.getByText(title,{exact:true})}).last();
 await sub.locator('label').first().click();
 check(await page.evaluate(key=>!window.vacarme.cfg.land[key].enabled,key),'case du panneau : '+title);
 await sub.locator('label').first().click();
 await page.getByText(title,{exact:true}).click();
}
await page.waitForTimeout(250);await page.screenshot({path:out+'/panneau.png'});
check((await page.evaluate(()=>window.vacarme.save())).startsWith('enregistré'),'enregistrement du panneau');
await page.waitForTimeout(400);
check(await page.evaluate(async()=>{const c=await (await fetch('/api/config')).json();return c.land.saturation===1.83&&c.dayPalette.landLight===0.87}),'relecture des réglages enregistrés');
console.log('toggles',toggles);console.log('GPU',await page.evaluate(()=>{const gl=window.vacarme.renderer.getContext();const e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):'inconnu'}));
check(errors.length===0,'aucune erreur JavaScript ou shader');console.log('captures',out);
}finally{await browser.close();if(oldLocal)writeFileSync(local,oldLocal);else if(existsSync(local))unlinkSync(local)}

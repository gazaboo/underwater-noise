/** Runs isolated servers with synthetic traffic and Chromium. Never changes the exhibition config. */
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import JSON5 from 'json5';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
let base = process.env.VACARME_TEST_URL;
const children = [];
let isolatedConfig;
let logs = '';
async function freePort() {
  const server=createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}
async function startIsolated() {
  const port=await freePort(), viewPort=await freePort();
  isolatedConfig=mkdtempSync(join(tmpdir(),'vacarme-propagation-'));
  const defaults=readFileSync(join(root,'config/default.json5'),'utf8');
  const cfg=JSON5.parse(defaults);
  writeFileSync(join(isolatedConfig,'default.json5'),defaults);
  writeFileSync(join(isolatedConfig,'local.json5'),JSON.stringify({source:{mode:'simulation'},simulation:{shipCount:200},
    recorder:{enabled:false},audio:{enabled:false},noise:{style:'fronts',warmupMinutes:0},whales:{species:cfg.whales.species.map(s=>({...s,groups:2}))}}));
  const env={...process.env,PORT:String(port),VACARME_PORT:String(port),VACARME_CONFIG_DIR:isolatedConfig,AISSTREAM_API_KEY:''};
  for(const [args,cwd] of [[['--import','tsx','server/src/index.ts'],root],[[join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(viewPort),'--strictPort'],join(root,'client')]]) {
    const child=spawn(process.execPath,args,{cwd,env,stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',d=>{logs+=d});child.stderr.on('data',d=>{logs+=d});children.push(child);
  }
  base=`http://127.0.0.1:${viewPort}`;
  const deadline=Date.now()+30000;
  while(Date.now()<deadline) {
    try {if((await fetch(`http://127.0.0.1:${port}/api/config`)).ok && (await fetch(`${base}/api/config`)).ok) return;} catch {}
    if(children.some(c=>c.exitCode!==null)) throw new Error(logs);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Isolated server did not start: '+logs);
}
const artifactDir = process.env.VACARME_TEST_ARTIFACTS ?? '/tmp/vacarme-propagation-results';
mkdirSync(artifactDir, {recursive:true});
let browser;
const errors = [];
const writes = [];
let appPage;
const observe = page => {
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {if(m.type()==='error' && /Shader|WebGL|TypeError|GL_INVALID|GL_OUT_OF_MEMORY/.test(m.text())) errors.push(m.text());});
};
try {
  if(!base) await startIsolated();
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH ?? '/usr/bin/chromium-browser',headless:true,
    args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page = await browser.newPage({viewport:{width:1280,height:850}}); observe(page);
  await page.route('**/src/main.ts',r=>r.fulfill({contentType:'text/javascript',body:''}));
  await page.goto(base);
  const controls = await page.evaluate(async root => {
    const {verifySolver, verifyVisibility} = await import(`/@fs${root}client/test/propagation-browser.ts`);
    const cfg=await fetch('/api/config').then(r=>r.json());
    return {solver:verifySolver(cfg), visibility:verifyVisibility(cfg)};
  }, root);
  console.log(JSON.stringify({solverControls:controls}));
  await page.close();

  appPage = await browser.newPage({viewport:{width:1280,height:850}}); observe(appPage);
  appPage.on('request', request=>{if(request.method()==='POST' && request.url().includes('/api/config')) writes.push(request.postData());});
  await appPage.goto(`${base}/?hud=1&mode=flat`);
  await appPage.waitForFunction(()=>window.vacarme, null, {timeout:180000});
  await appPage.waitForFunction(()=>window.vacarme.sourceStatus, null, {timeout:30000});
  await appPage.keyboard.press('p');
  const panel = await appPage.locator('.tp-dfwv').innerText();
  assert.match(panel,/Temps de la scène/);
  assert.match(panel,/bande affichée/);
  assert.doesNotMatch(panel,/cycles \/ impulsion|absorption côtes|vitesse de nage ×/);
  let playback=null;
  if(isolatedConfig) {
    const before=await appPage.evaluate(()=>({revision:window.vacarme.sceneClock.revision,age:window.vacarme.sceneAgeSec}));
    const reply=appPage.waitForResponse(res=>res.url().endsWith('/api/config') && res.request().method()==='POST');
    const timeControl=appPage.locator('.tp-lblv').filter({hasText:'vitesse du temps ×'}).locator('input').last();
    await timeControl.fill('10');
    await timeControl.press('Enter');
    assert.ok((await reply).ok());
    await appPage.waitForFunction(()=>window.vacarme.ships.currentTimeScale===10,null,{timeout:15000});
    const start=await appPage.evaluate(()=>({wall:performance.now(),time:window.vacarme.sceneClock.timeAt(performance.now()),age:window.vacarme.sceneAgeSec}));
    await appPage.waitForTimeout(1200);
    const end=await appPage.evaluate(()=>({wall:performance.now(),time:window.vacarme.sceneClock.timeAt(performance.now()),age:window.vacarme.sceneAgeSec,revision:window.vacarme.sceneClock.revision,steps:window.vacarme.physicsClock}));
    const measuredScale=(end.time-start.time)/(end.wall-start.wall);
    assert.ok(measuredScale>8 && measuredScale<12,`Unexpected scene scale ${measuredScale}`);
    assert.equal(end.revision,before.revision,'A speed change reset the history');
    assert.ok(end.age>=before.age && end.steps>0);
    playback={requested:10,measuredScale,continuousHistory:true,physicalSteps:end.steps};
  }
  // Stop RAF so diagnostic probes cannot advance/reset the field during assertions.
  await appPage.evaluate(()=>{window.requestAnimationFrame=()=>0;});
  await appPage.waitForTimeout(300);
  const ui = await appPage.evaluate(async root => {
    const a=window.vacarme;
    // The source status is a UI fixture only: no live service is contacted.
    a.sourceStatus={...a.sourceStatus,active:'live',shipsMode:'real'}; a.panel.refresh();
    const inputs=[...document.querySelectorAll('.tp-dfwv input')];
    const liveDisabled=inputs.some(i=>i.disabled && i.value==='1');
    a.sourceStatus={...a.sourceStatus,active:'simulation'}; a.panel.refresh();
    const simEnabled=[...document.querySelectorAll('.tp-dfwv input')].some(i=>!i.disabled && i.value===String(a.cfg.playback.timeScale));
    return {liveDisabled,simEnabled,fieldWidth:a.physics.width,cellMeters:a.physics.cellMeters,stepSeconds:a.physics.stepSeconds,calibration:a.calibration,
      note:document.querySelector('#propagation').innerText};
  },root);
  assert.equal(ui.liveDisabled,true); assert.equal(ui.simEnabled,true);
  assert.match(ui.note,/Historique acoustique incomplet/);
  assert.ok(Number.isFinite(ui.calibration.K) && ui.calibration.K>0);
  await appPage.screenshot({path:`${artifactDir}/fronts-reglages.png`});
  // Rendering/projection changes must all use the same physical field.
  const projections = await appPage.evaluate(() => {
    const a=window.vacarme; const field=a.physics;
    for(const mode of ['flat','globe','hemisphere','equirect','fisheye']) {a.cfg.display.mode=mode; a.frame(performance.now());}
    a.cfg.display.mode='flat'; a.nav.goTo(-30,30,12); a.frame(performance.now());
    return {sameField:a.physics===field,detailSimulation:!!a.detail};
  });
  assert.equal(projections.sameField,true); assert.equal(projections.detailSimulation,false);
  assert.deepEqual(errors,[]);
  if(isolatedConfig) assert.deepEqual(writes.map(body=>JSON.parse(body)),[{playback:{timeScale:10}}],'Unexpected repeated configuration writes');
  const report={playback,date:new Date().toISOString(),browser:'Chromium',meaning:'Numerical and UI controls, not observational acoustic validation',controls,ui,projections,errors};
  writeFileSync(`${artifactDir}/verification.json`,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:true,artifactDir,calibrationDeviationDb:ui.calibration.maxDeviationDb,playback,projections,errors}));
} catch(error) {
  if(appPage) console.error('Diagnostic',JSON.stringify({writes,app:await appPage.evaluate(()=>window.vacarme ? {cfgScale:window.vacarme.cfg.playback.timeScale,snapshotScale:window.vacarme.ships.currentTimeScale,connected:window.vacarme.connected,source:window.vacarme.sourceStatus?.active}:null).catch(()=>null)}));
  if(logs) console.error(logs.slice(-5000));
  throw error;
} finally {
  if(browser) await browser.close();
  await Promise.all(children.map(child=>new Promise(resolve=>{
    if(child.exitCode!==null) return resolve();
    const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},3000);
    child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');
  })));
  if(isolatedConfig) rmSync(isolatedConfig,{recursive:true,force:true});
}

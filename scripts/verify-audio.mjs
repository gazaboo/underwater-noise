// Vérification du son des cétacés : chargement des vrais enregistrements, enregistrement de la sortie de
// l'application, temps d'image avec enregistrements et avec synthèse. Serveur de développement actif
// (npm run dev) ou build web servi (VACARME_URL), Chromium installé ; la Radeon 780M est utilisée via Vulkan.
//
//   CHROMIUM_PATH=/chemin/chrome node scripts/verify-audio.mjs
//
// Variables : VACARME_URL (http://localhost:5173/), AUDIO_OUT (dossier du fichier enregistré, /tmp par défaut),
// RECORD_SEC (20), WHALE_SOURCE (recorded | synth), WHALES_ONLY=1 pour couper navires et nappe (écoute des seuls cétacés), PERF=0 pour sauter la
// mesure des temps d'image.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const url = process.env.VACARME_URL ?? 'http://localhost:5173/';
const outDir = process.env.AUDIO_OUT ?? '/tmp';
const recordSec = Number(process.env.RECORD_SEC ?? 20);
mkdirSync(outDir, { recursive: true });
const args = ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan',
  '--autoplay-policy=no-user-gesture-required'];
const errors = [];

const ready = () => window.vacarme && window.vacarme.ships.shipCount > 0 && window.vacarme.warmupTotal > 0 && window.vacarme.warmupLeft === 0;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('404') && !m.text().includes('GPU stall')) errors.push(m.text());
    if (m.text().includes('[son]')) errors.push(m.text());
  });
  await page.goto(`${url}?quality=expo`);
  await page.waitForFunction(ready, null, { timeout: 120000 });
  await page.mouse.click(720, 450); // geste utilisateur : démarre le contexte audio
  await page.evaluate(([whalesOnly, source]) => {
    const a = window.vacarme;
    a.cfg.display.mode = 'flat';
    a.cfg.audio.enabled = true;
    a.cfg.audio.whales.source = source;
    if (whalesOnly) { a.cfg.audio.ships.volume = 0; a.cfg.audio.bed.volume = 0; }
  }, [process.env.WHALES_ONLY === '1', process.env.WHALE_SOURCE ?? 'recorded']);
  await page.waitForFunction(() => /enregistrements : \d+ espèce|catalogue absent/.test(window.vacarme.audio.bank.status), null, { timeout: 60000 });
  const loaded = await page.evaluate(() => window.vacarme.audio.bank.status);
  console.log(loaded);

  // Sortie réelle de l'application (après le limiteur), et appels joués pendant ce temps.
  const result = await page.evaluate(async (sec) => {
    const a = window.vacarme;
    const stream = a.audio.tap();
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const species = {};
    const original = a.audio.bank.pick.bind(a.audio.bank);
    a.audio.bank.pick = (id) => { const r = original(id); species[id] = (species[id] ?? 0) + (r ? 1 : 0); return r; };
    let maxCalls = 0;
    const timer = setInterval(() => { maxCalls = Math.max(maxCalls, Number(a.audio.status.match(/(\d+) appels en cours/)?.[1] ?? 0)); }, 100);
    rec.start();
    await new Promise((r) => setTimeout(r, sec * 1000));
    rec.stop();
    await new Promise((r) => (rec.onstop = r));
    clearInterval(timer);
    a.audio.bank.pick = original;
    const buf = await new Blob(chunks).arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { b64: btoa(bin), species, maxCalls, status: a.audio.status };
  }, recordSec);
  const file = `${outDir}/sortie-${process.env.WHALES_ONLY === '1' ? 'cetaces-seuls' : 'complete'}-${process.env.WHALE_SOURCE ?? 'recorded'}.webm`;
  writeFileSync(file, Buffer.from(result.b64, 'base64'));
  console.log(`appels enregistrés par espèce : ${JSON.stringify(result.species)} · au plus ${result.maxCalls} simultanés`);
  console.log(`statut : ${result.status}`);
  const vol = spawnSync('ffmpeg', ['-v', 'info', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  console.log(`sortie (${recordSec} s) : ${file} · ${vol.match(/mean_volume: [^\n]+/)?.[0]} · ${vol.match(/max_volume: [^\n]+/)?.[0]}`);

  if (process.env.PERF !== '0') {
    for (const source of ['recorded', 'synth']) {
      const t = await page.evaluate(async (source) => {
        window.vacarme.cfg.audio.whales.source = source;
        await new Promise((r) => setTimeout(r, 1000));
        const dts = [];
        let last = performance.now();
        await new Promise((resolve) => {
          const end = last + 6000;
          const step = (now) => { dts.push(now - last); last = now; if (now < end) requestAnimationFrame(step); else resolve(); };
          requestAnimationFrame(step);
        });
        dts.sort((x, y) => x - y);
        const q = (p) => dts[Math.min(dts.length - 1, Math.floor(p * dts.length))];
        return { median: q(0.5), p99: q(0.99), long: dts.filter((d) => d > 34).length };
      }, source);
      console.log(`temps d'image, ${source} : médiane ${t.median.toFixed(1)} ms · p99 ${t.p99.toFixed(1)} ms · ${t.long} image(s) > 34 ms sur 6 s`);
    }
  }
} finally {
  await browser.close();
}
if (errors.length) {
  console.error('Erreurs :\n' + errors.join('\n'));
  process.exit(1);
}

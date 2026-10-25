// Vérification des lieux à écouter : marqueurs dans chaque mode, son du lieu au centre de la vue, masquage par le
// bruit et retour à la clarté sans navires, fiche au clic sur le marqueur. Serveur de développement actif
// (npm run dev) ou build web servi (VACARME_URL), Chromium installé.
//
//   CHROMIUM_PATH=/chemin/chrome node scripts/verify-lieux.mjs
//
// Variables : VACARME_URL (http://localhost:5173/), CAPTURE_DIR (/tmp/lieux), RECORD_SEC (0 : pas d'enregistrement
// de la sortie ; sinon, secondes enregistrées à Glacier Bay, navires et cétacés coupés).
import { mkdirSync, writeFileSync } from 'node:fs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const url = process.env.VACARME_URL ?? 'http://localhost:5173/';
const out = process.env.CAPTURE_DIR ?? '/tmp/lieux';
const recordSec = Number(process.env.RECORD_SEC ?? 0);
mkdirSync(out, { recursive: true });
const args = ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--autoplay-policy=no-user-gesture-required'];
const errors = [];
const fail = (msg) => { errors.push(msg); console.log(`ÉCHEC ${msg}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404') && !m.text().includes('GPU stall')) errors.push(m.text()); });
  await page.goto(`${url}?quality=expo`);
  await page.waitForFunction(() => window.vacarme && window.vacarme.whales && window.vacarme.warmupTotal > 0 && window.vacarme.warmupLeft === 0 && window.vacarme.lieux.lieux.length > 0, null, { timeout: 120000 });
  await page.mouse.click(30, 870); // geste utilisateur : démarre le son (clic dans le vide)
  const lieux = await page.evaluate(() => window.vacarme.lieux.lieux.map((l) => ({ id: l.id, lat: l.center.lat, lon: l.center.lon, title: l.title, sounds: l.sounds.length })));
  console.log(`${lieux.length} lieux : ${lieux.map((l) => l.id).join(', ')}`);
  await page.waitForFunction(() => /enregistrements : \d+ espèce/.test(window.vacarme.audio.bank.status), null, { timeout: 60000 });

  // Marqueurs : carte, globe, demi-sphère.
  for (const [name, mode] of [['carte', 'flat'], ['globe', 'globe'], ['demi-sphere', 'hemisphere']]) {
    await page.evaluate(([mode]) => {
      const a = window.vacarme;
      a.cfg.display.mode = mode;
      if (mode === 'flat') a.nav.goTo(-60, 0, 1);
      else a.globeCtl.facingLon = -100;
    }, [mode]);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/marqueurs-${name}.jpg`, type: 'jpeg', quality: 80 });
  }

  // Chaque lieu au centre de la vue : on l'entend s'il a un son ; un clic sur son marqueur ouvre sa fiche. Carte plate si le lieu
  // est dans son cadre en latitude (view.flat), globe sinon (PALAOA, 70° S).
  for (const l of lieux) {
    const p = await page.evaluate(([lon, lat]) => {
      const a = window.vacarme;
      const f = a.cfg.view.flat;
      if (lat > f.latMin + 5 && lat < f.latMax - 5) {
        a.cfg.display.mode = 'flat';
        a.nav.goTo(lon, lat, 5);
        return null;
      }
      a.cfg.display.mode = 'globe';
      a.globeCtl.facingLon = lon;
      a.globeCtl.userLat = lat - a.cfg.globe.viewLatDeg;
      return { x: 720, y: 450 };
    }, [l.lon, l.lat]);
    await page.waitForTimeout(3000);
    const status = await page.evaluate(() => window.vacarme.audio.status.match(/lieu [^·]*/)?.[0]?.trim() ?? '');
    if (l.sounds && !status.includes(l.id)) fail(`${l.id} : non entendu au centre de la vue (${status})`);
    // Position réelle du marqueur sur la carte plate (la vue ne se centre pas toujours exactement).
    const at = p ?? await page.evaluate(([lon, lat]) => {
      const a = window.vacarme, v = a.lastView, c = a.renderer.domElement, r = c.width / c.clientWidth;
      const x = v.width / 2 + ((((lon - v.centerLon) + 540) % 360) - 180) * v.scale;
      const y = v.height / 2 + (lat - v.centerLat) * v.scale;
      return { x: x / r, y: (c.height - y) / r };
    }, [l.lon, l.lat]);
    if (l.id === 'palaoa' || p) await page.waitForTimeout(500);
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(500);
    const title = await page.evaluate(() => (document.getElementById('fiche').hidden ? '' : document.querySelector('#fiche h2')?.firstChild?.textContent?.trim() ?? ''));
    if (title !== l.title) fail(`${l.id} : la fiche ne s'ouvre pas au clic (« ${title} »)`);
    console.log(`${l.id} : ${status} · fiche « ${title} »`);
    if (!l.sounds && !(await page.evaluate(() => document.querySelector('#fiche')?.textContent?.includes('Pas encore d\'enregistrement')))) fail(`${l.id} : fiche sans la mention « pas encore d'enregistrement »`);
    if (l.id === 'glacier-bay' || l.id === 'challenger-deep') await page.screenshot({ path: `${out}/fiche-${l.id}.jpg`, type: 'jpeg', quality: 82 });
    await page.keyboard.press('Escape');
  }

  // Océan sans navires : clarté rendue à 1.
  const busiest = lieux.find((l) => l.id === 'glacier-bay') ?? lieux[0];
  await page.evaluate(([lon, lat]) => { const a = window.vacarme; a.cfg.display.mode = 'flat'; a.nav.goTo(lon, lat, 5); a.cfg.scenario = 'sans-navires'; }, [busiest.lon, busiest.lat]);
  await page.waitForTimeout(2500);
  const quiet = await page.evaluate(() => window.vacarme.audio.status.match(/clarté ([\d.]+)/)?.[1]);
  if (quiet !== '1.00') fail(`sans navires : clarté ${quiet} au lieu de 1.00`);
  console.log(`sans navires : clarté ${quiet}`);
  await page.evaluate(() => { window.vacarme.cfg.scenario = 'actuel'; });

  if (recordSec > 0) {
    const gb = lieux.find((l) => l.id === 'glacier-bay') ?? lieux[0];
    const b64 = await page.evaluate(async ([lon, lat, sec]) => {
      const a = window.vacarme;
      a.cfg.display.mode = 'flat';
      a.nav.goTo(lon, lat, 5);
      a.cfg.audio.ships.volume = 0; a.cfg.audio.bed.volume = 0; a.cfg.audio.whales.volume = 0;
      await new Promise((r) => setTimeout(r, 2000));
      const rec = new MediaRecorder(a.audio.tap(), { mimeType: 'audio/webm;codecs=opus' });
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.start();
      await new Promise((r) => setTimeout(r, sec * 1000));
      rec.stop();
      await new Promise((r) => (rec.onstop = r));
      const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    }, [gb.lon, gb.lat, recordSec]);
    writeFileSync(`${out}/sortie-${gb.id}.webm`, Buffer.from(b64, 'base64'));
    console.log(`sortie enregistrée : ${out}/sortie-${gb.id}.webm`);
  }
} finally {
  await browser.close();
}
if (errors.length) {
  console.error('Erreurs :\n' + errors.join('\n'));
  process.exit(1);
}
console.log(`captures : ${out}`);

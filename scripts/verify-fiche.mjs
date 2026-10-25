// Vérification de la fiche espèce : un vrai clic sur un groupe ouvre sa fiche, le son se lit, un glissé ne
// l'ouvre pas, un clic dans le vide la ferme. Une capture par espèce. Serveur de développement actif
// (npm run dev) ou build web servi (VACARME_URL), Chromium installé.
//
//   CHROMIUM_PATH=/chemin/chrome node scripts/verify-fiche.mjs
//
// Variables : VACARME_URL (http://localhost:5173/), CAPTURE_DIR (/tmp/fiches), WIDTH × HEIGHT (1440 × 900).
import { mkdirSync } from 'node:fs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const url = process.env.VACARME_URL ?? 'http://localhost:5173/';
const out = process.env.CAPTURE_DIR ?? '/tmp/fiches';
const width = Number(process.env.WIDTH ?? 1440);
const height = Number(process.env.HEIGHT ?? 900);
mkdirSync(out, { recursive: true });
const args = ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--autoplay-policy=no-user-gesture-required'];
const errors = [];
const fail = (msg) => { errors.push(msg); console.log(`ÉCHEC ${msg}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args });
try {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404') && !m.text().includes('GPU stall')) errors.push(m.text()); });
  await page.goto(`${url}?quality=expo`);
  await page.waitForFunction(() => window.vacarme && window.vacarme.ships.shipCount > 0 && window.vacarme.warmupTotal > 0 && window.vacarme.warmupLeft === 0, null, { timeout: 120000 });

  // Position à l'écran (pixels CSS) du groupe d'une espèce le plus proche du centre de la carte plate.
  const target = (species) => page.evaluate((species) => {
    const a = window.vacarme;
    const v = a.lastView;
    const c = a.renderer.domElement;
    const ratio = c.width / c.clientWidth;
    const groups = a.whales.agents.groups.filter((g) => g.species.id === species);
    const pos = (g) => {
      let lon = g.lon;
      while (lon - v.centerLon > 180) lon -= 360;
      while (lon - v.centerLon < -180) lon += 360;
      const x = v.width / 2 + (lon - v.centerLon) * v.scale;
      const y = v.height / 2 + (g.lat - v.centerLat) * v.scale;
      return { x: x / ratio, y: (c.height - y) / ratio };
    };
    const inside = groups.map(pos).filter((p) => p.x > 40 && p.x < c.clientWidth - 440 && p.y > 80 && p.y < c.clientHeight - 80);
    inside.sort((p, q) => Math.hypot(p.x - c.clientWidth / 2, p.y - c.clientHeight / 2) - Math.hypot(q.x - c.clientWidth / 2, q.y - c.clientHeight / 2));
    return inside[0] ?? null;
  }, species);
  const open = () => page.evaluate(() => !document.getElementById('fiche').hidden);

  await page.evaluate(() => { const a = window.vacarme; a.cfg.display.mode = 'flat'; a.nav.goTo(0, 20, 1); });
  await page.waitForTimeout(1500);
  for (const species of ['blue', 'fin', 'humpback', 'sperm', 'orca']) {
    const p = await target(species);
    if (!p) { fail(`${species} : aucun groupe visible`); continue; }
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(600);
    const title = await page.evaluate(() => document.querySelector('#fiche h2')?.textContent?.trim() ?? '');
    if (!(await open())) { fail(`${species} : la fiche ne s'ouvre pas au clic (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`); continue; }
    // Le son de la fiche : la lecture avance.
    await page.click('#fiche [data-sound="0"]');
    await page.waitForTimeout(1200);
    const played = await page.evaluate(() => parseFloat(document.querySelector('#fiche .fc-spectro i').style.left) || 0);
    if (played <= 0) fail(`${species} : le son de la fiche ne se lit pas`);
    await page.screenshot({ path: `${out}/fiche-${species}.jpg`, type: 'jpeg', quality: 82 });
    console.log(`${species} : « ${title.replace(/\s+/g, ' ')} » · lecture ${played.toFixed(0)} %`);
    await page.click('#fiche .fc-close');
  }

  // Un glissé n'ouvre pas de fiche ; un clic dans le vide la ferme.
  const p = await target('fin');
  if (p) {
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 40, p.y + 10, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    if (await open()) fail('un glissé a ouvert une fiche');
    await page.evaluate(() => window.vacarme.nav.goTo(0, 20, 1));
    await page.waitForTimeout(800);
    const q = await target('fin');
    await page.mouse.click(q.x, q.y);
    await page.waitForTimeout(300);
    await page.mouse.click(30, height - 30);
    await page.waitForTimeout(300);
    if (await open()) fail('un clic dans le vide ne ferme pas la fiche');
  }
} finally {
  await browser.close();
}
if (errors.length) {
  console.error('Erreurs :\n' + errors.join('\n'));
  process.exit(1);
}
console.log(`captures : ${out}`);

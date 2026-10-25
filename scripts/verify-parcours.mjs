// Vérification des parcours (prototypes de l'issue #4) : chaque parcours démarre, enchaîne ses étapes (légende,
// scénario, fiche), une capture par étape ; un geste du visiteur l'arrête et restaure l'état d'avant ; la boucle
// d'attraction démarre seule après l'inactivité. Serveur de développement actif (npm run dev) ou build web servi
// (VACARME_URL), Chromium installé.
//
//   CHROMIUM_PATH=/chemin/chrome node scripts/verify-parcours.mjs
//
// Variables : VACARME_URL (http://localhost:5173/), CAPTURE_DIR (/tmp/parcours), MODE (flat | globe | hemisphere),
// ONLY (ids de parcours, séparés par des virgules).
import { mkdirSync } from 'node:fs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const url = process.env.VACARME_URL ?? 'http://localhost:5173/';
const out = process.env.CAPTURE_DIR ?? '/tmp/parcours';
const mode = process.env.MODE ?? 'flat';
const only = process.env.ONLY?.split(',');
mkdirSync(out, { recursive: true });
const args = ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--autoplay-policy=no-user-gesture-required'];
const errors = [];
const fail = (msg) => { errors.push(msg); console.log(`ÉCHEC ${msg}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404') && !m.text().includes('GPU stall')) errors.push(m.text()); });
  await page.goto(`${url}?quality=expo&mode=${mode}`);
  await page.waitForFunction(() => window.vacarme && window.vacarme.whales && window.vacarme.warmupTotal > 0 && window.vacarme.warmupLeft === 0 && window.vacarme.story.ids.length > 0 && window.vacarme.lieux.lieux.length > 0, null, { timeout: 120000 });
  const ids = (await page.evaluate(() => window.vacarme.story.ids)).filter((id) => !only || only.includes(id));

  for (const id of ids) {
    const steps = await page.evaluate((id) => {
      const a = window.vacarme;
      a.cfg.scenario = 'actuel';
      a.cfg.noise.visible = true;
      a.story.start(id);
      return a.story.story.steps.map((s) => s.duration);
    }, id);
    for (let i = 0; i < steps.length; i++) {
      // Milieu de l'étape : la caméra a fini son vol.
      await page.waitForTimeout(Math.min(steps[i] / 2, 7) * 1000);
      const state = await page.evaluate(() => {
        const a = window.vacarme;
        return {
          caption: document.querySelector('#recit .rc-caption')?.textContent?.trim() ?? '',
          meta: document.querySelector('#recit .rc-meta')?.textContent ?? '',
          scenario: a.cfg.scenario,
          fiche: document.getElementById('fiche').hidden ? '' : document.querySelector('#fiche h2')?.firstChild?.textContent?.trim(),
        };
      });
      if (!state.meta.includes(`${i + 1}/${steps.length}`)) fail(`${id} : étape ${i + 1} attendue, « ${state.meta} »`);
      console.log(`${id} ${i + 1}/${steps.length} · ${state.scenario}${state.fiche ? ` · fiche « ${state.fiche} »` : ''} · ${state.caption.slice(0, 80)}`);
      await page.screenshot({ path: `${out}/${id}-${mode}-${i + 1}.jpg`, type: 'jpeg', quality: 78 });
      // Fin de l'étape, pour passer à la suivante.
      await page.waitForTimeout(Math.max(0, steps[i] - Math.min(steps[i] / 2, 7)) * 1000 + 300);
    }
    // Un geste du visiteur arrête le parcours et restaure l'état d'avant.
    await page.evaluate(() => { window.vacarme.story.saved.scenario = 'actuel'; });
    await page.mouse.click(30, 870);
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({ playing: window.vacarme.story.playing, scenario: window.vacarme.cfg.scenario, recit: !document.getElementById('recit').hidden }));
    if (after.playing || after.recit || after.scenario !== 'actuel') fail(`${id} : le geste ne rend pas la main (${JSON.stringify(after)})`);
  }

  // Boucle d'attraction : démarre seule après l'inactivité.
  await page.evaluate(() => { const a = window.vacarme; a.cfg.parcours.attract = 'avant-apres'; a.cfg.parcours.idleSec = 10; a.lastInput = performance.now() - 9000; });
  await page.waitForTimeout(2500);
  const attract = await page.evaluate(() => window.vacarme.story.playing && window.vacarme.story.story.id);
  if (attract !== 'avant-apres') fail(`boucle d'attraction non démarrée (${attract})`);
  else console.log('boucle d\'attraction : démarrée après l\'inactivité');
} finally {
  await browser.close();
}
if (errors.length) {
  console.error('Erreurs :\n' + errors.join('\n'));
  process.exit(1);
}
console.log(`captures : ${out}`);

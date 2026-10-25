// Vérification du monde illustré : captures de référence dans tous les modes et mesure du temps d'image.
// Serveur de développement actif ; Playwright Core disponible séparément (PLAYWRIGHT_MODULE) et un Chromium.
// Sur le portable de l'exposition, Chromium sans fenêtre utilise la Radeon 780M via Vulkan : la mesure est réelle.
//
//   PLAYWRIGHT_MODULE=/chemin/playwright-core/index.mjs CHROMIUM_PATH=/chemin/chrome node scripts/verify-illustrated.mjs
//
// Variables : VACARME_URL (http://localhost:5173/), CAPTURE_DIR (docs/captures/monde-illustre), ONLY (liste de vues),
// PERF=0 pour sauter la mesure.
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const out = process.env.CAPTURE_DIR ?? `${root}/docs/captures/monde-illustre`;
mkdirSync(out, { recursive: true });
const url = process.env.VACARME_URL ?? 'http://localhost:5173/';
const gpuArgs = ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan'];

const views = {
  'hemisphere-nuit': { mode: 'hemisphere', theme: 'night', lon: -60 },
  'hemisphere-jour': { mode: 'hemisphere', theme: 'day', lon: -60 },
  'globe-jour': { mode: 'globe', theme: 'day', lon: -20 },
  'globe-nuit': { mode: 'globe', theme: 'night', lon: -20 },
  'globe-asie': { mode: 'globe', theme: 'day', lon: 100 },
  'fisheye-jour': { mode: 'fisheye', theme: 'day', lon: 20 },
  'equirect-nuit': { mode: 'equirect', theme: 'night' },
  'carte-nuit': { mode: 'flat', theme: 'night', go: [0, 8, 1] },
  'carte-jour': { mode: 'flat', theme: 'day', go: [0, 8, 1] },
  'andes': { mode: 'flat', theme: 'day', go: [-70, -18, 9] },
  'alpes': { mode: 'flat', theme: 'day', go: [10, 46, 6] },
  'himalaya': { mode: 'flat', theme: 'day', go: [86, 30, 10] },
  'amazonie': { mode: 'flat', theme: 'day', go: [-60, -6, 18] },
  'indonesie-nuit': { mode: 'flat', theme: 'night', go: [115, -4, 8] },
  'sahara': { mode: 'flat', theme: 'day', go: [10, 22, 8] },
  'gouache-comparaison': { mode: 'globe', theme: 'day', lon: -20, style: 'gouache' },
  'aplat-comparaison': { mode: 'globe', theme: 'night', lon: -20, style: 'flat' },
};
const only = process.env.ONLY?.split(',');

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: gpuArgs });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404') && !m.text().includes('GPU stall')) errors.push(m.text()); });
  await page.goto(`${url}?quality=expo`);
  await page.waitForFunction(() => window.vacarme, { timeout: 90000 });
  console.log('GPU :', await page.evaluate(() => {
    const gl = window.vacarme.renderer.getContext();
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'inconnu';
  }));
  await page.evaluate(() => { window.vacarme.cfg.audio.enabled = false; });
  for (const [name, v] of Object.entries(views)) {
    if (only && !only.includes(name)) continue;
    await page.evaluate((v) => {
      const a = window.vacarme;
      a.cfg.display.mode = v.mode;
      a.cfg.display.theme = v.theme;
      a.cfg.land.style = v.style ?? 'illustre';
      if (v.go) a.nav.goTo(...v.go);
      if (v.lon !== undefined) a.globeCtl.facingLon = v.lon;
    }, v);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 88 });
    console.log('capture', name);
  }
  await page.evaluate(() => { window.vacarme.cfg.land.style = 'illustre'; });
} finally {
  await browser.close();
}

// Temps d'image en 1920×1200 (cible projecteur), sans limite à 60 images/s, GPU vidé à chaque image.
if (process.env.PERF !== '0') {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: [...gpuArgs, '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
  try {
    for (const quality of ['expo', 'light']) {
      const page = await b.newPage({ viewport: { width: 1920, height: 1200 } });
      await page.goto(`${url}?quality=${quality}&target=projector`);
      await page.waitForFunction(() => window.vacarme, { timeout: 90000 });
      for (const mode of ['hemisphere', 'globe', 'flat'])
        for (const style of ['flat', 'gouache', 'illustre']) {
          const ms = await page.evaluate(async ({ mode, style }) => {
            const a = window.vacarme;
            a.cfg.audio.enabled = false;
            a.cfg.display.mode = mode;
            a.cfg.display.theme = 'night';
            a.cfg.land.style = style;
            await new Promise((r) => setTimeout(r, 1200));
            const gl = a.renderer.getContext();
            const t = [];
            let last = performance.now();
            for (let i = 0; i < 120; i++) {
              await new Promise((r) => requestAnimationFrame(r));
              gl.finish();
              const n = performance.now();
              t.push(n - last);
              last = n;
            }
            t.sort((p, q) => p - q);
            return [t[60], t[108]];
          }, { mode, style });
          console.log(`${quality.padEnd(5)} ${mode.padEnd(10)} ${style.padEnd(8)} médiane ${ms[0].toFixed(1)} ms   90e centile ${ms[1].toFixed(1)} ms`);
        }
      await page.close();
    }
  } finally {
    await b.close();
  }
}
if (errors.length) {
  console.error('ERREURS :', errors);
  process.exit(1);
}
console.log('aucune erreur JavaScript/GLSL');

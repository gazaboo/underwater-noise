// Vérification de la représentation du bruit, des cétacés et des navires : captures de référence et temps
// d'image. Serveur de développement actif (npm run dev) ou build web servi (VACARME_URL), Chromium installé.
// Sur le portable de l'exposition, Chromium sans fenêtre utilise la Radeon 780M via Vulkan : mesure réelle.
//
//   CHROMIUM_PATH=/chemin/chrome node scripts/verify-representation.mjs
//
// Variables : VACARME_URL (http://localhost:5173/), CAPTURE_DIR (docs/captures/representation), ONLY (vues),
// PERF=0 pour sauter la mesure. Les temps d'image sont mesurés à la cadence normale (60 Hz, comme le kiosque) :
// sans limite de cadence, le processeur empile des images d'avance et toute relecture attend la file GPU.
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const out = process.env.CAPTURE_DIR ?? `${root}/docs/captures/representation`;
mkdirSync(out, { recursive: true });
const url = process.env.VACARME_URL ?? 'http://localhost:5173/';
const gpuArgs = ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan'];

const views = {
  'isophones-carte-nuit': { mode: 'flat', theme: 'night', style: 'isophones', go: [0, 30, 1] },
  'meteo-carte-nuit': { mode: 'flat', theme: 'night', style: 'meteo', go: [0, 30, 1] },
  'encre-carte-nuit': { mode: 'flat', theme: 'night', style: 'encre', go: [0, 30, 1], wait: 5000 },
  'fronts-carte-nuit': { mode: 'flat', theme: 'night', style: 'fronts', go: [0, 30, 1] },
  'isophones-carte-jour': { mode: 'flat', theme: 'day', style: 'isophones', go: [0, 30, 1] },
  'isophones-globe-nuit': { mode: 'globe', theme: 'night', style: 'isophones', lon: -30 },
  'meteo-demi-sphere-nuit': { mode: 'hemisphere', theme: 'night', style: 'meteo', lon: -30 },
  'isophones-demi-sphere-jour': { mode: 'hemisphere', theme: 'day', style: 'isophones', lon: -30 },
  'cetaces-vue-rapprochee': { mode: 'flat', theme: 'night', style: 'isophones', go: [-62, 42, 7], wait: 4000 },
  'cetaces-vue-rapprochee-jour': { mode: 'flat', theme: 'day', style: 'meteo', go: [-62, 42, 7], wait: 3000 },
};
const only = process.env.ONLY?.split(',');
const errors = [];

const ready = () => window.vacarme && window.vacarme.ships.shipCount > 0 && window.vacarme.warmupTotal > 0 && window.vacarme.warmupLeft === 0;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: gpuArgs });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404') && !m.text().includes('GPU stall')) errors.push(m.text()); });
  await page.goto(`${url}?quality=expo`);
  await page.waitForFunction(ready, null, { timeout: 120000 });
  await page.evaluate(() => { window.vacarme.cfg.audio.enabled = false; });
  for (const [name, v] of Object.entries(views)) {
    if (only && !only.includes(name)) continue;
    await page.evaluate((v) => {
      const a = window.vacarme;
      a.cfg.display.mode = v.mode;
      a.cfg.display.theme = v.theme;
      a.cfg.noise.style = v.style;
      if (v.go) a.nav.goTo(...v.go);
      if (v.lon !== undefined) a.globeCtl.facingLon = v.lon;
    }, v);
    await page.waitForTimeout(v.wait ?? 2500);
    await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 85 });
    console.log('capture', name);
  }
} finally {
  await browser.close();
}

if (process.env.PERF !== '0') {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: gpuArgs });
  try {
    const page = await b.newPage({ viewport: { width: 1920, height: 1200 } });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${url}?quality=expo&target=projector`);
    await page.waitForFunction(ready, null, { timeout: 120000 });
    console.log('GPU :', await page.evaluate(() => {
      const gl = window.vacarme.renderer.getContext();
      const e = gl.getExtension('WEBGL_debug_renderer_info');
      return `${e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'inconnu'} · ${window.vacarme.ships.shipCount} navires`;
    }));
    for (const mode of ['hemisphere', 'globe', 'flat'])
      for (const style of ['isophones', 'meteo', 'encre', 'fronts']) {
        const r = await page.evaluate(async ({ mode, style }) => {
          const a = window.vacarme;
          a.cfg.audio.enabled = false;
          a.cfg.display.mode = mode;
          a.cfg.display.theme = 'night';
          a.cfg.noise.style = style;
          await new Promise((res) => setTimeout(res, 1500));
          const t = [];
          let last = performance.now();
          const t0 = last;
          while (performance.now() - t0 < 6000) {
            await new Promise((res) => requestAnimationFrame(res));
            const n = performance.now();
            t.push(n - last);
            last = n;
          }
          t.sort((p, q) => p - q);
          return { n: t.length, med: t[t.length >> 1], p99: t[Math.floor(t.length * 0.99)], max: t.at(-1), slow: t.filter((x) => x > 34).length };
        }, { mode, style });
        console.log(`${mode.padEnd(10)} ${style.padEnd(9)} ${r.n} images · médiane ${r.med.toFixed(1)} ms · p99 ${r.p99.toFixed(1)} ms · max ${r.max.toFixed(0)} ms · > 34 ms : ${r.slow}`);
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

// Captures de l'interface et contrôles de mise en page : aucun recouvrement entre les blocs HTML (légende,
// commandes, fiche, récit, fiabilité), cibles tactiles d'au moins 44 px sur téléphone. À lancer sur le build web
// servi en statique (npm run build:web, puis un serveur de fichiers sur client/dist-web), Chromium installé.
//
//   CHROMIUM_PATH=/chemin/chrome VACARME_URL=http://127.0.0.1:8765/ node scripts/capture-ui.mjs
//
// Variables : VACARME_URL (http://127.0.0.1:8765/), CAPTURE_DIR (/tmp/ui).
import { mkdirSync } from 'node:fs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
const url = process.env.VACARME_URL ?? 'http://127.0.0.1:8765/';
const out = process.env.CAPTURE_DIR ?? '/tmp/ui';
mkdirSync(out, { recursive: true });
const args = ['--no-sandbox', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--autoplay-policy=no-user-gesture-required'];
const errors = [];
const fail = (msg) => { errors.push(msg); console.log(`ÉCHEC ${msg}`); };
const BLOCKS = ['#toolbar', '#legend', '#science', '#fiche', '#recit', '#accueil', '#ecoute', '#titre'];

/** Recouvrements entre blocs visibles (plus de 4 px dans chaque direction), et cibles tactiles trop petites. */
async function check(page, name, touch) {
  const res = await page.evaluate(([blocks, touch]) => {
    const shown = (el) => {
      if (!el || el.hidden) return false;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    };
    // Un bloc est mesuré par ses enfants visibles : #recit et #toolbar sont plus larges que leur contenu.
    const rects = blocks.map((sel) => {
      const el = document.querySelector(sel);
      if (!shown(el)) return null;
      const kids = [...el.children].filter(shown).map((k) => k.getBoundingClientRect());
      const rs = sel === '#toolbar' || sel === '#recit' ? kids : [el.getBoundingClientRect()];
      return { sel, rs: rs.map((r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom })) };
    }).filter(Boolean);
    const overlaps = [];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const hit = rects[i].rs.some((a) => rects[j].rs.some((b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 4 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 4));
        if (hit) overlaps.push(`${rects[i].sel} / ${rects[j].sel}`);
      }
    }
    const small = touch ? [...document.querySelectorAll('button')].filter(shown).filter((b) => { const r = b.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).map((b) => `« ${b.textContent.trim() || b.getAttribute('aria-label')} » ${Math.round(b.getBoundingClientRect().width)}×${Math.round(b.getBoundingClientRect().height)}`) : [];
    const clipped = [...document.querySelectorAll('#toolbar, #legend, #fiche')].filter(shown).filter((el) => { const r = el.getBoundingClientRect(); return r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1; }).map((el) => `#${el.id}`);
    return { overlaps, small, clipped };
  }, [BLOCKS, touch]);
  for (const o of res.overlaps) fail(`${name} : recouvrement ${o}`);
  for (const s of res.small) fail(`${name} : cible tactile trop petite ${s}`);
  for (const c of res.clipped) fail(`${name} : ${c} dépasse de l'écran`);
  await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 84 });
  console.log(`${name} : ${res.overlaps.length + res.small.length + res.clipped.length ? 'à corriger' : 'ok'}`);
}

const ready = (page) => page.waitForFunction(() => window.vacarme && window.vacarme.whales && window.vacarme.warmupTotal > 0 && window.vacarme.warmupLeft === 0, null, { timeout: 180000 });
const openCard = (page, species) => page.evaluate((species) => { const a = window.vacarme; a.card.open(a.whales.agents.groups.find((g) => g.species.id === species), a.cfg); }, species);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args });
try {
  for (const [label, viewport, touch] of [['bureau', { width: 1440, height: 900 }, false], ['portable', { width: 1100, height: 700 }, false], ['tablette', { width: 900, height: 700 }, true], ['telephone', { width: 390, height: 844 }, true]]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: touch && viewport.width < 500 ? 2 : 1, isMobile: touch && viewport.width < 500, hasTouch: touch });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => fail(`${label} : ${e.message}`));
    await page.goto(url);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/${label}-0-chargement.jpg`, type: 'jpeg', quality: 84 });
    await ready(page);
    await page.waitForTimeout(2500);
    await check(page, `${label}-1-accueil`, touch);
    // L'accueil, s'il existe, se ferme par « Explorer ».
    await page.evaluate(() => document.querySelector('#accueil [data-action="explorer"]')?.click());
    await page.waitForTimeout(1500);
    await check(page, `${label}-2-explorer`, touch);
    await page.evaluate(() => { const a = window.vacarme; a.cfg.display.mode = 'flat'; a.nav.goTo(0, 20, 1); });
    await page.waitForTimeout(2000);
    await check(page, `${label}-3-carte`, touch);
    await openCard(page, 'humpback');
    await page.waitForTimeout(1200);
    await check(page, `${label}-4-fiche`, touch);
    await page.evaluate(() => { const a = window.vacarme; a.card.close(); a.cfg.display.mode = 'globe'; a.story.start(); });
    await page.waitForTimeout(7000);
    await check(page, `${label}-5-visite`, touch);
    await page.evaluate(() => { const a = window.vacarme; a.story.stop(); a.cfg.scenario = 'sans-navires'; });
    await page.waitForTimeout(4000);
    await check(page, `${label}-6-sans-navires`, touch);
    if (label === 'bureau') {
      console.log(`rendu ${await page.evaluate(() => `${window.vacarme.renderer.domElement.width}×${window.vacarme.renderer.domElement.height}, thème ${window.vacarme.cfg.display.theme}, style ${window.vacarme.cfg.noise.style}`)}`);
      await page.evaluate(() => { const a = window.vacarme; a.cfg.scenario = 'actuel'; a.cfg.display.theme = 'night'; a.cfg.display.mode = 'hemisphere'; });
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${out}/${label}-7-demi-sphere-nuit.jpg`, type: 'jpeg', quality: 84 });
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(errors.length ? `\n${errors.length} problème(s)` : '\nCaptures et mise en page : OK');
process.exit(errors.length ? 1 : 0);

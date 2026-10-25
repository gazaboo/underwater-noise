/**
 * Build du mode web autonome (npm run build:web) : une page statique, sans serveur Node, qui calcule les
 * navires dans le navigateur (replay de l'AIS enregistré, simulation, navires estimés).
 *
 *   client/dist-web/index.html, assets/…   page compilée (base relative : se sert depuis n'importe quel dossier)
 *   client/dist-web/config.json            configuration résolue pour la cible « web » (sans config/local.json5)
 *   client/dist-web/data/…                 sous-ensemble de data/ utilisé par la page
 *
 * Vérifier localement : npx vite preview --outDir dist-web (dans client/), puis ouvrir l'adresse indiquée.
 * Mettre en ligne est une publication : à faire explicitement, après accord.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deepMerge } from '@vacarme/shared';
import { ConfigStore } from '../server/src/config-store.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'client', 'dist-web');
const DATA = join(ROOT, 'data');

// 1. Page compilée.
rmSync(OUT, { recursive: true, force: true });
const vite = spawnSync(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'web', '--base', './', '--outDir', 'dist-web', '--emptyOutDir'], {
  cwd: join(ROOT, 'client'),
  env: { ...process.env, VITE_STANDALONE: '1' },
  stdio: 'inherit',
});
if (vite.status !== 0) process.exit(vite.status ?? 1);

// 2. Configuration de référence (default.json5 seul : les réglages locaux de l'exposition ne fuient pas).
const configDir = mkdtempSync(join(tmpdir(), 'vacarme-web-'));
copyFileSync(join(ROOT, 'config', 'default.json5'), join(configDir, 'default.json5'));
const base = new ConfigStore(configDir).config;
rmSync(configDir, { recursive: true, force: true });
const config = deepMerge(base, {
  display: { target: 'web', mode: 'globe' },
  // Pas de clé AIS dans une page publique : replay de l'AIS enregistré, sinon simulation.
  // Navires : AIS enregistré là où il existe, navires estimés (GFW) ailleurs.
  source: { mode: 'replay', ships: 'mixed' },
  recorder: { enabled: false },
});
writeFileSync(join(OUT, 'config.json'), JSON.stringify(config));

// 3. Données.
const files = [
  'grid/elevation_4096.png', 'grid/landcover_4096.png', 'grid/land_biome_4096.png', 'grid/land_shape_4096.png',
  'grid/ocean_1024.png', 'grid/ocean_2048.png', `grid/ocean_${config.qualityProfiles[config.display.quality].physicsSimWidth}.png`,
  'grid/volcanoes.json', 'grid/ornaments.json', 'grid/meta.json',
  'ornaments/atlas.json', 'ornaments/atlas.png',
  'routes.json', 'coverage.png', 'science/validation-summary.json',
];
const copy = (rel: string) => {
  const src = join(DATA, rel);
  if (!existsSync(src)) return console.warn(`[web] absent, ignoré : data/${rel}`);
  mkdirSync(dirname(join(OUT, 'data', rel)), { recursive: true });
  cpSync(src, join(OUT, 'data', rel), { recursive: true });
};
for (const f of new Set(files)) copy(f);
copy('habitats');
copy('density');
copy('media');
copy('lieux');
copy('fiches');
copy('parcours');
const replayDir = join(DATA, 'replays');
const replays = existsSync(replayDir) ? readdirSync(replayDir).filter((f) => f.endsWith('.ndjson.gz')).sort() : [];
for (const f of replays) copy(`replays/${f}`);
mkdirSync(join(OUT, 'data', 'replays'), { recursive: true });
writeFileSync(join(OUT, 'data', 'replays', 'manifest.json'), JSON.stringify({ files: replays }));

const size = (p: string): number => (statSync(p).isDirectory() ? readdirSync(p).reduce((s, f) => s + size(join(p, f)), 0) : statSync(p).size);
console.log(`[web] ${relative(ROOT, OUT)} : ${(size(OUT) / 1e6).toFixed(1)} Mo (${replays.length} fichier(s) de replay)`);

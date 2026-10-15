/**
 * Prédiction au point d'un hydrophone, fenêtre par fenêtre, pour les fenêtres exactes des mesures.
 *
 * Modèles :
 *  - world-law    : la loi du moteur mondial (même source J-E, mêmes pertes `lossRateDbPerKm`,
 *                   même étalement `pathTransmissionLoss`, même grille océan 1024 que le GPU,
 *                   même registre AIS que le serveur). Ce n'est pas le champ GPU lui-même : l'écart
 *                   dû à la grille de 39 km est chiffré séparément.
 *  - ram-curves   : pertes RAM pré-calculées au récepteur (63/125 Hz), référence de propagation.
 *  - ambient-only : fond naturel seul (référence de comparaison).
 *
 * Aucune grandeur n'est ajustée sur les mesures : les paramètres viennent du profil de référence,
 * ou d'un fichier `--physics` explicitement fourni (calage, étiqueté comme tel dans la sortie).
 */
import { createReadStream, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import JSON5 from 'json5';
import { PNG } from 'pngjs';
import {
  DEFAULT_BANDS, REFERENCE_PHYSICS, SCIENTIFIC_PROFILE_ID, SHIP_CLASSES, ambientBandLevel, bandCenter, configSchema, decidecadesIn, destination,
  haversine, initialBearing, lossRateDbPerKm, naturalLevel, pathTransmissionLoss, resolveScientificConfig, shipBandLevel, sourceLevelDecidecade, sourceSpectralDensity,
  type LossParams, type ShipClass,
} from '../../shared/src/index.ts';
import { ShipRegistry } from '../../server/src/ais/registry.ts';
import { parseAisMessage } from '../../server/src/ais/parse.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HALF = 10 ** 0.05;
const NOMINAL = [10, 12.5, 16, 20, 25, 31.5, 40, 50, 63, 80];

/** Libellé nominal IEC d'une décidécade (identique à tools/science/ices.py). */
export function nominalLabel(f: number): number {
  const n = Math.round(10 * Math.log10(f));
  return +(NOMINAL[((n % 10) + 10) % 10] * 10 ** (Math.floor(n / 10) - 1)).toPrecision(4);
}

export interface Band {
  id: string;
  kind: 'decidecade' | 'broad';
  /** Bornes effectives (Hz) : bords des décidécades sommées. */
  fMin: number;
  fMax: number;
  /** Décidécades mesurées à sommer pour reconstituer la bande (libellés nominaux). */
  decidecadesHz: number[];
  /** Fréquence où les pertes sont évaluées (bande large : moyenne géométrique, comme le GPU). */
  lossHz: number;
}

export function analysisBands(): Band[] {
  const decidecade = (nominal: number, exact: number): Band => ({ id: `d${nominal}`, kind: 'decidecade', fMin: exact / HALF, fMax: exact * HALF, decidecadesHz: [nominal], lossHz: exact });
  const broad = DEFAULT_BANDS.map((b): Band => {
    const centres = decidecadesIn(b.fMin, b.fMax);
    return { id: b.id, kind: 'broad', fMin: centres[0] / HALF, fMax: centres.at(-1)! * HALF, decidecadesHz: centres.map(nominalLabel), lossHz: bandCenter(b) };
  });
  return [decidecade(63, 10 ** 1.8), decidecade(125, 10 ** 2.1), ...broad];
}

/** Grille océan du moteur mondial (R mer, G profondeur log), lue au plus proche comme le GPU. */
export class OceanGrid {
  readonly width: number;
  readonly height: number;
  readonly cellMeters: number;
  private readonly data: Buffer;
  constructor(source: string | { width: number; height: number; data: Buffer }) {
    const png = typeof source === 'string' ? PNG.sync.read(readFileSync(source)) : source;
    this.width = png.width; this.height = png.height; this.data = png.data;
    this.cellMeters = (180 / this.height) * Math.PI * 6_371_000 / 180;
  }
  at(lat: number, lon: number): { sea: boolean; depthM: number } {
    const x = Math.min(this.width - 1, Math.floor((((lon + 180) % 360 + 360) % 360) / 360 * this.width));
    const y = Math.min(this.height - 1, Math.max(0, Math.floor((90 - lat) / 180 * this.height)));
    const i = 4 * (y * this.width + x);
    return { sea: this.data[i] >= 128, depthM: 10 * 1100 ** (this.data[i + 1] / 255) };
  }
}

/** Perte de la loi mondiale entre un navire et le récepteur ; null si le trajet traverse la terre. */
export function worldLawLoss(grid: OceanGrid, ship: { lat: number; lon: number }, rx: { lat: number; lon: number }, fHz: number, physics: LossParams, minRangeM = 0): { lossDb: number; rangeM: number } | null {
  const range = haversine(ship.lat, ship.lon, rx.lat, rx.lon);
  const bearing = initialBearing(ship.lat, ship.lon, rx.lat, rx.lon);
  const steps = Math.max(2, Math.ceil(range / (grid.cellMeters / 2)));
  const rates: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const [lat, lon] = destination(ship.lat, ship.lon, bearing, (range * i) / steps);
    const cell = grid.at(lat, lon);
    if (!cell.sea) return null;
    rates.push(lossRateDbPerKm(cell.depthM, fHz, physics));
  }
  // GPU : r_t = profondeur de la cellule source, au moins 10 m (physAmplitude).
  const rt = Math.max(10, grid.at(ship.lat, ship.lon).depthM);
  const r = Math.max(range, minRangeM);
  return { lossDb: pathTransmissionLoss(r, rt, rates), rangeM: range };
}

interface RamCurves { bands: { frequencyHz: number; widthHz: number; rangesM: number[]; lossDb: number[] }[][]; provenance: unknown; numerical: unknown }

function ramLoss(q: RamCurves['bands'][number][number], r: number): number | null {
  const ranges = q.rangesM;
  if (r < ranges[0] || r > ranges.at(-1)!) return null;
  let lo = 0, hi = ranges.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ranges[mid] <= r) lo = mid; else hi = mid; }
  const w = (r - ranges[lo]) / (ranges[hi] - ranges[lo]);
  return -10 * Math.log10((1 - w) * 10 ** (-q.lossDb[lo] / 10) + w * 10 ** (-q.lossDb[hi] / 10));
}

/** Vent : série horaire Open-Meteo (m/s) interpolée linéairement au milieu de la fenêtre. */
function windAt(hourly: { time: string[]; wind_speed_10m: number[] }, t: number): number | null {
  const times = hourly.time.map(s => Date.parse(s.endsWith('Z') ? s : `${s}Z`));
  for (let i = 0; i + 1 < times.length; i++) {
    if (t >= times[i] && t <= times[i + 1]) {
      const a = hourly.wind_speed_10m[i], b = hourly.wind_speed_10m[i + 1];
      if (a == null || b == null) return null;
      return a + (b - a) * (t - times[i]) / (times[i + 1] - times[i]);
    }
  }
  return null;
}

function readWindows(csvPath: string, from: number, to: number): [number, number][] {
  const lines = readFileSync(csvPath, 'utf8').trim().split('\n');
  const header = lines[0].split(',');
  const si = header.indexOf('start'), ei = header.indexOf('end');
  const seen = new Map<number, number>();
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const s = Date.parse(cols[si]), e = Date.parse(cols[ei]);
    if (s >= from && e <= to) seen.set(s, e);
  }
  return [...seen].sort((a, b) => a[0] - b[0]);
}

async function main(): Promise<void> {
  const { values: a } = parseArgs({ options: {
    station: { type: 'string' }, observations: { type: 'string' }, replay: { type: 'string' }, wind: { type: 'string' },
    model: { type: 'string', default: 'world-law' }, 'ram-curves': { type: 'string' }, physics: { type: 'string' },
    from: { type: 'string' }, to: { type: 'string' }, out: { type: 'string' },
    'radius-km': { type: 'string', default: '300' }, 'min-range-m': { type: 'string', default: '0' }, 'scenario-wind': { type: 'string' },
    'sample-sec': { type: 'string', default: '10' }, 'liveness-sec': { type: 'string', default: '120' },
  } });
  if (!a.station || !a.observations || !a.out || !a.from || !a.to) throw new Error('Usage : point-predict.ts --station stations/x.json --observations obs.csv --replay ais.ndjson.gz --wind wind.json --from ISO --to ISO --out pred.json [--model world-law|ram-curves|ambient-only]');
  const model = a.model as 'world-law' | 'ram-curves' | 'ambient-only';
  if (!['world-law', 'ram-curves', 'ambient-only'].includes(model)) throw new Error(`Modèle inconnu : ${model}`);
  const stationText = readFileSync(a.station, 'utf8');
  const station = JSON.parse(stationText) as { id: string; deployment: { station: string; lat: number; lon: number; receiverDepthM: number } };
  const rx = station.deployment;
  const from = Date.parse(a.from), to = Date.parse(a.to);
  const windows = readWindows(a.observations, from, to);
  if (!windows.length) throw new Error('Aucune fenêtre de mesure dans la période demandée.');

  // Profil de référence, ou paramètres calés explicitement fournis (jamais implicites).
  const cfg = resolveScientificConfig(configSchema.parse(JSON5.parse(readFileSync(join(ROOT, 'config/default.json5'), 'utf8'))));
  const physicsFile = a.physics ? JSON.parse(readFileSync(a.physics, 'utf8')) as { label: string; physics: LossParams } : null;
  const physics: LossParams = physicsFile ? { ...REFERENCE_PHYSICS, ...physicsFile.physics } : { ...REFERENCE_PHYSICS };
  const bands = analysisBands();
  const grid = new OceanGrid(join(ROOT, `data/grid/ocean_${cfg.qualityProfiles.expo.physicsSimWidth}.png`));
  const ram = a['ram-curves'] ? JSON.parse(readFileSync(a['ram-curves'], 'utf8')) as RamCurves : null;
  if (model === 'ram-curves' && !ram) throw new Error('--ram-curves requis');
  const windText = a.wind ? readFileSync(a.wind, 'utf8') : '';
  const wind = a.wind ? JSON.parse(windText) as { hourly: { time: string[]; wind_speed_10m: number[] }; hourly_units?: { wind_speed_10m: string }; latitude: number; longitude: number } : null;
  if (wind && wind.hourly_units?.wind_speed_10m !== 'm/s') throw new Error('Vent en m/s requis (Open-Meteo wind_speed_unit=ms).');
  const scenarioWind = a['scenario-wind'] !== undefined ? Number(a['scenario-wind']) : null;
  if (!wind && scenarioWind === null) throw new Error('--wind (série observée) ou --scenario-wind (m/s) requis.');
  const radius = Number(a['radius-km']) * 1000, minRange = Number(a['min-range-m']), sampleSec = Number(a['sample-sec']), liveness = Number(a['liveness-sec']) * 1000;

  // Instants d'échantillonnage : milieux de pas réguliers dans chaque fenêtre.
  const samples = windows.flatMap(([s, e], w) => Array.from({ length: Math.round((e - s) / 1000 / sampleSec) }, (_, k) => ({ w, t: s + (k + 0.5) * sampleSec * 1000 })));
  const live = cfg.live;
  const registry = new ShipRegistry({ staleAfterMin: live.staleAfterMin, maxExtrapolateMin: live.maxExtrapolateMin, evictAfterMin: live.evictAfterMin, includeMoored: live.includeMoored, bands: cfg.bands });
  const energy = windows.map(() => bands.map(() => 0));
  const diag = windows.map(() => ({ ships: 0, inRadius: 0, blocked: 0, outOfCurves: 0, nearestM: Infinity, aisSilent: false }));

  const contribute = (w: number, ships: ReturnType<ShipRegistry['snapshot']>, weight: number) => {
    for (const ship of ships) {
      const d = diag[w]; d.ships++;
      const range = haversine(ship.lat, ship.lon, rx.lat, rx.lon);
      if (range > radius) continue;
      d.inRadius++; d.nearestM = Math.min(d.nearestM, range);
      if (model === 'ambient-only') continue;
      const cls = SHIP_CLASSES[ship.classIndex] as ShipClass, length = ship.lengthM || undefined;
      for (const [b, band] of bands.entries()) {
        if (model === 'world-law') {
          const loss = worldLawLoss(grid, ship, rx, band.lossHz, physics, minRange);
          if (!loss) { if (b === 0) d.blocked++; continue; }
          const sl = band.kind === 'decidecade' ? sourceLevelDecidecade(band.lossHz, ship.sog, length, cls) : shipBandLevel(band, ship.sog, length, cls);
          energy[w][b] += weight * 10 ** ((sl - loss.lossDb) / 10);
        } else if (band.kind === 'decidecade') {
          // RAM : quadrature de la bande, densité spectrale J-E × largeur, pertes interpolées en énergie.
          const quad = ram!.bands[band.id === 'd63' ? 0 : 1];
          let e = 0, ok = true;
          for (const q of quad) {
            const loss = ramLoss(q, range);
            if (loss === null) { ok = false; break; }
            e += q.widthHz * 10 ** ((sourceSpectralDensity(q.frequencyHz, ship.sog, length, cls) - loss) / 10);
          }
          if (ok) energy[w][b] += weight * e; else if (b === 0) d.outOfCurves++;
        }
      }
    }
  };

  let lastPosition = -Infinity, previous = -Infinity, next = 0;
  const flushUntil = (t: number) => {
    while (next < samples.length && samples[next].t <= t) {
      const { w, t: ts } = samples[next++];
      if (ts - lastPosition > liveness) diag[w].aisSilent = true;
      contribute(w, registry.snapshot(ts), 1 / Math.round((windows[w][1] - windows[w][0]) / 1000 / sampleSec));
    }
  };
  if (a.replay) {
    const file = createReadStream(a.replay);
    const lines = createInterface({ input: a.replay.endsWith('.gz') ? file.pipe(createGunzip()) : file, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      const record = JSON.parse(line) as { t: number; m: unknown };
      if (!Number.isFinite(record.t) || record.t < previous) throw new Error('Replay non trié ou horodatage invalide.');
      previous = record.t;
      flushUntil(record.t - 1);
      if (next >= samples.length) break;
      for (const event of parseAisMessage(record.m)) { registry.apply(event, record.t); if (event.kind === 'position') lastPosition = record.t; }
    }
  } else if (model !== 'ambient-only') throw new Error('--replay requis');
  flushUntil(Infinity);

  const out = windows.map(([s, e], w) => {
    const mid = (s + e) / 2;
    const windMs = wind ? windAt(wind.hourly, mid) : scenarioWind;
    const status = windMs === null ? 'missing-wind' : model !== 'ambient-only' && diag[w].aisSilent ? 'missing-ais' : 'ok';
    const ambientDb = bands.map(b => windMs === null ? null
      // Bande large : exactement ce que l'œuvre calcule (naturalLevel sur fMin–fMax de la configuration) ;
      // décidécade : intégrale sur ses bords exacts.
      : b.kind === 'broad' ? naturalLevel(DEFAULT_BANDS.find(d => d.id === b.id)!, windMs) : ambientBandLevel(b.fMin, b.fMax, windMs));
    const shipsDb = bands.map((b, i) => model === 'ambient-only' || (model === 'ram-curves' && b.kind === 'broad') ? null : energy[w][i] > 0 ? 10 * Math.log10(energy[w][i]) : -Infinity);
    const d = diag[w];
    return { start: new Date(s).toISOString(), end: new Date(e).toISOString(), status, windMs, shipsDb: shipsDb.map(v => v === -Infinity ? 'zero' : v), ambientDb,
      diagnostics: { shipSamples: d.ships, inRadius: d.inRadius, blockedByLand: d.blocked, outOfCurves: d.outOfCurves, nearestM: Number.isFinite(d.nearestM) ? Math.round(d.nearestM) : null } };
  });
  const prediction = {
    schema: 'vacarme-point-prediction/1', model, profileId: physicsFile ? `${SCIENTIFIC_PROFILE_ID}+${physicsFile.label}` : SCIENTIFIC_PROFILE_ID,
    station: { id: station.id, ...rx }, bands,
    parameters: { physics, physicsSource: physicsFile ? `calage : ${physicsFile.label}` : 'profil de référence (non calé)', radiusM: radius, minRangeM: minRange, sampleSec, aisLivenessSec: liveness / 1000,
      registry: { staleAfterMin: live.staleAfterMin, maxExtrapolateMin: live.maxExtrapolateMin, evictAfterMin: live.evictAfterMin, includeMoored: live.includeMoored },
      wind: wind ? `Open-Meteo archive (ERA5), point ${wind.latitude}, ${wind.longitude}, interpolation linéaire horaire` : `scénario uniforme ${scenarioWind} m/s`,
      grid: model === 'world-law' ? `data/grid/ocean_${grid.width}.png (cellule ${(grid.cellMeters / 1000).toFixed(1)} km)` : null },
    inputHashes: {
      station: createHash('sha256').update(stationText).digest('hex'), observations: createHash('sha256').update(readFileSync(a.observations)).digest('hex'),
      replay: a.replay ? createHash('sha256').update(readFileSync(a.replay)).digest('hex') : null, wind: wind ? createHash('sha256').update(windText).digest('hex') : null,
      ramCurves: a['ram-curves'] ? createHash('sha256').update(readFileSync(a['ram-curves'])).digest('hex') : null,
    },
    ram: ram ? { provenance: ram.provenance, numerical: ram.numerical } : null,
    notes: [
      'shipsDb = "zero" : aucune énergie de navire modélisée (aucun navire dans le rayon ou trajets bloqués), distinct de donnée absente.',
      'Navires à quai exclus et vitesse < 0,5 nœud bornée comme dans le serveur ; trafic non capté par l’AIS absent.',
      model === 'world-law' ? 'Loi du moteur mondial évaluée au point exact (pas de discrétisation 39 km ni de champ proche GPU).' : '',
    ].filter(Boolean),
    windows: out,
  };
  mkdirSync(dirname(a.out), { recursive: true });
  writeFileSync(a.out, JSON.stringify(prediction) + '\n');
  const counts = out.reduce<Record<string, number>>((c, w) => ({ ...c, [w.status]: (c[w.status] ?? 0) + 1 }), {});
  console.log(JSON.stringify({ out: a.out, model, windows: out.length, ...counts }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

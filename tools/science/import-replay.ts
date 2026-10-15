import { createReadStream, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { SHIP_CLASSES, DEFAULT_BANDS, trafficSchema, type RegionalTraffic } from '../../shared/src/index.ts';
import { ShipRegistry } from '../../server/src/ais/registry.ts';
import { parseAisMessage } from '../../server/src/ais/parse.ts';

const [replay, windFile, from, to, output] = process.argv.slice(2);
if (!output) throw new Error('Usage : npx tsx tools/science/import-replay.ts replay.ndjson.gz wind.json START_ISO END_ISO traffic.json');
const start = Date.parse(from), end = Date.parse(to);
if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || start % 1000 || (end - start) % 60000) throw new Error('Période UTC de durée multiple de 60 s requise, alignée à la seconde.');
const winds = JSON.parse(readFileSync(windFile, 'utf8')) as { provenance: string; intervals: { start: string; end: string; windMs: number }[] };
const registry = new ShipRegistry({ staleAfterMin: .5, maxExtrapolateMin: 2, evictAfterMin: 2, includeMoored: false, bands: DEFAULT_BANDS });
const samples: RegionalTraffic['samples'] = [];
let now = start, previous = -Infinity, lastPosition = -Infinity;
const emit = () => {
  const wind = winds.intervals.find(w => Date.parse(w.start) <= now && Date.parse(w.end) >= now + 10000);
  if (!wind) throw new Error(`Vent manquant à ${new Date(now).toISOString()} : aucun scénario inventé.`);
  samples.push({ time: new Date(now).toISOString(), durationSec: 10, windMs: wind.windMs, coverage: now - lastPosition <= 120000 ? 'observed' : 'missing',
    ships: registry.snapshot(now).map(s => ({ lat: s.lat, lon: s.lon, speedKn: s.sog, lengthM: s.lengthM || undefined, shipClass: SHIP_CLASSES[s.classIndex], flags: s.flags })).filter(s => s.speedKn >= .5) });
  now += 10000;
};
const file = createReadStream(replay);
const lines = createInterface({ input: replay.endsWith('.gz') ? file.pipe(createGunzip()) : file, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  const record = JSON.parse(line) as { t: number; m: unknown };
  if (!Number.isFinite(record.t) || record.t < previous) throw new Error('Replay non trié ou horodatage invalide.');
  previous = record.t;
  while (now < record.t && now < end) emit();
  if (now >= end) break;
  for (const event of parseAisMessage(record.m)) { registry.apply(event, record.t); if (event.kind === 'position') lastPosition = record.t; }
}
while (now < end) emit();
const data = trafficSchema.parse({ provenance: `AIS historique : ${replay}`, windProvenance: winds.provenance,
  assumptions: ['Instantanés AIS toutes les 10 s ; maintien de chaque instantané sur les 10 s suivantes.', 'Extrapolation des positions limitée à 2 min, signalée par drapeau ; AIS terrestre potentiellement incomplet.', 'Navires à quai et vitesses inconnues exclus : leur contribution n’est pas estimée par le modèle de transit.', 'Vent uniforme sur le domaine à chaque instant ; origine et période décrites dans windProvenance.'], samples });
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(data) + '\n');
console.log(`${samples.length} échantillons de 10 s, ${samples.filter(s => s.coverage === 'missing').length} sans réception AIS récente.`);

/** Point-receiver validation with a range-dependent lookup in a uniform Pekeris guide.
 * Uses the shared ship spectrum; no fitted offsets or observation-dependent parameters.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { acousticComponents, ambientSpectralDensity, haversine, scientificDatasetSchema, sourceSpectralDensity, trafficSchema } from '../../shared/src/index.ts';

const [curvePath, trafficPath, outputPath, radiusText = '35000'] = process.argv.slice(2);
if (!outputPath) throw new Error('Usage: node --import tsx tools/science/build-case.ts curves.json traffic.json field.json [radiusM]');
const curveText = readFileSync(curvePath, 'utf8'), trafficText = readFileSync(trafficPath, 'utf8');
const curves = JSON.parse(curveText) as { station: { lat: number; lon: number; receiverDepthM: number }; provenance: { environment: string; assumptions: string[] }; bands: { frequencyHz: number; widthHz: number; rangesM: number[]; lossDb: number[] }[][]; numerical: { maxDifferenceDb: number; benchmark: string } };
const traffic = trafficSchema.parse(JSON.parse(trafficText));
const radius = Number(radiusText), origin = Date.parse(traffic.samples[0].time);
if (!Number.isFinite(radius) || radius < 500 || curves.bands.length !== 2) throw new Error('Rayon ou courbes invalides');
function lossAt(q: typeof curves.bands[number][number], r: number): number {
  const ranges = q.rangesM;
  if (r < ranges[0] || r > ranges.at(-1)!) throw new Error('Distance hors pré-calcul');
  let lo = 0, hi = ranges.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ranges[mid] <= r) lo = mid; else hi = mid; }
  const weight = (r - ranges[lo]) / (ranges[hi] - ranges[lo]);
  return -10 * Math.log10((1 - weight) * 10 ** (-q.lossDb[lo] / 10) + weight * 10 ** (-q.lossDb[hi] / 10));
}
const frames = [];
const diagnostics = { samples: traffic.samples.length, movingShipSamples: 0, outsideRadius: 0, staleShipSamples: 0, missingMinutes: 0 };
for (let index = 0; index < traffic.samples.length; index += 6) {
  const samples = traffic.samples.slice(index, index + 6), energy = [0, 0], natural = [0, 0];
  const start = origin + index * 10000;
  let missing = samples.length !== 6 || samples.some((s, j) => s.coverage !== 'observed' || s.durationSec !== 10 || Date.parse(s.time) !== start + j * 10000);
  for (const sample of samples) {
    for (const ship of sample.ships) {
      diagnostics.movingShipSamples++;
      if (ship.flags & 1 || ship.flags & 4) throw new Error('Trafic synthétique interdit');
      if (ship.flags & 2) diagnostics.staleShipSamples++;
      const range = haversine(ship.lat, ship.lon, curves.station.lat, curves.station.lon);
      if (range > radius) { diagnostics.outsideRadius++; continue; }
      if (range < 500) { missing = true; continue; }
      for (let band = 0; band < 2; band++) {
        energy[band] += sample.durationSec / 60 * curves.bands[band].reduce((sum, q) => sum + q.widthHz * 10 ** ((sourceSpectralDensity(q.frequencyHz, ship.speedKn, ship.lengthM, ship.shipClass) - lossAt(q, range)) / 10), 0);
      }
    }
    for (let band = 0; band < 2; band++) natural[band] += sample.durationSec / 60 * curves.bands[band].reduce((sum, q) => sum + q.widthHz * 10 ** (ambientSpectralDensity(q.frequencyHz, sample.windMs) / 10), 0);
  }
  if (missing) diagnostics.missingMinutes++;
  frames.push({ start: new Date(start).toISOString(), end: new Date(start + 60000).toISOString(), cells: [missing ? null : { shipsDb: energy.map(e => e > 0 ? 10 * Math.log10(e) : null), ambientDb: natural.map(e => 10 * Math.log10(e)), receiverDepthM: curves.station.receiverDepthM }] });
}
const dataset = scientificDatasetSchema.parse({ schemaVersion: 1, profileId: 'north-sea-reference-v1', region: 'north-sea', method: 'RAM-PyRAM-1.0.1', sourceDepthM: 6, averagingSec: 60, depthMode: 'receiver', frequenciesHz: [10 ** 1.8, 10 ** 2.1],
  grid: { west: curves.station.lon - .005, north: curves.station.lat + .005, deltaLon: .01, deltaLat: .01, width: 1, height: 1 },
  provenance: { environment: curves.provenance.environment, traffic: traffic.provenance, wind: traffic.windProvenance, inputHash: createHash('sha256').update(curveText).update(trafficText).update(radiusText).digest('hex'), assumptions: [...curves.provenance.assumptions, ...traffic.assumptions, `Rayon AIS limité à ${radius / 1000} km ; trafic manquant non reconstitué.`, 'Cellule = récepteur ponctuel au centre, pas moyenne spatiale de la cellule.'] }, numerical: curves.numerical, frames });
writeFileSync(outputPath, JSON.stringify(dataset) + '\n');
writeFileSync(outputPath.replace(/\.json$/, '.diagnostics.json'), JSON.stringify(diagnostics, null, 2) + '\n');
console.log(JSON.stringify({ outputPath, ...diagnostics }));

import { z } from 'zod';
import { haversine } from '../geo.ts';
import { FLAG_ESTIMATED, FLAG_SYNTHETIC } from '../protocol.ts';
import { SHIP_CLASSES, sourceSpectralDensity } from './jomopans-echo.ts';
import { ambientSpectralDensity } from './ambient.ts';
import { SCIENTIFIC_PROFILE_ID, scientificDatasetSchema, type ScientificDataset } from './scientific.ts';

const finite = z.number().finite();
export const kernelSchema = z.object({
  schemaVersion: z.literal(1), method: z.literal('RAM-PyRAM-1.0.1'), sourceDepthM: z.literal(6),
  frequenciesHz: z.tuple([finite, finite]), depthMode: z.enum(['receiver', 'depth-mean']),
  grid: z.object({ west: finite, north: finite, deltaLon: finite.positive(), deltaLat: finite.positive(), width: z.number().int().positive(), height: z.number().int().positive() }),
  sources: z.array(z.object({ id: z.string(), lat: finite.min(-90).max(90), lon: finite.min(-180).max(180) })).min(1),
  paths: z.array(z.object({ sourceId: z.string(), cellIndex: z.number().int().nonnegative(), receiverDepthM: finite.positive().nullable(),
    bands: z.array(z.array(z.object({ frequencyHz: finite.positive(), widthHz: finite.positive(), lossDb: finite })).min(3)).length(2),
  })).min(1),
  validFrom: z.string().datetime({ offset: true }), validTo: z.string().datetime({ offset: true }),
  maxSourceOffsetM: finite.positive(), environmentHash: z.string().min(1),
  provenance: z.object({ environment: z.string().min(1), assumptions: z.array(z.string()) }),
  numerical: z.object({ maxDifferenceDb: finite.nonnegative().nullable(), benchmark: z.string().nullable() }),
}).superRefine((k, ctx) => {
  const ids = new Set(k.sources.map(s => s.id)), keys = new Set<string>();
  if (ids.size !== k.sources.length || Date.parse(k.validFrom) >= Date.parse(k.validTo)) ctx.addIssue({ code: 'custom', message: 'identifiants sources ou période invalides' });
  for (const path of k.paths) {
    const key = `${path.sourceId}|${path.cellIndex}`;
    if (!ids.has(path.sourceId) || keys.has(key) || path.cellIndex >= k.grid.width * k.grid.height) ctx.addIssue({ code: 'custom', message: 'trajet inconnu, dupliqué ou hors grille' });
    keys.add(key);
    for (const [i, band] of path.bands.entries()) {
      const lo = k.frequenciesHz[i] / 10 ** .05, hi = k.frequenciesHz[i] * 10 ** .05;
      if (band.some(s => s.frequencyHz <= lo || s.frequencyHz >= hi) || Math.abs(band.reduce((sum, s) => sum + s.widthHz, 0) - (hi - lo)) > 1e-5) ctx.addIssue({ code: 'custom', message: 'quadrature de bande incohérente' });
    }
  }
});
export type PropagationKernels = z.infer<typeof kernelSchema>;
export const trafficSchema = z.object({
  provenance: z.string().min(1), windProvenance: z.string().min(1), assumptions: z.array(z.string()),
  samples: z.array(z.object({
    time: z.string().datetime({ offset: true }), durationSec: finite.positive().max(60),
    windMs: finite.min(0).max(30), coverage: z.enum(['observed', 'missing']),
    ships: z.array(z.object({ lat: finite.min(-90).max(90), lon: finite.min(-180).max(180), speedKn: finite.min(.5).max(60), lengthM: finite.positive().optional(), shipClass: z.enum(SHIP_CLASSES), flags: z.number().int().nonnegative() })),
  })).min(1),
});
export type RegionalTraffic = z.infer<typeof trafficSchema>;

/** Incoherent energy integration, independently of render settings or simulation frame rate. */
export function buildRegionalDataset(k: PropagationKernels, traffic: RegionalTraffic, inputHash: string): ScientificDataset {
  const paths = new Map(k.paths.map(p => [`${p.sourceId}|${p.cellIndex}`, p]));
  const groups = new Map<number, typeof traffic.samples>();
  let previousEnd = -Infinity;
  const origin = Date.parse(traffic.samples[0].time);
  for (const sample of traffic.samples) {
    const t = Date.parse(sample.time), minute = origin + Math.floor((t - origin) / 60000) * 60000, end = t + sample.durationSec * 1000;
    if (t < previousEnd || end > minute + 60000 || t < Date.parse(k.validFrom) || end > Date.parse(k.validTo)) throw new Error('Échantillons non triés, chevauchants, traversant une minute ou hors période environnementale.');
    previousEnd = end;
    if (sample.ships.some(s => s.flags & (FLAG_SYNTHETIC | FLAG_ESTIMATED))) throw new Error('Le profil de référence refuse le trafic synthétique ou estimé.');
    const group = groups.get(minute) ?? []; group.push(sample); groups.set(minute, group);
  }
  const frames: ScientificDataset['frames'] = [];
  for (const [minute, samples] of groups) {
    const complete = Math.abs(samples.reduce((sum, s) => sum + s.durationSec, 0) - 60) < 1e-6 && samples.every(s => s.coverage === 'observed');
    const assignments = samples.map(sample => sample.ships.map(ship => {
      const nearest = k.sources.map(s => ({ s, distance: haversine(s.lat, s.lon, ship.lat, ship.lon) })).sort((a, b) => a.distance - b.distance)[0];
      return nearest.distance <= k.maxSourceOffsetM ? { ship, sourceId: nearest.s.id } : null;
    }));
    const allAssigned = assignments.every(ships => ships.every(Boolean));
    const cells: ScientificDataset['frames'][number]['cells'] = [];
    for (let cellIndex = 0; cellIndex < k.grid.width * k.grid.height; cellIndex++) {
      const cellPaths = k.paths.filter(p => p.cellIndex === cellIndex);
      if (!complete || !allAssigned || !cellPaths.length) { cells.push(null); continue; }
      const receiverDepthM = cellPaths[0].receiverDepthM;
      if (cellPaths.some(p => p.receiverDepthM !== receiverDepthM)) throw new Error('Profondeurs récepteurs incohérentes.');
      const energies = [0, 0], natural = [0, 0];
      let missing = false;
      for (const [j, sample] of samples.entries()) {
        for (let b = 0; b < 2; b++) {
          // All paths use the same quadrature; wind is local to this input scenario.
          const q = cellPaths[0].bands[b];
          natural[b] += sample.durationSec / 60 * q.reduce((sum, f) => sum + f.widthHz * 10 ** (ambientSpectralDensity(f.frequencyHz, sample.windMs) / 10), 0);
          for (const a of assignments[j]) {
            if (!a) { missing = true; continue; }
            const path = paths.get(`${a.sourceId}|${cellIndex}`);
            if (!path) { missing = true; continue; }
            energies[b] += sample.durationSec / 60 * path.bands[b].reduce((sum, f) => sum + f.widthHz * 10 ** ((sourceSpectralDensity(f.frequencyHz, a.ship.speedKn, a.ship.lengthM, a.ship.shipClass) - f.lossDb) / 10), 0);
          }
        }
      }
      cells.push(missing ? null : { shipsDb: energies.map(e => e > 0 ? 10 * Math.log10(e) : null) as [number | null, number | null], ambientDb: natural.map(e => 10 * Math.log10(e)) as [number, number], receiverDepthM });
    }
    frames.push({ start: new Date(minute).toISOString(), end: new Date(minute + 60000).toISOString(), cells });
  }
  return scientificDatasetSchema.parse({ schemaVersion: 1, profileId: SCIENTIFIC_PROFILE_ID, region: 'north-sea', method: k.method, sourceDepthM: 6, averagingSec: 60,
    frequenciesHz: k.frequenciesHz, depthMode: k.depthMode, grid: k.grid, numerical: k.numerical, frames,
    provenance: { environment: k.provenance.environment, traffic: traffic.provenance, wind: traffic.windProvenance, inputHash,
      assumptions: [...k.provenance.assumptions, ...traffic.assumptions, `Sources rattachées au nœud le plus proche à ${k.maxSourceOffsetM} m maximum ; erreur spatiale non quantifiée.`, 'Le fond naturel est un modèle empirique ; pluie, biologie et trafic non observé sont absents.', 'Le trafic fourni peut être incomplet ; aucun intervalle d’incertitude absolue établi.'] } });
}

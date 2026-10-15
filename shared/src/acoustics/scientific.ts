import { z } from 'zod';
import type { Config } from '../config-schema.ts';

/** Versioned assumptions, not a claim of observational accuracy. */
export const SCIENTIFIC_PROFILE_ID = 'north-sea-reference-v1';
export const SCIENTIFIC_CENTERS = [10 ** 1.8, 10 ** 2.1] as const;
export const REFERENCE_PHYSICS = {
  enabled: true, energyTauSec: 6, bottomBounceLossDb: 0.09, grazingAngleDeg: 10,
  sedimentSoundSpeed: 1700, cutoffLossDbPerKm: 5, extraLossDbPerKm: 0,
};
export const REFERENCE_BANDS = [
  { id: 'low' as const, fMin: 10, fMax: 40 },
  { id: 'mid' as const, fMin: 100, fMax: 500 },
  { id: 'high' as const, fMin: 1000, fMax: 10000 },
];

/** Visual overrides never change the reference assumptions. Old local overrides are ignored. */
export function resolveScientificConfig(cfg: Config): Config {
  if (cfg.science.mode === 'experimental') return cfg;
  return { ...cfg, physics: { ...REFERENCE_PHYSICS }, bands: structuredClone(REFERENCE_BANDS), ambient: { windSpeedMs: 5 },
    qualityProfiles: {
      expo: { ...cfg.qualityProfiles.expo, physicsSimWidth: 1024 },
      light: { ...cfg.qualityProfiles.light, physicsSimWidth: 1024 },
    } };
}

const finite = z.number().finite();
const pair = z.tuple([finite, finite]);
const date = z.string().datetime({ offset: true });
const cell = z.object({
  // null = zero modelled ship energy, never missing coverage (missing cell = null).
  shipsDb: z.tuple([finite.nullable(), finite.nullable()]),
  ambientDb: pair,
  receiverDepthM: finite.positive().nullable(),
});
export const scientificDatasetSchema = z.object({
  schemaVersion: z.literal(1), profileId: z.literal(SCIENTIFIC_PROFILE_ID), region: z.literal('north-sea'),
  method: z.literal('RAM-PyRAM-1.0.1'), sourceDepthM: z.literal(6), averagingSec: z.literal(60),
  depthMode: z.enum(['depth-mean', 'receiver']),
  frequenciesHz: pair.refine(([a, b]) => Math.abs(a - SCIENTIFIC_CENTERS[0]) < 1e-6 && Math.abs(b - SCIENTIFIC_CENTERS[1]) < 1e-6, 'centres décidécades 63/125 Hz exacts requis'),
  provenance: z.object({ environment: z.string().min(1), traffic: z.string().min(1), wind: z.string().min(1), assumptions: z.array(z.string()), inputHash: z.string().min(1) }),
  numerical: z.object({ maxDifferenceDb: finite.nonnegative().nullable(), benchmark: z.string().nullable() }),
  grid: z.object({ west: finite.min(-20).max(15), north: finite.min(48).max(65), deltaLon: finite.positive(), deltaLat: finite.positive(), width: z.number().int().min(1).max(2048), height: z.number().int().min(1).max(2048) }),
  frames: z.array(z.object({ start: date, end: date, cells: z.array(cell.nullable()) })).min(1),
}).superRefine((d, ctx) => {
  let previousEnd = -Infinity;
  if (d.grid.west + d.grid.width * d.grid.deltaLon > 15 || d.grid.north - d.grid.height * d.grid.deltaLat < 48) ctx.addIssue({ code: 'custom', message: 'grille hors mer du Nord' });
  for (const [i, f] of d.frames.entries()) {
    const start = Date.parse(f.start), end = Date.parse(f.end);
    if (end - start !== 60000 || start < previousEnd) ctx.addIssue({ code: 'custom', path: ['frames', i], message: 'fenêtres de 60 s triées et sans chevauchement requises' });
    previousEnd = end;
    if (f.cells.length !== d.grid.width * d.grid.height) ctx.addIssue({ code: 'custom', path: ['frames', i, 'cells'], message: 'dimensions incohérentes' });
    if (f.cells.some(c => c && (d.depthMode === 'receiver' ? c.receiverDepthM === null : c.receiverDepthM !== null))) ctx.addIssue({ code: 'custom', message: 'profondeur incohérente avec depthMode' });
  }
});
export type ScientificDataset = z.infer<typeof scientificDatasetSchema>;
export type ScientificCell = z.infer<typeof cell>;
export type AcousticMetric = 'ships' | 'total' | 'excess';

export function acousticComponents(shipsDb: number | null, ambientDb: number) {
  const excessDb = shipsDb === null ? 0 : 10 / Math.LN10 * Math.log1p(10 ** ((shipsDb - ambientDb) / 10));
  return { shipsDb, ambientDb, totalDb: ambientDb + excessDb, excessDb };
}

export function scientificCellAt(data: ScientificDataset, lat: number, lon: number, timeMs: number) {
  const g = data.grid;
  const x = Math.floor((lon - g.west) / g.deltaLon), y = Math.floor((g.north - lat) / g.deltaLat);
  if (!Number.isFinite(timeMs) || x < 0 || x >= g.width || y < 0 || y >= g.height) return null;
  const frame = data.frames.find(f => timeMs >= Date.parse(f.start) && timeMs < Date.parse(f.end));
  const cell = frame?.cells[y * g.width + x];
  return frame && cell ? { frame, cell } : null;
}

export interface ScienceStatus {
  profileId: string;
  mode: 'reference' | 'experimental';
  regionalAvailable: boolean;
  numericalStatus: 'not-verified' | 'convergence-checked';
  observationalStatus: 'not-validated';
  message: string;
}

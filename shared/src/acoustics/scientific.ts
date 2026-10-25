import { z } from 'zod';
import type { Config } from '../config-schema.ts';

/** Versioned assumptions, not a claim of observational accuracy. */
export const SCIENTIFIC_PROFILE_ID = 'north-sea-reference-v1';
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
const range = z.object({ min: finite, median: finite, max: finite });

/**
 * Résumé publié par tools/science (phase de test du protocole docs/VALIDATION_PROTOCOLE.md) :
 * écarts mesurés entre la loi du moteur mondial et des hydrophones, par zone et par bande.
 * C'est la seule source des chiffres de validation affichés ; sans lui, tout reste « non validé ».
 */
export const validationSummarySchema = z.object({
  schemaVersion: z.literal(1),
  profileId: z.string().min(1),
  protocol: z.string().min(1),
  generated: z.string().min(1),
  regions: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    regime: z.enum(['shallow', 'deep']),
    bounds: z.object({ west: finite.min(-180).max(180), south: finite.min(-90).max(90), east: finite.min(-180).max(180), north: finite.min(-90).max(90) }),
    stations: z.array(z.string()).min(1),
    days: z.number().int().positive(),
    bands: z.array(z.object({
      band: z.string().min(1),
      fMinHz: finite.positive(), fMaxHz: finite.positive(),
      comparisons: z.number().int().positive(),
      /** ΔL50 = médiane prédite − médiane mesurée (dB), sur les comparaisons station × jour. */
      diffL50Db: range,
      within3DbFraction: finite.min(0).max(1),
    })).min(1),
    statement: z.string().min(1),
  })),
}).superRefine((d, ctx) => {
  for (const [i, r] of d.regions.entries()) {
    if (r.bounds.south >= r.bounds.north || r.bounds.west >= r.bounds.east) ctx.addIssue({ code: 'custom', path: ['regions', i, 'bounds'], message: 'emprise invalide' });
  }
});
export type ValidationSummary = z.infer<typeof validationSummarySchema>;
export type AcousticMetric = 'ships' | 'total' | 'excess';

export function acousticComponents(shipsDb: number | null, ambientDb: number) {
  const excessDb = shipsDb === null ? 0 : 10 / Math.LN10 * Math.log1p(10 ** ((shipsDb - ambientDb) / 10));
  return { shipsDb, ambientDb, totalDb: ambientDb + excessDb, excessDb };
}

/** Zone validée contenant un point, s'il y en a une. */
export function validationRegionAt(summary: ValidationSummary | null, lat: number, lon: number) {
  return summary?.regions.find(r => lat >= r.bounds.south && lat <= r.bounds.north && lon >= r.bounds.west && lon <= r.bounds.east) ?? null;
}

export interface ScienceStatus {
  profileId: string;
  mode: 'reference' | 'experimental';
  /** Résumé de validation publié et conforme au profil courant. */
  validationAvailable: boolean;
  message: string;
}

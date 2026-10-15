import { readFileSync } from 'node:fs';
import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';
import { acousticComponents, configSchema, resolveScientificConfig, validationRegionAt, validationSummarySchema } from '../src/index.ts';
import { summary } from './fixtures.ts';

describe('composantes acoustiques', () => {
  it('somme les énergies : deux niveaux égaux ajoutent 3,01 dB ; énergie nulle des navires = fond seul', () => {
    expect(acousticComponents(100, 100).excessDb).toBeCloseTo(3.0102999566);
    expect(acousticComponents(null, 80)).toEqual({ shipsDb: null, ambientDb: 80, totalDb: 80, excessDb: 0 });
  });
});

describe('résumé de validation', () => {
  it('valide la structure et localise la zone mesurée, sans extrapoler au-delà', () => {
    const s = validationSummarySchema.parse(summary());
    expect(validationRegionAt(s, 56.9, 11.2)?.id).toBe('danish-straits');
    expect(validationRegionAt(s, 40, -30)).toBeNull();
    expect(validationRegionAt(null, 56.9, 11.2)).toBeNull();
  });
  it('refuse une emprise vide, une fraction hors [0, 1] ou une zone sans bande', () => {
    const bad = summary(); bad.regions[0].bounds.north = 50;
    expect(validationSummarySchema.safeParse(bad).success).toBe(false);
    const fraction = summary(); fraction.regions[0].bands[0].within3DbFraction = 1.2;
    expect(validationSummarySchema.safeParse(fraction).success).toBe(false);
    const empty = summary(); empty.regions[0].bands = [];
    expect(validationSummarySchema.safeParse(empty).success).toBe(false);
  });
});

describe('profil de référence', () => {
  const config = () => configSchema.parse(JSON5.parse(readFileSync(new URL('../../config/default.json5', import.meta.url), 'utf8')));
  it('neutralise les anciennes surcharges acoustiques et garde les préférences visuelles', () => {
    const cfg = config(); cfg.physics.extraLossDbPerKm = .08; cfg.ambient.windSpeedMs = 20; cfg.waves.brightness = 7;
    const reference = resolveScientificConfig(cfg);
    expect(reference.physics.extraLossDbPerKm).toBe(0); expect(reference.ambient.windSpeedMs).toBe(5); expect(reference.waves.brightness).toBe(7);
    cfg.science.mode = 'experimental'; expect(resolveScientificConfig(cfg).physics.extraLossDbPerKm).toBe(.08);
  });
});

import { describe, expect, it } from 'vitest';
import type { ValidationSummary } from '@vacarme/shared';
import { validationText } from '../src/ui/science.ts';

const data: ValidationSummary = {
  schemaVersion: 1, profileId: 'fixture', protocol: 'fixture', generated: 'fixture',
  regions: [{ id: 'fixture', label: 'hydrophone de test fictif', regime: 'shallow',
    bounds: { west: 9.99, east: 10.01, south: 54.99, north: 55.01 }, stations: ['fixture'], days: 3,
    bands: [{ band: 'mid', fMinHz: 100, fMaxHz: 500, comparisons: 3,
      diffL50Db: { min: -8, median: 2, max: 15 }, within3DbFraction: 1 / 3 }], statement: 'Résultats historiques fictifs.' }],
};
const point = { lat: 55, lon: 10 };
const real = { shipsMode: 'real', active: 'replay' } as const;

describe('affichage des résultats scientifiques', () => {
  it('montre les écarts historiques au seul repère mesuré et conserve les mauvais résultats', () => {
    const text = validationText(data, point, 'reference', real);
    expect(text).toContain('Station mesurée');
    expect(text).toContain('−8.0 à +15.0 dB');
    expect(text).toContain('33 %');
    expect(validationText(data, { lat: 0, lon: 0 }, 'reference', real)).toContain('non validés');
  });
  it('ne transfère pas ces écarts à un autre profil ni aux navires synthétiques', () => {
    for (const source of [null, { shipsMode: 'estimated', active: 'live' }, { shipsMode: 'mixed', active: 'live' }, { shipsMode: 'real', active: 'simulation' }] as const) {
      const text = validationText(data, point, 'reference', source);
      expect(text).toContain('non validés');
      expect(text).not.toContain('−8.0');
    }
    expect(validationText(data, point, 'experimental', real)).toContain('non validés');
  });
});

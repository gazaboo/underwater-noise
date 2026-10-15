import { SCIENTIFIC_PROFILE_ID } from '../src/index.ts';

/** Résumé de validation minimal et valide, pour les tests. */
export const summary = () => ({
  schemaVersion: 1, profileId: SCIENTIFIC_PROFILE_ID, protocol: 'docs/VALIDATION_PROTOCOLE.md v1', generated: '2026-10-15',
  regions: [{ id: 'danish-straits', label: 'Détroits danois', regime: 'shallow', bounds: { west: 9, south: 54, east: 13, north: 57.5 },
    stations: ['anholt'], days: 4,
    bands: [{ band: 'mid', fMinHz: 89, fMaxHz: 562, comparisons: 4, diffL50Db: { min: -2, median: 1, max: 3 }, within3DbFraction: 1 }],
    statement: 'TEST' }],
});

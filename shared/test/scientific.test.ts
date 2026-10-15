import { readFileSync } from 'node:fs';
import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';
import { acousticComponents, buildRegionalDataset, configSchema, kernelSchema, resolveScientificConfig, SCIENTIFIC_CENTERS, scientificCellAt, scientificDatasetSchema, trafficSchema } from '../src/index.ts';

const start = '2019-10-01T00:00:00Z';
const end = '2019-10-01T00:01:00Z';
const band = (center: number) => { const lo = center / 10 ** .05, hi = center * 10 ** .05; return [0, 1, 2].map(i => ({ frequencyHz: lo + (i + .5) * (hi - lo) / 3, widthHz: (hi - lo) / 3, lossDb: 60 })); };
const kernels = () => kernelSchema.parse({ schemaVersion: 1, method: 'RAM-PyRAM-1.0.1', sourceDepthM: 6, frequenciesHz: SCIENTIFIC_CENTERS,
  depthMode: 'receiver', grid: { west: 2.99, north: 55.01, deltaLon: .02, deltaLat: .02, width: 1, height: 1 }, sources: [{ id: 'a', lat: 55, lon: 3 }],
  paths: [{ sourceId: 'a', cellIndex: 0, receiverDepthM: 50, bands: SCIENTIFIC_CENTERS.map(band) }], validFrom: start, validTo: end, maxSourceOffsetM: 100,
  environmentHash: 'fixture', provenance: { environment: 'TEST', assumptions: [] }, numerical: { maxDifferenceDb: null, benchmark: null } });
const traffic = () => trafficSchema.parse({ provenance: 'TEST', windProvenance: 'TEST 5 m/s', assumptions: [], samples: [{ time: start, durationSec: 60, windMs: 5, coverage: 'observed', ships: [{ lat: 55, lon: 3, speedKn: 12, shipClass: 'bulker', flags: 0 }] }] });

describe('scientific field energy and provenance', () => {
  it('two independent identical ships add 3.01 dB, separately from ambient', () => {
    const one = buildRegionalDataset(kernels(), traffic(), 'one');
    const twoTraffic = traffic(); twoTraffic.samples[0].ships.push({ ...twoTraffic.samples[0].ships[0] });
    const two = buildRegionalDataset(kernels(), twoTraffic, 'two');
    expect(two.frames[0].cells[0]!.shipsDb[0]! - one.frames[0].cells[0]!.shipsDb[0]!).toBeCloseTo(10 * Math.log10(2), 8);
    expect(two.frames[0].cells[0]!.ambientDb).toEqual(one.frames[0].cells[0]!.ambientDb);
    expect(acousticComponents(100, 100).excessDb).toBeCloseTo(3.0102999566);
    expect(acousticComponents(null, 80)).toEqual({ shipsDb: null, ambientDb: 80, totalDb: 80, excessDb: 0 });
  });
  it('time-averages energies, not dB, and records incomplete intervals as missing', () => {
    const t = traffic(); t.samples[0].durationSec = 30;
    const missing = buildRegionalDataset(kernels(), t, 'x'); expect(missing.frames[0].cells[0]).toBeNull();
    t.samples.push({ ...t.samples[0], time: '2019-10-01T00:00:30Z', ships: [] });
    const half = buildRegionalDataset(kernels(), t, 'half');
    const full = buildRegionalDataset(kernels(), traffic(), 'full');
    expect(full.frames[0].cells[0]!.shipsDb[0]! - half.frames[0].cells[0]!.shipsDb[0]!).toBeCloseTo(10 * Math.log10(2), 8);
    t.samples[1].coverage = 'missing'; expect(buildRegionalDataset(kernels(), t, 'x').frames[0].cells[0]).toBeNull();
  });
  it('refuses synthetic traffic and never replaces missing paths or unmatched sources with quiet', () => {
    const t = traffic(); t.samples[0].ships[0].flags = 1;
    expect(() => buildRegionalDataset(kernels(), t, 'x')).toThrow(/synthétique/);
    t.samples[0].ships[0].flags = 0; t.samples[0].ships[0].lon = 4;
    expect(buildRegionalDataset(kernels(), t, 'x').frames[0].cells[0]).toBeNull();
  });
  it('does not extrapolate outside time or region and rejects malformed metadata', () => {
    const d = buildRegionalDataset(kernels(), traffic(), 'x');
    expect(scientificCellAt(d, 55, 3, Date.parse(start))).not.toBeNull();
    expect(scientificCellAt(d, 55, 3, Date.parse(end))).toBeNull();
    expect(scientificCellAt(d, 0, 3, Date.parse(start))).toBeNull();
    const invalid = structuredClone(d); invalid.frames[0].cells.push(null);
    expect(scientificDatasetSchema.safeParse(invalid).success).toBe(false);
    invalid.frames[0].cells.pop(); invalid.frequenciesHz[0] = 63;
    expect(scientificDatasetSchema.safeParse(invalid).success).toBe(false);
  });
  it('refuses overlapping samples and invalid band quadrature', () => {
    const t = traffic(); t.samples.push({ ...t.samples[0] });
    expect(() => buildRegionalDataset(kernels(), t, 'x')).toThrow(/chevauchants/);
    const k = kernels(); k.paths[0].bands[0][0].widthHz *= 2;
    expect(kernelSchema.safeParse(k).success).toBe(false);
  });
});

describe('reference profile', () => {
  const config = () => configSchema.parse(JSON5.parse(readFileSync(new URL('../../config/default.json5', import.meta.url), 'utf8')));
  it('neutralizes old acoustic overrides and preserves visual preferences', () => {
    const cfg = config(); cfg.physics.extraLossDbPerKm = .08; cfg.ambient.windSpeedMs = 20; cfg.waves.brightness = 7;
    const reference = resolveScientificConfig(cfg);
    expect(reference.physics.extraLossDbPerKm).toBe(0); expect(reference.ambient.windSpeedMs).toBe(5); expect(reference.waves.brightness).toBe(7);
    cfg.science.mode = 'experimental'; expect(resolveScientificConfig(cfg).physics.extraLossDbPerKm).toBe(.08);
  });
});

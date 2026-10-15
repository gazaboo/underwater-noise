import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BANDS, FLAG_ESTIMATED } from '@vacarme/shared';
import { OceanGrid } from '../src/ocean-grid.ts';
import { DensityGrid } from '../src/sources/density.ts';
import { EstimatedSource, type EstimatedOptions } from '../src/sources/estimated.ts';

const DATA = join(import.meta.dirname, '../../data');
const W = 3600;
const H = 1800;

/** Densité synthétique : un couloir de cargos le long de l'équateur dans l'Atlantique (40° O – 10° O),
 *  et une zone de pêche dans le golfe de Gascogne. */
function syntheticDensity(): DensityGrid {
  const cargo = new Float32Array(W * H);
  const fishing = new Float32Array(W * H);
  const cell = (lat: number, lon: number) => Math.floor((90 - lat) * 10) * W + Math.floor((lon + 180) * 10);
  for (let lon = -40; lon < -10; lon += 0.1) for (let lat = -0.3; lat < 0.3; lat += 0.1) cargo[cell(lat + 0.05, lon + 0.05)] = 0.05;
  for (let lon = -6; lon < -3; lon += 0.1) for (let lat = 44; lat < 46; lat += 0.1) fishing[cell(lat + 0.05, lon + 0.05)] = 0.01;
  return new DensityGrid(W, H, [
    { name: 'cargo_slow', lambda: cargo, speedHours: { '10-15': 1 } },
    { name: 'fishing', lambda: fishing, speedHours: { '2-4': 1 } },
  ]);
}

const sum = (a: Float32Array) => a.reduce((s, v) => s + v, 0);

describe('navires estimés', () => {
  const density = syntheticDensity();
  const ocean = new OceanGrid(join(DATA, 'grid/ocean_2048.png'));
  const opts: EstimatedOptions = {
    timeScale: 20,
    maxShips: 45000,
    lifetimeHours: 24,
    lookAheadKm: 30,
    classMix: { cargo_slow: { bulker: 0.6, tanker: 0.4 }, fishing: { fishing: 1 } },
    seed: 3,
    bands: DEFAULT_BANDS,
  };

  it("place autant de navires que la présence moyenne (Σ λ), en mer, marqués « estimés »", () => {
    const est = new EstimatedSource(density, ocean, opts);
    const ships = est.ships();
    const expected = Math.round(sum(density.groups[0].lambda)) + Math.round(sum(density.groups[1].lambda));
    expect(ships.length).toBe(expected);
    expect(ships.filter((s) => ocean.isWater(s.lat, s.lon)).length / ships.length).toBeGreaterThan(0.95);
    expect(ships.every((s) => s.flags & FLAG_ESTIMATED)).toBe(true);
  });

  it('suit les couloirs de densité', () => {
    const est = new EstimatedSource(density, ocean, opts);
    for (let i = 0; i < 60; i++) est.advance(600); // 10 h simulées
    const cargo = est.ships().filter((s) => Math.abs(s.lon + 25) < 16);
    const inLane = cargo.filter((s) => Math.abs(s.lat) < 0.6).length;
    expect(inLane / cargo.length).toBeGreaterThan(0.8);
  });

  it('les navires avancent, et renaissent au bout de leur durée de vie', () => {
    const est = new EstimatedSource(density, ocean, { ...opts, lifetimeHours: 1 });
    const before = new Map(est.ships().map((s) => [s.id, { lat: s.lat, lon: s.lon }]));
    est.advance(60);
    const moved = est.ships().filter((s) => before.has(s.id) && (before.get(s.id)!.lat !== s.lat || before.get(s.id)!.lon !== s.lon));
    expect(moved.length).toBeGreaterThan(0.8 * before.size);
    for (let i = 0; i < 20; i++) est.advance(1800); // 10 h : bien plus que la durée de vie
    const survivors = est.ships().filter((s) => before.has(s.id)).length;
    expect(survivors / before.size).toBeLessThan(0.05);
  });

  it('en mode mixte, ne place des navires que dans les cellules autorisées, avec leur effectif', () => {
    const est = new EstimatedSource(density, ocean, opts);
    // Autorisé : uniquement à l'ouest de 25° O (cellules de 1°, ligne 0 au nord).
    const allowed = new Uint8Array(360 * 180);
    for (let y = 0; y < 180; y++) for (let x = 0; x < 360; x++) allowed[y * 360 + x] = x - 180 < -25 ? 1 : 0;
    est.setRegion(allowed);
    est.advance(3600);
    const ships = est.ships();
    expect(ships.every((s) => s.lon < -25)).toBe(true);
    let expected = 0;
    for (let y = 0; y < 180; y++) for (let x = 0; x < 360; x++) if (allowed[y * 360 + x]) expected += density.coarse[0][y * 360 + x];
    expect(Math.abs(ships.length - expected)).toBeLessThanOrEqual(1);
  });

  it("réduit l'effectif au plafond et le signale", () => {
    const est = new EstimatedSource(density, ocean, { ...opts, maxShips: 10 });
    expect(est.ships().length).toBeLessThanOrEqual(11);
    expect(est.capped).toBe(true);
  });
});

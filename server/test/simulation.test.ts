import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BANDS, haversine } from '@vacarme/shared';
import { OceanGrid } from '../src/ocean-grid.ts';
import { SimulationSource } from '../src/sources/simulation.ts';

const DATA = join(import.meta.dirname, '../../data');

describe('mode simulation', () => {
  const grid = new OceanGrid(join(DATA, 'grid/ocean_1024.png'));
  const sim = new SimulationSource(join(DATA, 'routes.json'), grid, {
    shipCount: 2000,
    timeScale: 20,
    fishingFraction: 0.12,
    laneWidthKm: 25,
    seed: 7,
    bands: DEFAULT_BANDS,
  });

  it('place la quasi-totalité des navires en mer', () => {
    const ships = sim.ships();
    expect(ships).toHaveLength(2000);
    const atSea = ships.filter((s) => grid.isWater(s.lat, s.lon)).length;
    expect(atSea / ships.length).toBeGreaterThan(0.95);
  });

  it('fait avancer les navires à leur vitesse (temps accéléré)', () => {
    const before = sim.ships().map((s) => ({ ...s }));
    sim.tick(60); // 60 s réelles = 20 min simulées
    const after = sim.ships();
    // Un navire marchand à ~14 nœuds parcourt ~8,6 km en 20 min.
    const i = before.findIndex((s) => s.sog > 10 && s.classIndex !== 0);
    const d = haversine(before[i].lat, before[i].lon, after[i].lat, after[i].lon);
    const expected = before[i].sog * 0.514444 * 1200;
    expect(d).toBeGreaterThan(expected * 0.5);
    expect(d).toBeLessThan(expected * 1.5);
  });

  it('attribue des niveaux sources plausibles (J-E)', () => {
    for (const s of sim.ships()) {
      expect(s.slBroad).toBeGreaterThan(130); // un petit chalutier à 3 nœuds descend vers 140 dB
      expect(s.slBroad).toBeLessThan(205);
    }
  });
});

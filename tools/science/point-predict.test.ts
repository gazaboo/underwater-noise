import { describe, expect, it } from 'vitest';
import { DECIDECADE_CENTERS, REFERENCE_PHYSICS, decidecadesIn, destination, pathTransmissionLoss, thorpAbsorptionDbPerKm } from '../../shared/src/index.ts';
import { OceanGrid, analysisBands, nominalLabel, worldLawLoss } from './point-predict.ts';

/** Grille synthétique 360 × 180 : mer partout à profondeur fixe, sauf une colonne de terre. */
function grid(depthM: number, landColumn?: number): OceanGrid {
  const width = 360, height = 180, data = Buffer.alloc(width * height * 4);
  const g = Math.round(255 * Math.log10(depthM / 10) / Math.log10(1100));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = 4 * (y * width + x);
    data[i] = x === landColumn ? 0 : 255; data[i + 1] = g; data[i + 3] = 255;
  }
  return new OceanGrid({ width, height, data });
}

describe('prédicteur ponctuel', () => {
  it('libellés nominaux IEC des 34 décidécades', () => {
    expect(DECIDECADE_CENTERS.map(nominalLabel)).toEqual([10, 12.5, 16, 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800,
      1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000]);
  });

  it('les bandes larges mesurées somment exactement les décidécades de la source J-E', () => {
    for (const band of analysisBands().filter(b => b.kind === 'broad')) {
      const reference = { low: [10, 40], mid: [100, 500], high: [1000, 10000] }[band.id as 'low' | 'mid' | 'high'];
      expect(band.decidecadesHz).toEqual(decidecadesIn(reference[0], reference[1]).map(nominalLabel));
    }
  });

  it('en eau profonde uniforme, la loi mondiale est l’étalement sphérique puis cylindrique plus Thorp', () => {
    const depth = 3000, f = 125;
    const ship = { lat: 0, lon: -1 }, rx = { lat: 0, lon: 1 };
    const result = worldLawLoss(grid(depth), ship, rx, f, REFERENCE_PHYSICS)!;
    const actualDepth = 10 * 1100 ** (Math.round(255 * Math.log10(depth / 10) / Math.log10(1100)) / 255);
    const r = result.rangeM;
    // Au-delà de 400 m de fond : ni perte au fond ni coupure, seule l'absorption reste.
    expect(result.lossDb).toBeCloseTo(20 * Math.log10(actualDepth) + 10 * Math.log10(r / actualDepth) + thorpAbsorptionDbPerKm(f) * r / 1000, 6);
    expect(result.lossDb).toBeCloseTo(pathTransmissionLoss(r, actualDepth, [thorpAbsorptionDbPerKm(f)]), 6);
  });

  it('un trajet qui traverse la terre ne transmet rien ; la distance minimale borne le champ proche', () => {
    expect(worldLawLoss(grid(50, 180), { lat: 0, lon: -2 }, { lat: 0, lon: 2 }, 63, REFERENCE_PHYSICS)).toBeNull();
    const near = destination(0, 10, 90, 200);
    const free = worldLawLoss(grid(50), { lat: 0, lon: 10 }, { lat: near[0], lon: near[1] }, 63, REFERENCE_PHYSICS)!;
    const bounded = worldLawLoss(grid(50), { lat: 0, lon: 10 }, { lat: near[0], lon: near[1] }, 63, REFERENCE_PHYSICS, 20_000)!;
    expect(bounded.lossDb).toBeGreaterThan(free.lossDb);
    expect(bounded.rangeM).toBeCloseTo(200, 0);
  });
});

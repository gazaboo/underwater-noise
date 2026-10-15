import { describe, expect, it } from 'vitest';
import { ambientBandLevel, ambientComponents, cutoffFrequency, lossRateDbPerKm, naturalLevel, pathTransmissionLoss, thorpAbsorptionDbPerKm, transmissionLoss } from '../src/index.ts';

const LOSS = { bottomBounceLossDb: 0.09, grazingAngleDeg: 10, sedimentSoundSpeed: 1700, cutoffLossDbPerKm: 5, extraLossDbPerKm: 0 };

describe('bruit ambiant (Coates 1990 via Lucani, Stojanovic & Médard 2008, éq. 4–8)', () => {
  it('composantes : valeurs recalculées à la main depuis les équations', () => {
    const c20 = ambientComponents(20, 7);
    expect(c20.turbulence).toBeCloseTo(17 - 30 * Math.log10(0.02), 6); // 68,0 dB/Hz
    expect(c20.turbulence).toBeCloseTo(68.0, 1);
    const c224 = ambientComponents(224, 7);
    expect(c224.wind).toBeCloseTo(50 + 7.5 * Math.sqrt(7) + 20 * Math.log10(0.224) - 40 * Math.log10(0.624), 6);
    expect(c224.thermal).toBeCloseTo(-15 + 20 * Math.log10(0.224), 6);
  });

  it('niveaux de bande pour un vent de 5 m/s (valeurs retenues par l\'œuvre)', () => {
    expect(ambientBandLevel(10, 40, 5)).toBeCloseTo(83.8, 0);
    expect(ambientBandLevel(100, 500, 5)).toBeCloseTo(88.1, 0);
    expect(ambientBandLevel(1000, 10000, 5)).toBeCloseTo(93.2, 0);
  });

  it('le vent fait monter les bandes moyenne et haute, pas la basse (turbulence)', () => {
    expect(ambientBandLevel(100, 500, 10) - ambientBandLevel(100, 500, 3)).toBeGreaterThan(8);
    expect(Math.abs(ambientBandLevel(10, 40, 10) - ambientBandLevel(10, 40, 3))).toBeLessThan(1);
  });

  it('une valeur forcée dans la configuration l\'emporte', () => {
    expect(naturalLevel({ fMin: 10, fMax: 40, naturalDb: 90 }, 5)).toBe(90);
  });
});

describe('pertes de propagation (modèle commun au champ et aux cétacés)', () => {
  it('fréquence de coupure de Pekeris : ~16 Hz par 50 m de fond (c_b = 1 700 m/s)', () => {
    expect(cutoffFrequency(50, 1700)).toBeCloseTo(15.9, 0);
  });

  it('eau profonde : seule l\'absorption de Thorp', () => {
    expect(lossRateDbPerKm(4000, 20, LOSS)).toBeCloseTo(thorpAbsorptionDbPerKm(20), 9);
  });

  it('plateau : rebonds au fond, plus nombreux quand le fond remonte', () => {
    const r100 = lossRateDbPerKm(100, 224, LOSS) - thorpAbsorptionDbPerKm(224);
    expect(r100).toBeCloseTo((0.09 * 1000 * Math.tan(Math.PI / 18)) / 200, 6); // ≈ 0,08 dB/km
    expect(lossRateDbPerKm(50, 224, LOSS)).toBeGreaterThan(lossRateDbPerKm(100, 224, LOSS));
  });

  it('sous la coupure : la bande basse ne se propage plus (20 Hz par 20 m de fond)', () => {
    expect(lossRateDbPerKm(20, 20, LOSS)).toBeGreaterThan(5);
    expect(lossRateDbPerKm(20, 3162, LOSS)).toBeLessThan(5); // la bande haute passe encore
  });

  it('calage : sur le plateau, la perte totale suit l\'étalement pratique 15·log r à ±1,5 dB (10–50 km, 50–100 m)', () => {
    for (const h of [50, 70, 100]) {
      for (const r of [10_000, 20_000, 50_000]) {
        const tl = pathTransmissionLoss(r, h, [lossRateDbPerKm(h, 224, LOSS) - thorpAbsorptionDbPerKm(224)]);
        expect(Math.abs(tl - 15 * Math.log10(r))).toBeLessThan(1.5);
      }
    }
  });

  it('trajet : étalement + moyenne des taux ; identique à la loi simple si les taux sont constants', () => {
    expect(pathTransmissionLoss(100_000, 4000, [0.1, 0.1, 0.1])).toBeCloseTo(transmissionLoss(100_000, 4000, 0.1), 9);
  });
});

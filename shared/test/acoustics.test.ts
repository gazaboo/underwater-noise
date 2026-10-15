import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BANDS,
  shipBandLevel,
  shipBroadbandLevel,
  sourceLevelDecidecade,
  sumDb,
  thorpAbsorptionDbPerKm,
  transmissionLoss,
} from '../src/index.ts';

/**
 * Valeurs relevées à l'œil sur la figure 7 de MacGillivray & de Jong (2021) :
 * courbes J-E en bandes décidécades. Lecture graphique → tolérance ±3 dB.
 */
describe('JOMOPANS-ECHO — comparaison à la figure 7 de l\'article', () => {
  const cases = [
    { cls: 'bulker', v: 13.5, l: 211, peak: 177, at1k: 162, at10k: 150 },
    { cls: 'container', v: 18.8, l: 294, peak: 185, at1k: 166, at10k: 155 },
    { cls: 'tanker', v: 13.5, l: 186, peak: 175, at1k: 163, at10k: 152 },
    { cls: 'vehicleCarrier', v: 17, l: 194, peak: 179, at1k: 163, at10k: 152 },
  ] as const;

  for (const c of cases) {
    it(`${c.cls} (${c.v} nœuds, ${c.l} m)`, () => {
      const peak = Math.max(...[25, 31.6, 40, 50, 63].map((f) => sourceLevelDecidecade(f, c.v, c.l, c.cls)));
      expect(peak).toBeGreaterThan(c.peak - 3);
      expect(peak).toBeLessThan(c.peak + 3);
      expect(Math.abs(sourceLevelDecidecade(1000, c.v, c.l, c.cls) - c.at1k)).toBeLessThan(3);
      expect(Math.abs(sourceLevelDecidecade(10000, c.v, c.l, c.cls) - c.at10k)).toBeLessThan(3);
    });
  }

  it('suit les lois de puissance 60·log(V) et 20·log(l)', () => {
    const a = sourceLevelDecidecade(500, 10, 200, 'bulker');
    expect(sourceLevelDecidecade(500, 20, 200, 'bulker') - a).toBeCloseTo(60 * Math.log10(2), 6);
    expect(sourceLevelDecidecade(500, 10, 400, 'bulker') - a).toBeCloseTo(20 * Math.log10(2), 6);
  });

  it('utilise la longueur moyenne de la classe quand la longueur est inconnue', () => {
    expect(sourceLevelDecidecade(100, 12, undefined, 'tanker')).toBeCloseTo(sourceLevelDecidecade(100, 12, 186, 'tanker'), 6);
  });

  it('borne la vitesse à 3 × V_C (hors du domaine du modèle, ou vitesse AIS erronée)', () => {
    expect(sourceLevelDecidecade(100, 95, 80, 'other')).toBeCloseTo(sourceLevelDecidecade(100, 3 * 7.4, 80, 'other'), 6);
    expect(shipBroadbandLevel(95, 80, 'other')).toBeLessThan(200);
  });

  it('borne la vitesse à 0,5 nœud (navire à quai)', () => {
    expect(Number.isFinite(sourceLevelDecidecade(100, 0, 50, 'tug'))).toBe(true);
  });

  it('donne des niveaux large bande plausibles (ordres de grandeur de la littérature)', () => {
    const bigShip = shipBroadbandLevel(18.8, 294, 'container');
    expect(bigShip).toBeGreaterThan(180);
    expect(bigShip).toBeLessThan(195);
    const fishing = shipBroadbandLevel(9, 30, 'fishing');
    expect(fishing).toBeGreaterThan(155);
    expect(fishing).toBeLessThan(bigShip);
  });

  it('niveau de bande = somme énergétique des décidécades', () => {
    const low = shipBandLevel(DEFAULT_BANDS[0], 13.5, 211, 'bulker');
    const parts = [10, 12.6, 15.8, 20, 25.1, 31.6, 39.8].map((f) => sourceLevelDecidecade(f, 13.5, 211, 'bulker'));
    expect(low).toBeCloseTo(sumDb(parts), 1);
  });
});

describe('propagation', () => {
  it('absorption de Thorp : ordres de grandeur', () => {
    expect(thorpAbsorptionDbPerKm(20)).toBeCloseTo(0.003, 3);
    expect(thorpAbsorptionDbPerKm(2000)).toBeGreaterThan(0.1);
    expect(thorpAbsorptionDbPerKm(2000)).toBeLessThan(0.2);
  });

  it('perte de transmission : sphérique puis cylindrique', () => {
    expect(transmissionLoss(1000, 4000, 0)).toBeCloseTo(60, 6);
    // Au-delà de la transition : +10 dB par décade.
    expect(transmissionLoss(400_000, 4000, 0) - transmissionLoss(40_000, 4000, 0)).toBeCloseTo(10, 6);
    // Absorption ajoutée linéairement.
    expect(transmissionLoss(100_000, 4000, 0.1) - transmissionLoss(100_000, 4000, 0)).toBeCloseTo(10, 6);
  });
});

import { describe, expect, it } from 'vitest';

import { AdaptiveScale } from '../src/render/adaptive-scale.ts';

/** Fait tourner `seconds` secondes d'images de `dtMs` ; renvoie le nombre de changements d'échelle. */
function run(a: AdaptiveScale, dtMs: number, seconds: number, floor: number): number {
  let changes = 0;
  for (let t = 0; t < seconds * 1000; t += dtMs) if (a.frame(dtMs, floor)) changes++;
  return changes;
}

describe('échelle de rendu adaptative', () => {
  it('reste fixe sans plancher (cibles écran et projecteur)', () => {
    const a = new AdaptiveScale();
    expect(run(a, 40, 30, 1)).toBe(0);
    expect(a.factor).toBe(1);
  });

  it('ne bouge pas quand la cadence est tenue', () => {
    const a = new AdaptiveScale();
    expect(run(a, 16.7, 60, 0.6)).toBe(0);
    expect(a.factor).toBe(1);
  });

  it('descend par paliers jusqu\'au plancher quand l\'appareil ne suit pas', () => {
    const a = new AdaptiveScale();
    run(a, 33, 5, 0.6);
    expect(a.factor).toBeLessThan(1);
    expect(a.factor).toBeGreaterThan(0.6);
    run(a, 33, 60, 0.6);
    expect(a.factor).toBeCloseTo(0.6, 6);
  });

  it('ignore les calages (onglet en arrière-plan)', () => {
    const a = new AdaptiveScale();
    for (let i = 0; i < 50; i++) a.frame(900, 0.6);
    expect(a.factor).toBe(1);
  });

  it('remonte quand la marge revient, puis se fixe après une rechute', () => {
    const a = new AdaptiveScale();
    run(a, 33, 3, 0.6);
    const low = a.factor;
    expect(low).toBeCloseTo(0.85, 6);
    run(a, 12, 20, 0.6);
    expect(a.factor).toBe(1);
    run(a, 33, 3, 0.6);
    expect(a.factor).toBeCloseTo(0.85, 6);
    // Plafond : plus de remontée, donc plus d'oscillation.
    expect(run(a, 12, 60, 0.6)).toBe(0);
    expect(a.factor).toBeCloseTo(0.85, 6);
  });

  it('respecte un plancher relevé en cours de route', () => {
    const a = new AdaptiveScale();
    run(a, 33, 60, 0.6);
    expect(a.frame(16, 0.9)).toBe(true);
    expect(a.factor).toBeCloseTo(0.9, 6);
  });
});

import { describe, expect, it } from 'vitest';
import { callNoise, communicationRange, signalExcess } from '../src/acoustics/sonar.ts';
import { fray, isAlive, isAsymmetric, newLink, updateLink, type LinkOptions } from '../src/whales/links.ts';

const BLUE = { sl: 186, dt: 6, callBandwidthHz: 5 };
const OPTS: LinkOptions = { hysteresisDb: 2, breakSec: 4, reknitSec: 10, ghostSec: 120 };

describe('équation du sonar', () => {
  it('bruit dans la bande de l\'appel', () => {
    // bande basse 10–40 Hz (30 Hz), appel de 5 Hz : −7,8 dB
    expect(callNoise(88, 30, 5)).toBeCloseTo(88 - 10 * Math.log10(6), 6);
    expect(callNoise(88, 30, 100)).toBe(88); // appel plus large que la bande : pas de correction
  });

  it('portée du rorqual bleu en océan calme : des centaines de kilomètres', () => {
    const r = communicationRange(BLUE, callNoise(88, 30, 5), 4000, 0.007);
    expect(r / 1000).toBeGreaterThan(300);
    expect(r / 1000).toBeLessThan(2000);
    expect(signalExcess(BLUE, r, 4000, 0.007, callNoise(88, 30, 5))).toBeCloseTo(0, 3);
  });

  it('+20 dB de bruit divisent la portée par un facteur important (cylindrique : ~100 sans absorption)', () => {
    const quiet = communicationRange(BLUE, 80, 4000, 0);
    const noisy = communicationRange(BLUE, 100, 4000, 0);
    expect(quiet / noisy).toBeCloseTo(100, 0);
  });

  it('appel inaudible si le bruit couvre tout', () => {
    expect(communicationRange(BLUE, 200, 4000, 0)).toBe(0);
  });
});

describe('liens entre groupes', () => {
  it('se forme, devient asymétrique quand le bruit monte chez A, se rompt, laisse une trace, se retisse', () => {
    const l = newLink();
    // Calme : les deux s'entendent (marge +10 dB) — reconnexion lente (10 s).
    for (let t = 0; t < 12; t++) updateLink(l, 10, 10, 1, OPTS);
    expect(isAlive(l)).toBe(true);
    expect(isAsymmetric(l)).toBe(false);
    // Un navire passe près de A : A n'entend plus B (−8 dB), B entend encore A.
    for (let t = 0; t < 6; t++) updateLink(l, -8, 5, 1, OPTS);
    expect(isAsymmetric(l)).toBe(true);
    expect(l.aHearsB.strength).toBe(0);
    // Le bruit couvre tout : rupture, fantôme.
    for (let t = 0; t < 6; t++) updateLink(l, -8, -8, 1, OPTS);
    expect(isAlive(l)).toBe(false);
    expect(l.ghost).toBeGreaterThan(0.9);
    // Le navire s'éloigne : le lien se retisse lentement.
    updateLink(l, 10, 10, 3, OPTS);
    expect(isAlive(l)).toBe(false);
    for (let t = 0; t < 10; t++) updateLink(l, 10, 10, 1, OPTS);
    expect(isAlive(l)).toBe(true);
  });

  it('hystérésis : pas de clignotement autour du seuil', () => {
    const l = newLink();
    for (let t = 0; t < 12; t++) updateLink(l, 10, 10, 1, OPTS);
    for (let t = 0; t < 20; t++) updateLink(l, t % 2 ? 1.5 : -1.5, 10, 1, OPTS);
    expect(l.aHearsB.target).toBe(true);
    expect(l.aHearsB.strength).toBe(1);
  });

  it('effilochage pendant la rupture', () => {
    const l = newLink();
    for (let t = 0; t < 12; t++) updateLink(l, 10, 10, 1, OPTS);
    updateLink(l, -10, -10, 1, OPTS);
    expect(fray(l)).toBeGreaterThan(0.5);
    expect(fray(l)).toBeLessThan(1);
  });
});

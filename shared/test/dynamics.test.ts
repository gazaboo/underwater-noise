import { readFileSync } from 'node:fs';
import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';
import { acousticComponents, configSchema, deepMerge, PHYS_COURANT, PHYS_POLAR_CAP_DEG, PhysicalSteps, physicsStepSeconds, SOUND_SPEED_M_S, waveVisibility } from '../src/index.ts';

describe('temps physique et visibilité', () => {
  it.each([256, 768, 1024, 2048])('relie les cellules de la grille %i aux secondes et aux mètres', width => {
    const cell = 2 * Math.PI * 6_371_000 / width;
    expect(PHYS_COURANT * cell / physicsStepSeconds(cell)).toBeCloseTo(1500, 10);
    expect(SOUND_SPEED_M_S * 60).toBe(90_000);
  });
  it('reste stable jusqu’à la limite du domaine sans réduire localement la célérité', () => {
    for (let lat = -PHYS_POLAR_CAP_DEG; lat <= PHYS_POLAR_CAP_DEG; lat++) {
      expect((4 / 3) * PHYS_COURANT ** 2 * (1 + 1 / Math.cos(lat * Math.PI / 180) ** 2)).toBeLessThan(0.95 ** 2);
    }
  });
  it('conserve les mêmes pas et le reliquat à toutes les cadences et accélérations', () => {
    const counts = [];
    for (const fps of [15, 60, 120]) for (const scale of [1, 10, 100]) {
      const clock = new PhysicalSteps(); let n = 0;
      for (let i = 0; i < fps * 60 / scale; i++) clock.advance(scale / fps, 4.17, () => n++);
      counts.push(n);
      expect(clock.fraction).toBeCloseTo(60 - n * 4.17, 8);
    }
    expect(new Set(counts)).toEqual(new Set([14]));
  });
  it('éteint les fronts sous +1 dB, avec une transition fixe et monotone jusqu’à +10 dB', () => {
    expect(waveVisibility(0)).toBe(0);
    expect(waveVisibility(1)).toBe(0);
    expect(waveVisibility(5.5)).toBeCloseTo(0.5);
    expect(waveVisibility(10)).toBe(1);
    expect(waveVisibility(100)).toBe(1);
    // Even a source ten decibels below the natural background must remain invisible.
    expect(waveVisibility(acousticComponents(70, 80).excessDb)).toBe(0);
    expect(waveVisibility(acousticComponents(80, 80).excessDb)).toBeGreaterThan(0);
  });
});

describe('migration des réglages artistiques', () => {
  const defaults = JSON5.parse(readFileSync(new URL('../../config/default.json5', import.meta.url), 'utf8'));
  it('ignore les anciennes vitesses et pertes, en conservant la nouvelle horloge et l’apparence', () => {
    const cfg = configSchema.parse(deepMerge(defaults, {
      playback: { timeScale: 10 }, simulation: { timeScale: 20 }, estimated: { timeScale: 40 }, replay: { speed: 30 }, whales: { timeScale: 300 },
      waves: { courant: .67, damping: 0, shallowSpeed: .2, amplitude: { slMin: 0 }, brightness: 4, band: 'mid' },
    }));
    expect(cfg.playback.timeScale).toBe(10);
    expect([cfg.simulation.timeScale, cfg.estimated.timeScale, cfg.replay.speed, cfg.whales.timeScale]).toEqual([1, 1, 1, 1]);
    expect(cfg.waves).toEqual({ band: 'mid', brightness: 4, relief: defaults.waves.relief });
  });
  it('revient à ×1 pour une configuration ancienne et refuse un facteur non fini ou hors plage', () => {
    const old = { ...defaults }; delete old.playback;
    expect(configSchema.parse(old).playback.timeScale).toBe(1);
    for (const timeScale of [0, 101, Infinity, NaN]) expect(configSchema.safeParse(deepMerge(defaults, { playback: { timeScale } })).success).toBe(false);
  });
});

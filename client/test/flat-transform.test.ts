import { describe, expect, it } from 'vitest';
import type { Config } from '@vacarme/shared';
import { computeFlatTransform, screenToGeo, worldTransform } from '../src/render/flat-view.ts';

const cfg = { view: { flat: { centerLon: 30, latMin: -62, latMax: 78, fit: 'cover' } } } as Config;
describe('navigation et ornements des terres', () => {
  it('le cadrage initial a un zoom de 1 et conserve le centre géographique', () => {
    const view = computeFlatTransform(cfg, 1280, 800);
    expect(view.zoom).toBe(1);
    expect(screenToGeo(view, 640, 400)).toEqual([30, 8]);
  });
  it('le zoom transmis aux ornements suit la navigation et le facteur de projection', () => {
    const initial = computeFlatTransform(cfg, 1280, 800);
    const view = computeFlatTransform(cfg, 1280, 800, { zoom: 12, centerLon: -62, centerLat: -5 });
    expect(view.zoom).toBe(12);
    expect(view.scale).toBe(initial.scale * 12);
    expect(screenToGeo(view, 640, 400)).toEqual([-62, -5]);
  });
  it('la texture monde exclut les ornements et couvre les deux pôles', () => {
    const world = worldTransform(2048);
    expect(world.zoom).toBe(0);
    expect(screenToGeo(world, 0, 0)).toEqual([-180, -90]);
    expect(screenToGeo(world, 2048, 1024)).toEqual([180, 90]);
  });
});

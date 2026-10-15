import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import JSON5 from 'json5';
import { configSchema } from '@vacarme/shared';
import { globeCamera, pixelToGeo, viewToEarth, type GlobeMode } from '../src/render/globe-view.ts';
import { projectGeo } from '../src/render/ornaments.ts';

const root = new URL('../../', import.meta.url);
const cfgOf = (roll = 0, shift = 0, model = 'equidistant') => ({
  globe: { screenSize: 0.9 },
  hemisphere: { distanceRatio: 5.5, throwRatio: 1.6, shiftX: shift, shiftY: -shift, scale: 1.1, rollDeg: roll },
  fisheye: { fovDeg: 200, model },
}) as never;

/** Aller-retour : géographie → image (projection des vignettes) → géographie (pixelToGeo). */
function roundTrip(mode: GlobeMode, cfg: never, lon: number, lat: number): [number, number] | null {
  const [W, H] = [1920, 1200];
  const M = viewToEarth(20, -30);
  const cam = globeCamera(mode, cfg, W / H, 1.3);
  const p = projectGeo(mode, cam, M, cfg, lon, lat, W / H);
  if (!p) return null;
  return pixelToGeo(mode, cam, M, cfg, p[0] * 0.5 * H + 0.5 * W, p[1] * 0.5 * H + 0.5 * H, W, H);
}

describe('vignettes du monde illustré : projection', () => {
  const points: [number, number][] = [[-30, 20], [-10, 35], [-55, -5], [5, 50], [-80, 10]];
  for (const mode of ['globe', 'hemisphere', 'fisheye', 'equirect'] as GlobeMode[]) {
    for (const [roll, shift, model] of [[0, 0, 'equidistant'], [12, 0.1, 'equisolid']] as const) {
      it(`${mode} (rotation ${roll}°, décalage ${shift}, ${model}) : retombe sur le même point`, () => {
        for (const [lon, lat] of points) {
          const back = roundTrip(mode, cfgOf(roll, shift, model), lon, lat);
          expect(back).not.toBeNull();
          expect(back![0]).toBeCloseTo(lat, 3);
          expect(back![1]).toBeCloseTo(lon, 3);
        }
      });
    }
  }

  it('face cachée du globe : aucune vignette', () => {
    const cfg = cfgOf();
    const M = viewToEarth(20, -30);
    expect(projectGeo('hemisphere', globeCamera('hemisphere', cfg, 1.6, 1), M, cfg, 150, -20, 1.6)).toBeNull();
    expect(projectGeo('globe', globeCamera('globe', cfg, 1.6, 1), M, cfg, 150, -20, 1.6)).toBeNull();
  });
});

describe('monde illustré : configuration et données', () => {
  it('la configuration par défaut est valide et choisit le monde illustré', () => {
    const cfg = configSchema.parse(JSON5.parse(readFileSync(new URL('config/default.json5', root), 'utf8')));
    expect(cfg.land.style).toBe('illustre');
    expect(Object.keys(cfg.land.illustrated.night)).toEqual(Object.keys(cfg.land.illustrated.day));
  });

  it('chaque catégorie d\'ornement placée a des vignettes dans l\'atlas', () => {
    const orn = JSON.parse(readFileSync(new URL('data/grid/ornaments.json', root), 'utf8'));
    const atlas = JSON.parse(readFileSync(new URL('data/ornaments/atlas.json', root), 'utf8'));
    const used = new Set<number>(orn.ornaments.map((o: number[]) => o[2]));
    for (const c of used) expect(atlas.categories[orn.categories[c]]?.length, orn.categories[c]).toBeGreaterThan(0);
    for (const c of orn.categories) expect(orn.spacing[c]).toHaveLength(4);
    for (const s of atlas.sprites) {
      expect(s.index).toBeLessThan(atlas.cols * atlas.cols);
      expect(s.pivot[1]).toBeGreaterThan(0);
      expect(s.pivot[1]).toBeLessThan(1);
    }
    expect(atlas.categories.smoke?.length).toBeGreaterThan(0);
    expect(atlas.categories.cloud?.length).toBeGreaterThan(0);
  });

  it('les niveaux de détail sont emboîtés : chaque niveau est plus dense que le précédent', () => {
    const orn = JSON.parse(readFileSync(new URL('data/grid/ornaments.json', root), 'utf8'));
    const perLevel = [0, 1, 2, 3].map((l) => orn.ornaments.filter((o: number[]) => o[3] === l).length);
    for (let l = 1; l < 4; l++) expect(perLevel[l]).toBeGreaterThan(perLevel[l - 1]);
  });
});

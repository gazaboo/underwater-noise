import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { globeCamera, pixelToGeo, viewToEarth } from '../src/render/globe-view.ts';

const cfg = {
  globe: { screenSize: 0.9 },
  hemisphere: { distanceRatio: 5.5, throwRatio: 1.6, shiftX: 0, shiftY: 0, scale: 1, rollDeg: 0 },
  fisheye: { fovDeg: 180, model: 'equidistant' },
} as never;

function toGeo(v: THREE.Vector3): [number, number] {
  return [(Math.asin(v.y) * 180) / Math.PI, (Math.atan2(v.x, v.z) * 180) / Math.PI];
}

describe('géométrie du globe', () => {
  it('la direction face au public tombe sur le point choisi', () => {
    const [lat, lon] = toGeo(new THREE.Vector3(0, 0, 1).applyMatrix3(viewToEarth(25, -40)));
    expect(lat).toBeCloseTo(25, 6);
    expect(lon).toBeCloseTo(-40, 6);
  });

  it('le centre de l\'image du projecteur est le point face au public ; le nord est en haut', () => {
    const M = viewToEarth(25, 10);
    const cam = globeCamera('hemisphere', cfg, 1.6, 1);
    const c = pixelToGeo('hemisphere', cam, M, cfg, 960, 600, 1920, 1200)!;
    expect(c[0]).toBeCloseTo(25, 4);
    expect(c[1]).toBeCloseTo(10, 4);
    const up = pixelToGeo('hemisphere', cam, M, cfg, 960, 800, 1920, 1200)!;
    expect(up[0]).toBeGreaterThan(25); // plus haut à l'image = plus au nord
    const right = pixelToGeo('hemisphere', cam, M, cfg, 1160, 600, 1920, 1200)!;
    expect(right[1]).toBeGreaterThan(10); // à droite = à l'est
  });

  it('hors du disque : aucun point', () => {
    const cam = globeCamera('hemisphere', cfg, 1.6, 1);
    expect(pixelToGeo('hemisphere', cam, viewToEarth(0, 0), cfg, 5, 600, 1920, 1200)).toBeNull();
  });

  it('équirect : coins et centre', () => {
    const M = viewToEarth(0, 0);
    const cam = globeCamera('globe', cfg, 2, 1);
    expect(pixelToGeo('equirect', cam, M, cfg, 1000, 500, 2000, 1000)).toEqual([0, 0]);
    const ne = pixelToGeo('equirect', cam, M, cfg, 1999, 999, 2000, 1000)!;
    expect(ne[0]).toBeGreaterThan(89);
    expect(ne[1]).toBeGreaterThan(179);
  });

  it('fisheye : le bord à 90° du centre (champ de 180°)', () => {
    const M = viewToEarth(0, 0);
    const cam = globeCamera('globe', cfg, 1, 1);
    const edge = pixelToGeo('fisheye', cam, M, cfg, 999.99, 500, 1000, 1000)!;
    expect(edge[1]).toBeCloseTo(90, 0);
  });
});

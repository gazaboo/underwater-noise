/**
 * Projection écran commune aux couches dessinées après la composition (ornements du monde, glyphes des
 * cétacés) : point géographique → espace p (y ∈ [−1, 1] sur la hauteur de l'image) pour chaque mode
 * (carte plate, globe, demi-sphère avec la caméra du projecteur, équirect, fisheye). Ces couches restent
 * nettes à la résolution de l'écran, au lieu d'être réduites dans la texture monde.
 */
import * as THREE from 'three';
import type { Config } from '@vacarme/shared';
import type { FlatTransform } from './flat-view.ts';
import type { GlobeCamera, GlobeMode } from './globe-view.ts';

const DEG = Math.PI / 180;

export const PROJECTION_GLSL = /* glsl */ `
uniform int uMode;       // 0 carte, 1 globe, 2 demi-sphère, 3 équirect, 4 fisheye
uniform vec2 uResolution;
uniform float uPxRatio;
// Carte plate
uniform vec2 uCenter, uLatRange;
uniform float uFlatScale;
// Globe / demi-sphère / fisheye
uniform mat3 uMt;        // Terre → vue (transposée de M)
uniform float uDist, uTanHalf, uGScale, uRoll, uFishHalf;
uniform vec2 uShift;
uniform int uFishModel;
uniform float uRp;       // rayon de la Terre à l'écran (unités p)

vec3 earth(float lonDeg, float latDeg) {
  float lo = radians(lonDeg), la = radians(latDeg);
  return vec3(cos(la) * sin(lo), sin(la), cos(la) * cos(lo));
}

// Projection d'un point de la Terre dans l'espace p (y ∈ [−1, 1] sur la hauteur de l'image).
// vis : 0 si caché ; inc : cosinus d'incidence (globe / demi-sphère).
vec2 project(vec3 e, float lonDeg, float latDeg, out float vis, out float inc) {
  vis = 1.0; inc = 1.0;
  if (uMode == 0) {
    float dl = mod(lonDeg - uCenter.x + 180.0, 360.0) - 180.0;
    if (latDeg < uLatRange.x || latDeg > uLatRange.y) vis = 0.0;
    return vec2(dl, latDeg - uCenter.y) * uFlatScale / (0.5 * uResolution.y);
  }
  if (uMode == 3) {
    float a = uResolution.x / uResolution.y;
    vec2 frame = a >= 2.0 ? vec2(2.0, 1.0) : vec2(a, 0.5 * a);
    return vec2(lonDeg / 180.0, latDeg / 90.0) * frame;
  }
  vec3 n = uMt * e;
  if (uMode == 4) {
    float th = acos(clamp(n.z, -1.0, 1.0));
    float r = uFishModel == 0 ? th / uFishHalf : sin(th * 0.5) / sin(uFishHalf * 0.5);
    vis = 1.0 - smoothstep(0.97, 1.0, r);
    vec2 d = length(n.xy) > 1e-6 ? normalize(n.xy) : vec2(0.0);
    return d * r;
  }
  vec3 ro = vec3(0.0, 0.0, uDist);
  vec3 d = n - ro;
  inc = dot(normalize(ro - n), n);
  vis = smoothstep(0.05, 0.3, inc); // effacées avant le bord du disque (pas de hérisson au limbe)
  vec2 s = d.xy / (-d.z * uTanHalf);
  float c = cos(radians(uRoll)), sn = sin(radians(uRoll));
  s = vec2(c * s.x + sn * s.y, -sn * s.x + c * s.y); // rotation inverse de celle du rayon
  return s * uGScale + uShift;
}

// Demi-sphère : rien hors du disque (le mur ne doit rien recevoir) ; fisheye : idem hors du cercle.
bool outsideDisc(vec2 frag) {
  vec2 p = (frag - 0.5 * uResolution) / (0.5 * uResolution.y);
  if (uMode == 2) {
    vec2 s = (p - uShift) / uGScale;
    float c = cos(radians(uRoll)), sn = sin(radians(uRoll));
    s = mat2(c, sn, -sn, c) * s;
    vec3 ro = vec3(0.0, 0.0, uDist);
    vec3 rd = normalize(vec3(s * uTanHalf, -1.0));
    float b = dot(ro, rd);
    if (b * b - (dot(ro, ro) - 1.0) <= 0.0) return true;
  }
  return uMode == 4 && length(p) > 1.0;
}`;

export interface ScreenView {
  mode: 'flat' | GlobeMode;
  width: number;
  height: number;
  pixelRatio: number;
  flat?: FlatTransform;
  cam?: GlobeCamera;
  M?: THREE.Matrix3;
}

export function projectionUniforms(): Record<string, THREE.IUniform> {
  return {
    uMode: { value: 0 }, uResolution: { value: new THREE.Vector2() }, uPxRatio: { value: 1 },
    uCenter: { value: new THREE.Vector2() }, uLatRange: { value: new THREE.Vector2(-90, 90) }, uFlatScale: { value: 1 },
    uMt: { value: new THREE.Matrix3() }, uDist: { value: 4.5 }, uTanHalf: { value: 0.3 }, uGScale: { value: 1 }, uRoll: { value: 0 },
    uShift: { value: new THREE.Vector2() }, uFishHalf: { value: Math.PI / 2 }, uFishModel: { value: 0 }, uRp: { value: 0.5 },
  };
}

export function setProjectionUniforms(u: Record<string, THREE.IUniform>, v: ScreenView, cfg: Config): void {
  u.uMode.value = { flat: 0, globe: 1, hemisphere: 2, equirect: 3, fisheye: 4 }[v.mode];
  (u.uResolution.value as THREE.Vector2).set(v.width, v.height);
  u.uPxRatio.value = v.pixelRatio;
  if (v.flat) {
    (u.uCenter.value as THREE.Vector2).set(v.flat.centerLon, v.flat.centerLat);
    (u.uLatRange.value as THREE.Vector2).set(v.flat.latMin, v.flat.latMax);
    u.uFlatScale.value = v.flat.scale;
  }
  if (v.M) (u.uMt.value as THREE.Matrix3).copy(v.M).transpose();
  if (v.cam) {
    u.uDist.value = v.cam.dist;
    u.uTanHalf.value = v.cam.tanHalf;
    u.uGScale.value = v.cam.scale;
    u.uRoll.value = v.cam.rollDeg;
    (u.uShift.value as THREE.Vector2).set(v.cam.shift[0], v.cam.shift[1]);
    u.uRp.value = v.cam.scale * Math.tan(Math.asin(1 / v.cam.dist)) / v.cam.tanHalf;
  }
  if (v.mode === 'fisheye') u.uRp.value = 1;
  u.uFishHalf.value = (cfg.fisheye.fovDeg * DEG) / 2;
  u.uFishModel.value = cfg.fisheye.model === 'equidistant' ? 0 : 1;
}

/** Pixels CSS par degré à l'affichage (au centre de la vue). */
export function displayPxPerDeg(v: ScreenView, cfg: Config): number {
  const halfH = 0.5 * v.height / v.pixelRatio;
  if (v.mode === 'flat') return (v.flat?.scale ?? 1) / v.pixelRatio;
  if (v.mode === 'equirect') {
    const a = v.width / v.height;
    return (a >= 2 ? 2 : a) * v.height / v.pixelRatio / 360;
  }
  if (v.mode === 'fisheye') return halfH / (cfg.fisheye.fovDeg / 2);
  const cam = v.cam!;
  const rp = cam.scale * Math.tan(Math.asin(1 / cam.dist)) / cam.tanHalf;
  return rp * halfH * DEG;
}

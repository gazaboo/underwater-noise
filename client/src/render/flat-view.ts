/**
 * Vue « carte plate » (équirectangulaire) : composition finale à l'écran.
 *
 * Chaque pixel de l'écran est ramené à (lon, lat), puis on compose :
 *   fond océanique (profondeur + relief à peine perceptible) → ondes (lumière froide)
 *   → terres et trait de côte → vignettage, exposition, gamma, plancher de noir, tramage.
 */
import * as THREE from 'three';
import type { Config } from '@vacarme/shared';
import type { WorldAssets } from '../assets.ts';
import { FullscreenPass, hexToVec3, rawMaterial } from './fullscreen.ts';
import type { WaveSim } from '../sim/wave-sim.ts';

/** Transformation écran ↔ géographie de la carte plate (pixels du tampon de rendu). */
export interface FlatTransform {
  width: number;
  height: number;
  /** Pixels par degré. */
  scale: number;
  centerLon: number;
  centerLat: number;
  latMin: number;
  latMax: number;
}

/** Navigation interactive (zoom, déplacement) par-dessus le cadrage de la configuration. */
export interface FlatNav {
  /** Facteur de zoom (1 = cadrage de la configuration). */
  zoom: number;
  centerLon: number;
  centerLat: number;
}

export const MAX_ZOOM = 40;

export function computeFlatTransform(cfg: Config, width: number, height: number, nav?: FlatNav): FlatTransform {
  const { centerLon, latMin, latMax, fit } = cfg.view.flat;
  const lo = Math.min(latMin, latMax);
  const hi = Math.max(latMin, latMax);
  const latSpan = Math.max(1, hi - lo);
  const sx = width / 360;
  const sy = height / latSpan;
  const base = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  if (!nav) return { width, height, scale: base, centerLon, centerLat: (lo + hi) / 2, latMin: lo, latMax: hi };
  const scale = base * nav.zoom;
  return { width, height, scale, centerLon: nav.centerLon, centerLat: clampCenterLat(nav.centerLat, lo, hi, height / 2 / scale), latMin: lo, latMax: hi };
}

/** Garde la vue dans la bande de latitudes autorisée (ou centrée si la vue est plus haute). */
export function clampCenterLat(lat: number, lo: number, hi: number, halfSpan: number): number {
  if (hi - lo <= 2 * halfSpan) return (lo + hi) / 2;
  return Math.min(hi - halfSpan, Math.max(lo + halfSpan, lat));
}

/** Point géographique (lon, lat) sous un pixel du tampon (origine en bas à gauche). */
export function screenToGeo(view: FlatTransform, x: number, y: number): [number, number] {
  return [view.centerLon + (x - view.width / 2) / view.scale, view.centerLat + (y - view.height / 2) / view.scale];
}

const COMPOSITE_FRAG = /* glsl */ `
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uElevN;   // altitude 16 bits (au plus proche)
uniform sampler2D uElevL;   // fraction de terre en B (linéaire)
uniform sampler2D uWave;    // R = u
uniform sampler2D uCoverage; // R = couverture AIS (0 = jamais observé)
uniform float uUnknownDim;
uniform vec2 uWaveTexel;
uniform sampler2D uDetail;     // grille de détail (zoom)
uniform vec4 uDetailDomain;    // centre lon, bord nord, étendue lon, étendue lat (degrés)
uniform vec2 uDetailTexel;
uniform float uDetailWeight;
uniform vec2 uElevTexel;

uniform vec2 uResolution;
uniform vec2 uCenter;
uniform float uScale;
uniform vec2 uLatRange;
uniform float uPolarCap;

uniform vec3 uBackground, uOceanShallow, uOceanDeep, uLand, uCoast, uWaveColor;
uniform float uBathyRelief, uCoastOpacity;
uniform float uWaveBrightness, uWaveRelief;
uniform float uExposure, uGamma, uBlackLift, uVignette;
uniform bool uDither;
uniform float uTime;

const float PI = 3.141592653589793;

float altitude(vec2 uv) {
  vec4 e = texture(uElevN, uv);
  return (e.r * 255.0 * 256.0 + e.g * 255.0) - 11000.0;
}

// Catmull-Rom en 9 lectures bilinéaires (d'après J. Jimenez) : ondes douces même de près.
float sampleCubic(sampler2D tex, vec2 uv, vec2 texel) {
  vec2 size = 1.0 / texel;
  vec2 pos = uv * size;
  vec2 c = floor(pos - 0.5) + 0.5;
  vec2 f = pos - c;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 o12 = w2 / w12;
  vec2 t0 = (c - 1.0) * texel;
  vec2 t3 = (c + 2.0) * texel;
  vec2 t12 = (c + o12) * texel;
  float r = 0.0;
  r += texture(tex, vec2(t0.x, t0.y)).r * w0.x * w0.y;
  r += texture(tex, vec2(t12.x, t0.y)).r * w12.x * w0.y;
  r += texture(tex, vec2(t3.x, t0.y)).r * w3.x * w0.y;
  r += texture(tex, vec2(t0.x, t12.y)).r * w0.x * w12.y;
  r += texture(tex, vec2(t12.x, t12.y)).r * w12.x * w12.y;
  r += texture(tex, vec2(t3.x, t12.y)).r * w3.x * w12.y;
  r += texture(tex, vec2(t0.x, t3.y)).r * w0.x * w3.y;
  r += texture(tex, vec2(t12.x, t3.y)).r * w12.x * w3.y;
  r += texture(tex, vec2(t3.x, t3.y)).r * w3.x * w3.y;
  return r;
}

// Valeur (bicubique) et gradient (différences centrées) d'un champ d'ondes.
vec3 waveAt(sampler2D tex, vec2 uv, vec2 texel) {
  float w = sampleCubic(tex, uv, texel);
  float wx = texture(tex, uv + vec2(texel.x, 0.0)).r - texture(tex, uv - vec2(texel.x, 0.0)).r;
  float wy = texture(tex, uv - vec2(0.0, texel.y)).r - texture(tex, uv + vec2(0.0, texel.y)).r;
  return vec3(w, wx, wy);
}

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 d = (frag - 0.5 * uResolution) / uScale;
  float lon = uCenter.x + d.x;
  float lat = uCenter.y + d.y;
  vec3 col = uBackground;

  if (lat >= uLatRange.x && lat <= uLatRange.y && abs(d.x) <= 180.0) {
    vec2 uv = vec2(fract((lon + 180.0) / 360.0), (90.0 - lat) / 180.0);

    // --- Fond océanique : profondeur et relief (ombrage du fond marin).
    float alt = altitude(uv);
    float depth = max(-alt, 0.0);
    float t = smoothstep(0.0, 5500.0, depth);
    vec3 ocean = mix(uOceanShallow, uOceanDeep, pow(t, 0.7));
    float ax = altitude(uv + vec2(uElevTexel.x, 0.0)) - altitude(uv - vec2(uElevTexel.x, 0.0));
    float ay = altitude(uv - vec2(0.0, uElevTexel.y)) - altitude(uv + vec2(0.0, uElevTexel.y));
    vec3 n = normalize(vec3(-ax, -ay, 9000.0));
    float shade = dot(n, normalize(vec3(-0.6, 0.5, 0.62))) - 0.62;
    ocean *= 1.0 + uBathyRelief * 6.0 * shade;
    ocean = max(ocean, vec3(0.0));

    // --- Ondes : intensité de crête et éclairage « relief » des fronts.
    vec3 wg = waveAt(uWave, uv, uWaveTexel);
    // Grille de détail (zoom) : fondue sur ses bords et à son démarrage.
    if (uDetailWeight > 0.0) {
      float dLon = mod(lon - uDetailDomain.x + 180.0, 360.0) - 180.0;
      vec2 duv = vec2(dLon / uDetailDomain.z + 0.5, (uDetailDomain.y - lat) / uDetailDomain.w);
      float edge = smoothstep(0.0, 0.08, min(min(duv.x, 1.0 - duv.x), min(duv.y, 1.0 - duv.y)));
      if (edge > 0.0) wg = mix(wg, waveAt(uDetail, duv, uDetailTexel), edge * uDetailWeight);
    }
    float w = wg.x;
    float wx = wg.y;
    float wy = wg.z;
    vec3 wn = normalize(vec3(-wx * 4.0, -wy * 4.0, 1.0));
    float glint = max(dot(wn, normalize(vec3(-0.45, 0.55, 0.7))) - 0.7, 0.0) * 6.0;
    // Crête positive seule : une ligne de lumière fine par front (le creux reste sombre).
    float crest = pow(max(w, 0.0), 1.3) + 0.15 * max(-w, 0.0);
    float lightW = uWaveBrightness * ((1.0 - uWaveRelief) * crest + uWaveRelief * glint);
    // Compression douce : les zones très actives saturent sans brûler.
    lightW = 1.0 - exp(-lightW);
    if (abs(lat) > uPolarCap) lightW = 0.0;

    // --- Terra incognita (rendu simple du J2) : zones non observées par l'AIS assombries.
    // Le son des navires connus s'y propage bien : les ondes y entrent, mais s'y estompent.
    float observed = smoothstep(0.03, 0.4, texture(uCoverage, uv).r);
    float dim = mix(uUnknownDim, 1.0, observed);

    vec3 sea = (ocean + uWaveColor * lightW) * dim;

    // --- Terres et trait de côte (fraction de terre interpolée : côte anti-crénelée).
    float frac = texture(uElevL, uv).b;
    float land = smoothstep(0.42, 0.58, frac);
    float coast = exp(-pow((frac - 0.5) / 0.16, 2.0)) * uCoastOpacity;
    col = mix(sea, uLand, land) + uCoast * coast;
  }

  // --- Finition.
  vec2 q = frag / uResolution - 0.5;
  q.x *= uResolution.x / uResolution.y;
  col *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(q) * 1.2);
  col *= uExposure;
  col = pow(max(col, 0.0), vec3(1.0 / uGamma));
  col = uBlackLift + (1.0 - uBlackLift) * col;
  if (uDither) col += (hash(frag + fract(uTime) * 61.0) - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
}`;

export class FlatView {
  private readonly pass: FullscreenPass;
  readonly uniforms: Record<string, THREE.IUniform>;

  constructor(assets: WorldAssets) {
    const v3 = () => new THREE.Vector3();
    this.uniforms = {
      uElevN: { value: assets.elevationNearest },
      uElevL: { value: assets.elevationLinear },
      uWave: { value: null },
      uCoverage: { value: null },
      uDetail: { value: null },
      uDetailDomain: { value: new THREE.Vector4(0, 90, 360, 180) },
      uDetailTexel: { value: new THREE.Vector2(1, 1) },
      uDetailWeight: { value: 0 },
      uUnknownDim: { value: 1 },
      uWaveTexel: { value: new THREE.Vector2() },
      uElevTexel: { value: new THREE.Vector2(1 / 4096, 1 / 2048) },
      uResolution: { value: new THREE.Vector2() },
      uCenter: { value: new THREE.Vector2() },
      uScale: { value: 1 },
      uLatRange: { value: new THREE.Vector2() },
      uPolarCap: { value: 79 },
      uBackground: { value: v3() },
      uOceanShallow: { value: v3() },
      uOceanDeep: { value: v3() },
      uLand: { value: v3() },
      uCoast: { value: v3() },
      uWaveColor: { value: v3() },
      uBathyRelief: { value: 0 },
      uCoastOpacity: { value: 0 },
      uWaveBrightness: { value: 1 },
      uWaveRelief: { value: 0.5 },
      uExposure: { value: 1 },
      uGamma: { value: 1 },
      uBlackLift: { value: 0 },
      uVignette: { value: 0 },
      uDither: { value: true },
      uTime: { value: 0 },
    };
    this.pass = new FullscreenPass(rawMaterial(COMPOSITE_FRAG, this.uniforms));
  }

  render(renderer: THREE.WebGLRenderer, wave: THREE.Texture, waveSize: THREE.Vector2Like, coverage: THREE.Texture, view: FlatTransform, cfg: Config, time: number, detail?: { sim: WaveSim; weight: number }): void {
    const u = this.uniforms;
    if (detail && detail.weight > 0) {
      const d = detail.sim.domain;
      u.uDetail.value = detail.sim.texture;
      (u.uDetailDomain.value as THREE.Vector4).set(d.lonCenter, d.latTop, d.lonSpan, d.latSpan);
      (u.uDetailTexel.value as THREE.Vector2).set(1 / detail.sim.width, 1 / detail.sim.height);
      u.uDetailWeight.value = detail.weight;
    } else {
      u.uDetail.value = wave; // jamais échantillonnée (poids nul), mais il faut une texture valide
      u.uDetailWeight.value = 0;
    }
    u.uWave.value = wave;
    u.uCoverage.value = coverage;
    u.uUnknownDim.value = cfg.palette.unknownDim;
    (u.uWaveTexel.value as THREE.Vector2).set(1 / waveSize.x, 1 / waveSize.y);
    (u.uResolution.value as THREE.Vector2).set(view.width, view.height);
    (u.uCenter.value as THREE.Vector2).set(view.centerLon, view.centerLat);
    u.uScale.value = view.scale;
    (u.uLatRange.value as THREE.Vector2).set(view.latMin, view.latMax);
    u.uPolarCap.value = cfg.waves.polarCapLat;
    const p = cfg.palette;
    hexToVec3(p.background, u.uBackground.value);
    hexToVec3(p.oceanShallow, u.uOceanShallow.value);
    hexToVec3(p.oceanDeep, u.uOceanDeep.value);
    hexToVec3(p.land, u.uLand.value);
    hexToVec3(p.coast, u.uCoast.value);
    hexToVec3(p.wave, u.uWaveColor.value);
    u.uBathyRelief.value = p.bathyRelief;
    u.uCoastOpacity.value = p.coastOpacity;
    u.uWaveBrightness.value = cfg.waves.brightness;
    u.uWaveRelief.value = cfg.waves.relief;
    const r = cfg.render;
    u.uExposure.value = r.exposure;
    u.uGamma.value = r.gamma;
    u.uBlackLift.value = r.blackLift;
    u.uVignette.value = r.vignette;
    u.uDither.value = r.dither;
    u.uTime.value = time;
    this.pass.render(renderer, null);
  }
}

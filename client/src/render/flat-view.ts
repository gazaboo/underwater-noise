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

export function computeFlatTransform(cfg: Config, width: number, height: number): FlatTransform {
  const { centerLon, latMin, latMax, fit } = cfg.view.flat;
  const lo = Math.min(latMin, latMax);
  const hi = Math.max(latMin, latMax);
  const latSpan = Math.max(1, hi - lo);
  const sx = width / 360;
  const sy = height / latSpan;
  const scale = fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  return { width, height, scale, centerLon, centerLat: (lo + hi) / 2, latMin: lo, latMax: hi };
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
    float w = texture(uWave, uv).r;
    float wx = texture(uWave, uv + vec2(uWaveTexel.x, 0.0)).r - texture(uWave, uv - vec2(uWaveTexel.x, 0.0)).r;
    float wy = texture(uWave, uv - vec2(0.0, uWaveTexel.y)).r - texture(uWave, uv + vec2(0.0, uWaveTexel.y)).r;
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

  render(renderer: THREE.WebGLRenderer, wave: THREE.Texture, waveSize: THREE.Vector2Like, coverage: THREE.Texture, view: FlatTransform, cfg: Config, time: number): void {
    const u = this.uniforms;
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

/**
 * Vue « carte plate » (équirectangulaire) : composition finale à l'écran.
 *
 * Chaque pixel de l'écran est ramené à (lon, lat), puis on compose :
 *   fond océanique (profondeur + relief à peine perceptible) → ondes (lumière froide)
 *   → terres et trait de côte → vignettage, exposition, gamma, plancher de noir, tramage.
 */
import * as THREE from 'three';
import { naturalLevel, PHYS_POLAR_CAP_DEG, WAVE_VISIBLE_DB, WAVE_FULL_DB, type Config } from '@vacarme/shared';
import type { WorldAssets } from '../assets.ts';
import { FullscreenPass, hexToVec3, rawMaterial } from './fullscreen.ts';
import type { PhysicsField } from '../sim/physics-sim.ts';

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

/** Transformation de la texture « monde » : équirectangulaire complète, 360° × 180°. */
export function worldTransform(width: number): FlatTransform {
  return { width, height: width / 2, scale: width / 360, centerLon: 0, centerLat: 0, latMin: -90, latMax: 90 };
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

uniform sampler2D uElevN;   // altitude 16 bits (lue texel par texel, interpolée après décodage)
uniform sampler2D uElevL;   // fraction de terre en B (linéaire)
uniform sampler2D uWave;    // R = u
uniform sampler2D uCoverage; // R = couverture AIS (0 = jamais observé)
uniform float uUnknownDim;
uniform vec2 uWaveTexel;
uniform float uWaveMix;
uniform vec2 uElevTexel;
uniform sampler2D uLevels;      // R = niveau affiché accumulé (dB), G/B/A = niveaux par bande (dB re 1 µPa)
uniform vec2 uLevelsTexel;
uniform float uHasLevels;
uniform float uQuietDb, uSatDb, uGlowGamma, uGlowStrength;
uniform vec3 uGlowColor;
uniform vec3 uFogColor;
uniform float uFogStrength, uFogScale, uFogDrift, uGrain, uWaveKeep;
uniform int uDebugField;        // 0 : rendu ; 1 : niveau accumulé ; 2–4 : bandes basse, moyenne, haute

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
uniform bool uFinish;
uniform float uTime;

const float PI = 3.141592653589793;

float altitudeAt(ivec2 p, ivec2 size) {
  p.x = (p.x % size.x + size.x) % size.x;
  p.y = clamp(p.y, 0, size.y - 1);
  vec4 e = texelFetch(uElevN, p, 0);
  return (e.r * 255.0 * 256.0 + e.g * 255.0) - 11000.0;
}

// Altitude interpolée après décodage (le décodage 16 bits interdit le filtrage matériel) :
// au plus proche, le relief du fond marin se voyait en marches dès qu'on zoome.
float altitude(vec2 uv) {
  ivec2 size = textureSize(uElevN, 0);
  vec2 pos = uv * vec2(size) - 0.5;
  ivec2 i = ivec2(floor(pos));
  vec2 f = pos - floor(pos);
  return mix(mix(altitudeAt(i, size), altitudeAt(i + ivec2(1, 0), size), f.x),
             mix(altitudeAt(i + ivec2(0, 1), size), altitudeAt(i + ivec2(1, 1), size), f.x), f.y);
}

// Catmull-Rom en 9 lectures bilinéaires (d'après J. Jimenez) : ondes douces même de près.
vec4 sampleCubic(sampler2D tex, vec2 uv, vec2 texel) {
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
  vec4 r = vec4(0.0);
  r += texture(tex, vec2(t0.x, t0.y)) * w0.x * w0.y;
  r += texture(tex, vec2(t12.x, t0.y)) * w12.x * w0.y;
  r += texture(tex, vec2(t3.x, t0.y)) * w3.x * w0.y;
  r += texture(tex, vec2(t0.x, t12.y)) * w0.x * w12.y;
  r += texture(tex, vec2(t12.x, t12.y)) * w12.x * w12.y;
  r += texture(tex, vec2(t3.x, t12.y)) * w3.x * w12.y;
  r += texture(tex, vec2(t0.x, t3.y)) * w0.x * w3.y;
  r += texture(tex, vec2(t12.x, t3.y)) * w12.x * w3.y;
  r += texture(tex, vec2(t3.x, t3.y)) * w3.x * w3.y;
  return r;
}

// Valeur (bicubique) et gradient (différences centrées) d'un champ d'ondes.
float signalAt(vec2 uv) {
  vec2 w = sampleCubic(uWave, uv, uWaveTexel).rg;
  return mix(w.x, w.y, uWaveMix);
}
float directSignalAt(vec2 uv) {
  vec2 w = texture(uWave, uv).rg;
  return mix(w.x, w.y, uWaveMix);
}
vec3 waveAt(vec2 uv) {
  return vec3(signalAt(uv),
    directSignalAt(uv + vec2(uWaveTexel.x, 0.0)) - directSignalAt(uv - vec2(uWaveTexel.x, 0.0)),
    directSignalAt(uv - vec2(0.0, uWaveTexel.y)) - directSignalAt(uv + vec2(0.0, uWaveTexel.y)));
}

// Bruit de valeur et fbm, pour le brouillard de la terra incognita.
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
  float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}

// Palette de diagnostic : noir → bleu → cyan → blanc, isolignes tous les 10 dB.
vec3 debugRamp(float db) {
  float t = clamp((db - 80.0) / 60.0, 0.0, 1.0);
  vec3 c = mix(vec3(0.0), vec3(0.05, 0.15, 0.6), smoothstep(0.0, 0.35, t));
  c = mix(c, vec3(0.1, 0.75, 0.9), smoothstep(0.3, 0.7, t));
  c = mix(c, vec3(1.0), smoothstep(0.7, 1.0, t));
  float x = db / 10.0;
  float line = 1.0 - smoothstep(0.0, 1.5 * fwidth(x), abs(fract(x + 0.5) - 0.5));
  return c + line * 0.35;
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
    // R/G: normalized previous/current signal; B: ship/natural energy ratio.
    float ratio = max(texture(uWave, uv).b, 0.0);
    float excess = 10.0 * log(1.0 + ratio) / log(10.0);
    float visibility = smoothstep(${WAVE_VISIBLE_DB.toFixed(1)}, ${WAVE_FULL_DB.toFixed(1)}, excess);
    vec3 wg = waveAt(uv);
    float w = wg.x;
    float wx = wg.y;
    float wy = wg.z;
    vec3 wn = normalize(vec3(-wx * 4.0, -wy * 4.0, 1.0));
    float glint = max(dot(wn, normalize(vec3(-0.45, 0.55, 0.7))) - 0.7, 0.0) * 6.0;
    // Crête positive seule : une ligne de lumière fine par front (le creux reste sombre).
    float crest = pow(max(w, 0.0), 1.3) + 0.15 * max(-w, 0.0);
    float lightW = uWaveBrightness * ((1.0 - uWaveRelief) * crest + uWaveRelief * glint);
    // Compression douce : les zones très actives saturent sans brûler.
    lightW = uHasLevels * visibility * (1.0 - exp(-lightW));
    if (abs(lat) > uPolarCap) lightW = 0.0;

    // --- Lueur d'accumulation : là où le bruit dure, l'océan s'illumine.
    vec3 glow = vec3(0.0);
    if (uHasLevels > 0.5) {
      float A = sampleCubic(uLevels, uv, uLevelsTexel).r;
      float t = pow(smoothstep(uQuietDb, uSatDb, A), uGlowGamma);
      glow = uGlowColor * uGlowStrength * t;
    }

    // --- Terra incognita : zones non observées par l'AIS. Matière propre (brouillard lent, grain,
    // pas de relief), distincte du calme connu (noir net, relief à peine perceptible).
    // Le son des navires connus s'y propage : les ondes y entrent, mais s'y estompent.
    float observed = smoothstep(0.03, 0.4, texture(uCoverage, uv).r);
    vec3 known = ocean + glow + uWaveColor * lightW;
    vec2 fp = vec2(lon * cos(radians(lat)), lat) / uFogScale;
    float fog = fbm(fp + vec2(uTime * uFogDrift * 0.03, uTime * uFogDrift * 0.011));
    fog = smoothstep(0.35, 0.85, fog);
    float grain = (hash(frag * 0.5 + floor(uTime * 12.0)) - 0.5) * uGrain * 0.03;
    vec3 unknown = uOceanDeep * uUnknownDim + uFogColor * fog * uFogStrength + grain
                 + glow * uUnknownDim + uWaveColor * lightW * uWaveKeep;
    vec3 sea = mix(unknown, known, observed);

    // --- Diagnostic : champ physique en dB (touche B).
    if (uDebugField > 0 && uHasLevels > 0.5) {
      vec4 lv = texture(uLevels, uv);
      float db = uDebugField == 1 ? lv.r : uDebugField == 2 ? lv.g : uDebugField == 3 ? lv.b : lv.a;
      sea = debugRamp(db);
    }

    // --- Terres et trait de côte (fraction de terre interpolée : côte anti-crénelée).
    float frac = texture(uElevL, uv).b;
    float land = smoothstep(0.42, 0.58, frac);
    float coast = exp(-pow((frac - 0.5) / 0.16, 2.0)) * uCoastOpacity;
    // Mélange (et non ajout) : un trait sombre reste possible sur des terres claires (mode jour).
    col = mix(mix(sea, uLand, land), uCoast, min(coast, 1.0));
  }

  // --- Finition (absente quand on dessine la texture « monde » : la passe globe s'en charge).
  if (!uFinish) { outColor = vec4(col, 1.0); return; }
  vec2 q = frag / uResolution - 0.5;
  q.x *= uResolution.x / uResolution.y;
  col *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(q) * 1.2);
  col *= uExposure;
  col = pow(max(col, 0.0), vec3(1.0 / uGamma));
  col = uBlackLift + (1.0 - uBlackLift) * col;
  if (uDither) col += (hash(frag + fract(uTime) * 61.0) - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
}`;

// Display preparation runs only when the physical state or selected band changes.
// Half-float output gives cheap native interpolation without altering the solver's textures.
const PACK_WAVE_FRAG = /* glsl */ `
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uCurrent, uPrevious, uEnergy;
uniform vec3 uBand;
uniform float uRatioScale;
void main() {
  float e = max(dot(texture(uEnergy, vUv).rgb, uBand), 0.0);
  float norm = max(sqrt(2.0 * e), 1e-12);
  float previous = dot(texture(uPrevious, vUv).rgb, uBand) / norm;
  float current = dot(texture(uCurrent, vUv).rgb, uBand) / norm;
  outColor = vec4(clamp(previous, -4.0, 4.0), clamp(current, -4.0, 4.0), min(e * uRatioScale, 60000.0), 1.0);
}`;

export class FlatView {
  private packedWave: THREE.WebGLRenderTarget | null = null;
  private packedKey = '';
  private readonly wavePass = new FullscreenPass(rawMaterial(PACK_WAVE_FRAG, {
    uCurrent: { value: null }, uPrevious: { value: null }, uEnergy: { value: null },
    uBand: { value: new THREE.Vector3(1, 0, 0) }, uRatioScale: { value: 1 },
  }));
  private readonly pass: FullscreenPass;
  readonly uniforms: Record<string, THREE.IUniform>;

  constructor(assets: WorldAssets) {
    const v3 = () => new THREE.Vector3();
    this.uniforms = {
      uElevN: { value: assets.elevationNearest },
      uElevL: { value: assets.elevationLinear },
      uWave: { value: null },
      uCoverage: { value: null },
      uWaveMix: { value: 1 },
      uLevels: { value: null },
      uLevelsTexel: { value: new THREE.Vector2(1, 1) },
      uHasLevels: { value: 0 },
      uQuietDb: { value: 95 },
      uSatDb: { value: 125 },
      uGlowGamma: { value: 1 },
      uGlowStrength: { value: 1 },
      uGlowColor: { value: new THREE.Vector3() },
      uFogColor: { value: new THREE.Vector3() },
      uFogStrength: { value: 0 },
      uFogScale: { value: 9 },
      uFogDrift: { value: 0.5 },
      uGrain: { value: 0 },
      uWaveKeep: { value: 0.35 },
      uDebugField: { value: 0 },
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
      uFinish: { value: true },
      uTime: { value: 0 },
    };
    this.pass = new FullscreenPass(rawMaterial(COMPOSITE_FRAG, this.uniforms));
  }

  /** Champ physique (niveaux en dB) à composer ; null si désactivé. */
  setLevels(levels: THREE.Texture | null, width = 1, height = 1): void {
    this.uniforms.uLevels.value = levels;
    this.uniforms.uHasLevels.value = levels ? 1 : 0;
    (this.uniforms.uLevelsTexel.value as THREE.Vector2).set(1 / width, 1 / height);
  }

  /** 0 : rendu ; 1 : niveau accumulé ; 2–4 : bandes basse, moyenne, haute. */
  debugField = 0;

  render(
    renderer: THREE.WebGLRenderer,
    field: PhysicsField,
    interpolation: number,
    coverage: THREE.Texture,
    view: FlatTransform,
    cfg: Config,
    time: number,
    target: THREE.WebGLRenderTarget | null = null,
  ): void {
    const u = this.uniforms;
    if (!u.uLevels.value) u.uLevels.value = field.levels.texture; // texture valide même sans champ physique
    const acc = cfg.accumulation;
    u.uQuietDb.value = acc.quietDb;
    u.uSatDb.value = acc.saturationDb;
    u.uGlowGamma.value = acc.gamma;
    u.uGlowStrength.value = acc.strength;
    hexToVec3(cfg.palette.glow, u.uGlowColor.value);
    hexToVec3(cfg.palette.fog, u.uFogColor.value);
    const inc = cfg.incognita;
    u.uFogStrength.value = inc.fog;
    u.uFogScale.value = inc.scaleDeg;
    u.uFogDrift.value = inc.drift;
    u.uGrain.value = inc.grain;
    u.uWaveKeep.value = inc.waveKeep;
    u.uDebugField.value = this.debugField;
    const bandIndex = { low: 0, mid: 1, high: 2 }[cfg.waves.band];
    const naturalDb = naturalLevel(cfg.bands[bandIndex], cfg.ambient.windSpeedMs);
    if (!this.packedWave || this.packedWave.width !== field.width || this.packedWave.height !== field.height) {
      this.packedWave?.dispose();
      this.packedWave = new THREE.WebGLRenderTarget(field.width, field.height, {
        type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false,
      });
      this.packedKey = '';
    }
    const key = `${field.texture.id}/${field.revision}/${bandIndex}/${naturalDb}/${field.offsetDb}`;
    if (this.packedKey !== key) {
      const w = this.wavePass.material.uniforms;
      w.uCurrent.value = field.texture;
      w.uPrevious.value = field.previousTexture;
      w.uEnergy.value = field.energyTarget.texture;
      (w.uBand.value as THREE.Vector3).set(bandIndex === 0 ? 1 : 0, bandIndex === 1 ? 1 : 0, bandIndex === 2 ? 1 : 0);
      w.uRatioScale.value = 10 ** ((field.offsetDb - naturalDb) / 10);
      this.wavePass.render(renderer, this.packedWave);
      this.packedKey = key;
    }
    u.uWave.value = this.packedWave.texture;
    u.uWaveMix.value = interpolation;
    u.uCoverage.value = coverage;
    u.uUnknownDim.value = cfg.palette.unknownDim;
    (u.uWaveTexel.value as THREE.Vector2).set(1 / field.width, 1 / field.height);
    (u.uResolution.value as THREE.Vector2).set(view.width, view.height);
    (u.uCenter.value as THREE.Vector2).set(view.centerLon, view.centerLat);
    u.uScale.value = view.scale;
    (u.uLatRange.value as THREE.Vector2).set(view.latMin, view.latMax);
    u.uPolarCap.value = PHYS_POLAR_CAP_DEG;
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
    u.uFinish.value = target === null;
    this.pass.render(renderer, target);
  }
}

/**
 * Vue « carte plate » (équirectangulaire) : composition finale à l'écran.
 *
 * Chaque pixel de l'écran est ramené à (lon, lat), puis on compose :
 *   fond océanique (profondeur + relief à peine perceptible) → ondes (lumière froide)
 *   → terres et trait de côte → vignettage, exposition, gamma, plancher de noir, tramage.
 */
import * as THREE from 'three';
import { sceneStyleIndex } from './scene-style.ts';
import { PAPER_GLSL } from './paper.ts';
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
  zoom: number;
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
  if (!nav) return { width, height, zoom: 1, scale: base, centerLon, centerLat: (lo + hi) / 2, latMin: lo, latMax: hi };
  const scale = base * nav.zoom;
  return { width, height, zoom: nav.zoom, scale, centerLon: nav.centerLon, centerLat: clampCenterLat(nav.centerLat, lo, hi, height / 2 / scale), latMin: lo, latMax: hi };
}

/** Transformation de la texture « monde » : équirectangulaire complète, 360° × 180°. */
export function worldTransform(width: number): FlatTransform {
  return { width, zoom: 0, height: width / 2, scale: width / 360, centerLon: 0, centerLat: 0, latMin: -90, latMax: 90 };
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

uniform sampler2D uLandcover;
uniform int uLandStyle, uSceneStyle;
uniform float uSceneRelief;
uniform vec3 uLandTint;
uniform float uLandLight, uLandSat, uLandSteps, uLandRelief;
uniform float uBrushScale, uBrushWarp, uGranulation, uWetEdge, uTrees, uTreeDensity;
uniform sampler2D uElevN;   // altitude 16 bits (lue texel par texel, interpolée après décodage)
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

${PAPER_GLSL}
// Grilles ancrées dans la géographie, fondues selon leur taille en pixels.
vec3 trees(vec3 c, vec2 ll, float cell) {
  float fade = smoothstep(14.0, 28.0, cell * uScale) * uTrees;
  if (fade <= 0.0) return c;
  vec2 id = floor((ll + vec2(180,90)) / cell);
  vec2 jitter = (vec2(hash(id+13.1),hash(id+41.7))-0.5)*0.36;
  vec2 center = (id + 0.5 + jitter) * cell - vec2(180,90);
  vec2 uv = vec2((center.x + 180.0) / 360.0, (90.0 - center.y) / 180.0);
  float forest = texture(uLandcover, uv).a;
  if (hash(id + cell * 31.0) >= forest * uTreeDensity || texture(uElevL, uv).b < 0.6) return c;
  float cs = max(cos(radians(center.y)), 0.02);
  vec2 q = (ll - center) / cell * vec2(cs, 1.0);
  float radius = min(0.16 + 0.05*hash(id+8.2), 0.32 * cs);
  float aa = 1.0 / (uScale * cell);
  float distance = length(q - vec2(0,0.06));
  if (uSceneStyle == 1 || uSceneStyle == 2) {
    distance = min(distance,min(length(q-vec2(-radius*0.45,0.03)),length(q-vec2(radius*0.4,0.0))));
  }
  float canopy = 1.0 - smoothstep(radius-aa, radius+aa, distance);
  if (uSceneStyle == 3) {
    float y = (q.y+0.13)/(radius*2.2);
    canopy = (1.0-smoothstep(radius*(1.0-y)-aa,radius*(1.0-y)+aa,abs(q.x)))
           *smoothstep(-aa,aa,y)*(1.0-smoothstep(1.0-aa,1.0+aa,y));
  }
  float trunk = (1.0-smoothstep(0.018, 0.018+aa, abs(q.x))) *
                (1.0-smoothstep(0.12, 0.12+aa, abs(q.y+0.09)));
  float shadow = (1.0-smoothstep(radius*0.5, radius+aa, length((q-vec2(0.06,-0.12))*vec2(1,1.8)))) * 0.2;
  c *= 1.0-shadow*fade;
  c = mix(c, c * vec3(0.45,0.3,0.18), trunk*fade);
  vec3 green = c * vec3(0.38,0.66,0.32);
  green *= 1.0 + 0.4 * clamp(dot(normalize(vec3(q, radius)), normalize(vec3(-0.6,0.6,1))),0.0,1.0);
  return mix(c, green, canopy*fade);
}
vec3 paintedLand(vec2 uv, vec2 ll, float ax, float ay, float fraction) {
  vec2 p = vec2(ll.x*cos(radians(ll.y)), ll.y) / uBrushScale;
  vec2 warp = (vec2(fbm(p), fbm(p+5.2))-0.5)*uBrushWarp*uBrushScale;
  vec3 c = texture(uLandcover, uv + warp / vec2(360,-180)).rgb;
  if (uSceneStyle == 3) {
    // Triangles géographiques stables, palette minérale : approximation 2,5D de l'atlas.
    vec2 grid = ll / 1.8, id = floor(grid), f = fract(grid);
    float upper = step(f.x, f.y);
    vec2 center = (id + mix(vec2(0.6667,0.3333),vec2(0.3333,0.6667),upper))*1.8;
    c = texture(uLandcover, vec2((center.x+180.0)/360.0,(90.0-center.y)/180.0)).rgb;
    c = floor(c*14.0+0.5)/14.0;
    c *= 0.97+0.06*hash(id+upper*37.0);
  }
  if (uSceneStyle == 2) {
    // Argile : verts tendres, hauts plateaux ocre, sommet pâle ; choix artistiques.
    float a = max(altitude(uv),0.0);
    float forest = texture(uLandcover,uv).a;
    c = mix(c, mix(vec3(0.67,0.62,0.4),vec3(0.48,0.65,0.3),forest),0.38);
    c = mix(c,vec3(0.73,0.53,0.4),smoothstep(1000.0,4000.0,a)*0.6);
    c = mix(c,vec3(0.95,0.91,0.79),smoothstep(3500.0,6000.0,a)*0.8);
  }
  float luma = dot(c, vec3(0.299,0.587,0.114));
  c = max(mix(vec3(luma),c,uLandSat), vec3(0.0));
  float L = max(dot(c,vec3(0.299,0.587,0.114)),0.001);
  if (uLandSteps > 0.0) {
    float x = L*uLandSteps;
    float q = (floor(x)+smoothstep(0.35,0.65,fract(x)))/uLandSteps;
    c *= max(q,0.04)/L;
  }
  float normalScale = uSceneStyle > 0 ? mix(5000.0,900.0,uSceneRelief) : 4000.0;
  float light = dot(normalize(vec3(-ax,-ay,normalScale)),normalize(vec3(-0.6,0.5,0.62)))-0.62;
  c *= vec3(1.0) + uLandRelief * (max(light,0.0)*vec3(0.9,0.65,0.25) + min(light,0.0)*vec3(0.7,0.5,0.2));
  if (uSceneStyle > 0) {
    float edge = 1.0-smoothstep(0.5,0.92,fraction);
    c = mix(c, c*vec3(1.16,1.03,0.76),edge*0.45);
    float a = altitude(uv);
    float occluder = altitude(uv+vec2(-1.4,-1.0)/vec2(360,180));
    float shadow = smoothstep(150.0,2200.0,occluder-a)*uSceneRelief;
    c *= 1.0-shadow*0.35;
  }
  c *= 1.0-uGranulation*(uSceneStyle == 1 ? 0.55 : 0.15)*(fbm(p*6.0)-0.5);
  c *= 1.0-uWetEdge*0.4*(1.0-smoothstep(0.5,0.7,fraction));
  if (uTrees > 0.0) {
    if (uSceneStyle == 1 && !uFinish) c = trees(c,ll,4.0);
    c = trees(c,ll,1.0);
    c = trees(c,ll,0.25);
    c = trees(c,ll,0.0625);
  }
  return c*uLandTint*uLandLight;
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

    // --- Lueur d'accumulation : là où le bruit dure, l'océan s'illumine.
    vec3 glow = vec3(0.0);
    if (uHasLevels > 0.5) {
      float A = sampleCubic(uLevels, uv, uLevelsTexel);
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
    if (uSceneStyle > 0) {
      // Ombre de contact de la côte sur l'eau ; les ondes/lueurs restent au-dessus.
      float shadow = texture(uElevL, uv+vec2(-0.7,-0.5)/vec2(360,180)).b;
      sea = mix(unknown, ocean*(1.0-0.45*shadow*uSceneRelief)+glow+uWaveColor*lightW,observed);
    }

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
    vec3 landCol = uLand;
    if ((uLandStyle == 1 || uSceneStyle > 0) && land > 0.0) landCol = paintedLand(uv, vec2(uv.x*360.0-180.0,lat), ax, ay, frac);
    col = mix(mix(sea, landCol, land), uCoast, min(coast, 1.0));
  }

  // --- Finition (absente quand on dessine la texture « monde » : la passe globe s'en charge).
  if (!uFinish) { outColor = vec4(col, 1.0); return; }
  col = paper(col, frag);
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
      uLandcover: { value: assets.landcover },
      uSceneStyle: { value: 0 }, uSceneRelief: { value: 0.7 },
      uLandStyle: { value: 1 }, uLandTint: { value: v3() }, uLandLight: { value: 1 },
      uLandSat: { value: 1 }, uLandSteps: { value: 5 }, uLandRelief: { value: 1 },
      uBrushScale: { value: 1 }, uBrushWarp: { value: 0 }, uGranulation: { value: 0 },
      uWetEdge: { value: 0 }, uTrees: { value: 0 }, uTreeDensity: { value: 0 },
      uPaperStrength: { value: 0 }, uPaperScale: { value: 1 },
      uElevN: { value: assets.elevationNearest },
      uElevL: { value: assets.elevationLinear },
      uWave: { value: null },
      uCoverage: { value: null },
      uDetail: { value: null },
      uDetailDomain: { value: new THREE.Vector4(0, 90, 360, 180) },
      uDetailTexel: { value: new THREE.Vector2(1, 1) },
      uDetailWeight: { value: 0 },
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
    wave: THREE.Texture,
    waveSize: THREE.Vector2Like,
    coverage: THREE.Texture,
    view: FlatTransform,
    cfg: Config,
    time: number,
    detail?: { sim: WaveSim; weight: number },
    target: THREE.WebGLRenderTarget | null = null,
  ): void {
    const u = this.uniforms;
    if (!u.uLevels.value) u.uLevels.value = wave; // texture valide même sans champ physique
    u.uSceneStyle.value = sceneStyleIndex(cfg);
    u.uSceneRelief.value = cfg.scene.relief;
    const l = cfg.land;
    u.uLandStyle.value = l.style === 'gouache' ? 1 : 0;
    hexToVec3(cfg.palette.landTint, u.uLandTint.value);
    u.uLandLight.value = cfg.palette.landLight;
    u.uLandSat.value = l.saturation; u.uLandSteps.value = l.steps; u.uLandRelief.value = l.relief;
    u.uBrushScale.value = l.brushScale; u.uBrushWarp.value = l.brushWarp;
    u.uGranulation.value = l.granulation; u.uWetEdge.value = l.wetEdge;
    const fade = THREE.MathUtils.smoothstep(view.zoom, l.ornaments.minZoom, l.ornaments.minZoom * 1.5);
    u.uTrees.value = l.ornaments.enabled && (l.style === 'gouache' || sceneStyleIndex(cfg) > 0)
      ? (view.zoom === 0 && cfg.scene.style === 'painted' ? 0.9 : fade) : 0;
    u.uTreeDensity.value = l.ornaments.treeDensity;
    u.uPaperStrength.value = l.paper.enabled ? l.paper.strength : 0;
    u.uPaperScale.value = l.paper.scale;
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
    u.uFinish.value = target === null;
    this.pass.render(renderer, target);
  }
}

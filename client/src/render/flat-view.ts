/**
 * Vue « carte plate » (équirectangulaire) : composition finale à l'écran.
 *
 * Chaque pixel de l'écran est ramené à (lon, lat), puis on compose :
 *   fond océanique (profondeur + relief à peine perceptible) → ondes (lumière froide)
 *   → terres et trait de côte → vignettage, exposition, gamma, plancher de noir, tramage.
 */
import * as THREE from 'three';
import { naturalLevel, PHYS_POLAR_CAP_DEG, WAVE_VISIBLE_DB, WAVE_FULL_DB, type Config } from '@vacarme/shared';
import { PAPER_GLSL } from './paper.ts';
import { NoiseInk } from './noise-ink.ts';
import type { WorldAssets } from '../assets.ts';
import { FullscreenPass, hexToVec3, rawMaterial } from './fullscreen.ts';
import type { PhysicsField } from '../sim/physics-sim.ts';

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
uniform int uLandStyle;          // 0 : aplat ; 1 : gouache ; 2 : monde illustré
uniform sampler2D uBiome;        // R/16 = milieu, G = ton, B = forêt (au plus proche, mélange manuel)
uniform sampler2D uShape;        // R = distance signée à la côte, G = altitude lissée, B = lumière
uniform vec3 uBiomes[9];
uniform vec3 uMountainC, uSnowC, uBeachC, uShelfC, uRippleC;
uniform float uTone, uIllRelief, uTerraceShadow, uTerraceLip, uTerracePx, uSnow, uRock;
uniform float uBeachPx, uBeach, uCoastShadowPx, uCoastShadow, uRim, uShelf, uRippleSpacing, uRipple;
uniform float uDisplayPxPerDeg; // pixels CSS par degré à l'affichage final (carte, globe, demi-sphère…)
uniform vec3 uLandTint;
uniform float uLandLight, uLandSat, uLandSteps, uLandRelief;
uniform float uBrushScale, uBrushWarp, uGranulation, uWetEdge, uTrees, uTreeDensity;
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
// Bruit ajouté (couche de données) : ΔL lissé, représentation choisie (docs/REPRESENTATION.md).
uniform sampler2D uNoiseDb;     // RGB = ΔL (dB) par bande, lissé (préparé par NOISE_PREP_FRAG)
uniform vec3 uBandSel;
uniform sampler2D uInk;         // traînées d'encre (style 3), équirectangulaire
uniform int uNoiseStyle;        // 0 fronts ; 1 isophones ; 2 météo ; 3 encre
uniform vec3 uNoiseLow, uNoiseMid, uNoiseHigh;
uniform vec3 uNoiseSteps;       // paliers (dB)
uniform float uLineStep, uLineSpeed, uNoiseOpacity, uNoiseLines;

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

// ΔL (dB) au-dessus du fond naturel dans la bande affichée, à partir du rapport d'énergies lissé.
float excessDb(vec2 uv) {
  return max(dot(sampleCubic(uNoiseDb, uv, uLevelsTexel).rgb, uBandSel), 0.0);
}

// Nappe en paliers [A] : un léger voile dès +1 dB, puis trois paliers francs, bords anti-crénelés.
// Renvoie la couleur mélangée sur la mer et, dans .a, la couverture (0–1).
vec4 noiseSheet(float dl, float soft) {
  float aa = max(fwidth(dl), 0.05) * (0.75 + soft * 3.0) + soft;
  float veil = smoothstep(1.0, uNoiseSteps.x, dl) * 0.3;
  float s1 = smoothstep(uNoiseSteps.x - aa, uNoiseSteps.x + aa, dl);
  float s2 = smoothstep(uNoiseSteps.y - aa, uNoiseSteps.y + aa, dl);
  float s3 = smoothstep(uNoiseSteps.z - aa, uNoiseSteps.z + aa, dl);
  vec3 c = mix(uNoiseLow, uNoiseMid, s2);
  c = mix(c, uNoiseHigh, s3);
  float a = max(veil, s1 * mix(0.6, 1.0, s2));
  return vec4(c, a * uNoiseOpacity);
}

// Lignes d'égal niveau tous les uLineStep dB [C pour la forme] ; elles défilent vers les niveaux
// faibles, donc vers l'extérieur [A : sens de propagation, pas sa vitesse].
float isophones(float dl, float t) {
  float x = dl / uLineStep + t * uLineSpeed;
  float fw = fwidth(dl) / uLineStep;
  float d = abs(fract(x + 0.5) - 0.5);
  float line = 1.0 - smoothstep(0.6 * fw, 1.6 * fw + 0.01, d);
  // Trop serrées (près des navires) : fondues dans la nappe plutôt qu'un moiré.
  return line * smoothstep(1.0, 2.5, dl) * (1.0 - smoothstep(0.18, 0.4, fw));
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
  float canopy = 1.0 - smoothstep(radius-aa, radius+aa, length(q - vec2(0,0.06)));
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
  float luma = dot(c, vec3(0.299,0.587,0.114));
  c = max(mix(vec3(luma),c,uLandSat), vec3(0.0));
  float L = max(dot(c,vec3(0.299,0.587,0.114)),0.001);
  if (uLandSteps > 0.0) {
    float x = L*uLandSteps;
    float q = (floor(x)+smoothstep(0.35,0.65,fract(x)))/uLandSteps;
    c *= max(q,0.04)/L;
  }
  float light = dot(normalize(vec3(-ax,-ay,4000)),normalize(vec3(-0.6,0.5,0.62)))-0.62;
  c *= vec3(1.0) + uLandRelief * (max(light,0.0)*vec3(0.9,0.65,0.25) + min(light,0.0)*vec3(0.7,0.5,0.2));
  c *= 1.0-uGranulation*0.15*(fbm(p*6.0)-0.5);
  c *= 1.0-uWetEdge*0.4*(1.0-smoothstep(0.5,0.7,fraction));
  if (uTrees > 0.0) {
    c = trees(c,ll,1.0);
    c = trees(c,ll,0.25);
    c = trees(c,ll,0.0625);
  }
  return c*uLandTint*uLandLight;
}
// ---------------------------------------------------------------- monde illustré
// Cartes précalculées (tools/build_illustrated.py) ; ici, seulement des lectures et des mélanges.
// Constantes de forme et de lumière artistiques ; altitude (ETOPO) et côte (Natural Earth) sourcées.

// Distance signée à la côte (degrés, > 0 sur terre), altitude lissée (m), lumière précalculée (1 = plat).
vec3 shapeAt(vec2 uv) {
  vec4 s = texture(uShape, uv);
  return vec3((s.r * 255.0 - 128.0) / 127.0 * 2.0, s.g * s.g * 7000.0, s.b * 2.0);
}

// Décalage (uv) vers le soleil (nord-ouest), d'une longueur donnée en pixels d'affichage.
vec2 towardSun(float px, float lat) {
  float d = px / max(uDisplayPxPerDeg, 0.05) * 0.7071;
  return vec2(-d / (360.0 * max(cos(radians(lat)), 0.05)), -d / 180.0);
}

// Paliers d'altitude (m), comme des couches de papier découpé. Artistiques.
const float TERRACES[7] = float[7](150.0, 400.0, 800.0, 1400.0, 2200.0, 3200.0, 4500.0);
float terraceLevel(float e, float aa) {
  float L = 0.0;
  for (int i = 0; i < 7; i++) L += smoothstep(TERRACES[i] - aa, TERRACES[i] + aa, e);
  return L;
}

// Part de plage selon le milieu : aucune sur la glace, peu sur les côtes rocheuses du nord. Artistique.
const float BEACHY[9] = float[9](0.0, 0.35, 0.45, 0.8, 1.0, 1.0, 1.0, 1.0, 0.85);

vec3 illustratedLand(vec2 uv, vec2 ll, float lat) {
  // Milieux : quatre texels voisins, couleurs de la palette mélangées (frontières peintes au précalcul).
  ivec2 size = textureSize(uBiome, 0);
  vec2 jit = (vec2(vnoise(ll * 9.0), vnoise(ll * 9.0 + 7.7)) - 0.5) * 0.9 / vec2(size);
  vec2 pos = (uv + jit) * vec2(size) - 0.5;
  ivec2 i0 = ivec2(floor(pos));
  vec2 f = pos - floor(pos);
  vec3 c = vec3(0.0);
  float tone = 0.0, forest = 0.0, beachy = 0.0;
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    ivec2 p = i0 + o;
    p.x = (p.x % size.x + size.x) % size.x;
    p.y = clamp(p.y, 0, size.y - 1);
    vec4 t = texelFetch(uBiome, p, 0);
    float w = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y);
    int cls = clamp(int(t.r * 255.0 / 16.0 + 0.5), 0, 8);
    c += w * uBiomes[cls];
    beachy += w * BEACHY[cls];
    tone += w * t.g;
    forest += w * t.b;
  }
  c *= 1.0 + (tone - 0.5) * 0.85 * 2.0 * uTone;

  // Sous-bois tacheté au zoom (artistique) : la forêt se lit comme des houppiers serrés.
  float dapple = smoothstep(18.0, 60.0, uDisplayPxPerDeg) * forest;
  c *= 1.0 - 0.2 * dapple * smoothstep(0.45, 0.75, vnoise(ll * 14.0));

  vec3 sh = shapeAt(uv);
  float e = sh.y;
  // Roche d'altitude et neiges : limite des neiges d'ordre de grandeur (≈ 5 500 m sous les tropiques,
  // au niveau de la mer vers 72°), festonnée.
  float jitter = (vnoise(ll * 2.5) - 0.5) * 700.0;
  float snowline = 5200.0 * max(0.0, 1.0 - pow(abs(lat) / 72.0, 2.0)) + 300.0;
  c = mix(c, uMountainC * (1.0 + (tone - 0.5) * 0.6), uRock * smoothstep(1800.0, 3300.0, e + jitter * 0.5));
  c = mix(c, uSnowC, uSnow * smoothstep(snowline - 150.0, snowline + 250.0, e + jitter));

  // Paliers : ombre portée du palier supérieur, liseré éclairé du bord tourné vers le soleil.
  if (uTerraceShadow + uTerraceLip > 0.0) {
    float aa = fwidth(e) * 0.75 + 4.0;
    float L0 = terraceLevel(e, aa);
    float Ls = terraceLevel(shapeAt(uv + towardSun(uTerracePx, lat)).y, aa);
    float Ll = terraceLevel(shapeAt(uv + towardSun(uTerracePx * 0.45, lat)).y, aa);
    c *= 1.0 + 0.035 * L0;
    c *= mix(vec3(1.0), vec3(0.62, 0.66, 0.8), uTerraceShadow * clamp(Ls - L0, 0.0, 1.0));
    c = mix(c, c * 1.22 + 0.025, uTerraceLip * clamp(L0 - Ll, 0.0, 1.0));
  }

  // Lumière précalculée : versants éclairés chauds, ombres froides.
  float Lb = sh.z;
  vec3 lit = Lb >= 1.0 ? vec3(1.0) + (Lb - 1.0) * vec3(0.85, 0.72, 0.45) : mix(vec3(0.34, 0.4, 0.58), vec3(1.0), Lb);
  c *= mix(vec3(1.0), lit, uIllRelief);

  // Côte : plage, puis liseré éclairé sur les rivages tournés vers le soleil.
  float wB = max(uBeachPx / max(uDisplayPxPerDeg, 0.05), 0.004);
  float beach = (1.0 - smoothstep(wB * 0.65, wB, sh.x)) * uBeach * beachy;
  c = mix(c, uBeachC * (1.0 + (tone - 0.5) * 0.4), beach);
  float sunSea = 1.0 - smoothstep(-0.01, 0.01, shapeAt(uv + towardSun(uBeachPx, lat)).x);
  c = mix(c, c * 1.25 + 0.03, uRim * sunSea * (1.0 - smoothstep(0.0, wB * 0.6, sh.x)));
  return c;
}

// Mer côtière : plateau continental, ombre portée des terres, lignes d'eau fixes.
vec3 illustratedSea(vec3 ocean, vec2 uv, float lat, float depth) {
  float sd = shapeAt(uv).x;
  ocean = mix(ocean, uShelfC, uShelf * 0.85 * (1.0 - smoothstep(30.0, 220.0, depth)));
  float sdl = shapeAt(uv + towardSun(uCoastShadowPx, lat)).x;
  ocean *= 1.0 - uCoastShadow * smoothstep(-0.015, 0.02, sdl) * step(sd, 0.0);
  if (uRipple > 0.0) {
    float x = -sd * uDisplayPxPerDeg / uRippleSpacing;
    float line = 1.0 - smoothstep(0.0, 0.1 + 1.2 * fwidth(x), abs(fract(x + 0.5) - 0.5));
    line *= smoothstep(0.5, 0.8, x) * (1.0 - smoothstep(1.5, 3.4, x));
    ocean = mix(ocean, uRippleC, line * uRipple);
  }
  return ocean;
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
    if (uLandStyle == 2) ocean = illustratedSea(ocean, uv, lat, depth);

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
    if (abs(lat) > uPolarCap || uNoiseStyle != 0) lightW = 0.0;

    // --- Lueur d'accumulation (style « fronts » seulement) : là où le bruit dure, l'océan s'illumine.
    vec3 glow = vec3(0.0);
    if (uHasLevels > 0.5 && uNoiseStyle == 0) {
      float A = sampleCubic(uLevels, uv, uLevelsTexel).r;
      float t = pow(smoothstep(uQuietDb, uSatDb, A), uGlowGamma);
      glow = uGlowColor * uGlowStrength * t;
    }

    // --- Bruit ajouté : nappe en paliers, isophones, ou voile sous l'encre.
    vec3 noisy = ocean;
    if (uHasLevels > 0.5 && uNoiseStyle != 0) {
      float dl = excessDb(uv) * step(abs(lat), uPolarCap);
      vec4 sheet = noiseSheet(dl, uNoiseStyle == 1 ? 0.6 : 0.0);
      if (uNoiseStyle == 3) sheet.a *= 0.45;
      noisy = mix(ocean, sheet.rgb, sheet.a);
      if (uNoiseStyle == 3) noisy = mix(noisy, uNoiseHigh, clamp(texture(uInk, uv).r * 1.4, 0.0, 1.0) * mix(0.5, 1.0, uNoiseLines));
      if (uNoiseStyle == 1) noisy = mix(noisy, uNoiseHigh, isophones(dl, uTime) * uNoiseLines);
      // Météo : un trait fin à chaque palier, pour lire la carte sans couleur.
      if (uNoiseStyle == 2) {
        float fw = max(fwidth(dl), 1e-4);
        vec3 e = abs(vec3(dl) - uNoiseSteps) / fw;
        float edge = 1.0 - smoothstep(0.5, 1.5, min(e.x, min(e.y, e.z)));
        noisy = mix(noisy, uNoiseHigh, edge * 0.6 * uNoiseLines);
      }
    }

    // --- Terra incognita : zones non observées par l'AIS (bruit sous-estimé). Hachures ancrées dans la
    // géographie, comme les blancs des cartes anciennes, distinctes du calme connu ; brouillard lent.
    float observed = smoothstep(0.03, 0.4, texture(uCoverage, uv).r);
    vec3 known = noisy + glow + uWaveColor * lightW;
    vec2 fp = vec2(lon * cos(radians(lat)), lat) / uFogScale;
    float fog = fbm(fp + vec2(uTime * uFogDrift * 0.03, uTime * uFogDrift * 0.011));
    fog = smoothstep(0.35, 0.85, fog);
    float hx = (lon * cos(radians(lat)) + lat) * max(uDisplayPxPerDeg, 0.05) / 7.0;
    float hatch = 1.0 - smoothstep(0.08, 0.08 + 1.5 * fwidth(hx), abs(fract(hx) - 0.5));
    float grain = (hash(frag * 0.5 + floor(uTime * 12.0)) - 0.5) * uGrain * 0.03;
    vec3 unknown = mix(noisy, uOceanDeep, 1.0 - uUnknownDim) + uFogColor * fog * uFogStrength + grain
                 + glow * uUnknownDim + uWaveColor * lightW * uWaveKeep;
    unknown = mix(unknown, uFogColor * 2.2 + 0.04, hatch * 0.5 * uFogStrength);
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
    vec3 landCol = uLand;
    if (uLandStyle == 1 && land > 0.0) landCol = paintedLand(uv, vec2(uv.x*360.0-180.0,lat), ax, ay, frac);
    if (uLandStyle == 2 && land > 0.0) landCol = illustratedLand(uv, vec2(uv.x*360.0-180.0,lat), lat);
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

// Préparation de la nappe (une fois par pas du modèle) : moyenne spatiale gaussienne des rapports
// d'énergie sur ±4 cellules (σ = 2 cellules, ≈ 80 km), en mer seulement, puis conversion en dB.
// Retire le grain d'interférence de la porteuse numérique (6 cellules) sans inventer de détail [E].
const NOISE_PREP_FRAG = /* glsl */ `
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uExcess, uOcean;
uniform vec2 uTexel;
void main() {
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for (int j = -4; j <= 4; j++) for (int i = -4; i <= 4; i++) {
    vec2 uv = vUv + vec2(float(i), float(j)) * uTexel;
    float w = exp(-float(i * i + j * j) / 8.0) * step(0.5, texture(uOcean, uv).r);
    sum += w * max(texture(uExcess, uv).rgb, vec3(0.0));
    wsum += w;
  }
  vec3 ratio = wsum > 0.0 ? sum / wsum : vec3(0.0);
  outColor = vec4(10.0 * log(1.0 + ratio) / log(10.0), 1.0);
}`;

export class FlatView {
  private noiseDb: THREE.WebGLRenderTarget | null = null;
  private ink: NoiseInk | null = null;
  private lastTime: number | null = null;
  private noiseKey = '';
  private readonly noisePass = new FullscreenPass(rawMaterial(NOISE_PREP_FRAG, {
    uExcess: { value: null }, uOcean: { value: null }, uTexel: { value: new THREE.Vector2() },
  }));
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
      uLandcover: { value: assets.landcover },
      uLandStyle: { value: 1 }, uLandTint: { value: v3() }, uLandLight: { value: 1 },
      uLandSat: { value: 1 }, uLandSteps: { value: 5 }, uLandRelief: { value: 1 },
      uBrushScale: { value: 1 }, uBrushWarp: { value: 0 }, uGranulation: { value: 0 },
      uWetEdge: { value: 0 }, uTrees: { value: 0 }, uTreeDensity: { value: 0 },
      uPaperStrength: { value: 0 }, uPaperScale: { value: 1 },
      uBiome: { value: assets.landBiome }, uShape: { value: assets.landShape },
      uBiomes: { value: Array.from({ length: 9 }, v3) },
      uMountainC: { value: v3() }, uSnowC: { value: v3() }, uBeachC: { value: v3() }, uShelfC: { value: v3() }, uRippleC: { value: v3() },
      uTone: { value: 0 }, uIllRelief: { value: 0 }, uTerraceShadow: { value: 0 }, uTerraceLip: { value: 0 }, uTerracePx: { value: 2 },
      uSnow: { value: 0 }, uRock: { value: 0 }, uBeachPx: { value: 2 }, uBeach: { value: 0 },
      uCoastShadowPx: { value: 3 }, uCoastShadow: { value: 0 }, uRim: { value: 0 }, uShelf: { value: 0 },
      uRippleSpacing: { value: 5 }, uRipple: { value: 0 },
      uDisplayPxPerDeg: { value: 5 },
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
      uNoiseDb: { value: null },
      uInk: { value: null },
      uBandSel: { value: new THREE.Vector3(1, 0, 0) },
      uNoiseStyle: { value: 1 },
      uNoiseLow: { value: v3() }, uNoiseMid: { value: v3() }, uNoiseHigh: { value: v3() },
      uNoiseSteps: { value: new THREE.Vector3(3, 10, 20) },
      uLineStep: { value: 3 }, uLineSpeed: { value: 0.35 }, uNoiseOpacity: { value: 0.8 }, uNoiseLines: { value: 0.5 },
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

  /**
   * Pixels CSS par degré à l'affichage final. Carte plate : déduit du cadrage ; modes globe : fixé par
   * l'application avant de composer la texture monde (largeurs de plage, d'ombres et de lignes d'eau
   * constantes à l'écran, quelle que soit la résolution de la texture).
   */
  displayPxPerDeg: number | null = null;

  private setIllustrated(cfg: Config): void {
    const u = this.uniforms;
    const il = cfg.land.illustrated;
    const pal = cfg.display.theme === 'day' ? il.day : il.night;
    const keys = ['ice', 'tundra', 'boreal', 'temperate', 'tropical', 'grass', 'savanna', 'sand', 'rock'] as const;
    keys.forEach((k, i) => hexToVec3(pal[k], (u.uBiomes.value as THREE.Vector3[])[i]));
    hexToVec3(pal.mountain, u.uMountainC.value);
    hexToVec3(pal.snow, u.uSnowC.value);
    hexToVec3(pal.beach, u.uBeachC.value);
    hexToVec3(pal.shelf, u.uShelfC.value);
    hexToVec3(pal.ripple, u.uRippleC.value);
    u.uTone.value = il.tone;
    u.uIllRelief.value = il.relief;
    const t = il.terraces;
    u.uTerraceShadow.value = t.enabled ? t.shadow : 0;
    u.uTerraceLip.value = t.enabled ? t.lip : 0;
    u.uTerracePx.value = t.shadowPx;
    u.uSnow.value = il.snow;
    u.uRock.value = il.rock;
    u.uBeachPx.value = il.coast.beachPx;
    u.uBeach.value = il.coast.beach;
    u.uCoastShadowPx.value = il.coast.shadowPx;
    u.uCoastShadow.value = il.coast.shadow;
    u.uRim.value = il.coast.rim;
    u.uShelf.value = il.shelf;
    u.uRippleSpacing.value = il.ripples.spacingPx;
    u.uRipple.value = il.ripples.enabled ? il.ripples.strength : 0;
  }

  /** Rapport pixels du tampon / pixels CSS (pour exprimer les largeurs en pixels CSS). */
  pixelRatio = 1;

  /** Champ physique (niveaux en dB) à composer ; null si désactivé. */
  setLevels(levels: THREE.Texture | null, width = 1, height = 1): void {
    this.uniforms.uLevels.value = levels;
    this.uniforms.uHasLevels.value = levels ? 1 : 0;
    (this.uniforms.uLevelsTexel.value as THREE.Vector2).set(1 / width, 1 / height);
  }

  /** ΔL lissé par bande (dB, RGB), préparé à la dernière composition ; null avant la première. */
  get noiseTexture(): THREE.Texture | null {
    return this.noiseDb?.texture ?? null;
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
    const l = cfg.land;
    u.uLandStyle.value = l.style === 'illustre' ? 2 : l.style === 'gouache' ? 1 : 0;
    if (l.style === 'illustre') this.setIllustrated(cfg);
    hexToVec3(cfg.palette.landTint, u.uLandTint.value);
    u.uLandLight.value = cfg.palette.landLight;
    u.uLandSat.value = l.saturation; u.uLandSteps.value = l.steps; u.uLandRelief.value = l.relief;
    u.uBrushScale.value = l.brushScale; u.uBrushWarp.value = l.brushWarp;
    u.uGranulation.value = l.granulation; u.uWetEdge.value = l.wetEdge;
    const fade = THREE.MathUtils.smoothstep(view.zoom, l.ornaments.minZoom, l.ornaments.minZoom * 1.5);
    u.uTrees.value = l.ornaments.enabled && l.style === 'gouache' ? fade : 0;
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
    const bandIndex = { low: 0, mid: 1, high: 2 }[cfg.waves.band];
    const n = cfg.noise;
    if (!this.noiseDb || this.noiseDb.width !== field.width || this.noiseDb.height !== field.height) {
      this.noiseDb?.dispose();
      this.noiseDb = new THREE.WebGLRenderTarget(field.width, field.height, {
        type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false,
      });
      this.noiseKey = '';
    }
    // Préparée aussi en style « fronts » : les espaces de communication des cétacés la lisent.
    const noiseKey = `${field.excessTexture.id}/${field.revision}`;
    if (this.noiseKey !== noiseKey) {
      const nu = this.noisePass.material.uniforms;
      nu.uExcess.value = field.excessTexture;
      nu.uOcean.value = field.ocean;
      (nu.uTexel.value as THREE.Vector2).set(1 / field.width, 1 / field.height);
      this.noisePass.render(renderer, this.noiseDb);
      this.noiseKey = noiseKey;
    }
    u.uNoiseDb.value = this.noiseDb.texture;
    if (n.style === 'encre') {
      this.ink ??= new NoiseInk();
      this.ink.update(renderer, this.noiseDb.texture, field.ocean, cfg, time, this.lastTime === null ? 0 : time - this.lastTime);
      u.uInk.value = this.ink.texture;
    } else u.uInk.value = this.noiseDb.texture;
    this.lastTime = time;
    (u.uBandSel.value as THREE.Vector3).set(bandIndex === 0 ? 1 : 0, bandIndex === 1 ? 1 : 0, bandIndex === 2 ? 1 : 0);
    u.uNoiseStyle.value = { fronts: 0, isophones: 1, meteo: 2, encre: 3 }[n.style];
    hexToVec3(cfg.palette.noiseLow, u.uNoiseLow.value);
    hexToVec3(cfg.palette.noiseMid, u.uNoiseMid.value);
    hexToVec3(cfg.palette.noiseHigh, u.uNoiseHigh.value);
    (u.uNoiseSteps.value as THREE.Vector3).set(...n.steps);
    u.uLineStep.value = n.lineStepDb;
    u.uLineSpeed.value = n.lineSpeed;
    u.uNoiseOpacity.value = n.opacity;
    u.uNoiseLines.value = n.lines;
    u.uDisplayPxPerDeg.value = view.zoom > 0 || this.displayPxPerDeg === null ? view.scale / this.pixelRatio : this.displayPxPerDeg;
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

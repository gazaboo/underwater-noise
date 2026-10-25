/**
 * Rendu des cétacés dans la carte plate ou la texture monde (les glyphes sont dans glyphs.ts) :
 *  - espace de communication : pour chaque pixel autour d'un groupe, marge de l'équation du sonar avec
 *    le bruit local lissé (même champ que la nappe) et avec le seul fond naturel. On voit ainsi ce qui
 *    reste audible (zone pleine), la portée sans navires (pointillés) et l'espace perdu (hachures) ;
 *    la forme est rongée par les couloirs de trafic, découpée par les côtes ; contour tremblé là où
 *    l'AIS ne voit rien (bruit sous-estimé). Vue globale : un voile léger ; vue rapprochée : tout.
 *  - appels : un anneau part du groupe, s'étend jusqu'à la portée sans navires et se brise dans
 *    l'espace perdu [A : vitesse et largeur] ;
 *  - liens : fils colorés le long des orthodromies, impulsions dans le sens de l'écoute,
 *    effilochage à la rupture, trace fantôme.
 */
import * as THREE from 'three';
import { bandCenter, type Config } from '@vacarme/shared';
import { LOSS_UNIFORMS_GLSL, lossUniforms, setLossUniforms } from '../sim/physics-sim.ts';
import type { FlatTransform } from '../render/flat-view.ts';
import { hexToVec3 } from '../render/fullscreen.ts';

const MAX_GROUPS = 1024;
export const MAX_LINKS = 2048;
const ARC_POINTS = 33;

/** Projection géographique → écran de la carte plate (commune aux trois couches). */
const FLAT_GLSL = /* glsl */ `
uniform vec2 uCenter;
uniform float uScale;
uniform vec2 uResolution;
uniform float uShift; // copie décalée de ±360° (objets à cheval sur le bord de la carte)
vec4 flatProject(float lat, float lon) {
  float dLon = mod(lon - uCenter.x + 180.0, 360.0) - 180.0;
  vec2 px = vec2(dLon, lat - uCenter.y) * uScale;
  return vec4(px / (0.5 * uResolution), 0.0, 1.0);
}`;

// ------------------------------------------------------------------ espace de communication

const SPACE_VERT = /* glsl */ `
precision highp float;
in vec3 position;          // coin du quad (−1..1)
in vec2 iWhale;            // lat, lon
in vec4 iCall;             // SL, DT, correction de bande (dB), profondeur (m)
in vec4 iMisc;             // bande (0/1/2), absorption (dB/km), exagération visuelle, rayon visuel (km)
in vec3 iColor;
in vec2 iAnim;             // secondes de scène depuis le dernier appel, groupe focal (0–1)
out vec2 vWhale;
flat out vec4 vCall;
flat out vec4 vMisc;
flat out vec2 vAnim;
out vec3 vColor;
${FLAT_GLSL}
void main() {
  float R = iMisc.w / 111.195; // degrés
  float lat = iWhale.x + position.y * R;
  // Repli relatif au groupe : le quad reste d'un seul tenant même à cheval sur le bord de la carte.
  float dl0 = mod(iWhale.y - uCenter.x + 180.0, 360.0) - 180.0 + uShift;
  float dLon = dl0 + position.x * R / max(cos(radians(iWhale.x)), 0.05);
  gl_Position = vec4(vec2(dLon, lat - uCenter.y) * uScale / (0.5 * uResolution), 0.0, 1.0);
  vWhale = iWhale;
  vCall = iCall;
  vMisc = iMisc;
  vAnim = iAnim;
  vColor = iColor;
}`;

const SPACE_FRAG = /* glsl */ `
precision highp float;
in vec2 vWhale;
flat in vec4 vCall;
flat in vec4 vMisc;
flat in vec2 vAnim;
in vec3 vColor;
out vec4 outColor;
uniform vec2 uCenter;
uniform float uScale;
uniform vec2 uResolution;
uniform sampler2D uNoiseDb;  // ΔL lissé par bande (dB, RGB) : même champ que la nappe
uniform vec3 uNatural;       // fond naturel par bande (dB)
uniform sampler2D uElevL;
uniform sampler2D uOcean;   // grille océan (G profondeur log, B fraction de terre), mipmappée
uniform float uOceanPerDeg; // texels de uOcean par degré
uniform sampler2D uCoverage;
uniform float uFill, uFarFill, uContour, uLost, uTime;
uniform float uClose;       // 0 : vue globale ; 1 : vue rapprochée
uniform float uFbPerCss;    // pixels du tampon par pixel CSS de l'affichage final
uniform float uRingSec, uRings;
uniform vec3 uLostTint;
uniform vec3 uBandFreq;
${LOSS_UNIFORMS_GLSL}


float hav(vec2 a, vec2 b) { // distance (km), a et b en (lat, lon) degrés
  vec2 ra = radians(a), rb = radians(b);
  float s = pow(sin((rb.x - ra.x) * 0.5), 2.0) + cos(ra.x) * cos(rb.x) * pow(sin((rb.y - ra.y) * 0.5), 2.0);
  return 2.0 * 6371.0 * asin(min(1.0, sqrt(s)));
}
vec2 uvOf(vec2 ll) { return vec2(fract((ll.y + 180.0) / 360.0), (90.0 - ll.x) / 180.0); }
// Catmull-Rom en 9 lectures bilinéaires (comme la composition de la carte) : en bilinéaire, les isolignes
// du bruit suivent les cellules de la grille physique et le contour dessine des marches.
vec4 sampleCubic(sampler2D tex, vec2 uv) {
  vec2 size = vec2(textureSize(tex, 0));
  vec2 texel = 1.0 / size;
  vec2 c = floor(uv * size - 0.5) + 0.5;
  vec2 f = uv * size - c;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (c - 1.0) * texel, t3 = (c + 2.0) * texel, t12 = (c + w2 / w12) * texel;
  return (texture(tex, vec2(t0.x, t0.y)) * w0.x + texture(tex, vec2(t12.x, t0.y)) * w12.x + texture(tex, vec2(t3.x, t0.y)) * w3.x) * w0.y
       + (texture(tex, vec2(t0.x, t12.y)) * w0.x + texture(tex, vec2(t12.x, t12.y)) * w12.x + texture(tex, vec2(t3.x, t12.y)) * w3.x) * w12.y
       + (texture(tex, vec2(t0.x, t3.y)) * w0.x + texture(tex, vec2(t12.x, t3.y)) * w12.x + texture(tex, vec2(t3.x, t3.y)) * w3.x) * w3.y;
}
float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 d = (gl_FragCoord.xy - 0.5 * uResolution) / uScale;
  vec2 ll = vec2(uCenter.y + d.y, uCenter.x + d.x);
  float dVis = hav(vWhale, ll);
  vec2 uv = uvOf(ll);
  // Pas d'élimination (discard) avant les dérivées : fwidth() serait faux au bord des zones éliminées.
  // On calcule tout, puis on masque.
  float mask = step(dVis, vMisc.w) * step(texture(uElevL, uv).b, 0.5); // dans le quad, en mer
  vec2 dl = ll - vWhale;
  dl.y = mod(dl.y + 180.0, 360.0) - 180.0;
  // Le long du segment : pertes au fond et coupure modale à chaque point (même modèle que le champ et
  // que les liens, même grille océan). La grille est lue au niveau de mipmap qui correspond à l'écart
  // entre échantillons : l'intégrande est lissé à cette échelle, sinon un seul échantillon tombant sur
  // un haut-fond fait varier l'excès de signal de dizaines de dB d'un pixel à l'autre (faux contours).
  float band = vMisc.x;
  float fBand = band < 0.5 ? uBandFreq.x : band < 1.5 ? uBandFreq.y : uBandFreq.z;
  const int N = 24;
  float lod = log2(max(length(dl) / float(N) * uOceanPerDeg, 1.0));
  float rate = 0.0;
  float shadow = 1.0; // ombre des terres : l'appel ne traverse pas les continents
  for (int i = 0; i <= N; i++) {
    vec2 p = vWhale + dl * (float(i) / float(N));
    vec4 o = textureLod(uOcean, uvOf(p), lod);
    if (i > 0 && i < N) shadow *= 1.0 - smoothstep(0.35, 0.65, o.b);
    float h = max(10.0, 10.0 * pow(1100.0, o.g));
    rate += bottomLossRate(h) + cutoffLossRate(h, vec3(fBand)).x;
  }
  rate /= float(N + 1);
  // Équation du sonar au point : SE = SL − TL(d) − NL_appel(x) − DT, avec le bruit actuel (navires + fond)
  // et avec le seul fond naturel (océan sans navires).
  float r = max(dVis * 1000.0 / vMisc.z, 1.0); // distance vraie (m)
  float rt = max(vCall.w, 10.0);
  float tl = (r <= rt ? 20.0 * log(r) : 20.0 * log(rt) + 10.0 * log(r / rt)) / log(10.0) + (vMisc.y + rate) * r / 1000.0;
  vec3 ex = sampleCubic(uNoiseDb, uv).rgb;
  float excess = max(band < 0.5 ? ex.r : band < 1.5 ? ex.g : ex.b, 0.0);
  float nlQuiet = (band < 0.5 ? uNatural.x : band < 1.5 ? uNatural.y : uNatural.z) - vCall.z;
  float seQuiet = vCall.x - tl - nlQuiet - vCall.y;
  float se = seQuiet - excess;
  float w = fwidth(se) * 1.2 + 1e-4;
  float wq = fwidth(seQuiet) * 1.2 + 1e-4;
  float now = smoothstep(-0.5 * w, 0.5 * w, se) * shadow;          // audible malgré les navires
  float quiet = smoothstep(-0.5 * wq, 0.5 * wq, seQuiet) * shadow;  // audible sans navires
  float lost = quiet * (1.0 - now);
  float edge = (1.0 - smoothstep(0.0, 1.5 * w, abs(se))) * shadow;
  float ghost = (1.0 - smoothstep(0.0, 1.5 * wq, abs(seQuiet))) * shadow;
  float rq = vMisc.w / 1.05; // portée sans navires à l'écran (km)
  // Motifs en pixels de l'affichage final : pointillés le long du cercle, hachures obliques.
  float ang = atan(dl.x, dl.y);
  float arcPx = ang * dVis / 111.195 * uScale / uFbPerCss;
  float dash = step(0.5, fract(arcPx / 10.0));
  // Espace perdu : semis de points (distinct des hachures de la terra incognita), plus dense près du groupe.
  vec2 cell = gl_FragCoord.xy / (6.0 * uFbPerCss);
  vec2 cell2 = vec2(cell.x + 0.5 * mod(floor(cell.y), 2.0), cell.y);
  float stipple = 1.0 - smoothstep(0.16, 0.26, length(fract(cell2) - 0.5));
  // Terra incognita : le bruit y est sous-estimé ; contour actuel pointillé et tremblant.
  float cov = smoothstep(0.03, 0.4, texture(uCoverage, uv).r);
  edge *= mix(step(0.45, fract(arcPx / 6.0 + uTime * 0.3)) * (0.7 + 0.3 * sin(uTime * 7.0 + ang * 31.0)), 1.0, cov);
  // Anneau d'appel : vif dans la zone audible, en éclats dans l'espace perdu, absent au-delà.
  float rp = vAnim.x / uRingSec;
  float ring = rp < 1.0 ? exp(-pow((dVis / rq - rp) / 0.02, 2.0)) * (1.0 - rp * rp) : 0.0;
  float shards = step(0.55, hash2(floor(gl_FragCoord.xy / (3.0 * uFbPerCss)) + floor(rp * 12.0)));
  ring *= uRings * (now + 0.45 * lost * shards) * mix(1.0, mix(0.35, 1.0, vAnim.y), uClose);

  if (mask < 0.5) discard;
  float fade = smoothstep(1.0, 0.92, dVis / vMisc.w);
  float fill = mix(uFarFill, uFill, uClose) * now * (1.0 - 0.45 * clamp(dVis / rq, 0.0, 1.0));
  // Vue rapprochée : la bulle complète pour le groupe focal (le plus proche du centre), discrète ailleurs.
  float focus = mix(1.0, mix(0.12, 1.0, vAnim.y), uClose);
  float aLost = mix(0.35, 1.0, uClose) * uLost * lost * stipple * (1.0 - 0.6 * clamp(dVis / rq, 0.0, 1.0)) * focus;
  float aLine = uClose * (uContour * edge + 0.75 * ghost * dash * focus);
  float a = clamp(fill + aLost + aLine + ring, 0.0, 1.0) * fade;
  vec3 c = mix(vColor, uLostTint, aLost / max(a, 1e-4) * 0.55);
  outColor = vec4(c * a, a); // prémultiplié
}`;

// ------------------------------------------------------------------ liens

const LINK_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec2 aLatLon;     // point de l'arc (longitude dépliée)
in vec2 aOther;      // autre extrémité du segment (direction)
in float aSide;      // −1 / +1 : bord du ruban
in float aSgn;       // +1 au début du segment, −1 à la fin
in float aLon0;      // longitude du premier point (pour le repli d'antiméridien)
in float aT;         // 0 en A, 1 en B
in float aLink;      // indice du lien
in vec3 aColor;
uniform sampler2D uState; // par lien : force A←B, force B←A, effilochage, fantôme
uniform sampler2D uMeta;  // par lien : marge max (dB), graine, temps depuis le dernier appel de A (s), idem pour B
uniform float uWidth;     // épaisseur (pixels du tampon)
out float vT;
out float vSide;
out vec3 vColor;
flat out vec4 vState;
flat out vec4 vMeta;
${FLAT_GLSL}
void main() {
  float dl0 = mod(aLon0 - uCenter.x + 180.0, 360.0) - 180.0 + uShift;
  vec2 px = vec2(dl0 + (aLatLon.y - aLon0), aLatLon.x - uCenter.y) * uScale;
  vec2 po = vec2(dl0 + (aOther.y - aLon0), aOther.x - uCenter.y) * uScale;
  vec2 dir = po - px;
  dir = length(dir) > 1e-6 ? normalize(dir) * aSgn : vec2(1.0, 0.0);
  px += vec2(-dir.y, dir.x) * aSide * (0.5 * uWidth + 1.0);
  gl_Position = vec4(px / (0.5 * uResolution), 0.0, 1.0);
  vT = aT;
  vSide = aSide;
  vColor = aColor;
  ivec2 c = ivec2(int(aLink) % ${MAX_LINKS}, 0);
  vState = texelFetch(uState, c, 0);
  vMeta = texelFetch(uMeta, c, 0);
}`;

const LINK_FRAG = /* glsl */ `
precision highp float;
in float vT;
in float vSide;
in vec3 vColor;
flat in vec4 vState;
flat in vec4 vMeta;
out vec4 outColor;
uniform float uIntensity, uGhost, uTime, uPulseSpeed, uHyst, uWidth;
float hash(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
void main() {
  float sAB = vState.x; // A entend B : le signal va de B vers A
  float sBA = vState.y; // B entend A : de A vers B
  float fray = vState.z;
  float ghost = vState.w;
  float strength = max(sAB, sBA);
  float margin = vMeta.x;
  float seed = vMeta.y;
  float sinceA = vMeta.z; // secondes depuis le dernier appel de A
  float sinceB = vMeta.w;
  // Fil : plus tendu (net) quand la marge est grande ; tremble près du seuil.
  float tension = smoothstep(0.0, 20.0, margin);
  float tremble = exp(-pow(margin / max(uHyst * 2.0, 0.5), 2.0)) * (0.5 + 0.5 * sin(uTime * 23.0 + seed * 50.0 + vT * 40.0));
  float base = strength * (0.45 + 0.4 * tension) * (1.0 - 0.6 * tremble);
  // Effilochage : des segments disparaissent, de plus en plus nombreux.
  float seg = hash(floor(vT * 60.0) + seed * 1000.0);
  base *= step(fray * 0.95, seg);
  // Impulsions : chaque appel réel part du groupe et parcourt le fil, dans le sens de l'écoute ;
  // il n'arrive que si l'autre entend (sinon il s'éteint en chemin : l'appel sans réponse se voit).
  float travel = 1.0 / uPulseSpeed;
  float phA = sinceA / travel; // 0..1 pendant le trajet
  float phB = sinceB / travel;
  float pBA = step(phA, 1.0) * exp(-pow((vT - phA) / 0.025, 2.0)) * mix(0.25 * (1.0 - phA), 1.0, sBA);       // de A vers B
  float pAB = step(phB, 1.0) * exp(-pow((vT - (1.0 - phB)) / 0.025, 2.0)) * mix(0.25 * (1.0 - phB), 1.0, sAB); // de B vers A
  float light = uIntensity * (base + 1.6 * (pAB + pBA)) + uGhost * ghost * (1.0 - strength);
  // Extrémités adoucies ; bords du ruban anti-crénelés (impulsions un peu plus épaisses).
  light *= smoothstep(0.0, 0.03, vT) * smoothstep(1.0, 0.97, vT);
  float half_ = 0.5 * uWidth * (1.0 + 0.8 * min(pAB + pBA, 1.0));
  float dist = abs(vSide) * (0.5 * uWidth + 1.0);
  float a = clamp(min(light, 1.0) * clamp(half_ + 0.5 - dist, 0.0, 1.0), 0.0, 1.0);
  vec3 c = vColor * (1.0 + 0.6 * max(light - 1.0, 0.0));
  outColor = vec4(c * a, a); // prémultiplié
}`;

function flatUniforms() {
  return {
    uShift: { value: 0 },
    uCenter: { value: new THREE.Vector2() },
    uScale: { value: 1 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  };
}

function setFlat(u: Record<string, THREE.IUniform>, view: FlatTransform): void {
  (u.uCenter.value as THREE.Vector2).set(view.centerLon, view.centerLat);
  u.uScale.value = view.scale;
  (u.uResolution.value as THREE.Vector2).set(view.width, view.height);
}

export interface GroupDraw {
  lat: number;
  lon: number;
  sl: number;
  dt: number;
  noiseCorrection: number;
  depth: number;
  band: number;
  alpha: number;
  visualScale: number;
  /** Rayon visuel maximal du quad (km). */
  radiusKm: number;
  color: THREE.Vector3;
  /** Secondes de scène depuis le dernier appel. */
  sinceCall: number;
  /** 1 : groupe focal de la vue rapprochée. */
  focus: number;
}

export interface LinkDraw {
  /** Points de l'arc (lat, lon dépliée), de A vers B. */
  arc: [number, number][];
  color: THREE.Vector3;
  sAB: number;
  sBA: number;
  fray: number;
  ghost: number;
  margin: number;
  seed: number;
  /** Secondes depuis le dernier appel de A, de B. */
  sinceA: number;
  sinceB: number;
}

/** Réglages de dessin calculés par l'appelant (dépendent de l'affichage final). */
export interface WhaleDrawOptions {
  /** ΔL lissé par bande (dB, RGB) et fond naturel par bande (dB). */
  noise: THREE.Texture;
  natural: [number, number, number];
  /** 0 : vue globale ; 1 : vue rapprochée. */
  close: number;
  /** Pixels du tampon par pixel CSS de l'affichage final. */
  fbPerCss: number;
  /** 0–1 : anneaux d'appel visibles (masqués quand le temps est très accéléré). */
  rings: number;
  lostTint: THREE.Vector3;
  /** Centre de la vue (lat, lon) : le groupe le plus proche devient le groupe focal. */
  center: [number, number];
}

const premultiplied = {
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  depthTest: false,
  depthWrite: false,
  transparent: true,
} as const;

export class WhaleRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  // espace de communication
  private readonly spaceGeo = new THREE.InstancedBufferGeometry();
  private readonly iWhale = new Float32Array(MAX_GROUPS * 2);
  private readonly iCall = new Float32Array(MAX_GROUPS * 4);
  private readonly iMisc = new Float32Array(MAX_GROUPS * 4);
  private readonly iColor = new Float32Array(MAX_GROUPS * 3);
  private readonly iAnim = new Float32Array(MAX_GROUPS * 2);
  private readonly spaceMat: THREE.RawShaderMaterial;
  // liens
  private linkGeo = new THREE.BufferGeometry();
  private readonly linkMat: THREE.RawShaderMaterial;
  private readonly linkMesh: THREE.Mesh;
  private readonly stateTex: THREE.DataTexture;
  private readonly metaTex: THREE.DataTexture;
  private readonly stateData = new Float32Array(MAX_LINKS * 4);
  private readonly metaData = new Float32Array(MAX_LINKS * 4);
  private linkCount = 0;

  constructor(elevLinear: THREE.Texture, ocean: THREE.Texture) {
    // Espace de communication : quads instanciés.
    const quad = new THREE.PlaneGeometry(2, 2);
    this.spaceGeo.index = quad.index;
    this.spaceGeo.setAttribute('position', quad.getAttribute('position'));
    this.spaceGeo.setAttribute('iWhale', new THREE.InstancedBufferAttribute(this.iWhale, 2).setUsage(THREE.DynamicDrawUsage));
    this.spaceGeo.setAttribute('iCall', new THREE.InstancedBufferAttribute(this.iCall, 4).setUsage(THREE.DynamicDrawUsage));
    this.spaceGeo.setAttribute('iMisc', new THREE.InstancedBufferAttribute(this.iMisc, 4).setUsage(THREE.DynamicDrawUsage));
    this.spaceGeo.setAttribute('iColor', new THREE.InstancedBufferAttribute(this.iColor, 3).setUsage(THREE.DynamicDrawUsage));
    this.spaceGeo.setAttribute('iAnim', new THREE.InstancedBufferAttribute(this.iAnim, 2).setUsage(THREE.DynamicDrawUsage));
    this.spaceGeo.instanceCount = 0;
    this.spaceMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SPACE_VERT,
      fragmentShader: SPACE_FRAG,
      uniforms: {
        ...flatUniforms(),
        uNoiseDb: { value: null },
        uNatural: { value: new THREE.Vector3(84, 88, 93) },
        uElevL: { value: elevLinear },
        uOcean: { value: ocean },
        uOceanPerDeg: { value: (ocean.image as { width: number }).width / 360 },
        uBandFreq: { value: new THREE.Vector3(20, 224, 3162) },
        ...lossUniforms(),
        uCoverage: { value: null },
        uFill: { value: 0.16 },
        uFarFill: { value: 0.06 },
        uContour: { value: 0.75 },
        uLost: { value: 0.4 },
        uClose: { value: 0 },
        uFbPerCss: { value: 1 },
        uRingSec: { value: 3 },
        uRings: { value: 1 },
        uLostTint: { value: new THREE.Vector3(0.9, 0.5, 0.2) },
        uTime: { value: 0 },
      },
      ...premultiplied,
    });
    const space = new THREE.Mesh(this.spaceGeo, this.spaceMat);
    space.frustumCulled = false;

    // Liens : rubans, état par lien dans deux petites textures.
    const tex = (data: Float32Array<ArrayBuffer>) => {
      const t = new THREE.DataTexture(data, MAX_LINKS, 1, THREE.RGBAFormat, THREE.FloatType);
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.needsUpdate = true;
      return t;
    };
    this.stateTex = tex(this.stateData);
    this.metaTex = tex(this.metaData);
    this.linkMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: LINK_VERT,
      fragmentShader: LINK_FRAG,
      uniforms: {
        ...flatUniforms(),
        uState: { value: this.stateTex },
        uMeta: { value: this.metaTex },
        uIntensity: { value: 1 },
        uGhost: { value: 0.12 },
        uTime: { value: 0 },
        uPulseSpeed: { value: 0.3 },
        uHyst: { value: 2 },
        uWidth: { value: 2 },
      },
      ...premultiplied,
    });
    this.linkMesh = new THREE.Mesh(this.linkGeo, this.linkMat);
    this.linkMesh.frustumCulled = false;

    this.scene.add(space, this.linkMesh);
  }

  setGroups(groups: GroupDraw[]): void {
    const n = Math.min(groups.length, MAX_GROUPS);
    for (let i = 0; i < n; i++) {
      const g = groups[i];
      this.iWhale.set([g.lat, g.lon], 2 * i);
      this.iCall.set([g.sl, g.dt, g.noiseCorrection, g.depth], 4 * i);
      this.iMisc.set([g.band, g.alpha, g.visualScale, g.radiusKm], 4 * i);
      this.iColor.set([g.color.x, g.color.y, g.color.z], 3 * i);
      this.iAnim.set([g.sinceCall, g.focus], 2 * i);
    }
    for (const name of ['iWhale', 'iCall', 'iMisc', 'iColor', 'iAnim']) (this.spaceGeo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    this.spaceGeo.instanceCount = n;
  }

  /** Reconstruit la géométrie des arcs (quand les groupes ont bougé ou que les liens changent). */
  setLinkGeometry(links: LinkDraw[]): void {
    const n = Math.min(links.length, MAX_LINKS);
    const quads = n * (ARC_POINTS - 1);
    const verts = quads * 4;
    const pos = new Float32Array(verts * 3);
    const ll = new Float32Array(verts * 2);
    const other = new Float32Array(verts * 2);
    const side = new Float32Array(verts);
    const sgn = new Float32Array(verts);
    const lon0 = new Float32Array(verts);
    const t = new Float32Array(verts);
    const idx = new Float32Array(verts);
    const color = new Float32Array(verts * 3);
    const index: number[] = [];
    let v = 0;
    for (let k = 0; k < n; k++) {
      const { arc, color: c } = links[k];
      for (let i = 0; i < arc.length - 1; i++) {
        const base = v;
        for (const [j, o, sg] of [[i, i + 1, 1], [i + 1, i, -1]] as const) {
          for (const sd of [-1, 1]) {
            ll.set(arc[j], 2 * v);
            other.set(arc[o], 2 * v);
            side[v] = sd;
            sgn[v] = sg;
            lon0[v] = arc[0][1];
            t[v] = j / (arc.length - 1);
            idx[v] = k;
            color.set([c.x, c.y, c.z], 3 * v);
            v++;
          }
        }
        index.push(base, base + 1, base + 3, base, base + 3, base + 2);
      }
    }
    this.linkGeo.dispose();
    this.linkGeo = new THREE.BufferGeometry();
    this.linkGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.linkGeo.setAttribute('aLatLon', new THREE.BufferAttribute(ll, 2));
    this.linkGeo.setAttribute('aOther', new THREE.BufferAttribute(other, 2));
    this.linkGeo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    this.linkGeo.setAttribute('aSgn', new THREE.BufferAttribute(sgn, 1));
    this.linkGeo.setAttribute('aLon0', new THREE.BufferAttribute(lon0, 1));
    this.linkGeo.setAttribute('aT', new THREE.BufferAttribute(t, 1));
    this.linkGeo.setAttribute('aLink', new THREE.BufferAttribute(idx, 1));
    this.linkGeo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    this.linkGeo.setIndex(index);
    this.linkMesh.geometry = this.linkGeo;
    this.linkCount = n;
  }

  /** Met à jour l'état des liens (chaque image). */
  setLinkStates(links: LinkDraw[]): void {
    const s = this.stateData;
    const m = this.metaData;
    for (let k = 0; k < Math.min(links.length, this.linkCount); k++) {
      const l = links[k];
      s.set([l.sAB, l.sBA, l.fray, l.ghost], 4 * k);
      m.set([Number.isFinite(l.margin) ? l.margin : -99, l.seed, l.sinceA, l.sinceB], 4 * k);
    }
    this.stateTex.needsUpdate = true;
    this.metaTex.needsUpdate = true;
  }

  draw(renderer: THREE.WebGLRenderer, view: FlatTransform, cfg: Config, opts: WhaleDrawOptions, coverage: THREE.Texture, timeSec: number, target: THREE.WebGLRenderTarget | null = null): void {
    const w = cfg.whales;
    for (const mat of [this.spaceMat, this.linkMat]) setFlat(mat.uniforms, view);
    const su = this.spaceMat.uniforms;
    setLossUniforms(su, cfg);
    const [lo, mi, hi] = cfg.bands.map(bandCenter);
    (su.uBandFreq.value as THREE.Vector3).set(lo, mi, hi);
    su.uNoiseDb.value = opts.noise;
    (su.uNatural.value as THREE.Vector3).set(...opts.natural);
    su.uCoverage.value = coverage;
    su.uFill.value = w.space.fill;
    su.uFarFill.value = w.space.farFill;
    su.uContour.value = w.space.contour;
    su.uLost.value = w.space.lost;
    su.uClose.value = opts.close;
    su.uFbPerCss.value = opts.fbPerCss;
    su.uRingSec.value = w.calls.ringSec;
    su.uRings.value = opts.rings;
    (su.uLostTint.value as THREE.Vector3).copy(opts.lostTint);
    su.uTime.value = timeSec;
    const lu = this.linkMat.uniforms;
    lu.uIntensity.value = w.links.enabled ? w.links.intensity : 0;
    lu.uGhost.value = w.links.enabled ? w.links.ghost : 0;
    lu.uTime.value = timeSec;
    lu.uPulseSpeed.value = w.links.pulseSpeed;
    lu.uHyst.value = w.links.hysteresisDb;
    lu.uWidth.value = w.links.widthPx * opts.fbPerCss;
    renderer.setRenderTarget(target);
    // Trois passes décalées de −360°, 0, +360° : les espaces et les fils à cheval sur l'antiméridien
    // de la carte apparaissent des deux côtés.
    for (const shift of [-360, 0, 360]) {
      for (const mat of [this.spaceMat, this.linkMat]) mat.uniforms.uShift.value = shift;
      renderer.render(this.scene, this.camera);
    }
  }
}

/** Points d'un arc d'orthodromie de A vers B, longitudes dépliées (continues). */
export function greatCircleArc(lat1: number, lon1: number, lat2: number, lon2: number, n = ARC_POINTS): [number, number][] {
  const r = Math.PI / 180;
  const v = (lat: number, lon: number) => [Math.cos(lat * r) * Math.cos(lon * r), Math.cos(lat * r) * Math.sin(lon * r), Math.sin(lat * r)];
  const a = v(lat1, lon1);
  const b = v(lat2, lon2);
  const w = Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  const out: [number, number][] = [];
  let prevLon = lon1;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let p: number[];
    if (w < 1e-9) p = a;
    else {
      const s1 = Math.sin((1 - t) * w) / Math.sin(w);
      const s2 = Math.sin(t * w) / Math.sin(w);
      p = [s1 * a[0] + s2 * b[0], s1 * a[1] + s2 * b[1], s1 * a[2] + s2 * b[2]];
    }
    const lat = Math.asin(Math.max(-1, Math.min(1, p[2]))) / r;
    let lon = Math.atan2(p[1], p[0]) / r;
    lon += 360 * Math.round((prevLon - lon) / 360);
    prevLon = lon;
    out.push([lat, lon]);
  }
  return out;
}

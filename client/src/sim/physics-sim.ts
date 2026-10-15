/**
 * Champ de bruit physique : grille calibrée en dB re 1 µPa, trois bandes (canaux R, G, B).
 *
 * Même équation des ondes que la grille visuelle, mais :
 *  - chaque navire injecte un signal à bande étroite et à phase aléatoire (sources incohérentes :
 *    les interférences entre navires s'annulent en moyenne) ;
 *  - l'amplitude injectée vaut a² = 10^((SL − 10·log10(r_t) − L_ref) / 10), avec SL le niveau source
 *    du navire dans la bande (JOMOPANS-ECHO) et r_t ≈ profondeur d'eau sous le navire (transition
 *    sphérique → cylindrique) ;
 *  - en 2D, l'énergie d'une source continue décroît en 1/r : c'est l'étalement cylindrique ;
 *  - l'amortissement de chaque canal reproduit l'absorption de Thorp de sa bande, plus une perte
 *    sur le plateau et une perte par le fond sous la fréquence de coupure modale ;
 *  - une moyenne glissante de u² donne l'intensité ; la constante de calibration K (énergie de la
 *    grille ↔ intensité acoustique) est mesurée au démarrage sur une source seule.
 *
 * Niveau reçu : L = 10·log10(E) + L_ref − 10·log10(K · taille de cellule en m).
 * Détails et hypothèses : docs/MODELE_PHYSIQUE.md.
 */
import * as THREE from 'three';
import { thorpAbsorptionDbPerKm, bandCenter, naturalLevel, BOTTOM_LOSS_FULL_DEPTH, BOTTOM_LOSS_ZERO_DEPTH, type Config } from '@vacarme/shared';

/**
 * Pertes au fond et coupure modale en GLSL : transcription exacte de lossRateDbPerKm()
 * (shared/src/acoustics/propagation.ts), hors absorption de Thorp et perte supplémentaire.
 */
export const LOSS_UNIFORMS_GLSL = /* glsl */ `
uniform float uBounceLoss;  // dB par rebond
uniform float uTanGraze;    // tan(angle de rasance)
uniform float uSedimentC;   // célérité du sédiment (m/s)
uniform float uCutoffLoss;  // dB/km sous la coupure
float bottomLossRate(float depth) {
  float h = max(depth, 5.0);
  float w = clamp((${BOTTOM_LOSS_ZERO_DEPTH.toFixed(1)} - h) / (${BOTTOM_LOSS_ZERO_DEPTH.toFixed(1)} - ${BOTTOM_LOSS_FULL_DEPTH.toFixed(1)}), 0.0, 1.0);
  return uBounceLoss * 1000.0 * uTanGraze / (2.0 * h) * w;
}
vec3 cutoffLossRate(float depth, vec3 f) {
  float h = max(depth, 5.0);
  float r = 1500.0 / uSedimentC;
  float fc = 1500.0 / (4.0 * h * sqrt(max(1e-6, 1.0 - r * r)));
  return uCutoffLoss * clamp((fc / f - 0.8) / 0.4, 0.0, 1.0);
}`;

export function lossUniforms(): Record<string, THREE.IUniform> {
  return { uBounceLoss: { value: 0.5 }, uTanGraze: { value: Math.tan(Math.PI / 18) }, uSedimentC: { value: 1700 }, uCutoffLoss: { value: 5 } };
}

export function setLossUniforms(u: Record<string, THREE.IUniform>, cfg: Config): void {
  const p = cfg.physics;
  u.uBounceLoss.value = p.bottomBounceLossDb;
  u.uTanGraze.value = Math.tan((p.grazingAngleDeg * Math.PI) / 180);
  u.uSedimentC.value = p.sedimentSoundSpeed;
  u.uCutoffLoss.value = p.cutoffLossDbPerKm;
}
import { FullscreenPass, rawMaterial } from '../render/fullscreen.ts';

/** Paramètres numériques fixes (non artistiques : la calibration en dépend). */
export const PHYS_COURANT = 0.5;
export const PHYS_WAVELENGTH = 6; // cellules
export const PHYS_COHERENCE = 24; // pas : durée de cohérence de la phase des sources
export const L_REF = 150; // dB : référence de normalisation des amplitudes
const EARTH_RADIUS_M = 6_371_000;

const STEP_FRAG = /* glsl */ `
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPrev;    // u(n-1), canaux = bandes
uniform sampler2D uCur;     // u(n)
uniform sampler2D uSource;
uniform sampler2D uOcean;   // R mer, G profondeur (log), B fraction de terre
uniform vec2 uTexel;
uniform float uLatTop;
uniform float uLatSpan;
uniform float uSponge;
uniform float uPolarCap;
uniform vec3 uAlpha;        // absorption par bande (dB/km)
uniform vec3 uBandFreq;     // fréquence représentative (Hz)
uniform float uCellKm;
uniform float uExtraLoss;   // dB/km partout (0 par défaut)
${LOSS_UNIFORMS_GLSL}
uniform float uDampingScale; // 0 pour la calibration (étalement seul)

const float COURANT = ${PHYS_COURANT.toFixed(3)};

void main() {
  vec4 ocean = texture(uOcean, vUv);
  float lat = uLatTop - vUv.y * uLatSpan;
  if (ocean.r < 0.5 || abs(lat) > uPolarCap) { outColor = vec4(0.0); return; }
  vec3 u = texture(uCur, vUv).rgb;
  vec3 up = texture(uPrev, vUv).rgb;
  vec3 uE = texture(uCur, vUv + vec2(uTexel.x, 0.0)).rgb;
  vec3 uW = texture(uCur, vUv - vec2(uTexel.x, 0.0)).rgb;
  vec3 uN = texture(uCur, vUv - vec2(0.0, uTexel.y)).rgb;
  vec3 uS = texture(uCur, vUv + vec2(0.0, uTexel.y)).rgb;
  float c = max(cos(lat), 0.02);
  float h = uTexel.y * uLatSpan;
  vec3 lap = (uE + uW - 2.0 * u) / (c * c) + (uN + uS - 2.0 * u) - tan(lat) * h * (uN - uS) * 0.5;
  float C = min(COURANT, 0.95 / sqrt(1.0 + 1.0 / (c * c)));

  // Pertes par bande, converties en amortissement par pas :
  // une onde parcourt C cellules par pas ; perte d'énergie (dB/cellule) = 8,686 · g / C.
  // Même modèle de pertes que l'équation du sonar des cétacés (shared/src/acoustics/propagation.ts).
  float depth = 10.0 * pow(1100.0, ocean.g);
  vec3 dbPerKm = uAlpha + uExtraLoss + vec3(bottomLossRate(depth)) + cutoffLossRate(depth, uBandFreq);
  vec3 g = dbPerKm * uCellKm * COURANT / 8.686;
  g *= uDampingScale;
  g += 0.3 * ocean.b; // côtes absorbantes
  if (uSponge > 0.0) {
    vec2 cells = vUv / uTexel;
    float d = min(min(cells.x, 1.0 / uTexel.x - cells.x), min(cells.y, 1.0 / uTexel.y - cells.y));
    float k = clamp(1.0 - d / uSponge, 0.0, 1.0);
    g += 0.25 * k * k;
  }
  vec3 next = (2.0 * u - (1.0 - g) * up + C * C * lap) / (1.0 + g);
  next += texture(uSource, vUv).rgb;
  outColor = vec4(next, 1.0);
}`;

/** Moyenne glissante de u² (intensité). */
const ENERGY_FRAG = /* glsl */ `
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uCur;
uniform sampler2D uEnergy;
uniform float uBeta;
void main() {
  vec3 u = texture(uCur, vUv).rgb;
  vec3 e = texture(uEnergy, vUv).rgb;
  outColor = vec4(e + uBeta * (u * u - e), 1.0);
}`;

/** Conversion en dB + accumulation asymétrique (R = niveau affiché accumulé, GBA = niveaux par bande). */
const ACCUM_FRAG = /* glsl */ `
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uEnergy;
uniform sampler2D uAccum;
uniform sampler2D uOcean;
uniform float uOffsetDb;     // L_ref − 10·log10(K · cellule)
uniform vec3 uNatural;       // bruit naturel par bande (dB)
uniform vec3 uWeights;
uniform float uRise;         // 1 − exp(−dt/τ_montée)
uniform float uFall;
uniform float uInit;         // 1 : initialisation au bruit naturel
void main() {
  vec3 e = max(texture(uEnergy, vUv).rgb, vec3(1e-30));
  vec3 ships = pow(vec3(10.0), (10.0 * log(e) / log(10.0) + uOffsetDb) / 10.0);
  vec3 total = ships + pow(vec3(10.0), uNatural / 10.0);
  vec3 L = 10.0 * log(total) / log(10.0);
  float disp = 10.0 * log(dot(uWeights, total) / max(dot(uWeights, vec3(1.0)), 1e-6)) / log(10.0);
  float naturalDisp = 10.0 * log(dot(uWeights, pow(vec3(10.0), uNatural / 10.0)) / max(dot(uWeights, vec3(1.0)), 1e-6)) / log(10.0);
  float A = uInit > 0.5 ? naturalDisp : texture(uAccum, vUv).r;
  A += (disp - A) * (disp > A ? uRise : uFall);
  if (texture(uOcean, vUv).r < 0.5) { A = naturalDisp; L = uNatural; }
  outColor = vec4(A, L);
}`;

function floatTarget(w: number, h: number, wrapS: THREE.Wrapping): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    wrapS,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
  });
}

export interface PhysicsDomain {
  lonCenter: number;
  latTop: number;
  lonSpan: number;
  latSpan: number;
}

export class PhysicsField {
  readonly width: number;
  readonly height: number;
  readonly domain: PhysicsDomain;
  /** Taille d'une cellule en latitude (m). */
  readonly cellMeters: number;
  readonly sourceTarget: THREE.WebGLRenderTarget;
  private states: THREE.WebGLRenderTarget[];
  private energy: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private accum: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readonly stepPass: FullscreenPass;
  private readonly energyPass: FullscreenPass;
  private readonly accumPass: FullscreenPass;
  private readonly su: Record<string, THREE.IUniform>;
  private readonly eu: Record<string, THREE.IUniform>;
  private readonly au: Record<string, THREE.IUniform>;
  private initialized = false;
  /** Constante de calibration (énergie·cellules par unité d'amplitude²). */
  calibrationK = 1;

  constructor(width: number, readonly ocean: THREE.Texture, domain: PhysicsDomain = { lonCenter: 0, latTop: 90, lonSpan: 360, latSpan: 180 }) {
    this.domain = domain;
    this.width = width;
    this.height = Math.round((width * domain.latSpan) / domain.lonSpan);
    const regional = domain.lonSpan < 360;
    const wrap = regional ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    this.cellMeters = ((domain.latSpan / this.height) * Math.PI * EARTH_RADIUS_M) / 180;
    this.states = [0, 1, 2].map(() => floatTarget(this.width, this.height, wrap));
    this.energy = [floatTarget(this.width, this.height, wrap), floatTarget(this.width, this.height, wrap)];
    this.accum = [floatTarget(this.width, this.height, wrap), floatTarget(this.width, this.height, wrap)];
    for (const t of this.accum) t.texture.magFilter = t.texture.minFilter = THREE.LinearFilter;
    this.sourceTarget = new THREE.WebGLRenderTarget(this.width, this.height, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
    });
    const deg = Math.PI / 180;
    this.su = {
      uPrev: { value: null },
      uCur: { value: null },
      uSource: { value: this.sourceTarget.texture },
      uOcean: { value: ocean },
      uTexel: { value: new THREE.Vector2(1 / this.width, 1 / this.height) },
      uLatTop: { value: domain.latTop * deg },
      uLatSpan: { value: domain.latSpan * deg },
      uSponge: { value: regional ? 12 : 0 },
      uPolarCap: { value: 79 * deg },
      uAlpha: { value: new THREE.Vector3() },
      uBandFreq: { value: new THREE.Vector3(20, 224, 3162) },
      uCellKm: { value: this.cellMeters / 1000 },
      uExtraLoss: { value: 0 },
      ...lossUniforms(),
      uDampingScale: { value: 1 },
    };
    this.eu = { uCur: { value: null }, uEnergy: { value: null }, uBeta: { value: 0.01 } };
    this.au = {
      uEnergy: { value: null },
      uAccum: { value: null },
      uOcean: { value: ocean },
      uOffsetDb: { value: L_REF },
      uNatural: { value: new THREE.Vector3(88, 88, 92) },
      uWeights: { value: new THREE.Vector3(0.45, 0.4, 0.15) },
      uRise: { value: 0 },
      uFall: { value: 0 },
      uInit: { value: 1 },
    };
    this.stepPass = new FullscreenPass(rawMaterial(STEP_FRAG, this.su));
    this.energyPass = new FullscreenPass(rawMaterial(ENERGY_FRAG, this.eu));
    this.accumPass = new FullscreenPass(rawMaterial(ACCUM_FRAG, this.au));
  }

  configure(cfg: Config): void {
    const [low, mid, high] = cfg.bands;
    const f = [low, mid, high].map(bandCenter);
    (this.su.uAlpha.value as THREE.Vector3).set(...(f.map(thorpAbsorptionDbPerKm) as [number, number, number]));
    (this.su.uBandFreq.value as THREE.Vector3).set(f[0], f[1], f[2]);
    this.su.uExtraLoss.value = cfg.physics.extraLossDbPerKm;
    setLossUniforms(this.su, cfg);
    this.su.uPolarCap.value = (cfg.waves.polarCapLat * Math.PI) / 180;
    const wind = cfg.ambient.windSpeedMs;
    (this.au.uNatural.value as THREE.Vector3).set(naturalLevel(low, wind), naturalLevel(mid, wind), naturalLevel(high, wind));
    const w = cfg.accumulation.bandWeights;
    (this.au.uWeights.value as THREE.Vector3).set(w.low, w.mid, w.high);
  }

  /** Décalage dB : L = 10·log10(E) + offset. */
  get offsetDb(): number {
    return L_REF - 10 * Math.log10(this.calibrationK * this.cellMeters);
  }

  setDampingScale(s: number): void {
    this.su.uDampingScale.value = s;
  }

  clear(renderer: THREE.WebGLRenderer): void {
    renderer.setClearColor(0x000000, 0);
    for (const t of [...this.states, ...this.energy, ...this.accum, this.sourceTarget]) {
      renderer.setRenderTarget(t);
      renderer.clear(true, false, false);
    }
    this.initialized = false;
  }

  /** Un pas de l'équation des ondes (après l'injection dans sourceTarget). */
  step(renderer: THREE.WebGLRenderer): void {
    const [prev, cur, next] = this.states;
    this.su.uPrev.value = prev.texture;
    this.su.uCur.value = cur.texture;
    this.stepPass.render(renderer, next);
    this.states = [cur, next, prev];
  }

  /** Mise à jour de la moyenne d'énergie avec le coefficient `beta`. */
  updateEnergy(renderer: THREE.WebGLRenderer, beta: number): void {
    this.eu.uCur.value = this.states[1].texture;
    this.eu.uEnergy.value = this.energy[0].texture;
    this.eu.uBeta.value = beta;
    this.energyPass.render(renderer, this.energy[1]);
    this.energy = [this.energy[1], this.energy[0]];
  }

  /** Conversion en dB et accumulation (dtSec : temps réel écoulé). */
  accumulate(renderer: THREE.WebGLRenderer, dtSec: number, cfg: Config): void {
    const a = cfg.accumulation;
    this.au.uEnergy.value = this.energy[0].texture;
    this.au.uAccum.value = this.accum[0].texture;
    this.au.uOffsetDb.value = this.offsetDb;
    this.au.uRise.value = 1 - Math.exp(-dtSec / (a.riseMinutes * 60));
    this.au.uFall.value = 1 - Math.exp(-dtSec / (a.fallMinutes * 60));
    this.au.uInit.value = this.initialized ? 0 : 1;
    this.accumPass.render(renderer, this.accum[1]);
    this.accum = [this.accum[1], this.accum[0]];
    this.initialized = true;
  }

  /** R = niveau affiché accumulé (dB), G/B/A = niveaux courants par bande (dB re 1 µPa). */
  get levels(): THREE.WebGLRenderTarget {
    return this.accum[0];
  }

  get energyTarget(): THREE.WebGLRenderTarget {
    return this.energy[0];
  }

  /** Lit les niveaux (dB) en un point. */
  readLevels(renderer: THREE.WebGLRenderer, lat: number, lon: number): [number, number, number, number] | null {
    const d = this.domain;
    const dLon = ((((lon - d.lonCenter + 180) % 360) + 360) % 360) - 180;
    const u = dLon / d.lonSpan + 0.5;
    const v = (d.latTop - lat) / d.latSpan;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
    const buf = new Float32Array(4);
    renderer.readRenderTargetPixels(this.levels, Math.floor(u * this.width), Math.floor(v * this.height), 1, 1, buf);
    return [buf[0], buf[1], buf[2], buf[3]];
  }

  dispose(): void {
    for (const t of [...this.states, ...this.energy, ...this.accum, this.sourceTarget]) t.dispose();
    for (const p of [this.stepPass, this.energyPass, this.accumPass]) p.material.dispose();
  }
}

/**
 * Signal injecté par une source : porteuse à la longueur d'onde de la grille, phase aléatoire
 * lentement variable (bande étroite, incohérente d'une source à l'autre). Partagé par l'injection
 * des navires et par la calibration.
 */
export const PHYS_SIGNAL_GLSL = /* glsl */ `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float phaseNoise(float seed, float t) {
  float i = floor(t);
  float f = fract(t);
  float a = hash11(seed * 97.31 + i);
  float b = hash11(seed * 97.31 + i + 1.0);
  return mix(a, b, f * f * (3.0 - 2.0 * f));
}
float physSignal(float seed, float clock) {
  float omega = 6.283185307 * ${PHYS_COURANT.toFixed(3)} / ${PHYS_WAVELENGTH.toFixed(1)};
  float phi = 12.566370614 * phaseNoise(seed, clock / ${PHYS_COHERENCE.toFixed(1)});
  return cos(omega * clock + phi);
}
/** Amplitude injectée pour un niveau source SL (dB) et une transition r_t (m). */
vec3 physAmplitude(vec3 sl, float rt) {
  return sqrt(pow(vec3(10.0), (sl - 10.0 * log(max(rt, 10.0)) / log(10.0) - ${L_REF.toFixed(1)}) / 10.0));
}`;

/** Matériau d'injection des sources dans la grille physique (points). */
export function physicsInjectMaterial(extraHeader: string, positionGlsl: string): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: /* glsl */ `
precision highp float;
in vec3 position;
in vec2 aLatLon;
in vec2 aMotion;
in vec3 aSL;
in float aSeed;
uniform float uDt;
uniform float uClock;
uniform vec4 uDomain;
uniform sampler2D uOcean;
uniform float uGain;
out vec3 vAmp;
${extraHeader}
${PHYS_SIGNAL_GLSL}
void main() {
  vec2 ll = ${positionGlsl};
  float dLon = mod(ll.y - uDomain.x + 180.0, 360.0) - 180.0;
  float x = dLon / (0.5 * uDomain.z);
  float v = (uDomain.y - ll.x) / uDomain.w;
  gl_Position = vec4(x, v * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
  float depth = 10.0 * pow(1100.0, texture(uOcean, vec2(dLon / uDomain.z + 0.5, v)).g);
  vAmp = uGain * physAmplitude(aSL, depth) * physSignal(aSeed, uClock);
}`,
    fragmentShader: /* glsl */ `
precision highp float;
in vec3 vAmp;
out vec4 outColor;
void main() { outColor = vec4(vAmp, 1.0); } // alpha 1 : le mélange additif de three.js multiplie par l'alpha`,
    uniforms: {
      uDt: { value: 0 },
      uClock: { value: 0 },
      uDomain: { value: new THREE.Vector4(0, 90, 360, 180) },
      uOcean: { value: null },
      uGain: { value: 1 },
    },
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
}

export interface CalibrationResult {
  K: number;
  /** Écart maximal (dB) entre E·r mesuré et la loi en 1/r, sur la plage d'ajustement. */
  maxDeviationDb: number;
  /** Plage d'ajustement (cellules). */
  range: [number, number];
  /** E(r)·r normalisé, en dB, pour l'affichage. */
  curve: { r: number; db: number }[];
}

/**
 * Calibration : une source unique d'amplitude 1 au centre d'une grille d'eau profonde uniforme,
 * sans absorption ; après stabilisation, on mesure E(r) le long des quatre directions et on
 * ajuste E(r) = K / r (étalement cylindrique). Durée : quelques dizaines de millisecondes.
 */
export function calibrate(renderer: THREE.WebGLRenderer): CalibrationResult {
  const N = 256;
  // Grille d'eau profonde uniforme (11 000 m), sans côtes, près de l'équateur (cellules de 0,01°).
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    data[4 * i] = 255;
    data[4 * i + 1] = 255;
    data[4 * i + 2] = 0;
    data[4 * i + 3] = 255;
  }
  const ocean = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  ocean.needsUpdate = true;
  const span = N * 0.01;
  const domain = { lonCenter: 0, latTop: span / 2, lonSpan: span, latSpan: span };
  const field = new PhysicsField(N, ocean, domain);
  field.setDampingScale(0);
  field.clear(renderer);

  // Une source : aSL tel que l'amplitude vaille 1 (SL = L_ref + 10·log10(profondeur)).
  const geo = new THREE.BufferGeometry();
  const sl = L_REF + 10 * Math.log10(11000);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  // Centre exact d'une cellule : (N/2 + 0,5) cellules depuis le bord.
  const c = (N / 2 + 0.5) * 0.01;
  geo.setAttribute('aLatLon', new THREE.BufferAttribute(new Float32Array([span / 2 - c, -span / 2 + c]), 2));
  geo.setAttribute('aMotion', new THREE.BufferAttribute(new Float32Array(2), 2));
  geo.setAttribute('aSL', new THREE.BufferAttribute(new Float32Array([sl, sl, sl]), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array([0.37]), 1));
  const mat = physicsInjectMaterial('', 'aLatLon');
  mat.uniforms.uOcean.value = ocean;
  (mat.uniforms.uDomain.value as THREE.Vector4).set(domain.lonCenter, domain.latTop, domain.lonSpan, domain.latSpan);
  const scene = new THREE.Scene();
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  const cam = new THREE.Camera();

  const STEPS = 2400;
  for (let s = 0; s < STEPS; s++) {
    mat.uniforms.uClock.value = s;
    renderer.setRenderTarget(field.sourceTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.render(scene, cam);
    field.step(renderer);
    // Moyenne d'énergie : démarrage rapide, puis longue moyenne.
    field.updateEnergy(renderer, s < 600 ? 1 / 40 : 1 / 600);
  }

  const row = new Float32Array(N * 4);
  const col = new Float32Array(N * 4);
  renderer.readRenderTargetPixels(field.energyTarget, 0, N / 2, N, 1, row);
  renderer.readRenderTargetPixels(field.energyTarget, N / 2, 0, 1, N, col);
  const E = (r: number) => (row[4 * (N / 2 + r)] + row[4 * (N / 2 - r)] + col[4 * (N / 2 + r)] + col[4 * (N / 2 - r)]) / 4;
  const range: [number, number] = [3 * PHYS_WAVELENGTH, 16 * PHYS_WAVELENGTH];
  let sum = 0;
  let n = 0;
  for (let r = range[0]; r <= range[1]; r++) {
    sum += E(r) * r;
    n++;
  }
  const K = sum / n;
  let maxDev = 0;
  const curve: { r: number; db: number }[] = [];
  for (let r = 2; r <= range[1] + 10; r++) {
    const db = 10 * Math.log10((E(r) * r) / K);
    curve.push({ r, db });
    if (r >= range[0] && r <= range[1]) maxDev = Math.max(maxDev, Math.abs(db));
  }
  field.dispose();
  ocean.dispose();
  geo.dispose();
  mat.dispose();
  return { K, maxDeviationDb: maxDev, range, curve };
}

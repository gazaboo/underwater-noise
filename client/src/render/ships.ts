/**
 * Couche « navires » : un nuage de points mis à jour à chaque instantané du serveur.
 *
 * Les positions sont extrapolées sur le GPU (vertex shader) à partir de la position,
 * de la vitesse fond et du cap reçus : le mouvement reste fluide à 60 images/s sans
 * calcul côté processeur.
 *
 * Deux usages du même nuage :
 *  - injection des sources dans la simulation d'ondes (impulsions de fronts d'onde) ;
 *  - affichage des navires sur la carte plate (petits points lumineux).
 */
import * as THREE from 'three';
import type { Config, ShipSnapshot } from '@vacarme/shared';
import { HEADER_BYTES, SHIP_STRIDE } from '@vacarme/shared';
import { hexToVec3 } from './fullscreen.ts';
import type { FlatTransform } from './flat-view.ts';

const MAX_SHIPS = 50000;

/** Extrapolation « à l'estime » (dead reckoning), en GLSL. */
const DEAD_RECKON = /* glsl */ `
vec2 deadReckon(vec2 latLon, vec2 motion, float dtSec) {
  float dist = motion.x * 0.514444 * dtSec;          // m (vitesse en nœuds)
  float cog = radians(motion.y);
  float lat = latLon.x + degrees(dist * cos(cog) / 6371000.0);
  float lon = latLon.y + degrees(dist * sin(cog) / (6371000.0 * max(cos(radians(latLon.x)), 0.05)));
  return vec2(clamp(lat, -89.9, 89.9), lon);
}`;

const INJECT_VERT = /* glsl */ `
precision highp float;
in vec3 position;   // inutilisé (attribut obligatoire pour three.js)
in vec2 aLatLon;
in vec2 aMotion;    // sog (nœuds), cog (degrés)
in float aAmp;      // amplitude 0..1
in float aSeed;     // 0..1
uniform float uDt;          // secondes simulées depuis l'instantané
uniform float uClock;       // compteur de pas
uniform float uPeriodSteps; // pas entre deux impulsions, pour un navire de référence
uniform float uCarrier;     // période de la porteuse (pas)
uniform float uCycles;
uniform float uGain;
uniform float uSplat;       // taille du point (cellules)
out float vSignal;
${DEAD_RECKON}
const float PI = 3.141592653589793;
void main() {
  vec2 ll = deadReckon(aLatLon, aMotion, uDt);
  float x = fract((ll.y + 180.0) / 360.0) * 2.0 - 1.0;
  float v = (90.0 - ll.x) / 180.0;
  gl_Position = vec4(x, v * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = uSplat;

  // Navires rapides : impulsions plus fréquentes ; dispersion individuelle par la graine.
  float speedFactor = clamp(sqrt(max(aMotion.x, 0.5) / 12.0), 0.4, 1.8);
  float period = uPeriodSteps / (speedFactor * (0.75 + 0.5 * aSeed));
  float ph = mod(uClock + aSeed * period * 13.0, period);
  float dur = uCycles * uCarrier;
  float env = ph < dur ? pow(sin(PI * ph / dur), 2.0) : 0.0;
  vSignal = uGain * aAmp * env * sin(2.0 * PI * ph / uCarrier);
}`;

const INJECT_FRAG = /* glsl */ `
precision highp float;
in float vSignal;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float w = exp(-dot(d, d) * 12.0);
  outColor = vec4(vSignal * w, 0.0, 0.0, 1.0);
}`;

const DISPLAY_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec2 aLatLon;
in vec2 aMotion;
in float aAmp;
uniform float uDt;
uniform vec2 uCenter;     // lon, lat au centre de l'écran
uniform float uScale;     // pixels (tampon) par degré
uniform vec2 uResolution; // taille du tampon (pixels)
uniform vec2 uLatRange;
uniform float uPointSize;
out float vAlpha;
${DEAD_RECKON}
void main() {
  vec2 ll = deadReckon(aLatLon, aMotion, uDt);
  float dLon = mod(ll.y - uCenter.x + 180.0, 360.0) - 180.0;
  vec2 px = vec2(dLon, ll.x - uCenter.y) * uScale;
  gl_Position = vec4(px / (0.5 * uResolution), 0.0, 1.0);
  bool visible = ll.x >= uLatRange.x && ll.x <= uLatRange.y;
  gl_PointSize = visible ? uPointSize * (0.7 + 0.6 * aAmp) : 0.0;
  vAlpha = 0.35 + 0.65 * aAmp;
}`;

const DISPLAY_FRAG = /* glsl */ `
precision highp float;
in float vAlpha;
uniform vec3 uColor;
uniform float uOpacity;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float w = smoothstep(0.5, 0.0, length(d));
  outColor = vec4(uColor * w * vAlpha * uOpacity, 1.0);
}`;

export class ShipLayer {
  readonly geometry = new THREE.BufferGeometry();
  private readonly latLon = new Float32Array(MAX_SHIPS * 2);
  private readonly motion = new Float32Array(MAX_SHIPS * 2);
  private readonly amp = new Float32Array(MAX_SHIPS);
  private readonly seed = new Float32Array(MAX_SHIPS);
  private readonly slBroad = new Float32Array(MAX_SHIPS);
  private count = 0;

  private readonly injectMaterial: THREE.RawShaderMaterial;
  private readonly displayMaterial: THREE.RawShaderMaterial;
  private readonly injectScene = new THREE.Scene();
  private readonly displayScene = new THREE.Scene();
  private readonly camera = new THREE.Camera();

  /** Temps simulé de l'instantané courant et horloge locale de réception. */
  private snapTimeMs = 0;
  private receivedAt = 0;
  private timeScale = 1;

  constructor() {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SHIPS * 3), 3));
    this.geometry.setAttribute('aLatLon', new THREE.BufferAttribute(this.latLon, 2).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aMotion', new THREE.BufferAttribute(this.motion, 2).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aAmp', new THREE.BufferAttribute(this.amp, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);

    this.injectMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: INJECT_VERT,
      fragmentShader: INJECT_FRAG,
      uniforms: {
        uDt: { value: 0 },
        uClock: { value: 0 },
        uPeriodSteps: { value: 400 },
        uCarrier: { value: 15 },
        uCycles: { value: 1.5 },
        uGain: { value: 1 },
        uSplat: { value: 3 },
      },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.displayMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: DISPLAY_VERT,
      fragmentShader: DISPLAY_FRAG,
      uniforms: {
        uDt: { value: 0 },
        uCenter: { value: new THREE.Vector2() },
        uScale: { value: 1 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uLatRange: { value: new THREE.Vector2(-90, 90) },
        uPointSize: { value: 2 },
        uColor: { value: new THREE.Vector3(1, 1, 1) },
        uOpacity: { value: 0.5 },
      },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    for (const [scene, mat] of [
      [this.injectScene, this.injectMaterial],
      [this.displayScene, this.displayMaterial],
    ] as const) {
      const pts = new THREE.Points(this.geometry, mat);
      pts.frustumCulled = false;
      scene.add(pts);
    }
  }

  get shipCount(): number {
    return this.count;
  }

  /** Copie un instantané dans les tampons GPU. */
  update(snap: ShipSnapshot, receivedAt: number, cfg: Config): void {
    const n = Math.min(snap.count, MAX_SHIPS);
    const v = snap.view;
    for (let i = 0; i < n; i++) {
      const o = HEADER_BYTES + i * SHIP_STRIDE;
      const id = v.getUint32(o, true);
      this.latLon[2 * i] = v.getFloat32(o + 4, true);
      this.latLon[2 * i + 1] = v.getFloat32(o + 8, true);
      this.motion[2 * i] = v.getFloat32(o + 12, true);
      this.motion[2 * i + 1] = v.getFloat32(o + 16, true);
      this.slBroad[i] = v.getFloat32(o + 36, true);
      // Graine stable par navire (hachage de l'identifiant).
      this.seed[i] = ((Math.imul(id ^ (id >>> 16), 0x45d9f3b) >>> 0) % 10007) / 10007;
    }
    this.count = n;
    this.snapTimeMs = snap.simTimeMs;
    this.receivedAt = receivedAt;
    this.timeScale = snap.timeScale;
    this.recomputeAmplitudes(cfg);
    for (const name of ['aLatLon', 'aMotion', 'aSeed']) (this.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.setDrawRange(0, n);
  }

  /** Niveau source large bande → amplitude visuelle (paramètres artistiques). */
  recomputeAmplitudes(cfg: Config): void {
    const { slMin, slMax, gamma } = cfg.waves.amplitude;
    for (let i = 0; i < this.count; i++) {
      const t = Math.min(1, Math.max(0, (this.slBroad[i] - slMin) / (slMax - slMin)));
      const moored = this.motion[2 * i] < 0.5 ? 0.1 : 1;
      this.amp[i] = moored * t ** gamma;
    }
    (this.geometry.getAttribute('aAmp') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Secondes simulées écoulées depuis l'instantané (pour l'extrapolation). */
  dtSim(now: number): number {
    return ((now - this.receivedAt) * this.timeScale) / 1000;
  }

  /** Temps simulé courant (ms). */
  simTimeMs(now: number): number {
    return this.snapTimeMs + (now - this.receivedAt) * this.timeScale;
  }

  /** Injecte les sources du pas courant dans la cible de la simulation. */
  inject(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, now: number, clock: number, cfg: Config, courant: number, stepsPerSecond: number): void {
    const u = this.injectMaterial.uniforms;
    const p = cfg.waves.pulse;
    u.uDt.value = this.dtSim(now);
    u.uClock.value = clock;
    u.uCarrier.value = p.wavelengthCells / courant;
    u.uCycles.value = p.cycles;
    u.uPeriodSteps.value = stepsPerSecond / p.rate;
    u.uGain.value = p.gain;
    u.uSplat.value = 3 * (target.width / 2048);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.render(this.injectScene, this.camera);
  }

  /** Dessine les navires sur la carte plate. */
  draw(renderer: THREE.WebGLRenderer, now: number, view: FlatTransform, cfg: Config, pixelRatio: number): void {
    if (!cfg.ships.visible) return;
    const u = this.displayMaterial.uniforms;
    u.uDt.value = this.dtSim(now);
    (u.uCenter.value as THREE.Vector2).set(view.centerLon, view.centerLat);
    u.uScale.value = view.scale;
    (u.uResolution.value as THREE.Vector2).set(view.width, view.height);
    (u.uLatRange.value as THREE.Vector2).set(view.latMin, view.latMax);
    u.uPointSize.value = cfg.ships.pointSize * pixelRatio;
    hexToVec3(cfg.palette.ship, u.uColor.value as THREE.Vector3);
    u.uOpacity.value = cfg.ships.opacity;
    renderer.setRenderTarget(null);
    renderer.render(this.displayScene, this.camera);
  }
}

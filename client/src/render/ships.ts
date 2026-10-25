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
import { FLAG_ESTIMATED, HEADER_BYTES, SHIP_STRIDE } from '@vacarme/shared';
import { hexToVec3 } from './fullscreen.ts';
import type { FlatTransform } from './flat-view.ts';
import type { PhysicsDomain } from '../sim/physics-sim.ts';
import { physicsInjectMaterial } from '../sim/physics-sim.ts';

const MAX_SHIPS = 70000;

/** Extrapolation « à l'estime » (dead reckoning), en GLSL. */
const DEAD_RECKON = /* glsl */ `
vec2 deadReckon(vec2 latLon, vec2 motion, float dtSec) {
  float dist = motion.x * 0.514444 * dtSec;          // m (vitesse en nœuds)
  float cog = radians(motion.y);
  float lat = latLon.x + degrees(dist * cos(cog) / 6371000.0);
  float lon = latLon.y + degrees(dist * sin(cog) / (6371000.0 * max(cos(radians(latLon.x)), 0.05)));
  return vec2(clamp(lat, -89.9, 89.9), lon);
}`;

const DISPLAY_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec2 aLatLon;
in vec2 aMotion;
in float aAmp;
in float aEstimated;      // 1 : navire estimé (densité Global Fishing Watch), 0 : navire réel
uniform float uDt;
uniform vec2 uCenter;     // lon, lat au centre de l'écran
uniform float uScale;     // pixels (tampon) par degré
uniform vec2 uResolution; // taille du tampon (pixels)
uniform vec2 uLatRange;
uniform float uPointSize;
out float vAlpha;
flat out float vEstimated;
${DEAD_RECKON}
void main() {
  vec2 ll = deadReckon(aLatLon, aMotion, uDt);
  float dLon = mod(ll.y - uCenter.x + 180.0, 360.0) - 180.0;
  vec2 px = vec2(dLon, ll.x - uCenter.y) * uScale;
  gl_Position = vec4(px / (0.5 * uResolution), 0.0, 1.0);
  bool visible = ll.x >= uLatRange.x && ll.x <= uLatRange.y;
  // Navires estimés : anneau un peu plus grand (sinon illisible à 2–3 pixels).
  gl_PointSize = visible ? uPointSize * (0.7 + 0.6 * aAmp) * (1.0 + 0.8 * aEstimated) : 0.0;
  vAlpha = 0.35 + 0.65 * aAmp;
  vEstimated = aEstimated;
}`;

const DISPLAY_FRAG = /* glsl */ `
precision highp float;
in float vAlpha;
flat in float vEstimated;
uniform vec3 uColor;
uniform float uOpacity;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  float w = smoothstep(0.5, 0.0, r);
  // Navire estimé : anneau creux, atténué — distinct d'un navire observé par l'AIS.
  float ring = smoothstep(0.5, 0.38, r) * smoothstep(0.18, 0.3, r) * 0.75;
  outColor = vec4(uColor * mix(w, ring, vEstimated) * vAlpha * uOpacity, 1.0);
}`;

export interface ShipSample {
  id: number;
  lat: number;
  lon: number;
  sog: number;
  classIndex: number;
  lengthM: number;
  slBroad: number;
}

export class ShipLayer {
  readonly geometry = new THREE.BufferGeometry();
  private readonly latLon = new Float32Array(MAX_SHIPS * 2);
  private readonly motion = new Float32Array(MAX_SHIPS * 2);
  private readonly amp = new Float32Array(MAX_SHIPS);
  private readonly seed = new Float32Array(MAX_SHIPS);
  private readonly slBroad = new Float32Array(MAX_SHIPS);
  private readonly ids = new Uint32Array(MAX_SHIPS);
  private readonly classes = new Uint8Array(MAX_SHIPS);
  private readonly lengths = new Uint16Array(MAX_SHIPS);
  private readonly estimated = new Float32Array(MAX_SHIPS);
  /** Niveaux sources par bande (dB re 1 µPa·m) : basse, moyenne, haute. */
  private readonly slBands = new Float32Array(MAX_SHIPS * 3);
  private count = 0;

  private readonly displayMaterial: THREE.RawShaderMaterial;
  private readonly physicsScene = new THREE.Scene();
  private readonly physicsMaterial: THREE.RawShaderMaterial;
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
    this.geometry.setAttribute('aSL', new THREE.BufferAttribute(this.slBands, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aEstimated', new THREE.BufferAttribute(this.estimated, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);

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
    this.physicsMaterial = physicsInjectMaterial(DEAD_RECKON, 'deadReckon(aLatLon, aMotion, uDt)');
    for (const [scene, mat] of [
      [this.displayScene, this.displayMaterial],
      [this.physicsScene, this.physicsMaterial],
    ] as const) {
      const pts = new THREE.Points(this.geometry, mat);
      pts.frustumCulled = false;
      scene.add(pts);
    }
  }

  get shipCount(): number {
    return this.count;
  }

  /** Données d'un navire pour le son : identifiant, position extrapolée, vitesse, classe, longueur, niveau. */
  shipAt(i: number, now: number): ShipSample {
    return this.shipInto(i, now, { id: 0, lat: 0, lon: 0, sog: 0, classIndex: 0, lengthM: 0, slBroad: 0 });
  }

  /** Identifiant et niveau source large bande du navire i (préfiltrage sans calcul de position). */
  idOf(i: number): number {
    return this.ids[i];
  }

  slBroadOf(i: number): number {
    return this.slBroad[i];
  }

  /** Comme shipAt, sans allocation (parcours de dizaines de milliers de navires). */
  shipInto(i: number, now: number, out: ShipSample): ShipSample {
    const dt = this.dtSim(now);
    const lat0 = this.latLon[2 * i];
    const lon0 = this.latLon[2 * i + 1];
    const sog = this.motion[2 * i];
    const cog = (this.motion[2 * i + 1] * Math.PI) / 180;
    const dist = sog * 0.514444 * dt;
    const lat = lat0 + ((dist * Math.cos(cog)) / 6_371_000) * (180 / Math.PI);
    const lon = lon0 + ((dist * Math.sin(cog)) / (6_371_000 * Math.max(Math.cos((lat0 * Math.PI) / 180), 0.05))) * (180 / Math.PI);
    out.id = this.ids[i];
    out.lat = lat;
    out.lon = lon;
    out.sog = sog;
    out.classIndex = this.classes[i];
    out.lengthM = this.lengths[i];
    out.slBroad = this.slBroad[i];
    return out;
  }

  get currentTimeScale(): number {
    return this.timeScale;
  }

  /** Copie un instantané dans les tampons GPU. */
  update(snap: ShipSnapshot, receivedAt: number, cfg: Config): void {
    const n = Math.min(snap.count, MAX_SHIPS);
    const v = snap.view;
    for (let i = 0; i < n; i++) {
      const o = HEADER_BYTES + i * SHIP_STRIDE;
      const id = v.getUint32(o, true);
      this.ids[i] = id;
      this.classes[i] = v.getUint8(o + 20);
      this.estimated[i] = v.getUint8(o + 21) & FLAG_ESTIMATED ? 1 : 0;
      this.lengths[i] = v.getUint16(o + 22, true);
      this.latLon[2 * i] = v.getFloat32(o + 4, true);
      this.latLon[2 * i + 1] = v.getFloat32(o + 8, true);
      this.motion[2 * i] = v.getFloat32(o + 12, true);
      this.motion[2 * i + 1] = v.getFloat32(o + 16, true);
      this.slBroad[i] = v.getFloat32(o + 36, true);
      const sog = this.motion[2 * i];
      // Navire à quai : son niveau J-E (vitesse bornée à 0,5 nœud) reste injecté, il est déjà très faible.
      this.slBands[3 * i] = v.getFloat32(o + 24, true) + (sog < 0.5 ? -10 : 0);
      this.slBands[3 * i + 1] = v.getFloat32(o + 28, true) + (sog < 0.5 ? -10 : 0);
      this.slBands[3 * i + 2] = v.getFloat32(o + 32, true) + (sog < 0.5 ? -10 : 0);
      // Graine stable par navire (hachage de l'identifiant).
      this.seed[i] = ((Math.imul(id ^ (id >>> 16), 0x45d9f3b) >>> 0) % 10007) / 10007;
    }
    this.count = n;
    this.snapTimeMs = snap.simTimeMs;
    this.receivedAt = receivedAt;
    this.timeScale = snap.timeScale;
    this.recomputeAmplitudes(cfg);
    for (const name of ['aLatLon', 'aMotion', 'aSeed', 'aSL', 'aEstimated']) (this.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.setDrawRange(0, n);
  }

  /** Niveau source large bande → amplitude visuelle (paramètres artistiques). */
  recomputeAmplitudes(cfg: Config): void {
    // Marker size only: this mapping never controls acoustic injection or wave visibility.
    const slMin = 166, slMax = 192, gamma = 1.7;
    for (let i = 0; i < this.count; i++) {
      const t = Math.min(1, Math.max(0, (this.slBroad[i] - slMin) / (slMax - slMin)));
      const moored = this.motion[2 * i] < 0.5 ? 0.1 : 1;
      this.amp[i] = moored * t ** gamma;
    }
    (this.geometry.getAttribute('aAmp') as THREE.BufferAttribute).needsUpdate = true;
  }

  private sceneTimeMs: number | null = null;
  setTime(timeMs: number): void { this.sceneTimeMs = timeMs; }

  /** Secondes simulées écoulées depuis l'instantané (pour l'extrapolation). */
  dtSim(now: number): number {
    return this.sceneTimeMs === null ? (Math.min(5000, Math.max(0, now - this.receivedAt)) * this.timeScale) / 1000 : (this.sceneTimeMs - this.snapTimeMs) / 1000;
  }

  /** Temps simulé courant (ms). */
  simTimeMs(now: number): number {
    return this.sceneTimeMs ?? this.snapTimeMs + Math.min(5000, Math.max(0, now - this.receivedAt)) * this.timeScale;
  }

  /** Injecte les sources acoustiques (trois bandes) dans la grille physique. */
  injectPhysics(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, domain: PhysicsDomain, ocean: THREE.Texture, now: number, clock: number): void {
    const u = this.physicsMaterial.uniforms;
    u.uDt.value = this.dtSim(now);
    u.uClock.value = clock;
    u.uOcean.value = ocean;
    (u.uDomain.value as THREE.Vector4).set(domain.lonCenter, domain.latTop, domain.lonSpan, domain.latSpan);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.render(this.physicsScene, this.camera);
  }

  /** Dessine les navires sur la carte plate. */
  draw(renderer: THREE.WebGLRenderer, now: number, view: FlatTransform, cfg: Config, pixelRatio: number, target: THREE.WebGLRenderTarget | null = null): void {
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
    renderer.setRenderTarget(target);
    renderer.render(this.displayScene, this.camera);
  }
}

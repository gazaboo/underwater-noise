/**
 * Style « encre » du bruit ajouté : des traînées naissent là où le bruit est fort (près des navires),
 * descendent la pente de ΔL (vers le calme, donc vers l'extérieur) et s'effacent. Technique des cartes de
 * vent animées : état des particules dans une texture (mis à jour par une passe plein écran), points
 * dessinés dans une texture de traînées équirectangulaire qui s'estompe à chaque image.
 * Le champ ΔL est calculé [C] ; naissance, vitesse, durée et estompage sont artistiques [A], en temps réel.
 */
import * as THREE from 'three';
import type { Config } from '@vacarme/shared';
import { FullscreenPass, rawMaterial } from './fullscreen.ts';

const TRAIL_W = 2048;
const TRAIL_H = 1024;

const UPDATE_FRAG = /* glsl */ `
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uState;   // lon, lat, âge (s), graine
uniform sampler2D uNoiseDb; // ΔL lissé par bande (dB, RGB)
uniform sampler2D uOcean;
uniform vec3 uBandSel;
uniform float uDt, uTime, uLife, uSpeed;
uniform vec2 uNoiseTexel;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec2 uvOf(vec2 ll) { return vec2(fract((ll.x + 180.0) / 360.0), (90.0 - ll.y) / 180.0); }
float dlAt(vec2 uv) { return dot(texture(uNoiseDb, uv).rgb, uBandSel); }
void main() {
  vec4 s = texture(uState, vUv);
  vec2 ll = s.xy;
  float age = s.z + uDt;
  float seed = s.w;
  vec2 uv = uvOf(ll);
  float dl = dlAt(uv);
  bool dead = age > uLife * (0.6 + 0.8 * fract(seed * 7.3)) || dl < 1.0 || texture(uOcean, uv).r < 0.5 || abs(ll.y) > 78.0;
  if (dead) {
    // Renaissance : parmi quelques tirages, le point le plus bruyant (les zones fortes émettent plus).
    float best = -1.0;
    vec2 pick = ll;
    for (int i = 0; i < 6; i++) {
      vec2 r = vec2(hash(vUv * 91.7 + vec2(uTime, float(i))), hash(vUv * 37.3 + vec2(float(i), uTime * 1.7)));
      vec2 cand = vec2(r.x * 360.0 - 180.0, degrees(asin(r.y * 2.0 - 1.0)) * 0.88);
      vec2 cuv = uvOf(cand);
      float v = dlAt(cuv) * step(0.5, texture(uOcean, cuv).r) + hash(cand) * 4.0;
      if (v > best) { best = v; pick = cand; }
    }
    outColor = vec4(pick, 0.0, hash(pick + uTime));
    return;
  }
  // Descente de la pente de ΔL (vers le calme) ; un peu de dérive pour ne pas suivre exactement les rayons.
  vec2 g = vec2(dlAt(uv + vec2(uNoiseTexel.x, 0.0)) - dlAt(uv - vec2(uNoiseTexel.x, 0.0)),
                dlAt(uv - vec2(0.0, uNoiseTexel.y)) - dlAt(uv + vec2(0.0, uNoiseTexel.y)));
  vec2 dir = length(g) > 1e-4 ? -normalize(g) : vec2(0.0);
  float wob = (hash(vec2(seed, floor(age * 2.0))) - 0.5) * 1.2;
  dir = mat2(cos(wob), sin(wob), -sin(wob), cos(wob)) * dir;
  float speed = uSpeed * smoothstep(1.0, 8.0, dl);
  ll += dir * speed * uDt * vec2(1.0 / max(cos(radians(ll.y)), 0.2), 1.0);
  ll.x = mod(ll.x + 180.0, 360.0) - 180.0;
  outColor = vec4(ll, age, seed);
}`;

const POINT_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in float aIndex;
uniform sampler2D uState;
uniform float uLife, uSize;
uniform vec2 uStateSize;
out float vFade;
void main() {
  ivec2 c = ivec2(int(mod(aIndex, uStateSize.x)), int(aIndex / uStateSize.x));
  vec4 s = texelFetch(uState, c, 0);
  gl_Position = vec4(s.x / 180.0, s.y / 90.0, 0.0, 1.0);
  gl_PointSize = uSize;
  float t = s.z / uLife;
  vFade = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.6, 1.0, t));
}`;

const POINT_FRAG = /* glsl */ `
precision highp float;
in float vFade;
out vec4 outColor;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.4, 1.0, r)) * vFade * 0.5;
  outColor = vec4(a, a, a, a);
}`;

const FADE_FRAG = /* glsl */ `
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTrail;
uniform float uKeep;
void main() { outColor = texture(uTrail, vUv) * uKeep; }`;

export class NoiseInk {
  private stateSize = new THREE.Vector2();
  private states: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private trails: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readonly updatePass = new FullscreenPass(rawMaterial(UPDATE_FRAG, {
    uState: { value: null }, uNoiseDb: { value: null }, uOcean: { value: null }, uBandSel: { value: new THREE.Vector3(1, 0, 0) },
    uDt: { value: 0 }, uTime: { value: 0 }, uLife: { value: 9 }, uSpeed: { value: 2 }, uNoiseTexel: { value: new THREE.Vector2() },
  }));
  private readonly fadePass = new FullscreenPass(rawMaterial(FADE_FRAG, { uTrail: { value: null }, uKeep: { value: 0.95 } }));
  private readonly pointMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: POINT_VERT, fragmentShader: POINT_FRAG,
    uniforms: { uState: { value: null }, uLife: { value: 9 }, uSize: { value: 1.6 }, uStateSize: { value: this.stateSize } },
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
  });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private points: THREE.Points | null = null;
  private count = 0;

  constructor() {
    const trail = () => new THREE.WebGLRenderTarget(TRAIL_W, TRAIL_H, {
      type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false,
    });
    this.trails = [trail(), trail()];
  }

  /** Texture des traînées (équirectangulaire, R = densité d'encre). */
  get texture(): THREE.Texture {
    return this.trails[0].texture;
  }

  private allocate(renderer: THREE.WebGLRenderer, n: number): void {
    this.states?.forEach((t) => t.dispose());
    this.points?.geometry.dispose();
    if (this.points) this.scene.remove(this.points);
    const w = Math.max(1, Math.ceil(Math.sqrt(n)));
    const h = Math.max(1, Math.ceil(n / w));
    this.stateSize.set(w, h);
    const data = new Float32Array(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set([0, 0, 999, Math.random()], 4 * i); // morts : renaissent à la 1re mise à jour
    const init = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
    init.needsUpdate = true;
    const target = () => new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    this.states = [target(), target()];
    const copy = new FullscreenPass(rawMaterial('in vec2 vUv; out vec4 outColor; uniform sampler2D uSrc; void main() { outColor = texture(uSrc, vUv); }', { uSrc: { value: init } }));
    copy.render(renderer, this.states[0]);
    copy.material.dispose();
    init.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aIndex', new THREE.BufferAttribute(Float32Array.from({ length: n }, (_, i) => i), 1));
    this.points = new THREE.Points(geo, this.pointMat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    this.count = n;
  }

  update(renderer: THREE.WebGLRenderer, noiseDb: THREE.Texture, ocean: THREE.Texture, cfg: Config, wallSec: number, dtSec: number): void {
    const n = cfg.noise.inkParticles;
    if (n !== this.count || !this.states) this.allocate(renderer, n);
    const dt = Math.min(dtSec, 0.1);
    const life = cfg.noise.inkLifeSec;
    const u = this.updatePass.material.uniforms;
    u.uState.value = this.states![0].texture;
    u.uNoiseDb.value = noiseDb;
    u.uOcean.value = ocean;
    const band = { low: 0, mid: 1, high: 2 }[cfg.waves.band];
    (u.uBandSel.value as THREE.Vector3).set(band === 0 ? 1 : 0, band === 1 ? 1 : 0, band === 2 ? 1 : 0);
    u.uDt.value = dt;
    u.uTime.value = wallSec % 1000;
    u.uLife.value = life;
    u.uSpeed.value = 2.5; // degrés par seconde réelle [A]
    const img = noiseDb.image as { width: number; height: number };
    (u.uNoiseTexel.value as THREE.Vector2).set(1 / img.width, 1 / img.height);
    this.updatePass.render(renderer, this.states![1]);
    this.states = [this.states![1], this.states![0]];
    // Traînées : estompage (≈ 1,2 s) puis nouvelles positions.
    const f = this.fadePass.material.uniforms;
    f.uTrail.value = this.trails[0].texture;
    f.uKeep.value = Math.exp(-dt / 1.2);
    this.fadePass.render(renderer, this.trails[1]);
    this.trails = [this.trails[1], this.trails[0]];
    this.pointMat.uniforms.uState.value = this.states[0].texture;
    this.pointMat.uniforms.uLife.value = life;
    renderer.setRenderTarget(this.trails[0]);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.states?.forEach((t) => t.dispose());
    this.trails.forEach((t) => t.dispose());
    this.points?.geometry.dispose();
  }
}

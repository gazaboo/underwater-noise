/**
 * Lieux (data/lieux) : zones d'intérêt sonore (#2), plus tard focus régionaux (#15) et étapes de parcours (#4).
 * Un marqueur à taille fixe à l'écran, dessiné après la composition avec la projection exacte de chaque mode,
 * comme les silhouettes des cétacés : un anneau d'écoute d'où partent des ondes lentes, plus vives quand on
 * entend le lieu. Teinte ivoire, distincte du froid des cétacés et du chaud du bruit. Forme et mouvement [A].
 */
import * as THREE from 'three';
import { lieuIndex, type Config, type Lieu } from '@vacarme/shared';
import { dataUrl } from '../data-url.ts';
import { hexToVec3 } from '../render/fullscreen.ts';
import { PROJECTION_GLSL, projectionUniforms, setProjectionUniforms, type ScreenView } from '../render/screen-projection.ts';
import { distanceM } from '../whales/agents.ts';

const MAX = 64;

const VERT = /* glsl */ `
precision highp float;
precision highp int;
in vec2 corner;
in vec2 aGeo;     // lon, lat
in vec2 aInfo;    // écoute (0–1), graine
${PROJECTION_GLSL}
uniform float uSize;
out vec2 vQ;
out vec2 vInfo;
out float vAlpha;
void main() {
  float vis, inc;
  vec2 p = project(earth(aGeo.x, aGeo.y), aGeo.x, aGeo.y, vis, inc);
  float sizeP = uSize * uPxRatio / (0.5 * uResolution.y);
  vec2 q = (corner - 0.5) * 2.0;
  gl_Position = vis > 0.01 ? vec4((p.x + q.x * sizeP) * uResolution.y / uResolution.x, p.y + q.y * sizeP, 0.0, 1.0) : vec4(2.0, 2.0, 0.0, 1.0);
  vQ = q;
  vInfo = aInfo;
  vAlpha = vis;
}`;

const FRAG = /* glsl */ `
precision highp float;
precision highp int;
in vec2 vQ;
in vec2 vInfo;
in float vAlpha;
${PROJECTION_GLSL}
uniform vec3 uColor, uOutline;
uniform float uTime, uExposure, uGamma, uBlackLift;
out vec4 outColor;
float ring(float r, float c, float w) { float aa = fwidth(r) + 1e-4; return 1.0 - smoothstep(w - aa, w + aa, abs(r - c)); }
void main() {
  if (outsideDisc(gl_FragCoord.xy)) discard;
  float r = length(vQ);
  float listen = vInfo.x;
  float aa = fwidth(r) + 1e-4;
  float dot_ = 1.0 - smoothstep(0.16 - aa, 0.16 + aa, r);
  float core = max(ring(r, 0.36, 0.06), dot_);
  float rim = max(ring(r, 0.36, 0.13), 1.0 - smoothstep(0.24 - aa, 0.24 + aa, r));
  // Deux ondes qui s'éloignent ; plus vives quand le lieu est entendu.
  float wave = 0.0;
  for (int i = 0; i < 2; i++) {
    float ph = fract(uTime * (0.25 + 0.35 * listen) + vInfo.y + 0.5 * float(i));
    wave = max(wave, ring(r, 0.42 + 0.55 * ph, 0.035) * (1.0 - ph) * (0.45 + 0.55 * listen));
  }
  vec3 pc = uColor * wave;
  float a = wave;
  pc = uOutline * rim + pc * (1.0 - rim); a = rim + a * (1.0 - rim);
  pc = uColor * (1.0 + 0.4 * listen) * core + pc * (1.0 - core); a = core + a * (1.0 - core);
  vec3 c = pc / max(a, 1e-4);
  a *= vAlpha;
  if (a < 0.004) discard;
  c = pow(max(c * uExposure, 0.0), vec3(1.0 / uGamma));
  c = uBlackLift + (1.0 - uBlackLift) * c;
  outColor = vec4(c * a, a);
}`;

export class LieuLayer {
  lieux: Lieu[] = [];
  /** Écoute de chaque lieu (0–1), fixée par le moteur sonore. */
  readonly listening = new Map<string, number>();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly geo = new THREE.InstancedBufferGeometry();
  private readonly aGeo = new Float32Array(MAX * 2);
  private readonly aInfo = new Float32Array(MAX * 2);
  private readonly uniforms: Record<string, THREE.IUniform>;

  constructor() {
    this.geo.setAttribute('corner', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.geo.setAttribute('aGeo', new THREE.InstancedBufferAttribute(this.aGeo, 2));
    this.geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(this.aInfo, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.instanceCount = 0;
    this.uniforms = {
      ...projectionUniforms(),
      uSize: { value: 22 }, uTime: { value: 0 },
      uColor: { value: new THREE.Vector3() }, uOutline: { value: new THREE.Vector3() },
      uExposure: { value: 1 }, uGamma: { value: 1 }, uBlackLift: { value: 0 },
    };
    const mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const list = lieuIndex.parse(await fetch(dataUrl('lieux/liste.json')).then((r) => r.json()));
      const all = await Promise.all(list.lieux.map((id) => fetch(dataUrl(`lieux/${id}/lieu.json`)).then((r) => (r.ok ? (r.json() as Promise<Lieu>) : null)).catch(() => null)));
      this.lieux = all.filter((l): l is Lieu => !!l).slice(0, MAX);
    } catch {
      this.lieux = [];
    }
    this.lieux.forEach((l, i) => this.aGeo.set([l.center.lon, l.center.lat], 2 * i));
    (this.geo.getAttribute('aGeo') as THREE.BufferAttribute).needsUpdate = true;
    this.geo.instanceCount = this.lieux.length;
  }

  /** Lieu le plus proche d'un point, dans un rayon donné. */
  nearest(lat: number, lon: number, maxKm: number): Lieu | null {
    let best: Lieu | null = null;
    let bd = maxKm * 1000;
    for (const l of this.lieux) {
      const d = distanceM(lat, lon, l.center.lat, l.center.lon);
      if (d < bd) {
        bd = d;
        best = l;
      }
    }
    return best;
  }

  draw(renderer: THREE.WebGLRenderer, v: ScreenView, cfg: Config, wallSec: number): void {
    if (!cfg.lieux.enabled || !this.lieux.length) return;
    this.lieux.forEach((l, i) => this.aInfo.set([this.listening.get(l.id) ?? 0, (i * 0.37) % 1], 2 * i));
    (this.geo.getAttribute('aInfo') as THREE.BufferAttribute).needsUpdate = true;
    const u = this.uniforms;
    setProjectionUniforms(u, v, cfg);
    u.uSize.value = cfg.lieux.markerPx;
    u.uTime.value = wallSec;
    hexToVec3(cfg.lieux.color, u.uColor.value);
    hexToVec3(cfg.whales.glyphs.outline, u.uOutline.value);
    u.uExposure.value = cfg.render.exposure;
    u.uGamma.value = cfg.render.gamma;
    u.uBlackLift.value = cfg.render.blackLift;
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }
}

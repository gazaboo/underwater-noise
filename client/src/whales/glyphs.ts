/**
 * Glyphes des cétacés : un animal par espèce, à taille fixe à l'écran, dessiné après la composition avec la
 * projection exacte de chaque mode (carte, globe, demi-sphère…).
 *
 * Silhouettes peintes (défaut) : imposteurs rendus dans Blender, comme les vignettes du monde
 * (tools/ornaments/render_whales.py, data/ornaments/whales.png). La robe est celle de l'espèce, légèrement
 * teintée de sa couleur ; un liseré de cette couleur l'entoure (c'est lui qui relie l'animal à la légende et
 * aux fils), une ombre le détache de la mer, et à chaque appel le liseré s'élargit en halo.
 * Sans l'atlas (fichier absent, ou `whales.glyphs.sprites: false`) : silhouettes de profil en aplat, dessinées
 * par champ de distance signée (rendu d'origine).
 * Formes, tailles relatives et animation : artistiques [A] (hors d'échelle, comme les ornements du monde).
 */
import * as THREE from 'three';
import type { Config } from '@vacarme/shared';
import { hexToVec3 } from '../render/fullscreen.ts';
import { PROJECTION_GLSL, displayPxPerDeg, projectionUniforms, setProjectionUniforms, type ScreenView } from '../render/screen-projection.ts';
import { dataUrl } from '../data-url.ts';

const MAX_GLYPHS = 1024;

/** Indice de silhouette par espèce (les espèces inconnues prennent celle du rorqual bleu). */
export const GLYPH_SHAPES: Record<string, number> = { blue: 0, fin: 1, humpback: 2, sperm: 3, orca: 4 };

const VERT = /* glsl */ `
precision highp float;
precision highp int;
in vec2 corner;          // (0..1, 0..1)
in vec2 aGeo;            // lon, lat
in vec4 aInfo;           // silhouette, sens (±1), éclat de l'appel (0–1), graine
in vec3 aColor;
${PROJECTION_GLSL}
uniform float uSize, uTime, uGrowth, uAspect;
uniform float uScales[5];
uniform float uEdgeComp, uMaxGain, uEdgeSoft, uLimb;
out vec2 vQ;
out vec2 vUv;
flat out vec4 vInfo;
out vec3 vColor;
out float vAlpha;
out float vGain;
void main() {
  float vis, inc;
  vec2 p = project(earth(aGeo.x, aGeo.y), aGeo.x, aGeo.y, vis, inc);
  float pulse = aInfo.z;
  // Respiration lente (artistique) et léger grossissement à l'appel.
  float size = uSize * uGrowth * uScales[int(aInfo.x + 0.5)] * (1.0 + 0.22 * pulse) * (1.0 + 0.03 * sin(uTime * 0.9 + aInfo.w * 40.0));
  float sizeP = size * uPxRatio / (0.5 * uResolution.y);
  vec2 q = (corner - 0.5) * 2.0;
  vec2 offs = vec2(q.x, q.y * uAspect) * sizeP * 1.25;
  gl_Position = vis > 0.01 ? vec4((p.x + offs.x) * uResolution.y / uResolution.x, p.y + offs.y, 0.0, 1.0) : vec4(2.0, 2.0, 0.0, 1.0);
  vQ = vec2(q.x * aInfo.y, q.y * uAspect) * 1.25;
  vUv = corner;
  vInfo = aInfo;
  vColor = aColor;
  vAlpha = vis;
  vGain = 1.0;
  if (uMode == 2) vGain = mix(1.0, clamp(1.0 / max(inc, 0.02), 1.0, uMaxGain), uEdgeComp) * smoothstep(0.0, uEdgeSoft + 1e-4, inc);
  if (uMode == 1) vGain = mix(1.0 - uLimb, 1.0, sqrt(max(inc, 0.0)));
}`;

const FRAG = /* glsl */ `
precision highp float;
precision highp int;
in vec2 vQ;
in vec2 vUv;
flat in vec4 vInfo;
in vec3 vColor;
in float vAlpha;
in float vGain;
${PROJECTION_GLSL}
uniform vec3 uOutline;
uniform float uExposure, uGamma, uBlackLift;
uniform sampler2D uAtlas;
uniform float uSprites, uTint, uAura, uShadow;
out vec4 outColor;

// Case de l'atlas (quatre colonnes, cinq lignes) ; « local » dans [0, 1]², y vers le haut.
vec4 cell(vec2 local, float col, float row) {
  // Biais de −0,75 niveau : à petite taille, on lit une version un peu plus fine de l'image, pour garder le trait.
  return texture(uAtlas, vec2((col + clamp(local.x, 0.003, 0.997)) / 4.0, (row + 1.0 - clamp(local.y, 0.006, 0.994)) / 5.0), -0.75);
}

float sdEllipse(vec2 p, vec2 c, vec2 r) { vec2 q = (p - c) / r; return (length(q) - 1.0) * min(r.x, r.y); }
float sdTri(vec2 p, vec2 a, vec2 b, vec2 c) {
  vec2 e0 = b - a, e1 = c - b, e2 = a - c;
  vec2 v0 = p - a, v1 = p - b, v2 = p - c;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                   vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                   vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
float sdBox(vec2 p, vec2 c, vec2 h, float r) { vec2 d = abs(p - c) - h + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

// Nageoire caudale : deux lobes à l'extrémité de la queue (x = tx).
float flukes(vec2 p, float tx, float s) {
  return min(sdTri(p, vec2(tx + 0.1 * s, 0.0), vec2(tx - 0.08 * s, 0.17 * s), vec2(tx - 0.02 * s, 0.0)),
             sdTri(p, vec2(tx + 0.1 * s, 0.0), vec2(tx - 0.02 * s, 0.0), vec2(tx - 0.08 * s, -0.17 * s)));
}

// Silhouettes de profil, tête vers +x. Proportions d'après les espèces, simplifiées.
float whale(vec2 p, int shape) {
  if (shape == 0) { // rorqual bleu : long et fin, petite dorsale très en arrière
    float d = sdEllipse(p, vec2(0.08, 0.0), vec2(0.8, 0.155));
    d = smin(d, sdEllipse(p, vec2(-0.62, 0.0), vec2(0.3, 0.065)), 0.05);
    d = min(d, flukes(p, -0.86, 1.0));
    return min(d, sdTri(p, vec2(-0.52, 0.1), vec2(-0.42, 0.1), vec2(-0.55, 0.19)));
  }
  if (shape == 1) { // rorqual commun : fin, dorsale plus haute
    float d = sdEllipse(p, vec2(0.05, 0.0), vec2(0.74, 0.16));
    d = smin(d, sdEllipse(p, vec2(-0.6, 0.0), vec2(0.28, 0.065)), 0.05);
    d = min(d, flukes(p, -0.82, 1.0));
    return min(d, sdTri(p, vec2(-0.38, 0.11), vec2(-0.22, 0.11), vec2(-0.42, 0.27)));
  }
  if (shape == 2) { // baleine à bosse : trapue, très longues pectorales, bosse dorsale
    float d = sdEllipse(p, vec2(0.05, 0.0), vec2(0.62, 0.2));
    d = smin(d, sdEllipse(p, vec2(-0.5, 0.0), vec2(0.26, 0.075)), 0.06);
    d = min(d, flukes(p, -0.72, 1.25));
    d = min(d, sdTri(p, vec2(0.3, -0.06), vec2(0.38, -0.1), vec2(-0.12, -0.44)));
    return smin(d, sdEllipse(p, vec2(-0.22, 0.15), vec2(0.07, 0.04)), 0.03);
  }
  if (shape == 3) { // cachalot : tête carrée massive, corps qui s'affine
    float d = sdBox(p, vec2(0.36, 0.01), vec2(0.36, 0.2), 0.1);
    d = smin(d, sdEllipse(p, vec2(-0.2, -0.01), vec2(0.55, 0.17)), 0.08);
    d = smin(d, sdEllipse(p, vec2(-0.62, 0.0), vec2(0.22, 0.05)), 0.05);
    return min(d, flukes(p, -0.82, 1.0));
  }
  // orque : corps compact, très haute dorsale
  float d = sdEllipse(p, vec2(0.05, 0.0), vec2(0.62, 0.21));
  d = smin(d, sdEllipse(p, vec2(-0.5, 0.0), vec2(0.25, 0.075)), 0.06);
  d = min(d, flukes(p, -0.72, 1.1));
  return min(d, sdTri(p, vec2(-0.08, 0.13), vec2(0.1, 0.13), vec2(-0.06, 0.55)));
}

void main() {
  if (outsideDisc(gl_FragCoord.xy)) discard;
  int shape = int(vInfo.x + 0.5);
  float pulse = vInfo.z;
  if (uSprites > 0.5) {
    // Silhouette peinte : colonne selon le sens (la lumière vient toujours de la gauche), ligne selon l'espèce.
    float col = vInfo.y > 0.0 ? 0.0 : 2.0;
    float row = float(shape);
    vec4 spr = cell(vUv, col, row);                 // couleur prémultipliée
    float m = cell(vUv, col + 1.0, row).r;          // silhouette élargie et adoucie
    // Ombre portée en bas à droite, comme celles des vignettes : le masque, décalé.
    vec2 so = vUv + vec2(-0.03, 0.075);
    float sh = smoothstep(0.35, 0.9, cell(so, col + 1.0, row).r) * step(0.0, so.x) * step(so.y, 1.0);
    // Robe teintée de la couleur de l'espèce (la luminance garde le modelé), plus claire à l'appel.
    float lum = dot(spr.rgb, vec3(0.3, 0.59, 0.11));
    vec3 body = mix(spr.rgb, vColor * lum * 1.6, uTint) * (1.0 + 0.45 * pulse);
    // Liseré de la couleur de l'espèce, qui s'élargit en halo à l'appel.
    float glow = clamp(max(smoothstep(0.22, 0.6, m) * uAura, m * pulse), 0.0, 1.0);
    vec3 pc = vec3(0.0);
    float a = sh * uShadow;
    pc = vColor * (0.92 + 0.4 * pulse) * glow + pc * (1.0 - glow); a = glow + a * (1.0 - glow);
    pc = body + pc * (1.0 - spr.a); a = spr.a + a * (1.0 - spr.a);
    vec3 c = pc / max(a, 1e-4);
    a *= vAlpha;
    if (a < 0.004) discard;
    c *= vGain * uExposure;
    c = pow(max(c, 0.0), vec3(1.0 / uGamma));
    c = uBlackLift + (1.0 - uBlackLift) * c;
    outColor = vec4(c * a, a);
    return;
  }
  float d = whale(vQ, shape);
  float aa = fwidth(d) * 0.8 + 1e-4;
  float body = 1.0 - smoothstep(-aa, aa, d);
  float rim = 1.0 - smoothstep(-aa, aa, d - 0.07);       // liseré sombre autour de la silhouette
  float halo = exp(-max(d, 0.0) / 0.12) * pulse * 0.65;  // halo de l'appel
  vec3 fill = vColor * (0.85 + 0.6 * pulse);
  // Orque : dos et dorsale sombres, ventre et tache derrière l'œil clairs (repère de l'espèce).
  if (shape == 4) {
    float back = smoothstep(-0.02, 0.03, vQ.y + 0.04 * sin(vQ.x * 6.0));
    float patch_ = 1.0 - smoothstep(-aa, aa, sdEllipse(vQ, vec2(0.3, 0.06), vec2(0.1, 0.035)));
    fill = mix(fill, fill * 0.22, back * (1.0 - patch_));
  }
  // Superposition (prémultipliée) : halo, puis liseré, puis corps.
  vec3 pc = vColor * halo;
  float a = halo;
  pc = uOutline * rim + pc * (1.0 - rim); a = rim + a * (1.0 - rim);
  pc = fill * body + pc * (1.0 - body); a = body + a * (1.0 - body);
  vec3 c = pc / max(a, 1e-4);
  a *= vAlpha;
  if (a < 0.004) discard;
  c *= vGain * uExposure;
  c = pow(max(c, 0.0), vec3(1.0 / uGamma));
  c = uBlackLift + (1.0 - uBlackLift) * c;
  outColor = vec4(c * a, a);
}`;

export interface GlyphDraw {
  lon: number;
  lat: number;
  shape: number;
  /** +1 : tête à l'est ; −1 : à l'ouest. */
  facing: number;
  pulse: number;
  seed: number;
  color: THREE.Vector3;
}

export class WhaleGlyphs {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly geo = new THREE.InstancedBufferGeometry();
  private readonly aGeo = new Float32Array(MAX_GLYPHS * 2);
  private readonly aInfo = new Float32Array(MAX_GLYPHS * 4);
  private readonly aColor = new Float32Array(MAX_GLYPHS * 3);
  private readonly uniforms: Record<string, THREE.IUniform>;
  /** Vrai quand l'atlas des silhouettes peintes est chargé. */
  private atlas = false;

  constructor() {
    this.geo.setAttribute('corner', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.geo.setAttribute('aGeo', new THREE.InstancedBufferAttribute(this.aGeo, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(this.aInfo, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(this.aColor, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.instanceCount = 0;
    this.uniforms = {
      ...projectionUniforms(),
      uSize: { value: 18 }, uTime: { value: 0 }, uGrowth: { value: 1 }, uAspect: { value: 0.58 },
      uScales: { value: [1, 1, 1, 1, 1] },
      uAtlas: { value: null }, uSprites: { value: 0 }, uTint: { value: 0 }, uAura: { value: 0 }, uShadow: { value: 0 },
      uEdgeComp: { value: 0 }, uMaxGain: { value: 1 }, uEdgeSoft: { value: 0.05 }, uLimb: { value: 0 },
      uOutline: { value: new THREE.Vector3() },
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
    void this.loadAtlas();
  }

  /** Atlas facultatif : sans lui, les silhouettes en aplat restent le rendu. */
  private async loadAtlas(): Promise<void> {
    try {
      const [meta, image] = await Promise.all([
        fetch(dataUrl('ornaments/whales.json')).then((r) => { if (!r.ok) throw new Error(`whales.json : HTTP ${r.status}`); return r.json() as Promise<{ species: Record<string, { row: number; scale: number }> }>; }),
        fetch(dataUrl('ornaments/whales.png')).then(async (r) => {
          if (!r.ok) throw new Error(`whales.png : HTTP ${r.status}`);
          // Les couleurs sont déjà prémultipliées dans le fichier (tools/ornaments/pack_whales.py).
          return createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none' });
        }),
      ]);
      const tex = new THREE.Texture(image as unknown as HTMLImageElement);
      tex.flipY = false;
      tex.premultiplyAlpha = false;
      tex.colorSpace = THREE.NoColorSpace;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
      const scales = [1, 1, 1, 1, 1];
      for (const [id, s] of Object.entries(meta.species)) {
        if (GLYPH_SHAPES[id] !== s.row) throw new Error(`whales.json : ligne inattendue pour ${id}`);
        scales[s.row] = s.scale;
      }
      this.uniforms.uAtlas.value = tex;
      this.uniforms.uScales.value = scales;
      this.atlas = true;
    } catch (e) {
      console.warn('[cétacés] silhouettes peintes indisponibles, silhouettes en aplat :', e);
    }
  }

  set(glyphs: GlyphDraw[]): void {
    const n = Math.min(glyphs.length, MAX_GLYPHS);
    for (let i = 0; i < n; i++) {
      const g = glyphs[i];
      this.aGeo.set([g.lon, g.lat], 2 * i);
      this.aInfo.set([g.shape, g.facing, g.pulse, g.seed], 4 * i);
      this.aColor.set([g.color.x, g.color.y, g.color.z], 3 * i);
    }
    for (const name of ['aGeo', 'aInfo', 'aColor']) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    this.geo.instanceCount = n;
  }

  draw(renderer: THREE.WebGLRenderer, v: ScreenView, cfg: Config, wallSec: number): void {
    const u = this.uniforms;
    setProjectionUniforms(u, v, cfg);
    const g = cfg.whales.glyphs;
    const sprites = this.atlas && g.sprites;
    u.uSprites.value = sprites ? 1 : 0;
    u.uAspect.value = sprites ? 0.5 : 0.58;
    u.uTint.value = g.tint;
    u.uAura.value = g.aura;
    u.uShadow.value = g.shadow;
    u.uSize.value = g.size;
    // Les silhouettes grandissent un peu en vue rapprochée (×2 au plus).
    u.uGrowth.value = Math.min(2, Math.max(1, Math.sqrt(displayPxPerDeg(v, cfg) / cfg.whales.lod.closePxPerDeg)));
    u.uTime.value = wallSec;
    const h = cfg.hemisphere;
    u.uEdgeComp.value = h.edgeCompensation;
    u.uMaxGain.value = h.maxGain;
    u.uEdgeSoft.value = h.edgeSoftness;
    u.uLimb.value = cfg.globe.limbShading;
    hexToVec3(cfg.whales.glyphs.outline, u.uOutline.value);
    u.uExposure.value = cfg.render.exposure;
    u.uGamma.value = cfg.render.gamma;
    u.uBlackLift.value = cfg.render.blackLift;
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }
}

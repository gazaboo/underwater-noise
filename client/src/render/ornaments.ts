/**
 * Ornements du monde illustré : vignettes (imposteurs rendus dans Blender) posées sur la Terre et
 * dessinées à l'écran, après la composition, avec la projection exacte de chaque mode : carte plate,
 * globe, demi-sphère (caméra du projecteur), équirectangulaire, fisheye. Elles restent donc nettes
 * (dessinées à la résolution de l'écran, pas dans la texture monde) et visibles sur la demi-sphère.
 *
 * Positions : volcans du Smithsonian GVP et sommets d'ETOPO (sourcés) ; forêts, prairies, déserts selon
 * les milieux illustrés (interprétation artistique de Natural Earth II), semis de bruit bleu en niveaux
 * de détail emboîtés (tools/build_illustrated.py). Tailles, densités, fumées, nuages : artistiques,
 * hors d'échelle comme dans un livre illustré.
 */
import * as THREE from 'three';
import type { Config } from '@vacarme/shared';
import type { AtlasData, OrnamentData } from '../assets.ts';
import type { FlatTransform } from './flat-view.ts';
import type { GlobeCamera, GlobeMode } from './globe-view.ts';
import { hexToVec3 } from './fullscreen.ts';

const DEG = Math.PI / 180;
/** Pixels CSS par degré d'une Terre de 1000 px de diamètre (référence de `ornaments.size`). */
const REF_PX_PER_DEG = 500 * DEG;

/** Taille relative de chaque catégorie (artistique : hors d'échelle, montagnes et volcans en vedette). */
const CATEGORY_SIZE: Record<string, number> = {
  forest_tropical: 1.0, forest_temperate: 0.95, forest_boreal: 0.95, savanna: 0.8, meadow: 1.1,
  desert: 0.7, tundra: 0.75, mountain_snow: 1.5, mountain_rock: 1.35, mesa: 1.3, volcano: 1.15, smoke: 0.9, cloud: 2.4,
};
const VEGETATION = new Set(['forest_tropical', 'forest_temperate', 'forest_boreal', 'savanna', 'meadow', 'desert', 'tundra']);
const MOUNTAINS = new Set(['mountain_snow', 'mountain_rock', 'mesa']);

const KIND_GROUND = 0;
const KIND_SMOKE = 1;
const KIND_CLOUD = 2;
const MAX_CLOUDS = 200;
const PUFFS = 3;

const VERT = /* glsl */ `
precision highp float;
precision highp int;
in vec2 corner;          // (0..1, 0..1) : gauche → droite, bas → haut
in vec2 aGeo;            // lon, lat (degrés)
in vec4 aSprite;         // index dans l'atlas, ancrage vertical, taille relative, espacement du niveau (°)
in vec4 aMeta;           // genre, groupe (0 végétation, 1 montagne, 2 volcan), graine, année d'éruption
uniform int uMode;       // 0 carte, 1 globe, 2 demi-sphère, 3 équirect, 4 fisheye
uniform vec2 uResolution;
uniform float uPxRatio;
// Carte plate
uniform vec2 uCenter, uLatRange;
uniform float uFlatScale;
// Globe / demi-sphère / fisheye
uniform mat3 uMt;        // Terre → vue (transposée de M)
uniform float uDist, uTanHalf, uGScale, uRoll, uFishHalf;
uniform vec2 uShift;
uniform int uFishModel;
uniform float uRp;       // rayon de la Terre à l'écran (unités p)
// Apparence
uniform float uPxPerDeg, uSize, uGrowth, uDensity, uTime;
uniform vec3 uShow;      // végétation, montagnes, volcans
uniform float uSmokeSince, uSmokeOn, uCloudCount, uCloudSpeed, uCloudOpacity, uShadowPass;
uniform float uCols;
uniform float uEdgeComp, uMaxGain, uEdgeSoft, uLimb;
out vec2 vUv;
out float vAlpha;
out float vGain;
out float vKind;

const float PI = 3.141592653589793;

vec3 earth(float lonDeg, float latDeg) {
  float lo = radians(lonDeg), la = radians(latDeg);
  return vec3(cos(la) * sin(lo), sin(la), cos(la) * cos(lo));
}

// Projection d'un point de la Terre dans l'espace p (y ∈ [−1, 1] sur la hauteur de l'image).
// vis : 0 si caché ; inc : cosinus d'incidence (globe / demi-sphère).
vec2 project(vec3 e, float lonDeg, float latDeg, out float vis, out float inc) {
  vis = 1.0; inc = 1.0;
  if (uMode == 0) {
    float dl = mod(lonDeg - uCenter.x + 180.0, 360.0) - 180.0;
    if (latDeg < uLatRange.x || latDeg > uLatRange.y) vis = 0.0;
    return vec2(dl, latDeg - uCenter.y) * uFlatScale / (0.5 * uResolution.y);
  }
  if (uMode == 3) {
    float a = uResolution.x / uResolution.y;
    vec2 frame = a >= 2.0 ? vec2(2.0, 1.0) : vec2(a, 0.5 * a);
    return vec2(lonDeg / 180.0, latDeg / 90.0) * frame;
  }
  vec3 n = uMt * e;
  if (uMode == 4) {
    float th = acos(clamp(n.z, -1.0, 1.0));
    float r = uFishModel == 0 ? th / uFishHalf : sin(th * 0.5) / sin(uFishHalf * 0.5);
    vis = 1.0 - smoothstep(0.97, 1.0, r);
    vec2 d = length(n.xy) > 1e-6 ? normalize(n.xy) : vec2(0.0);
    return d * r;
  }
  vec3 ro = vec3(0.0, 0.0, uDist);
  vec3 d = n - ro;
  inc = dot(normalize(ro - n), n);
  vis = smoothstep(0.05, 0.3, inc); // effacées avant le bord du disque (pas de hérisson au limbe)
  vec2 s = d.xy / (-d.z * uTanHalf);
  float c = cos(radians(uRoll)), sn = sin(radians(uRoll));
  s = vec2(c * s.x + sn * s.y, -sn * s.x + c * s.y); // rotation inverse de celle du rayon
  return s * uGScale + uShift;
}

void main() {
  float kind = aMeta.x;
  float lon = aGeo.x, lat = aGeo.y;
  float size = uSize * aSprite.z;
  float alpha = 1.0;
  float lift = 0.0; // décalage vertical (pixels CSS) : fumée et nuages flottent
  float group = aMeta.y;
  if (kind < 0.5) {
    alpha *= group < 0.5 ? uShow.x : group < 1.5 ? uShow.y : uShow.z;
  } else if (kind < 1.5) {
    // Fumée : trois bouffées qui montent, grossissent et s'effacent (volcans à éruption récente).
    float phase = fract(uTime * 0.045 + aMeta.z);
    alpha *= uShow.z * uSmokeOn * step(uSmokeSince, aMeta.w) * smoothstep(0.0, 0.15, phase) * (1.0 - smoothstep(0.55, 1.0, phase)) * 0.85;
    lift = size * (0.75 + 1.4 * phase);
    size *= 0.55 + 0.75 * phase;
    lon += sin(phase * 4.0 + aMeta.z * 20.0) * 0.4;
  } else {
    // Nuages : dérive vers l'est, à des vitesses différentes ; l'ombre reste au sol.
    alpha *= step(aMeta.w, uCloudCount - 0.5) * uCloudOpacity;
    lon = mod(lon + uTime * uCloudSpeed * (0.05 + 0.05 * aMeta.z) + 180.0, 360.0) - 180.0;
    lift = uShadowPass > 0.5 ? 0.0 : size * 0.45;
  }
  vec3 e = earth(lon, lat);
  float vis, inc;
  vec2 p = project(e, lon, lat, vis, inc);
  // Nuages et fumées flottent : effacés avant le limbe, pour ne pas dépasser du disque.
  if (kind > 0.5 && (uMode == 1 || uMode == 2)) vis *= smoothstep(0.3, 0.55, inc);

  // Niveau de détail : un niveau apparaît quand son espacement à l'écran dépasse la taille des vignettes.
  float growth = pow(max(uPxPerDeg / ${REF_PX_PER_DEG.toFixed(6)}, 0.05), uGrowth);
  float sizeCss = size * growth;
  // Seuil propre à chaque vignette : un niveau apparaît progressivement, pas d'un seul coup.
  float room = aSprite.w * uPxPerDeg * uDensity / max(uSize * growth, 1.0) * (0.65 + 0.7 * fract(aMeta.z * 7.31));
  float lod = kind > 1.5 ? 1.0 : smoothstep(0.55, 0.8, room);
  alpha *= vis * lod;
  sizeCss *= mix(0.35, 1.0, lod);

  // Verticale de la vignette : droite à l'écran au centre, le long du rayon près du bord du disque.
  vec2 up = vec2(0.0, 1.0);
  if (uMode == 1 || uMode == 2) {
    float v2, i2;
    vec2 p2 = project(e * 1.02, lon, lat, v2, i2);
    vec2 radial = p2 - p;
    float k = clamp(length(radial) / (0.02 * uRp), 0.0, 1.0);
    if (length(radial) > 1e-6) up = normalize(mix(up, normalize(radial), 0.7 * k * k));
  } else if (uMode == 4) {
    float r = length(p);
    if (r > 1e-4) up = normalize(mix(up, p / r, r * r));
  }
  vec2 right = vec2(up.y, -up.x);
  float sizeP = sizeCss * uPxRatio / (0.5 * uResolution.y);
  float liftP = lift * growth * uPxRatio / (0.5 * uResolution.y);
  vec2 offs = right * (corner.x - 0.5) * sizeP + up * ((corner.y - aSprite.y) * sizeP + liftP);
  if (uShadowPass > 0.5) offs = right * (corner.x - 0.5) * sizeP * 0.9 + up * (corner.y - 0.5) * sizeP * 0.35 + vec2(0.25, -0.12) * sizeP;
  vec2 q = p + offs;
  gl_Position = alpha > 0.002 ? vec4(q.x * uResolution.y / uResolution.x, q.y, 0.0, 1.0) : vec4(2.0, 2.0, 0.0, 1.0);

  float idx = aSprite.x;
  float col = mod(idx, uCols), row = floor(idx / uCols);
  vUv = vec2((col + corner.x) / uCols, (row + 1.0 - corner.y) / uCols);
  vAlpha = alpha;
  vKind = uShadowPass > 0.5 ? 3.0 : kind;
  // Demi-sphère : même compensation de luminosité que la passe de projection (au point d'ancrage).
  vGain = 1.0;
  if (uMode == 2) vGain = mix(1.0, clamp(1.0 / max(inc, 0.02), 1.0, uMaxGain), uEdgeComp) * smoothstep(0.0, uEdgeSoft + 1e-4, inc);
  if (uMode == 1) vGain = mix(1.0 - uLimb, 1.0, sqrt(max(inc, 0.0)));
}`;

const FRAG = /* glsl */ `
precision highp float;
precision highp int;
in vec2 vUv;
in float vAlpha;
in float vGain;
in float vKind;
uniform sampler2D uAtlas;
uniform int uMode;
uniform vec2 uResolution;
uniform float uDist, uTanHalf, uGScale, uRoll;
uniform vec2 uShift;
uniform vec3 uTint;
uniform float uExposure, uGamma, uBlackLift, uVignette;
uniform float uFinishVignette;
out vec4 outColor;

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 p = (frag - 0.5 * uResolution) / (0.5 * uResolution.y);
  // Demi-sphère : rien hors du disque (le mur ne doit rien recevoir) ; fisheye : idem hors du cercle.
  if (uMode == 2) {
    vec2 s = (p - uShift) / uGScale;
    float c = cos(radians(uRoll)), sn = sin(radians(uRoll));
    s = mat2(c, sn, -sn, c) * s;
    vec3 ro = vec3(0.0, 0.0, uDist);
    vec3 rd = normalize(vec3(s * uTanHalf, -1.0));
    float b = dot(ro, rd);
    if (b * b - (dot(ro, ro) - 1.0) <= 0.0) discard;
  }
  if (uMode == 4 && length(p) > 1.0) discard;

  vec4 t = texture(uAtlas, vUv); // prémultiplié
  float a = t.a * vAlpha;
  if (a < 0.004) discard;
  vec3 c = t.rgb / max(t.a, 1e-4);
  // Lueur des cratères préservée la nuit (orangé saturé), le reste prend la teinte du thème.
  float glow = smoothstep(0.35, 0.6, c.r - c.b) * step(0.6, c.r) * step(c.g, 0.75);
  c = mix(c * uTint, c, glow);
  c *= vGain;
  if (uFinishVignette > 0.5) {
    vec2 qv = frag / uResolution - 0.5;
    qv.x *= uResolution.x / uResolution.y;
    c *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(qv) * 1.2);
  }
  c *= uExposure;
  c = pow(max(c, 0.0), vec3(1.0 / uGamma));
  c = uBlackLift + (1.0 - uBlackLift) * c;
  outColor = vec4(c * a, a);
}`;

/**
 * Jumeau TypeScript de `project()` du vertex shader (mêmes formules) : point géographique → espace p
 * (y ∈ [−1, 1] sur la hauteur de l'image), ou null s'il est caché. Sert aux tests (aller-retour avec
 * pixelToGeo) ; garder les deux versions identiques.
 */
export function projectGeo(mode: GlobeMode, cam: GlobeCamera, M: THREE.Matrix3, cfg: Config, lonDeg: number, latDeg: number, aspect: number): [number, number] | null {
  if (mode === 'equirect') {
    const frame = aspect >= 2 ? [2, 1] : [aspect, 0.5 * aspect];
    return [(lonDeg / 180) * frame[0], (latDeg / 90) * frame[1]];
  }
  const lo = lonDeg * DEG, la = latDeg * DEG;
  const e = new THREE.Vector3(Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo));
  const n = e.applyMatrix3(M.clone().transpose());
  if (mode === 'fisheye') {
    const half = (cfg.fisheye.fovDeg * DEG) / 2;
    const th = Math.acos(Math.max(-1, Math.min(1, n.z)));
    const r = cfg.fisheye.model === 'equidistant' ? th / half : Math.sin(th / 2) / Math.sin(half / 2);
    if (r > 1) return null;
    const l = Math.hypot(n.x, n.y);
    return l > 1e-9 ? [(n.x / l) * r, (n.y / l) * r] : [0, 0];
  }
  if (n.z * cam.dist <= 1) return null; // face cachée
  const d = new THREE.Vector3(n.x, n.y, n.z - cam.dist);
  let sx = d.x / (-d.z * cam.tanHalf);
  let sy = d.y / (-d.z * cam.tanHalf);
  const c = Math.cos(cam.rollDeg * DEG), s = Math.sin(cam.rollDeg * DEG);
  [sx, sy] = [c * sx + s * sy, -s * sx + c * sy];
  return [sx * cam.scale + cam.shift[0], sy * cam.scale + cam.shift[1]];
}

export interface OrnamentView {
  mode: 'flat' | GlobeMode;
  width: number;
  height: number;
  pixelRatio: number;
  flat?: FlatTransform;
  cam?: GlobeCamera;
  M?: THREE.Matrix3;
}

export class OrnamentLayer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly cloudShadowScene = new THREE.Scene();
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly texture: THREE.Texture;
  readonly count: number;

  constructor(data: OrnamentData, atlas: AtlasData, image: ImageBitmap) {
    const tex = new THREE.Texture(image as unknown as HTMLImageElement);
    tex.flipY = false;
    tex.premultiplyAlpha = false; // déjà prémultiplié par createImageBitmap
    tex.colorSpace = THREE.NoColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    this.texture = tex;

    const cellsOf = (cat: string) => atlas.categories[cat] ?? [];
    const pivotOf = (i: number) => atlas.sprites[i].pivot[1];

    // Sol : tri du nord au sud (les vignettes du sud, plus proches du regard, passent devant).
    const ground: number[][] = [];
    const smoke: number[][] = [];
    for (const o of data.ornaments) {
      const [lon, lat, catIndex, level, seed, scale, year] = o;
      const cat = data.categories[catIndex];
      const cells = cellsOf(cat);
      if (!cells.length) continue;
      const cell = cells[seed % cells.length];
      const spacing = data.spacing[cat]?.[level] ?? 1;
      const group = VEGETATION.has(cat) ? 0 : MOUNTAINS.has(cat) ? 1 : 2;
      const size = (CATEGORY_SIZE[cat] ?? 1) * scale;
      ground.push([lon, lat, cell, pivotOf(cell), size, spacing, KIND_GROUND, group, seed / 256, 0]);
      if (cat === 'volcano' && year !== null) {
        const puffs = cellsOf('smoke');
        for (let k = 0; k < PUFFS && puffs.length; k++) {
          const pc = puffs[(seed + k) % puffs.length];
          smoke.push([lon, lat, pc, 0.5, size * CATEGORY_SIZE.smoke / CATEGORY_SIZE.volcano, spacing, KIND_SMOKE, 2, (k / PUFFS + seed / 997) % 1, year]);
        }
      }
    }
    ground.sort((a, b) => b[1] - a[1]);

    // Nuages : positions tirées une fois (graine fixe), latitudes tempérées et tropicales surtout.
    const clouds: number[][] = [];
    const cloudCells = cellsOf('cloud');
    let s = 12345;
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < MAX_CLOUDS && cloudCells.length; i++) {
      const lat = (rand() * 2 - 1) * 62 + 8 * Math.sin(i);
      clouds.push([rand() * 360 - 180, lat, cloudCells[i % cloudCells.length], 0.5, CATEGORY_SIZE.cloud * (0.7 + 0.5 * rand()), 1, KIND_CLOUD, 3, rand(), i]);
    }

    this.uniforms = {
      uAtlas: { value: tex }, uMode: { value: 0 }, uResolution: { value: new THREE.Vector2() }, uPxRatio: { value: 1 },
      uCenter: { value: new THREE.Vector2() }, uLatRange: { value: new THREE.Vector2(-90, 90) }, uFlatScale: { value: 1 },
      uMt: { value: new THREE.Matrix3() }, uDist: { value: 4.5 }, uTanHalf: { value: 0.3 }, uGScale: { value: 1 }, uRoll: { value: 0 },
      uShift: { value: new THREE.Vector2() }, uFishHalf: { value: Math.PI / 2 }, uFishModel: { value: 0 }, uRp: { value: 0.5 },
      uPxPerDeg: { value: REF_PX_PER_DEG }, uSize: { value: 30 }, uGrowth: { value: 0.4 }, uDensity: { value: 1 }, uTime: { value: 0 },
      uShow: { value: new THREE.Vector3(1, 1, 1) }, uSmokeSince: { value: 1950 }, uSmokeOn: { value: 1 },
      uCloudCount: { value: 0 }, uCloudSpeed: { value: 1 }, uCloudOpacity: { value: 1 }, uShadowPass: { value: 0 },
      uCols: { value: atlas.cols },
      uEdgeComp: { value: 0 }, uMaxGain: { value: 1 }, uEdgeSoft: { value: 0.05 }, uLimb: { value: 0 },
      uTint: { value: new THREE.Vector3(1, 1, 1) },
      uExposure: { value: 1 }, uGamma: { value: 1 }, uBlackLift: { value: 0 }, uVignette: { value: 0 }, uFinishVignette: { value: 0 },
    };
    const material = (shadow: boolean) => {
      const m = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: VERT,
        fragmentShader: shadow ? SHADOW_FRAG : FRAG,
        uniforms: shadow ? { ...this.uniforms, uShadowPass: { value: 1 } } : this.uniforms,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      });
      return m;
    };
    const layer = (rows: number[][], mat: THREE.RawShaderMaterial, scene: THREE.Scene) => {
      if (!rows.length) return;
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('corner', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      const geo = new Float32Array(rows.length * 2);
      const sprite = new Float32Array(rows.length * 4);
      const meta = new Float32Array(rows.length * 4);
      rows.forEach((r, i) => {
        geo.set([r[0], r[1]], i * 2);
        sprite.set([r[2], r[3], r[4], r[5]], i * 4);
        meta.set([r[6], r[7], r[8], r[9]], i * 4);
      });
      g.setAttribute('aGeo', new THREE.InstancedBufferAttribute(geo, 2));
      g.setAttribute('aSprite', new THREE.InstancedBufferAttribute(sprite, 4));
      g.setAttribute('aMeta', new THREE.InstancedBufferAttribute(meta, 4));
      g.instanceCount = rows.length;
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      scene.add(mesh);
    };
    const main = material(false);
    layer(ground, main, this.scene);
    layer(smoke, main, this.scene);
    layer(clouds, material(true), this.cloudShadowScene);
    layer(clouds, main, this.cloudShadowScene);
    this.count = ground.length;
  }

  /** Pixels CSS par degré à l'affichage (au centre de la vue). */
  static pxPerDeg(v: OrnamentView, cfg: Config): number {
    const halfH = 0.5 * v.height / v.pixelRatio;
    if (v.mode === 'flat') return (v.flat?.scale ?? 1) / v.pixelRatio;
    if (v.mode === 'equirect') {
      const a = v.width / v.height;
      return (a >= 2 ? 2 : a) * v.height / v.pixelRatio / 360;
    }
    if (v.mode === 'fisheye') return halfH / (cfg.fisheye.fovDeg / 2);
    const cam = v.cam!;
    const rp = cam.scale * Math.tan(Math.asin(1 / cam.dist)) / cam.tanHalf;
    return rp * halfH * DEG;
  }

  draw(renderer: THREE.WebGLRenderer, v: OrnamentView, cfg: Config, time: number): void {
    const l = cfg.land;
    const o = l.ornaments;
    if (l.style !== 'illustre' || !o.enabled) return;
    const u = this.uniforms;
    const modeIndex = { flat: 0, globe: 1, hemisphere: 2, equirect: 3, fisheye: 4 }[v.mode];
    u.uMode.value = modeIndex;
    (u.uResolution.value as THREE.Vector2).set(v.width, v.height);
    u.uPxRatio.value = v.pixelRatio;
    const ppd = OrnamentLayer.pxPerDeg(v, cfg);
    u.uPxPerDeg.value = ppd;
    if (v.flat) {
      (u.uCenter.value as THREE.Vector2).set(v.flat.centerLon, v.flat.centerLat);
      (u.uLatRange.value as THREE.Vector2).set(v.flat.latMin, v.flat.latMax);
      u.uFlatScale.value = v.flat.scale;
    }
    if (v.M) (u.uMt.value as THREE.Matrix3).copy(v.M).transpose();
    if (v.cam) {
      u.uDist.value = v.cam.dist;
      u.uTanHalf.value = v.cam.tanHalf;
      u.uGScale.value = v.cam.scale;
      u.uRoll.value = v.cam.rollDeg;
      (u.uShift.value as THREE.Vector2).set(v.cam.shift[0], v.cam.shift[1]);
      u.uRp.value = v.cam.scale * Math.tan(Math.asin(1 / v.cam.dist)) / v.cam.tanHalf;
    }
    if (v.mode === 'fisheye') u.uRp.value = 1;
    u.uFishHalf.value = (cfg.fisheye.fovDeg * DEG) / 2;
    u.uFishModel.value = cfg.fisheye.model === 'equidistant' ? 0 : 1;
    u.uSize.value = o.size;
    u.uGrowth.value = o.growth;
    u.uDensity.value = o.density;
    u.uTime.value = time;
    (u.uShow.value as THREE.Vector3).set(o.vegetation ? 1 : 0, o.mountains ? 1 : 0, o.volcanoes ? 1 : 0);
    u.uSmokeSince.value = o.smokeSinceYear;
    u.uSmokeOn.value = o.smoke ? 1 : 0;
    u.uCloudCount.value = o.clouds.enabled ? o.clouds.count : 0;
    u.uCloudSpeed.value = o.clouds.speed;
    u.uCloudOpacity.value = o.clouds.opacity;
    const h = cfg.hemisphere;
    u.uEdgeComp.value = h.edgeCompensation;
    u.uMaxGain.value = h.maxGain;
    u.uEdgeSoft.value = h.edgeSoftness;
    u.uLimb.value = cfg.globe.limbShading;
    const pal = cfg.display.theme === 'day' ? l.illustrated.day : l.illustrated.night;
    hexToVec3(pal.ornament, u.uTint.value);
    const r = cfg.render;
    u.uExposure.value = r.exposure;
    u.uGamma.value = r.gamma;
    u.uBlackLift.value = r.blackLift;
    u.uVignette.value = r.vignette;
    u.uFinishVignette.value = v.mode === 'flat' || v.mode === 'globe' ? 1 : 0;
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
    if (o.clouds.enabled && o.clouds.count > 0) renderer.render(this.cloudShadowScene, this.camera);
  }

  dispose(): void {
    this.texture.dispose();
  }
}

/** Ombre portée d'un nuage : ovale doux et sombre, sans lumière propre. */
const SHADOW_FRAG = /* glsl */ `
precision highp float;
precision highp int;
in vec2 vUv;
in float vAlpha;
in float vGain;
in float vKind;
uniform float uCols;
uniform sampler2D uAtlas;
uniform int uMode;
uniform vec2 uResolution;
out vec4 outColor;
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / (0.5 * uResolution.y);
  if (uMode == 4 && length(p) > 1.0) discard;
  float a = texture(uAtlas, vUv).a * vAlpha * 0.22;
  if (a < 0.004) discard;
  outColor = vec4(0.0, 0.0, 0.0, a);
}`;

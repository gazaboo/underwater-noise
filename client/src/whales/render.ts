/**
 * Rendu des cétacés sur la carte plate :
 *  - espace de communication : pour chaque pixel autour d'un groupe, marge de l'équation du sonar
 *    avec le bruit local (champ physique) → la forme est rongée par les couloirs de trafic,
 *    découpée par les côtes ; contour tremblé là où l'AIS ne voit rien (bruit sous-estimé) ;
 *  - groupes : points chauds qui s'illuminent au rythme des appels ;
 *  - liens : fils de lumière le long des orthodromies, impulsions dans le sens de l'écoute,
 *    effilochage à la rupture, trace fantôme.
 */
import * as THREE from 'three';
import type { Config } from '@vacarme/shared';
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
out vec2 vWhale;
flat out vec4 vCall;
flat out vec4 vMisc;
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
  vColor = iColor;
}`;

const SPACE_FRAG = /* glsl */ `
precision highp float;
in vec2 vWhale;
flat in vec4 vCall;
flat in vec4 vMisc;
in vec3 vColor;
out vec4 outColor;
uniform vec2 uCenter;
uniform float uScale;
uniform vec2 uResolution;
uniform sampler2D uLevels;
uniform sampler2D uElevL;
uniform sampler2D uCoverage;
uniform float uFill, uContour, uSoftness, uTime;

float hav(vec2 a, vec2 b) { // distance (km), a et b en (lat, lon) degrés
  vec2 ra = radians(a), rb = radians(b);
  float s = pow(sin((rb.x - ra.x) * 0.5), 2.0) + cos(ra.x) * cos(rb.x) * pow(sin((rb.y - ra.y) * 0.5), 2.0);
  return 2.0 * 6371.0 * asin(min(1.0, sqrt(s)));
}
vec2 uvOf(vec2 ll) { return vec2(fract((ll.y + 180.0) / 360.0), (90.0 - ll.x) / 180.0); }

void main() {
  vec2 d = (gl_FragCoord.xy - 0.5 * uResolution) / uScale;
  vec2 ll = vec2(uCenter.y + d.y, uCenter.x + d.x);
  float dVis = hav(vWhale, ll);
  vec2 uv = uvOf(ll);
  // Pas d'élimination (discard) avant les dérivées : fwidth() serait faux au bord des zones éliminées.
  // On calcule tout, puis on masque.
  float mask = step(dVis, vMisc.w) * step(texture(uElevL, uv).b, 0.5); // dans le quad, en mer
  // Ombre des terres : l'appel ne traverse pas les continents (test le long du segment).
  vec2 dl = ll - vWhale;
  dl.y = mod(dl.y + 180.0, 360.0) - 180.0;
  for (int i = 1; i < 12; i++) {
    vec2 p = vWhale + dl * (float(i) / 12.0);
    mask *= step(texture(uElevL, uvOf(p)).b, 0.6);
  }
  // Équation du sonar au point : SE = SL − TL(d) − NL_appel(x) − DT.
  float r = max(dVis * 1000.0 / vMisc.z, 1.0); // distance vraie (m)
  float rt = max(vCall.w, 10.0);
  float tl = (r <= rt ? 20.0 * log(r) : 20.0 * log(rt) + 10.0 * log(r / rt)) / log(10.0) + vMisc.y * r / 1000.0;
  vec4 lv = texture(uLevels, uv);
  float band = vMisc.x;
  float nl = (band < 0.5 ? lv.g : band < 1.5 ? lv.b : lv.a) - vCall.z;
  float se = vCall.x - tl - nl - vCall.y;
  float w = fwidth(se) * 1.2 + 1e-4;
  // Remplissage (plus dense près du groupe) et contour au seuil.
  float inside = smoothstep(0.0, uSoftness, se) * (1.0 - 0.55 * clamp(dVis / vMisc.w, 0.0, 1.0));
  float edge = 1.0 - smoothstep(0.0, w, abs(se));
  // Terra incognita : le bruit y est sous-estimé ; contour pointillé et tremblant.
  float cov = smoothstep(0.03, 0.4, texture(uCoverage, uv).r);
  float ang = atan(dl.x, dl.y);
  float dash = step(0.45, fract(ang * 9.0 + uTime * 0.3));
  edge *= mix(dash * (0.7 + 0.3 * sin(uTime * 7.0 + ang * 31.0)), 1.0, cov);
  if (mask < 0.5) discard;
  vec3 c = vColor * (uFill * inside + uContour * edge);
  outColor = vec4(c, 1.0);
}`;

// ------------------------------------------------------------------ groupes

const MARK_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec2 aWhale;
in float aPulse;
in vec3 aColor;
uniform float uSize;
out float vPulse;
out vec3 vColor;
${FLAT_GLSL}
void main() {
  gl_Position = flatProject(aWhale.x, aWhale.y);
  gl_PointSize = uSize * (1.0 + 0.8 * aPulse);
  vPulse = aPulse;
  vColor = aColor;
}`;

const MARK_FRAG = /* glsl */ `
precision highp float;
in float vPulse;
in vec3 vColor;
out vec4 outColor;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float core = smoothstep(1.0, 0.0, r);
  outColor = vec4(vColor * core * (0.55 + 0.9 * vPulse), 1.0);
}`;

// ------------------------------------------------------------------ liens

const LINK_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec2 aLatLon;     // point de l'arc (longitude dépliée)
in float aLon0;      // longitude du premier point (pour le repli d'antiméridien)
in float aT;         // 0 en A, 1 en B
in float aLink;      // indice du lien
uniform sampler2D uState; // par lien : force A←B, force B←A, effilochage, fantôme
uniform sampler2D uMeta;  // par lien : marge max (dB), graine, temps depuis le dernier appel de A (s), idem pour B
out float vT;
flat out vec4 vState;
flat out vec4 vMeta;
${FLAT_GLSL}
void main() {
  float dl0 = mod(aLon0 - uCenter.x + 180.0, 360.0) - 180.0 + uShift;
  float lon = uCenter.x + dl0 + (aLatLon.y - aLon0);
  vec2 px = vec2(lon - uCenter.x, aLatLon.x - uCenter.y) * uScale;
  gl_Position = vec4(px / (0.5 * uResolution), 0.0, 1.0);
  vT = aT;
  ivec2 c = ivec2(int(aLink) % ${MAX_LINKS}, 0);
  vState = texelFetch(uState, c, 0);
  vMeta = texelFetch(uMeta, c, 0);
}`;

const LINK_FRAG = /* glsl */ `
precision highp float;
in float vT;
flat in vec4 vState;
flat in vec4 vMeta;
out vec4 outColor;
uniform vec3 uColor;
uniform float uIntensity, uGhost, uTime, uPulseSpeed, uHyst;
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
  float base = strength * (0.35 + 0.45 * tension) * (1.0 - 0.6 * tremble);
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
  // Extrémités adoucies.
  light *= smoothstep(0.0, 0.03, vT) * smoothstep(1.0, 0.97, vT);
  outColor = vec4(uColor * light, 1.0);
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
  pulse: number;
}

export interface LinkDraw {
  /** Points de l'arc (lat, lon dépliée), de A vers B. */
  arc: [number, number][];
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

export class WhaleRenderer {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  // espace de communication
  private readonly spaceGeo = new THREE.InstancedBufferGeometry();
  private readonly iWhale = new Float32Array(MAX_GROUPS * 2);
  private readonly iCall = new Float32Array(MAX_GROUPS * 4);
  private readonly iMisc = new Float32Array(MAX_GROUPS * 4);
  private readonly iColor = new Float32Array(MAX_GROUPS * 3);
  private readonly spaceMat: THREE.RawShaderMaterial;
  // groupes
  private readonly markGeo = new THREE.BufferGeometry();
  private readonly mWhale = new Float32Array(MAX_GROUPS * 2);
  private readonly mPulse = new Float32Array(MAX_GROUPS);
  private readonly mColor = new Float32Array(MAX_GROUPS * 3);
  private readonly markMat: THREE.RawShaderMaterial;
  // liens
  private linkGeo = new THREE.BufferGeometry();
  private readonly linkMat: THREE.RawShaderMaterial;
  private readonly linkMesh: THREE.LineSegments;
  private readonly stateTex: THREE.DataTexture;
  private readonly metaTex: THREE.DataTexture;
  private readonly stateData = new Float32Array(MAX_LINKS * 4);
  private readonly metaData = new Float32Array(MAX_LINKS * 4);
  private linkCount = 0;
  private marks!: THREE.Points;

  constructor(elevLinear: THREE.Texture) {
    // Espace de communication : quads instanciés.
    const quad = new THREE.PlaneGeometry(2, 2);
    this.spaceGeo.index = quad.index;
    this.spaceGeo.setAttribute('position', quad.getAttribute('position'));
    this.spaceGeo.setAttribute('iWhale', new THREE.InstancedBufferAttribute(this.iWhale, 2).setUsage(THREE.DynamicDrawUsage));
    this.spaceGeo.setAttribute('iCall', new THREE.InstancedBufferAttribute(this.iCall, 4).setUsage(THREE.DynamicDrawUsage));
    this.spaceGeo.setAttribute('iMisc', new THREE.InstancedBufferAttribute(this.iMisc, 4).setUsage(THREE.DynamicDrawUsage));
    this.spaceGeo.setAttribute('iColor', new THREE.InstancedBufferAttribute(this.iColor, 3).setUsage(THREE.DynamicDrawUsage));
    this.spaceGeo.instanceCount = 0;
    this.spaceMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SPACE_VERT,
      fragmentShader: SPACE_FRAG,
      uniforms: {
        ...flatUniforms(),
        uLevels: { value: null },
        uElevL: { value: elevLinear },
        uCoverage: { value: null },
        uFill: { value: 0.16 },
        uContour: { value: 0.75 },
        uSoftness: { value: 10 },
        uTime: { value: 0 },
      },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    const space = new THREE.Mesh(this.spaceGeo, this.spaceMat);
    space.frustumCulled = false;

    // Groupes : points.
    this.markGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_GROUPS * 3), 3));
    this.markGeo.setAttribute('aWhale', new THREE.BufferAttribute(this.mWhale, 2).setUsage(THREE.DynamicDrawUsage));
    this.markGeo.setAttribute('aPulse', new THREE.BufferAttribute(this.mPulse, 1).setUsage(THREE.DynamicDrawUsage));
    this.markGeo.setAttribute('aColor', new THREE.BufferAttribute(this.mColor, 3).setUsage(THREE.DynamicDrawUsage));
    this.markMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: MARK_VERT,
      fragmentShader: MARK_FRAG,
      uniforms: { ...flatUniforms(), uSize: { value: 4 } },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    const marks = new THREE.Points(this.markGeo, this.markMat);
    marks.frustumCulled = false;
    this.marks = marks;

    // Liens : segments, état par lien dans deux petites textures.
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
        uColor: { value: new THREE.Vector3(1, 0.9, 0.8) },
        uIntensity: { value: 1 },
        uGhost: { value: 0.12 },
        uTime: { value: 0 },
        uPulseSpeed: { value: 0.3 },
        uHyst: { value: 2 },
      },
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
    this.linkMesh = new THREE.LineSegments(this.linkGeo, this.linkMat);
    this.linkMesh.frustumCulled = false;

    this.scene.add(space, this.linkMesh, marks);
  }

  setGroups(groups: GroupDraw[]): void {
    const n = Math.min(groups.length, MAX_GROUPS);
    for (let i = 0; i < n; i++) {
      const g = groups[i];
      this.iWhale.set([g.lat, g.lon], 2 * i);
      this.iCall.set([g.sl, g.dt, g.noiseCorrection, g.depth], 4 * i);
      this.iMisc.set([g.band, g.alpha, g.visualScale, g.radiusKm], 4 * i);
      this.iColor.set([g.color.x, g.color.y, g.color.z], 3 * i);
      this.mWhale.set([g.lat, g.lon], 2 * i);
      this.mPulse[i] = g.pulse;
      this.mColor.set([g.color.x, g.color.y, g.color.z], 3 * i);
    }
    for (const name of ['iWhale', 'iCall', 'iMisc', 'iColor']) (this.spaceGeo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    for (const name of ['aWhale', 'aPulse', 'aColor']) (this.markGeo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    this.spaceGeo.instanceCount = n;
    this.markGeo.setDrawRange(0, n);
  }

  /** Reconstruit la géométrie des arcs (quand les groupes ont bougé ou que les liens changent). */
  setLinkGeometry(links: LinkDraw[]): void {
    const n = Math.min(links.length, MAX_LINKS);
    const segs = n * (ARC_POINTS - 1) * 2;
    const pos = new Float32Array(segs * 3);
    const ll = new Float32Array(segs * 2);
    const lon0 = new Float32Array(segs);
    const t = new Float32Array(segs);
    const idx = new Float32Array(segs);
    let v = 0;
    for (let k = 0; k < n; k++) {
      const arc = links[k].arc;
      for (let i = 0; i < arc.length - 1; i++) {
        for (const j of [i, i + 1]) {
          ll[2 * v] = arc[j][0];
          ll[2 * v + 1] = arc[j][1];
          lon0[v] = arc[0][1];
          t[v] = j / (arc.length - 1);
          idx[v] = k;
          v++;
        }
      }
    }
    this.linkGeo.dispose();
    this.linkGeo = new THREE.BufferGeometry();
    this.linkGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.linkGeo.setAttribute('aLatLon', new THREE.BufferAttribute(ll, 2));
    this.linkGeo.setAttribute('aLon0', new THREE.BufferAttribute(lon0, 1));
    this.linkGeo.setAttribute('aT', new THREE.BufferAttribute(t, 1));
    this.linkGeo.setAttribute('aLink', new THREE.BufferAttribute(idx, 1));
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

  draw(renderer: THREE.WebGLRenderer, view: FlatTransform, cfg: Config, levels: THREE.Texture, coverage: THREE.Texture, timeSec: number, pixelRatio: number, target: THREE.WebGLRenderTarget | null = null): void {
    const w = cfg.whales;
    for (const mat of [this.spaceMat, this.markMat, this.linkMat]) setFlat(mat.uniforms, view);
    const su = this.spaceMat.uniforms;
    su.uLevels.value = levels;
    su.uCoverage.value = coverage;
    su.uFill.value = w.space.fill;
    su.uContour.value = w.space.contour;
    su.uSoftness.value = w.space.softnessDb;
    su.uTime.value = timeSec;
    this.markMat.uniforms.uSize.value = w.space.markerSize * pixelRatio;
    const lu = this.linkMat.uniforms;
    hexToVec3(w.color, lu.uColor.value as THREE.Vector3);
    lu.uIntensity.value = w.links.enabled ? w.links.intensity : 0;
    lu.uGhost.value = w.links.enabled ? w.links.ghost : 0;
    lu.uTime.value = timeSec;
    lu.uPulseSpeed.value = w.links.pulseSpeed;
    lu.uHyst.value = w.links.hysteresisDb;
    renderer.setRenderTarget(target);
    // Trois passes décalées de −360°, 0, +360° : les espaces et les fils à cheval sur l'antiméridien
    // de la carte apparaissent des deux côtés (les points des groupes ne sont dessinés qu'une fois).
    for (const shift of [-360, 0, 360]) {
      for (const mat of [this.spaceMat, this.linkMat]) mat.uniforms.uShift.value = shift;
      this.marks.visible = shift === 0;
      renderer.render(this.scene, this.camera);
    }
    this.marks.visible = true;
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

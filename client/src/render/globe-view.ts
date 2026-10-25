/**
 * Passe de projection finale à partir de la texture « monde » (équirectangulaire, déjà composée :
 * fond, lueur, ondes, navires, cétacés). Quatre sorties :
 *
 *  - globe     : globe à l'écran, caméra en perspective (d = 4,5 rayons), limbe assombri ;
 *  - hemisphere: demi-sphère bombée éclairée par un projecteur dans son axe. La caméra reproduit le
 *                projecteur réel : distance d/R, rapport de projection, décalage d'objectif, échelle,
 *                rotation. Compensation de luminosité en 1/cos(incidence) (plafonnée), bord fondu,
 *                rien n'est projeté hors du disque ;
 *  - equirect  : texture monde brute, cadrée 2:1 (capture pour TouchDesigner, MapMap) ;
 *  - fisheye   : projection azimutale centrée sur le point face au public (projecteur à fisheye
 *                placé au centre d'une sphère translucide) ; modèles f-θ ou équisolide.
 *
 * Repère : la Terre est une sphère unité ; un point (lat, lon) a pour coordonnées
 * (cos lat · sin lon, sin lat, cos lat · cos lon). La matrice M = Ry(λ₀) · Rx(−φ₀) envoie la
 * direction « face au public » (0, 0, 1) sur le point (φ₀, λ₀).
 */
import * as THREE from 'three';
import { PAPER_GLSL } from './paper.ts';
import type { Config } from '@vacarme/shared';
import { FullscreenPass, rawMaterial } from './fullscreen.ts';
import { Pinch } from '../ui/pinch.ts';

export type GlobeMode = 'globe' | 'hemisphere' | 'equirect' | 'fisheye';
const MODE_INDEX: Record<GlobeMode, number> = { globe: 1, hemisphere: 2, equirect: 3, fisheye: 4 };
const DEG = Math.PI / 180;
const GLOBE_DISTANCE = 4.5;

const GLOBE_FRAG = /* glsl */ `
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uWorld;
uniform vec2 uResolution;
uniform int uMode;
uniform mat3 uM;           // vue → Terre
uniform float uDist;       // distance caméra / centre (rayons)
uniform float uTanHalf;    // tangente du demi-champ vertical
uniform vec2 uShift;
uniform float uScale;
uniform float uRoll;
uniform float uEdgeComp, uMaxGain, uEdgeSoft, uLimb;
uniform float uFishFov;
uniform int uFishModel;
uniform bool uCalib;
uniform float uExposure, uGamma, uBlackLift, uVignette;
uniform bool uDither;
uniform float uTime;
uniform float uStars, uStarDensity, uTwinkle, uHalo;

const float PI = 3.141592653589793;

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

${PAPER_GLSL}

// Lecture de la texture monde sans couture à l'antiméridien (méthode de Tarini) :
// on choisit, pour les dérivées, la paramétrisation de u la plus continue.
vec3 sampleWorld(float lat, float lon) {
  float u1 = lon / (2.0 * PI) + 0.5;
  float u2 = fract(u1 + 0.5) - 0.5;
  // La texture monde est un tampon de rendu : sa ligne 0 est en bas, donc au sud (v = 0 ↔ −90°).
  float v = 0.5 + lat / PI;
  vec2 d1 = vec2(dFdx(u1), dFdy(u1));
  vec2 d2 = vec2(dFdx(u2), dFdy(u2));
  vec2 du = dot(d1, d1) <= dot(d2, d2) ? d1 : d2;
  vec2 dv = vec2(dFdx(v), dFdy(v));
  return textureGrad(uWorld, vec2(fract(u1), v), vec2(du.x, dv.x), vec2(du.y, dv.y)).rgb;
}

// Mire de calibration : méridiens et parallèles tous les 15°, équateur et méridien origine plus marqués.
float graticule(float lat, float lon) {
  float la = degrees(lat) / 15.0;
  float lo = degrees(lon) / 15.0;
  float wla = fwidth(la) * 1.2;
  float wlo = min(fwidth(lo), fwidth(fract(lo + 0.5))) * 1.2;
  float g = max(1.0 - smoothstep(0.0, wla, abs(fract(la + 0.5) - 0.5)), 1.0 - smoothstep(0.0, wlo, abs(fract(lo + 0.5) - 0.5)));
  float eq = 1.0 - smoothstep(0.0, wla * 2.5, abs(la));
  float pm = 1.0 - smoothstep(0.0, wlo * 2.5, abs(lo));
  return max(g * 0.6, max(eq, pm));
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  // Coordonnées normalisées : y ∈ [−1, 1], x selon le rapport d'aspect.
  vec2 p = (frag - 0.5 * uResolution) / (0.5 * uResolution.y);
  vec3 col = vec3(0.0);
  float lat = 0.0, lon = 0.0;
  bool hit = false;
  float cosInc = 1.0;
  float edge = 1.0;
  float rayDistance = 10.0;

  if (uMode == 3) {
    // Équirect : rectangle 2:1 centré.
    vec2 frame = uResolution.x / uResolution.y >= 2.0 ? vec2(2.0, 1.0) : vec2(uResolution.x / uResolution.y, 0.5 * uResolution.x / uResolution.y);
    vec2 q = p / frame;
    if (abs(q.x) <= 1.0 && abs(q.y) <= 1.0) {
      lon = q.x * PI;
      lat = q.y * PI * 0.5;
      hit = true;
    }
  } else if (uMode == 4) {
    // Fisheye : azimutale centrée sur le point face au public.
    float r = length(p);
    float halfFov = radians(uFishFov) * 0.5;
    float th = uFishModel == 0 ? r * halfFov : 2.0 * asin(clamp(r * sin(halfFov * 0.5), -1.0, 1.0));
    if (r <= 1.0) {
      vec2 dir2 = r > 0.0 ? p / r : vec2(0.0);
      vec3 d = vec3(sin(th) * dir2, cos(th));
      vec3 q = uM * d;
      lat = asin(clamp(q.y, -1.0, 1.0));
      lon = atan(q.x, q.z);
      hit = true;
      edge = 1.0 - smoothstep(0.985, 1.0, r);
    }
  } else {
    // Globe / demi-sphère : rayon de la caméra (ou du projecteur) vers la sphère unité.
    vec2 s = (p - uShift) / uScale;
    float c = cos(radians(uRoll)), sn = sin(radians(uRoll));
    s = mat2(c, sn, -sn, c) * s;
    vec3 ro = vec3(0.0, 0.0, uDist);
    vec3 rd = normalize(vec3(s * uTanHalf, -1.0));
    float b = dot(ro, rd);
    rayDistance = sqrt(max(dot(ro,ro)-b*b, 0.0));
    float h = b * b - (dot(ro, ro) - 1.0);
    if (h > 0.0) {
      float t = -b - sqrt(h);
      vec3 n = ro + t * rd;
      cosInc = max(dot(-rd, n), 0.0);
      vec3 q = uM * n;
      lat = asin(clamp(q.y, -1.0, 1.0));
      lon = atan(q.x, q.z);
      hit = true;
      // Bord anti-crénelé.
      edge = smoothstep(0.0, max(fwidth(h) * 1.5, 1e-5), h);
    }
  }

  // Lectures hors des branches : les dérivées (mipmaps, mire) doivent être évaluées partout.
  vec3 world = sampleWorld(lat, lon);
  float grid = graticule(lat, lon);
  if (hit) {
    col = world;
    if (uCalib) col = mix(col, vec3(1.0, 0.92, 0.8), grid);
    if (uMode == 1) {
      // Écran : limbe assombri (relief du globe).
      col *= mix(1.0 - uLimb, 1.0, sqrt(cosInc));
    } else if (uMode == 2) {
      // Projecteur : la lumière arrive rasante vers le bord et s'étale ; on compense (plafonné),
      // et on fond le bord pour ne rien projeter hors de la sphère.
      float gain = mix(1.0, clamp(1.0 / max(cosInc, 0.02), 1.0, uMaxGain), uEdgeComp);
      col *= gain * smoothstep(0.0, uEdgeSoft + 1e-4, cosInc);
    }
    col *= edge;
  }

  if (uMode == 1 && !hit && uStars > 0.0) {
    // Constantes de répartition, taille et couleur artistiques ; étoiles fixes dans l'écran.
    vec2 cell = floor(frag / 32.0);
    float seed = hash(cell);
    vec2 offset = vec2(hash(cell+7.3), hash(cell+19.1));
    vec2 delta = frag - (cell+0.15+offset*0.7)*32.0;
    float star = (1.0-smoothstep(0.2,1.6,length(delta))) * step(seed, uStarDensity*0.3);
    float pulse = 1.0-uTwinkle*0.35*(0.5+0.5*sin(uTime*0.7+seed*61.0));
    col += mix(vec3(0.65,0.78,1),vec3(1,0.82,0.6),seed)*star*pulse*0.7;
    col += vec3(0.16,0.31,0.46)*exp(-max(rayDistance-1.0,0.0)*38.0)*uHalo;
  }

  // Mire : cercles concentriques et croix d'axe, dans le repère de l'image.
  if (uCalib) {
    float r = length(p);
    float ring = 1.0 - smoothstep(0.0, fwidth(r) * 1.5, abs(fract(r * 5.0 + 0.5) - 0.5) / 5.0);
    float cross = 1.0 - smoothstep(0.0, 1.5 / uResolution.y * 2.0, min(abs(p.x), abs(p.y)));
    col = max(col, vec3(0.35, 0.5, 0.6) * max(ring * 0.5, cross));
  }

  // Finition.
  if (hit) col += (paper(col, frag) - col) * edge;
  if (uMode == 1) {
    vec2 qv = frag / uResolution - 0.5;
    qv.x *= uResolution.x / uResolution.y;
    col *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(qv) * 1.2);
  }
  col *= uExposure;
  col = pow(max(col, 0.0), vec3(1.0 / uGamma));
  // Plancher de noir seulement sur la sphère (ou l'image) : rien sur le mur.
  if (hit) col = uBlackLift * edge + (1.0 - uBlackLift) * col;
  if (uDither && hit) col += (hash(frag + fract(uTime) * 61.0) - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
}`;

/** M = Ry(λ₀) · Rx(−φ₀) : direction de vue → point de la Terre. */
export function viewToEarth(facingLatDeg: number, facingLonDeg: number): THREE.Matrix3 {
  const ry = new THREE.Matrix4().makeRotationY(facingLonDeg * DEG);
  const rx = new THREE.Matrix4().makeRotationX(-facingLatDeg * DEG);
  return new THREE.Matrix3().setFromMatrix4(ry.multiply(rx));
}

export interface GlobeCamera {
  dist: number;
  tanHalf: number;
  shift: [number, number];
  scale: number;
  rollDeg: number;
}

/** Caméra selon le mode : globe à l'écran, ou projecteur réel pour la demi-sphère. */
export function globeCamera(mode: GlobeMode, cfg: Config, aspect: number, zoom: number): GlobeCamera {
  if (mode === 'hemisphere') {
    const h = cfg.hemisphere;
    // Demi-champ horizontal : tan = 1 / (2 · rapport de projection) ; vertical = horizontal / aspect.
    const tanHalfH = 1 / (2 * h.throwRatio);
    return { dist: h.distanceRatio, tanHalf: tanHalfH / aspect, shift: [h.shiftX * aspect, h.shiftY], scale: h.scale, rollDeg: h.rollDeg };
  }
  // Globe : rayon apparent = screenSize × zoom (en demi-hauteurs d'écran).
  const alpha = Math.asin(1 / GLOBE_DISTANCE);
  return { dist: GLOBE_DISTANCE, tanHalf: Math.tan(alpha) / (cfg.globe.screenSize * zoom), shift: [0, 0], scale: 1, rollDeg: 0 };
}

/** Point géographique sous un pixel (tampon, y vers le haut), ou null hors du globe. */
export function pixelToGeo(mode: GlobeMode, cam: GlobeCamera, M: THREE.Matrix3, cfg: Config, x: number, y: number, w: number, h: number): [number, number] | null {
  const px = (x - 0.5 * w) / (0.5 * h);
  const py = (y - 0.5 * h) / (0.5 * h);
  let q: THREE.Vector3;
  if (mode === 'equirect') {
    const half = w / h >= 2 ? [2, 1] : [w / h, (0.5 * w) / h];
    const qx = px / half[0];
    const qy = py / half[1];
    if (Math.abs(qx) > 1 || Math.abs(qy) > 1) return null;
    return [qy * 90, qx * 180];
  }
  if (mode === 'fisheye') {
    const r = Math.hypot(px, py);
    if (r > 1) return null;
    const halfFov = (cfg.fisheye.fovDeg * DEG) / 2;
    const th = cfg.fisheye.model === 'equidistant' ? r * halfFov : 2 * Math.asin(Math.min(1, r * Math.sin(halfFov / 2)));
    const ux = r > 0 ? px / r : 0;
    const uy = r > 0 ? py / r : 0;
    q = new THREE.Vector3(Math.sin(th) * ux, Math.sin(th) * uy, Math.cos(th)).applyMatrix3(M);
  } else {
    let sx = (px - cam.shift[0]) / cam.scale;
    let sy = (py - cam.shift[1]) / cam.scale;
    const c = Math.cos(cam.rollDeg * DEG);
    const s = Math.sin(cam.rollDeg * DEG);
    [sx, sy] = [c * sx - s * sy, s * sx + c * sy];
    const ro = new THREE.Vector3(0, 0, cam.dist);
    const rd = new THREE.Vector3(sx * cam.tanHalf, sy * cam.tanHalf, -1).normalize();
    const b = ro.dot(rd);
    const disc = b * b - (ro.dot(ro) - 1);
    if (disc <= 0) return null;
    const t = -b - Math.sqrt(disc);
    q = ro.addScaledVector(rd, t).applyMatrix3(M);
  }
  return [Math.asin(Math.max(-1, Math.min(1, q.y))) / DEG, Math.atan2(q.x, q.z) / DEG];
}

export class GlobeView {
  private readonly pass: FullscreenPass;
  readonly uniforms: Record<string, THREE.IUniform>;
  calibration = false;

  constructor() {
    this.uniforms = {
      uPaperStrength: { value: 0 }, uPaperScale: { value: 1 },
      uStars: { value: 0 }, uStarDensity: { value: 0 }, uTwinkle: { value: 0 }, uHalo: { value: 0 },
      uWorld: { value: null },
      uResolution: { value: new THREE.Vector2() },
      uMode: { value: 1 },
      uM: { value: new THREE.Matrix3() },
      uDist: { value: GLOBE_DISTANCE },
      uTanHalf: { value: 0.3 },
      uShift: { value: new THREE.Vector2() },
      uScale: { value: 1 },
      uRoll: { value: 0 },
      uEdgeComp: { value: 0.6 },
      uMaxGain: { value: 2.5 },
      uEdgeSoft: { value: 0.06 },
      uLimb: { value: 0.45 },
      uFishFov: { value: 180 },
      uFishModel: { value: 0 },
      uCalib: { value: false },
      uExposure: { value: 1 },
      uGamma: { value: 1 },
      uBlackLift: { value: 0 },
      uVignette: { value: 0 },
      uDither: { value: true },
      uTime: { value: 0 },
    };
    this.pass = new FullscreenPass(rawMaterial(GLOBE_FRAG, this.uniforms));
  }

  render(renderer: THREE.WebGLRenderer, world: THREE.Texture, mode: GlobeMode, cam: GlobeCamera, M: THREE.Matrix3, cfg: Config, width: number, height: number, time: number): void {
    const u = this.uniforms;
    const { paper, stars } = cfg.land;
    u.uPaperStrength.value = paper.enabled ? paper.strength : 0;
    u.uPaperScale.value = paper.scale;
    u.uStars.value = stars.enabled ? 1 : 0;
    u.uStarDensity.value = stars.density; u.uTwinkle.value = stars.twinkle; u.uHalo.value = stars.halo;
    u.uWorld.value = world;
    (u.uResolution.value as THREE.Vector2).set(width, height);
    u.uMode.value = MODE_INDEX[mode];
    (u.uM.value as THREE.Matrix3).copy(M);
    u.uDist.value = cam.dist;
    u.uTanHalf.value = cam.tanHalf;
    (u.uShift.value as THREE.Vector2).set(cam.shift[0], cam.shift[1]);
    u.uScale.value = cam.scale;
    u.uRoll.value = cam.rollDeg;
    const h = cfg.hemisphere;
    u.uEdgeComp.value = h.edgeCompensation;
    u.uMaxGain.value = h.maxGain;
    u.uEdgeSoft.value = h.edgeSoftness;
    u.uLimb.value = cfg.globe.limbShading;
    u.uFishFov.value = cfg.fisheye.fovDeg;
    u.uFishModel.value = cfg.fisheye.model === 'equidistant' ? 0 : 1;
    u.uCalib.value = this.calibration;
    const r = cfg.render;
    u.uExposure.value = r.exposure;
    u.uGamma.value = r.gamma;
    u.uBlackLift.value = r.blackLift;
    u.uVignette.value = r.vignette;
    u.uDither.value = r.dither;
    u.uTime.value = time;
    this.pass.render(renderer, null);
  }
}

/**
 * Rotation de la Terre sous le regard fixe, avec ralentissements (artistiques) quand une zone
 * choisie passe face au public, et décalages ajoutés par l'utilisateur (glisser, à l'écran).
 */
export class GlobeController {
  facingLon: number;
  private userLat = 0;
  zoom = 1;
  private dragging: { x: number; y: number } | null = null;

  constructor(cfg: Config) {
    this.facingLon = cfg.globe.startLonDeg;
  }

  get facingLatFor(): (cfg: Config) => number {
    return (cfg) => Math.max(-85, Math.min(85, cfg.globe.viewLatDeg + this.userLat));
  }

  update(cfg: Config, dtSec: number): void {
    const g = cfg.globe;
    if (g.periodMinutes > 0 && !this.dragging) {
      let slow = 1;
      for (const d of g.dwell) {
        const dl = Math.abs(((((this.facingLon - d.lonDeg + 180) % 360) + 360) % 360) - 180);
        if (dl < d.widthDeg) slow = Math.min(slow, d.slowdown + (1 - d.slowdown) * (dl / d.widthDeg) ** 2);
      }
      // La Terre tourne vers l'est : la longitude face au public décroît.
      this.facingLon -= (360 * dtSec * slow) / (g.periodMinutes * 60);
      this.facingLon = ((((this.facingLon + 180) % 360) + 360) % 360) - 180;
    }
  }

  /** Interactions à l'écran : glisser = tourner, molette ou pincement = zoomer. */
  install(canvas: HTMLCanvasElement, active: () => boolean): void {
    const pinch = new Pinch(canvas, (factor) => {
      if (!active()) return;
      this.dragging = null;
      this.zoom = Math.max(0.5, Math.min(4, this.zoom * factor));
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (!active() || e.button !== 0) return;
      this.dragging = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!active() || !this.dragging || pinch.active) return;
      const k = 0.25 / this.zoom;
      this.facingLon -= (e.clientX - this.dragging.x) * k;
      this.userLat += (e.clientY - this.dragging.y) * k;
      this.userLat = Math.max(-110, Math.min(60, this.userLat));
      this.dragging = { x: e.clientX, y: e.clientY };
    });
    const end = () => (this.dragging = null);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      if (!active()) return;
      e.preventDefault();
      this.zoom = Math.max(0.5, Math.min(4, this.zoom * Math.exp(-e.deltaY * 0.0015)));
    }, { passive: false });
    canvas.addEventListener('dblclick', () => {
      if (!active()) return;
      this.userLat = 0;
      this.zoom = 1;
    });
  }
}

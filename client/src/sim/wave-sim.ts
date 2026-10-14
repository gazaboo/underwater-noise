/**
 * Simulation GPU de l'équation des ondes 2D amortie, sur la sphère, en équirectangulaire.
 *
 *   ∂²u/∂t² + 2γ ∂u/∂t = c² ∇²u + sources
 *
 * Laplacien sphérique (rayon 1, pas h = Δλ = Δφ) :
 *   ∇²u ≈ [ (uE + uW − 2u) / cos²φ + (uN + uS − 2u) − tanφ · h · (uN − uS) / 2 ] / h²
 *
 * Schéma saute-mouton (leapfrog) ; état RG = (u au pas n, u au pas n−1), demi-flottants.
 * Le nombre de Courant C = c·Δt/h est borné localement par la condition de stabilité
 * C² (1 + 1/cos²φ) ≤ 1 : près des pôles les ondes ralentissent (en cellules par pas),
 * et au-delà de `polarCapLat` la banquise forme un mur.
 *
 * Les cellules de terre restent à 0 (condition de Dirichlet) : les ondes ne traversent pas
 * les continents, elles s'y réfléchissent, atténuées par `coastDamping`.
 *
 * J1 : cette grille ne porte que le canal visuel (ondes pulsées). Les canaux physiques
 * calibrés en dB (trois bandes) arrivent au J3, sur une seconde grille.
 */
import * as THREE from 'three';
import { FullscreenPass, rawMaterial } from '../render/fullscreen.ts';

const STEP_FRAG = /* glsl */ `
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uState;   // RG : u(n), u(n-1)
uniform sampler2D uSource;  // R  : injection de ce pas
uniform sampler2D uOcean;   // R : mer ; B : fraction de terre
uniform vec2 uTexel;        // 1 / taille de la grille
uniform float uCourant;
uniform float uDamping;
uniform float uCoastDamping;
uniform float uPolarCap;    // radians

const float PI = 3.141592653589793;

void main() {
  vec4 ocean = texture(uOcean, vUv);
  float lat = (0.5 - vUv.y) * PI; // v = 0 au nord
  if (ocean.r < 0.5 || abs(lat) > uPolarCap) {
    outColor = vec4(0.0);
    return;
  }
  vec2 s = texture(uState, vUv).rg;
  float u = s.r;
  float up = s.g;
  float uE = texture(uState, vUv + vec2(uTexel.x, 0.0)).r;
  float uW = texture(uState, vUv - vec2(uTexel.x, 0.0)).r;
  float uN = texture(uState, vUv - vec2(0.0, uTexel.y)).r;
  float uS = texture(uState, vUv + vec2(0.0, uTexel.y)).r;

  float c = max(cos(lat), 0.02);
  float h = uTexel.y * PI;
  float lap = (uE + uW - 2.0 * u) / (c * c) + (uN + uS - 2.0 * u) - tan(lat) * h * (uN - uS) * 0.5;
  float cmax = 0.95 / sqrt(1.0 + 1.0 / (c * c));
  float C = min(uCourant, cmax);

  // Amortissement : global + côtes (cellules partiellement terrestres).
  float g = uDamping + uCoastDamping * ocean.b;
  float next = (2.0 * u - (1.0 - g) * up + C * C * lap) / (1.0 + g);
  next += texture(uSource, vUv).r;
  // Garde-fou numérique (demi-flottants).
  next = clamp(next, -60.0, 60.0);
  outColor = vec4(next, u, 0.0, 1.0);
}`;

export interface WaveParams {
  courant: number;
  damping: number;
  coastDamping: number;
  polarCapLat: number;
}

export class WaveSim {
  readonly width: number;
  readonly height: number;
  /** Cible d'injection des sources (rendue par la couche navires à chaque pas). */
  readonly sourceTarget: THREE.WebGLRenderTarget;
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readonly pass: FullscreenPass;
  private readonly uniforms: Record<string, THREE.IUniform>;

  constructor(width: number, ocean: THREE.Texture) {
    this.width = width;
    this.height = width / 2;
    const make = (format: THREE.AnyPixelFormat) =>
      new THREE.WebGLRenderTarget(this.width, this.height, {
        type: THREE.HalfFloatType,
        format,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false,
      });
    this.targets = [make(THREE.RGFormat), make(THREE.RGFormat)];
    this.sourceTarget = make(THREE.RedFormat);
    this.uniforms = {
      uState: { value: this.targets[0].texture },
      uSource: { value: this.sourceTarget.texture },
      uOcean: { value: ocean },
      uTexel: { value: new THREE.Vector2(1 / this.width, 1 / this.height) },
      uCourant: { value: 0.45 },
      uDamping: { value: 0.004 },
      uCoastDamping: { value: 0.35 },
      uPolarCap: { value: (79 * Math.PI) / 180 },
    };
    this.pass = new FullscreenPass(rawMaterial(STEP_FRAG, this.uniforms));
  }

  setParams(p: WaveParams): void {
    this.uniforms.uCourant.value = p.courant;
    this.uniforms.uDamping.value = p.damping;
    this.uniforms.uCoastDamping.value = p.coastDamping;
    this.uniforms.uPolarCap.value = (p.polarCapLat * Math.PI) / 180;
  }

  /** Effective Courant number at the equator (borné par la stabilité). */
  get courant(): number {
    return Math.min(this.uniforms.uCourant.value as number, 0.95 / Math.SQRT2);
  }

  /** Un pas de temps : lit targets[0], écrit targets[1], puis échange. */
  step(renderer: THREE.WebGLRenderer): void {
    this.uniforms.uState.value = this.targets[0].texture;
    this.pass.render(renderer, this.targets[1]);
    this.targets = [this.targets[1], this.targets[0]];
  }

  /** Champ courant (R = u). */
  get texture(): THREE.Texture {
    return this.targets[0].texture;
  }

  clear(renderer: THREE.WebGLRenderer): void {
    const prev = renderer.getClearColor(new THREE.Color());
    const alpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    for (const t of [...this.targets, this.sourceTarget]) {
      renderer.setRenderTarget(t);
      renderer.clear(true, false, false);
    }
    renderer.setClearColor(prev, alpha);
  }

  dispose(): void {
    for (const t of [...this.targets, this.sourceTarget]) t.dispose();
    this.pass.material.dispose();
  }
}

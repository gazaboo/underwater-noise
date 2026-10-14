/**
 * Simulation de détail pour l'exploration (zoom).
 *
 * Au-delà d'un certain zoom, la grille mondiale (≈ 20 km par cellule) est trop grossière :
 * on lance une seconde simulation couvrant seulement la zone visible (plus une marge), avec
 * son propre masque terre/mer calculé sur le GPU à partir des grilles d'affichage. Elle se fond
 * dans la vue mondiale (fondu au démarrage, fondu sur ses bords).
 *
 * Quand la vue sort de l'emprise, ou que le zoom change beaucoup, la grille est reconstruite
 * (les ondes y renaissent en une ou deux secondes, pendant que la grille mondiale assure le relais).
 */
import * as THREE from 'three';
import type { Config } from '@vacarme/shared';
import type { WorldAssets } from '../assets.ts';
import { FullscreenPass, rawMaterial } from '../render/fullscreen.ts';
import type { FlatTransform } from '../render/flat-view.ts';
import { WaveSim, type Domain } from './wave-sim.ts';

/** Masque terre/mer d'une emprise, au format des grilles ocean_*.png (R mer, G profondeur, B fraction de terre). */
const MASK_FRAG = /* glsl */ `
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uElevN;
uniform sampler2D uElevL;
uniform vec4 uDomain;
void main() {
  float lon = uDomain.x + (vUv.x - 0.5) * uDomain.z;
  float lat = uDomain.y - vUv.y * uDomain.w;
  vec2 guv = vec2(fract((lon + 180.0) / 360.0), clamp((90.0 - lat) / 180.0, 0.0, 1.0));
  float frac = texture(uElevL, guv).b;
  vec4 e = texture(uElevN, guv);
  float alt = (e.r * 255.0 * 256.0 + e.g * 255.0) - 11000.0;
  float depth = clamp(-alt, 10.0, 11000.0);
  float g = log(depth / 10.0) / log(1100.0);
  outColor = vec4(frac < 0.5 ? 1.0 : 0.0, g, frac, 1.0);
}`;

const FADE_IN_MS = 1500;

export class DetailWaves {
  sim: WaveSim | null = null;
  private mask: THREE.WebGLRenderTarget | null = null;
  private readonly maskPass: FullscreenPass;
  private readonly maskUniforms: Record<string, THREE.IUniform>;
  private bornAt = 0;
  private lastBuild = 0;
  private fadeOut = false;
  /** Poids de mélange courant (0 = invisible). */
  weight = 0;

  constructor(assets: WorldAssets) {
    this.maskUniforms = {
      uElevN: { value: assets.elevationNearest },
      uElevL: { value: assets.elevationLinear },
      uDomain: { value: new THREE.Vector4() },
    };
    this.maskPass = new FullscreenPass(rawMaterial(MASK_FRAG, this.maskUniforms));
  }

  /** Emprise souhaitée pour la vue : zone visible élargie de la marge, bornée aux pôles. */
  private desired(view: FlatTransform, margin: number): Domain | null {
    const halfLon = (view.width / 2 / view.scale) * margin;
    const halfLat = (view.height / 2 / view.scale) * margin;
    const lonSpan = 2 * halfLon;
    const latSpan = Math.min(2 * halfLat, 170);
    if (lonSpan > 300) return null;
    let latTop = Math.min(89, view.centerLat + latSpan / 2);
    if (latTop - latSpan < -89) latTop = -89 + latSpan;
    return { lonCenter: view.centerLon, latTop, lonSpan, latSpan };
  }

  /** La vue est-elle contenue dans l'emprise courante (avec une petite réserve) ? */
  private covers(view: FlatTransform): boolean {
    const d = this.sim!.domain;
    const halfLon = view.width / 2 / view.scale;
    const halfLat = view.height / 2 / view.scale;
    const dLon = ((((view.centerLon - d.lonCenter + 180) % 360) + 360) % 360) - 180;
    const insetLon = d.lonSpan * 0.04;
    const insetLat = d.latSpan * 0.04;
    return (
      Math.abs(dLon) + halfLon <= d.lonSpan / 2 - insetLon &&
      view.centerLat + halfLat <= d.latTop - insetLat &&
      view.centerLat - halfLat >= d.latTop - d.latSpan + insetLat
    );
  }

  /**
   * Met à jour la grille de détail selon la vue. Renvoie la simulation à faire avancer (ou null).
   * @param zoom facteur de zoom de la navigation
   */
  update(renderer: THREE.WebGLRenderer, view: FlatTransform, zoom: number, cfg: Config, now: number): WaveSim | null {
    const opts = cfg.view.detail;
    const wanted = opts.enabled && zoom >= opts.minZoom;
    if (!wanted) {
      // Fondu de sortie, puis libération.
      if (this.sim) {
        this.fadeOut = true;
        this.weight = Math.max(0, this.weight - 0.05);
        if (this.weight <= 0) this.dispose();
      }
      return this.sim;
    }
    this.fadeOut = false;
    const desired = this.desired(view, opts.margin);
    if (!desired) return this.sim;
    const tooCoarse = this.sim && this.sim.domain.lonSpan > desired.lonSpan * 1.9; // on a beaucoup zoomé depuis
    const needs = !this.sim || !this.covers(view) || tooCoarse;
    if (needs && now - this.lastBuild > 400) this.build(renderer, desired, cfg);
    if (this.sim) this.weight = Math.min(1, (now - this.bornAt) / FADE_IN_MS);
    return this.sim;
  }

  private build(renderer: THREE.WebGLRenderer, domain: Domain, cfg: Config): void {
    this.dispose();
    const profile = cfg.qualityProfiles[cfg.display.quality];
    // Largeur en cellules ; la hauteur suit (cellules carrées en degrés), plafonnée.
    let width = profile.detailSimWidth;
    const height = (width * domain.latSpan) / domain.lonSpan;
    if (height > 1024) width = Math.round((width * 1024) / height);
    const h = Math.max(8, Math.round((width * domain.latSpan) / domain.lonSpan));
    this.mask = new THREE.WebGLRenderTarget(width, h, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
    });
    (this.maskUniforms.uDomain.value as THREE.Vector4).set(domain.lonCenter, domain.latTop, domain.lonSpan, domain.latSpan);
    this.maskPass.render(renderer, this.mask);
    this.sim = new WaveSim(width, this.mask.texture, domain);
    this.sim.setParams(cfg.waves);
    this.sim.clear(renderer);
    this.bornAt = performance.now();
    this.lastBuild = this.bornAt;
    this.weight = 0;
  }

  get fadingOut(): boolean {
    return this.fadeOut;
  }

  dispose(): void {
    this.sim?.dispose();
    this.mask?.dispose();
    this.sim = null;
    this.mask = null;
    this.weight = 0;
  }
}

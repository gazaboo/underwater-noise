/** CPU copy captured at physical steps, shared by animal feedback and sound. */
import * as THREE from 'three';
import { FullscreenPass, rawMaterial } from '../render/fullscreen.ts';
import type { PhysicsField } from '../sim/physics-sim.ts';

/** Plage des niveaux empaquetés (dB re 1 µPa) : 16 bits sur 0–250 dB, soit 0,004 dB de résolution. */
const DB_MAX = 250;

/**
 * Empaquetage des quatre niveaux (accumulé, basse, moyenne, haute) en octets, deux pixels par cellule :
 * la relecture d'octets est rapide, celle de flottants 32 bits passe par une conversion lente (ANGLE/Vulkan).
 */
const PACK_FRAG = /* glsl */ `
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uLevels;
uniform vec2 uSize;     // taille de la grille des niveaux
vec2 enc(float db) {
  float v = floor(clamp(db / ${DB_MAX.toFixed(1)}, 0.0, 1.0) * 65535.0 + 0.5);
  return vec2(floor(v / 256.0), mod(v, 256.0)) / 255.0;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 l = texelFetch(uLevels, ivec2(p.x / 2, p.y), 0);
  outColor = (p.x % 2 == 0) ? vec4(enc(l.g), enc(l.b)) : vec4(enc(l.a), enc(l.r));
}`;

export class FieldReader {
  private data: Uint8Array | null = null;
  private width = 0;
  private height = 0;
  private target: THREE.WebGLRenderTarget | null = null;
  private readonly pass = new FullscreenPass(rawMaterial(PACK_FRAG, { uLevels: { value: null }, uSize: { value: new THREE.Vector2() } }));

  reset(): void {
    this.data = null;
  }

  /**
   * Read only at physical steps so animal feedback is independent of playback speed/FPS.
   * Relecture d'octets empaquetés : ≈ 10–20 ms sur la Radeon 780M (ANGLE/Vulkan), contre 1,7 s pour les
   * flottants 32 bits de la grille entière, qui figeaient l'image à chaque pas. Une relecture asynchrone
   * (barrière GPU) attendait, elle, que toute la file GPU soit vidée : jusqu'à 2 s.
   */
  capture(renderer: THREE.WebGLRenderer, field: PhysicsField): void {
    const w = field.width, h = field.height;
    if (!this.target || this.target.width !== 2 * w || this.target.height !== h) {
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(2 * w, h, { type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    }
    const u = this.pass.material.uniforms;
    u.uLevels.value = field.levels.texture;
    (u.uSize.value as THREE.Vector2).set(w, h);
    this.pass.render(renderer, this.target);
    if (!this.data || this.data.length !== 2 * w * h * 4) this.data = new Uint8Array(2 * w * h * 4);
    renderer.readRenderTargetPixels(this.target, 0, 0, 2 * w, h, this.data);
    this.width = w;
    this.height = h;
  }

  get ready(): boolean {
    return this.data !== null;
  }

  /**
   * Niveau (dB re 1 µPa) en (lat, lon) ; canal 0 = accumulé, 1 = basse, 2 = moyenne, 3 = haute.
   * Grille mondiale : ligne 0 au nord.
   */
  sample(lat: number, lon: number, channel: number): number {
    if (!this.data) return NaN;
    const x = Math.min(this.width - 1, Math.floor(((((lon + 180) % 360) + 360) % 360) * (this.width / 360)));
    const y = Math.min(this.height - 1, Math.max(0, Math.floor((90 - lat) * (this.height / 180))));
    // Pixel pair : basse, moyenne ; impair : haute, accumulé (2 octets chacun, poids fort d'abord).
    const slot = channel === 0 ? 3 : channel - 1;
    const i = (y * 2 * this.width + 2 * x + (slot >> 1)) * 4 + (slot & 1) * 2;
    return ((this.data[i] * 256 + this.data[i + 1]) / 65535) * DB_MAX;
  }
}

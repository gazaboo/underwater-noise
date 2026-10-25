/** CPU copy captured at physical steps, shared by animal feedback and sound. */
import * as THREE from 'three';
import type { PhysicsField } from '../sim/physics-sim.ts';

export class FieldReader {
  private data: Float32Array | null = null;
  private width = 0;
  private height = 0;
  reset(): void { this.data = null; }

  /** Read only at physical steps so animal feedback is independent of playback speed/FPS. */
  capture(renderer: THREE.WebGLRenderer, field: PhysicsField): void {
    this.width = field.width;
    this.height = field.height;
    if (!this.data || this.data.length !== this.width * this.height * 4) this.data = new Float32Array(this.width * this.height * 4);
    renderer.readRenderTargetPixels(field.levels, 0, 0, this.width, this.height, this.data);
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
    return this.data[(y * this.width + x) * 4 + channel];
  }
}

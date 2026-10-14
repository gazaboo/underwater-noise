/**
 * Copie processeur du champ de bruit (niveaux en dB, grille physique), relue de façon asynchrone
 * deux fois par seconde : sert au rayon d'écoute des cétacés, aux liens et (J5) au son.
 * La lecture asynchrone (PBO) évite de bloquer le GPU.
 */
import * as THREE from 'three';
import type { PhysicsField } from '../sim/physics-sim.ts';

export class FieldReader {
  private data: Float32Array | null = null;
  private width = 0;
  private height = 0;
  private pending = false;
  private last = 0;
  private asyncOk = true;

  update(renderer: THREE.WebGLRenderer, field: PhysicsField, now: number, periodMs = 500): void {
    if (this.pending || now - this.last < periodMs) return;
    this.last = now;
    const w = field.width;
    const h = field.height;
    const buf = this.data && this.data.length === w * h * 4 ? new Float32Array(w * h * 4) : new Float32Array(w * h * 4);
    const done = () => {
      this.data = buf;
      this.width = w;
      this.height = h;
      this.pending = false;
    };
    if (this.asyncOk) {
      this.pending = true;
      renderer
        .readRenderTargetPixelsAsync(field.levels, 0, 0, w, h, buf)
        .then(done)
        .catch(() => {
          // Pilote sans lecture asynchrone des flottants : lecture synchrone, plus rare.
          this.asyncOk = false;
          this.pending = false;
        });
    } else {
      renderer.readRenderTargetPixels(field.levels, 0, 0, w, h, buf);
      done();
    }
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

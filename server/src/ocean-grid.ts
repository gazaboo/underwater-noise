/** Lecture côté serveur de la grille terre/mer (data/grid/ocean_W.png). */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

export class OceanGrid {
  readonly width: number;
  readonly height: number;
  private readonly data: Buffer;

  constructor(path: string) {
    const png = PNG.sync.read(readFileSync(path));
    this.width = png.width;
    this.height = png.height;
    this.data = png.data;
  }

  private index(lat: number, lon: number): number {
    const x = Math.min(this.width - 1, Math.max(0, Math.floor(((((lon + 180) % 360) + 360) % 360) / 360 * this.width)));
    const y = Math.min(this.height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * this.height)));
    return (y * this.width + x) * 4;
  }

  isWater(lat: number, lon: number): boolean {
    return this.data[this.index(lat, lon)] > 0;
  }

  /** Profondeur approximative (m) ; 0 sur terre. */
  depth(lat: number, lon: number): number {
    const i = this.index(lat, lon);
    if (this.data[i] === 0) return 0;
    return 10 * 1100 ** (this.data[i + 1] / 255);
  }
}

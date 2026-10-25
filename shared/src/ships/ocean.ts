/** Grille terre/mer (data/grid/ocean_W.png décodée en RGBA) : R mer, G profondeur (log). */
export interface OceanLookup {
  readonly width: number;
  readonly height: number;
  isWater(lat: number, lon: number): boolean;
  /** Profondeur approximative (m) ; 0 sur terre. */
  depth(lat: number, lon: number): number;
}

export class OceanBytes implements OceanLookup {
  constructor(
    readonly width: number,
    readonly height: number,
    private readonly data: ArrayLike<number>,
  ) {}

  private index(lat: number, lon: number): number {
    const x = Math.min(this.width - 1, Math.max(0, Math.floor(((((lon + 180) % 360) + 360) % 360) / 360 * this.width)));
    const y = Math.min(this.height - 1, Math.max(0, Math.floor(((90 - lat) / 180) * this.height)));
    return (y * this.width + x) * 4;
  }

  isWater(lat: number, lon: number): boolean {
    return this.data[this.index(lat, lon)] > 0;
  }

  depth(lat: number, lon: number): number {
    const i = this.index(lat, lon);
    if (this.data[i] === 0) return 0;
    return 10 * 1100 ** (this.data[i + 1] / 255);
  }
}

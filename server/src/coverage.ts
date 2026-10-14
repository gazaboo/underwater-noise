/**
 * Carte de couverture AIS : où l'on « voit » des navires.
 *
 * Grille de 1° (360 × 180, ligne 0 au nord). Chaque message de position augmente le score de
 * sa cellule (et un peu des voisines) ; les scores décroissent avec une demi-vie exprimée en
 * temps de la source. La carte du direct est sauvegardée sur disque : elle se construit au fil
 * des jours d'enregistrement.
 *
 * Limite assumée : on ne sait pas distinguer « zone couverte mais vide de navires » de
 * « zone non couverte ». La carte mesure donc où des navires ont été vus récemment.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

export const COVERAGE_W = 360;
export const COVERAGE_H = 180;

export class CoverageMap {
  readonly data = new Float32Array(COVERAGE_W * COVERAGE_H);
  private lastDecayMs: number | null = null;

  constructor(fill = 0) {
    this.data.fill(fill);
  }

  private index(lat: number, lon: number): [number, number] {
    const x = Math.floor(((((lon + 180) % 360) + 360) % 360) * (COVERAGE_W / 360)) % COVERAGE_W;
    const y = Math.min(COVERAGE_H - 1, Math.max(0, Math.floor((90 - lat) * (COVERAGE_H / 180))));
    return [x, y];
  }

  observe(lat: number, lon: number, gain: number): void {
    const [x, y] = this.index(lat, lon);
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= COVERAGE_H) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = (x + dx + COVERAGE_W) % COVERAGE_W;
        const w = dx === 0 && dy === 0 ? 1 : 0.3; // les récepteurs portent à ~60 milles : on déborde un peu
        const i = yy * COVERAGE_W + xx;
        this.data[i] = Math.min(1, this.data[i] + gain * w);
      }
    }
  }

  /** Décroissance exponentielle jusqu'à `nowMs` (temps de la source). */
  decay(nowMs: number, halfLifeHours: number): void {
    if (this.lastDecayMs === null || nowMs < this.lastDecayMs) {
      this.lastDecayMs = nowMs;
      return;
    }
    const dtH = (nowMs - this.lastDecayMs) / 3_600_000;
    if (dtH < 1 / 60) return; // au plus une fois par minute de source
    const k = Math.pow(0.5, dtH / halfLifeHours);
    for (let i = 0; i < this.data.length; i++) this.data[i] *= k;
    this.lastDecayMs = nowMs;
  }

  value(lat: number, lon: number): number {
    const [x, y] = this.index(lat, lon);
    return this.data[y * COVERAGE_W + x];
  }

  toBytes(): Uint8Array {
    const out = new Uint8Array(this.data.length);
    for (let i = 0; i < out.length; i++) out[i] = Math.round(this.data[i] * 255);
    return out;
  }

  copyFrom(other: CoverageMap): void {
    this.data.set(other.data);
  }

  save(path: string): void {
    const png = new PNG({ width: COVERAGE_W, height: COVERAGE_H });
    const bytes = this.toBytes();
    for (let i = 0; i < bytes.length; i++) {
      png.data[4 * i] = png.data[4 * i + 1] = png.data[4 * i + 2] = bytes[i];
      png.data[4 * i + 3] = 255;
    }
    writeFileSync(path, PNG.sync.write(png));
  }

  static load(path: string): CoverageMap | null {
    if (!existsSync(path)) return null;
    const png = PNG.sync.read(readFileSync(path));
    if (png.width !== COVERAGE_W || png.height !== COVERAGE_H) return null;
    const map = new CoverageMap();
    for (let i = 0; i < map.data.length; i++) map.data[i] = png.data[4 * i] / 255;
    return map;
  }
}

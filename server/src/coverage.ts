/** Carte de couverture AIS (logique partagée) ; sauvegarde et lecture en PNG côté serveur. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { COVERAGE_H, COVERAGE_W, CoverageMap as CoverageCore } from '@vacarme/shared/ships/coverage.ts';

export { COVERAGE_H, COVERAGE_W } from '@vacarme/shared/ships/coverage.ts';

export class CoverageMap extends CoverageCore {
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

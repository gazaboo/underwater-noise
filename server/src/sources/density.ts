/** Lecture de data/density (meta.json + un PNG par groupe) ; grille partagée avec le navigateur. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { DensityGrid as DensityCore, type DensityFile } from '@vacarme/shared/ships/density.ts';

export * from '@vacarme/shared/ships/density.ts';

export class DensityGrid extends DensityCore {
  /** null si data/density est absent. */
  static load(dir: string): DensityCore | null {
    const metaPath = join(dir, 'meta.json');
    if (!existsSync(metaPath)) return null;
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as DensityFile;
    return DensityCore.fromEncoded(meta, (file) => PNG.sync.read(readFileSync(join(dir, file))));
  }
}

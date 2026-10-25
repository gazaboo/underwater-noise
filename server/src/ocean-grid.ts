/** Lecture côté serveur de la grille terre/mer (data/grid/ocean_W.png). */
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { OceanBytes } from '@vacarme/shared/ships/ocean.ts';

export class OceanGrid extends OceanBytes {
  constructor(path: string) {
    const png = PNG.sync.read(readFileSync(path));
    super(png.width, png.height, png.data);
  }
}

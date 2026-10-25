/**
 * Densité mondiale de navires en route (data/density, produite par tools/build_presence.py à partir de la
 * présence AIS de Global Fishing Watch) : λ = nombre moyen de navires présents par cellule de 0,1°, par groupe.
 *
 * Tirage de positions ∝ λ en deux niveaux : une cellule de 1° (même grille que la carte de couverture, ce qui
 * permet de restreindre le tirage aux zones non couvertes en mode mixte), puis une cellule fine à l'intérieur.
 */

export const COARSE_W = 360;
export const COARSE_H = 180;

export interface DensityGroup {
  name: string;
  /** λ par cellule fine (ligne 0 au nord). */
  lambda: Float32Array;
  /** Heures de présence par tranche de vitesse (nœuds, ex. « 10-15 »), pour tirer la vitesse. */
  speedHours: Record<string, number>;
}

/** Contenu de data/density/meta.json (tools/build_presence.py). */
export interface DensityFile {
  width: number;
  height: number;
  logMin: number;
  logMax: number;
  period: [string, string];
  attribution: string;
  groups: Record<string, { file: string; speedHours: Record<string, number>; meanShips: number }>;
}

export interface DensityMeta {
  period: [string, string] | null;
  attribution: string;
}

export class DensityGrid {
  /** Cellules fines par cellule de 1°, sur chaque axe. */
  readonly factor: number;
  /** Somme de λ par cellule de 1°, par groupe. */
  readonly coarse: Float64Array[];

  constructor(
    readonly width: number,
    readonly height: number,
    readonly groups: DensityGroup[],
    readonly meta: DensityMeta = { period: null, attribution: '' },
  ) {
    this.factor = width / COARSE_W;
    if (!Number.isInteger(this.factor) || height / COARSE_H !== this.factor) throw new Error(`grille de densité ${width}×${height} : multiple de 360×180 attendu`);
    this.coarse = groups.map((g) => {
      const c = new Float64Array(COARSE_W * COARSE_H);
      for (let y = 0; y < height; y++) {
        const row = Math.floor(y / this.factor) * COARSE_W;
        for (let x = 0; x < width; x++) c[row + Math.floor(x / this.factor)] += g.lambda[y * width + x];
      }
      return c;
    });
  }

  /**
   * Construit la grille à partir de data/density/meta.json et des PNG décodés (RGBA) de chaque groupe ;
   * la lecture des fichiers est faite par l'appelant (serveur : fichiers ; navigateur : fetch).
   */
  static fromEncoded(meta: DensityFile, decode: (file: string) => { width: number; height: number; data: ArrayLike<number> }): DensityGrid {
    const groups: DensityGroup[] = [];
    for (const [name, g] of Object.entries(meta.groups)) {
      const png = decode(g.file);
      if (png.width !== meta.width || png.height !== meta.height) throw new Error(`${g.file} : taille inattendue`);
      const lambda = new Float32Array(png.width * png.height);
      let sum = 0;
      for (let i = 0; i < lambda.length; i++) {
        const v = png.data[4 * i]; // RGBA
        if (v === 0) continue;
        lambda[i] = 10 ** (meta.logMin + ((v - 1) / 254) * (meta.logMax - meta.logMin));
        sum += lambda[i];
      }
      // L'encodage sur 8 bits arrondit chaque cellule : on recale sur le total exact.
      if (sum > 0) for (let i = 0; i < lambda.length; i++) lambda[i] *= g.meanShips / sum;
      groups.push({ name, lambda, speedHours: g.speedHours });
    }
    return new DensityGrid(meta.width, meta.height, groups, { period: meta.period, attribution: meta.attribution });
  }

  /** Indice de la cellule fine sous (lat, lon). */
  index(lat: number, lon: number): number {
    const x = Math.min(this.width - 1, Math.floor(((((lon + 180) % 360) + 360) % 360) * (this.width / 360)));
    const y = Math.min(this.height - 1, Math.max(0, Math.floor((90 - lat) * (this.height / 180))));
    return y * this.width + x;
  }

  value(group: number, lat: number, lon: number): number {
    return this.groups[group].lambda[this.index(lat, lon)];
  }

  /** Cellule de 1° (indice dans la grille 360 × 180, ligne 0 au nord) sous (lat, lon). */
  coarseIndex(lat: number, lon: number): number {
    const x = Math.min(COARSE_W - 1, Math.floor((((lon + 180) % 360) + 360) % 360));
    const y = Math.min(COARSE_H - 1, Math.max(0, Math.floor(90 - lat)));
    return y * COARSE_W + x;
  }

  /** Tire une position ∝ λ dans la cellule de 1° `c` (gigue uniforme dans la cellule fine). */
  sampleIn(group: number, c: number, rand: () => number): [number, number] {
    const lambda = this.groups[group].lambda;
    const f = this.factor;
    const cx = c % COARSE_W;
    const cy = Math.floor(c / COARSE_W);
    let r = rand() * this.coarse[group][c];
    let fx = cx * f;
    let fy = cy * f;
    search: for (let dy = 0; dy < f; dy++) {
      for (let dx = 0; dx < f; dx++) {
        const v = lambda[(cy * f + dy) * this.width + cx * f + dx];
        if (v <= 0) continue;
        fx = cx * f + dx;
        fy = cy * f + dy;
        r -= v;
        if (r <= 0) break search;
      }
    }
    const lon = -180 + ((fx + rand()) * 360) / this.width;
    const lat = 90 - ((fy + rand()) * 180) / this.height;
    return [lat, lon];
  }
}

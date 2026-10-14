/**
 * Grilles géographiques lues côté processeur : habitats des espèces (AquaMaps), masque terre/mer et
 * profondeur, observations (OBIS). Elles servent à placer et déplacer les groupes de cétacés et à
 * tester qu'aucun lien ne traverse les terres.
 */

/** Grille équirectangulaire d'octets (ligne 0 au nord), lue depuis un PNG. */
export class ByteGrid {
  constructor(
    readonly width: number,
    readonly height: number,
    /** RGBA */
    readonly data: Uint8ClampedArray,
  ) {}

  static async load(url: string): Promise<ByteGrid | null> {
    const res = await fetch(url);
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    } catch {
      return null;
    }
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    return new ByteGrid(bmp.width, bmp.height, ctx.getImageData(0, 0, bmp.width, bmp.height).data);
  }

  index(lat: number, lon: number): number {
    const x = Math.min(this.width - 1, Math.floor(((((lon + 180) % 360) + 360) % 360) * (this.width / 360)));
    const y = Math.min(this.height - 1, Math.max(0, Math.floor((90 - lat) * (this.height / 180))));
    return (y * this.width + x) * 4;
  }

  /** Canal `c` (0–3) en (lat, lon), 0–255. */
  get(lat: number, lon: number, c = 0): number {
    return this.data[this.index(lat, lon) + c];
  }
}

/** Masque terre/mer et profondeur (data/grid/ocean_W.png). */
export class OceanCpu {
  constructor(private readonly grid: ByteGrid) {}

  isWater(lat: number, lon: number): boolean {
    return this.grid.get(lat, lon, 0) > 0;
  }

  /** Profondeur (m), 0 sur terre. */
  depth(lat: number, lon: number): number {
    const i = this.grid.index(lat, lon);
    if (this.grid.data[i] === 0) return 0;
    return 10 * Math.pow(1100, this.grid.data[i + 1] / 255);
  }
}

export interface Sighting {
  lat: number;
  lon: number;
}

export interface SpeciesData {
  /** Probabilité d'habitat 0–1 (AquaMaps), ou null si la carte manque. */
  habitat: ByteGrid | null;
  sightings: Sighting[];
}

export async function loadSpeciesData(ids: string[]): Promise<Map<string, SpeciesData>> {
  let sightings: Record<string, Sighting[]> = {};
  try {
    const res = await fetch('/data/habitats/sightings.json');
    if (res.ok) sightings = (await res.json()).species ?? {};
  } catch {
    /* pas d'observations : positions tirées des habitats */
  }
  const out = new Map<string, SpeciesData>();
  await Promise.all(
    ids.map(async (id) => {
      const habitat = await ByteGrid.load(`/data/habitats/${id}.png`);
      if (!habitat) console.warn(`[cétacés] pas de carte d'habitat pour « ${id} » (tools/build_habitats.py) : répartition selon la profondeur seule`);
      out.set(id, { habitat, sightings: sightings[id] ?? [] });
    }),
  );
  return out;
}

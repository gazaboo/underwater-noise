/**
 * Chargement des grilles (data/grid/*.png) en textures, octets intacts :
 * pas de prémultiplication ni de conversion d'espace colorimétrique, car les canaux
 * encodent des données (profondeur, altitude sur 16 bits, fraction de terre).
 *
 * Convention de toutes les textures « monde » : équirectangulaire, u = (lon + 180) / 360,
 * v = (90 − lat) / 180 (v = 0 au nord : première ligne du PNG, flipY désactivé).
 */
import * as THREE from 'three';

async function loadBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status} (avez-vous lancé « npm run data » ?)`);
  return createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none' });
}

function dataTexture(image: ImageBitmap, filter: THREE.MagnificationTextureFilter): THREE.Texture {
  const t = new THREE.Texture(image as unknown as HTMLImageElement);
  t.flipY = false;
  t.premultiplyAlpha = false;
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = false;
  t.magFilter = filter;
  t.minFilter = filter;
  t.wrapS = THREE.RepeatWrapping; // la longitude boucle
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

export interface WorldAssets {
  /** RGB = couleur NE II ; A = indice de forêt artistique. Filtrage linéaire. */
  landcover: THREE.Texture;
  /** Grille de simulation : R = mer, G = profondeur (log), B = fraction de terre. Filtrage au plus proche. */
  ocean: THREE.Texture;
  oceanWidth: number;
  /** Monde illustré — R/16 = milieu, G = ton, B = forêt. Au plus proche : le shader mélange lui-même les milieux. */
  landBiome: THREE.Texture;
  /** Monde illustré — R = distance signée à la côte, G = altitude lissée, B = lumière précalculée. Linéaire. */
  landShape: THREE.Texture;
  /** Altitude 16 bits (R,G) — au plus proche (le décodage interdit l'interpolation). */
  elevationNearest: THREE.Texture;
  /** Même image, filtrage linéaire : seul le canal B (fraction de terre) s'utilise ainsi. */
  elevationLinear: THREE.Texture;
}

const cache = new Map<string, Promise<ImageBitmap>>();
function cachedBitmap(url: string): Promise<ImageBitmap> {
  if (!cache.has(url)) cache.set(url, loadBitmap(url));
  return cache.get(url)!;
}

export async function loadOceanGrid(width: number): Promise<THREE.Texture> {
  return dataTexture(await cachedBitmap(`/data/grid/ocean_${width}.png`), THREE.NearestFilter);
}

export async function loadWorldAssets(oceanWidth: number): Promise<WorldAssets> {
  const [ocean, elev, landcover, biome, shape] = await Promise.all([
    loadOceanGrid(oceanWidth),
    cachedBitmap('/data/grid/elevation_4096.png'),
    cachedBitmap('/data/grid/landcover_4096.png'),
    cachedBitmap('/data/grid/land_biome_4096.png'),
    cachedBitmap('/data/grid/land_shape_4096.png'),
  ]);
  const landShape = dataTexture(shape, THREE.LinearFilter);
  // Mipmaps : la carte entière (ou la texture monde) réduit cette grille ; pas de scintillement des côtes.
  landShape.generateMipmaps = true;
  landShape.minFilter = THREE.LinearMipmapLinearFilter;
  return {
    landcover: dataTexture(landcover, THREE.LinearFilter),
    landBiome: dataTexture(biome, THREE.NearestFilter),
    landShape,
    ocean,
    oceanWidth,
    elevationNearest: dataTexture(elev, THREE.NearestFilter),
    elevationLinear: dataTexture(elev, THREE.LinearFilter),
  };
}

export type Volcano = [number, number, number, number | null];
export async function loadVolcanoes(): Promise<Volcano[]> {
  const res = await fetch('/data/grid/volcanoes.json');
  if (!res.ok) throw new Error(`volcanoes.json : HTTP ${res.status}`);
  return res.json() as Promise<Volcano[]>;
}

/** Placements des ornements (tools/build_illustrated.py). */
export interface OrnamentData {
  categories: string[];
  /** Espacement (degrés) de chaque niveau de détail, par catégorie. */
  spacing: Record<string, number[]>;
  /** [lon, lat, catégorie, niveau, graine, échelle, dernière éruption | null] */
  ornaments: [number, number, number, number, number, number, number | null][];
}

/** Atlas des vignettes (tools/ornaments/pack_atlas.py). */
export interface AtlasData {
  size: number;
  cell: number;
  cols: number;
  sprites: { name: string; category: string; index: number; pivot: [number, number]; scale: number }[];
  categories: Record<string, number[]>;
}

export async function loadOrnaments(): Promise<{ data: OrnamentData; atlas: AtlasData; image: ImageBitmap }> {
  const [data, atlas, image] = await Promise.all([
    fetch('/data/grid/ornaments.json').then((r) => { if (!r.ok) throw new Error(`ornaments.json : HTTP ${r.status}`); return r.json() as Promise<OrnamentData>; }),
    fetch('/data/ornaments/atlas.json').then((r) => { if (!r.ok) throw new Error(`atlas.json : HTTP ${r.status}`); return r.json() as Promise<AtlasData>; }),
    fetch('/data/ornaments/atlas.png').then(async (r) => {
      if (!r.ok) throw new Error(`atlas.png : HTTP ${r.status}`);
      // Couleurs prémultipliées par l'alpha au chargement : mipmaps sans liseré sombre.
      return createImageBitmap(await r.blob(), { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none', imageOrientation: 'none' });
    }),
  ]);
  return { data, atlas, image };
}

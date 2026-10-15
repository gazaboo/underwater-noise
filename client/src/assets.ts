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
  const [ocean, elev, landcover] = await Promise.all([loadOceanGrid(oceanWidth), cachedBitmap('/data/grid/elevation_4096.png'), cachedBitmap('/data/grid/landcover_4096.png')]);
  return {
    landcover: dataTexture(landcover, THREE.LinearFilter),
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

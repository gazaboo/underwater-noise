/**
 * Groupes de cétacés simulés : marche aléatoire corrélée dans l'habitat de l'espèce.
 *
 * Placement initial : observations OBIS récentes quand elles existent (et `useSightings`),
 * sinon tirage pondéré par la probabilité d'habitat AquaMaps. Un déplacement qui sortirait de
 * l'habitat, passerait à terre ou dans une eau trop peu profonde pour l'espèce est refusé : le
 * groupe tourne. La vitesse en km/h utilise le temps commun de la scène.
 */
import { DEG, bandCenter, callNoise, communicationRange, destination, lossRateDbPerKm, naturalLevel, type Config } from '@vacarme/shared';
import type { OceanCpu, SpeciesData } from './geo-grids.ts';

export type SpeciesCfg = Config['whales']['species'][number];

export interface WhaleGroup {
  id: number;
  species: SpeciesCfg;
  speciesIndex: number;
  lat: number;
  lon: number;
  heading: number;
  /** Profondeur sous le groupe (m) : transition sphérique → cylindrique de ses appels. */
  depth: number;
  /** Phase du cycle d'appel (0–1). */
  callPhase: number;
  /** Bruit dans la bande de l'appel, au point du groupe (dB). */
  noiseCall: number;
  /** Portée de communication actuelle (m, vraie échelle), lissée. */
  rangeM: number;
  /** Portée en océan sans navires (m). */
  quietRangeM: number;
  /** Couverture AIS au point du groupe (0–1) : sous 0,2 le bruit y est sous-estimé. */
  coverage: number;
}

/** Bande d'analyse (Hz) correspondant à une espèce. */
export function bandOf(cfg: Config, s: SpeciesCfg) {
  return cfg.bands.find((b) => b.id === s.band)!;
}

/**
 * Taux de perte (dB/km) d'un appel de l'espèce à la profondeur depthM : même modèle que le champ de bruit
 * (Thorp + fond en eau peu profonde + coupure modale + perte supplémentaire), à la fréquence de la bande.
 */
export function lossRateOf(cfg: Config, s: SpeciesCfg, depthM: number): number {
  return lossRateDbPerKm(depthM, bandCenter(bandOf(cfg, s)), cfg.physics);
}

/** Bruit naturel de la bande de l'espèce (dB re 1 µPa). */
export function naturalOf(cfg: Config, s: SpeciesCfg): number {
  return naturalLevel(bandOf(cfg, s), cfg.ambient.windSpeedMs);
}

/** Correction bande → largeur de l'appel (dB à retrancher au niveau de bande). */
export function noiseCorrection(cfg: Config, s: SpeciesCfg): number {
  const b = bandOf(cfg, s);
  const n = naturalOf(cfg, s);
  return n - callNoise(n, b.fMax - b.fMin, s.callBandwidthHz);
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WhaleAgents {
  readonly groups: WhaleGroup[] = [];
  private rand = rng(1234);

  constructor(
    private readonly ocean: OceanCpu,
    private readonly data: Map<string, SpeciesData>,
  ) {}

  /** Le point convient-il à l'espèce (mer, profondeur, habitat) ? */
  private suitable(s: SpeciesCfg, lat: number, lon: number, threshold: number): boolean {
    if (Math.abs(lat) > 78 || !this.ocean.isWater(lat, lon)) return false;
    if (this.ocean.depth(lat, lon) < s.minDepthM) return false;
    const h = this.data.get(s.id)?.habitat;
    return !h || h.get(lat, lon) / 255 >= threshold;
  }

  /** Recrée tous les groupes selon la configuration. */
  populate(cfg: Config, scene?: string): void {
    this.groups.length = 0;
    this.rand = rng(1234);
    const th = cfg.whales.habitatThreshold;
    if (scene === 'duo') {
      // Scène de test : deux groupes de rorquals communs immobiles en mer Ligure (sanctuaire Pelagos),
      // à ~50 km l'un de l'autre. En océan calme ils s'entendraient à ~1 000 km ; ici le trafic ramène
      // leur portée vers 40–60 km : la marge du lien oscille autour de zéro au gré des ferries.
      const fin = cfg.whales.species.find((s) => s.id === 'fin')!;
      this.add(cfg, fin, 43.72, 8.25, 0);
      this.add(cfg, fin, 43.32, 7.9, 0);
      for (const g of this.groups) g.species = { ...g.species, speedKmh: 0 };
      return;
    }
    cfg.whales.species.forEach((s) => {
      if (!s.enabled) return;
      const sightings = cfg.whales.useSightings ? (this.data.get(s.id)?.sightings ?? []).filter((p) => this.suitable(s, p.lat, p.lon, 0)) : [];
      for (let g = 0; g < s.groups; g++) {
        let lat = 0;
        let lon = 0;
        let found = false;
        if (sightings.length && this.rand() < 0.7) {
          const p = sightings[Math.floor(this.rand() * sightings.length)];
          [lat, lon] = [p.lat, p.lon];
          found = true;
        }
        for (let tries = 0; !found && tries < 4000; tries++) {
          lat = -75 + 150 * this.rand();
          lon = -180 + 360 * this.rand();
          const h = this.data.get(s.id)?.habitat;
          // Tirage pondéré par la probabilité d'habitat (rejet).
          const p = h ? h.get(lat, lon) / 255 : 1;
          found = this.suitable(s, lat, lon, th) && this.rand() < p;
        }
        if (found) this.add(cfg, s, lat, lon, 360 * this.rand());
      }
    });
  }

  private add(cfg: Config, s: SpeciesCfg, lat: number, lon: number, heading: number): void {
    const depth = Math.max(10, this.ocean.depth(lat, lon));
    const natural = naturalOf(cfg, s) - noiseCorrection(cfg, s);
    // Portée scalaire : pertes évaluées au point du groupe (approximation : le trajet réel n'est pas connu
    // pour une portée « dans toutes les directions »). Les liens et l'espace affiché intègrent le vrai trajet.
    const quiet = communicationRange(s, natural, depth, lossRateOf(cfg, s, depth));
    this.groups.push({
      id: this.groups.length,
      species: s,
      speciesIndex: cfg.whales.species.indexOf(s),
      lat,
      lon,
      heading,
      depth,
      callPhase: this.rand(),
      noiseCall: natural,
      rangeM: quiet,
      quietRangeM: quiet,
      coverage: 1,
    });
  }

  /** Recalcule les grandeurs dépendant de la configuration (portées en océan calme). */
  configure(cfg: Config): void {
    for (const g of this.groups) {
      const s = cfg.whales.species.find((x) => x.id === g.species.id);
      if (s && g.species.speedKmh !== 0) g.species = s;
      const natural = naturalOf(cfg, g.species) - noiseCorrection(cfg, g.species);
      g.quietRangeM = communicationRange(g.species, natural, g.depth, lossRateOf(cfg, g.species, g.depth));
    }
  }

  /** Déplacement (dtSec : temps réel) et cycle d'appel. */
  move(cfg: Config, dtSec: number): void {
    const th = cfg.whales.habitatThreshold;
    for (const g of this.groups) {
      g.callPhase = (g.callPhase + dtSec / g.species.callIntervalSec) % 1;
      const distM = (g.species.speedKmh / 3.6) * dtSec;
      if (distM <= 0) continue;
      // Marche corrélée : petite rotation aléatoire à chaque pas.
      g.heading = (g.heading + (this.rand() - 0.5) * 40 * Math.min(1, dtSec * 2) + 360) % 360;
      const [lat, lon] = destination(g.lat, g.lon, g.heading, distM);
      if (this.suitable(g.species, lat, lon, th * 0.7)) {
        g.lat = lat;
        g.lon = lon;
        g.depth = Math.max(10, this.ocean.depth(lat, lon));
      } else {
        g.heading = (g.heading + 150 + 60 * this.rand()) % 360;
      }
    }
  }
}

/** Distance orthodromique rapide (m). */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * DEG;
  const p2 = lat2 * DEG;
  const dl = (lon2 - lon1) * DEG;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

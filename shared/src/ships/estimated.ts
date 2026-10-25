/**
 * Navires estimés : flotte synthétique dont l'effectif et la répartition suivent la présence AIS mondiale
 * de Global Fishing Watch (DensityGrid).
 *
 * - Effectif (sourcé) : pour chaque groupe, N = Σ λ sur la zone autorisée (λ = navires présents en moyenne),
 *   réduit proportionnellement si le total dépasse `maxShips` (signalé : le bruit est alors sous-estimé).
 * - Position (sourcée) : tirage ∝ λ. Vitesse (sourcée) : tranche tirée selon les heures de présence par
 *   tranche de vitesse du groupe, uniforme dans la tranche. Classe : `classMix` (ordre de grandeur).
 * - Mouvement (empirique) : le navire avance et suit les couloirs : tous les quelques km, il choisit parmi
 *   cap, cap ± 20°, cap ± 40° en favorisant la densité à `lookAheadKm` et la ligne droite. Il renaît ailleurs
 *   (tirage ∝ λ) au bout de sa durée de vie, ou s'il touche terre, se perd, ou entre dans une zone non autorisée.
 *
 * Zone autorisée : tout le globe (mode « estimés »), ou les cellules de 1° mal couvertes par l'AIS (mode mixte).
 */
import {
  FLAG_ESTIMATED,
  PhysicalSteps,
  FLAG_SYNTHETIC,
  KNOT_MS,
  SHIP_CLASS_INDEX,
  destination,
  wrapLon,
  type AnalysisBand,
  type ShipClass,
  type ShipRecord,
} from '../index.ts';
import type { OceanLookup } from './ocean.ts';
import { COARSE_H, COARSE_W, type DensityGrid } from './density.ts';
import { pickWeighted, rng, sampleLength, setLevels } from './simulation.ts';
import type { ShipSource } from './source.ts';

export interface EstimatedOptions {
  timeScale: number;
  maxShips: number;
  lifetimeHours: number;
  lookAheadKm: number;
  classMix: Record<string, Partial<Record<ShipClass, number>>>;
  seed: number;
  bands: readonly AnalysisBand[];
}

/** Bornes (nœuds) des tranches de vitesse de Global Fishing Watch. */
const SPEED_RANGES: Record<string, [number, number]> = {
  '<2': [0.5, 2],
  '2-4': [2, 4],
  '4-6': [4, 6],
  '6-10': [6, 10],
  '10-15': [10, 15],
  '15-25': [15, 25],
  '>25': [25, 32],
};

/** Distance parcourue entre deux choix de cap (km). */
const STEER_KM = 5;
const TURNS = [0, -20, 20, -40, 40];
const TURN_PREF = [1, 0.7, 0.7, 0.4, 0.4];
const ID_BASE = 800_000_000;

interface EstShip {
  group: number;
  cls: ShipClass;
  speedKn: number;
  lengthM: number;
  heading: number;
  ageSec: number;
  lifeSec: number;
  sinceSteerKm: number;
  record: ShipRecord;
}

export class EstimatedSource implements ShipSource {
  readonly name = 'estimated';
  private readonly rand: () => number;
  private readonly fleet: EstShip[][];
  /** Cellules de 1° autorisées (1) ; null = tout le globe. */
  private allowed: Uint8Array | null = null;
  /** Par groupe : sommes cumulées de λ sur les cellules de 1° autorisées. */
  private cum: Float64Array[] = [];
  private targets: number[] = [];
  private simMs = Date.now();
  private readonly steps = new PhysicalSteps();
  private nextId = 0;
  /** Le plafond `maxShips` a-t-il réduit l'effectif ? */
  capped = false;

  constructor(
    readonly density: DensityGrid,
    private readonly ocean: OceanLookup,
    private opts: EstimatedOptions,
  ) {
    this.rand = rng(opts.seed);
    this.fleet = density.groups.map(() => []);
    this.rebuild();
  }

  configure(opts: EstimatedOptions): void {
    this.opts = opts;
    this.rebuild();
  }

  /** Restreint la flotte aux cellules de 1° marquées (ligne 0 au nord), ou au globe entier (null). */
  setRegion(allowed: Uint8Array | null): void {
    this.allowed = allowed;
    this.rebuild();
  }

  private isAllowed(lat: number, lon: number): boolean {
    return !this.allowed || this.allowed[this.density.coarseIndex(lat, lon)] === 1;
  }

  /** Recalcule les effectifs cibles de la zone autorisée et ajuste la flotte. */
  private rebuild(): void {
    const n = COARSE_W * COARSE_H;
    const totals = this.density.groups.map((_, g) => {
      const cum = new Float64Array(n);
      let acc = 0;
      const coarse = this.density.coarse[g];
      for (let c = 0; c < n; c++) {
        if (!this.allowed || this.allowed[c] === 1) acc += coarse[c];
        cum[c] = acc;
      }
      this.cum[g] = cum;
      return acc;
    });
    const total = totals.reduce((a, b) => a + b, 0);
    const scale = total > this.opts.maxShips ? this.opts.maxShips / total : 1;
    this.capped = scale < 1;
    this.targets = totals.map((t) => Math.round(t * scale));
    this.fleet.forEach((ships, g) => {
      // Les navires sortis de la zone autorisée disparaissent ; on ramène chaque groupe à son effectif.
      const kept = ships.filter((s) => this.isAllowed(s.record.lat, s.record.lon));
      while (kept.length > this.targets[g]) kept.splice(Math.floor(this.rand() * kept.length), 1);
      while (kept.length < this.targets[g]) kept.push(this.spawn(g));
      this.fleet[g] = kept;
    });
  }

  private spawn(group: number): EstShip {
    const record: ShipRecord = {
      id: 0,
      lat: 0,
      lon: 0,
      sog: 0,
      cog: 0,
      classIndex: 0,
      flags: FLAG_SYNTHETIC | FLAG_ESTIMATED,
      lengthM: 0,
      slLow: 0,
      slMid: 0,
      slHigh: 0,
      slBroad: 0,
    };
    const s: EstShip = { group, cls: 'other', speedKn: 0, lengthM: 0, heading: 0, ageSec: 0, lifeSec: 0, sinceSteerKm: 0, record };
    this.respawn(s);
    // Âges répartis : les renaissances ne tombent pas toutes en même temps.
    s.ageSec = this.rand() * s.lifeSec;
    return s;
  }

  /** Nouveau navire : position ∝ λ, vitesse, classe, longueur, cap le long du couloir. */
  private respawn(s: EstShip): void {
    const g = s.group;
    const cum = this.cum[g];
    const total = cum[cum.length - 1];
    let lat = 0;
    let lon = 0;
    for (let tries = 0; tries < 30 && total > 0; tries++) {
      // Cellule de 1° par dichotomie sur les sommes cumulées, puis cellule fine.
      const r = this.rand() * total;
      let lo = 0;
      let hi = cum.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] > r) hi = mid;
        else lo = mid + 1;
      }
      [lat, lon] = this.density.sampleIn(g, lo, this.rand);
      if (this.ocean.isWater(lat, lon)) break;
    }
    const group = this.density.groups[g];
    const mix = Object.entries(this.opts.classMix[group.name] ?? { other: 1 }) as [ShipClass, number][];
    s.cls = pickWeighted(mix, ([, w]) => w, this.rand)[0];
    const bands = Object.entries(group.speedHours).filter(([b]) => SPEED_RANGES[b]);
    const [band] = bands.length ? pickWeighted(bands, ([, h]) => h, this.rand) : ['6-10'];
    const [vMin, vMax] = SPEED_RANGES[band];
    s.speedKn = vMin + (vMax - vMin) * this.rand();
    s.lengthM = sampleLength(s.cls, this.rand);
    s.lifeSec = -Math.log(Math.max(this.rand(), 1e-9)) * this.opts.lifetimeHours * 3600;
    s.ageSec = 0;
    s.sinceSteerKm = 0;
    s.heading = 360 * this.rand();
    s.record.id = ID_BASE + (this.nextId++ % 99_000_000);
    s.record.lat = lat;
    s.record.lon = wrapLon(lon);
    s.record.classIndex = SHIP_CLASS_INDEX[s.cls];
    s.record.lengthM = s.lengthM;
    setLevels(s.record, s.cls, s.speedKn, s.lengthM, this.opts.bands);
    // Cap initial : la direction la plus dense parmi douze.
    const dirs = Array.from({ length: 12 }, (_, i) => i * 30 + 30 * this.rand());
    const scores = dirs.map((h) => this.ahead(s, h) ** 2);
    if (scores.some((x) => x > 0)) s.heading = pickWeighted(dirs, (h) => scores[dirs.indexOf(h)], this.rand);
    s.record.cog = s.heading;
  }

  /** Densité du groupe devant le navire au cap `h` (moyenne à mi-distance et à la distance d'anticipation) ; 0 si terre. */
  private ahead(s: EstShip, h: number): number {
    const { lat, lon } = s.record;
    const L = this.opts.lookAheadKm * 1000;
    let sum = 0;
    for (const d of [L / 2, L]) {
      const [la, lo] = destination(lat, lon, h, d);
      if (!this.ocean.isWater(la, lo)) return 0;
      sum += this.density.value(s.group, la, wrapLon(lo));
    }
    return sum / 2;
  }

  /** Choisit le cap suivant ; false si le navire est perdu (rien devant, rien ici). */
  private steer(s: EstShip): boolean {
    const fishing = this.density.groups[s.group].name === 'fishing';
    const k = fishing ? 1 : 2; // les navires de pêche errent davantage
    const opts = TURNS.map((t, i) => ({ h: (s.heading + t + 360) % 360, w: (this.ahead(s, (s.heading + t + 360) % 360) + 1e-9) ** k * TURN_PREF[i] }));
    if (opts.every((o) => o.w <= 1e-9 ** k)) {
      if (this.density.value(s.group, s.record.lat, s.record.lon) <= 0) return false;
      s.heading = (s.heading + 180) % 360;
      return true;
    }
    s.heading = pickWeighted(opts, (o) => o.w, this.rand).h;
    return true;
  }

  /** Avance la flotte de `simSec` secondes simulées. */
  advance(simSec: number): void {
    this.simMs += simSec * 1000;
    this.steps.advance(simSec, 1, () => this.advanceFleet(1));
  }

  private advanceFleet(simSec: number): void {
    for (const ships of this.fleet) {
      for (const s of ships) {
        s.ageSec += simSec;
        if (s.ageSec > s.lifeSec) {
          this.respawn(s);
          continue;
        }
        let distKm = (s.speedKn * KNOT_MS * simSec) / 1000;
        let ok = true;
        // Par pas de STEER_KM au plus (grands pas de temps : premier instantané, temps accéléré).
        while (distKm > 0 && ok) {
          if (s.sinceSteerKm <= 0) {
            ok = this.steer(s);
            s.sinceSteerKm = STEER_KM;
          }
          const step = Math.min(distKm, s.sinceSteerKm);
          const [lat, lon] = destination(s.record.lat, s.record.lon, s.heading, step * 1000);
          if (!this.ocean.isWater(lat, lon)) {
            s.sinceSteerKm = 0; // choisir un autre cap au prochain pas
            s.heading = (s.heading + 180) % 360;
            break;
          }
          s.record.lat = lat;
          s.record.lon = wrapLon(lon);
          s.sinceSteerKm -= step;
          distKm -= step;
        }
        if (!ok || !this.isAllowed(s.record.lat, s.record.lon)) this.respawn(s);
        s.record.cog = s.heading;
      }
    }
  }

  tick(realDtSec: number): void {
    this.advance(realDtSec * this.opts.timeScale);
  }

  ships(): readonly ShipRecord[] {
    const out: ShipRecord[] = [];
    for (const ships of this.fleet) for (const s of ships) out.push(s.record);
    return out;
  }

  get count(): number {
    return this.fleet.reduce((a, s) => a + s.length, 0);
  }

  simTimeMs(): number {
    return this.simMs;
  }

  timeScale(): number {
    return this.opts.timeScale;
  }
}

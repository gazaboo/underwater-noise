/**
 * Mode simulation : navires synthétiques sur les grandes routes maritimes.
 *
 * - Navires marchands : suivent les routes de data/routes.json (réseau marnet), avec une
 *   dispersion latérale stable par navire ; à l'arrivée, ils repartent sur une autre route
 *   touchant le même port.
 * - Navires de pêche : errent autour d'un point d'attache sur le plateau continental.
 * Les niveaux sources sont calculés par le modèle JOMOPANS-ECHO (shared/acoustics).
 */
import {
  CLASS_PARAMS,
  PhysicalSteps,
  FLAG_SYNTHETIC,
  KNOT_MS,
  SHIP_CLASS_INDEX,
  destination,
  haversine,
  initialBearing,
  shipBandLevel,
  shipBroadbandLevel,
  wrapLon,
  type AnalysisBand,
  type ShipClass,
  type ShipRecord,
} from '../index.ts';
import type { OceanLookup } from './ocean.ts';
import type { ShipSource } from './source.ts';

/** Contenu de data/routes.json (tools/build_routes.py). */
export interface RoutesData {
  routes: Omit<Route, 'cum' | 'length'>[];
}

interface Route {
  from: string;
  to: string;
  weight: number;
  mix: Partial<Record<ShipClass, number>>;
  coords: [number, number][];
  /** Distances cumulées (km) le long de la route. */
  cum: number[];
  length: number;
}

interface MerchantState {
  kind: 'merchant';
  route: number;
  s: number; // km depuis le début de la route
  dir: 1 | -1;
  offsetKm: number;
}

interface FishingState {
  kind: 'fishing';
  homeLat: number;
  homeLon: number;
  lat: number;
  lon: number;
  heading: number;
  turnTimer: number;
}

interface SimShip {
  id: number;
  cls: ShipClass;
  lengthM: number;
  speedKn: number;
  state: MerchantState | FishingState;
  record: ShipRecord;
}

export interface SimulationOptions {
  shipCount: number;
  timeScale: number;
  fishingFraction: number;
  laneWidthKm: number;
  seed: number;
  bands: readonly AnalysisBand[];
}

/** Générateur pseudo-aléatoire reproductible (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export function pickWeighted<T>(items: readonly T[], weight: (t: T) => number, rand: () => number): T {
  let total = 0;
  for (const it of items) total += weight(it);
  let r = rand() * total;
  for (const it of items) {
    r -= weight(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

/** Vitesse de croisière typique (nœuds) par classe : autour de V_C, avec une dispersion. */
function cruiseSpeed(cls: ShipClass, rand: () => number): number {
  const v = CLASS_PARAMS[cls].vRef * (1 + 0.1 * gaussian(rand));
  return Math.max(2, v);
}

/** Niveaux sources (modèle JOMOPANS-ECHO) et vitesse d'un enregistrement de navire. */
export function setLevels(record: ShipRecord, cls: ShipClass, speedKn: number, lengthM: number, bands: readonly AnalysisBand[]): void {
  const [low, mid, high] = bands;
  record.slLow = shipBandLevel(low, speedKn, lengthM, cls);
  record.slMid = shipBandLevel(mid, speedKn, lengthM, cls);
  record.slHigh = shipBandLevel(high, speedKn, lengthM, cls);
  record.slBroad = shipBroadbandLevel(speedKn, lengthM, cls);
  record.sog = speedKn;
}

/** Longueur tirée autour de la longueur moyenne de la classe (log-normale, σ = 0,25). */
export function sampleLength(cls: ShipClass, rand: () => number): number {
  return Math.max(8, CLASS_PARAMS[cls].meanLength * Math.exp(0.25 * gaussian(rand)));
}

export class SimulationSource implements ShipSource {
  readonly name = 'simulation';
  private readonly rand: () => number;
  private readonly routes: Route[];
  private readonly routesByPort = new Map<string, number[]>();
  private readonly fleet: SimShip[] = [];
  private simMs = Date.now();
  private readonly steps = new PhysicalSteps();

  constructor(
    raw: RoutesData,
    private readonly grid: OceanLookup,
    private opts: SimulationOptions,
  ) {
    this.rand = rng(opts.seed);
    this.routes = raw.routes.map((r) => {
      const cum = [0];
      for (let i = 1; i < r.coords.length; i++) {
        const [lo1, la1] = r.coords[i - 1];
        const [lo2, la2] = r.coords[i];
        cum.push(cum[i - 1] + haversine(la1, lo1, la2, lo2) / 1000);
      }
      return { ...r, cum, length: cum[cum.length - 1] };
    });
    this.routes.forEach((r, i) => {
      for (const port of [r.from, r.to]) {
        if (!this.routesByPort.has(port)) this.routesByPort.set(port, []);
        this.routesByPort.get(port)!.push(i);
      }
    });
    this.populate();
  }

  /** Met à jour les options ; repeuple si la flotte change de taille. */
  configure(opts: SimulationOptions): void {
    const repopulate = opts.shipCount !== this.opts.shipCount || opts.fishingFraction !== this.opts.fishingFraction || opts.seed !== this.opts.seed;
    this.opts = opts;
    if (repopulate) this.populate();
    else for (const s of this.fleet) this.updateLevels(s);
  }

  private populate(): void {
    this.fleet.length = 0;
    const nFishing = Math.round(this.opts.shipCount * this.opts.fishingFraction);
    for (let i = 0; i < this.opts.shipCount; i++) {
      this.fleet.push(i < nFishing ? this.makeFishing(i) : this.makeMerchant(i));
    }
  }

  private makeShip(id: number, cls: ShipClass, state: SimShip['state']): SimShip {
    const lengthM = sampleLength(cls, this.rand);
    const ship: SimShip = {
      id: 900_000_000 + id,
      cls,
      lengthM,
      speedKn: cruiseSpeed(cls, this.rand),
      state,
      record: {
        id: 900_000_000 + id,
        lat: 0,
        lon: 0,
        sog: 0,
        cog: 0,
        classIndex: SHIP_CLASS_INDEX[cls],
        flags: FLAG_SYNTHETIC,
        lengthM,
        slLow: 0,
        slMid: 0,
        slHigh: 0,
        slBroad: 0,
      },
    };
    if (cls === 'fishing') ship.speedKn = 3 + 6 * this.rand();
    this.updateLevels(ship);
    this.place(ship);
    return ship;
  }

  private makeMerchant(id: number): SimShip {
    const route = this.routes.indexOf(pickWeighted(this.routes, (r) => r.weight, this.rand));
    const r = this.routes[route];
    const mix = Object.entries(r.mix) as [ShipClass, number][];
    const cls = pickWeighted(mix, ([, w]) => w, this.rand)[0];
    return this.makeShip(id, cls, {
      kind: 'merchant',
      route,
      s: this.rand() * r.length,
      dir: this.rand() < 0.5 ? 1 : -1,
      offsetKm: gaussian(this.rand) * this.opts.laneWidthKm,
    });
  }

  private makeFishing(id: number): SimShip {
    // Point d'attache : une cellule de mer peu profonde (plateau), hors hautes latitudes.
    let lat = 0;
    let lon = 0;
    for (let tries = 0; tries < 2000; tries++) {
      lat = -60 + 130 * this.rand();
      lon = -180 + 360 * this.rand();
      const d = this.grid.depth(lat, lon);
      if (d > 0 && d < 400) break;
    }
    return this.makeShip(id, 'fishing', { kind: 'fishing', homeLat: lat, homeLon: lon, lat, lon, heading: 360 * this.rand(), turnTimer: 0 });
  }

  private updateLevels(s: SimShip): void {
    setLevels(s.record, s.cls, s.speedKn, s.lengthM, this.opts.bands);
  }

  /** Calcule position et cap à partir de l'état. */
  private place(s: SimShip): void {
    const st = s.state;
    if (st.kind === 'fishing') {
      s.record.lat = st.lat;
      s.record.lon = st.lon;
      s.record.cog = st.heading;
      return;
    }
    const r = this.routes[st.route];
    // Recherche dichotomique du segment.
    let lo = 0;
    let hi = r.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (r.cum[mid] <= st.s) lo = mid;
      else hi = mid;
    }
    const seg = r.cum[hi] - r.cum[lo] || 1;
    const t = (st.s - r.cum[lo]) / seg;
    const [lo1, la1] = r.coords[lo];
    const [lo2, la2] = r.coords[hi];
    const lat = la1 + (la2 - la1) * t;
    const lon = lo1 + (lo2 - lo1) * t; // longitudes « dépliées » dans routes.json
    let bearing = initialBearing(la1, lo1, la2, lo2);
    // Dispersion latérale, ramenée à zéro près des ports pour ne pas finir à terre.
    const edge = Math.min(st.s, r.length - st.s);
    const fade = Math.min(1, edge / 150);
    let [plat, plon] = destination(lat, lon, bearing + 90, st.offsetKm * fade * 1000);
    if (!this.grid.isWater(plat, plon)) [plat, plon] = [lat, wrapLon(lon)];
    if (st.dir < 0) bearing = (bearing + 180) % 360;
    s.record.lat = plat;
    s.record.lon = plon;
    s.record.cog = bearing;
  }

  tick(realDtSec: number): void {
    const dt = realDtSec * this.opts.timeScale;
    this.simMs += dt * 1000;
    this.steps.advance(dt, 1, () => this.advance(1));
  }

  /** Fixed source-time integration keeps turns/arrivals independent of the acceleration. */
  private advance(dt: number): void {
    for (const s of this.fleet) {
      const st = s.state;
      const distKm = (s.speedKn * KNOT_MS * dt) / 1000;
      if (st.kind === 'merchant') {
        st.s += st.dir * distKm;
        const r = this.routes[st.route];
        if (st.s < 0 || st.s > r.length) this.arrive(s, st);
      } else {
        this.wander(st, distKm, dt);
      }
      this.place(s);
    }
  }

  /** À l'arrivée : nouvelle route depuis ce port (ou demi-tour). */
  private arrive(s: SimShip, st: MerchantState): void {
    const r = this.routes[st.route];
    const port = st.s < 0 ? r.from : r.to;
    const options = this.routesByPort.get(port) ?? [st.route];
    const next = this.routes.indexOf(pickWeighted(options.map((i) => this.routes[i]), (x) => x.weight, this.rand));
    const nr = this.routes[next];
    st.route = next;
    if (nr.from === port) {
      st.s = 0;
      st.dir = 1;
    } else {
      st.s = nr.length;
      st.dir = -1;
    }
    s.speedKn = cruiseSpeed(s.cls, this.rand);
    this.updateLevels(s);
  }

  private wander(st: FishingState, distKm: number, dt: number): void {
    st.turnTimer -= dt;
    if (st.turnTimer <= 0) {
      st.heading = (st.heading + 60 * gaussian(this.rand) + 360) % 360;
      st.turnTimer = 1800 + 5400 * this.rand(); // nouveau cap toutes les 0,5 à 2 h simulées
    }
    // Rappel vers le point d'attache au-delà de 120 km.
    if (haversine(st.lat, st.lon, st.homeLat, st.homeLon) > 120_000) {
      st.heading = initialBearing(st.lat, st.lon, st.homeLat, st.homeLon);
    }
    const [lat, lon] = destination(st.lat, st.lon, st.heading, distKm * 1000);
    if (this.grid.isWater(lat, lon)) {
      st.lat = lat;
      st.lon = lon;
    } else {
      st.heading = (st.heading + 180) % 360;
    }
  }

  ships(): readonly ShipRecord[] {
    return this.fleet.map((s) => s.record);
  }

  simTimeMs(): number {
    return this.simMs;
  }

  timeScale(): number {
    return this.opts.timeScale;
  }
}

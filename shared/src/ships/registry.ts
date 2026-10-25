/**
 * Registre des navires suivis par AIS (direct ou replay).
 *
 * - fusionne positions et données statiques (type, longueur) par MMSI ;
 * - extrapole à l'estime les navires silencieux (la couverture terrestre d'aisstream
 *   perd les navires au large : ils poursuivent leur route, marqués « anciens ») ;
 * - oublie les navires sans nouvelles depuis trop longtemps ;
 * - calcule les niveaux sources (JOMOPANS-ECHO), mis en cache tant que vitesse et type ne changent pas.
 */
import {
  FLAG_STALE,
  KNOT_MS,
  SHIP_CLASS_INDEX,
  classFromAis,
  destination,
  shipBandLevel,
  shipBroadbandLevel,
  type AnalysisBand,
  type ShipRecord,
} from '../index.ts';
import type { AisEvent } from './ais-parse.ts';

export interface RegistryOptions {
  staleAfterMin: number;
  maxExtrapolateMin: number;
  evictAfterMin: number;
  includeMoored: boolean;
  bands: readonly AnalysisBand[];
}

interface Entry {
  mmsi: number;
  lat: number;
  lon: number;
  sog: number;
  cog: number;
  tPos: number; // ms
  aisType?: number;
  lengthM?: number;
  levelsKey: string;
  levels: [number, number, number, number];
  classIndex: number;
}

export class ShipRegistry {
  private readonly entries = new Map<number, Entry>();
  /** Données statiques reçues avant toute position. */
  private readonly pendingStatic = new Map<number, { aisType?: number; lengthM?: number }>();

  constructor(private opts: RegistryOptions) {}

  configure(opts: RegistryOptions): void {
    this.opts = opts;
    for (const e of this.entries.values()) e.levelsKey = ''; // forcer le recalcul
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.pendingStatic.clear();
  }

  apply(ev: AisEvent, tMs: number): void {
    if (ev.kind === 'static') {
      const e = this.entries.get(ev.mmsi);
      const target = e ?? this.pendingStatic.get(ev.mmsi) ?? {};
      if (ev.aisType !== undefined && ev.aisType > 0) target.aisType = ev.aisType;
      if (ev.lengthM !== undefined) target.lengthM = ev.lengthM;
      if (!e) this.pendingStatic.set(ev.mmsi, target);
      return;
    }
    let e = this.entries.get(ev.mmsi);
    if (!e) {
      const st = this.pendingStatic.get(ev.mmsi);
      this.pendingStatic.delete(ev.mmsi);
      e = { mmsi: ev.mmsi, lat: ev.lat, lon: ev.lon, sog: 0, cog: 0, tPos: tMs, ...st, levelsKey: '', levels: [0, 0, 0, 0], classIndex: 0 };
      this.entries.set(ev.mmsi, e);
    }
    // Les messages peuvent arriver dans le désordre : on ignore une position plus ancienne.
    if (tMs < e.tPos) return;
    e.lat = ev.lat;
    e.lon = ev.lon;
    if (ev.sog !== undefined) e.sog = ev.sog;
    if (ev.cog !== undefined) e.cog = ev.cog;
    e.tPos = tMs;
  }

  private refreshLevels(e: Entry): void {
    const cls = classFromAis(e.aisType, e.lengthM, e.sog);
    const key = `${cls}|${Math.round(e.sog * 2)}|${e.lengthM ?? ''}`;
    if (key === e.levelsKey) return;
    const [low, mid, high] = this.opts.bands;
    e.levels = [
      shipBandLevel(low, e.sog, e.lengthM, cls),
      shipBandLevel(mid, e.sog, e.lengthM, cls),
      shipBandLevel(high, e.sog, e.lengthM, cls),
      shipBroadbandLevel(e.sog, e.lengthM, cls),
    ];
    e.classIndex = SHIP_CLASS_INDEX[cls];
    e.levelsKey = key;
  }

  /** Navires à l'instant `nowMs`, positions extrapolées ; oublie les plus anciens. */
  snapshot(nowMs: number): ShipRecord[] {
    const out: ShipRecord[] = [];
    const evict = this.opts.evictAfterMin * 60_000;
    const stale = this.opts.staleAfterMin * 60_000;
    const maxExtrap = this.opts.maxExtrapolateMin * 60_000;
    for (const [mmsi, e] of this.entries) {
      const age = nowMs - e.tPos;
      if (age > evict) {
        this.entries.delete(mmsi);
        continue;
      }
      if (!this.opts.includeMoored && e.sog < 0.5) continue;
      this.refreshLevels(e);
      let lat = e.lat;
      let lon = e.lon;
      const dt = Math.min(Math.max(age, 0), maxExtrap) / 1000;
      if (dt > 0 && e.sog >= 0.5) [lat, lon] = destination(e.lat, e.lon, e.cog, e.sog * KNOT_MS * dt);
      // Au-delà de l'extrapolation maximale, le navire s'immobilise : vitesse nulle pour le client.
      const frozen = age > maxExtrap;
      out.push({
        id: mmsi,
        lat,
        lon,
        sog: frozen ? 0 : e.sog,
        cog: e.cog,
        classIndex: e.classIndex,
        flags: age > stale ? FLAG_STALE : 0,
        lengthM: e.lengthM ?? 0,
        slLow: e.levels[0],
        slMid: e.levels[1],
        slHigh: e.levels[2],
        slBroad: e.levels[3],
      });
    }
    return out;
  }
}

/**
 * Lecture des messages aisstream.io (schéma : github.com/aisstream/ais-message-models).
 * On n'en retient que ce qui sert à l'œuvre : position, vitesse, cap, type et longueur.
 *
 * Valeurs « non disponible » de la norme AIS (ITU-R M.1371) :
 *   latitude 91, longitude 181, vitesse 102,3 nœuds, cap 360°, cap vrai 511.
 */

export type AisEvent =
  | { kind: 'position'; mmsi: number; lat: number; lon: number; sog?: number; cog?: number }
  | { kind: 'static'; mmsi: number; aisType?: number; lengthM?: number };

type Obj = Record<string, unknown>;

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function validLatLon(lat?: number, lon?: number): boolean {
  return lat !== undefined && lon !== undefined && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
}

function course(body: Obj): number | undefined {
  const cog = num(body.Cog);
  if (cog !== undefined && cog >= 0 && cog < 360) return cog;
  const hdg = num(body.TrueHeading);
  if (hdg !== undefined && hdg >= 0 && hdg < 360) return hdg;
  return undefined;
}

function speed(body: Obj): number | undefined {
  const sog = num(body.Sog);
  return sog !== undefined && sog >= 0 && sog < 102.2 ? sog : undefined;
}

function length(dim: unknown): number | undefined {
  if (!dim || typeof dim !== 'object') return undefined;
  const d = dim as Obj;
  const l = (num(d.A) ?? 0) + (num(d.B) ?? 0);
  return l > 1 && l < 500 ? l : undefined;
}

/** Transforme un message aisstream (objet JSON) en 0, 1 ou 2 événements. */
export function parseAisMessage(msg: unknown): AisEvent[] {
  if (!msg || typeof msg !== 'object') return [];
  const m = msg as Obj;
  const type = m.MessageType as string | undefined;
  const meta = (m.MetaData ?? {}) as Obj;
  const body = ((m.Message as Obj | undefined)?.[type ?? ''] ?? {}) as Obj;
  const mmsi = num(body.UserID) ?? num(meta.MMSI);
  if (!type || mmsi === undefined) return [];

  switch (type) {
    case 'PositionReport':
    case 'StandardClassBPositionReport':
    case 'ExtendedClassBPositionReport': {
      const lat = num(body.Latitude) ?? num(meta.latitude) ?? num(meta.Latitude);
      const lon = num(body.Longitude) ?? num(meta.longitude) ?? num(meta.Longitude);
      const out: AisEvent[] = [];
      if (validLatLon(lat, lon)) out.push({ kind: 'position', mmsi, lat: lat!, lon: lon!, sog: speed(body), cog: course(body) });
      if (type === 'ExtendedClassBPositionReport') {
        out.push({ kind: 'static', mmsi, aisType: num(body.Type), lengthM: length(body.Dimension) });
      }
      return out;
    }
    case 'ShipStaticData':
      return [{ kind: 'static', mmsi, aisType: num(body.Type), lengthM: length(body.Dimension) }];
    case 'StaticDataReport': {
      const rb = body.ReportB as Obj | undefined;
      if (!rb || rb.Valid === false) return [];
      return [{ kind: 'static', mmsi, aisType: num(rb.ShipType), lengthM: length(rb.Dimension) }];
    }
    default:
      return [];
  }
}

/** Types de messages demandés à aisstream. */
export const SUBSCRIBED_TYPES = [
  'PositionReport',
  'StandardClassBPositionReport',
  'ExtendedClassBPositionReport',
  'ShipStaticData',
  'StaticDataReport',
];

/**
 * Protocole binaire serveur → client (WebSocket).
 *
 * Message « instantané de navires » :
 *   en-tête (24 octets)
 *     u8  type (= MSG_SHIPS)   u8 version   u16 réservé
 *     u32 nombre de navires
 *     f64 temps simulé de l'instantané (ms depuis l'époque Unix)
 *     f32 facteur d'échelle temporelle (temps simulé / temps réel)
 *     u32 réservé
 *   puis, par navire (SHIP_STRIDE = 40 octets, little-endian)
 *     u32 id (MMSI ou identifiant synthétique)
 *     f32 lat, f32 lon (degrés)
 *     f32 sog (nœuds), f32 cog (degrés)
 *     u8  classe (index dans SHIP_CLASSES)   u8 drapeaux   u16 longueur (m)
 *     f32 niveau source bande basse, f32 bande moyenne, f32 bande haute (dB re 1 µPa·m)
 *     f32 niveau source large bande (dB re 1 µPa·m)
 */

export const MSG_SHIPS = 1;
export const PROTOCOL_VERSION = 1;
export const HEADER_BYTES = 24;
export const SHIP_STRIDE = 40;

/** Drapeaux par navire. */
export const FLAG_SYNTHETIC = 1 << 0; // navire simulé
export const FLAG_STALE = 1 << 1; // position extrapolée (plus de message reçu depuis un moment)

export interface ShipRecord {
  id: number;
  lat: number;
  lon: number;
  sog: number;
  cog: number;
  classIndex: number;
  flags: number;
  lengthM: number;
  slLow: number;
  slMid: number;
  slHigh: number;
  slBroad: number;
}

export interface ShipSnapshot {
  simTimeMs: number;
  timeScale: number;
  count: number;
  /** Vue brute sur les données, pour un décodage sans allocation côté client. */
  view: DataView;
}

export function encodeShips(ships: readonly ShipRecord[], simTimeMs: number, timeScale: number): ArrayBuffer {
  const buf = new ArrayBuffer(HEADER_BYTES + ships.length * SHIP_STRIDE);
  const v = new DataView(buf);
  v.setUint8(0, MSG_SHIPS);
  v.setUint8(1, PROTOCOL_VERSION);
  v.setUint32(4, ships.length, true);
  v.setFloat64(8, simTimeMs, true);
  v.setFloat32(16, timeScale, true);
  let o = HEADER_BYTES;
  for (const s of ships) {
    v.setUint32(o, s.id >>> 0, true);
    v.setFloat32(o + 4, s.lat, true);
    v.setFloat32(o + 8, s.lon, true);
    v.setFloat32(o + 12, s.sog, true);
    v.setFloat32(o + 16, s.cog, true);
    v.setUint8(o + 20, s.classIndex);
    v.setUint8(o + 21, s.flags);
    v.setUint16(o + 22, Math.min(65535, Math.max(0, Math.round(s.lengthM))), true);
    v.setFloat32(o + 24, s.slLow, true);
    v.setFloat32(o + 28, s.slMid, true);
    v.setFloat32(o + 32, s.slHigh, true);
    v.setFloat32(o + 36, s.slBroad, true);
    o += SHIP_STRIDE;
  }
  return buf;
}

export function decodeHeader(buf: ArrayBuffer): ShipSnapshot | null {
  if (buf.byteLength < HEADER_BYTES) return null;
  const view = new DataView(buf);
  if (view.getUint8(0) !== MSG_SHIPS || view.getUint8(1) !== PROTOCOL_VERSION) return null;
  const count = view.getUint32(4, true);
  if (buf.byteLength < HEADER_BYTES + count * SHIP_STRIDE) return null;
  return { simTimeMs: view.getFloat64(8, true), timeScale: view.getFloat32(16, true), count, view };
}

export function decodeShip(snap: ShipSnapshot, i: number): ShipRecord {
  const v = snap.view;
  const o = HEADER_BYTES + i * SHIP_STRIDE;
  return {
    id: v.getUint32(o, true),
    lat: v.getFloat32(o + 4, true),
    lon: v.getFloat32(o + 8, true),
    sog: v.getFloat32(o + 12, true),
    cog: v.getFloat32(o + 16, true),
    classIndex: v.getUint8(o + 20),
    flags: v.getUint8(o + 21),
    lengthM: v.getUint16(o + 22, true),
    slLow: v.getFloat32(o + 24, true),
    slMid: v.getFloat32(o + 28, true),
    slHigh: v.getFloat32(o + 32, true),
    slBroad: v.getFloat32(o + 36, true),
  };
}

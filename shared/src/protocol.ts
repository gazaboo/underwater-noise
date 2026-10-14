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
/**
 * Message « carte de couverture AIS » :
 *   u8 type (= MSG_COVERAGE)  u8 version  u16 largeur  u16 hauteur  u16 réservé
 *   puis largeur × hauteur octets (0 = jamais observé, 255 = bien observé), ligne 0 au nord.
 */
export const MSG_COVERAGE = 2;
export const COVERAGE_HEADER_BYTES = 8;
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

export function encodeCoverage(width: number, height: number, data: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(COVERAGE_HEADER_BYTES + width * height);
  const v = new DataView(buf);
  v.setUint8(0, MSG_COVERAGE);
  v.setUint8(1, PROTOCOL_VERSION);
  v.setUint16(2, width, true);
  v.setUint16(4, height, true);
  new Uint8Array(buf, COVERAGE_HEADER_BYTES).set(data.subarray(0, width * height));
  return buf;
}

export function decodeCoverage(buf: ArrayBuffer): { width: number; height: number; data: Uint8Array } | null {
  if (buf.byteLength < COVERAGE_HEADER_BYTES) return null;
  const v = new DataView(buf);
  if (v.getUint8(0) !== MSG_COVERAGE || v.getUint8(1) !== PROTOCOL_VERSION) return null;
  const width = v.getUint16(2, true);
  const height = v.getUint16(4, true);
  if (buf.byteLength < COVERAGE_HEADER_BYTES + width * height) return null;
  return { width, height, data: new Uint8Array(buf, COVERAGE_HEADER_BYTES, width * height) };
}

/** Type de message binaire (premier octet). */
export function messageType(buf: ArrayBuffer): number {
  return buf.byteLength > 0 ? new DataView(buf).getUint8(0) : -1;
}

/** État des sources, envoyé en JSON (message texte { type: 'status', status }). */
export interface SourceStatus {
  mode: 'auto' | 'live' | 'replay' | 'simulation';
  active: 'live' | 'replay' | 'simulation';
  hybrid: boolean;
  ships: number;
  live: { configured: boolean; connected: boolean; messagesPerSec: number; lastMessageAgoSec: number | null; ships: number; error: string | null };
  replay: { available: boolean; file: string | null; speed: number };
  recorder: { enabled: boolean; file: string | null };
}

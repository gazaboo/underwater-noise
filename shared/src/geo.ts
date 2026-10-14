/** Géodésie sphérique minimale (sphère de rayon moyen terrestre). */

export const EARTH_RADIUS_M = 6_371_000;
export const KNOT_MS = 1852 / 3600;
export const DEG = Math.PI / 180;

/** Ramène une longitude dans [-180, 180). */
export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Distance orthodromique (m) entre deux points en degrés. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * DEG;
  const p2 = lat2 * DEG;
  const dp = p2 - p1;
  const dl = (lon2 - lon1) * DEG;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Cap initial (degrés, 0 = nord, sens horaire) de 1 vers 2. */
export function initialBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * DEG;
  const p2 = lat2 * DEG;
  const dl = (lon2 - lon1) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/** Point atteint depuis (lat, lon) en suivant le cap `bearingDeg` sur `distM` mètres. */
export function destination(lat: number, lon: number, bearingDeg: number, distM: number): [number, number] {
  const d = distM / EARTH_RADIUS_M;
  const b = bearingDeg * DEG;
  const p1 = lat * DEG;
  const l1 = lon * DEG;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 / DEG, wrapLon(l2 / DEG)];
}

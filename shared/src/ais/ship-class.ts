/**
 * Correspondance « type de navire AIS » → classe JOMOPANS-ECHO (Table 1 de l'article).
 *
 * Les types AIS « Passenger » (60–69) et « Cargo » (70–79) sont ambigus : comme dans
 * l'article, on départage par la longueur (croisière > 100 m) et par la vitesse
 * observée (porte-conteneurs > 16 nœuds). Les rouliers (vehicle carriers) ne sont
 * pas identifiables par l'AIS : ils n'apparaissent qu'en simulation.
 */
import type { ShipClass } from '../acoustics/jomopans-echo.ts';

export function classFromAis(aisType: number | undefined, lengthM?: number, speedKn?: number): ShipClass {
  const t = aisType ?? 0;
  if (t === 30) return 'fishing';
  if (t === 31 || t === 32 || t === 52) return 'tug';
  if (t === 33) return 'dredger';
  if (t === 35) return 'naval';
  if (t === 36 || t === 37) return 'recreational';
  if (t === 51 || t === 53 || t === 55) return 'government';
  if (t >= 60 && t <= 69) return lengthM !== undefined && lengthM > 100 ? 'cruise' : 'passenger';
  if (t >= 71 && t <= 74) return 'container';
  if (t === 70 || (t >= 75 && t <= 79)) return speedKn !== undefined && speedKn > 16 ? 'container' : 'bulker';
  if (t >= 80 && t <= 89) return 'tanker';
  return 'other';
}

import { describe, expect, it } from 'vitest';
import {
  classFromAis,
  decodeHeader,
  decodeShip,
  deepMerge,
  destination,
  encodeShips,
  haversine,
  wrapLon,
  type ShipRecord,
} from '../src/index.ts';

describe('protocole binaire', () => {
  it('encode puis décode un instantané sans perte significative', () => {
    const ships: ShipRecord[] = [
      { id: 227006760, lat: 48.5, lon: -5.1, sog: 12.3, cog: 45, classIndex: 7, flags: 1, lengthM: 211, slLow: 180.5, slMid: 176, slHigh: 168, slBroad: 184 },
      { id: 1, lat: -33.9, lon: 179.9, sog: 0, cog: 359, classIndex: 0, flags: 0, lengthM: 30, slLow: 150, slMid: 155, slHigh: 150, slBroad: 160 },
    ];
    const buf = encodeShips(ships, 1_700_000_000_000, 10);
    const snap = decodeHeader(buf)!;
    expect(snap.count).toBe(2);
    expect(snap.timeScale).toBe(10);
    expect(snap.simTimeMs).toBe(1_700_000_000_000);
    const s = decodeShip(snap, 0);
    expect(s.id).toBe(227006760);
    expect(s.lat).toBeCloseTo(48.5, 4);
    expect(s.lengthM).toBe(211);
    expect(s.slBroad).toBeCloseTo(184, 4);
    expect(decodeShip(snap, 1).lon).toBeCloseTo(179.9, 4);
  });

  it('rejette un message tronqué', () => {
    const buf = encodeShips([], 0, 1).slice(0, 10);
    expect(decodeHeader(buf)).toBeNull();
  });
});

describe('classes AIS → J-E (Table 1)', () => {
  it.each([
    [30, undefined, undefined, 'fishing'],
    [52, undefined, undefined, 'tug'],
    [33, undefined, undefined, 'dredger'],
    [60, 250, undefined, 'cruise'],
    [69, 40, undefined, 'passenger'],
    [72, 300, 10, 'container'],
    [70, 200, 12, 'bulker'],
    [79, 300, 19, 'container'],
    [84, 180, 12, 'tanker'],
    [0, undefined, undefined, 'other'],
  ] as const)('type %i (l=%s, v=%s) → %s', (t, l, v, expected) => {
    expect(classFromAis(t, l, v)).toBe(expected);
  });
});

describe('géodésie', () => {
  it('distance Brest – New York ≈ 5 000 km', () => {
    const d = haversine(48.39, -4.49, 40.71, -74.0);
    expect(d / 1000).toBeGreaterThan(5000);
    expect(d / 1000).toBeLessThan(5400);
  });

  it('destination puis retour', () => {
    const [lat, lon] = destination(10, 179.5, 90, 200_000);
    expect(lon).toBeLessThan(0); // traverse l'antiméridien
    expect(haversine(10, 179.5, lat, lon)).toBeCloseTo(200_000, -1);
  });

  it('wrapLon', () => {
    expect(wrapLon(190)).toBeCloseTo(-170);
    expect(wrapLon(-181)).toBeCloseTo(179);
  });
});

describe('configuration', () => {
  it('deepMerge fusionne les objets et remplace les tableaux', () => {
    const merged = deepMerge({ a: { b: 1, c: 2 }, t: [1, 2] }, { a: { c: 3 }, t: [9] });
    expect(merged).toEqual({ a: { b: 1, c: 3 }, t: [9] });
  });
});

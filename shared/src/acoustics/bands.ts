/**
 * Bandes de fréquence : bandes décidécades (IEC 61260, base 10) et bandes d'analyse
 * de l'œuvre (une par groupe d'espèces).
 */
import { sourceLevelDecidecade, type ShipClass } from './jomopans-echo.ts';

/** Fréquences centrales décidécades 10^(n/10) Hz, de 10 Hz à 20 kHz. */
export const DECIDECADE_CENTERS: readonly number[] = Array.from({ length: 34 }, (_, i) => 10 ** ((10 + i) / 10));

export interface AnalysisBand {
  id: 'low' | 'mid' | 'high';
  /** Bornes de la bande (Hz). On somme les décidécades dont le centre est dans [fMin, fMax]. */
  fMin: number;
  fMax: number;
}

/**
 * Bandes d'analyse par défaut (surchargées par la configuration) :
 *  - low  : 10–40 Hz, rorqual bleu et rorqual commun ;
 *  - mid  : 100–500 Hz, chant grave de la baleine à bosse ;
 *  - high : 1–10 kHz, orque et cachalot (codas).
 */
export const DEFAULT_BANDS: readonly AnalysisBand[] = [
  { id: 'low', fMin: 10, fMax: 40 },
  { id: 'mid', fMin: 100, fMax: 500 },
  { id: 'high', fMin: 1000, fMax: 10000 },
];

/** Fréquence représentative d'une bande (moyenne géométrique), utilisée pour l'absorption. */
export function bandCenter(band: AnalysisBand): number {
  return Math.sqrt(band.fMin * band.fMax);
}

/** Somme énergétique de niveaux en dB. */
export function sumDb(levels: Iterable<number>): number {
  let e = 0;
  for (const l of levels) e += 10 ** (l / 10);
  return e > 0 ? 10 * Math.log10(e) : -Infinity;
}

/** Centres décidécades contenus dans une bande (tolérance d'un demi-pas en bordure). */
export function decidecadesIn(fMin: number, fMax: number): number[] {
  const half = 10 ** 0.05; // demi-pas décidécade
  return DECIDECADE_CENTERS.filter((f) => f >= fMin / half && f <= fMax * half);
}

/** Niveau source d'un navire dans une bande d'analyse (dB re 1 µPa·m). */
export function shipBandLevel(
  band: { fMin: number; fMax: number },
  speedKn: number,
  lengthM: number | undefined,
  shipClass: ShipClass,
): number {
  return sumDb(decidecadesIn(band.fMin, band.fMax).map((f) => sourceLevelDecidecade(f, speedKn, lengthM, shipClass)));
}

/** Niveau source large bande 10 Hz – 20 kHz (dB re 1 µPa·m). */
export function shipBroadbandLevel(speedKn: number, lengthM: number | undefined, shipClass: ShipClass): number {
  return shipBandLevel({ fMin: 10, fMax: 20000 }, speedKn, lengthM, shipClass);
}

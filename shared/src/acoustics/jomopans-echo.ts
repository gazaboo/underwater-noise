/**
 * Modèle de niveau source des navires JOMOPANS-ECHO (J-E).
 *
 * Référence : A. MacGillivray & C. de Jong, « A Reference Spectrum Model for
 * Estimating Source Levels of Marine Shipping Based on Automated Identification
 * System Data », J. Mar. Sci. Eng. 2021, 9, 369. Équations (9), (10), (11) et Table 1.
 *
 * Hypothèses (voir docs/MODELE_PHYSIQUE.md) :
 *  - source ponctuelle (monopole) à 6 m de profondeur ;
 *  - incertitude statistique ≈ ±6 dB (écart-type des résidus, 20 Hz – 20 kHz) ;
 *  - les raies tonales de pales (< 20 Hz) ne sont pas modélisées.
 *
 * Unités : niveaux en dB re 1 µPa²·m²/Hz (densité spectrale) ou dB re 1 µPa·m
 * (niveau en bande), fréquences en Hz, vitesses en nœuds, longueurs en mètres.
 */

export const SHIP_CLASSES = [
  'fishing',
  'tug',
  'naval',
  'recreational',
  'government',
  'cruise',
  'passenger',
  'bulker',
  'container',
  'vehicleCarrier',
  'tanker',
  'dredger',
  'other',
] as const;

export type ShipClass = (typeof SHIP_CLASSES)[number];

/** Index numérique d'une classe (pour le protocole binaire et les shaders). */
export const SHIP_CLASS_INDEX: Record<ShipClass, number> = Object.fromEntries(
  SHIP_CLASSES.map((c, i) => [c, i]),
) as Record<ShipClass, number>;

export interface ClassParams {
  /** Vitesse de référence V_C (nœuds), Table 1. */
  vRef: number;
  /** Longueur moyenne des navires mesurés (m), Table 1 — sert quand l'AIS ne donne pas la longueur. */
  meanLength: number;
  /** Paramètre D du spectre de référence (3, sauf croisière : 4). */
  d: number;
  /** Navires de charge : paramètre D^LF du pic basse fréquence (éq. 11). */
  dLF?: number;
}

/** Table 1 de l'article (V_C, longueur moyenne) et paramètres de forme spectrale. */
export const CLASS_PARAMS: Record<ShipClass, ClassParams> = {
  fishing: { vRef: 6.4, meanLength: 32, d: 3 },
  tug: { vRef: 3.7, meanLength: 28, d: 3 },
  naval: { vRef: 11.1, meanLength: 79, d: 3 },
  recreational: { vRef: 10.6, meanLength: 45, d: 3 },
  government: { vRef: 8.0, meanLength: 58, d: 3 },
  cruise: { vRef: 17.1, meanLength: 268, d: 4 },
  passenger: { vRef: 9.7, meanLength: 52, d: 3 },
  bulker: { vRef: 13.9, meanLength: 211, d: 3, dLF: 0.8 },
  container: { vRef: 18.0, meanLength: 294, d: 3, dLF: 0.8 },
  vehicleCarrier: { vRef: 15.8, meanLength: 194, d: 3, dLF: 1.0 },
  tanker: { vRef: 12.4, meanLength: 186, d: 3, dLF: 1.0 },
  dredger: { vRef: 9.5, meanLength: 128, d: 3 },
  other: { vRef: 7.4, meanLength: 81, d: 3 },
};

/** Constantes du spectre de référence (éq. 10 et 11). */
const K = 191; // dB
const K_LF = 208; // dB
const F1_NUM = 480; // Hz·kn  → f1 = 480 Hz × (1 kn / V_C)
const F1_LF_NUM = 600; // Hz·kn → f1^LF = 600 Hz × (1 kn / V_C)
/** Longueur de référence l0 = 300 ft (héritée de RANDI 3.1). */
export const L0_METERS = 300 * 0.3048;
/** En dessous de cette vitesse, on borne le terme de vitesse (évite log(0)). */
export const MIN_SPEED_KN = 0.5;
/**
 * Au-delà de 3 × V_C, on borne la vitesse : le modèle a été ajusté sur des navires à leur vitesse
 * de transit et sa loi en 60·log(V) diverge hors de ce domaine (un remorqueur à 12 nœuds, une
 * vedette à 40 nœuds, ou une vitesse AIS erronée donneraient des niveaux irréalistes, > 200 dB).
 */
export const MAX_SPEED_RATIO = 3;

const log10 = Math.log10;

/**
 * Densité spectrale de référence L_S0(f, C) en dB re 1 µPa²·m²/Hz (à V = V_C, l = l0).
 */
export function referenceSpectralDensity(f: number, shipClass: ShipClass): number {
  const p = CLASS_PARAMS[shipClass];
  if (p.dLF !== undefined && f < 100) {
    // Éq. (11) : pic basse fréquence des navires de charge.
    const f1 = F1_LF_NUM / p.vRef;
    const x = f / f1;
    return K_LF - 40 * log10(f1) + 10 * log10(f) - 10 * log10((1 - x * x) ** 2 + p.dLF ** 2);
  }
  // Éq. (10).
  const f1 = F1_NUM / p.vRef;
  const x = f / f1;
  return K - 20 * log10(f1) - 10 * log10((1 - x) ** 2 + p.d ** 2);
}

/**
 * Densité spectrale du niveau source L_S(f, V, l, C), éq. (9).
 * @param speedKn vitesse fond (nœuds) — bornée à MIN_SPEED_KN
 * @param lengthM longueur hors-tout (m) — si absente ou nulle, longueur moyenne de la classe
 */
export function sourceSpectralDensity(
  f: number,
  speedKn: number,
  lengthM: number | undefined,
  shipClass: ShipClass,
): number {
  const p = CLASS_PARAMS[shipClass];
  const v = Math.min(Math.max(speedKn, MIN_SPEED_KN), MAX_SPEED_RATIO * p.vRef);
  const l = lengthM && lengthM > 0 ? lengthM : p.meanLength;
  return referenceSpectralDensity(f, shipClass) + 60 * log10(v / p.vRef) + 20 * log10(l / L0_METERS);
}

/**
 * Niveau source dans la bande décidécade (≈ tiers d'octave base 10) centrée sur f :
 * densité spectrale + 10·log10(0,231·f), comme dans l'article.
 */
export function sourceLevelDecidecade(
  f: number,
  speedKn: number,
  lengthM: number | undefined,
  shipClass: ShipClass,
): number {
  return sourceSpectralDensity(f, speedKn, lengthM, shipClass) + 10 * log10(0.231 * f);
}

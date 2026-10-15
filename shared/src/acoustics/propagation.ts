/**
 * Propagation simplifiée : absorption de Thorp et perte de transmission
 * sphérique puis cylindrique.
 */

/**
 * Absorption de Thorp (dB/km), f en Hz.
 * α(f) = 0,11 f²/(1+f²) + 44 f²/(4100+f²) + 2,75·10⁻⁴ f² + 0,003, f en kHz.
 * Ordres de grandeur : ≈0,003 dB/km à 20 Hz, ≈0,005 à 125 Hz, ≈0,13 à 2 kHz.
 */
export function thorpAbsorptionDbPerKm(fHz: number): number {
  const f = fHz / 1000;
  const f2 = f * f;
  return (0.11 * f2) / (1 + f2) + (44 * f2) / (4100 + f2) + 2.75e-4 * f2 + 0.003;
}

/**
 * Perte de transmission (dB) à la distance r (m) :
 * sphérique (20·log r) jusqu'à la distance de transition r_t (≈ profondeur d'eau),
 * puis cylindrique (10·log r), plus l'absorption α·r.
 */
export function transmissionLoss(rM: number, transitionM: number, alphaDbPerKm: number): number {
  const r = Math.max(rM, 1);
  const rt = Math.max(transitionM, 1);
  const geometric = r <= rt ? 20 * Math.log10(r) : 20 * Math.log10(rt) + 10 * Math.log10(r / rt);
  return geometric + (alphaDbPerKm * r) / 1000;
}

/**
 * Paramètres des pertes de propagation communes au champ de bruit (GPU) et à l'équation du sonar des
 * cétacés : un seul modèle, appliqué aux deux.
 */
export interface LossParams {
  /** Perte au fond par réflexion (dB par rebond), eau peu profonde. [empirique] */
  bottomBounceLossDb: number;
  /** Angle de rasance effectif des trajets qui touchent le fond (degrés). [empirique] */
  grazingAngleDeg: number;
  /** Célérité du sédiment (m/s), pour la fréquence de coupure modale. [empirique] */
  sedimentSoundSpeed: number;
  /** Perte (dB/km) sous la fréquence de coupure : aucun mode ne se propage. [empirique] */
  cutoffLossDbPerKm: number;
  /** Perte supplémentaire partout (dB/km) ; 0 par défaut (aucune valeur sourcée). */
  extraLossDbPerKm: number;
}

/** Profondeur au-delà de laquelle on néglige les pertes par le fond (réfraction : les trajets ne touchent plus le fond). */
export const BOTTOM_LOSS_FULL_DEPTH = 200;
export const BOTTOM_LOSS_ZERO_DEPTH = 400;
const C_WATER = 1500;

/** Fréquence de coupure modale (Hz) d'un guide d'onde de profondeur h sur fond fluide (Pekeris). */
export function cutoffFrequency(depthM: number, sedimentSoundSpeed: number): number {
  const r = C_WATER / sedimentSoundSpeed;
  return C_WATER / (4 * Math.max(depthM, 1) * Math.sqrt(Math.max(1e-6, 1 - r * r)));
}

/**
 * Taux de perte (dB/km) en un point de profondeur depthM, à la fréquence fHz, hors étalement géométrique :
 *  - absorption de Thorp ;
 *  - pertes au fond en eau peu profonde : perte par rebond × nombre de rebonds par km,
 *    rebonds/km = 1000 · tan θ / (2h) (distance de saut d'un rayon à l'angle θ), atténuées entre 200 et 400 m ;
 *  - sous la fréquence de coupure modale : perte forte (aucun mode ne se propage) ;
 *  - perte supplémentaire éventuelle.
 */
export function lossRateDbPerKm(depthM: number, fHz: number, p: LossParams): number {
  const h = Math.max(depthM, 5);
  const w = h <= BOTTOM_LOSS_FULL_DEPTH ? 1 : h >= BOTTOM_LOSS_ZERO_DEPTH ? 0 : (BOTTOM_LOSS_ZERO_DEPTH - h) / (BOTTOM_LOSS_ZERO_DEPTH - BOTTOM_LOSS_FULL_DEPTH);
  const bounces = (1000 * Math.tan((p.grazingAngleDeg * Math.PI) / 180)) / (2 * h);
  const bottom = p.bottomBounceLossDb * bounces * w;
  const fc = cutoffFrequency(h, p.sedimentSoundSpeed);
  const cut = p.cutoffLossDbPerKm * Math.min(1, Math.max(0, (fc / fHz - 0.8) / 0.4));
  return thorpAbsorptionDbPerKm(fHz) + bottom + cut + p.extraLossDbPerKm;
}

/**
 * Perte de transmission le long d'un trajet : étalement (sphérique jusqu'à r_t, puis cylindrique)
 * + somme des taux de perte sur les segments. rates[i] en dB/km, segments de longueur égale.
 */
export function pathTransmissionLoss(rM: number, transitionM: number, rates: readonly number[]): number {
  const r = Math.max(rM, 1);
  const rt = Math.max(transitionM, 1);
  const geometric = r <= rt ? 20 * Math.log10(r) : 20 * Math.log10(rt) + 10 * Math.log10(r / rt);
  if (!rates.length) return geometric;
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  return geometric + (mean * r) / 1000;
}

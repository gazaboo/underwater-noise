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

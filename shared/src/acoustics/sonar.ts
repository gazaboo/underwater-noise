/**
 * Équation du sonar passif, version « communication » (Clark et al. 2009 ; Erbe et al. 2016) :
 *
 *   un appel émis au niveau SL est entendu à la distance r si
 *   SE = SL − TL(r) − NL_appel − DT ≥ 0
 *
 * SE : marge (« signal excess », dB) ; TL : perte de transmission ; DT : seuil de détection
 * (inclut la capacité de reconnaître l'appel) ; NL_appel : bruit dans la largeur de bande de
 * l'appel. Le champ physique donne des niveaux de bande ; pour un appel plus étroit que la bande,
 * on retire 10·log10(B_bande / B_appel) (spectre supposé plat dans la bande).
 */
import { transmissionLoss } from './propagation.ts';

export interface CallParams {
  /** Niveau source de l'appel (dB re 1 µPa·m). */
  sl: number;
  /** Seuil de détection (dB). */
  dt: number;
  /** Largeur de bande de l'appel (Hz). */
  callBandwidthHz: number;
}

/** Bruit dans la bande de l'appel, à partir du niveau de la bande d'analyse. */
export function callNoise(bandNoiseDb: number, bandWidthHz: number, callBandwidthHz: number): number {
  return bandNoiseDb - 10 * Math.log10(Math.max(1, bandWidthHz / Math.max(1e-3, callBandwidthHz)));
}

/** Marge (dB) d'un appel reçu à r mètres. */
export function signalExcess(call: CallParams, rM: number, transitionM: number, alphaDbPerKm: number, noiseCallDb: number): number {
  return call.sl - transmissionLoss(rM, transitionM, alphaDbPerKm) - noiseCallDb - call.dt;
}

/**
 * Portée de communication (m) dans un bruit uniforme : plus grande distance où la marge reste ≥ 0.
 * TL étant croissante, une dichotomie suffit. Renvoie 0 si l'appel n'est pas audible même à 1 m.
 */
export function communicationRange(call: CallParams, noiseCallDb: number, transitionM: number, alphaDbPerKm: number, maxM = 5_000_000): number {
  const ok = (r: number) => signalExcess(call, r, transitionM, alphaDbPerKm, noiseCallDb) >= 0;
  if (!ok(1)) return 0;
  if (ok(maxM)) return maxM;
  let lo = 1;
  let hi = maxM;
  for (let i = 0; i < 60; i++) {
    const mid = Math.sqrt(lo * hi); // dichotomie logarithmique
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}
